//! Twins of LocalCollabOperationStoreTests and
//! LocalCollabOperationHistoryTests for what the scenario fixture cannot
//! hold: other processes, stale descriptors, OS faults and concurrency.

#[cfg(unix)]
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use blok_collab_operation::{
    AppendOutcome, AppendResult, Candidate, Checkpoint, LookupOutcome, Reset, Source,
};
use blok_collab_workingset::{doc_key, new_lineage};

use crate::codec::sha256;
use crate::fixture::TempDir;
use crate::*;

const TWIN_DOC: &str = "doc-1";

struct TwinStore {
    store: Store,
    root: TempDir,
    logs: Arc<Mutex<Vec<String>>>,
}

fn new_twin_store() -> TwinStore {
    let root = TempDir::new();
    let logs = Arc::new(Mutex::new(Vec::new()));
    let sink = logs.clone();
    let store = Store::new(
        root.path(),
        StoreOptions {
            log: Some(Arc::new(move |line: &str| {
                sink.lock().unwrap().push(line.to_owned())
            })),
            ..StoreOptions::default()
        },
    )
    .unwrap();
    TwinStore { store, root, logs }
}

fn doc_dir_of(root: &Path) -> PathBuf {
    root.join(format!("{}.journal", doc_key(TWIN_DOC)))
}

impl TwinStore {
    fn doc_dir(&self) -> PathBuf {
        doc_dir_of(self.root.path())
    }

    fn path(&self, name: &str) -> PathBuf {
        self.doc_dir().join(name)
    }

    fn open(&self) -> Session {
        open_session(&self.store)
    }
}

fn open_session(store: &Store) -> Session {
    match store.open(&Context::background(), TWIN_DOC) {
        Ok((OpenOutcome::Opened, Some(session))) => session,
        Ok((outcome, _)) => panic!("open: {outcome}"),
        Err(err) => panic!("open: {err}"),
    }
}

fn twin_lineage(n: u32) -> String {
    format!("{n:032x}")
}

fn twin_op_id(n: u32) -> String {
    format!("{n:032x}")
}

fn twin_reset(session: &mut Session, epoch: i64, lineage: &str, frames: &[&[u8]]) {
    let reset = Reset {
        format: 1,
        epoch,
        lineage: lineage.to_owned(),
        baseline: frames.iter().map(|f| f.to_vec()).collect(),
    };
    session.reset(&Context::background(), &reset).unwrap();
}

fn twin_append(session: &mut Session, n: u32, update: &[u8]) -> Result<AppendResult, Error> {
    session.append(
        &Context::background(),
        &Candidate {
            operation_id: twin_op_id(n),
            actor_id: Some("user-1".into()),
            source: Source::CLIENT_V2,
            update: update.to_vec(),
            digest: sha256(update).to_vec(),
        },
    )
}

#[test]
fn refuses_a_wire_limit_the_record_format_cannot_carry() {
    let root = TempDir::new();
    let with = |limit| {
        Store::new(
            root.path(),
            StoreOptions {
                max_update_bytes: limit,
                ..StoreOptions::default()
            },
        )
    };
    assert!(matches!(
        with(33 << 20),
        Err(Error::Argument {
            out_of_range: true,
            ..
        })
    ));
    assert!(matches!(with(-1), Err(Error::Argument { .. })));
    assert_eq!(with(32 << 20).unwrap().max_update_bytes(), 32 << 20);
    assert_eq!(
        with(0).unwrap().max_update_bytes(),
        DEFAULT_MAX_UPDATE_BYTES
    );
}

#[test]
fn a_stale_session_cannot_append_even_with_its_file_handle_still_open() {
    let store = new_twin_store();
    let mut stale = store.open();
    twin_reset(&mut stale, 1, &twin_lineage(1), &[]);
    twin_append(&mut stale, 1, &[0x01]).unwrap();
    let journal_path = store.path("journal.1.1");
    let old = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&journal_path)
        .unwrap();
    std::fs::remove_file(store.path("lock")).unwrap();
    let mut winner = store.open();
    let before = std::fs::read(&journal_path).unwrap();

    // Nothing at the OS level took write access away from the stale side.
    crate::lock::FileAt::write_all_at(&old, &[0xff], before.len() as u64).unwrap();
    old.set_len(before.len() as u64).unwrap();
    assert!(matches!(
        twin_append(&mut stale, 2, &[0x02]),
        Err(Error::FenceLost)
    ));
    assert_eq!(
        std::fs::read(&journal_path).unwrap(),
        before,
        "the stale session wrote"
    );
    twin_append(&mut winner, 3, &[0x03]).unwrap();
    stale.close();
    winner.close();
    let reopened = store.open();
    let ids: Vec<&str> = reopened
        .open_result()
        .tail
        .iter()
        .map(|r| r.operation_id.as_str())
        .collect();
    assert_eq!(ids, [twin_op_id(1), twin_op_id(3)]);
}

#[cfg(unix)]
fn python3() -> Option<&'static str> {
    let found = [
        "/usr/bin/python3",
        "/usr/local/bin/python3",
        "/opt/homebrew/bin/python3",
    ]
    .into_iter()
    .find(|c| Path::new(c).exists());
    // CI runs Linux: a skipped cross-process check there would be a lie.
    assert!(
        found.is_some() || !cfg!(target_os = "linux"),
        "no python3 to hold the lock from a separate process"
    );
    found
}

#[cfg(unix)]
struct Holder(Child);

#[cfg(unix)]
impl Drop for Holder {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

// Holds flock(LOCK_EX) from another process: what a live C# store holds,
// since .NET's FileShare.None is flock on Unix.
#[cfg(unix)]
fn start_lock_holder(python: &str, lock_path: &Path) -> Holder {
    let script = "import fcntl, sys, time\n\
        handle = open(sys.argv[1], 'a+')\n\
        fcntl.flock(handle, fcntl.LOCK_EX)\n\
        print('locked', flush=True)\n\
        time.sleep(300)\n";
    let mut child = Command::new(python)
        .args(["-c", script])
        .arg(lock_path)
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    assert_eq!(line.trim(), "locked");
    Holder(child)
}

// Go skips this on Windows: flock, the python holder and a symlink
// loop are POSIX-only.
#[cfg(unix)]
#[test]
fn open_while_another_process_holds_the_document_reports_open_elsewhere() {
    let store = new_twin_store();
    let mut seeder = store.open();
    twin_reset(&mut seeder, 1, &twin_lineage(1), &[]);
    seeder.close();

    let mut holder = store.open();
    let other = Store::new(store.root.path(), StoreOptions::default()).unwrap();
    let ctx = Context::background();
    assert!(matches!(
        other.open(&ctx, TWIN_DOC),
        Ok((OpenOutcome::DocumentOpenElsewhere, None))
    ));
    holder.close();
    assert!(store.path("lock").exists(), "the lock file must stay");
    store.open().close();

    let Some(python) = python3() else {
        return;
    };
    let live = start_lock_holder(python, &store.path("lock"));
    assert!(matches!(
        other.open(&ctx, TWIN_DOC),
        Ok((OpenOutcome::DocumentOpenElsewhere, None))
    ));
    assert!(matches!(
        other.purge(&ctx, TWIN_DOC),
        Ok(PurgeOutcome::DocumentOpenElsewhere)
    ));
    drop(live);
    assert!(
        store.open().open_result().head.is_some(),
        "no head after the holder died"
    );
}

// A Rust hold is the same flock another process (and so a C# store) tests for.
#[cfg(unix)]
#[test]
fn a_go_hold_refuses_another_process_flock() {
    let Some(python) = python3() else {
        return;
    };
    let store = new_twin_store();
    let _session = store.open();
    let probe = "import fcntl, sys\n\
        handle = open(sys.argv[1], 'a+')\n\
        try:\n    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)\n    print('free')\n\
        except OSError:\n    print('held')\n";
    let out = Command::new(python)
        .args(["-c", probe])
        .arg(store.path("lock"))
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "held");
}

#[cfg(unix)]
#[test]
fn purge_does_not_report_a_lock_io_fault_as_a_live_holder() {
    let store = new_twin_store();
    let mut session = store.open();
    twin_reset(&mut session, 1, &twin_lineage(1), &[&[0xb1]]);
    session.close();
    let manifest_before = std::fs::read(store.path(MANIFEST_FILE_NAME)).unwrap();
    let lock = store.path("lock");
    std::fs::remove_file(&lock).unwrap();
    std::os::unix::fs::symlink(&lock, &lock).unwrap();

    let outcome = store.store.purge(&Context::background(), TWIN_DOC);
    assert!(outcome.is_err(), "purge answered {outcome:?}");
    assert!(!store.path("purged").exists(), "marker written");
    assert_eq!(
        std::fs::read(store.path(MANIFEST_FILE_NAME)).unwrap(),
        manifest_before,
        "manifest changed"
    );
    std::fs::remove_file(&lock).unwrap();
}

#[test]
fn purge_keeps_the_marker_on_a_case_insensitive_volume() {
    let store = new_twin_store();
    let mut session = store.open();
    twin_reset(&mut session, 1, &twin_lineage(1), &[&[0xb1]]);
    session.close();
    std::fs::write(store.path("PURGED"), b"").unwrap();
    let ctx = Context::background();
    assert_eq!(
        store.store.purge(&ctx, TWIN_DOC).unwrap(),
        PurgeOutcome::Purged
    );
    let other = Store::new(store.root.path(), StoreOptions::default()).unwrap();
    assert!(matches!(
        other.open(&ctx, TWIN_DOC),
        Ok((OpenOutcome::DocumentPurged, None))
    ));
    assert_eq!(std::fs::read_dir(store.doc_dir()).unwrap().count(), 2);
}

#[test]
fn a_ledger_that_cannot_be_written_never_fails_a_reset_or_an_open() {
    let store = new_twin_store();
    let mut session = store.open();
    twin_reset(&mut session, 1, &twin_lineage(1), &[&[0xb1]]);
    session.close();
    let ledger = store.path(LEDGER_FILE_NAME);
    std::fs::remove_file(&ledger).unwrap();
    std::fs::create_dir(&ledger).unwrap();
    let mut session = store.open();
    let head = session
        .reset(
            &Context::background(),
            &Reset {
                format: 1,
                epoch: 2,
                lineage: twin_lineage(2),
                baseline: vec![vec![0xb2]],
            },
        )
        .unwrap();
    assert_eq!(head.lineage, twin_lineage(2));
    session.close();
    assert_eq!(
        store.open().open_result().head.as_ref().unwrap().lineage,
        twin_lineage(2)
    );
    let logs = store.logs.lock().unwrap();
    assert!(
        logs.iter().any(|l| l.contains(LEDGER_FILE_NAME)),
        "{logs:?}"
    );
}

#[test]
fn concurrent_deletes_and_resets_leave_every_ledger_entry_readable() {
    let store = new_twin_store();
    let mut session = store.open();
    let lineages: Vec<String> = (0..10).map(|_| new_lineage()).collect();
    for (i, lineage) in lineages.iter().enumerate() {
        twin_reset(&mut session, i as i64 + 1, lineage, &[&[0xb1]]);
    }
    let later: Vec<String> = (0..11).map(|_| new_lineage()).collect();
    let outcomes = std::thread::scope(|scope| {
        let resets = scope.spawn(|| {
            for (i, lineage) in later.iter().enumerate() {
                let reset = Reset {
                    format: 1,
                    epoch: 11 + i as i64,
                    lineage: lineage.clone(),
                    baseline: vec![vec![0xb2]],
                };
                session.reset(&Context::background(), &reset).unwrap();
            }
        });
        let deletes: Vec<_> = lineages[..9]
            .iter()
            .map(|lineage| {
                let store = store.store.clone();
                scope.spawn(move || store.delete_lineage(&Context::background(), TWIN_DOC, lineage))
            })
            .collect();
        resets.join().unwrap();
        deletes
            .into_iter()
            .map(|d| d.join().unwrap())
            .collect::<Vec<_>>()
    });
    for (i, outcome) in outcomes.into_iter().enumerate() {
        assert_eq!(
            outcome.unwrap(),
            LineageDeleteOutcome::Deleted,
            "delete {i}"
        );
    }
    let data = std::fs::read(store.path(LEDGER_FILE_NAME)).unwrap();
    assert_eq!(data.len() % LEDGER_ENTRY_SIZE, 0, "{} bytes", data.len());
    for (i, slot) in data.chunks(LEDGER_ENTRY_SIZE).enumerate() {
        assert!(
            decode_lineage_entry(slot).is_some(),
            "bad entry at {}",
            i * LEDGER_ENTRY_SIZE
        );
    }
    let names: Vec<String> = store
        .store
        .list_lineages(&Context::background(), TWIN_DOC)
        .unwrap()
        .into_iter()
        .map(|info| info.lineage)
        .collect();
    let mut want = vec![lineages[9].clone()];
    want.extend(later);
    assert_eq!(names, want);
}

// History reads take no lock and never write, so they run beside a live
// session's appends.
#[test]
fn history_reads_run_beside_a_live_session() {
    let store = new_twin_store();
    let mut session = store.open();
    twin_reset(&mut session, 1, &twin_lineage(1), &[]);
    std::thread::scope(|scope| {
        scope.spawn(|| {
            for n in 1..=50u32 {
                twin_append(&mut session, n, &[n as u8]).unwrap();
            }
        });
        for _ in 0..20 {
            let mut last = 0;
            for record in store.store.read_records(
                &Context::background(),
                TWIN_DOC,
                &twin_lineage(1),
                u64::MAX,
            ) {
                let record = record.unwrap();
                assert_eq!(record.sequence, last + 1);
                last = record.sequence;
            }
        }
    });
}

#[test]
fn a_cancelled_call_writes_nothing() {
    let store = new_twin_store();
    let mut session = store.open();
    twin_reset(&mut session, 1, &twin_lineage(1), &[]);
    let ctx = Context::background();
    ctx.cancel();
    let journal = store.path("journal.1.1");
    let before = std::fs::read(&journal).unwrap();
    let candidate = Candidate {
        operation_id: twin_op_id(1),
        actor_id: Some("user-1".into()),
        source: Source::CLIENT_V2,
        update: vec![1],
        digest: vec![0; 32],
    };
    assert!(matches!(
        session.append(&ctx, &candidate),
        Err(Error::Canceled)
    ));
    let reset = Reset {
        format: 1,
        epoch: 2,
        lineage: twin_lineage(2),
        baseline: vec![],
    };
    assert!(matches!(session.reset(&ctx, &reset), Err(Error::Canceled)));
    assert!(matches!(
        store.store.open(&ctx, TWIN_DOC),
        Err(Error::Canceled)
    ));
    assert!(matches!(
        store.store.purge(&ctx, TWIN_DOC),
        Err(Error::Canceled)
    ));
    assert_eq!(std::fs::read(&journal).unwrap(), before, "journal changed");
}

fn injected() -> std::io::Error {
    std::io::Error::other("injected fsync failure")
}

// A failed fsync undoes its record, so the retry the caller must make is
// not told Duplicate for bytes no disk holds.
#[test]
fn an_append_whose_flush_fails_is_undone() {
    let store = new_twin_store();
    let mut session = store.open();
    twin_reset(&mut session, 1, &twin_lineage(1), &[]);
    store.store.set_sync_journal(|_| Err(injected()));
    match twin_append(&mut session, 1, &[0x01]) {
        Err(Error::Io(err)) => assert_eq!(err.to_string(), "injected fsync failure"),
        other => panic!("{other:?}"),
    }
    assert_eq!(
        std::fs::metadata(store.path("journal.1.1")).unwrap().len(),
        0
    );
    store.store.set_sync_journal(|file| file.sync_all());
    let lookup = session
        .find_committed(&Context::background(), &twin_op_id(1), &sha256(&[0x01]))
        .unwrap();
    assert_eq!(lookup.outcome, LookupOutcome::NotCommitted);
    let result = twin_append(&mut session, 1, &[0x01]).unwrap();
    assert_eq!(
        (result.outcome, result.sequence),
        (AppendOutcome::Committed, 1)
    );
}

// The hook takes the document from a second session on the same store, as
// Go's does; the sessions it opens live until the test ends.
fn take_the_document_during_the_flush(store: &TwinStore, fail: bool) -> Arc<Mutex<Vec<Session>>> {
    let taken = Arc::new(Mutex::new(Vec::new()));
    let keep = taken.clone();
    let second = store.store.clone();
    let lock = store.path("lock");
    store.store.set_sync_journal(move |file| {
        std::fs::remove_file(&lock).unwrap();
        keep.lock().unwrap().push(open_session(&second));
        if fail {
            Err(injected())
        } else {
            file.sync_all()
        }
    });
    taken
}

// A holder that took the document during the flush may reuse the sequence,
// so a flush that succeeds after the fence moved must not answer Committed.
#[test]
fn an_append_whose_fence_moves_during_the_flush_is_not_committed() {
    let store = new_twin_store();
    let mut session = store.open();
    twin_reset(&mut session, 1, &twin_lineage(1), &[]);
    let _taken = take_the_document_during_the_flush(&store, false);
    let result = twin_append(&mut session, 1, &[0x01]);
    assert!(matches!(result, Err(Error::FenceLost)), "{result:?}");
    store.store.set_sync_journal(|file| file.sync_all());
}

// When the fence moved before the undo, the cut could delete the new
// holder's records, so the session leaves the bytes and stops answering.
#[test]
fn an_append_that_cannot_be_undone_faults_the_session() {
    let store = new_twin_store();
    let mut session = store.open();
    twin_reset(&mut session, 1, &twin_lineage(1), &[]);
    let _taken = take_the_document_during_the_flush(&store, true);
    assert!(
        twin_append(&mut session, 1, &[0x01]).is_err(),
        "append answered"
    );
    store.store.set_sync_journal(|file| file.sync_all());
    assert_ne!(
        std::fs::metadata(store.path("journal.1.1")).unwrap().len(),
        0,
        "the record was cut after the fence moved"
    );
    match session.find_committed(&Context::background(), &twin_op_id(1), &[0; 32]) {
        Err(err @ Error::Faulted(_)) => assert!(err.to_string().contains("could not be flushed")),
        other => panic!("{other:?}"),
    }
}

fn twin_reset_with(session: &mut Session, epoch: i64, lineage: &str, baseline: u8) {
    twin_reset(session, epoch, lineage, &[&[baseline]]);
}

fn journal_names(store: &TwinStore, generation: u64) -> Vec<String> {
    let prefix = format!("journal.{generation}.");
    let mut names: Vec<String> = std::fs::read_dir(store.doc_dir())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.starts_with(&prefix))
        .collect();
    names.sort();
    names
}

fn seed_three_lineages(store: &TwinStore) -> Vec<String> {
    let mut session = store.open();
    let mut lineages = Vec::new();
    for epoch in 1..=3u32 {
        let lineage = new_lineage();
        twin_reset_with(&mut session, epoch.into(), &lineage, 0xb0 + epoch as u8);
        twin_append(&mut session, epoch * 10 + 1, &[1]).unwrap();
        twin_append(&mut session, epoch * 10 + 2, &[2]).unwrap();
        lineages.push(lineage);
    }
    session.close();
    lineages
}

fn seed_without_ledger(store: &TwinStore) -> String {
    let lineage = new_lineage();
    let mut session = store.open();
    twin_reset_with(&mut session, 1, &lineage, 0xb1);
    twin_append(&mut session, 1, &[1]).unwrap();
    session.close();
    std::fs::remove_file(store.path(LEDGER_FILE_NAME)).unwrap();
    lineage
}

// The rotted byte is the version byte itself, with the checksum left
// alone: only the order of the two checks decides what open says.
#[test]
fn a_corrupt_manifest_is_not_reported_as_another_version() {
    let store = new_twin_store();
    let mut session = store.open();
    twin_reset(&mut session, 1, &new_lineage(), &[]);
    session.close();
    let path = store.path(MANIFEST_FILE_NAME);
    let mut manifest = std::fs::read(&path).unwrap();
    for slot in 0..2 {
        manifest[slot * MANIFEST_SLOT_SIZE + 4] ^= 0xff;
    }
    std::fs::write(&path, manifest).unwrap();
    let reopened = Store::new(store.root.path(), StoreOptions::default()).unwrap();
    let message = match reopened.open(&Context::background(), TWIN_DOC) {
        Err(err) => err.to_string(),
        Ok((outcome, _)) => panic!("opened: {outcome}"),
    };
    assert!(message.contains("decodes"), "{message}");
    assert!(!message.contains("is version"), "{message}");
}

#[test]
fn checkpoint_publication_preserves_journal_history() {
    let store = new_twin_store();
    let state = vec![0xc0, 0xc1, 0xc2];
    let first_digest = sha256(&[1]).to_vec();
    let ctx = Context::background();
    let mut session = store.open();
    twin_reset(&mut session, 1, &new_lineage(), &[]);
    for n in 1..=5u32 {
        twin_append(&mut session, n, &[n as u8]).unwrap();
    }
    let journal = journal_names(&store, 1);
    assert_eq!(journal.len(), 1, "{journal:?}");
    let before = std::fs::read(store.path(&journal[0])).unwrap();
    session
        .write_checkpoint(
            &ctx,
            &Checkpoint {
                through: 3,
                state: state.clone(),
            },
        )
        .unwrap();
    assert_eq!(before, std::fs::read(store.path(&journal[0])).unwrap());
    let found = session
        .find_committed(&ctx, &twin_op_id(1), &first_digest)
        .unwrap();
    assert_eq!(found.outcome, LookupOutcome::Duplicate);
    session
        .write_checkpoint(
            &ctx,
            &Checkpoint {
                through: 3,
                state: vec![0xff],
            },
        )
        .unwrap();
    for through in [2, 6, 0] {
        let refused = session.write_checkpoint(
            &ctx,
            &Checkpoint {
                through,
                state: state.clone(),
            },
        );
        assert!(refused.is_err(), "checkpoint through {through} was taken");
    }
    session.close();
    let mut reopened = store.open();
    let opened = reopened.open_result().clone();
    assert_eq!(opened.checkpoint, Some(Checkpoint { through: 3, state }));
    assert_eq!(opened.head.map(|h| h.durable_through), Some(5));
    let tail: Vec<u64> = opened.tail.iter().map(|r| r.sequence).collect();
    assert_eq!(tail, [4, 5]);
    let found = reopened
        .find_committed(&ctx, &twin_op_id(1), &first_digest)
        .unwrap();
    assert_eq!(found.outcome, LookupOutcome::Duplicate);
}

// A list or read must not write the ledger: a later open would then skip
// the backfill.
#[test]
fn lists_the_current_lineage_of_a_document_never_opened_since_the_upgrade() {
    let store = new_twin_store();
    let lineage = seed_without_ledger(&store);
    let listed = store
        .store
        .list_lineages(&Context::background(), TWIN_DOC)
        .unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].lineage, lineage);
    assert!(listed[0].current);
    assert_eq!(listed[0].created_at, None);
    assert!(!store.path(LEDGER_FILE_NAME).exists());
}

#[test]
fn reads_the_current_lineage_of_a_document_never_opened_since_the_upgrade() {
    let store = new_twin_store();
    let lineage = seed_without_ledger(&store);
    let ctx = Context::background();
    let headers: Vec<u64> = store
        .store
        .read_headers(&ctx, TWIN_DOC, &lineage)
        .map(|h| h.unwrap().sequence)
        .collect();
    assert_eq!(headers, [1]);
    let baseline = store.store.read_baseline(&ctx, TWIN_DOC, &lineage).unwrap();
    assert_eq!(baseline, Some(vec![vec![0xb1]]));
    assert!(!store.path(LEDGER_FILE_NAME).exists());
}

// Without a manifest nothing says which generation is live.
#[test]
fn refuses_to_delete_when_the_manifest_is_empty() {
    let store = new_twin_store();
    let lineages = seed_three_lineages(&store);
    std::fs::write(store.path(MANIFEST_FILE_NAME), []).unwrap();
    let ctx = Context::background();
    for lineage in [&lineages[2], &lineages[0]] {
        let outcome = store.store.delete_lineage(&ctx, TWIN_DOC, lineage).unwrap();
        assert_eq!(outcome, LineageDeleteOutcome::NotFound);
    }
    assert_eq!(journal_names(&store, 3).len(), 1);
    assert_eq!(journal_names(&store, 1).len(), 1);
}

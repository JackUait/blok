//! The store tests that start another process. A child starts with a copy
//! of every descriptor its parent has, until its exec closes them, so a
//! flock a test thread has just released can stay held for a moment. These
//! tests live in their own binary, away from the store tests that close and
//! reopen a document, and take turns through SPAWN.
#![cfg(unix)]

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use blok_collab_journal::{Context, OpenOutcome, PurgeOutcome, Session, Store, StoreOptions};
use blok_collab_operation::Reset;
use blok_collab_workingset::doc_key;

const TWIN_DOC: &str = "doc-1";

static SPAWN: Mutex<()> = Mutex::new(());

struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> TempDir {
        let path =
            std::env::temp_dir().join(format!("blok-journal-cross-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        TempDir(std::fs::canonicalize(&path).unwrap())
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct TwinStore {
    store: Store,
    root: TempDir,
}

impl TwinStore {
    fn new(name: &str) -> TwinStore {
        let root = TempDir::new(name);
        let store = Store::new(&root.0, StoreOptions::default()).unwrap();
        TwinStore { store, root }
    }

    fn path(&self, name: &str) -> PathBuf {
        self.root
            .0
            .join(format!("{}.journal", doc_key(TWIN_DOC)))
            .join(name)
    }

    fn open(&self) -> Session {
        match self.store.open(&Context::background(), TWIN_DOC) {
            Ok((OpenOutcome::Opened, Some(session))) => session,
            Ok((outcome, _)) => panic!("open: {outcome}"),
            Err(err) => panic!("open: {err}"),
        }
    }
}

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

struct Holder(Child);

impl Drop for Holder {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

// Holds flock(LOCK_EX) from another process: what a live C# store holds,
// since .NET's FileShare.None is flock on Unix.
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
#[test]
fn open_while_another_process_holds_the_document_reports_open_elsewhere() {
    let _turn = SPAWN
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let store = TwinStore::new("open-elsewhere");
    let mut seeder = store.open();
    seeder
        .reset(
            &Context::background(),
            &Reset {
                format: 1,
                epoch: 1,
                lineage: format!("{:032x}", 1),
                baseline: Vec::new(),
            },
        )
        .unwrap();
    seeder.close();

    let mut holder = store.open();
    let other = Store::new(&store.root.0, StoreOptions::default()).unwrap();
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
#[test]
fn a_go_hold_refuses_another_process_flock() {
    let _turn = SPAWN
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(python) = python3() else {
        return;
    };
    let store = TwinStore::new("refuses-flock");
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

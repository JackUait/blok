use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use blok_collab_operation::{
    AppendOutcome, AppendResult, Candidate, Checkpoint, Head, Lookup, LookupOutcome, OpenResult,
    Record, Reset,
};
use blok_collab_workingset::{
    LINEAGE_LENGTH, append_frame, decode_document, decode_frames, doc_key, is_lineage,
};

use crate::codec::{MAX_UPDATE_LENGTH, Status, decode_record, encode_record};
use crate::error::Error;
use crate::files::{
    BASELINE_MAGIC, CHECKPOINT_MAGIC, MANIFEST_FILE_NAME, MANIFEST_SIZE, Manifest, publish,
    read_manifest, read_sealed, write_sealed,
};
use crate::ledger::{
    LEDGER_ENTRY_SIZE, LEDGER_FILE_NAME, LineageEntry, LineageEntryKind, encode_lineage_entry,
    read_ledger,
};
use crate::lock::{
    FileAt, Flags, READ_ONLY, is_held_elsewhere, open_file, private_dir_builder, read_shared,
    remove_file, sync_directory,
};

/// Matches the default CollabMaxMessageBytes. The codec's 32 MiB ceiling is
/// only a backstop; the wire limit is the policy.
pub const DEFAULT_MAX_UPDATE_BYTES: i64 = 1 << 20;

const LOCK_NAME: &str = "lock";
const PURGE_NAME: &str = "purged";
const JOURNAL_SUFFIX: &str = ".journal";

pub type Log = Arc<dyn Fn(&str) + Send + Sync>;
pub type Clock = Arc<dyn Fn() -> SystemTime + Send + Sync>;
type SyncJournal = Arc<dyn Fn(&File) -> io::Result<()> + Send + Sync>;

/// Go's context: a call checks it on entry and stops with
/// [`Error::Canceled`] once it is cancelled.
#[derive(Clone, Default)]
pub struct Context(Arc<AtomicBool>);

impl Context {
    pub fn background() -> Context {
        Context::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn err(&self) -> Result<(), Error> {
        if self.0.load(Ordering::SeqCst) {
            Err(Error::Canceled)
        } else {
            Ok(())
        }
    }
}

/// Configures a [`Store`]. A zero `max_update_bytes` is the default; `now`
/// is the system clock unless set.
#[derive(Clone, Default)]
pub struct StoreOptions {
    pub max_update_bytes: i64,
    pub log: Option<Log>,
    pub now: Option<Clock>,
}

/// The built-in operation store (C# LocalCollabOperationStore): one
/// append-only, checksummed journal per document under
/// `<dir>/<doc key>.journal/`. It writes the same bytes and names as C#, so
/// either server opens the other's directory.
///
/// The lock file decides liveness only; the fence in the manifest decides
/// who may write. Every append, checkpoint and reset re-reads the manifest
/// from its path first. One process per directory.
///
/// It must open a document before anything reads it through the working-set
/// LocalStore: that store moves an unreadable working set aside, and the
/// import here would then see no file and seed an empty document.
///
/// The API blocks; async callers run it on a blocking thread.
#[derive(Clone)]
pub struct Store {
    inner: Arc<Inner>,
}

struct Inner {
    dir: PathBuf,
    max_update_bytes: i64,
    log: Option<Log>,
    now: Clock,
    // One ledger writer per document in this process. A history delete
    // takes no lock file and is guarded by this alone.
    gates: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    // The append's flush; tests swap it to stage a failed fsync.
    sync_journal: Mutex<SyncJournal>,
}

/// CollabDocumentOpenOutcome.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpenOutcome {
    Opened,
    DocumentOpenElsewhere,
    DocumentPurged,
}

impl std::fmt::Display for OpenOutcome {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            OpenOutcome::Opened => "Opened",
            OpenOutcome::DocumentOpenElsewhere => "DocumentOpenElsewhere",
            OpenOutcome::DocumentPurged => "Purged",
        })
    }
}

/// CollabDocumentPurgeOutcome.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PurgeOutcome {
    Purged,
    DocumentOpenElsewhere,
}

impl std::fmt::Display for PurgeOutcome {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            PurgeOutcome::Purged => "Purged",
            PurgeOutcome::DocumentOpenElsewhere => "DocumentOpenElsewhere",
        })
    }
}

/// CollabLineageDeleteOutcome.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineageDeleteOutcome {
    Deleted,
    NotFound,
    Current,
    Purged,
}

impl std::fmt::Display for LineageDeleteOutcome {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            LineageDeleteOutcome::Deleted => "Deleted",
            LineageDeleteOutcome::NotFound => "NotFound",
            LineageDeleteOutcome::Current => "Current",
            LineageDeleteOutcome::Purged => "Purged",
        })
    }
}

/// CollabLineageInfo. `created_at` is None for a lineage that began before
/// the ledger existed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LineageInfo {
    pub lineage: String,
    pub epoch: i64,
    pub format: i32,
    pub created_at: Option<SystemTime>,
    pub current: bool,
}

/// CollabRecordHeader.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordHeader {
    pub sequence: u64,
    pub committed_at: SystemTime,
    pub actor_id: Option<String>,
}

fn empty_doc_id() -> Error {
    Error::argument("The value cannot be an empty string.")
}

fn journal_name(generation: u64, minted_by: u64) -> String {
    format!("journal.{generation}.{minted_by}")
}

fn baseline_name(generation: u64, minted_by: u64) -> String {
    format!("baseline.{generation}.{minted_by}")
}

fn checkpoint_name(generation: u64, through: u64, written_by: u64) -> String {
    format!("checkpoint.{generation}.{through}.{written_by}")
}

fn base_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// File.Exists: true for a file, false for a directory.
fn file_exists(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|m| !m.is_dir())
}

fn dir_exists(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|m| m.is_dir())
}

fn sorted_names(dir: &Path) -> io::Result<Vec<String>> {
    let mut names = Vec::new();
    for entry in fs::read_dir(dir)? {
        names.push(entry?.file_name().to_string_lossy().into_owned());
    }
    names.sort();
    Ok(names)
}

/// Directory.GetFiles(dir, stem + ".*"): files only, and .NET's Win32
/// matching also takes a bare stem.
fn glob_files(dir: &Path, stem: &str) -> io::Result<Vec<String>> {
    let prefix = format!("{stem}.");
    Ok(sorted_names(dir)?
        .into_iter()
        .filter(|name| name == stem || name.starts_with(&prefix))
        .filter(|name| fs::metadata(dir.join(name)).is_ok_and(|m| !m.is_dir()))
        .collect())
}

fn unseeded_manifest() -> Manifest {
    Manifest {
        lineage: "0".repeat(LINEAGE_LENGTH),
        ..Manifest::default()
    }
}

const RDWR_CREATE: Flags = Flags {
    read: true,
    write: true,
    create: true,
    truncate: false,
    append: false,
};

const RDWR: Flags = Flags {
    read: true,
    write: true,
    create: false,
    truncate: false,
    append: false,
};

impl Store {
    /// Refuses a limit the record format cannot carry, so the mistake shows
    /// at start-up rather than as a failed append.
    pub fn new(dir: impl Into<PathBuf>, options: StoreOptions) -> Result<Store, Error> {
        let dir = dir.into();
        if dir.as_os_str().is_empty() {
            return Err(empty_doc_id());
        }
        let limit = if options.max_update_bytes == 0 {
            DEFAULT_MAX_UPDATE_BYTES
        } else {
            options.max_update_bytes
        };
        if !(1..=MAX_UPDATE_LENGTH as i64).contains(&limit) {
            return Err(Error::out_of_range(format!(
                "collab: the update limit must be 1..{MAX_UPDATE_LENGTH} bytes."
            )));
        }
        let sync: SyncJournal = Arc::new(|file: &File| file.sync_all());
        Ok(Store {
            inner: Arc::new(Inner {
                dir,
                max_update_bytes: limit,
                log: options.log,
                now: options.now.unwrap_or_else(|| Arc::new(SystemTime::now)),
                gates: Mutex::new(HashMap::new()),
                sync_journal: Mutex::new(sync),
            }),
        })
    }

    /// The append limit, which the restore gate also reads.
    pub fn max_update_bytes(&self) -> i64 {
        self.inner.max_update_bytes
    }

    #[cfg(test)]
    pub(crate) fn set_sync_journal(
        &self,
        sync: impl Fn(&File) -> io::Result<()> + Send + Sync + 'static,
    ) {
        *self.inner.sync_journal.lock().unwrap() = Arc::new(sync);
    }

    /// Takes the document's fence and reads back everything needed to
    /// rebuild it. A live holder elsewhere is DocumentOpenElsewhere; a
    /// purged document is DocumentPurged. Neither returns a session.
    pub fn open(
        &self,
        ctx: &Context,
        doc_id: &str,
    ) -> Result<(OpenOutcome, Option<Session>), Error> {
        if doc_id.is_empty() {
            return Err(empty_doc_id());
        }
        ctx.err()?;
        let inner = &self.inner;
        let doc_dir = inner.doc_directory(doc_id);
        inner.ensure_directory(&doc_dir)?;
        let hold = match try_hold(&doc_dir.join(LOCK_NAME))? {
            Ok(hold) => hold,
            Err(refusal) => {
                // A disk fault can look like a live holder here, as in C#;
                // the reason is logged so an operator is not left guessing.
                inner.logf(&format!(
                    "collab: \"{doc_id}\" is held elsewhere: {refusal}"
                ));
                return Ok((OpenOutcome::DocumentOpenElsewhere, None));
            }
        };
        // A refused open drops its hold, so the next attempt reports the
        // same failure instead of "held elsewhere".
        match inner.open(self.inner.clone(), doc_id, &doc_dir, hold)? {
            Some(session) => Ok((OpenOutcome::Opened, Some(session))),
            None => Ok((OpenOutcome::DocumentPurged, None)),
        }
    }

    /// Permanently removes one document's journal and blocks future opens.
    /// The marker is made durable before any payload goes, so a failed
    /// cleanup keeps it and a retry finishes.
    pub fn purge(&self, ctx: &Context, doc_id: &str) -> Result<PurgeOutcome, Error> {
        if doc_id.is_empty() {
            return Err(empty_doc_id());
        }
        ctx.err()?;
        let inner = &self.inner;
        // Under the ledger gate, so a history delete cannot write its
        // tombstone after the purge removed the ledger.
        let gate = inner.gate(doc_id);
        let _held = gate.lock().unwrap();
        let doc_dir = inner.doc_directory(doc_id);
        inner.ensure_directory(&doc_dir)?;
        let _hold = match open_file(&doc_dir.join(LOCK_NAME), RDWR_CREATE, true) {
            Ok(hold) => hold,
            Err(err) if is_held_elsewhere(&err) => {
                inner.logf(&format!("collab: \"{doc_id}\" is held elsewhere: {err}"));
                return Ok(PurgeOutcome::DocumentOpenElsewhere);
            }
            Err(err) => return Err(err.into()),
        };
        let marker_flags = Flags {
            write: true,
            create: true,
            ..Flags::default()
        };
        let marker = open_file(&doc_dir.join(PURGE_NAME), marker_flags, true)?;
        marker.sync_all()?;
        drop(marker);
        sync_directory(&doc_dir)?;
        let names = sorted_names(&doc_dir)?;
        // The kept names are found exactly, else ignoring case, as C# does
        // on a case-insensitive volume.
        let lock_entry = kept_entry(&names, LOCK_NAME);
        let purge_entry = kept_entry(&names, PURGE_NAME);
        for name in &names {
            if *name != lock_entry && *name != purge_entry {
                remove_file(&doc_dir.join(name))?;
            }
        }
        sync_directory(&doc_dir)?;
        Ok(PurgeOutcome::Purged)
    }

    /// Reports the purge marker without opening the document.
    pub fn is_purged(&self, ctx: &Context, doc_id: &str) -> Result<bool, Error> {
        if doc_id.is_empty() {
            return Err(empty_doc_id());
        }
        ctx.err()?;
        Ok(file_exists(
            &self.inner.doc_directory(doc_id).join(PURGE_NAME),
        ))
    }

    /// Every lineage oldest first; only the live one is current.
    pub fn list_lineages(&self, ctx: &Context, doc_id: &str) -> Result<Vec<LineageInfo>, Error> {
        if doc_id.is_empty() {
            return Err(empty_doc_id());
        }
        ctx.err()?;
        let (lineages, current) = self
            .inner
            .resolve_lineages(&self.inner.doc_directory(doc_id), doc_id)?;
        Ok(lineages
            .into_iter()
            .map(|entry| LineageInfo {
                current: current.as_ref().is_some_and(|c| {
                    entry.generation == c.generation && entry.generation_fence == c.generation_fence
                }),
                lineage: entry.lineage,
                epoch: entry.epoch,
                format: entry.format,
                created_at: entry.created_at,
            })
            .collect())
    }

    /// A lineage's baseline frames; None for a lineage that is not listed
    /// (or was deleted while this read ran).
    pub fn read_baseline(
        &self,
        ctx: &Context,
        doc_id: &str,
        lineage: &str,
    ) -> Result<Option<Vec<Vec<u8>>>, Error> {
        if doc_id.is_empty() {
            return Err(empty_doc_id());
        }
        ctx.err()?;
        let inner = &self.inner;
        let doc_dir = inner.doc_directory(doc_id);
        let Some(entry) = inner.find_lineage(&doc_dir, doc_id, lineage)? else {
            return Ok(None);
        };
        let manifest = Manifest {
            generation: entry.generation,
            generation_fence: entry.generation_fence,
            ..unseeded_manifest()
        };
        match read_baseline(&doc_dir, &manifest, doc_id) {
            Ok(frames) => Ok(Some(frames)),
            Err(err) => {
                if err.is_missing_file()
                    && let Ok(None) = inner.find_lineage(&doc_dir, doc_id, lineage)
                {
                    return Ok(None);
                }
                Err(err)
            }
        }
    }

    /// A lineage's records up to `through`, without any lock: a live
    /// session may keep appending. It stops at a torn tail and never writes.
    /// An error is yielded once, last.
    pub fn read_records(
        &self,
        ctx: &Context,
        doc_id: &str,
        lineage: &str,
        through: u64,
    ) -> Records {
        Records {
            inner: self.inner.clone(),
            ctx: ctx.clone(),
            doc_id: doc_id.to_owned(),
            lineage: lineage.to_owned(),
            through,
            state: RecordsState::Start,
        }
    }

    /// Each record's sequence, time and actor.
    pub fn read_headers(
        &self,
        ctx: &Context,
        doc_id: &str,
        lineage: &str,
    ) -> impl Iterator<Item = Result<RecordHeader, Error>> + use<> {
        self.read_records(ctx, doc_id, lineage, u64::MAX).map(|r| {
            r.map(|record| RecordHeader {
                sequence: record.sequence,
                committed_at: record.committed_at,
                actor_id: record.actor_id,
            })
        })
    }

    /// Removes one superseded lineage's journal, baseline and checkpoints.
    /// The live lineage is refused as Current.
    pub fn delete_lineage(
        &self,
        ctx: &Context,
        doc_id: &str,
        lineage: &str,
    ) -> Result<LineageDeleteOutcome, Error> {
        if doc_id.is_empty() {
            return Err(empty_doc_id());
        }
        ctx.err()?;
        let inner = &self.inner;
        let gate = inner.gate(doc_id);
        let _held = gate.lock().unwrap();
        let doc_dir = inner.doc_directory(doc_id);
        if file_exists(&doc_dir.join(PURGE_NAME)) {
            return Ok(LineageDeleteOutcome::Purged);
        }
        let (lineages, live) = inner.resolve_lineages(&doc_dir, doc_id)?;
        // Without a seeded manifest nothing says which generation is live.
        let Some(live) = live else {
            return Ok(LineageDeleteOutcome::NotFound);
        };
        if live.lineage == lineage {
            return Ok(LineageDeleteOutcome::Current);
        }
        let Some(target) = lineages.into_iter().find(|e| e.lineage == lineage) else {
            return Ok(LineageDeleteOutcome::NotFound);
        };
        // Generation numbers are never reused by two publications.
        if target.generation == live.generation {
            return Ok(LineageDeleteOutcome::Current);
        }
        // The tombstone goes first: a crash after it leaves unlisted files,
        // never a listed lineage whose files are gone.
        let tombstone = LineageEntry {
            kind: LineageEntryKind::DELETED,
            ..target.clone()
        };
        append_ledger_entry(&doc_dir, &tombstone)?;
        remove_file(&doc_dir.join(journal_name(target.generation, target.generation_fence)))?;
        remove_file(&doc_dir.join(baseline_name(target.generation, target.generation_fence)))?;
        let stem = format!("checkpoint.{}", target.generation);
        let prefix = format!("{stem}.");
        for name in glob_files(&doc_dir, &stem)? {
            // The glob also takes a bare stem; the exact prefix keeps the
            // delete to this generation's checkpoints.
            if name.starts_with(&prefix) {
                remove_file(&doc_dir.join(&name))?;
            }
        }
        Ok(LineageDeleteOutcome::Deleted)
    }
}

/// Refuses on any I/O error but a missing path, a long name and a
/// permission fault, which C# lets escape (UnauthorizedAccessException is
/// not an IOException there). The inner Err is the refusal to log.
fn try_hold(path: &Path) -> Result<Result<File, String>, Error> {
    match open_file(path, RDWR_CREATE, true) {
        Ok(file) => Ok(Ok(file)),
        Err(err)
            if matches!(
                err.kind(),
                io::ErrorKind::NotFound
                    | io::ErrorKind::NotADirectory
                    | io::ErrorKind::InvalidFilename
                    | io::ErrorKind::PermissionDenied
            ) =>
        {
            Err(err.into())
        }
        Err(err) => Ok(Err(err.to_string())),
    }
}

fn kept_entry(names: &[String], name: &str) -> String {
    if names.iter().any(|n| n == name) {
        return name.to_owned();
    }
    let fold = |s: &str| s.chars().flat_map(char::to_lowercase).collect::<String>();
    names
        .iter()
        .find(|n| fold(n) == fold(name))
        .cloned()
        .unwrap_or_else(|| name.to_owned())
}

fn open_manifest(path: &Path) -> io::Result<File> {
    let file = open_file(path, RDWR_CREATE, false)?;
    if file.metadata()?.len() < MANIFEST_SIZE as u64 {
        file.set_len(MANIFEST_SIZE as u64)?;
    }
    Ok(file)
}

/// Re-reads the manifest from its path, never from a handle: a replaced
/// manifest leaves an old handle on an inode nobody writes.
fn require_fence(doc_dir: &Path, doc_id: &str, held: &Manifest) -> Result<(), Error> {
    if file_exists(&doc_dir.join(PURGE_NAME)) {
        return Err(Error::FenceLost);
    }
    match read_manifest(&doc_dir.join(MANIFEST_FILE_NAME), doc_id)? {
        Some(on_disk) if on_disk.fence == held.fence && on_disk.generation == held.generation => {
            Ok(())
        }
        _ => Err(Error::FenceLost),
    }
}

fn read_baseline(doc_dir: &Path, manifest: &Manifest, doc_id: &str) -> Result<Vec<Vec<u8>>, Error> {
    let (content, _) = read_sealed(
        &doc_dir.join(baseline_name(
            manifest.generation,
            manifest.generation_fence,
        )),
        BASELINE_MAGIC,
        doc_id,
    )?;
    decode_frames(&content).ok_or_else(|| {
        Error::invalid_data(format!(
            "collab: the baseline for \"{doc_id}\" is not a valid frame section."
        ))
    })
}

fn read_checkpoint(doc_dir: &Path, manifest: &Manifest, doc_id: &str) -> Result<Checkpoint, Error> {
    let (state, through) = read_sealed(
        &doc_dir.join(checkpoint_name(
            manifest.generation,
            manifest.checkpoint_through,
            manifest.checkpoint_fence,
        )),
        CHECKPOINT_MAGIC,
        doc_id,
    )?;
    if through != manifest.checkpoint_through {
        return Err(Error::invalid_data(format!(
            "collab: the checkpoint file for \"{doc_id}\" carries sequence {through}, but the manifest names {}.",
            manifest.checkpoint_through
        )));
    }
    Ok(Checkpoint { through, state })
}

struct IndexEntry {
    sequence: u64,
    digest: Vec<u8>,
}

#[derive(Default)]
struct JournalIndex {
    by_id: HashMap<String, IndexEntry>,
    durable_through: u64,
    // The byte offset before which every record is indexed.
    scanned_through: u64,
}

impl JournalIndex {
    fn clear(&mut self) {
        *self = JournalIndex::default();
    }
}

/// Walks every record written since the last scan. Corruption fails: no
/// linear reader can find the record after an invalid one. A torn tail is
/// cut only when `confirm_fence` is set (the paths about to write), and only
/// after it says this session still holds the fence: the cut is a bulk
/// delete decided from bytes read a moment ago.
fn scan_forward(
    journal: &File,
    index: &mut JournalIndex,
    doc_id: &str,
    confirm_fence: Option<&dyn Fn() -> Result<(), Error>>,
) -> Result<Vec<Record>, Error> {
    let length = journal.metadata()?.len();
    if length < index.scanned_through {
        return Err(Error::invalid_data(format!(
            "collab: the journal for \"{doc_id}\" shrank from {} to {length} bytes underneath this session.",
            index.scanned_through
        )));
    }
    if length == index.scanned_through {
        return Ok(Vec::new());
    }
    let mut pending = vec![0u8; (length - index.scanned_through) as usize];
    journal.read_exact_at(&mut pending, index.scanned_through)?;
    let mut records = Vec::new();
    let mut offset = 0;
    while offset < pending.len() {
        let decoded = decode_record(&pending[offset..]);
        if decoded.status == Status::Incomplete {
            if let Some(confirm_fence) = confirm_fence {
                confirm_fence()?;
                journal.set_len(index.scanned_through + offset as u64)?;
                journal.sync_all()?;
            }
            break;
        }
        let Some(record) = decoded.record.filter(|_| decoded.status == Status::Ok) else {
            return Err(Error::invalid_data(format!(
                "collab: the journal for \"{doc_id}\" is corrupt at byte {}: {}.",
                index.scanned_through + offset as u64,
                decoded.message
            )));
        };
        if record.sequence != index.durable_through + 1 {
            return Err(Error::invalid_data(format!(
                "collab: the journal for \"{doc_id}\" jumps from sequence {} to {}.",
                index.durable_through, record.sequence
            )));
        }
        if index.by_id.contains_key(&record.operation_id) {
            return Err(Error::invalid_data(format!(
                "collab: the journal for \"{doc_id}\" commits the operation id {} twice.",
                record.operation_id
            )));
        }
        index.by_id.insert(
            record.operation_id.clone(),
            IndexEntry {
                sequence: record.sequence,
                digest: record.digest.clone(),
            },
        );
        index.durable_through = record.sequence;
        records.push(record);
        offset += decoded.consumed;
    }
    index.scanned_through += offset as u64;
    Ok(records)
}

/// Appends one entry; the caller holds the ledger gate. A torn tail is
/// padded back onto the entry grid in the same write.
fn append_ledger_entry(doc_dir: &Path, entry: &LineageEntry) -> io::Result<()> {
    let flags = Flags {
        create: true,
        append: true,
        ..Flags::default()
    };
    let mut file = open_file(&doc_dir.join(LEDGER_FILE_NAME), flags, false)?;
    let size = file.metadata()?.len();
    let created = size == 0;
    let padding =
        (LEDGER_ENTRY_SIZE as u64 - size % LEDGER_ENTRY_SIZE as u64) % LEDGER_ENTRY_SIZE as u64;
    let mut bytes = vec![0u8; padding as usize];
    bytes.extend_from_slice(&encode_lineage_entry(entry));
    file.write_all(&bytes)?;
    file.sync_all()?;
    drop(file);
    if created {
        sync_directory(doc_dir)?;
    }
    Ok(())
}

impl Inner {
    fn logf(&self, line: &str) {
        if let Some(log) = &self.log {
            log(line);
        }
    }

    fn gate(&self, doc_id: &str) -> Arc<Mutex<()>> {
        self.gates
            .lock()
            .unwrap()
            .entry(doc_id.to_owned())
            .or_default()
            .clone()
    }

    fn doc_directory(&self, doc_id: &str) -> PathBuf {
        self.dir
            .join(format!("{}{JOURNAL_SUFFIX}", doc_key(doc_id)))
    }

    fn ensure_directory(&self, doc_dir: &Path) -> io::Result<()> {
        if dir_exists(doc_dir) {
            return Ok(());
        }
        private_dir_builder().recursive(true).create(&self.dir)?;
        match private_dir_builder().create(doc_dir) {
            Err(err) if err.kind() != io::ErrorKind::AlreadyExists => return Err(err),
            _ => {}
        }
        sync_directory(&self.dir)
    }

    fn open(
        &self,
        this: Arc<Inner>,
        doc_id: &str,
        doc_dir: &Path,
        hold: File,
    ) -> Result<Option<Session>, Error> {
        if file_exists(&doc_dir.join(PURGE_NAME)) {
            return Ok(None);
        }
        let manifest_path = doc_dir.join(MANIFEST_FILE_NAME);
        let stored = read_manifest(&manifest_path, doc_id)?;
        if stored.is_none() && !glob_files(doc_dir, "journal")?.is_empty() {
            return Err(Error::invalid_data(format!(
                "collab: \"{doc_id}\" has journal files but no manifest naming their lineage; refusing to treat it as an unseeded document."
            )));
        }
        let current = stored.clone().unwrap_or_else(unseeded_manifest);
        let manifest_file = open_manifest(&manifest_path)?;

        // The fence is taken before recovery touches a byte, so a holder
        // still alive is refused by its own next fence check.
        let mut fenced = current;
        fenced.write_counter += 1;
        fenced.fence += 1;
        publish(&manifest_file, &fenced)?;
        if stored.is_none() {
            // The manifest's directory entry is new; later publications
            // write in place.
            sync_directory(doc_dir)?;
        }
        if !fenced.seeded {
            fenced = self.import_working_set(doc_dir, &manifest_file, doc_id, fenced)?;
        }
        self.record_lineage(doc_dir, doc_id, &fenced, None);

        let mut index = JournalIndex::default();
        let mut records = Vec::new();
        let mut baseline = Vec::new();
        let mut checkpoint = None;
        let mut journal = None;
        if fenced.seeded {
            baseline = read_baseline(doc_dir, &fenced, doc_id)?;
            let journal_path =
                doc_dir.join(journal_name(fenced.generation, fenced.generation_fence));
            // Open, never create: a missing journal must fail, not read as
            // a fresh lineage that would reassign taken sequences.
            let file = match open_file(&journal_path, RDWR, false) {
                Err(err) if err.kind() == io::ErrorKind::NotFound => {
                    let message = if dir_exists(doc_dir) {
                        format!(
                            "collab: \"{doc_id}\" names {}, which is not there.",
                            base_name(&journal_path)
                        )
                    } else {
                        format!(
                            "collab: the journal directory for \"{doc_id}\" is gone, so {} cannot be read.",
                            base_name(&journal_path)
                        )
                    };
                    return Err(Error::InvalidData {
                        message,
                        source: Some(err),
                    });
                }
                other => other?,
            };
            let confirm = || require_fence(doc_dir, doc_id, &fenced);
            records = scan_forward(&file, &mut index, doc_id, Some(&confirm))?;
            journal = Some(file);
            if fenced.checkpoint_through > index.durable_through {
                return Err(Error::invalid_data(format!(
                    "collab: the manifest for \"{doc_id}\" names checkpoint {} but the journal only reaches {}.",
                    fenced.checkpoint_through, index.durable_through
                )));
            }
            if fenced.checkpoint_through > 0 {
                checkpoint = Some(read_checkpoint(doc_dir, &fenced, doc_id)?);
            }
        }
        let open_result = OpenResult {
            head: fenced.seeded.then(|| Head {
                format: fenced.format,
                epoch: fenced.epoch,
                lineage: fenced.lineage.clone(),
                durable_through: index.durable_through,
            }),
            baseline,
            checkpoint,
            tail: records
                .into_iter()
                .filter(|r| r.sequence > fenced.checkpoint_through)
                .collect(),
        };
        Ok(Some(Session {
            store: this,
            doc_id: doc_id.to_owned(),
            doc_dir: doc_dir.to_owned(),
            hold: Some(hold),
            manifest_file: Some(manifest_file),
            journal,
            manifest: fenced,
            index,
            open_result,
            closed: false,
            faulted: false,
        }))
    }

    /// Adopts the working-set LocalStore's whole-document file, at the
    /// unsuffixed key beside the journal directory, as the sequence-zero
    /// baseline, keeping its format, epoch, lineage and frame bytes. The
    /// manifest publication is the whole migration, so a crash before it
    /// changes nothing and the old file is left in place. A file that does
    /// not decode fails the open: treating it as absent would seed a blank
    /// page over the user's content.
    fn import_working_set(
        &self,
        doc_dir: &Path,
        manifest_file: &File,
        doc_id: &str,
        fenced: Manifest,
    ) -> Result<Manifest, Error> {
        let document = match read_shared(&self.dir.join(doc_key(doc_id))) {
            Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(fenced),
            other => other?,
        };
        let (tag, frame_section) = decode_document(&document).map_err(|reason| {
            Error::invalid_data(format!(
                "collab: the working set for \"{doc_id}\" is unreadable ({reason}), so it cannot be imported; refusing to open the document as a new, empty one."
            ))
        })?;
        let generation = fenced.generation + 1;
        // The minting fence is in both names, so a retry after a crash
        // writes new names instead of rewriting the abandoned attempt's.
        let minted_by = fenced.fence;
        write_sealed(
            &doc_dir.join(baseline_name(generation, minted_by)),
            BASELINE_MAGIC,
            0,
            &frame_section,
        )?;
        let journal = open_file(
            &doc_dir.join(journal_name(generation, minted_by)),
            RDWR_CREATE,
            false,
        )?;
        require_fence(doc_dir, doc_id, &fenced)?;
        journal.set_len(0)?;
        journal.sync_all()?;
        drop(journal);
        sync_directory(doc_dir)?;
        let published = Manifest {
            write_counter: fenced.write_counter + 1,
            generation,
            generation_fence: minted_by,
            checkpoint_fence: 0,
            seeded: true,
            format: tag.format,
            epoch: tag.epoch,
            lineage: tag.lineage.clone(),
            checkpoint_through: 0,
            ..fenced.clone()
        };
        // Re-checked right before the slot write: sealing the old document
        // takes time, and a new holder may have taken the document meanwhile.
        require_fence(doc_dir, doc_id, &fenced)?;
        publish(manifest_file, &published)?;
        self.logf(&format!(
            "collab: imported the working set for \"{doc_id}\" as the baseline of lineage {} at epoch {}; the old file is left in place.",
            tag.lineage, tag.epoch
        ));
        Ok(published)
    }

    /// Every listed lineage, oldest first, with no lock and creating
    /// nothing, and the manifest when it is seeded.
    fn resolve_lineages(
        &self,
        doc_dir: &Path,
        doc_id: &str,
    ) -> Result<(Vec<LineageEntry>, Option<Manifest>), Error> {
        if !dir_exists(doc_dir) || file_exists(&doc_dir.join(PURGE_NAME)) {
            return Ok((Vec::new(), None));
        }
        let current =
            read_manifest(&doc_dir.join(MANIFEST_FILE_NAME), doc_id)?.filter(|m| m.seeded);
        let warn = |line: &str| self.logf(line);
        let entries = read_ledger(&doc_dir.join(LEDGER_FILE_NAME), Some(&warn))?;
        let mut deleted = HashSet::new();
        let mut published = Vec::new();
        for entry in entries {
            if entry.kind == LineageEntryKind::DELETED {
                deleted.insert((entry.generation, entry.generation_fence));
            } else if entry.kind == LineageEntryKind::PUBLISHED && entry.generation != 0 {
                published.push(entry);
            }
        }
        // A document not opened since the ledger shipped has no entry for
        // its current generation; it is added here, in memory only.
        if let Some(current) = &current
            && !published.iter().any(|e| {
                e.generation == current.generation && e.generation_fence == current.generation_fence
            })
        {
            published.push(LineageEntry {
                kind: LineageEntryKind::PUBLISHED,
                generation: current.generation,
                generation_fence: current.generation_fence,
                lineage: current.lineage.clone(),
                epoch: current.epoch,
                format: current.format,
                created_at: None,
            });
        }
        // The newest generation wins a shared lineage, and older ones stay
        // hidden even after the newest is deleted. `order` keeps first-seen
        // order, as C#'s Dictionary does; the sort below is stable, so
        // lineages that share a generation keep it.
        let mut newest: HashMap<String, LineageEntry> = HashMap::new();
        let mut order = Vec::new();
        for entry in published {
            match newest.get(&entry.lineage) {
                None => {
                    order.push(entry.lineage.clone());
                    newest.insert(entry.lineage.clone(), entry);
                }
                Some(seen) if entry.generation >= seen.generation => {
                    newest.insert(entry.lineage.clone(), entry);
                }
                Some(_) => {}
            }
        }
        let mut lineages: Vec<LineageEntry> = order
            .into_iter()
            .filter_map(|lineage| newest.remove(&lineage))
            .filter(|e| !deleted.contains(&(e.generation, e.generation_fence)))
            .collect();
        lineages.sort_by_key(|e| e.generation);
        Ok((lineages, current))
    }

    fn find_lineage(
        &self,
        doc_dir: &Path,
        doc_id: &str,
        lineage: &str,
    ) -> Result<Option<LineageEntry>, Error> {
        let (lineages, _) = self.resolve_lineages(doc_dir, doc_id)?;
        Ok(lineages.into_iter().find(|e| e.lineage == lineage))
    }

    /// None when the lineage was deleted meanwhile; a journal missing while
    /// its lineage is still listed is corruption.
    fn open_history_journal(
        &self,
        doc_dir: &Path,
        doc_id: &str,
        lineage: &str,
        entry: &LineageEntry,
    ) -> Result<Option<File>, Error> {
        let path = doc_dir.join(journal_name(entry.generation, entry.generation_fence));
        match open_file(&path, READ_ONLY, false) {
            Ok(file) => Ok(Some(file)),
            Err(err) if err.kind() == io::ErrorKind::NotFound => {
                if self.find_lineage(doc_dir, doc_id, lineage)?.is_none() {
                    return Ok(None);
                }
                Err(Error::InvalidData {
                    message: format!(
                        "collab: \"{doc_id}\" lists lineage {lineage}, but {} is not there.",
                        base_name(&path)
                    ),
                    source: Some(err),
                })
            }
            Err(err) => Err(err.into()),
        }
    }

    /// Appends a published entry unless the ledger has one. Best effort:
    /// history is not worth failing an open or a reset over.
    fn record_lineage(
        &self,
        doc_dir: &Path,
        doc_id: &str,
        published: &Manifest,
        created_at: Option<SystemTime>,
    ) {
        if !published.seeded || published.generation == 0 {
            return;
        }
        let gate = self.gate(doc_id);
        let _held = gate.lock().unwrap();
        let warn = |line: &str| self.logf(line);
        let result =
            read_ledger(&doc_dir.join(LEDGER_FILE_NAME), Some(&warn)).and_then(|entries| {
                if entries.iter().any(|e| {
                    e.kind == LineageEntryKind::PUBLISHED
                        && e.generation == published.generation
                        && e.generation_fence == published.generation_fence
                }) {
                    return Ok(());
                }
                append_ledger_entry(
                    doc_dir,
                    &LineageEntry {
                        kind: LineageEntryKind::PUBLISHED,
                        generation: published.generation,
                        generation_fence: published.generation_fence,
                        lineage: published.lineage.clone(),
                        epoch: published.epoch,
                        format: published.format,
                        created_at,
                    },
                )
            });
        if let Err(err) = result {
            self.logf(&format!(
                "collab: could not record lineage {} of \"{doc_id}\" in {LEDGER_FILE_NAME}: {err}",
                published.lineage
            ));
        }
    }
}

enum RecordsState {
    Start,
    Reading(HistoryReader),
    Done,
}

/// The iterator [`Store::read_records`] returns.
pub struct Records {
    inner: Arc<Inner>,
    ctx: Context,
    doc_id: String,
    lineage: String,
    through: u64,
    state: RecordsState,
}

impl Records {
    fn start(&mut self) -> Result<Option<HistoryReader>, Error> {
        if self.doc_id.is_empty() {
            return Err(empty_doc_id());
        }
        self.ctx.err()?;
        let doc_dir = self.inner.doc_directory(&self.doc_id);
        if self.through == 0 {
            return Ok(None);
        }
        let Some(entry) = self
            .inner
            .find_lineage(&doc_dir, &self.doc_id, &self.lineage)?
        else {
            return Ok(None);
        };
        let file =
            self.inner
                .open_history_journal(&doc_dir, &self.doc_id, &self.lineage, &entry)?;
        Ok(file.map(|file| HistoryReader {
            file,
            doc_id: self.doc_id.clone(),
            buffer: vec![0; 64 * 1024],
            start: 0,
            end: 0,
            offset: 0,
            sequence: 0,
            at_end: false,
        }))
    }
}

impl Iterator for Records {
    type Item = Result<Record, Error>;

    fn next(&mut self) -> Option<Self::Item> {
        if let RecordsState::Start = self.state {
            match self.start() {
                Ok(Some(reader)) => self.state = RecordsState::Reading(reader),
                Ok(None) => self.state = RecordsState::Done,
                Err(err) => {
                    self.state = RecordsState::Done;
                    return Some(Err(err));
                }
            }
        }
        let RecordsState::Reading(reader) = &mut self.state else {
            return None;
        };
        match reader.next(&self.ctx) {
            Ok(Some(record)) if record.sequence <= self.through => Some(Ok(record)),
            Ok(_) => {
                self.state = RecordsState::Done;
                None
            }
            Err(err) => {
                self.state = RecordsState::Done;
                Some(Err(err))
            }
        }
    }
}

/// Decodes a journal one record at a time for history reads.
struct HistoryReader {
    file: File,
    doc_id: String,
    buffer: Vec<u8>,
    start: usize,
    end: usize,
    offset: u64,
    sequence: u64,
    at_end: bool,
}

impl HistoryReader {
    fn next(&mut self, ctx: &Context) -> Result<Option<Record>, Error> {
        loop {
            let decoded = decode_record(&self.buffer[self.start..self.end]);
            match decoded.status {
                Status::Ok => {
                    let record = decoded.record.expect("an Ok record");
                    if record.sequence != self.sequence + 1 {
                        return Err(Error::invalid_data(format!(
                            "collab: the journal for \"{}\" jumps from sequence {} to {}.",
                            self.doc_id, self.sequence, record.sequence
                        )));
                    }
                    self.sequence = record.sequence;
                    self.start += decoded.consumed;
                    self.offset += decoded.consumed as u64;
                    return Ok(Some(record));
                }
                Status::Invalid => {
                    return Err(Error::invalid_data(format!(
                        "collab: the journal for \"{}\" is corrupt at byte {}: {}.",
                        self.doc_id, self.offset, decoded.message
                    )));
                }
                Status::Incomplete => {}
            }
            if self.at_end {
                return Ok(None);
            }
            ctx.err()?;
            if self.start > 0 {
                self.buffer.copy_within(self.start..self.end, 0);
                self.end -= self.start;
                self.start = 0;
            }
            // A record longer than the buffer stays incomplete until it fits.
            if self.end == self.buffer.len() {
                let grown = self.buffer.len() * 2;
                self.buffer.resize(grown, 0);
            }
            match self.file.read(&mut self.buffer[self.end..]) {
                Ok(0) => self.at_end = true,
                Ok(read) => self.end += read,
                Err(err) if err.kind() == io::ErrorKind::Interrupted => {}
                Err(err) => return Err(err.into()),
            }
        }
    }
}

/// An exclusive, fenced handle on one document's journal
/// (ICollabOperationSession). The caller serialises its use. Once another
/// process takes the fence, every method fails with [`Error::FenceLost`].
pub struct Session {
    store: Arc<Inner>,
    doc_id: String,
    doc_dir: PathBuf,
    hold: Option<File>,
    manifest_file: Option<File>,
    journal: Option<File>,
    manifest: Manifest,
    index: JournalIndex,
    open_result: OpenResult,
    closed: bool,
    faulted: bool,
}

impl Session {
    /// The document as it stood when the session opened.
    pub fn open_result(&self) -> &OpenResult {
        &self.open_result
    }

    /// Releases the fence's lock. The lock FILE stays: a session that lost
    /// the fence would otherwise delete a hold that is somebody else's.
    pub fn close(&mut self) {
        if self.closed {
            return;
        }
        self.closed = true;
        self.journal = None;
        self.manifest_file = None;
        self.hold = None;
    }

    fn require_fence(&self) -> Result<(), Error> {
        if self.closed {
            return Err(Error::Closed);
        }
        if self.faulted {
            return Err(Error::Faulted(format!(
                "collab: the journal for \"{}\" could not be flushed and this session can no longer say what is durable; reopen the document",
                self.doc_id
            )));
        }
        require_fence(&self.doc_dir, &self.doc_id, &self.manifest)
    }

    /// Reads the durable bytes, never a memo of what this session appended:
    /// after an append with an unknown outcome they differ.
    fn refresh(&mut self, repair: bool) -> Result<(), Error> {
        let Some(journal) = self.journal.take() else {
            return Ok(());
        };
        let mut index = std::mem::take(&mut self.index);
        let result = {
            let confirm = || self.require_fence();
            let confirm: Option<&dyn Fn() -> Result<(), Error>> =
                if repair { Some(&confirm) } else { None };
            scan_forward(&journal, &mut index, &self.doc_id, confirm)
        };
        self.index = index;
        self.journal = Some(journal);
        result.map(|_| ())
    }

    fn lookup(&self, operation_id: &str, digest: &[u8]) -> Option<(u64, bool)> {
        self.index
            .by_id
            .get(operation_id)
            .map(|e| (e.sequence, e.digest == digest))
    }

    /// What this lineage holds for an operation id, from the durable bytes,
    /// without writing anything.
    pub fn find_committed(
        &mut self,
        ctx: &Context,
        operation_id: &str,
        digest: &[u8],
    ) -> Result<Lookup, Error> {
        if operation_id.is_empty() {
            return Err(empty_doc_id());
        }
        ctx.err()?;
        self.require_fence()?;
        self.refresh(false)?;
        Ok(match self.lookup(operation_id, digest) {
            None => Lookup {
                outcome: LookupOutcome::NotCommitted,
                sequence: 0,
            },
            Some((sequence, true)) => Lookup {
                outcome: LookupOutcome::Duplicate,
                sequence,
            },
            Some((sequence, false)) => Lookup {
                outcome: LookupOutcome::Conflict,
                sequence,
            },
        })
    }

    /// Commits one operation at the next sequence, durable on return, or
    /// reports that its id is already committed.
    pub fn append(&mut self, ctx: &Context, candidate: &Candidate) -> Result<AppendResult, Error> {
        // Checked once: the write and its flush are deliberately uncancellable.
        ctx.err()?;
        self.require_fence()?;
        self.refresh(true)?;
        if let Some((sequence, same)) = self.lookup(&candidate.operation_id, &candidate.digest) {
            return Ok(AppendResult {
                outcome: if same {
                    AppendOutcome::Duplicate
                } else {
                    AppendOutcome::Conflict
                },
                sequence,
            });
        }
        if !self.manifest.seeded || self.journal.is_none() {
            return Err(Error::InvalidOperation(format!(
                "collab: \"{}\" was never seeded; reset it first.",
                self.doc_id
            )));
        }
        if candidate.update.len() as i64 > self.store.max_update_bytes {
            return Err(Error::out_of_range(format!(
                "collab: the update exceeds the configured {}-byte limit.",
                self.store.max_update_bytes
            )));
        }
        let sequence = self.index.durable_through + 1;
        let encoded = encode_record(&Record {
            operation_id: candidate.operation_id.clone(),
            sequence,
            committed_at: (self.store.now)(),
            actor_id: candidate.actor_id.clone(),
            source: candidate.source,
            update: candidate.update.clone(),
            digest: candidate.digest.clone(),
        })?;
        let journal = self.journal.as_ref().expect("checked above");
        let length_before = journal.metadata()?.len();
        let sync_journal = self.store.sync_journal.lock().unwrap().clone();
        let written = journal
            .write_all_at(&encoded, length_before)
            .and_then(|()| sync_journal(journal));
        if let Err(err) = written {
            // After a failed fsync Linux marks the pages clean, so the retry
            // would read the record back and be told Duplicate for bytes no
            // disk holds. Nothing was acknowledged, so undo it.
            self.roll_back(length_before);
            return Err(err.into());
        }
        // Again after the flush: the check above and the write are not one step.
        self.require_fence()?;
        self.index.by_id.insert(
            candidate.operation_id.clone(),
            IndexEntry {
                sequence,
                digest: candidate.digest.clone(),
            },
        );
        self.index.durable_through = sequence;
        self.index.scanned_through = length_before + encoded.len() as u64;
        Ok(AppendResult {
            outcome: AppendOutcome::Committed,
            sequence,
        })
    }

    /// Undoes a failed append, after re-checking the fence: if it moved, the
    /// cut would delete records the new holder acknowledged. When it cannot
    /// undo, the session stops answering.
    fn roll_back(&mut self, length: u64) {
        let journal = self.journal.as_ref().expect("an append has a journal");
        let undo = || -> Result<(), Error> {
            self.require_fence()?;
            journal.set_len(length)?;
            journal.sync_all()?;
            Ok(())
        };
        if undo().is_err() {
            self.faulted = true;
        }
    }

    fn republish(&mut self, mut next: Manifest) -> Result<(), Error> {
        self.require_fence()?;
        next.write_counter = self.manifest.write_counter + 1;
        publish(self.manifest_file.as_ref().expect("an open session"), &next)?;
        self.manifest = next;
        Ok(())
    }

    /// Publishes a checkpoint at a committed sequence at or above the
    /// published one; the published one again is a no-op. History stays.
    pub fn write_checkpoint(
        &mut self,
        ctx: &Context,
        checkpoint: &Checkpoint,
    ) -> Result<(), Error> {
        ctx.err()?;
        self.require_fence()?;
        self.refresh(false)?;
        if checkpoint.through == 0
            || checkpoint.through > self.index.durable_through
            || checkpoint.through < self.manifest.checkpoint_through
        {
            return Err(Error::out_of_range(
                "a checkpoint must name a committed sequence at or above the published one",
            ));
        }
        if checkpoint.through == self.manifest.checkpoint_through {
            return Ok(());
        }
        // The writing fence is in the name, so a stalled session cannot
        // overwrite the checkpoint a new holder published.
        let name = checkpoint_name(
            self.manifest.generation,
            checkpoint.through,
            self.manifest.fence,
        );
        write_sealed(
            &self.doc_dir.join(&name),
            CHECKPOINT_MAGIC,
            checkpoint.through,
            &checkpoint.state,
        )?;
        sync_directory(&self.doc_dir)?;
        let next = Manifest {
            checkpoint_through: checkpoint.through,
            checkpoint_fence: self.manifest.fence,
            ..self.manifest.clone()
        };
        self.republish(next)?;
        // Only after the publication, and only names ending in this
        // session's fence: the glob covers every fence, and another holder's
        // checkpoint may be live. Superseded generations are history and are
        // never swept here.
        let mine = format!(".{}", self.manifest.fence);
        let Ok(stale) = glob_files(
            &self.doc_dir,
            &format!("checkpoint.{}", self.manifest.generation),
        ) else {
            return Ok(());
        };
        for other in stale {
            if other != name
                && other.ends_with(&mine)
                && let Err(err) = remove_file(&self.doc_dir.join(&other))
            {
                self.store.logf(&format!(
                    "collab: could not remove the superseded {other} for \"{}\": {err}",
                    self.doc_id
                ));
            }
        }
        Ok(())
    }

    /// Replaces the document with a new epoch, lineage and baseline; it is
    /// also how an unseeded document is seeded. Every name it writes carries
    /// the minting fence, which is what makes it safe: a stalled session
    /// writes names nothing references, and its publication then fails on
    /// the fence.
    pub fn reset(&mut self, ctx: &Context, reset: &Reset) -> Result<Head, Error> {
        ctx.err()?;
        self.require_fence()?;
        self.store
            .record_lineage(&self.doc_dir, &self.doc_id, &self.manifest, None);
        if !is_lineage(&reset.lineage) {
            return Err(Error::argument(format!(
                "collab: the lineage {} is not 32 lowercase-hex characters.",
                reset.lineage
            )));
        }
        if reset.format < 1 {
            return Err(Error::argument(format!(
                "collab: the format {} is not a schema version.",
                reset.format
            )));
        }
        if self.manifest.seeded && reset.epoch <= self.manifest.epoch {
            return Err(Error::out_of_range(format!(
                "a reset must raise the epoch above {}",
                self.manifest.epoch
            )));
        }
        let generation = self.manifest.generation + 1;
        let minted_by = self.manifest.fence;
        let mut frames = Vec::new();
        for frame in &reset.baseline {
            if frame.is_empty() {
                return Err(Error::argument(
                    "collab: baseline frames must not be empty.",
                ));
            }
            append_frame(&mut frames, frame);
        }
        write_sealed(
            &self.doc_dir.join(baseline_name(generation, minted_by)),
            BASELINE_MAGIC,
            0,
            &frames,
        )?;
        // Opened before the publication and swapped in only after everything
        // that can fail: a session left on the old index would answer
        // Duplicate for ids of a lineage that can never be replayed.
        let swapped = open_file(
            &self.doc_dir.join(journal_name(generation, minted_by)),
            RDWR_CREATE,
            false,
        )?;
        self.require_fence()?;
        swapped.set_len(0)?;
        swapped.sync_all()?;
        sync_directory(&self.doc_dir)?;
        let next = Manifest {
            generation,
            generation_fence: minted_by,
            checkpoint_fence: 0,
            seeded: true,
            format: reset.format,
            epoch: reset.epoch,
            lineage: reset.lineage.clone(),
            checkpoint_through: 0,
            ..self.manifest.clone()
        };
        self.republish(next)?;
        self.journal = Some(swapped);
        self.index.clear();
        // Only after the publication: a delete that finds this entry must
        // also read a manifest naming it as current.
        let now = (self.store.now)();
        self.store
            .record_lineage(&self.doc_dir, &self.doc_id, &self.manifest, Some(now));
        Ok(Head {
            format: reset.format,
            epoch: reset.epoch,
            lineage: reset.lineage.clone(),
            durable_through: 0,
        })
    }
}

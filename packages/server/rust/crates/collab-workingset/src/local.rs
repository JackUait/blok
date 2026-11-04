use std::fs;
use std::io::{self, Read};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::codec::lower_hex;
use crate::{
    Error, HEADER_LENGTH, Log, Set, Tag, decode_header, decode_or_absent, doc_key, encode_document,
    ensure_reset_raises_epoch, ensure_write_does_not_lower_epoch, guard,
};

const TEMPORARY_PREFIX: &str = ".blok-collab-";

/// One working-set file per document under a directory (C#
/// LocalCollabStore): atomic temp-and-rename, the directory fsynced, modes
/// 0600/0700, and an unreadable file moved aside.
#[derive(Clone)]
pub struct LocalStore {
    inner: Arc<Inner>,
}

struct Inner {
    directory: PathBuf,
    log: Option<Log>,
    mode_warned: AtomicBool,
    now: fn() -> SystemTime,
}

/// Set when the caller drops the future, so the blocking body stops where
/// Go checks ctx.Err(): a dropped write must not still rename into place.
struct CancelOnDrop(Option<Arc<AtomicBool>>);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        if let Some(flag) = self.0.take() {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

fn check(cancelled: &AtomicBool) -> Result<(), Error> {
    if cancelled.load(Ordering::SeqCst) {
        return Err(Error::Canceled);
    }
    Ok(())
}

impl LocalStore {
    /// Sweeps temporary files older than a minute, left by a crash.
    pub fn new(directory: impl Into<PathBuf>, log: Option<Log>) -> Self {
        Self::with_clock(directory, log, SystemTime::now)
    }

    pub(crate) fn with_clock(
        directory: impl Into<PathBuf>,
        log: Option<Log>,
        now: fn() -> SystemTime,
    ) -> Self {
        let store = LocalStore {
            inner: Arc::new(Inner {
                directory: directory.into(),
                log,
                mode_warned: AtomicBool::new(false),
                now,
            }),
        };
        store.inner.sweep_temporary_files();
        store
    }

    async fn run<T: Send + 'static>(
        &self,
        doc_id: &str,
        what: &'static str,
        body: impl FnOnce(&Inner, &str, &AtomicBool) -> Result<T, Error> + Send + 'static,
    ) -> Result<T, Error> {
        let inner = self.inner.clone();
        let doc_id = doc_id.to_owned();
        let flag = Arc::new(AtomicBool::new(false));
        let mut on_drop = CancelOnDrop(Some(flag.clone()));
        let joined = tokio::task::spawn_blocking(move || {
            let result = body(&inner, &doc_id, &flag);
            guard(flag.load(Ordering::SeqCst), &doc_id, what, result)
        })
        .await;
        on_drop.0 = None;
        joined.unwrap_or_else(|err| Err(Error::Other(err.into())))
    }

    /// `None` for an absent document; an unreadable file is moved aside so
    /// the epoch guard no longer sees its header.
    pub async fn read(&self, doc_id: &str) -> Result<Option<Set>, Error> {
        self.run(doc_id, "read", |inner, doc_id, cancelled| {
            check(cancelled)?;
            let path = inner.path_for(doc_id);
            if is_dir(&path) {
                inner.logf(&format!(
                    "collab: the working-set path for \"{doc_id}\" is a directory; treating it as absent"
                ));
                return Ok(None);
            }
            let document = match fs::read(&path) {
                Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
                other => other?,
            };
            let stored = inner.decode(doc_id, &document);
            if stored.is_none() {
                inner.move_aside(doc_id, &path);
            }
            Ok(stored)
        })
        .await
    }

    /// Replaces the working set; it never lowers the stored epoch.
    pub async fn write(&self, doc_id: &str, updates: &[u8], tag: &Tag) -> Result<(), Error> {
        let updates = updates.to_vec();
        let tag = tag.clone();
        self.run(doc_id, "write", move |inner, doc_id, cancelled| {
            let document = encode_document(&tag, &updates)?;
            ensure_write_does_not_lower_epoch(doc_id, inner.read_tag(doc_id).as_ref(), &tag)?;
            inner.replace_atomically(doc_id, &document, cancelled)
        })
        .await
    }

    /// Rewrites an empty log under a strictly higher epoch.
    pub async fn reset(&self, doc_id: &str, tag: &Tag) -> Result<(), Error> {
        let tag = tag.clone();
        self.run(doc_id, "reset", move |inner, doc_id, cancelled| {
            let document = encode_document(&tag, &[])?;
            ensure_reset_raises_epoch(doc_id, inner.read_tag(doc_id).as_ref(), &tag)?;
            inner.replace_atomically(doc_id, &document, cancelled)
        })
        .await
    }

    /// Removes a readable working set once a journal holds its content. An
    /// unreadable one stays for repair.
    pub async fn retire(&self, doc_id: &str) -> Result<(), Error> {
        self.run(doc_id, "retire", |inner, doc_id, _| {
            let path = inner.path_for(doc_id);
            if is_dir(&path) {
                return Ok(());
            }
            let document = match fs::read(&path) {
                Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(()),
                other => other?,
            };
            if inner.decode(doc_id, &document).is_none() {
                return Ok(());
            }
            fs::remove_file(&path)?;
            sync_directory(&inner.directory);
            Ok(())
        })
        .await
    }

    /// Purges one document's working set, its moved-aside files and its
    /// keyed temporaries. An unkeyed temporary may hold any document, so it
    /// blocks the purge until it is gone.
    pub async fn delete(&self, doc_id: &str) -> Result<(), Error> {
        self.run(doc_id, "delete", |inner, doc_id, cancelled| {
            check(cancelled)?;
            let entries = match read_dir_sorted(&inner.directory) {
                Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(()),
                other => other?,
            };
            for (name, is_directory) in &entries {
                if !is_directory
                    && let Some(rest) = name.strip_prefix(TEMPORARY_PREFIX)
                    && is_guid_n(rest)
                {
                    return Err(Error::Refused(format!(
                        "collab: cannot purge \"{doc_id}\" while {name} may hold its working set."
                    )));
                }
            }
            let key = doc_key(doc_id);
            remove_file(&inner.directory.join(&key))?;
            let unreadable = format!("{key}.unreadable-");
            let temporary = format!("{TEMPORARY_PREFIX}{key}-");
            for (name, is_directory) in &entries {
                if *is_directory || !(name.starts_with(&unreadable) || name.starts_with(&temporary))
                {
                    continue;
                }
                check(cancelled)?;
                remove_file(&inner.directory.join(name))?;
            }
            sync_directory(&inner.directory);
            Ok(())
        })
        .await
    }
}

impl Inner {
    fn logf(&self, message: &str) {
        if let Some(log) = &self.log {
            log(message);
        }
    }

    fn decode(&self, doc_id: &str, document: &[u8]) -> Option<Set> {
        decode_or_absent(
            doc_id,
            document,
            self.log.as_deref().map(|log| log as &dyn Fn(&str)),
        )
    }

    fn path_for(&self, doc_id: &str) -> PathBuf {
        self.directory.join(doc_key(doc_id))
    }

    fn move_aside(&self, doc_id: &str, path: &Path) {
        let mut aside = path.as_os_str().to_owned();
        aside.push(format!(".unreadable-{}", compact_utc((self.now)())));
        let aside = PathBuf::from(aside);
        if let Err(err) = fs::rename(path, &aside) {
            self.logf(&format!(
                "collab: could not move the unreadable working set for \"{doc_id}\" aside: {err}"
            ));
            return;
        }
        let base = aside
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        self.logf(&format!(
            "collab: moved the unreadable working set for \"{doc_id}\" to {base}"
        ));
    }

    fn sweep_temporary_files(&self) {
        let entries = match fs::read_dir(&self.directory) {
            Err(err) if err.kind() == io::ErrorKind::NotFound => return,
            Err(err) => return self.sweep_failed(&err),
            Ok(entries) => entries,
        };
        let mut entries: Vec<fs::DirEntry> = match entries.collect() {
            Ok(entries) => entries,
            Err(err) => return self.sweep_failed(&err),
        };
        entries.sort_by_key(|entry| entry.file_name());
        let cutoff = (self.now)() - Duration::from_secs(60);
        for entry in entries {
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_directory = entry.file_type().is_ok_and(|kind| kind.is_dir());
            if is_directory || !name.starts_with(TEMPORARY_PREFIX) {
                continue;
            }
            let modified = match entry.metadata().and_then(|info| info.modified()) {
                Ok(modified) => modified,
                Err(err) => return self.sweep_failed(&err),
            };
            if modified < cutoff {
                if let Err(err) = fs::remove_file(entry.path()) {
                    return self.sweep_failed(&err);
                }
                self.logf(&format!(
                    "collab: removed the orphaned temporary working-set file {name}"
                ));
            }
        }
    }

    fn sweep_failed(&self, err: &io::Error) {
        self.logf(&format!(
            "collab: could not sweep temporary working-set files: {err}"
        ));
    }

    /// Reads only the header; anything unreadable is no stored tag.
    fn read_tag(&self, doc_id: &str) -> Option<Set> {
        let mut file = fs::File::open(self.path_for(doc_id)).ok()?;
        let mut header = [0u8; HEADER_LENGTH];
        file.read_exact(&mut header).ok()?;
        let tag = decode_header(&header).ok()?;
        Some(Set {
            updates: Vec::new(),
            tag,
        })
    }

    fn replace_atomically(
        &self,
        doc_id: &str,
        document: &[u8],
        cancelled: &AtomicBool,
    ) -> Result<(), Error> {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&self.directory)?;
        self.tighten_existing_directory();
        let final_path = self.path_for(doc_id);
        let mut suffix = [0u8; 16];
        getrandom::fill(&mut suffix).map_err(|err| Error::Io(io::Error::other(err.to_string())))?;
        let temporary = self.directory.join(format!(
            "{TEMPORARY_PREFIX}{}-{}",
            doc_key(doc_id),
            lower_hex(&suffix)
        ));
        let result = (|| {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&temporary)?;
            io::Write::write_all(&mut file, document)?;
            file.sync_all()?;
            drop(file);
            check(cancelled)?;
            if is_dir(&final_path) {
                // rename(2) onto an empty directory fails on Linux but not
                // everywhere; File.Move always refuses it.
                return Err(Error::Io(io::Error::new(
                    io::ErrorKind::IsADirectory,
                    format!("rename {}: is a directory", final_path.display()),
                )));
            }
            fs::rename(&temporary, &final_path)?;
            sync_directory(&self.directory);
            Ok(())
        })();
        if let Err(err) = &result
            && let Err(cleanup) = fs::remove_file(&temporary)
            && cleanup.kind() != io::ErrorKind::NotFound
        {
            return Err(Error::Io(io::Error::other(format!(
                "collab: the working-set write failed and cleanup also failed: {err}\n{cleanup}"
            ))));
        }
        result
    }

    /// The private mode applies only at creation, so a pre-made directory is
    /// chmodded, warned about once if not ours.
    fn tighten_existing_directory(&self) {
        if let Err(err) = fs::set_permissions(&self.directory, fs::Permissions::from_mode(0o700))
            && err.kind() == io::ErrorKind::PermissionDenied
            && !self.mode_warned.swap(true, Ordering::SeqCst)
        {
            self.logf(&format!(
                "collab: could not make \"{}\" private (this process does not own it); its mode is left as found.",
                self.directory.display()
            ));
        }
    }
}

fn is_dir(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|info| info.is_dir())
}

/// Entry names and whether each is a directory (not following symlinks),
/// sorted by name as Go's os.ReadDir returns them.
fn read_dir_sorted(directory: &Path) -> io::Result<Vec<(String, bool)>> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let is_directory = entry.file_type()?.is_dir();
        entries.push((
            entry.file_name().to_string_lossy().into_owned(),
            is_directory,
        ));
    }
    entries.sort();
    Ok(entries)
}

/// File.Delete: a missing file is fine, a directory is an error.
fn remove_file(path: &Path) -> Result<(), Error> {
    match fs::symlink_metadata(path) {
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.into()),
        Ok(info) if info.is_dir() => Err(Error::Io(io::Error::new(
            io::ErrorKind::IsADirectory,
            format!("remove {}: is a directory", path.display()),
        ))),
        Ok(_) => Ok(fs::remove_file(path)?),
    }
}

/// Guid.TryParseExact(value, "N"): 32 hex digits.
fn is_guid_n(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|c| c.is_ascii_hexdigit())
}

/// Makes a rename or delete durable; failures are ignored, as in C#.
fn sync_directory(path: &Path) {
    if let Ok(dir) = fs::File::open(path) {
        let _ = dir.sync_all();
    }
}

/// yyyyMMddTHHmmssfffZ in UTC, milliseconds truncated.
fn compact_utc(time: SystemTime) -> String {
    let since = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let seconds = since.as_secs() as i64;
    let (days, rest) = (seconds.div_euclid(86_400), seconds.rem_euclid(86_400));
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}{month:02}{day:02}T{:02}{:02}{:02}{:03}Z",
        rest / 3_600,
        rest % 3_600 / 60,
        rest % 60,
        since.subsec_millis()
    )
}

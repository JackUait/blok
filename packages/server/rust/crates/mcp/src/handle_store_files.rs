//! `--handle-store files:<dir>`: the reference handle store, for tests and
//! for several blok-mcp processes on one machine (or one shared disk with
//! working renames). It keeps Node's layout and lock rules
//! (src/mcp/handle-store-files.ts); sharing one directory with another
//! language's store is not supported.
//!
//!   <handle>.record.json  the record (`HandleRecord`), as JSON text.
//!   <handle>.meta.json    {"v":1,"principal":"<p>","lastUsedMs":<epoch ms>}: who owns
//!                         it and when its last lease ended. The handle exists
//!                         while this file exists.
//!   <handle>.lease        a lock, held while the file exists; its text is the
//!                         holder's random token.
//!   principal-<sha256 hex of the principal>.lock
//!                         held while try_add counts and adds for that principal.
//!
//! Writes go to `.<name>.<12 hex>.tmp` in the same directory, then are
//! renamed over the target, so a reader sees the old or the new file.
//!
//! Locks: create the file exclusively and write the token. When it exists
//! and its mtime is older than the lease's stale time (30 s), its holder is
//! taken to be gone. One breaker at a time takes `<lock>.break` exclusively
//! (a `.break` older than the stale time is removed), reads the lock again,
//! and deletes it only if it still has the token seen before and is still
//! stale; then the lock is created again.
//! A holder keeps its lease by `renew` (Blok renews every 5 s while a call
//! runs), and every lease operation checks the token first: a holder whose
//! lease was taken over cannot save, renew or remove. Exclusivity is best
//! effort: the source's version check is what stops a lost write.
//!
//! Expiry: a handle expires when it is not leased and its last release is
//! older than the idle time. acquire and count delete an expired handle under
//! its lease; sweep deletes every one, and crash leftovers older than the
//! stale time: temp and `.break` files, records and leases without meta, and
//! principal locks.
//!
//! A record that does not parse (a newer Blok's, or a corrupt one) is
//! unknown to acquire, and its files are left until it expires.
//!
//! Privacy: records hold document text, undo steps and principals. On
//! Windows the store refuses to start: these POSIX checks cannot be made
//! there. Elsewhere, at start, once: the path is made absolute and a
//! trailing slash dropped (lstat would follow a link), the directory is made
//! (0700) if missing, then lstat-checked: it must be a directory, not a
//! link, with no group or world bits, owned by the effective user id (so
//! root refuses another user's directory too). Nothing makes the directory
//! again later. Every file is created 0600.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use ring::rand::{SecureRandom, SystemRandom};
use serde_json::{Value, json};

use crate::handle_store::{
    Acquired, HandleLease, HandleRecord, HandleStore, StoreError, is_store_handle,
};
use crate::uploads::BoxFuture;

const LEASE_STALE: Duration = Duration::from_secs(30);
const POLL: Duration = Duration::from_millis(25);
// try_add's principal lock is held for one directory scan and two small writes.
const PRINCIPAL_WAIT: Duration = Duration::from_secs(10);
const META: &str = ".meta.json";
const RECORD: &str = ".record.json";

#[derive(Clone)]
pub struct FilesHandleStore {
    dir: Arc<PathBuf>,
    lease_stale: Duration,
}

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    let _ = SystemRandom::new().fill(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |d| d.as_millis() as f64)
}

/// Runs blocking file work off the async threads.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, StoreError> + Send + 'static,
) -> Result<T, StoreError> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|err| StoreError(err.to_string()))?
}

#[cfg(unix)]
fn private_dir(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
}

#[cfg(not(unix))]
fn private_dir(path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(path)
}

#[cfg(unix)]
fn is_private(meta: &std::fs::Metadata, owner: Option<u32>) -> bool {
    use std::os::unix::fs::MetadataExt;
    meta.mode() & 0o077 == 0 && owner.is_none_or(|owner| meta.uid() == owner)
}

#[cfg(not(unix))]
fn is_private(_: &std::fs::Metadata, _: Option<u32>) -> bool {
    false
}

#[cfg(unix)]
fn effective_uid() -> Option<u32> {
    Some(rustix::process::geteuid().as_raw())
}

#[cfg(not(unix))]
fn effective_uid() -> Option<u32> {
    None
}

/// Creates `path` only if it does not exist, readable by this user only.
fn create_new(path: &Path) -> std::io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

fn read_text(path: &Path) -> Result<Option<String>, StoreError> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.into()),
    }
}

fn remove(path: &Path) -> Result<(), StoreError> {
    match std::fs::remove_file(path) {
        Err(err) if err.kind() != std::io::ErrorKind::NotFound => Err(err.into()),
        _ => Ok(()),
    }
}

struct Meta {
    principal: String,
    last_used_ms: f64,
}

fn parse_meta(text: Option<String>) -> Option<Meta> {
    let value: Value = serde_json::from_str(&text?).ok()?;
    Some(Meta {
        principal: value.get("principal")?.as_str()?.to_owned(),
        last_used_ms: value.get("lastUsedMs")?.as_f64()?,
    })
}

fn expired(meta: &Meta, idle: Duration) -> bool {
    now_ms() - meta.last_used_ms > idle.as_millis() as f64
}

impl FilesHandleStore {
    /// Makes the directory if missing and checks it is private. The message
    /// is the start refusal (exit code 2).
    pub fn open(dir: &str) -> Result<FilesHandleStore, String> {
        FilesHandleStore::open_with(dir, cfg!(windows), effective_uid())
    }

    /// `open` on a given platform and effective user id, for tests.
    pub(crate) fn open_with(
        dir: &str,
        windows: bool,
        owner: Option<u32>,
    ) -> Result<FilesHandleStore, String> {
        if windows {
            return Err(
                "--handle-store files: is not supported on Windows; use your own store".to_owned(),
            );
        }
        // Rebuilt from its parts, so a trailing slash cannot make lstat follow a link.
        let absolute = std::path::absolute(dir).unwrap_or_else(|_| PathBuf::from(dir));
        let path: PathBuf = absolute.components().collect();
        if let Err(err) = private_dir(&path)
            && err.kind() != std::io::ErrorKind::AlreadyExists
        {
            return Err(format!(
                "--handle-store cannot create {}: {err}",
                path.display()
            ));
        }
        let refused = || {
            format!(
                "--handle-store directory {} must be a directory (not a link) owned by this user, with no group or world access (chmod 700)",
                path.display()
            )
        };
        let meta = std::fs::symlink_metadata(&path).map_err(|_| refused())?;
        if meta.file_type().is_symlink() || !meta.is_dir() || !is_private(&meta, owner) {
            return Err(refused());
        }
        Ok(FilesHandleStore {
            dir: Arc::new(path),
            lease_stale: LEASE_STALE,
        })
    }

    /// How long a lease lives without a renew. Default 30 s.
    pub fn with_lease_stale(mut self, stale: Duration) -> FilesHandleStore {
        self.lease_stale = stale;
        self
    }

    fn path(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }

    fn lease_path(&self, handle: &str) -> PathBuf {
        self.path(&format!("{handle}.lease"))
    }

    fn meta_path(&self, handle: &str) -> PathBuf {
        self.path(&format!("{handle}{META}"))
    }

    fn record_path(&self, handle: &str) -> PathBuf {
        self.path(&format!("{handle}{RECORD}"))
    }

    fn principal_lock(&self, principal: &str) -> PathBuf {
        use sha2::Digest;
        let digest = sha2::Sha256::digest(principal.as_bytes());
        let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
        self.path(&format!("principal-{hex}.lock"))
    }

    fn write_atomic(&self, path: &Path, text: &str) -> Result<(), StoreError> {
        use std::io::Write;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let temp = self.path(&format!(".{name}.{}.tmp", random_hex(6)));
        let written = create_new(&temp)
            .and_then(|mut file| file.write_all(text.as_bytes()))
            .and_then(|()| std::fs::rename(&temp, path));
        if let Err(err) = written {
            let _ = std::fs::remove_file(&temp);
            return Err(err.into());
        }
        Ok(())
    }

    fn try_create(path: &Path, token: &str) -> Result<bool, StoreError> {
        use std::io::Write;
        match create_new(path) {
            Ok(mut file) => {
                file.write_all(token.as_bytes())?;
                Ok(true)
            }
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
            Err(err) => Err(err.into()),
        }
    }

    fn fresh(&self, path: &Path) -> Option<bool> {
        let modified = std::fs::metadata(path).ok()?.modified().ok()?;
        Some(
            SystemTime::now()
                .duration_since(modified)
                .unwrap_or_default()
                <= self.lease_stale,
        )
    }

    /// The holder is gone. One breaker at a time, and it deletes only the
    /// lock it saw go stale (`seen`, its token), never one taken since. True
    /// when the lock is gone.
    pub(crate) fn break_stale(&self, path: &Path, seen: Option<&str>) -> Result<bool, StoreError> {
        let guard = PathBuf::from(format!("{}.break", path.display()));
        let mine = random_hex(16);
        if !Self::try_create(&guard, &mine)? {
            // A breaker that died leaves its guard: it goes once it is old.
            if self.fresh(&guard) == Some(false) {
                remove(&guard)?;
            }
            return Ok(false);
        }
        let broken = (|| {
            let Some(fresh) = self.fresh(path) else {
                return Ok(true);
            };
            if fresh || read_text(path)?.as_deref() != seen {
                return Ok(false);
            }
            remove(path)?;
            Ok(true)
        })();
        Self::drop_lock(&guard, &mine)?;
        broken
    }

    async fn take_lock(
        &self,
        path: PathBuf,
        token: String,
        timeout: Duration,
    ) -> Result<bool, StoreError> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let store = self.clone();
            let (path_now, token_now) = (path.clone(), token.clone());
            let taken = blocking(move || {
                if Self::try_create(&path_now, &token_now)? {
                    return Ok(true);
                }
                let seen = read_text(&path_now)?;
                if store.fresh(&path_now) == Some(false)
                    && store.break_stale(&path_now, seen.as_deref())?
                {
                    return Self::try_create(&path_now, &token_now);
                }
                Ok(false)
            })
            .await?;
            if taken {
                return Ok(true);
            }
            if tokio::time::Instant::now() >= deadline {
                return Ok(false);
            }
            tokio::time::sleep(POLL).await;
        }
    }

    fn owns(path: &Path, token: &str) -> Result<bool, StoreError> {
        Ok(read_text(path)?.as_deref() == Some(token))
    }

    fn drop_lock(path: &Path, token: &str) -> Result<(), StoreError> {
        if Self::owns(path, token)? {
            remove(path)?;
        }
        Ok(())
    }

    fn forget(&self, handle: &str) -> Result<(), StoreError> {
        remove(&self.meta_path(handle))?;
        remove(&self.record_path(handle))
    }

    /// Deletes an expired handle if nobody leases it. True when it is gone.
    async fn reap(&self, handle: &str, idle: Duration) -> Result<bool, StoreError> {
        let lock = self.lease_path(handle);
        let token = random_hex(16);
        if !self
            .take_lock(lock.clone(), token.clone(), Duration::ZERO)
            .await?
        {
            return Ok(false);
        }
        let store = self.clone();
        let handle = handle.to_owned();
        blocking(move || {
            let reaped = (|| {
                let meta = parse_meta(read_text(&store.meta_path(&handle))?);
                if meta.is_some_and(|meta| !expired(&meta, idle)) {
                    return Ok(false);
                }
                store.forget(&handle)?;
                Ok(true)
            })();
            Self::drop_lock(&lock, &token)?;
            reaped
        })
        .await
    }

    fn handles(&self) -> Result<Vec<String>, StoreError> {
        let mut handles = Vec::new();
        for entry in std::fs::read_dir(&*self.dir)? {
            let name = entry?.file_name().to_string_lossy().into_owned();
            if let Some(handle) = name.strip_suffix(META)
                && is_store_handle(handle)
            {
                handles.push(handle.to_owned());
            }
        }
        Ok(handles)
    }

    async fn count_of(&self, principal: &str, idle: Duration) -> Result<usize, StoreError> {
        let store = self.clone();
        let owned = blocking(move || {
            let mut owned = Vec::new();
            for handle in store.handles()? {
                if let Some(meta) = parse_meta(read_text(&store.meta_path(&handle))?) {
                    owned.push((handle, meta));
                }
            }
            Ok(owned)
        })
        .await?;
        let mut count = 0;
        for (handle, meta) in owned {
            if meta.principal != principal {
                continue;
            }
            if !expired(&meta, idle) || !self.reap(&handle, idle).await? {
                count += 1;
            }
        }
        Ok(count)
    }
}

struct FilesLease {
    store: FilesHandleStore,
    handle: String,
    token: String,
    record: HandleRecord,
    released: AtomicBool,
}

impl FilesLease {
    fn lost(&self) -> StoreError {
        StoreError(format!(
            "blok-mcp handle store: the lease on {} was lost",
            self.handle
        ))
    }

    /// Runs `work` only while this lease holds the handle.
    async fn holding<T: Send + 'static>(
        &self,
        work: impl FnOnce(&FilesHandleStore, &str) -> Result<T, StoreError> + Send + 'static,
    ) -> Result<T, StoreError> {
        if self.released.load(Ordering::SeqCst) {
            return Err(self.lost());
        }
        let (store, handle, token, lost) = (
            self.store.clone(),
            self.handle.clone(),
            self.token.clone(),
            self.lost(),
        );
        blocking(move || {
            if !FilesHandleStore::owns(&store.lease_path(&handle), &token)? {
                return Err(lost);
            }
            work(&store, &handle)
        })
        .await
    }
}

impl HandleLease for FilesLease {
    fn record(&self) -> &HandleRecord {
        &self.record
    }

    fn save(&self, record: HandleRecord) -> BoxFuture<'_, Result<(), StoreError>> {
        Box::pin(self.holding(move |store, handle| {
            store.write_atomic(&store.record_path(handle), &record.to_json())
        }))
    }

    fn renew(&self) -> BoxFuture<'_, Result<(), StoreError>> {
        Box::pin(self.holding(|store, handle| {
            let file = std::fs::File::options()
                .write(true)
                .open(store.lease_path(handle))?;
            file.set_modified(SystemTime::now())?;
            Ok(())
        }))
    }

    fn remove(&self) -> BoxFuture<'_, Result<(), StoreError>> {
        Box::pin(async move {
            self.holding(|store, handle| {
                store.forget(handle)?;
                remove(&store.lease_path(handle))
            })
            .await?;
            self.released.store(true, Ordering::SeqCst);
            Ok(())
        })
    }

    fn release(&self) -> BoxFuture<'_, Result<(), StoreError>> {
        Box::pin(async move {
            if self.released.swap(true, Ordering::SeqCst) {
                return Ok(());
            }
            let (store, handle, token) =
                (self.store.clone(), self.handle.clone(), self.token.clone());
            blocking(move || {
                let lock = store.lease_path(&handle);
                if !FilesHandleStore::owns(&lock, &token)? {
                    return Ok(());
                }
                let meta_path = store.meta_path(&handle);
                let touched = read_text(&meta_path).and_then(|text| match parse_meta(text) {
                    Some(meta) => {
                        let text =
                            json!({ "v": 1, "principal": meta.principal, "lastUsedMs": now_ms() });
                        store.write_atomic(&meta_path, &text.to_string())
                    }
                    None => Ok(()),
                });
                // The lease goes even when the meta could not be touched.
                remove(&lock)?;
                touched
            })
            .await
        })
    }
}

impl HandleStore for FilesHandleStore {
    fn count(&self, principal: String, idle: Duration) -> BoxFuture<'_, Result<usize, StoreError>> {
        Box::pin(async move { self.count_of(&principal, idle).await })
    }

    fn try_add(
        &self,
        handle: String,
        record: HandleRecord,
        max_per_principal: usize,
        idle: Duration,
    ) -> BoxFuture<'_, Result<bool, StoreError>> {
        Box::pin(async move {
            if !is_store_handle(&handle) {
                return Err(StoreError(format!(
                    "blok-mcp handle store: \"{handle}\" is not a handle"
                )));
            }
            let lock = self.principal_lock(&record.principal);
            let token = random_hex(16);
            if !self
                .take_lock(lock.clone(), token.clone(), PRINCIPAL_WAIT)
                .await?
            {
                return Err(StoreError(
                    "blok-mcp handle store: another process holds the principal lock".to_owned(),
                ));
            }
            let added = async {
                let meta_path = self.meta_path(&handle);
                if blocking(move || read_text(&meta_path)).await?.is_some() {
                    return Err(StoreError(format!(
                        "blok-mcp handle store: handle {handle} is taken"
                    )));
                }
                if max_per_principal == 0
                    || self.count_of(&record.principal, idle).await? >= max_per_principal
                {
                    return Ok(false);
                }
                let store = self.clone();
                blocking(move || {
                    store.write_atomic(&store.record_path(&handle), &record.to_json())?;
                    let meta =
                        json!({ "v": 1, "principal": record.principal, "lastUsedMs": now_ms() });
                    store.write_atomic(&store.meta_path(&handle), &meta.to_string())?;
                    Ok(true)
                })
                .await
            }
            .await;
            let dropped = blocking(move || FilesHandleStore::drop_lock(&lock, &token)).await;
            let added = added?;
            dropped?;
            Ok(added)
        })
    }

    fn acquire(
        &self,
        handle: String,
        idle: Duration,
        timeout: Duration,
    ) -> BoxFuture<'_, Result<Acquired, StoreError>> {
        Box::pin(async move {
            if !is_store_handle(&handle) {
                return Ok(Acquired::Unknown);
            }
            let meta_path = self.meta_path(&handle);
            // No waiting on a handle that does not exist.
            if blocking(move || read_text(&meta_path)).await?.is_none() {
                return Ok(Acquired::Unknown);
            }
            let lock = self.lease_path(&handle);
            let token = random_hex(16);
            if !self.take_lock(lock.clone(), token.clone(), timeout).await? {
                return Ok(Acquired::Busy);
            }
            let store = self.clone();
            let (handle_now, token_now) = (handle.clone(), token.clone());
            let read = blocking(move || {
                let meta = parse_meta(read_text(&store.meta_path(&handle_now))?);
                let text = match &meta {
                    Some(_) => read_text(&store.record_path(&handle_now))?,
                    None => None,
                };
                let (Some(meta), Some(text)) = (meta, text) else {
                    store.forget(&handle_now)?;
                    FilesHandleStore::drop_lock(&lock, &token_now)?;
                    return Ok(None);
                };
                if expired(&meta, idle) {
                    store.forget(&handle_now)?;
                    FilesHandleStore::drop_lock(&lock, &token_now)?;
                    return Ok(None);
                }
                // A newer Blok's record, or a corrupt one: unknown here, and
                // left for its writer; it expires as any other.
                let record = HandleRecord::from_json(&text).ok();
                if record.is_none() {
                    FilesHandleStore::drop_lock(&lock, &token_now)?;
                }
                Ok(record)
            })
            .await?;
            let Some(record) = read else {
                return Ok(Acquired::Unknown);
            };
            Ok(Acquired::Lease(Box::new(FilesLease {
                store: self.clone(),
                handle,
                token,
                record,
                released: AtomicBool::new(false),
            })))
        })
    }

    fn sweep(&self, idle: Duration) -> BoxFuture<'_, Result<(), StoreError>> {
        Box::pin(async move {
            let store = self.clone();
            let expired_handles = blocking(move || {
                let mut found = Vec::new();
                for handle in store.handles()? {
                    let meta = parse_meta(read_text(&store.meta_path(&handle))?);
                    if meta.is_none_or(|meta| expired(&meta, idle)) {
                        found.push(handle);
                    }
                }
                // Crash leftovers: temp and `.break` files, and a record or lease
                // with no meta. Only old ones: a fresh one is in use.
                for entry in std::fs::read_dir(&*store.dir)? {
                    let entry = entry?;
                    let name = entry.file_name().to_string_lossy().into_owned();
                    // A try_add that died: broken as try_add would, never one taken since.
                    if name.starts_with("principal-") && name.ends_with(".lock") {
                        let path = entry.path();
                        if store.fresh(&path) == Some(false) {
                            let seen = read_text(&path)?;
                            store.break_stale(&path, seen.as_deref())?;
                        }
                        continue;
                    }
                    let orphan = [RECORD, ".lease"].iter().any(|suffix| {
                        name.strip_suffix(suffix).is_some_and(|handle| {
                            is_store_handle(handle) && !store.meta_path(handle).exists()
                        })
                    });
                    let leftover = name.ends_with(".tmp") || name.ends_with(".break") || orphan;
                    if leftover && store.fresh(&entry.path()) == Some(false) {
                        remove(&entry.path())?;
                    }
                }
                Ok(found)
            })
            .await?;
            for handle in expired_handles {
                self.reap(&handle, idle).await?;
            }
            Ok(())
        })
    }
}

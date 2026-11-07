//! The files source's disk work (src/mcp/sources/files.ts). The id rule,
//! listing, parsing and saved bytes come from the bundle.

use std::collections::HashMap;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use ring::rand::{SecureRandom, SystemRandom};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

use crate::bundle::{Bundle, Obj};
use crate::errors::{Fault, HostError};
use crate::sources::{Listing, Loaded};

// A save holds the lock for one read, one small write and one rename, so a
// lock this old was left by a dead process.
const LOCK_STALE: Duration = Duration::from_secs(30);
// Kept short: an agent waiting longer is better told to retry.
const LOCK_WAIT: Duration = Duration::from_secs(2);
const LOCK_RETRY: Duration = Duration::from_millis(25);

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

// Agent-facing messages name only `<id>.json`; the path goes to stderr.
fn unavailable(message: String, path: &Path, cause: &dyn std::fmt::Display) -> HostError {
    eprintln!(
        "blok-mcp files source: {message} ({}): {cause}",
        path.display()
    );
    HostError::surface("SOURCE_UNAVAILABLE", message)
}

fn changed() -> HostError {
    HostError::surface(
        "DOCUMENT_CHANGED",
        "The document changed on disk since you opened it. Read it again, then retry.",
    )
}

/// Saves of one file, one at a time. An entry goes once no save holds or
/// waits for it, as Node drops its tail.
#[derive(Default)]
struct SaveQueues(Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>);

struct SaveTurn {
    queues: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
    key: String,
    queue: Option<Arc<tokio::sync::Mutex<()>>>,
    guard: Option<tokio::sync::OwnedMutexGuard<()>>,
}

impl Drop for SaveTurn {
    // Also runs for a save cancelled while it waited.
    fn drop(&mut self) {
        drop(self.guard.take());
        drop(self.queue.take());
        // Every clone is made under this lock, so the count cannot rise here.
        let mut queues = self.queues.lock().unwrap_or_else(|p| p.into_inner());
        if queues.get(&self.key).is_some_and(|q| Arc::strong_count(q) == 1) {
            queues.remove(&self.key);
        }
    }
}

impl SaveQueues {
    async fn turn(&self, key: &str) -> SaveTurn {
        let queue = {
            let mut queues = self.0.lock().unwrap_or_else(|p| p.into_inner());
            queues.entry(key.to_owned()).or_default().clone()
        };
        let mut turn = SaveTurn {
            queues: self.0.clone(),
            key: key.to_owned(),
            queue: Some(queue.clone()),
            guard: None,
        };
        turn.guard = Some(queue.lock_owned().await);
        turn
    }

    fn len(&self) -> usize {
        self.0.lock().unwrap_or_else(|p| p.into_inner()).len()
    }
}

pub struct FilesSource {
    dir: PathBuf,
    bundle: Arc<Bundle>,
    /// Saves of one file run one at a time in this process.
    queues: SaveQueues,
}

fn file_name(id: &str) -> String {
    format!("{id}.json")
}

fn is_symlink(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink())
}

// Lower case: on a case-insensitive disk `doc` and `DOC` are one file.
fn same_file_key(target: &Path) -> String {
    target.to_string_lossy().to_lowercase()
}

impl FilesSource {
    pub fn new(dir: &str, bundle: Arc<Bundle>) -> FilesSource {
        FilesSource {
            dir: PathBuf::from(dir),
            bundle,
            queues: SaveQueues::default(),
        }
    }

    async fn path_of(&self, id: &str) -> Result<PathBuf, Fault> {
        let checked = self
            .bundle
            .call("mcpFileId", &Obj::new().str("id", id).finish())
            .await?;
        if let Some(error) = checked.get("error") {
            return Err(HostError::as_is(error.clone()).into());
        }
        Ok(self.dir.join(file_name(id)))
    }

    fn read_bytes(&self, id: &str, path: &Path) -> Result<Option<Vec<u8>>, HostError> {
        match std::fs::read(path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(err) if err.kind() == ErrorKind::NotFound => Ok(None),
            Err(err) => Err(unavailable(format!("Cannot read {id}.json."), path, &err)),
        }
    }

    fn list_names(&self) -> Result<Vec<String>, HostError> {
        let read = std::fs::read_dir(&self.dir).map_err(|err| {
            unavailable(
                "Cannot list the documents directory.".to_owned(),
                &self.dir,
                &err,
            )
        })?;
        Ok(read
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect())
    }

    /// On a case-insensitive disk `SECRET` would open `secret.json` and slip
    /// past an authorize hook that names `secret`. realpath gives the on-disk
    /// name; a mismatch is a case alias or a symlink, and only a listing
    /// tells them apart.
    fn assert_exact_name(&self, id: &str, path: &Path) -> Result<(), HostError> {
        let name = file_name(id);
        let Ok(real) = std::fs::canonicalize(path) else {
            return Ok(());
        };
        let real_name = real.file_name().map(|n| n.to_string_lossy().into_owned());
        if real_name.as_deref() == Some(name.as_str()) && !is_symlink(path) {
            return Ok(());
        }
        let names = self.list_names()?;
        if names.contains(&name) {
            return Ok(());
        }
        let lower = name.to_lowercase();
        let taken = names.iter().find(|entry| entry.to_lowercase() == lower);
        Err(HostError::surface(
            "INVALID_ARGS",
            match taken {
                None => "Document ids are case-sensitive. Use the id exactly as listed.".to_owned(),
                Some(taken) => format!(
                    "{taken} already uses this name with different letter case. This disk ignores case, so the two ids cannot both exist."
                ),
            },
        ))
    }

    /// Whether two ids save to one file, through a symlink or a case alias
    /// (Node's sameDocument). An id that cannot be resolved matches nothing.
    pub async fn same_document(&self, first: &str, second: &str) -> bool {
        let mut keys = Vec::new();
        for id in [first, second] {
            let Ok(path) = self.path_of(id).await else {
                return false;
            };
            let Ok(target) = self.write_target_of(id, &path) else {
                return false;
            };
            keys.push(same_file_key(&target));
        }
        keys[0] == keys[1]
    }

    /// The file a save replaces, fully resolved. A symlinked document is
    /// written through to its target; a link to a missing file is refused.
    fn write_target_of(&self, id: &str, path: &Path) -> Result<PathBuf, HostError> {
        let entry = match std::fs::symlink_metadata(path) {
            Ok(entry) => entry,
            Err(err) if err.kind() == ErrorKind::NotFound => {
                let dir = std::fs::canonicalize(&self.dir).unwrap_or_else(|_| self.dir.clone());
                return Ok(dir.join(path.file_name().unwrap_or_default()));
            }
            Err(err) => return Err(unavailable(format!("Cannot read {id}.json."), path, &err)),
        };
        match std::fs::canonicalize(path) {
            Ok(real) => Ok(real),
            Err(_) if !entry.file_type().is_symlink() => Ok(path.to_path_buf()),
            Err(err) => Err(unavailable(
                format!("{id}.json is a link to a missing file."),
                path,
                &err,
            )),
        }
    }

    pub async fn load(&self, id: &str) -> Result<Loaded, Fault> {
        let path = self.path_of(id).await?;
        let Some(bytes) = self.read_bytes(id, &path)? else {
            // Refuses a link to a missing file, which a save would refuse.
            self.write_target_of(id, &path)?;
            return Ok(Loaded::missing(None));
        };
        self.assert_exact_name(id, &path)?;
        let text = String::from_utf8_lossy(&bytes);
        let parsed = self
            .bundle
            .call_raw(
                "mcpParseDocument",
                &Obj::new().str("id", id).str("text", &text).finish(),
            )
            .await?;
        if let Some(error) = parsed.value("error") {
            return Err(HostError::as_is(error).into());
        }
        let document = parsed
            .text("document")
            .ok_or_else(|| Fault::Internal("mcpParseDocument gave no document".to_owned()))?;
        Ok(Loaded {
            document: document.to_owned(),
            version: Some(sha256_hex(&bytes)),
            missing: false,
        })
    }

    /// `text` is the exact file content; the new version is its SHA-256.
    pub async fn save(
        &self,
        id: &str,
        text: &str,
        if_version: Option<&str>,
    ) -> Result<Option<String>, Fault> {
        let path = self.path_of(id).await?;
        let target = self.write_target_of(id, &path)?;
        let _turn = self.queues.turn(&same_file_key(&target)).await;
        let held = self.lock(id, &target).await?;
        let saved = self.save_locked(id, &path, &target, text, if_version).await;
        let _ = std::fs::remove_file(&held);
        Ok(Some(saved?))
    }

    async fn lock(&self, id: &str, target: &Path) -> Result<PathBuf, HostError> {
        let name = target
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let path = target
            .parent()
            .unwrap_or(Path::new("."))
            .join(format!(".{name}.lock"));
        let deadline = tokio::time::Instant::now() + LOCK_WAIT;
        loop {
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(_) => return Ok(path),
                Err(err) if err.kind() == ErrorKind::AlreadyExists => {}
                Err(err) => {
                    return Err(unavailable(format!("Cannot write {id}.json."), &path, &err));
                }
            }
            let stale = std::fs::metadata(&path)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|modified| SystemTime::now().duration_since(modified).ok())
                .is_some_and(|age| age > LOCK_STALE);
            // Not atomic: two waiters may both judge one lock stale.
            if stale {
                let _ = std::fs::remove_file(&path);
                continue;
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(unavailable(
                    format!("{id}.json is being saved by another process. Retry shortly."),
                    &path,
                    &"lock held",
                ));
            }
            tokio::time::sleep(LOCK_RETRY).await;
        }
    }

    async fn save_locked(
        &self,
        id: &str,
        path: &Path,
        target: &Path,
        text: &str,
        if_version: Option<&str>,
    ) -> Result<String, Fault> {
        // The target was resolved before the wait; a link pointed elsewhere
        // since would be checked against one file and written to another.
        if same_file_key(&self.write_target_of(id, path)?) != same_file_key(target) {
            return Err(changed().into());
        }
        let current = self.read_bytes(id, path)?;
        if current.is_some() {
            self.assert_exact_name(id, path)?;
        }
        if current.as_deref().map(sha256_hex).as_deref() != if_version {
            return Err(changed().into());
        }
        let dir = target.parent().unwrap_or(Path::new("."));
        let mut suffix = [0u8; 6];
        SystemRandom::new()
            .fill(&mut suffix)
            .map_err(|_| Fault::Internal("the system random source failed".to_owned()))?;
        let suffix: String = suffix.iter().map(|b| format!("{b:02x}")).collect();
        let temp = dir.join(format!(".{id}.{suffix}.tmp"));
        let mode = file_mode(target);
        if let Err(err) = write_and_rename(&temp, target, text, mode).await {
            let _ = std::fs::remove_file(&temp);
            return Err(unavailable(format!("Cannot write {id}.json."), path, &err).into());
        }
        sync_dir(dir);
        Ok(sha256_hex(text.as_bytes()))
    }

    pub async fn list(
        &self,
        query: Option<&str>,
        cursor: Option<&str>,
        limit: f64,
    ) -> Result<Listing, Fault> {
        let names = self.list_names()?;
        let ids = self
            .bundle
            .call("mcpFileIds", &json!({ "names": names }).to_string())
            .await?;
        let ids: Vec<String> = ids
            .get("ids")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        let entries: Vec<Value> = ids
            .iter()
            .map(|id| {
                let text = std::fs::read(self.dir.join(file_name(id)))
                    .ok()
                    .map(|bytes| String::from_utf8_lossy(&bytes).into_owned());
                json!({ "id": id, "text": text })
            })
            .collect();
        let mut input = json!({ "entries": entries, "limit": limit });
        if let Some(query) = query {
            input["query"] = Value::String(query.to_owned());
        }
        if let Some(cursor) = cursor {
            input["cursor"] = Value::String(cursor.to_owned());
        }
        let page = self.bundle.call("mcpFilesList", &input.to_string()).await?;
        Ok(Listing::from_page(&page))
    }
}

#[cfg(unix)]
fn file_mode(path: &Path) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .ok()
        .map(|m| m.permissions().mode() & 0o7777)
}

#[cfg(not(unix))]
fn file_mode(_path: &Path) -> Option<u32> {
    None
}

async fn write_and_rename(
    temp: &Path,
    target: &Path,
    text: &str,
    mode: Option<u32>,
) -> std::io::Result<()> {
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temp)
        .await?;
    file.write_all(text.as_bytes()).await?;
    file.sync_all().await?;
    drop(file);
    // The umask filters a create mode, so set the original one explicitly.
    #[cfg(unix)]
    if let Some(mode) = mode {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(temp, std::fs::Permissions::from_mode(mode))?;
    }
    #[cfg(not(unix))]
    let _ = mode;
    std::fs::rename(temp, target)
}

// Makes the rename durable. Best effort: some platforms refuse to sync a directory.
fn sync_dir(dir: &Path) {
    if let Ok(handle) = std::fs::File::open(dir) {
        let _ = handle.sync_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_version_is_the_lower_case_sha256_of_the_bytes() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[tokio::test]
    async fn a_finished_save_leaves_no_queue_behind() {
        let queues = SaveQueues::default();
        let first = queues.turn("a").await;
        let second = {
            let queues = SaveQueues(queues.0.clone());
            tokio::spawn(async move {
                drop(queues.turn("a").await);
            })
        };
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        drop(first);
        assert_eq!(queues.len(), 1, "a waiting save lost its queue");
        second.await.unwrap();
        assert_eq!(queues.len(), 0);
        drop(queues.turn("b").await);
        assert_eq!(queues.len(), 0);
        // A save cancelled while it waited leaves nothing either.
        let held = queues.turn("c").await;
        let cancelled = {
            let queues = SaveQueues(queues.0.clone());
            tokio::spawn(async move {
                drop(queues.turn("c").await);
            })
        };
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        cancelled.abort();
        let _ = cancelled.await;
        drop(held);
        assert_eq!(queues.len(), 0);
    }

    #[test]
    fn same_file_keys_ignore_letter_case() {
        assert_eq!(
            same_file_key(Path::new("/A/Doc.json")),
            same_file_key(Path::new("/a/doc.JSON"))
        );
    }
}

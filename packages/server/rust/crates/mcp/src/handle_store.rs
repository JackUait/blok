//! Where stored-mode handles live when several processes serve one agent
//! (`Hooks::handle_store`, `--handle-store`), as Node's BlokMcpHandleStore.
//! Without a store, handles stay in this process (`handles.rs`), as before.
//! Live handles hold sockets, so they always stay in this process.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use serde_json::value::RawValue;

use crate::uploads::BoxFuture;

/// A store failure. Blok logs it in full; the agent sees
/// `SOURCE_UNAVAILABLE` "The handle store is unavailable. Retry shortly.".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoreError(pub String);

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for StoreError {}

impl From<std::io::Error> for StoreError {
    fn from(err: std::io::Error) -> Self {
        StoreError(err.to_string())
    }
}

/// One stored-mode handle, as a store keeps it: JSON, written by Blok.
/// Records are trusted: anyone who can write the store can forge one.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandleRecord {
    /// The record format. A record that is not 1 answers `UNKNOWN_HANDLE`.
    pub v: u64,
    /// The tool contract of the server that opened the handle. Another one
    /// answers `VERSION_SKEW`.
    #[serde(rename = "contractRevision")]
    pub contract_revision: String,
    /// The opener. A call from another principal answers `UNKNOWN_HANDLE`.
    pub principal: String,
    #[serde(rename = "clientName")]
    pub client_name: String,
    /// None and an empty list are different: keep them apart.
    pub scopes: Option<Vec<String>>,
    /// The opener's agent actor (`AgentActor::to_value`).
    pub actor: Value,
    #[serde(rename = "documentId")]
    pub document_id: String,
    pub write: bool,
    /// The source version the next save sends as its if-version.
    pub version: Option<String>,
    /// The last save or reload failed: the next call reloads first.
    pub stale: bool,
    /// The document as the handle holds it, as the engine wrote it.
    pub document: Box<RawValue>,
    /// Undo and redo steps, each a whole document. Not bounded in bytes: the
    /// newest step is always kept, so a store must take large values.
    pub history: Box<RawValue>,
}

impl HandleRecord {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    pub fn from_json(text: &str) -> Result<HandleRecord, StoreError> {
        serde_json::from_str(text).map_err(|err| StoreError(format!("a bad handle record: {err}")))
    }
}

/// One call's hold on a handle. A lease is time-limited: Blok renews it
/// while a call runs, and a holder that stops renewing can lose it. Every
/// operation is checked against the lease: once lost, `save`, `renew` and
/// `remove` fail and `release` does nothing.
pub trait HandleLease: Send + Sync {
    fn record(&self) -> &HandleRecord;
    /// Replaces the record. Blok calls it after the source save.
    fn save(&self, record: HandleRecord) -> BoxFuture<'_, Result<(), StoreError>>;
    /// Keeps the lease while a call runs.
    fn renew(&self) -> BoxFuture<'_, Result<(), StoreError>>;
    /// Forgets the handle (blok_close, or a record that could not be saved).
    fn remove(&self) -> BoxFuture<'_, Result<(), StoreError>>;
    /// Ends the lease and restarts the handle's idle time.
    fn release(&self) -> BoxFuture<'_, Result<(), StoreError>>;
}

pub enum Acquired {
    Lease(Box<dyn HandleLease>),
    /// No such handle, or it expired.
    Unknown,
    /// Still leased when the wait ended.
    Busy,
}

/// Where stored-mode handles live, so any process sharing the store can
/// serve a call. Blok passes only handles of `[A-Za-z0-9_-]{1,128}`.
pub trait HandleStore: Send + Sync {
    /// The principal's handles that have not expired.
    fn count(&self, principal: String, idle: Duration) -> BoxFuture<'_, Result<usize, StoreError>>;
    /// Counts and adds as one step, per principal: false, and nothing added,
    /// when the principal already holds `max_per_principal`.
    fn try_add(
        &self,
        handle: String,
        record: HandleRecord,
        max_per_principal: usize,
        idle: Duration,
    ) -> BoxFuture<'_, Result<bool, StoreError>>;
    /// Waits up to `timeout` for the lease. A handle not leased for longer
    /// than `idle` has expired.
    fn acquire(
        &self,
        handle: String,
        idle: Duration,
        timeout: Duration,
    ) -> BoxFuture<'_, Result<Acquired, StoreError>>;
    /// Deletes every handle idle longer than `idle` and not leased. Blok calls
    /// it on a timer. A store whose records expire on their own may do nothing.
    fn sweep(&self, idle: Duration) -> BoxFuture<'_, Result<(), StoreError>>;
}

/// The handle names Blok mints and a store may be given.
pub fn is_store_handle(handle: &str) -> bool {
    (1..=128).contains(&handle.len())
        && handle
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

struct Entry {
    record: HandleRecord,
    last_used: Instant,
    /// The lease holding it, by number.
    leased: Option<u64>,
}

#[derive(Default)]
struct Memory {
    entries: HashMap<String, Entry>,
    next_lease: u64,
}

/// The store contract in one process's memory: for tests, and as the
/// reference the files store matches. A server without a store keeps its
/// handles in `handles.rs`, not here.
#[derive(Clone, Default)]
pub struct MemoryHandleStore {
    state: Arc<Mutex<Memory>>,
    released: Arc<tokio::sync::Notify>,
}

impl MemoryHandleStore {
    pub fn new() -> MemoryHandleStore {
        MemoryHandleStore::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Memory> {
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn expired(entry: &Entry, idle: Duration) -> bool {
        entry.leased.is_none() && entry.last_used.elapsed() > idle
    }

    fn count_in(memory: &Memory, principal: &str, idle: Duration) -> usize {
        memory
            .entries
            .values()
            .filter(|e| e.record.principal == principal && !Self::expired(e, idle))
            .count()
    }
}

struct MemoryLease {
    store: MemoryHandleStore,
    handle: String,
    id: u64,
    record: HandleRecord,
}

impl MemoryLease {
    /// Runs `f` on the entry only while this lease holds it.
    fn holding<T>(&self, f: impl FnOnce(&mut Memory) -> T) -> Result<T, StoreError> {
        let mut memory = self.store.lock();
        let holds = memory
            .entries
            .get(&self.handle)
            .is_some_and(|e| e.leased == Some(self.id));
        if !holds {
            return Err(StoreError(format!("the lease on {} was lost", self.handle)));
        }
        Ok(f(&mut memory))
    }
}

impl HandleLease for MemoryLease {
    fn record(&self) -> &HandleRecord {
        &self.record
    }

    fn save(&self, record: HandleRecord) -> BoxFuture<'_, Result<(), StoreError>> {
        let saved = self.holding(|memory| {
            if let Some(entry) = memory.entries.get_mut(&self.handle) {
                entry.record = record;
            }
        });
        Box::pin(async move { saved })
    }

    fn renew(&self) -> BoxFuture<'_, Result<(), StoreError>> {
        let held = self.holding(|_| ());
        Box::pin(async move { held })
    }

    fn remove(&self) -> BoxFuture<'_, Result<(), StoreError>> {
        let removed = self.holding(|memory| {
            memory.entries.remove(&self.handle);
        });
        self.store.released.notify_waiters();
        Box::pin(async move { removed })
    }

    fn release(&self) -> BoxFuture<'_, Result<(), StoreError>> {
        let _ = self.holding(|memory| {
            if let Some(entry) = memory.entries.get_mut(&self.handle) {
                entry.leased = None;
                entry.last_used = Instant::now();
            }
        });
        self.store.released.notify_waiters();
        Box::pin(async { Ok(()) })
    }
}

impl HandleStore for MemoryHandleStore {
    fn count(&self, principal: String, idle: Duration) -> BoxFuture<'_, Result<usize, StoreError>> {
        let count = Self::count_in(&self.lock(), &principal, idle);
        Box::pin(async move { Ok(count) })
    }

    fn try_add(
        &self,
        handle: String,
        record: HandleRecord,
        max_per_principal: usize,
        idle: Duration,
    ) -> BoxFuture<'_, Result<bool, StoreError>> {
        let added = {
            let mut memory = self.lock();
            if memory.entries.contains_key(&handle) {
                Err(StoreError(format!("handle {handle} is taken")))
            } else if Self::count_in(&memory, &record.principal, idle) >= max_per_principal {
                Ok(false)
            } else {
                memory.entries.insert(
                    handle,
                    Entry {
                        record,
                        last_used: Instant::now(),
                        leased: None,
                    },
                );
                Ok(true)
            }
        };
        Box::pin(async move { added })
    }

    fn acquire(
        &self,
        handle: String,
        idle: Duration,
        timeout: Duration,
    ) -> BoxFuture<'_, Result<Acquired, StoreError>> {
        Box::pin(async move {
            let deadline = tokio::time::Instant::now() + timeout;
            loop {
                let released = self.released.notified();
                tokio::pin!(released);
                released.as_mut().enable();
                {
                    let mut memory = self.lock();
                    let expired = memory
                        .entries
                        .get(&handle)
                        .is_some_and(|e| Self::expired(e, idle));
                    if expired {
                        memory.entries.remove(&handle);
                    }
                    memory.next_lease += 1;
                    let id = memory.next_lease;
                    let Some(entry) = memory.entries.get_mut(&handle) else {
                        return Ok(Acquired::Unknown);
                    };
                    if entry.leased.is_none() {
                        entry.leased = Some(id);
                        return Ok(Acquired::Lease(Box::new(MemoryLease {
                            store: self.clone(),
                            handle,
                            id,
                            record: entry.record.clone(),
                        })));
                    }
                }
                if tokio::time::timeout_at(deadline, released).await.is_err() {
                    return Ok(Acquired::Busy);
                }
            }
        })
    }

    fn sweep(&self, idle: Duration) -> BoxFuture<'_, Result<(), StoreError>> {
        self.lock()
            .entries
            .retain(|_, entry| !Self::expired(entry, idle));
        Box::pin(async { Ok(()) })
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn record(principal: &str) -> HandleRecord {
        HandleRecord {
            v: 1,
            contract_revision: "rev".to_owned(),
            principal: principal.to_owned(),
            client_name: "Desk".to_owned(),
            scopes: None,
            actor: serde_json::json!({ "id": "agent:a:Desk", "name": "Desk (for a)", "kind": "agent" }),
            document_id: "doc".to_owned(),
            write: true,
            version: Some("1".to_owned()),
            stale: false,
            document: RawValue::from_string(r#"{"blocks":[]}"#.to_owned()).unwrap(),
            history: RawValue::from_string("{}".to_owned()).unwrap(),
        }
    }

    #[test]
    fn a_record_keeps_null_and_empty_scopes_apart_and_its_document_as_written() {
        let mut with_none = record("a");
        with_none.document = RawValue::from_string(r#"{"blocks":[],"n":1.50}"#.to_owned()).unwrap();
        let text = with_none.to_json();
        assert!(text.contains(r#""scopes":null"#), "{text}");
        assert!(
            text.contains(r#""document":{"blocks":[],"n":1.50}"#),
            "{text}"
        );
        let back = HandleRecord::from_json(&text).unwrap();
        assert_eq!(back.scopes, None);
        let mut with_empty = record("a");
        with_empty.scopes = Some(Vec::new());
        assert!(with_empty.to_json().contains(r#""scopes":[]"#));
        assert_eq!(
            HandleRecord::from_json(&with_empty.to_json())
                .unwrap()
                .scopes,
            Some(Vec::new())
        );
    }

    #[test]
    fn only_minted_handle_shapes_reach_a_store() {
        assert!(is_store_handle("abcDEF019-_"));
        assert!(is_store_handle(&"a".repeat(128)));
        for bad in ["", "../x", "a/b", ".", "a b", "\u{0}", "é"] {
            assert!(!is_store_handle(bad), "{bad:?}");
        }
        assert!(!is_store_handle(&"a".repeat(129)));
    }

    #[tokio::test]
    async fn a_leased_handle_waits_then_answers_busy_and_a_lost_lease_cannot_write() {
        let store = MemoryHandleStore::new();
        let idle = Duration::from_secs(60);
        assert!(
            store
                .try_add("h".into(), record("a"), 8, idle)
                .await
                .unwrap()
        );
        let Acquired::Lease(first) = store
            .acquire("h".into(), idle, Duration::ZERO)
            .await
            .unwrap()
        else {
            panic!("no lease");
        };
        assert!(matches!(
            store
                .acquire("h".into(), idle, Duration::from_millis(30))
                .await
                .unwrap(),
            Acquired::Busy
        ));
        first.release().await.unwrap();
        assert!(first.save(record("a")).await.is_err());
        assert!(first.remove().await.is_err());
        let Acquired::Lease(second) = store
            .acquire("h".into(), idle, Duration::ZERO)
            .await
            .unwrap()
        else {
            panic!("no lease");
        };
        second.remove().await.unwrap();
        assert!(matches!(
            store
                .acquire("h".into(), idle, Duration::ZERO)
                .await
                .unwrap(),
            Acquired::Unknown
        ));
    }

    #[tokio::test]
    async fn sweep_deletes_idle_handles_only() {
        let store = MemoryHandleStore::new();
        let idle = Duration::from_millis(20);
        store
            .try_add("idle".into(), record("a"), 8, idle)
            .await
            .unwrap();
        store
            .try_add("held".into(), record("a"), 8, idle)
            .await
            .unwrap();
        let Acquired::Lease(held) = store
            .acquire("held".into(), idle, Duration::ZERO)
            .await
            .unwrap()
        else {
            panic!("no lease");
        };
        tokio::time::sleep(Duration::from_millis(40)).await;
        store
            .try_add("fresh".into(), record("a"), 8, idle)
            .await
            .unwrap();
        store.sweep(idle).await.unwrap();
        let left: Vec<String> = {
            let mut keys: Vec<String> = store.lock().entries.keys().cloned().collect();
            keys.sort();
            keys
        };
        assert_eq!(left, vec!["fresh", "held"]);
        held.release().await.unwrap();
    }
}

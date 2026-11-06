//! Open documents by handle, per principal (src/mcp/handles.ts). Calls on
//! one handle run one at a time, in arrival order: tokio's Mutex is FIFO.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::rand::{SecureRandom, SystemRandom};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

use crate::errors::HostError;

struct Entry<S> {
    principal: String,
    document_id: String,
    session: Arc<AsyncMutex<S>>,
    last_used: Instant,
    busy: usize,
}

struct State<S> {
    entries: HashMap<String, Entry<S>>,
    closed: bool,
}

pub struct Handles<S> {
    state: Mutex<State<S>>,
    idle: Duration,
    max_per_principal: usize,
}

fn unknown_handle() -> HostError {
    HostError::surface(
        "UNKNOWN_HANDLE",
        "No open document has this handle. It may have expired; call blok_open again.",
    )
}

fn new_handle() -> String {
    let mut bytes = [0u8; 16];
    SystemRandom::new()
        .fill(&mut bytes)
        .expect("the system random source failed");
    URL_SAFE_NO_PAD.encode(bytes)
}

/// A call's hold on a handle's session. Dropping it refreshes the idle time.
pub struct Lease<S: Send + 'static> {
    handles: Arc<Handles<S>>,
    handle: String,
    pub document_id: String,
    pub session: OwnedMutexGuard<S>,
}

impl<S: Send + 'static> Drop for Lease<S> {
    fn drop(&mut self) {
        let mut state = self.handles.lock();
        if let Some(entry) = state.entries.get_mut(&self.handle) {
            entry.busy -= 1;
            entry.last_used = Instant::now();
        }
    }
}

impl<S: Send + 'static> Handles<S> {
    pub fn new(idle: Duration, max_per_principal: usize) -> Arc<Handles<S>> {
        Arc::new(Handles {
            state: Mutex::new(State {
                entries: HashMap::new(),
                closed: false,
            }),
            idle,
            max_per_principal,
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State<S>> {
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn check_room(&self, state: &State<S>, principal: &str) -> Result<(), HostError> {
        if state.closed {
            return Err(HostError::surface(
                "SOURCE_UNAVAILABLE",
                "The server is shutting down.",
            ));
        }
        let count = state
            .entries
            .values()
            .filter(|e| e.principal == principal)
            .count();
        if count >= self.max_per_principal {
            return Err(HostError::surface(
                "HANDLE_LIMIT",
                format!(
                    "You already have {} open documents. Close one with blok_close.",
                    self.max_per_principal
                ),
            ));
        }
        Ok(())
    }

    /// Refuses when `add` would, so a caller can refuse before opening.
    pub fn assert_room(&self, principal: &str) -> Result<(), HostError> {
        self.check_room(&self.lock(), principal)
    }

    pub fn add(&self, principal: &str, document_id: &str, session: S) -> Result<String, HostError> {
        let mut state = self.lock();
        // Checked again: concurrent opens can pass assert_room together.
        self.check_room(&state, principal)?;
        let handle = new_handle();
        state.entries.insert(
            handle.clone(),
            Entry {
                principal: principal.to_owned(),
                document_id: document_id.to_owned(),
                session: Arc::new(AsyncMutex::new(session)),
                last_used: Instant::now(),
                busy: 0,
            },
        );
        Ok(handle)
    }

    /// Waits its turn on the handle, then holds the session.
    pub async fn use_handle(
        self: &Arc<Self>,
        handle: &str,
        principal: &str,
    ) -> Result<Lease<S>, HostError> {
        let (session, document_id) = {
            let mut state = self.lock();
            let entry = state
                .entries
                .get_mut(handle)
                .filter(|e| e.principal == principal)
                .ok_or_else(unknown_handle)?;
            entry.busy += 1;
            entry.last_used = Instant::now();
            (entry.session.clone(), entry.document_id.clone())
        };
        let guard = session.lock_owned().await;
        Ok(Lease {
            handles: self.clone(),
            handle: handle.to_owned(),
            document_id,
            session: guard,
        })
    }

    /// Refuses new calls at once, then waits for the accepted ones.
    pub async fn remove(
        &self,
        handle: &str,
        principal: &str,
    ) -> Result<OwnedMutexGuard<S>, HostError> {
        let session = {
            let mut state = self.lock();
            match state.entries.get(handle) {
                Some(entry) if entry.principal == principal => {}
                _ => return Err(unknown_handle()),
            }
            state
                .entries
                .remove(handle)
                .map(|e| e.session)
                .ok_or_else(unknown_handle)?
        };
        Ok(session.lock_owned().await)
    }

    /// Drops idle handles with no call in flight. Returns how many.
    pub fn sweep(&self) -> usize {
        let mut state = self.lock();
        let now = Instant::now();
        let before = state.entries.len();
        state
            .entries
            .retain(|_, e| e.busy != 0 || now.duration_since(e.last_used) <= self.idle);
        before - state.entries.len()
    }

    pub fn close_all(&self) {
        let mut state = self.lock();
        state.closed = true;
        state.entries.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles_are_22_url_safe_characters() {
        let handle = new_handle();
        assert_eq!(handle.len(), 22);
        assert!(
            handle
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        );
    }

    #[tokio::test]
    async fn the_cap_counts_per_principal() {
        let handles = Handles::new(Duration::from_secs(60), 1);
        handles.add("a", "doc", ()).unwrap();
        let refused = handles.add("a", "doc", ()).unwrap_err();
        assert_eq!(refused.code(), "HANDLE_LIMIT");
        assert_eq!(
            refused.error["message"],
            "You already have 1 open documents. Close one with blok_close."
        );
        assert!(handles.add("b", "doc", ()).is_ok());
    }

    #[tokio::test]
    async fn another_principal_cannot_use_or_remove_a_handle() {
        let handles = Handles::new(Duration::from_secs(60), 8);
        let handle = handles.add("a", "doc", ()).unwrap();
        assert_eq!(
            handles.use_handle(&handle, "b").await.err().unwrap().code(),
            "UNKNOWN_HANDLE"
        );
        assert_eq!(
            handles.remove(&handle, "b").await.err().unwrap().code(),
            "UNKNOWN_HANDLE"
        );
        assert!(handles.use_handle(&handle, "a").await.is_ok());
    }

    #[tokio::test]
    async fn a_removed_handle_is_unknown() {
        let handles = Handles::new(Duration::from_secs(60), 8);
        let handle = handles.add("a", "doc", ()).unwrap();
        drop(handles.remove(&handle, "a").await.unwrap());
        assert_eq!(
            handles.use_handle(&handle, "a").await.err().unwrap().code(),
            "UNKNOWN_HANDLE"
        );
    }

    #[tokio::test]
    async fn sweep_keeps_busy_handles_and_drops_idle_ones() {
        let handles = Handles::new(Duration::from_millis(10), 8);
        let busy = handles.add("a", "x", ()).unwrap();
        handles.add("a", "y", ()).unwrap();
        let lease = handles.use_handle(&busy, "a").await.unwrap();
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert_eq!(handles.sweep(), 1);
        drop(lease);
        assert!(handles.use_handle(&busy, "a").await.is_ok());
    }

    #[tokio::test]
    async fn calls_on_one_handle_run_one_at_a_time() {
        let handles = Handles::new(Duration::from_secs(60), 8);
        let handle = handles.add("a", "doc", 0u32).unwrap();
        let first = handles.use_handle(&handle, "a").await.unwrap();
        let waiting = {
            let handles = handles.clone();
            let handle = handle.clone();
            tokio::spawn(async move {
                let mut lease = handles.use_handle(&handle, "a").await.unwrap();
                *lease.session += 1;
                *lease.session
            })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!waiting.is_finished());
        drop(first);
        assert_eq!(waiting.await.unwrap(), 1);
    }
}

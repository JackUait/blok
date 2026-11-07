//! Open documents by handle, per principal (src/mcp/handles.ts). Calls on
//! one handle run one at a time, in arrival order: a call takes its turn
//! before its first await (Handles::reserve), as Node's one event loop
//! takes calls.

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
    /// Per handle: the next ticket to give, the one being served, and the
    /// later ones that ended before their turn.
    turns: Mutex<HashMap<String, Line>>,
    turned: tokio::sync::Notify,
}

/// Turns taken as stdio read each call, until its task claims it. One id
/// can come twice (Node runs both, in order), so each waits under its id and
/// its arguments; an id's unclaimed turns go once every request with it has
/// ended, so a request the server never ran cannot hold the line.
pub struct Booked<S: Send + 'static> {
    turns: HashMap<String, std::collections::VecDeque<Turn<S>>>,
    open: HashMap<String, usize>,
}

impl<S: Send + 'static> Default for Booked<S> {
    fn default() -> Self {
        Booked {
            turns: HashMap::new(),
            open: HashMap::new(),
        }
    }
}

fn booked_key(id: &str, arguments: &str) -> String {
    format!("{id}\u{0}{arguments}")
}

impl<S: Send + 'static> Booked<S> {
    pub fn read(&mut self, id: &str, arguments: &str, turn: Turn<S>) {
        *self.open.entry(id.to_owned()).or_default() += 1;
        self.turns
            .entry(booked_key(id, arguments))
            .or_default()
            .push_back(turn);
    }

    /// The call's own turn, when stdio took one for it. Any turn of the
    /// same id otherwise: an unclaimed turn ahead of a new one would wait
    /// for itself.
    pub fn take(&mut self, id: &str, arguments: &str) -> Option<Turn<S>> {
        let exact = booked_key(id, arguments);
        let prefix = booked_key(id, "");
        let key = if self.turns.contains_key(&exact) {
            exact
        } else {
            self.turns
                .keys()
                .find(|key| key.starts_with(&prefix))?
                .clone()
        };
        let queue = self.turns.get_mut(&key)?;
        let turn = queue.pop_front();
        if queue.is_empty() {
            self.turns.remove(&key);
        }
        turn
    }

    /// One request with this id was answered or cancelled.
    pub fn ended(&mut self, id: &str) {
        let Some(open) = self.open.get_mut(id) else {
            return;
        };
        *open = open.saturating_sub(1);
        if *open == 0 {
            self.open.remove(id);
            let prefix = booked_key(id, "");
            self.turns.retain(|key, _| !key.starts_with(&prefix));
        }
    }
}

#[derive(Default)]
struct Line {
    next: u64,
    serving: u64,
    finished: std::collections::BTreeSet<u64>,
}

/// A call's place in a handle's line. Its turn ends when it is dropped.
pub struct Turn<S: Send + 'static> {
    handles: Arc<Handles<S>>,
    handle: String,
    ticket: u64,
    /// It counted as busy on the handle from its arrival, as Node's use does.
    pinned: bool,
}

impl<S: Send + 'static> Turn<S> {
    /// Waits until every call that came before on this handle is done.
    pub async fn wait(&self) {
        loop {
            let turned = self.handles.turned.notified();
            tokio::pin!(turned);
            turned.as_mut().enable();
            let serving = self
                .handles
                .turns_lock()
                .get(&self.handle)
                .map(|t| t.serving);
            if serving == Some(self.ticket) {
                return;
            }
            turned.await;
        }
    }
}

impl<S: Send + 'static> Drop for Turn<S> {
    fn drop(&mut self) {
        let mut turns = self.handles.turns_lock();
        if let Some(line) = turns.get_mut(&self.handle) {
            // Only the served ticket moves the line, past every later one
            // that already ended; one that ends early just waits to be passed.
            if self.ticket == line.serving {
                line.serving += 1;
                while line.finished.remove(&line.serving) {
                    line.serving += 1;
                }
            } else {
                line.finished.insert(self.ticket);
            }
            if line.serving == line.next {
                turns.remove(&self.handle);
            }
        }
        drop(turns);
        self.handles.turned.notify_waiters();
        if self.pinned {
            let mut state = self.handles.lock();
            if let Some(entry) = state.entries.get_mut(&self.handle) {
                entry.busy -= 1;
                entry.last_used = Instant::now();
            }
        }
    }
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
            turns: Mutex::new(HashMap::new()),
            turned: tokio::sync::Notify::new(),
        })
    }

    fn turns_lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Line>> {
        self.turns.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Takes the next place in `handle`'s line. Synchronous, so calls get
    /// their places in the order they arrived.
    /// A call of `principal` on its open handle counts as busy from now, so
    /// the sweep keeps the handle while the call waits.
    pub fn reserve(self: &Arc<Self>, handle: &str, principal: &str) -> Turn<S> {
        let pinned = {
            let mut state = self.lock();
            match state.entries.get_mut(handle) {
                Some(entry) if entry.principal == principal => {
                    entry.busy += 1;
                    entry.last_used = Instant::now();
                    true
                }
                _ => false,
            }
        };
        let mut turns = self.turns_lock();
        let line = turns.entry(handle.to_owned()).or_default();
        let ticket = line.next;
        line.next += 1;
        Turn {
            handles: self.clone(),
            handle: handle.to_owned(),
            ticket,
            pinned,
        }
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

    /// From a stop's first signal: no new handle opens, and the open ones
    /// keep serving the calls the stop waits for (Node closes them first).
    pub fn stop_opening(&self) {
        self.lock().closed = true;
    }

    /// Closes the table and hands back every session, for the caller to
    /// close once the calls on it are done (Node's closeAll).
    pub fn take_all(&self) -> Vec<Arc<AsyncMutex<S>>> {
        let mut state = self.lock();
        state.closed = true;
        state.entries.drain().map(|(_, e)| e.session).collect()
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
    async fn calls_on_one_handle_take_turns_in_the_order_they_came() {
        let handles: Arc<Handles<()>> = Handles::new(Duration::from_secs(60), 8);
        let first = handles.reserve("h", "a");
        let second = handles.reserve("h", "a");
        let order = Arc::new(std::sync::Mutex::new(Vec::new()));
        let waiting = {
            let order = order.clone();
            tokio::spawn(async move {
                second.wait().await;
                order.lock().unwrap().push("second");
            })
        };
        tokio::time::sleep(Duration::from_millis(30)).await;
        first.wait().await;
        order.lock().unwrap().push("first");
        drop(first);
        waiting.await.unwrap();
        assert_eq!(*order.lock().unwrap(), vec!["first", "second"]);
        // Another handle never waits for this one.
        let other = handles.reserve("k", "a");
        tokio::time::timeout(Duration::from_millis(50), other.wait())
            .await
            .unwrap();
    }

    async fn runs_now(turn: &Turn<()>) -> bool {
        tokio::time::timeout(Duration::from_millis(40), turn.wait())
            .await
            .is_ok()
    }

    #[tokio::test]
    async fn a_cancelled_waiting_call_keeps_the_others_in_order_and_one_at_a_time() {
        let handles: Arc<Handles<()>> = Handles::new(Duration::from_secs(60), 8);
        let (first, second, third) = (
            handles.reserve("h", "a"),
            handles.reserve("h", "a"),
            handles.reserve("h", "a"),
        );
        assert!(runs_now(&first).await);
        drop(second);
        assert!(!runs_now(&third).await, "the third ran beside the first");
        drop(first);
        assert!(runs_now(&third).await);
        let fourth = handles.reserve("h", "a");
        assert!(!runs_now(&fourth).await);
        drop(third);
        assert!(runs_now(&fourth).await);
    }

    #[tokio::test]
    async fn a_cancelled_later_call_does_not_let_the_next_one_run_beside_the_first() {
        let handles: Arc<Handles<()>> = Handles::new(Duration::from_secs(60), 8);
        let (first, second, third) = (
            handles.reserve("h", "a"),
            handles.reserve("h", "a"),
            handles.reserve("h", "a"),
        );
        assert!(runs_now(&first).await);
        drop(third);
        assert!(!runs_now(&second).await, "the second ran beside the first");
        drop(first);
        assert!(runs_now(&second).await);
        drop(second);
        // The line ended: a new call runs at once.
        assert!(runs_now(&handles.reserve("h", "a")).await);
    }

    #[tokio::test]
    async fn a_cancelled_running_call_lets_the_next_start() {
        let handles: Arc<Handles<()>> = Handles::new(Duration::from_secs(60), 8);
        let (first, second) = (handles.reserve("h", "a"), handles.reserve("h", "a"));
        assert!(!runs_now(&second).await);
        drop(first);
        assert!(runs_now(&second).await);
    }

    #[tokio::test]
    async fn a_reused_id_keeps_both_places_and_ends_only_when_both_did() {
        let handles: Arc<Handles<()>> = Handles::new(Duration::from_secs(60), 8);
        let mut booked = Booked::default();
        booked.read("9", "{\"t\":\"A\"}", handles.reserve("h", "a"));
        booked.read("9", "{\"t\":\"B\"}", handles.reserve("h", "a"));
        let b = booked.take("9", "{\"t\":\"B\"}").unwrap();
        let a = booked.take("9", "{\"t\":\"A\"}").unwrap();
        assert!(runs_now(&a).await);
        assert!(!runs_now(&b).await);
        // An unclaimed place goes once every request with the id ended.
        booked.read("7", "{}", handles.reserve("k", "a"));
        booked.read("7", "{}", handles.reserve("k", "a"));
        booked.ended("7");
        assert!(booked.take("7", "{}").is_some());
        booked.ended("7");
        assert!(booked.take("7", "{}").is_none());
    }

    #[tokio::test]
    async fn a_stopping_server_opens_nothing_but_keeps_serving_its_handles() {
        let handles = Handles::new(Duration::from_secs(60), 8);
        let handle = handles.add("a", "doc", ()).unwrap();
        handles.stop_opening();
        let refused = handles.add("a", "other", ()).unwrap_err();
        assert_eq!(refused.error["message"], "The server is shutting down.");
        assert!(handles.use_handle(&handle, "a").await.is_ok());
    }

    #[tokio::test]
    async fn take_all_hands_back_every_session_and_opens_nothing_more() {
        let handles = Handles::new(Duration::from_secs(60), 8);
        let handle = handles.add("a", "doc", 1u8).unwrap();
        handles.add("b", "doc", 2u8).unwrap();
        let mut taken: Vec<u8> = Vec::new();
        for session in handles.take_all() {
            taken.push(*session.lock().await);
        }
        taken.sort_unstable();
        assert_eq!(taken, vec![1, 2]);
        assert_eq!(
            handles.use_handle(&handle, "a").await.err().unwrap().code(),
            "UNKNOWN_HANDLE"
        );
        assert!(handles.add("a", "doc", 3).is_err());
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

    // Node bumps busy as a call arrives, so a call waiting its turn keeps its handle.
    #[tokio::test]
    async fn a_call_waiting_its_turn_keeps_its_handle_from_the_sweep() {
        let handles: Arc<Handles<()>> = Handles::new(Duration::from_millis(10), 8);
        let handle = handles.add("a", "doc", ()).unwrap();
        let first = handles.reserve(&handle, "a");
        let waiting = handles.reserve(&handle, "a");
        // Another principal's call does not keep it.
        let other = handles.add("a", "other", ()).unwrap();
        let foreign = handles.reserve(&other, "b");
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert_eq!(handles.sweep(), 1);
        drop(first);
        waiting.wait().await;
        assert!(handles.use_handle(&handle, "a").await.is_ok());
        drop(waiting);
        drop(foreign);
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert_eq!(handles.sweep(), 1, "an ended call still kept its handle");
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

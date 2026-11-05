use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::SystemTime;

use blok_collab::{BoxFuture, JoinResult, JoinStatus, Member};
use blok_collab_convert::EditOp;
use blok_collab_journal::PurgeOutcome;

use crate::cancel::{CancelOnDrop, Token};
use crate::lane::Lane;
use crate::ops::{
    Applied, EditRequest, EditResult, EditStatus, PlanOps, Precondition, ResetResult, ResetStatus,
    StateResult, StateStatus,
};
use crate::options::MAX_JOIN_ATTEMPTS;
use crate::room::{Log, Room};
use crate::{
    ActivityObserver, Converter, Endpoint, Error, OperationStore, Options, WorkingSetStore,
};

/// CollabRoomManager's constructor arguments.
pub struct ManagerOptions {
    pub store: Arc<dyn WorkingSetStore>,
    pub endpoint: Arc<dyn Endpoint>,
    pub converter: Arc<dyn Converter>,
    pub room: Options,
    pub log: Option<Log>,
    /// None means no journal: v1 only, no history.
    pub operations: Option<Arc<dyn OperationStore>>,
    pub activity: Option<Arc<dyn ActivityObserver>>,
}

struct Cooldown {
    failures: i64,
    until: SystemTime,
}

#[derive(Default)]
struct Rooms {
    rooms: HashMap<String, Arc<Room>>,
    purge_lanes: HashMap<String, Arc<Lane>>,
    cooldowns: HashMap<String, Cooldown>,
}

type Replaced = Arc<dyn Fn(&str) + Send + Sync>;

pub(crate) struct Shared {
    pub store: Arc<dyn WorkingSetStore>,
    pub endpoint: Arc<dyn Endpoint>,
    pub converter: Arc<dyn Converter>,
    pub options: Options,
    pub log: Option<Log>,
    pub operations: Option<Arc<dyn OperationStore>>,
    pub activity: Option<Arc<dyn ActivityObserver>>,
    rooms: Mutex<Rooms>,
    draining: AtomicBool,
    replaced: Mutex<Vec<Replaced>>,
}

/// Owns one room per open doc: CollabRoomManager. Rooms remove themselves
/// when they close; a call that races a closing room retries on a fresh
/// one. Every room call runs on its own task, so a caller that goes away
/// never stops a lane body halfway; the body sees the caller gone where Go
/// checks ctx.Err().
#[derive(Clone)]
pub struct Manager(pub(crate) Arc<Shared>);

/// Runs work on its own task; a dropped caller cancels `caller`.
async fn spawned<T: Send + 'static>(
    work: impl Future<Output = Result<T, Error>> + Send + 'static,
) -> Result<T, Error> {
    match tokio::spawn(work).await {
        Ok(result) => result,
        Err(err) => Err(Error::message(format!("collab: a room call failed: {err}"))),
    }
}

fn caller() -> (Token, CancelOnDrop) {
    let token = Token::new();
    (token.clone(), CancelOnDrop(token))
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, Rooms> {
        self.rooms.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn logf(&self, message: &str) {
        if let Some(log) = &self.log {
            log(message);
        }
    }

    pub(crate) fn on_room_closed(
        &self,
        room: &Arc<Room>,
        commit_unavailable: bool,
        load_held_off: bool,
    ) {
        let mut rooms = self.lock();
        if commit_unavailable || load_held_off {
            let failures = rooms.cooldowns.get(&room.doc_id).map_or(0, |c| c.failures) + 1;
            let wait = self.options.backoff(failures);
            let until = self
                .options
                .now()
                .checked_add(wait)
                .unwrap_or(SystemTime::UNIX_EPOCH);
            rooms
                .cooldowns
                .insert(room.doc_id.clone(), Cooldown { failures, until });
            if load_held_off {
                self.logf(&format!(
                    "collab: document \"{}\" failed to load in a way the next open repeats, so it is held off for {} (failure {failures}); the room's own log line says why",
                    room.doc_id,
                    time_span(wait)
                ));
            }
        } else {
            // An ordinary close: the next failure starts its wait over.
            rooms.cooldowns.remove(&room.doc_id);
        }
        forget_locked(&mut rooms, room);
    }

    pub(crate) fn is_purging(&self, doc_id: &str) -> bool {
        self.lock().purge_lanes.contains_key(doc_id)
    }

    pub(crate) fn document_replaced(&self, doc_id: &str) {
        let listeners = self
            .replaced
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        for listener in listeners {
            listener(doc_id);
        }
    }
}

fn forget_locked(rooms: &mut Rooms, room: &Arc<Room>) {
    if rooms
        .rooms
        .get(&room.doc_id)
        .is_some_and(|r| Arc::ptr_eq(r, room))
    {
        rooms.rooms.remove(&room.doc_id);
    }
}

/// Go's time.Duration String for the whole seconds and fractions the
/// backoff produces.
/// d as a .NET TimeSpan prints it ("c" format): [d.]hh:mm:ss[.fffffff], in
/// whole 100 ns ticks.
pub(crate) fn time_span(d: std::time::Duration) -> String {
    let ticks = d.as_nanos() / 100;
    let (fraction, seconds) = (ticks % 10_000_000, ticks / 10_000_000);
    let days = seconds / 86_400;
    let mut text = if days > 0 {
        format!("{days}.")
    } else {
        String::new()
    };
    text += &format!(
        "{:02}:{:02}:{:02}",
        seconds / 3600 % 24,
        seconds / 60 % 60,
        seconds % 60
    );
    if fraction > 0 {
        text += &format!(".{fraction:07}");
    }
    text
}

impl Manager {
    /// Builds the manager; nothing is loaded until a doc is used.
    pub fn new(o: ManagerOptions) -> Manager {
        Manager(Arc::new(Shared {
            store: o.store,
            endpoint: o.endpoint,
            converter: o.converter,
            options: o.room.with_defaults(),
            log: o.log,
            operations: o.operations,
            activity: o.activity,
            rooms: Mutex::new(Rooms::default()),
            draining: AtomicBool::new(false),
            replaced: Mutex::new(Vec::new()),
        }))
    }

    /// Registers a DocumentReplaced listener: it fires on a reset, an
    /// applied restore and a purge.
    pub fn on_document_replaced(&self, listener: impl Fn(&str) + Send + Sync + 'static) {
        self.0
            .replaced
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(Arc::new(listener));
    }

    /// How long an overloaded request should wait.
    pub fn retry_after(&self) -> std::time::Duration {
        self.0.options.retry_backoff
    }

    /// An operation store is registered.
    pub fn has_journal(&self) -> bool {
        self.0.operations.is_some()
    }

    /// The number of loaded rooms.
    pub fn live_room_count(&self) -> usize {
        self.0.lock().rooms.len()
    }

    /// The converter the rooms use, which the agent exports with.
    pub fn converter(&self) -> &Arc<dyn Converter> {
        &self.0.converter
    }

    fn draining(&self) -> bool {
        self.0.draining.load(Ordering::SeqCst)
    }

    /// A document whose commit failed, or whose load repeats its failure,
    /// is refused for a doubling wait.
    fn in_commit_cooldown(&self, doc_id: &str) -> bool {
        let rooms = self.0.lock();
        rooms
            .cooldowns
            .get(doc_id)
            .is_some_and(|c| self.0.options.now() < c.until)
    }

    fn room_for(&self, doc_id: &str) -> Option<Arc<Room>> {
        let mut rooms = self.0.lock();
        if rooms.purge_lanes.contains_key(doc_id) {
            return None;
        }
        if let Some(room) = rooms.rooms.get(doc_id) {
            return Some(room.clone());
        }
        let room = Room::new(doc_id, &self.0);
        rooms.rooms.insert(doc_id.to_owned(), room.clone());
        Some(room)
    }

    fn forget(&self, room: &Arc<Room>) {
        forget_locked(&mut self.0.lock(), room);
    }

    pub(crate) fn live_rooms(&self) -> Vec<Arc<Room>> {
        self.0.lock().rooms.values().cloned().collect()
    }

    pub(crate) fn is_purging(&self, doc_id: &str) -> bool {
        self.0.is_purging(doc_id)
    }

    /// JoinAsync.
    pub async fn join(&self, doc_id: &str, member: Arc<dyn Member>) -> Result<JoinResult, Error> {
        let (token, _gone) = caller();
        let status = |status| JoinResult {
            status,
            membership: None,
            err: None,
        };
        for _ in 0..MAX_JOIN_ATTEMPTS {
            if self.is_purging(doc_id) {
                return Ok(status(JoinStatus::Purged));
            }
            if self.draining() {
                return Ok(status(JoinStatus::Draining));
            }
            if self.in_commit_cooldown(doc_id) {
                return Ok(status(JoinStatus::Unavailable));
            }
            let Some(room) = self.room_for(doc_id) else {
                return Ok(status(JoinStatus::Purged));
            };
            let (r, t, m) = (room.clone(), token.clone(), member.clone());
            if let Some(result) = spawned(async move { r.join(&t, m).await }).await? {
                return Ok(result);
            }
            self.forget(&room);
        }
        Err(Error::message(format!(
            "collab: the room for \"{doc_id}\" kept closing during join."
        )))
    }

    /// ResetForHttpAsync.
    pub async fn reset(&self, doc_id: &str) -> Result<ResetResult, Error> {
        let (token, _gone) = caller();
        for _ in 0..MAX_JOIN_ATTEMPTS {
            let Some(room) = self.room_for(doc_id) else {
                return Ok(ResetResult::status(ResetStatus::Purged));
            };
            let (r, t) = (room.clone(), token.clone());
            if let Some(result) = spawned(async move { r.reset(&t).await }).await? {
                self.0.document_replaced(doc_id);
                return Ok(result);
            }
            self.forget(&room);
        }
        Err(Error::message(format!(
            "collab: the room for \"{doc_id}\" kept closing during reset."
        )))
    }

    /// The HTTP edit with the endpoint's idempotency receipt.
    pub async fn edit(
        &self,
        doc_id: &str,
        ops: Vec<EditOp>,
        operation_id: &str,
        digest: &[u8],
        actor_id: &str,
        expect: Option<Precondition>,
    ) -> Result<EditResult, Error> {
        // Checked before a room is made, so no seed GET is spent on it.
        if expect.is_some() && self.0.operations.is_none() {
            return Ok(EditResult::status(EditStatus::PreconditionRequired));
        }
        let ops = Arc::new(ops);
        let plan: PlanOps = Arc::new(move |_| {
            let ops = ops.clone();
            Box::pin(async move { Ok(ops.as_ref().clone()) })
        });
        self.edit_in_room(
            doc_id,
            request(plan, false, operation_id, digest, actor_id, expect, None),
        )
        .await
    }

    /// AgentEditAsync: a batch planned against the live doc inside the
    /// lane, after the duplicate and precondition checks, gated to one
    /// frame.
    #[allow(clippy::too_many_arguments, reason = "the Go and C# signatures")]
    pub async fn agent_edit(
        &self,
        doc_id: &str,
        plan: PlanOps,
        operation_id: &str,
        digest: &[u8],
        actor_id: &str,
        expect: Option<Precondition>,
        applied: Option<Applied>,
    ) -> Result<EditResult, Error> {
        if expect.is_some() && self.0.operations.is_none() {
            return Ok(EditResult::status(EditStatus::PreconditionRequired));
        }
        self.edit_in_room(
            doc_id,
            request(plan, true, operation_id, digest, actor_id, expect, applied),
        )
        .await
    }

    pub(crate) async fn edit_in_room(
        &self,
        doc_id: &str,
        request: EditRequest,
    ) -> Result<EditResult, Error> {
        let (token, _gone) = caller();
        for _ in 0..MAX_JOIN_ATTEMPTS {
            if self.is_purging(doc_id) {
                return Ok(EditResult::status(EditStatus::Purged));
            }
            // A room created after the drain swept would seed and then
            // close without ever flushing.
            if self.draining() {
                return Ok(EditResult::status(EditStatus::Draining));
            }
            if self.in_commit_cooldown(doc_id) {
                return Ok(EditResult::status(EditStatus::Unavailable));
            }
            let Some(room) = self.room_for(doc_id) else {
                return Ok(EditResult::status(EditStatus::Purged));
            };
            let (r, t, q) = (room.clone(), token.clone(), request.clone());
            if let Some(result) = spawned(async move { r.edit(&t, q).await }).await? {
                return Ok(result);
            }
            self.forget(&room);
        }
        Err(Error::message(format!(
            "collab: the room for \"{doc_id}\" kept closing during an edit."
        )))
    }

    /// GET /sync/{doc}/state: the live document, loading the room the way
    /// an edit does.
    pub async fn state(&self, doc_id: &str) -> Result<StateResult, Error> {
        let (token, _gone) = caller();
        for _ in 0..MAX_JOIN_ATTEMPTS {
            if self.is_purging(doc_id) {
                return Ok(StateResult::status(StateStatus::Purged));
            }
            if self.draining() {
                return Ok(StateResult::status(StateStatus::Draining));
            }
            if self.in_commit_cooldown(doc_id) {
                return Ok(StateResult::status(StateStatus::Unavailable));
            }
            let Some(room) = self.room_for(doc_id) else {
                return Ok(StateResult::status(StateStatus::Purged));
            };
            let (r, t) = (room.clone(), token.clone());
            if let Some(result) = spawned(async move { r.read_state(&t).await }).await? {
                return Ok(result);
            }
            self.forget(&room);
        }
        Err(Error::message(format!(
            "collab: the room for \"{doc_id}\" kept closing during a state read."
        )))
    }

    /// Rechecks only a loaded room and answers the expelled count.
    pub async fn recheck_access(&self, doc_id: &str) -> Result<usize, Error> {
        if doc_id.is_empty() {
            return Err(Error::EmptyDocId);
        }
        let Some(room) = self.0.lock().rooms.get(doc_id).cloned() else {
            return Ok(0);
        };
        let (token, _gone) = caller();
        spawned(async move { room.recheck_access(&token).await }).await
    }

    /// Publishes a checkpoint on a loaded document.
    pub async fn checkpoint(&self, doc_id: &str) -> Result<bool, Error> {
        let room = {
            let rooms = self.0.lock();
            if rooms.purge_lanes.contains_key(doc_id) {
                return Ok(false);
            }
            rooms.rooms.get(doc_id).cloned()
        };
        let Some(room) = room else {
            return Ok(false);
        };
        let (token, _gone) = caller();
        spawned(async move { room.checkpoint(&token).await }).await
    }

    /// PurgeDocumentAsync. A purged id is refused for the life of the
    /// process: purge lanes are never removed.
    pub async fn purge(
        &self,
        doc_id: &str,
        authorize: impl Future<Output = Result<bool, Error>>,
    ) -> Result<PurgeOutcome, Error> {
        if doc_id.is_empty() {
            return Err(Error::EmptyDocId);
        }
        let lower = doc_id.to_lowercase();
        if doc_id == "."
            || doc_id == ".."
            || doc_id.contains(['/', '\\'])
            || lower.contains("%2f")
            || lower.contains("%5c")
        {
            return Err(Error::NotSingleSegment);
        }
        if !authorize.await? {
            return Err(Error::PurgeNotAuthorized);
        }
        let purger = self.0.operations.as_ref().map(|o| o.as_purge());
        if let (Some(operations), Some(None)) = (&self.0.operations, purger) {
            return Err(Error::PurgeUnsupported(operations.type_name().to_owned()));
        }

        let purge_lane = {
            let mut rooms = self.0.lock();
            let lane = rooms
                .purge_lanes
                .entry(doc_id.to_owned())
                .or_default()
                .clone();
            if let Some(current) = rooms.rooms.get(doc_id) {
                current.request_purge();
            }
            lane
        };
        let (token, _gone) = caller();
        let _held = purge_lane.reserve().hold().await;

        // Before anything is deleted: a failed attempt leaves no step to
        // replay.
        self.0.document_replaced(doc_id);
        let room = self.0.lock().rooms.get(doc_id).cloned();
        if let Some(room) = room {
            room.request_purge();
            let t = token.clone();
            spawned(async move { room.purge(&t).await }).await?;
        }
        if let Some(operations) = &self.0.operations
            && let Some(purger) = operations.as_purge()
        {
            let ctx = token.journal().clone();
            let outcome = purger.purge(&ctx, doc_id).await?;
            if outcome == PurgeOutcome::DocumentOpenElsewhere {
                return Ok(outcome);
            }
        }
        self.0.store.delete(doc_id).await?;
        Ok(PurgeOutcome::Purged)
    }

    /// Refuses new joins, flushes every room and closes members 1001. A
    /// join that passed the check a moment ago may add a room, so it loops.
    pub async fn drain(&self) -> Result<(), Error> {
        let (token, _gone) = caller();
        self.drain_with(&token).await
    }

    /// drain, with a caller token. It bounds each room's flush only: every
    /// room still closes, and the loop runs until no room is left.
    pub async fn drain_with(&self, caller: &Token) -> Result<(), Error> {
        self.0.draining.store(true, Ordering::SeqCst);
        loop {
            let rooms = self.live_rooms();
            if rooms.is_empty() {
                return Ok(());
            }
            let mut drains = Vec::new();
            for room in rooms {
                let (r, t) = (room.clone(), caller.clone());
                drains.push((room, tokio::spawn(async move { r.drain(&t).await })));
            }
            for (room, drain) in drains {
                // One room that fails must not strand the others.
                if let Err(err) = drain.await {
                    self.0.logf(&format!(
                        "collab: room \"{}\" could not be drained: {}",
                        room.doc_id,
                        panic_message(err)
                    ));
                }
                // The drain always closes the room; forget it in case its
                // close callback raced a newer room.
                self.forget(&room);
            }
        }
    }

    /// A test hook: every room's queued work and its activity delivered.
    pub async fn settle(&self) {
        for room in self.live_rooms() {
            room.settle().await;
        }
    }
}

fn request(
    plan: PlanOps,
    gate_frame_size: bool,
    operation_id: &str,
    digest: &[u8],
    actor_id: &str,
    expect: Option<Precondition>,
    applied: Option<Applied>,
) -> EditRequest {
    EditRequest {
        plan,
        gate_frame_size,
        operation_id: operation_id.to_owned(),
        digest: digest.to_vec(),
        actor_id: actor_id.to_owned(),
        expect,
        applied,
    }
}

impl blok_collab::Rooms for Manager {
    fn join<'a>(
        &'a self,
        doc: &'a str,
        member: Arc<dyn Member>,
    ) -> BoxFuture<'a, Result<JoinResult, blok_collab::Error>> {
        Box::pin(async move {
            Manager::join(self, doc, member)
                .await
                .map_err(|err| Box::new(err) as blok_collab::Error)
        })
    }
}

/// A panicked task's message, as C# logs an exception's Message.
fn panic_message(err: tokio::task::JoinError) -> String {
    match err.try_into_panic() {
        Ok(payload) => match payload.downcast::<String>() {
            Ok(text) => *text,
            Err(payload) => payload.downcast::<&'static str>().map_or_else(
                |_| "a room call failed".to_owned(),
                |text| (*text).to_owned(),
            ),
        },
        Err(err) => err.to_string(),
    }
}

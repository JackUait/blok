use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, Weak};
use std::time::{Duration, SystemTime};

use blok_collab::{CloseReason, JoinResult, JoinStatus, Member};
use blok_collab_journal::OpenOutcome;
use blok_collab_wire::{AwarenessEntry, Message};
use blok_collab_workingset::{CURRENT_FORMAT, NO_LINEAGE, Tag};
use blok_yjs::{Doc, Subscription};
use tokio::sync::Notify;

use crate::activity::ActivityQueue;
use crate::cancel::Token;
use crate::lane::{Held, Lane};
use crate::manager::Shared;
use crate::ordered::Ordered;
use crate::{ActivityKind, ActivityObserver, Converter, Endpoint, Error, OperationSession};
use crate::{OperationStore, Options, WorkingSetStore};

pub type Log = Arc<dyn Fn(&str) + Send + Sync>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Phase {
    New,
    Ready,
    Closed,
}

/// What the room keeps per member; touched only in the lane.
pub(crate) struct MemberEntry {
    pub member: Arc<dyn Member>,
    pub malformed_awareness: i64,
    /// Set once the room queued its SyncStep2 to this member; a v2
    /// operation before that is refused as not-synced.
    pub synced: bool,
}

pub(crate) struct AwarenessOwner {
    pub membership: u64,
    pub member: Arc<dyn Member>,
    pub clock: u64,
}

type Slot<T> = Arc<(Mutex<Option<Result<T, String>>>, Notify)>;

/// A C# Task the lane awaits or observes later, compared by identity.
pub(crate) struct Task<T> {
    pub id: u64,
    slot: Slot<T>,
}

impl<T> Clone for Task<T> {
    fn clone(&self) -> Self {
        Task {
            id: self.id,
            slot: self.slot.clone(),
        }
    }
}

static NEXT_TASK: AtomicU64 = AtomicU64::new(1);

impl<T: Clone + Send + 'static> Task<T> {
    /// Starts work beside the lane; `then` runs once it has answered.
    pub fn start(
        work: impl Future<Output = Result<T, Error>> + Send + 'static,
        then: impl FnOnce(u64) + Send + 'static,
    ) -> Task<T> {
        let task = Task {
            id: NEXT_TASK.fetch_add(1, Ordering::Relaxed),
            slot: Arc::new((Mutex::new(None), Notify::new())),
        };
        let (slot, id) = (task.slot.clone(), task.id);
        tokio::spawn(async move {
            let result = work.await.map_err(|err| err.to_string());
            *slot.0.lock().unwrap_or_else(PoisonError::into_inner) = Some(result);
            slot.1.notify_waiters();
            then(id);
        });
        task
    }

    pub fn try_get(&self) -> Option<Result<T, String>> {
        self.slot
            .0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    pub async fn wait(&self) -> Result<T, String> {
        loop {
            let notified = self.slot.1.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if let Some(result) = self.try_get() {
                return result;
            }
            notified.await;
        }
    }
}

/// Work posted to the lane by timers and background tasks.
pub(crate) enum Job {
    TryExport,
    Evict,
    SchedulePersist,
    Checkpoint,
    VersionAnswered(u64),
    PersistFinished(u64),
    SaveFinished(u64),
}

/// The room state, touched only by the lane holder.
pub(crate) struct State {
    pub members: Ordered<u64, MemberEntry>,
    pub awareness_owners: Ordered<u64, AwarenessOwner>,
    pub activity_stamps: HashMap<String, SystemTime>,
    pub awareness_cache: Vec<AwarenessEntry>,

    pub frame_section: Vec<u8>,
    pub subscription: Option<Subscription>,

    pub phase: Phase,
    pub tag: Tag,
    pub doc: Option<Doc>,
    pub session: Option<Arc<dyn OperationSession>>,

    pub frame_count: usize,
    pub base_frame_length: i64,

    pub committed_through: u64,
    pub checkpointed_through: u64,
    pub checkpoint_failures: i64,
    pub operations_since_checkpoint: i64,
    pub bytes_since_checkpoint: i64,

    pub blob_version: i64,
    pub persisted_version: i64,
    pub persisting_version: i64,
    pub in_flight_persist: Option<Task<()>>,
    pub persist_failures: i64,

    pub version: Option<String>,
    pub pending_version: Option<Task<Option<String>>>,

    pub export_dirty: bool,
    pub projection_owed: bool,
    pub projection_refused: bool,
    pub dirty_since: Option<SystemTime>,
    pub export_retry_at: Option<SystemTime>,
    pub export_failures: i64,
    pub transient_export_failures: i64,
    pub migration_failed: bool,
    pub in_flight_save: Option<Task<Option<String>>>,

    pub disposed: bool,
    pub commit_unavailable: bool,
    pub load_held_off: bool,
}

impl State {
    pub fn doc(&self) -> Doc {
        self.doc.clone().expect("a loaded room holds a doc")
    }
}

/// One timer (an ITimer): change(Some(d)) re-arms it once, None disarms it.
#[derive(Default)]
pub(crate) struct RoomTimer {
    inner: Mutex<TimerState>,
}

#[derive(Default)]
struct TimerState {
    handle: Option<tokio::task::JoinHandle<()>>,
    dead: bool,
}

impl RoomTimer {
    fn lock(&self) -> MutexGuard<'_, TimerState> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn change(&self, room: &Arc<Room>, due: Option<Duration>, job: fn() -> Job) {
        let mut timer = self.lock();
        if timer.dead {
            return;
        }
        if let Some(old) = timer.handle.take() {
            old.abort();
        }
        let Some(due) = due else {
            return;
        };
        let wait = room.options.sleep(due);
        let room = Arc::downgrade(room);
        timer.handle = Some(tokio::spawn(async move {
            wait.await;
            if let Some(room) = room.upgrade() {
                room.post(job());
            }
        }));
    }

    pub fn stop(&self) {
        let mut timer = self.lock();
        timer.dead = true;
        if let Some(old) = timer.handle.take() {
            old.abort();
        }
    }
}

/// One doc's sync room: CollabRoom.
pub(crate) struct Room {
    pub doc_id: String,
    pub store: Arc<dyn WorkingSetStore>,
    pub operations: Option<Arc<dyn OperationStore>>,
    pub activity: Option<Arc<dyn ActivityObserver>>,
    pub endpoint: Arc<dyn Endpoint>,
    pub converter: Arc<dyn Converter>,
    pub options: Options,
    pub log: Option<Log>,

    pub lane: Arc<Lane>,
    pub lifetime: Token,
    pub purge_requested: AtomicBool,
    pub state: tokio::sync::Mutex<State>,
    /// What LOCAL transactions emitted; its caller decides when that
    /// becomes observable.
    pub local_updates: Arc<Mutex<Vec<Vec<u8>>>>,
    pub activity_queue: Mutex<ActivityQueue>,

    pub export_timer: RoomTimer,
    pub evict_timer: RoomTimer,
    pub persist_timer: RoomTimer,

    pub manager: Weak<Shared>,
    pub this: Weak<Room>,
    next_membership: AtomicU64,
}

/// A member's handle onto its room: CollabMembership.
pub struct Membership {
    pub(crate) room: Arc<Room>,
    pub(crate) id: u64,
    member: Arc<dyn Member>,
    /// The working-set tag the member joined under.
    pub(crate) tag: Tag,
}

impl Membership {
    /// The working-set tag the member joined under.
    pub fn tag(&self) -> &Tag {
        &self.tag
    }

    /// The connection behind this membership.
    pub fn member(&self) -> &Arc<dyn Member> {
        &self.member
    }
}

impl blok_collab::Membership for Membership {
    fn receive(
        &self,
        frame: Vec<u8>,
    ) -> blok_collab::BoxFuture<'_, Result<(), blok_collab::Error>> {
        let (room, id) = (self.room.clone(), self.id);
        Box::pin(async move {
            let caller = Token::new();
            let _gone = crate::cancel::CancelOnDrop(caller.clone());
            let body = tokio::spawn(async move { room.receive(&caller, id, frame).await });
            match body.await {
                Ok(result) => result.map_err(|err| Box::new(err) as blok_collab::Error),
                Err(err) => Err(Box::new(err) as blok_collab::Error),
            }
        })
    }

    /// Takes its place in the lane now; the body runs beside the caller.
    fn leave(&self) {
        let (room, id) = (self.room.clone(), self.id);
        let turn = room.lane.reserve();
        tokio::spawn(async move {
            let _held = turn.hold().await;
            let mut st = room.state.lock().await;
            room.leave_locked(&mut st, id);
        });
    }
}

pub(crate) fn queue_awareness_frame() -> Vec<u8> {
    must_encode(&Message::QueryAwareness)
}

pub(crate) fn must_encode(message: &Message) -> Vec<u8> {
    blok_collab_wire::encode(message).expect("the room encodes only well-formed frames")
}

pub(crate) fn wire_tag(tag: &Tag) -> blok_collab_wire::Tag {
    blok_collab_wire::Tag {
        format: tag.format,
        epoch: tag.epoch,
        lineage: tag.lineage.clone(),
    }
}

/// What a v1 write is journalled under.
pub(crate) fn new_operation_id() -> String {
    let mut id = [0u8; 16];
    getrandom::fill(&mut id).expect("the OS random source failed");
    id.iter().map(|b| format!("{b:02x}")).collect()
}

impl Room {
    pub(crate) fn new(doc_id: &str, manager: &Arc<Shared>) -> Arc<Room> {
        Arc::new_cyclic(|this| Room {
            doc_id: doc_id.to_owned(),
            store: manager.store.clone(),
            operations: manager.operations.clone(),
            activity: manager.activity.clone(),
            endpoint: manager.endpoint.clone(),
            converter: manager.converter.clone(),
            options: manager.options.clone(),
            log: manager.log.clone(),
            lane: Arc::new(Lane::default()),
            lifetime: Token::new(),
            purge_requested: AtomicBool::new(false),
            state: tokio::sync::Mutex::new(State {
                members: Ordered::default(),
                awareness_owners: Ordered::default(),
                activity_stamps: HashMap::new(),
                awareness_cache: Vec::new(),
                frame_section: Vec::new(),
                subscription: None,
                phase: Phase::New,
                tag: Tag {
                    format: CURRENT_FORMAT,
                    epoch: 0,
                    lineage: NO_LINEAGE.to_owned(),
                },
                doc: None,
                session: None,
                frame_count: 0,
                base_frame_length: 0,
                committed_through: 0,
                checkpointed_through: 0,
                checkpoint_failures: 0,
                operations_since_checkpoint: 0,
                bytes_since_checkpoint: 0,
                blob_version: 0,
                persisted_version: 0,
                persisting_version: 0,
                in_flight_persist: None,
                persist_failures: 0,
                version: None,
                pending_version: None,
                export_dirty: false,
                projection_owed: false,
                projection_refused: false,
                dirty_since: None,
                export_retry_at: None,
                export_failures: 0,
                transient_export_failures: 0,
                migration_failed: false,
                in_flight_save: None,
                disposed: false,
                commit_unavailable: false,
                load_held_off: false,
            }),
            local_updates: Arc::new(Mutex::new(Vec::new())),
            activity_queue: Mutex::new(ActivityQueue::default()),
            export_timer: RoomTimer::default(),
            evict_timer: RoomTimer::default(),
            persist_timer: RoomTimer::default(),
            manager: Arc::downgrade(manager),
            this: this.clone(),
            next_membership: AtomicU64::new(1),
        })
    }

    pub(crate) fn arc(&self) -> Arc<Room> {
        self.this.upgrade().expect("a running room is alive")
    }

    pub(crate) fn logf(&self, message: &str) {
        if let Some(log) = &self.log {
            log(message);
        }
    }

    /// Logs where a failing logger must not stop access cleanup.
    pub(crate) fn logf_surviving(&self, message: &str) {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.logf(message)));
    }

    pub(crate) fn request_purge(&self) {
        self.purge_requested.store(true, Ordering::SeqCst);
    }

    pub(crate) fn purging(&self) -> bool {
        self.purge_requested.load(Ordering::SeqCst)
    }

    pub(crate) fn take_local_updates(&self) -> Vec<Vec<u8>> {
        std::mem::take(
            &mut *self
                .local_updates
                .lock()
                .unwrap_or_else(PoisonError::into_inner),
        )
    }

    pub(crate) fn local_update_count(&self) -> usize {
        self.local_updates
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .len()
    }

    /// RunAsync: waits for the lane, giving up when the caller does.
    pub(crate) async fn enter(&self, caller: &Token) -> Result<Held, Error> {
        caller.err()?;
        let turn = self.lane.reserve();
        tokio::select! {
            held = turn.hold() => Ok(held),
            () = caller.cancelled() => Err(Error::Canceled),
        }
    }

    /// Fire-and-forget lane entry for timers and observers. Its place in
    /// line is taken now: a checkpoint posted inside a commit must run
    /// before the next frame's work.
    pub(crate) fn post(&self, job: Job) {
        let room = self.arc();
        let turn = self.lane.reserve();
        tokio::spawn(async move {
            let _held = turn.hold().await;
            let mut st = room.state.lock().await;
            if let Err(err) = room.run_job(&mut st, job).await {
                room.logf(&format!(
                    "collab: room \"{}\" background work failed: {err}",
                    room.doc_id
                ));
            }
        });
    }

    async fn run_job(&self, st: &mut State, job: Job) -> Result<(), Error> {
        match job {
            Job::TryExport => self.try_export_locked(st).await,
            Job::Evict => self.evict_locked(st).await,
            Job::SchedulePersist => {
                self.schedule_persist_locked(st);
                Ok(())
            }
            Job::Checkpoint => self.checkpoint_locked(st).await.map(|_| ()),
            Job::VersionAnswered(id) => {
                if let Some(reading) = st.pending_version.clone()
                    && reading.id == id
                {
                    let answered = reading.try_get().and_then(Result::ok).flatten();
                    self.apply_version_locked(st, id, answered);
                }
                Ok(())
            }
            Job::PersistFinished(id) => {
                self.on_persist_finished_locked(st, id);
                Ok(())
            }
            Job::SaveFinished(id) => {
                self.on_save_finished_locked(st, id);
                Ok(())
            }
        }
    }

    /// JoinAsync. None means the room already closed: retry on a fresh one.
    pub(crate) async fn join(
        &self,
        caller: &Token,
        member: Arc<dyn Member>,
    ) -> Result<Option<JoinResult>, Error> {
        let _held = self.enter(caller).await?;
        let mut st = self.state.lock().await;
        let st = &mut *st;
        let purged = || {
            Some(JoinResult {
                status: JoinStatus::Purged,
                membership: None,
                err: None,
            })
        };
        if self.purging() {
            return Ok(purged());
        }
        if st.phase == Phase::Closed {
            return Ok(None);
        }
        if !self
            .is_member_allowed_locked(caller, member.as_ref())
            .await?
        {
            if st.phase == Phase::New {
                self.close_room_locked(st, None).await;
            }
            return Ok(Some(JoinResult {
                status: JoinStatus::Forbidden,
                membership: None,
                err: None,
            }));
        }
        if self.purging() {
            return Ok(purged());
        }
        if st.phase == Phase::New
            && let Some(failure) = self.try_load_locked(st).await
        {
            self.close_room_locked(st, None).await;
            let status = match failure.open {
                OpenOutcome::DocumentPurged => JoinStatus::Purged,
                OpenOutcome::DocumentOpenElsewhere => JoinStatus::Unavailable,
                OpenOutcome::Opened => JoinStatus::SeedFailed,
            };
            return Ok(Some(JoinResult {
                status,
                membership: None,
                err: failure.err.map(|err| Box::new(err) as blok_collab::Error),
            }));
        }
        if self.purging() {
            return Ok(purged());
        }
        if let Err(err) = caller.err() {
            // The joiner is gone but the room is Ready: arm the linger, or
            // only a leave that never comes would.
            self.update_eviction_locked(st, None);
            return Err(err);
        }

        let id = self.next_membership.fetch_add(1, Ordering::Relaxed);
        let membership = Membership {
            room: self.arc(),
            id,
            member: member.clone(),
            tag: st.tag.clone(),
        };
        st.members.set(
            id,
            MemberEntry {
                member: member.clone(),
                malformed_awareness: 0,
                synced: false,
            },
        );
        self.update_eviction_locked(st, None);
        self.record_activity_locked(st, &member.actor_id(), ActivityKind::Joined);

        if member.accepts_control_frames() {
            self.send_encoded(
                member.as_ref(),
                &Message::BlokControl {
                    tag: wire_tag(&st.tag),
                },
            );
            if self.options.announced_max_message_bytes > 0 {
                self.send_encoded(
                    member.as_ref(),
                    &Message::BlokLimits {
                        max_message_bytes: self.options.announced_max_message_bytes,
                    },
                );
            }
        }
        // Sent even when empty, so a reconnect overwrites the stale map the
        // client still holds.
        self.send_encoded(member.as_ref(), &self.identities_frame_locked(st));
        self.broadcast_locked(st, &queue_awareness_frame(), Some(id));
        Ok(Some(JoinResult {
            status: JoinStatus::Joined,
            membership: Some(Box::new(membership)),
            err: None,
        }))
    }

    /// RecheckAccessAsync: expels every member that fails.
    pub(crate) async fn recheck_access(&self, caller: &Token) -> Result<usize, Error> {
        let _held = self.enter(caller).await?;
        let mut st = self.state.lock().await;
        let st = &mut *st;
        let mut expelled = 0;
        if st.phase != Phase::Ready {
            return Ok(0);
        }
        for id in st.members.keys() {
            let Some(member) = st.members.get(&id).map(|e| e.member.clone()) else {
                continue;
            };
            if !self
                .is_member_allowed_locked(caller, member.as_ref())
                .await?
            {
                self.expel_locked(st, id, CloseReason::Forbidden);
                expelled += 1;
            }
        }
        Ok(expelled)
    }

    /// A failed check is a denial, except the caller's cancel. C# hands the
    /// policy the caller's token; here the cancel drops the policy's future.
    /// Biased: an answer already given wins, so a policy that failed is a
    /// denial even when the caller has since cancelled, as in C#.
    async fn is_member_allowed_locked(
        &self,
        caller: &Token,
        member: &dyn Member,
    ) -> Result<bool, Error> {
        let answer = tokio::select! {
            biased;
            answer = member.recheck_access() => answer,
            () = caller.cancelled() => return Err(Error::Canceled),
        };
        match answer {
            Ok(allowed) => Ok(allowed),
            Err(err) => {
                self.logf_surviving(&format!(
                    "collab: room \"{}\" could not recheck member access: {err}",
                    self.doc_id
                ));
                Ok(false)
            }
        }
    }

    pub(crate) async fn receive(
        &self,
        caller: &Token,
        id: u64,
        frame: Vec<u8>,
    ) -> Result<(), Error> {
        let _held = self.enter(caller).await?;
        let mut st = self.state.lock().await;
        if !self.purging() && st.phase == Phase::Ready && st.members.has(&id) {
            self.receive_locked(&mut st, id, &frame).await;
        }
        Ok(())
    }

    pub(crate) fn leave_locked(&self, st: &mut State, id: u64) {
        let Some(member) = st.members.get(&id).map(|e| e.member.clone()) else {
            return;
        };
        st.members.remove(&id);
        self.withdraw_awareness_locked(st, id, member.as_ref());
        self.update_eviction_locked(st, None);
        self.record_activity_locked(st, &member.actor_id(), ActivityKind::Left);
    }

    pub(crate) fn send_encoded(&self, member: &dyn Member, message: &Message) {
        match blok_collab_wire::encode(message) {
            Ok(frame) => self.send(member, frame),
            Err(err) => self.logf(&format!(
                "collab: room \"{}\" could not hand a frame to a member: {}",
                self.doc_id, err.0
            )),
        }
    }

    pub(crate) fn send(&self, member: &dyn Member, frame: Vec<u8>) {
        let sent = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| member.send(frame)));
        if sent.is_err() {
            self.logf(&format!(
                "collab: room \"{}\" could not hand a frame to a member",
                self.doc_id
            ));
        }
    }

    pub(crate) fn broadcast_locked(&self, st: &State, frame: &[u8], except: Option<u64>) {
        for (id, entry) in st.members.iter() {
            if Some(*id) != except {
                self.send(entry.member.as_ref(), frame.to_vec());
            }
        }
    }

    fn close_member(&self, member: &dyn Member, reason: CloseReason) {
        let closed =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| member.close(reason)));
        if closed.is_err() {
            self.logf(&format!(
                "collab: room \"{}\" could not close a member",
                self.doc_id
            ));
        }
    }

    /// Stops serving one member. Removing it from the set is the
    /// never-twice guard: the leave that follows finds nothing to remove.
    pub(crate) fn expel_locked(&self, st: &mut State, id: u64, reason: CloseReason) {
        let Some(member) = st.members.get(&id).map(|e| e.member.clone()) else {
            return;
        };
        st.members.remove(&id);
        self.withdraw_awareness_locked(st, id, member.as_ref());
        self.update_eviction_locked(st, None);
        self.close_member(member.as_ref(), reason);
        self.record_activity_locked(st, &member.actor_id(), ActivityKind::Left);
    }

    /// The one place the linger is armed or disarmed. None means the
    /// configured linger.
    pub(crate) fn update_eviction_locked(&self, st: &State, linger: Option<Duration>) {
        if st.phase != Phase::Ready {
            return;
        }
        let room = self.arc();
        if st.members.len() > 0 {
            self.evict_timer.change(&room, None, || Job::Evict);
            return;
        }
        let linger = linger.unwrap_or(self.options.eviction_linger);
        self.evict_timer.change(&room, Some(linger), || Job::Evict);
    }

    /// Releases the fence with the room. The session close is bounded: past
    /// CommitTimeout it is abandoned.
    pub(crate) async fn close_room_locked(&self, st: &mut State, reason: Option<CloseReason>) {
        if let Some(closing) = st.session.take() {
            let closed = tokio::spawn(async move { closing.close().await });
            let closed = tokio::select! {
                closed = closed => Ok(closed),
                () = self.options.sleep(self.options.commit_timeout) => Err(()),
            };
            match closed {
                Ok(Ok(Ok(()))) => {}
                Ok(Ok(Err(err))) => self.logf(&format!(
                    "collab: room \"{}\" could not release its operation session: {err}",
                    self.doc_id
                )),
                Ok(Err(err)) => self.logf(&format!(
                    "collab: room \"{}\" could not release its operation session: {err}",
                    self.doc_id
                )),
                Err(_) => self.logf(&format!(
                    "collab: room \"{}\" could not release its operation session: it did not answer within the commit timeout",
                    self.doc_id
                )),
            }
        }
        self.close_locked(st, reason);
    }

    fn close_locked(&self, st: &mut State, reason: Option<CloseReason>) {
        st.phase = Phase::Closed;
        let members: Vec<Arc<dyn Member>> =
            st.members.iter().map(|(_, e)| e.member.clone()).collect();
        for member in members {
            if let Some(reason) = reason {
                self.close_member(member.as_ref(), reason);
            }
            // The only end these sessions get.
            self.record_activity_locked(st, &member.actor_id(), ActivityKind::Left);
        }
        st.members.clear();
        self.dispose(st);
        if let Some(manager) = self.manager.upgrade() {
            manager.on_room_closed(&self.arc(), st.commit_unavailable, st.load_held_off);
        }
    }

    pub(crate) fn dispose(&self, st: &mut State) {
        if st.disposed {
            return;
        }
        st.disposed = true;
        self.export_timer.stop();
        self.evict_timer.stop();
        self.persist_timer.stop();
        self.lifetime.cancel();
        if let Some(subscription) = st.subscription.take() {
            subscription.unsubscribe();
        }
        st.doc = None;
    }
}

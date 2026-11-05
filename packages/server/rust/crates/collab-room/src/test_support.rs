//! Ports of the Go room test fakes (room_test.go and harness_test.go),
//! which port C# CollabRoomTestSupport.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use blok_collab::{BoxFuture, CloseReason, Member, OperationSource};
use blok_collab_convert::{DocConverter, EditOp, HtmlReader, RichTextHtml};
use blok_collab_docendpoint::{Loaded, Projection};
use blok_collab_journal::{Context, OpenOutcome};
use blok_collab_operation::{
    AppendOutcome, AppendResult, Candidate, Checkpoint, Head, Lookup, LookupOutcome, OpenResult,
    Record, Reset,
};
use blok_collab_wire::Message;
use blok_collab_workingset::{CURRENT_FORMAT, Set, Tag};
use blok_jsjson::{Node, Object, Str, Value};
use blok_yjs::Doc;
use tokio::sync::Semaphore;

use crate::*;

pub(crate) fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// C# Tags.Lineage.
pub(crate) const TAG_LINEAGE: &str = "00112233445566778899aabbccddeeff";
pub(crate) const TEST_DOC: &str = "doc-1";
pub(crate) const OP_ONE: &str = "0123456789abcdef0123456789abcdef";
pub(crate) const OP_TWO: &str = "fedcba9876543210fedcba9876543210";
pub(crate) const OP_THREE: &str = "00112233445566778899aabbccddeeff";

/// C# Tags.At.
pub(crate) fn tag_at(epoch: i64) -> Tag {
    Tag {
        format: CURRENT_FORMAT,
        epoch,
        lineage: TAG_LINEAGE.to_owned(),
    }
}

/// A gate a fake holds its calls on until it opens; Go's closed channel.
#[derive(Clone)]
pub(crate) struct Gate(Arc<Semaphore>);

impl Gate {
    pub fn new() -> Gate {
        Gate(Arc::new(Semaphore::new(0)))
    }
    pub fn open(&self) {
        self.0.close();
    }
    pub async fn wait(&self) {
        let _ = self.0.acquire().await;
    }
}

/// The room clock a test moves by hand (C# ManualTimeProvider, for the
/// clock only; room timers still run on wall time).
#[derive(Clone)]
pub(crate) struct ManualClock(Arc<Mutex<SystemTime>>);

impl ManualClock {
    pub fn new() -> ManualClock {
        // 2026-01-01T00:00:00Z.
        ManualClock(Arc::new(Mutex::new(
            UNIX_EPOCH + Duration::from_secs(1_767_225_600),
        )))
    }
    pub fn now(&self) -> SystemTime {
        *lock(&self.0)
    }
    pub fn advance(&self, d: Duration) {
        *lock(&self.0) += d;
    }
    pub fn clock(&self) -> Clock {
        let clock = self.clone();
        Arc::new(move || clock.now())
    }
}

// --- members ---

/// Records what the room hands it.
#[derive(Default)]
pub(crate) struct FakeMember {
    pub actor: String,
    pub source: Option<OperationSource>,
    pub write: bool,
    pub frames: Mutex<Vec<Vec<u8>>>,
    pub closes: Mutex<Vec<CloseReason>>,
    pub revoked: AtomicBool,
    pub failure: Mutex<Option<String>>,
}

impl FakeMember {
    pub fn new(actor: &str, source: OperationSource, write: bool) -> Arc<FakeMember> {
        Arc::new(FakeMember {
            actor: actor.to_owned(),
            source: Some(source),
            write,
            ..FakeMember::default()
        })
    }
    pub fn v1(write: bool) -> Arc<FakeMember> {
        FakeMember::new("", OperationSource::ClientV1, write)
    }
    /// C# V2Member.
    pub fn v2() -> Arc<FakeMember> {
        FakeMember::new("", OperationSource::ClientV2, true)
    }
    pub fn revoke(&self, failure: Option<&str>) {
        self.revoked.store(failure.is_none(), Ordering::SeqCst);
        *lock(&self.failure) = failure.map(str::to_owned);
    }
    pub fn messages(&self) -> Vec<Message> {
        lock(&self.frames)
            .iter()
            .map(|frame| {
                blok_collab_wire::decode(frame)
                    .unwrap_or_else(|err| panic!("the room sent a frame it cannot decode: {err}"))
            })
            .collect()
    }
    pub fn closed(&self) -> Vec<CloseReason> {
        lock(&self.closes).clone()
    }
    pub fn clear(&self) {
        lock(&self.frames).clear();
    }
}

impl Member for FakeMember {
    fn can_write(&self) -> bool {
        self.write
    }
    fn accepts_control_frames(&self) -> bool {
        true
    }
    fn actor_id(&self) -> String {
        self.actor.clone()
    }
    fn protocol_source(&self) -> OperationSource {
        self.source.unwrap_or(OperationSource::ClientV2)
    }
    fn recheck_access(&self) -> BoxFuture<'_, Result<bool, blok_collab::Error>> {
        let revoked = self.revoked.load(Ordering::SeqCst);
        let failure = lock(&self.failure).clone();
        Box::pin(async move {
            match failure {
                Some(failure) => Err(failure.into()),
                None => Ok(!revoked),
            }
        })
    }
    fn send(&self, frame: Vec<u8>) {
        lock(&self.frames).push(frame);
    }
    fn close(&self, reason: CloseReason) {
        lock(&self.closes).push(reason);
    }
}

pub(crate) type Joined = Box<dyn blok_collab::Membership>;

pub(crate) async fn join(manager: &Manager, doc: &str, member: &Arc<FakeMember>) -> Joined {
    let result = manager.join(doc, member.clone()).await.expect("join");
    assert_eq!(
        result.status,
        blok_collab::JoinStatus::Joined,
        "join status ({:?})",
        result.err
    );
    result.membership.expect("a joined membership")
}

/// Every room's queued lane work has run, as an awaited C# LeaveAsync
/// guarantees. Unlike Manager::settle it does not wait for the activity
/// observer, so it works while a test holds that observer.
pub(crate) async fn settle_lanes(manager: &Manager) {
    for room in manager.live_rooms() {
        drop(room.lane.reserve().hold().await);
    }
}

/// Waits until n callers wait on the live rooms' lanes, so work queued
/// from another task is in line before the test lets the lane go.
pub(crate) async fn wait_for_lane_waiters(manager: &Manager, n: usize, what: &str) {
    wait_until(what, || {
        manager
            .live_rooms()
            .iter()
            .map(|room| room.lane.waiters())
            .sum::<usize>()
            >= n
    })
    .await;
}

/// Waits until every room has settled its working-set write. C#'s fake
/// store writes at once, so that write is settled on the lane before
/// anything after it. Here it runs beside the lane, and its finish is
/// posted back later.
pub(crate) async fn settle_writes(manager: &Manager) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        let mut writing = false;
        for room in manager.live_rooms() {
            let _held = room.enter(&Token::new()).await.expect("the lane");
            writing |= room.state.lock().await.in_flight_persist.is_some();
        }
        if !writing {
            return;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "timed out waiting for the working-set writes"
        );
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
}

pub(crate) fn sync_frame(message: Message) -> Vec<u8> {
    blok_collab_wire::encode(&message).expect("encodable")
}

pub(crate) async fn receive(membership: &Joined, message: Message) {
    membership
        .receive(sync_frame(message))
        .await
        .expect("receive");
}

// --- the working set (memoryStore, C# FakeWorkingSetStore) ---

pub(crate) type FailFn = Box<dyn Fn(&str) -> Option<String> + Send + Sync>;
type Fail = Mutex<Option<FailFn>>;

fn failure(fail: &Fail, doc: &str) -> Option<Error> {
    lock(fail).as_ref().and_then(|f| f(doc)).map(Error::Message)
}

#[derive(Default)]
pub(crate) struct MemoryStore {
    pub sets: Mutex<HashMap<String, Set>>,
    pub reads: AtomicI32,
    pub writes: AtomicI32,
    pub resets: AtomicI32,
    pub retires: AtomicI32,
    pub fail_writes: Fail,
    pub fail_retires: Fail,
    /// Writes fail with DeadlineExceeded while set (Go failingWrites).
    pub timing_out: AtomicBool,
}

impl MemoryStore {
    pub fn new() -> Arc<MemoryStore> {
        Arc::new(MemoryStore::default())
    }
    pub fn seed(&self, doc: &str, updates: &[Vec<u8>], tag: Tag) {
        let mut framed = Vec::new();
        for update in updates {
            blok_collab_workingset::append_frame(&mut framed, update);
        }
        lock(&self.sets).insert(
            doc.to_owned(),
            Set {
                updates: framed,
                tag,
            },
        );
    }
    pub fn holds(&self, doc: &str) -> bool {
        lock(&self.sets).contains_key(doc)
    }
    pub fn stored(&self, doc: &str) -> Set {
        lock(&self.sets)
            .get(doc)
            .cloned()
            .unwrap_or_else(|| panic!("no working set for {doc:?}"))
    }
    pub fn frames(&self, doc: &str) -> Vec<Vec<u8>> {
        blok_collab_workingset::decode_frames(&self.stored(doc).updates)
            .expect("the stored working set decodes")
    }
    pub fn peek(&self, doc: &str) -> Option<Set> {
        lock(&self.sets).get(doc).cloned()
    }
    pub fn set_fail_writes(&self, f: Option<FailFn>) {
        *lock(&self.fail_writes) = f;
    }
    pub fn set_fail_retires(&self, f: Option<FailFn>) {
        *lock(&self.fail_retires) = f;
    }
}

impl WorkingSetStore for MemoryStore {
    fn read<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<Option<Set>, Error>> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        let set = self.peek(doc_id);
        Box::pin(async move { Ok(set) })
    }
    fn write<'a>(
        &'a self,
        doc_id: &'a str,
        updates: &'a [u8],
        tag: &'a Tag,
    ) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move {
            if self.timing_out.load(Ordering::SeqCst) {
                return Err(Error::DeadlineExceeded);
            }
            if let Some(err) = failure(&self.fail_writes, doc_id) {
                return Err(err);
            }
            self.writes.fetch_add(1, Ordering::SeqCst);
            lock(&self.sets).insert(
                doc_id.to_owned(),
                Set {
                    updates: updates.to_vec(),
                    tag: tag.clone(),
                },
            );
            Ok(())
        })
    }
    fn reset<'a>(&'a self, doc_id: &'a str, tag: &'a Tag) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move {
            self.resets.fetch_add(1, Ordering::SeqCst);
            lock(&self.sets).insert(
                doc_id.to_owned(),
                Set {
                    updates: Vec::new(),
                    tag: tag.clone(),
                },
            );
            Ok(())
        })
    }
    fn retire<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move {
            if let Some(err) = failure(&self.fail_retires, doc_id) {
                return Err(err);
            }
            self.retires.fetch_add(1, Ordering::SeqCst);
            lock(&self.sets).remove(doc_id);
            Ok(())
        })
    }
    fn delete<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<(), Error>> {
        self.retire(doc_id)
    }
}

// --- the doc endpoint (memoryEndpoint, C# FakeDocEndpoint) ---

#[derive(Clone, Debug)]
pub(crate) struct RecordedSave {
    pub doc: String,
    pub data: String,
    pub version: Option<String>,
    pub projection: Option<Projection>,
}

#[derive(Default)]
pub(crate) struct FakeEndpoint {
    pub documents: Mutex<HashMap<String, Loaded>>,
    pub saves: Mutex<Vec<RecordedSave>>,
    pub loads: AtomicI32,
    /// A load answers null when no document is held (Go memoryEndpoint).
    pub answers_null: bool,
    pub failure: Mutex<Option<Error>>,
    pub load_gate: Mutex<Option<Gate>>,
    pub save_gate: Mutex<Option<Gate>>,
    pub next_save_version: Mutex<Option<String>>,
}

pub(crate) fn node(json: &str) -> Node {
    blok_jsjson::parse_node(
        json.as_bytes(),
        blok_jsjson::Options {
            max_depth: 64,
            refuse_duplicates: false,
        },
    )
    .expect("test JSON parses")
}

pub(crate) fn text_json(text: &str) -> String {
    let mut object = Object::new();
    object.set(Str::from("text"), Value::String(Str::from(text)));
    blok_jsjson::stringify(&Value::Object(object)).expect("stringify")
}

impl FakeEndpoint {
    /// Go memoryEndpoint: answers null and records each save.
    pub fn null() -> Arc<FakeEndpoint> {
        Arc::new(FakeEndpoint {
            answers_null: true,
            ..FakeEndpoint::default()
        })
    }
    pub fn new() -> Arc<FakeEndpoint> {
        Arc::new(FakeEndpoint::default())
    }
    /// C# Holds: the document {"text": text}.
    pub fn holds(&self, doc: &str, text: &str, version: Option<&str>) {
        self.holds_document(doc, &text_json(text), version);
    }
    pub fn holds_document(&self, doc: &str, json: &str, version: Option<&str>) {
        lock(&self.documents).insert(
            doc.to_owned(),
            Loaded {
                data: Some(node(json)),
                version: version.map(str::to_owned),
            },
        );
    }
    pub fn holds_nothing(&self, doc: &str, version: Option<&str>) {
        lock(&self.documents).insert(
            doc.to_owned(),
            Loaded {
                data: None,
                version: version.map(str::to_owned),
            },
        );
    }
    pub fn fail(&self, err: Option<Error>) {
        *lock(&self.failure) = err;
    }
    pub fn loaded(&self) -> i32 {
        self.loads.load(Ordering::SeqCst)
    }
    pub fn saves(&self) -> Vec<RecordedSave> {
        lock(&self.saves).clone()
    }
    pub fn saved(&self) -> usize {
        lock(&self.saves).len()
    }
    pub fn set_save_gate(&self, gate: Option<Gate>) {
        *lock(&self.save_gate) = gate;
    }
    pub fn set_load_gate(&self, gate: Option<Gate>) {
        *lock(&self.load_gate) = gate;
    }
    pub fn set_next_save_version(&self, version: Option<&str>) {
        *lock(&self.next_save_version) = version.map(str::to_owned);
    }
    fn answer(&self, doc: &str) -> Result<Loaded, Error> {
        if let Some(err) = lock(&self.failure).as_ref() {
            return Err(Error::message(err.to_string()));
        }
        match lock(&self.documents).get(doc) {
            Some(loaded) => Ok(loaded.clone()),
            None if self.answers_null => Ok(Loaded::default()),
            None => Err(Error::message("collab: the doc endpoint GET returned 404.")),
        }
    }
}

impl Endpoint for FakeEndpoint {
    fn load<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<Loaded, Error>> {
        Box::pin(async move {
            let gate = lock(&self.load_gate).clone();
            match gate {
                // Counted and answered in one step, so a test that sees the
                // count knows which record the load read.
                None => {
                    let documents = lock(&self.documents);
                    self.loads.fetch_add(1, Ordering::SeqCst);
                    drop(documents);
                    self.answer(doc_id)
                }
                Some(gate) => {
                    self.loads.fetch_add(1, Ordering::SeqCst);
                    gate.wait().await;
                    self.answer(doc_id)
                }
            }
        })
    }
    fn save<'a>(
        &'a self,
        doc_id: &'a str,
        output_data: &'a Value,
        version: Option<&'a str>,
        projection: Option<&'a Projection>,
    ) -> BoxFuture<'a, Result<Option<String>, Error>> {
        Box::pin(async move {
            let data = String::from_utf8(blok_collab_docendpoint::serialize(output_data)?)
                .expect("serialized JSON is UTF-8");
            lock(&self.saves).push(RecordedSave {
                doc: doc_id.to_owned(),
                data,
                version: version.map(str::to_owned),
                projection: projection.cloned(),
            });
            let gate = lock(&self.save_gate).clone();
            if let Some(gate) = gate {
                gate.wait().await;
            }
            Ok(lock(&self.next_save_version).take())
        })
    }
}

// --- the operation journal (C# FakeCollabOperationStore) ---

#[derive(Default, Clone)]
pub(crate) struct FakeJournalDoc {
    pub head: Option<Head>,
    pub baseline: Vec<Vec<u8>>,
    pub checkpoint: Option<Checkpoint>,
    pub records: Vec<Record>,
    pub fence: i64,
    pub open: bool,
    pub purged: bool,
    pub created_at: Option<SystemTime>,
    /// Lineages a reset replaced, oldest first.
    pub superseded: Vec<FakeLineage>,
}

#[derive(Clone)]
pub(crate) struct FakeLineage {
    pub head: Head,
    pub baseline: Vec<Vec<u8>>,
    pub records: Vec<Record>,
    pub created_at: Option<SystemTime>,
    pub current: bool,
}

#[derive(Default)]
pub(crate) struct FakeJournalInner {
    pub docs: Mutex<HashMap<String, FakeJournalDoc>>,
    pub fail_appends: Fail,
    pub fail_checkpoints: Fail,
    pub fail_resets: Fail,
    /// Like fail_checkpoints, for a failure that is not a plain message.
    pub checkpoint_error: Mutex<Option<Box<dyn Fn() -> Error + Send + Sync>>>,
    pub checkpoint_attempts: AtomicI32,
    /// Journals the record before a fail_appends error: the unknown outcome.
    pub commit_before_failing: AtomicBool,
    /// Holds every append until the gate opens.
    pub before_append: Mutex<Option<Gate>>,
}

#[derive(Clone, Default)]
pub(crate) struct FakeJournal(pub Arc<FakeJournalInner>);

impl FakeJournal {
    pub fn new() -> FakeJournal {
        FakeJournal::default()
    }
    pub(crate) fn with<T>(&self, id: &str, f: impl FnOnce(&mut FakeJournalDoc) -> T) -> T {
        f(lock(&self.0.docs).entry(id.to_owned()).or_default())
    }
    pub fn set_fail_resets(&self, f: Option<FailFn>) {
        *lock(&self.0.fail_resets) = f;
    }
    pub fn set_fail_checkpoints(&self, f: Option<FailFn>) {
        *lock(&self.0.fail_checkpoints) = f;
    }
    pub fn set_fail_appends(&self, f: Option<FailFn>) {
        *lock(&self.0.fail_appends) = f;
    }
    pub fn set_commit_before_failing(&self, on: bool) {
        self.0.commit_before_failing.store(on, Ordering::SeqCst);
    }
    pub fn set_before_append(&self, gate: Option<Gate>) {
        *lock(&self.0.before_append) = gate;
    }
    /// Another process takes the fence while a session is live.
    pub fn steal_fence(&self, id: &str) {
        self.with(id, |d| d.fence += 1);
    }
    pub fn head(&self, id: &str) -> Option<Head> {
        self.with(id, |d| d.head.clone())
    }
    pub fn baseline(&self, id: &str) -> Vec<Vec<u8>> {
        self.with(id, |d| d.baseline.clone())
    }
    pub fn committed(&self, id: &str) -> Vec<Record> {
        self.with(id, |d| d.records.clone())
    }
    pub fn checkpoint(&self, id: &str) -> Option<Checkpoint> {
        self.with(id, |d| d.checkpoint.clone())
    }
    pub fn open_session(&self, id: &str) -> Option<Arc<FakeSession>> {
        self.with(id, |d| {
            if d.open {
                return None;
            }
            d.open = true;
            d.fence += 1;
            let through = d.checkpoint.as_ref().map_or(0, |c| c.through);
            let opened = OpenResult {
                head: d.head.clone(),
                baseline: d.baseline.clone(),
                checkpoint: d.checkpoint.clone(),
                tail: d
                    .records
                    .iter()
                    .filter(|r| r.sequence > through)
                    .cloned()
                    .collect(),
            };
            Some(Arc::new(FakeSession {
                store: self.clone(),
                id: id.to_owned(),
                fence: d.fence,
                opened,
                disposed: AtomicBool::new(false),
            }))
        })
    }
}

impl OperationStore for FakeJournal {
    fn open<'a>(
        &'a self,
        _ctx: &'a Context,
        doc_id: &'a str,
    ) -> BoxFuture<'a, Result<Opened, Error>> {
        if self.with(doc_id, |d| d.purged) {
            return Box::pin(async { Ok((OpenOutcome::DocumentPurged, None)) });
        }
        let session = self.open_session(doc_id);
        Box::pin(async move {
            Ok(match session {
                None => (OpenOutcome::DocumentOpenElsewhere, None),
                Some(session) => (
                    OpenOutcome::Opened,
                    Some(session as Arc<dyn OperationSession>),
                ),
            })
        })
    }
    fn type_name(&self) -> &'static str {
        "*room.fakeJournal"
    }
}

pub(crate) struct FakeSession {
    store: FakeJournal,
    id: String,
    fence: i64,
    opened: OpenResult,
    disposed: AtomicBool,
}

impl FakeSession {
    fn fenced<T>(
        &self,
        f: impl FnOnce(&mut FakeJournalDoc) -> Result<T, Error>,
    ) -> Result<T, Error> {
        if self.disposed.load(Ordering::SeqCst) {
            return Err(Error::message("the session is disposed"));
        }
        let fence = self.fence;
        self.store.with(&self.id, |d| {
            if d.fence != fence {
                return Err(Error::Journal(blok_collab_journal::Error::FenceLost));
            }
            f(d)
        })
    }

    pub fn do_reset(&self, reset: Reset) -> Result<Head, Error> {
        if let Some(err) = failure(&self.store.0.fail_resets, &self.id) {
            return Err(err);
        }
        self.fenced(|d| {
            if let Some(previous) = d.head.clone() {
                d.superseded.push(FakeLineage {
                    head: previous,
                    baseline: d.baseline.clone(),
                    records: d.records.clone(),
                    created_at: d.created_at,
                    current: false,
                });
            }
            // Record times count seconds from the epoch, so a lineage start
            // there never sorts after its own records.
            d.created_at = Some(UNIX_EPOCH);
            d.baseline = reset.baseline.clone();
            d.checkpoint = None;
            d.records.clear();
            d.head = Some(Head {
                format: reset.format,
                epoch: reset.epoch,
                lineage: reset.lineage.clone(),
                durable_through: 0,
            });
            Ok(d.head.clone().expect("set"))
        })
    }

    pub fn do_append(&self, candidate: Candidate) -> Result<AppendResult, Error> {
        let id = self.id.clone();
        let mut fail = failure(&self.store.0.fail_appends, &id);
        let commit_first = self.store.0.commit_before_failing.load(Ordering::SeqCst);
        self.fenced(|d| {
            if let Some(existing) = d
                .records
                .iter()
                .find(|r| r.operation_id == candidate.operation_id)
            {
                let outcome = if existing.digest == candidate.digest {
                    AppendOutcome::Duplicate
                } else {
                    AppendOutcome::Conflict
                };
                return Ok(AppendResult {
                    outcome,
                    sequence: existing.sequence,
                });
            }
            if !commit_first && let Some(err) = fail.take() {
                return Err(err);
            }
            let Some(head) = d.head.as_mut() else {
                return Err(Error::message(format!(
                    "collab: \"{id}\" was never seeded; reset it first"
                )));
            };
            let sequence = head.durable_through + 1;
            head.durable_through = sequence;
            d.records.push(Record {
                operation_id: candidate.operation_id,
                sequence,
                committed_at: UNIX_EPOCH + Duration::from_secs(sequence),
                actor_id: candidate.actor_id,
                source: candidate.source,
                update: candidate.update,
                digest: candidate.digest,
            });
            if let Some(err) = fail {
                return Err(err);
            }
            Ok(AppendResult {
                outcome: AppendOutcome::Committed,
                sequence,
            })
        })
    }

    pub fn do_close(&self) {
        if self.disposed.swap(true, Ordering::SeqCst) {
            return;
        }
        let fence = self.fence;
        self.store.with(&self.id, |d| {
            if d.fence == fence {
                d.open = false;
            }
        });
    }
}

impl OperationSession for FakeSession {
    fn open_result(&self) -> &OpenResult {
        &self.opened
    }
    fn find_committed<'a>(
        &'a self,
        _ctx: &'a Context,
        operation_id: &'a str,
        digest: &'a [u8],
    ) -> BoxFuture<'a, Result<Lookup, Error>> {
        let result = self.fenced(|d| {
            Ok(
                match d.records.iter().find(|r| r.operation_id == operation_id) {
                    None => Lookup {
                        outcome: LookupOutcome::NotCommitted,
                        sequence: 0,
                    },
                    Some(existing) if existing.digest == digest => Lookup {
                        outcome: LookupOutcome::Duplicate,
                        sequence: existing.sequence,
                    },
                    Some(existing) => Lookup {
                        outcome: LookupOutcome::Conflict,
                        sequence: existing.sequence,
                    },
                },
            )
        });
        Box::pin(async move { result })
    }
    fn append<'a>(
        &'a self,
        _ctx: &'a Context,
        candidate: Candidate,
    ) -> BoxFuture<'a, Result<AppendResult, Error>> {
        let gate = lock(&self.store.0.before_append).clone();
        Box::pin(async move {
            if let Some(gate) = gate {
                gate.wait().await;
            }
            self.do_append(candidate)
        })
    }
    fn write_checkpoint<'a>(
        &'a self,
        _ctx: &'a Context,
        checkpoint: Checkpoint,
    ) -> BoxFuture<'a, Result<(), Error>> {
        let fail = &self.store.0.fail_checkpoints;
        let result = self.fenced(|d| {
            let err = failure(fail, &self.id)
                .or_else(|| lock(&self.store.0.checkpoint_error).as_ref().map(|f| f()));
            if let Some(err) = err {
                self.store
                    .0
                    .checkpoint_attempts
                    .fetch_add(1, Ordering::SeqCst);
                return Err(err);
            }
            let durable = d.head.as_ref().map_or(0, |h| h.durable_through);
            let published = d.checkpoint.as_ref().map_or(0, |c| c.through);
            if checkpoint.through == 0
                || checkpoint.through > durable
                || checkpoint.through < published
            {
                return Err(Error::Journal(blok_collab_journal::Error::Argument {
                    message:
                        "a checkpoint must name a committed sequence at or above the published one"
                            .to_owned(),
                    out_of_range: true,
                }));
            }
            if d.checkpoint
                .as_ref()
                .is_none_or(|c| c.through != checkpoint.through)
            {
                d.checkpoint = Some(checkpoint);
            }
            Ok(())
        });
        Box::pin(async move { result })
    }
    fn reset<'a>(&'a self, _ctx: &'a Context, reset: Reset) -> BoxFuture<'a, Result<Head, Error>> {
        let result = self.do_reset(reset);
        Box::pin(async move { result })
    }
    fn close(&self) -> BoxFuture<'_, Result<(), Error>> {
        self.do_close();
        Box::pin(async { Ok(()) })
    }
}

/// C# SeedJournalAsync: a session reset with baseline; the caller closes it.
pub(crate) fn seed_journal(
    j: &FakeJournal,
    doc: &str,
    format: i32,
    epoch: i64,
    baseline: Vec<Vec<u8>>,
) -> Arc<FakeSession> {
    let session = j.open_session(doc).expect("the journal opens");
    session
        .do_reset(Reset {
            format,
            epoch,
            lineage: TAG_LINEAGE.to_owned(),
            baseline,
        })
        .expect("the seed reset");
    session
}

// --- the converter (C# FakeDocConverter): one "content" text root, and the
// OutputData shape {"text": ...} ---

#[derive(Default)]
pub(crate) struct TextConverter {
    pub exports: AtomicI32,
}

const CONTENT: &str = "content";

pub(crate) fn doc_text(doc: &Doc) -> String {
    doc.get_text(CONTENT)
        .expect("a text root")
        .units()
        .to_string()
}

fn data_text(node: Option<&Node>) -> String {
    let Some(node) = node else {
        return String::new();
    };
    match node.lookup("text") {
        Ok(Some(value)) => value.text().map(|t| t.to_string()).unwrap_or_default(),
        _ => String::new(),
    }
}

fn replace_text(doc: &Doc, value: &str) {
    let text = doc.get_text(CONTENT).expect("a text root");
    doc.transact(|txn| {
        let length = text.units().len() as i64;
        if length > 0 {
            text.delete(Some(txn), 0, length)?;
        }
        if !value.is_empty() {
            text.insert(Some(txn), 0, value, None)?;
        }
        Ok(())
    })
    .expect("a text write");
}

impl Converter for TextConverter {
    fn seed<'a>(&'a self, doc: &'a Doc, output_data: &'a Node) -> BoxFuture<'a, Result<(), Error>> {
        replace_text(doc, &data_text(Some(output_data)));
        Box::pin(async { Ok(()) })
    }
    fn export<'a>(&'a self, doc: &'a Doc) -> BoxFuture<'a, Result<Object, Error>> {
        self.exports.fetch_add(1, Ordering::SeqCst);
        let mut object = Object::new();
        object.set(
            Str::from("text"),
            Value::String(Str::from(doc_text(doc).as_str())),
        );
        Box::pin(async move { Ok(object) })
    }
    fn apply_ops<'a>(
        &'a self,
        doc: &'a Doc,
        ops: &'a [EditOp],
    ) -> BoxFuture<'a, Result<(), Error>> {
        let text = doc.get_text(CONTENT).expect("a text root");
        for op in ops {
            match op {
                EditOp::Insert { block, .. } => {
                    let value = data_text(block.lookup("data").ok().flatten());
                    doc.transact(|txn| {
                        if !value.is_empty() {
                            text.insert(
                                Some(txn),
                                text.units().len() as i64,
                                value.as_str(),
                                None,
                            )?;
                        }
                        Ok(())
                    })
                    .expect("a text write");
                }
                EditOp::Update { data, .. } => replace_text(doc, &data_text(Some(data))),
                _ => replace_text(doc, ""),
            }
        }
        Box::pin(async { Ok(()) })
    }
    fn migrate_rich_text<'a>(&'a self, _doc: &'a Doc) -> BoxFuture<'a, Result<usize, Error>> {
        Box::pin(async { Ok(0) })
    }
}

/// An HTML reader no format-2 test reaches (Go's DocConverter with no HTML).
pub(crate) struct NoHtml;

impl HtmlReader for NoHtml {
    async fn read(
        &self,
        fields: &[RichTextHtml],
        _timeout: Duration,
    ) -> Result<Vec<Vec<Value>>, blok_collab_convert::Error> {
        if fields.is_empty() {
            return Ok(Vec::new());
        }
        Err(blok_collab_convert::Error::Message(
            "collab: no HTML reader".to_owned(),
        ))
    }
}

/// Go's `&convert.DocConverter{Now: time.Now}`.
pub(crate) fn real_converter() -> DocConverter<NoHtml> {
    DocConverter {
        now: Box::new(SystemTime::now),
        html: NoHtml,
        fields: None,
        log: None,
    }
}

// --- documents and edits (C# YDocs) ---

static NEXT_CLIENT_ID: AtomicU32 = AtomicU32::new(1_000_000);

pub(crate) fn new_client() -> Doc {
    let id = NEXT_CLIENT_ID.fetch_add(1, Ordering::SeqCst) + 1;
    Doc::new(blok_yjs::Options {
        client_id: Some(id),
        no_gc: false,
    })
}

pub(crate) fn update_appending(doc: &Doc, value: &str) -> Vec<u8> {
    let text = doc.get_text(CONTENT).expect("a text root");
    doc.transact(|txn| text.insert(Some(txn), text.units().len() as i64, value, None))
        .expect("a text write")
        .unwrap_or_default()
}

pub(crate) fn update_deleting(doc: &Doc, index: i64, length: i64) -> Vec<u8> {
    let text = doc.get_text(CONTENT).expect("a text root");
    doc.transact(|txn| text.delete(Some(txn), index, length))
        .expect("a text delete")
        .unwrap_or_default()
}

pub(crate) fn doc_with(value: &str) -> Doc {
    let doc = new_client();
    update_appending(&doc, value);
    doc
}

pub(crate) fn full_state(doc: &Doc) -> Vec<u8> {
    doc.encode_state_as_update(&[]).expect("a full state")
}

/// One update a client doc emits setting key in a root map.
pub(crate) fn client_update(client: u32, key: &str) -> Vec<u8> {
    let doc = Doc::new(blok_yjs::Options {
        client_id: Some(client),
        no_gc: false,
    });
    let notes = doc.get_map("notes").expect("a map root");
    doc.transact(|txn| notes.set(txn, key, Value::Number(1.0)))
        .expect("a map write")
        .unwrap_or_default()
}

/// Collects log lines.
#[derive(Clone, Default)]
pub(crate) struct Logs(pub Arc<Mutex<Vec<String>>>);

impl Logs {
    pub fn log(&self) -> Log {
        let lines = self.0.clone();
        Arc::new(move |line: &str| lock(&lines).push(line.to_owned()))
    }
    pub fn lines(&self) -> Vec<String> {
        lock(&self.0).clone()
    }
    pub fn matching(&self, part: &str) -> Vec<String> {
        self.lines()
            .into_iter()
            .filter(|l| l.contains(part))
            .collect()
    }
    pub fn logged(&self, part: &str) -> bool {
        !self.matching(part).is_empty()
    }
}

/// Go newTestManager: a manager over the memory fakes and the real
/// converter.
pub(crate) fn test_manager(
    o: Options,
    operations: Option<Arc<dyn OperationStore>>,
) -> (Manager, Arc<MemoryStore>, Arc<FakeEndpoint>) {
    let (store, endpoint) = (MemoryStore::new(), FakeEndpoint::null());
    let manager = Manager::new(ManagerOptions {
        store: store.clone(),
        endpoint: endpoint.clone(),
        converter: Arc::new(real_converter()),
        room: o,
        log: None,
        operations,
        activity: None,
    });
    (manager, store, endpoint)
}

/// The built-in journal over a fresh directory.
pub(crate) fn open_journal() -> (Arc<dyn OperationStore>, TempDir) {
    let dir = TempDir::new();
    let store =
        blok_collab_journal::Store::new(dir.path(), blok_collab_journal::StoreOptions::default())
            .expect("the journal opens");
    (Arc::new(LocalJournal(store)), dir)
}

/// A scratch directory removed on drop.
pub(crate) struct TempDir(std::path::PathBuf);

impl TempDir {
    pub fn new() -> TempDir {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let path = std::env::temp_dir().join(format!(
            "blok-collab-room-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&path).expect("a temp dir");
        TempDir(path)
    }
    pub fn path(&self) -> &std::path::Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Polls until done, failing past ten seconds (Go waitUntil).
pub(crate) async fn wait_until(what: &str, mut done: impl FnMut() -> bool) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while !done() {
        assert!(
            tokio::time::Instant::now() < deadline,
            "timed out waiting for {what}"
        );
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

pub(crate) fn ms(n: u64) -> Duration {
    Duration::from_millis(n)
}

pub(crate) const HOUR: Duration = Duration::from_secs(3600);

/// A manager over the text converter and the C# fakes.
pub(crate) struct TextRoom {
    pub store: Arc<MemoryStore>,
    pub endpoint: Arc<FakeEndpoint>,
    pub operations: FakeJournal,
    pub converter: Arc<TextConverter>,
    pub clock: ManualClock,
    pub logs: Logs,
}

impl TextRoom {
    pub fn new() -> TextRoom {
        TextRoom {
            store: MemoryStore::new(),
            endpoint: FakeEndpoint::new(),
            operations: FakeJournal::new(),
            converter: Arc::new(TextConverter::default()),
            clock: ManualClock::new(),
            logs: Logs::default(),
        }
    }

    /// C# CreateJournalManager (journal) or CreateManager (none).
    pub fn manager(&self, mut o: Options, journalled: bool) -> Manager {
        if o.now.is_none() {
            o.now = Some(self.clock.clock());
        }
        Manager::new(ManagerOptions {
            store: self.store.clone(),
            endpoint: self.endpoint.clone(),
            converter: self.converter.clone(),
            room: o,
            log: Some(self.logs.log()),
            operations: journalled
                .then(|| Arc::new(self.operations.clone()) as Arc<dyn OperationStore>),
            activity: None,
        })
    }

    pub fn logged(&self, part: &str) -> bool {
        self.logs.logged(part)
    }
}

pub(crate) async fn state_text(manager: &Manager, doc: &str) -> (StateResult, String) {
    let state = manager.state(doc).await.expect("state");
    let text = String::from_utf8(state.json.clone()).expect("UTF-8");
    (state, text)
}

/// C# HttpEdit: one insert appending text, under operation_id.
pub(crate) async fn http_edit(
    manager: &Manager,
    doc: &str,
    operation_id: &str,
    text: &str,
) -> EditResult {
    let block = node(&format!(
        r#"{{"id":"b","type":"paragraph","data":{}}}"#,
        text_json(text)
    ));
    let mut digest = vec![0u8; 32];
    let id = operation_id.as_bytes();
    digest[..id.len().min(32)].copy_from_slice(&id[..id.len().min(32)]);
    manager
        .edit(
            doc,
            vec![EditOp::Insert {
                id: Str::from("b"),
                block,
                after: None,
                parent: None,
            }],
            operation_id,
            &digest,
            "",
            None,
        )
        .await
        .expect("edit")
}

/// C# Join: joined, then SyncStep1 from an empty client.
pub(crate) async fn join_synced(manager: &Manager, doc: &str, member: &Arc<FakeMember>) -> Joined {
    let membership = join(manager, doc, member).await;
    receive(
        &membership,
        Message::SyncStep1 {
            state_vector: new_client().encode_state_vector(),
        },
    )
    .await;
    membership
}

/// The tag the room announced to member.
pub(crate) fn control_tag(member: &FakeMember) -> blok_collab_wire::Tag {
    member
        .messages()
        .into_iter()
        .find_map(|m| match m {
            Message::BlokControl { tag } => Some(tag),
            _ => None,
        })
        .expect("a control frame")
}

/// C# Operation: a v2 write under the member's lineage.
pub(crate) async fn send_operation(
    membership: &Joined,
    member: &FakeMember,
    operation_id: &str,
    update: Vec<u8>,
) {
    receive(
        membership,
        Message::Operation {
            lineage: control_tag(member).lineage,
            operation_id: operation_id.to_owned(),
            update,
        },
    )
    .await;
}

/// Joins a read-only probe, asks with vector and answers the room's
/// SyncStep2 update.
pub(crate) async fn probe_step2(manager: &Manager, doc: &str, vector: Vec<u8>) -> Vec<u8> {
    let probe = FakeMember::v1(false);
    let membership = join(manager, doc, &probe).await;
    receive(
        &membership,
        Message::SyncStep1 {
            state_vector: vector,
        },
    )
    .await;
    membership.leave();
    probe
        .messages()
        .into_iter()
        .find_map(|m| match m {
            Message::SyncStep2 { update } => Some(update),
            _ => None,
        })
        .expect("the probe got a SyncStep2")
}

/// C# SyncedClientAsync: a client doc holding the room's state.
pub(crate) async fn synced_client(manager: &Manager, doc: &str, expected: &str) -> Doc {
    let client = new_client();
    let update = probe_step2(manager, doc, client.encode_state_vector()).await;
    client.apply_update(&update).expect("the step2 applies");
    assert_eq!(doc_text(&client), expected, "the synced client");
    client
}

/// C# ExportedTextAsync.
pub(crate) async fn exported_text(manager: &Manager, doc: &str) -> String {
    let replica = new_client();
    let update = probe_step2(manager, doc, vec![0]).await;
    replica.apply_update(&update).expect("the step2 applies");
    doc_text(&replica)
}

pub(crate) fn version_of(save: &RecordedSave) -> &str {
    save.version.as_deref().unwrap_or("<nil>")
}

pub(crate) fn version_options(commit_timeout: Duration) -> Options {
    Options {
        export_debounce: ms(10),
        export_max_delay: ms(10),
        eviction_linger: ms(10),
        commit_timeout,
        retry_backoff: ms(10),
        retry_backoff_cap: ms(10),
        ..Options::default()
    }
}

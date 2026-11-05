// Twins of the C# CollabRoomManagerTests.cs cases with no Go twin. C#
// advances a manual clock to fire the room's timers; these run on wall
// time with short timers, as Go's do.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use blok_collab::{BoxFuture, CloseReason, JoinStatus, Member, OperationSource};
use blok_collab_convert::{EditError, EditOp};
use blok_collab_docendpoint::{Loaded, Projection};
use blok_collab_journal::{Context, OpenOutcome, PurgeOutcome};
use blok_collab_wire::Message;
use blok_collab_workingset::{CURRENT_FORMAT, HEADER_LENGTH, Set, Tag};
use blok_jsjson::{Node, Object, Value};
use blok_yjs::Doc;

use crate::test_support::*;
use crate::*;

const DOC: &str = "doc-1";

type FailFn = Box<dyn Fn(&str) -> Option<Error> + Send + Sync>;
type FailWith = Mutex<Option<FailFn>>;
type Hook = Mutex<Option<Box<dyn Fn() + Send + Sync>>>;

fn failing(fail: &FailWith, doc: &str) -> Option<Error> {
    lock(fail).as_ref().and_then(|f| f(doc))
}

fn hook(hook: &Hook) {
    if let Some(f) = lock(hook).as_ref() {
        f();
    }
}

/// C# FakeWorkingSetStore: every call yields, so two unserialised callers
/// would interleave, and the most calls in flight at once is kept.
#[derive(Default)]
struct Store {
    sets: Mutex<HashMap<String, Set>>,
    journal: Mutex<Vec<String>>,
    in_flight: AtomicI32,
    max_in_flight: AtomicI32,
    reads: AtomicI32,
    writes: AtomicI32,
    resets: AtomicI32,
    deletes: AtomicI32,
    before_write: Mutex<Option<Gate>>,
    write_delay: Mutex<Option<Duration>>,
    fail_writes: FailWith,
    fail_deletes: FailWith,
    before_delete: Hook,
    after_reset: Hook,
}

struct Entry<'a>(&'a Store);

impl Drop for Entry<'_> {
    fn drop(&mut self) {
        self.0.in_flight.fetch_sub(1, Ordering::SeqCst);
    }
}

impl Store {
    fn new() -> Arc<Store> {
        Arc::new(Store::default())
    }
    fn enter(&self) -> Entry<'_> {
        let depth = self.in_flight.fetch_add(1, Ordering::SeqCst) + 1;
        self.max_in_flight.fetch_max(depth, Ordering::SeqCst);
        Entry(self)
    }
    fn seed(&self, doc: &str, updates: &[Vec<u8>], tag: Tag) {
        lock(&self.sets).insert(
            doc.to_owned(),
            Set {
                updates: blok_collab_workingset::encode_frames(updates).expect("frames"),
                tag,
            },
        );
    }
    fn holds(&self, doc: &str) -> bool {
        lock(&self.sets).contains_key(doc)
    }
    fn stored(&self, doc: &str) -> Set {
        lock(&self.sets)
            .get(doc)
            .cloned()
            .unwrap_or_else(|| panic!("no working set for {doc:?}"))
    }
    fn frames(&self, doc: &str) -> Vec<Vec<u8>> {
        blok_collab_workingset::decode_frames(&self.stored(doc).updates).expect("frames decode")
    }
    fn frame_count(&self, doc: &str) -> usize {
        lock(&self.sets).get(doc).map_or(0, |set| {
            blok_collab_workingset::decode_frames(&set.updates).map_or(0, |f| f.len())
        })
    }
    fn count(counter: &AtomicI32) -> i32 {
        counter.load(Ordering::SeqCst)
    }
    fn set_before_write(&self, gate: Option<Gate>) {
        *lock(&self.before_write) = gate;
    }
    fn set_fail_writes(&self, f: Option<FailFn>) {
        *lock(&self.fail_writes) = f;
    }
}

impl WorkingSetStore for Store {
    fn read<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<Option<Set>, Error>> {
        Box::pin(async move {
            let _entry = self.enter();
            self.reads.fetch_add(1, Ordering::SeqCst);
            tokio::task::yield_now().await;
            Ok(lock(&self.sets).get(doc_id).cloned())
        })
    }
    fn write<'a>(
        &'a self,
        doc_id: &'a str,
        updates: &'a [u8],
        tag: &'a Tag,
    ) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move {
            let _entry = self.enter();
            self.writes.fetch_add(1, Ordering::SeqCst);
            let gate = lock(&self.before_write).clone();
            if let Some(gate) = gate {
                gate.wait().await;
            }
            let delay = *lock(&self.write_delay);
            if let Some(delay) = delay {
                tokio::time::sleep(delay).await;
            }
            tokio::task::yield_now().await;
            if let Some(err) = failing(&self.fail_writes, doc_id) {
                return Err(err);
            }
            lock(&self.sets).insert(
                doc_id.to_owned(),
                Set {
                    updates: updates.to_vec(),
                    tag: tag.clone(),
                },
            );
            lock(&self.journal).push(format!("write:{}", tag.epoch));
            Ok(())
        })
    }
    fn reset<'a>(&'a self, doc_id: &'a str, tag: &'a Tag) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move {
            let _entry = self.enter();
            self.resets.fetch_add(1, Ordering::SeqCst);
            tokio::task::yield_now().await;
            lock(&self.sets).insert(
                doc_id.to_owned(),
                Set {
                    updates: Vec::new(),
                    tag: tag.clone(),
                },
            );
            lock(&self.journal).push(format!("reset:{}", tag.epoch));
            hook(&self.after_reset);
            Ok(())
        })
    }
    fn retire<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move {
            lock(&self.sets).remove(doc_id);
            lock(&self.journal).push("retire".to_owned());
            Ok(())
        })
    }
    fn delete<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move {
            let _entry = self.enter();
            self.deletes.fetch_add(1, Ordering::SeqCst);
            hook(&self.before_delete);
            tokio::task::yield_now().await;
            if let Some(err) = failing(&self.fail_deletes, doc_id) {
                return Err(err);
            }
            lock(&self.sets).remove(doc_id);
            lock(&self.journal).push("delete".to_owned());
            Ok(())
        })
    }
}

/// FakeEndpoint plus C#'s NextSaveFailure, thrown after the save is
/// recorded and its gate passed.
struct Consumer {
    inner: Arc<FakeEndpoint>,
    next_save_failure: Mutex<Option<Error>>,
    /// Armed, a save panics: the room's drain throws.
    panics: Mutex<bool>,
}

impl Endpoint for Consumer {
    fn load<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<Loaded, Error>> {
        self.inner.load(doc_id)
    }
    fn save<'a>(
        &'a self,
        doc_id: &'a str,
        output_data: &'a Value,
        version: Option<&'a str>,
        projection: Option<&'a Projection>,
    ) -> BoxFuture<'a, Result<Option<String>, Error>> {
        Box::pin(async move {
            assert!(!*lock(&self.panics), "endpoint exploded");
            let answer = self
                .inner
                .save(doc_id, output_data, version, projection)
                .await?;
            if let Some(err) = lock(&self.next_save_failure).take() {
                return Err(err);
            }
            Ok(answer)
        })
    }
}

/// TextConverter plus C#'s seed count and EditFailure.
#[derive(Default)]
struct Conv {
    inner: TextConverter,
    seeds: AtomicI32,
    edit_failure: Mutex<Option<String>>,
}

impl Converter for Conv {
    fn seed<'a>(&'a self, doc: &'a Doc, output_data: &'a Node) -> BoxFuture<'a, Result<(), Error>> {
        self.seeds.fetch_add(1, Ordering::SeqCst);
        self.inner.seed(doc, output_data)
    }
    fn export<'a>(&'a self, doc: &'a Doc) -> BoxFuture<'a, Result<Object, Error>> {
        self.inner.export(doc)
    }
    fn apply_ops<'a>(
        &'a self,
        doc: &'a Doc,
        ops: &'a [EditOp],
    ) -> BoxFuture<'a, Result<(), Error>> {
        if let Some(message) = lock(&self.edit_failure).clone() {
            return Box::pin(async move {
                Err(Error::Convert(blok_collab_convert::Error::Edit(
                    EditError::new(message),
                )))
            });
        }
        self.inner.apply_ops(doc, ops)
    }
    fn migrate_rich_text<'a>(&'a self, doc: &'a Doc) -> BoxFuture<'a, Result<usize, Error>> {
        self.inner.migrate_rich_text(doc)
    }
}

/// C# FakeMember: Allowed, RecheckFailure, RecheckEntered and RecheckGate.
struct Peer {
    m: Arc<FakeMember>,
    allowed: AtomicBool,
    failure: Mutex<Option<String>>,
    entered: Mutex<Option<Gate>>,
    gate: Mutex<Option<Gate>>,
    /// Runs inside the policy, after the gate and before it answers.
    on_answer: Hook,
}

impl Peer {
    fn with(actor: &str, write: bool) -> Arc<Peer> {
        Arc::new(Peer {
            m: FakeMember::new(actor, OperationSource::ClientV1, write),
            allowed: AtomicBool::new(true),
            failure: Mutex::new(None),
            entered: Mutex::new(None),
            gate: Mutex::new(None),
            on_answer: Mutex::new(None),
        })
    }
    fn new() -> Arc<Peer> {
        Peer::with("", true)
    }
    fn reader() -> Arc<Peer> {
        Peer::with("", false)
    }
    fn denied() -> Arc<Peer> {
        let peer = Peer::new();
        peer.deny();
        peer
    }
    fn deny(&self) {
        self.allowed.store(false, Ordering::SeqCst);
    }
    fn fail_recheck(&self, message: &str) {
        *lock(&self.failure) = Some(message.to_owned());
    }
    /// C# RecheckEntered and RecheckGate, set after the join's own check.
    fn hold_recheck(&self) -> (Gate, Gate) {
        let (entered, gate) = (Gate::new(), Gate::new());
        *lock(&self.entered) = Some(entered.clone());
        *lock(&self.gate) = Some(gate.clone());
        (entered, gate)
    }
    fn closed(&self) -> Vec<CloseReason> {
        self.m.closed()
    }
    fn tag(&self) -> Tag {
        let tag = control_tag(&self.m);
        Tag {
            format: tag.format,
            epoch: tag.epoch,
            lineage: tag.lineage,
        }
    }
}

impl Member for Peer {
    fn can_write(&self) -> bool {
        self.m.can_write()
    }
    fn accepts_control_frames(&self) -> bool {
        self.m.accepts_control_frames()
    }
    fn actor_id(&self) -> String {
        self.m.actor_id()
    }
    fn protocol_source(&self) -> OperationSource {
        self.m.protocol_source()
    }
    fn recheck_access(&self) -> BoxFuture<'_, Result<bool, blok_collab::Error>> {
        if let Some(entered) = lock(&self.entered).as_ref() {
            entered.open();
        }
        let gate = lock(&self.gate).clone();
        Box::pin(async move {
            if let Some(gate) = gate {
                gate.wait().await;
            }
            hook(&self.on_answer);
            if let Some(failure) = lock(&self.failure).clone() {
                return Err(failure.into());
            }
            Ok(self.allowed.load(Ordering::SeqCst))
        })
    }
    fn send(&self, frame: Vec<u8>) {
        self.m.send(frame);
    }
    fn close(&self, reason: CloseReason) {
        self.m.close(reason);
    }
}

struct Bench {
    store: Arc<Store>,
    endpoint: Arc<FakeEndpoint>,
    consumer: Arc<Consumer>,
    converter: Arc<Conv>,
    logs: Logs,
    /// C# ThrowingLogger: a logged line holding this text panics after it is kept.
    panic_on: Arc<Mutex<Option<&'static str>>>,
}

fn fast() -> Options {
    Options {
        export_debounce: ms(40),
        export_max_delay: ms(40),
        eviction_linger: ms(150),
        retry_backoff: ms(20),
        retry_backoff_cap: ms(40),
        now: Some(Arc::new(SystemTime::now)),
        ..Options::default()
    }
}

fn slow_export() -> Options {
    Options {
        export_debounce: HOUR,
        export_max_delay: HOUR,
        ..fast()
    }
}

impl Bench {
    fn new() -> Bench {
        let endpoint = FakeEndpoint::new();
        Bench {
            store: Store::new(),
            consumer: Arc::new(Consumer {
                inner: endpoint.clone(),
                next_save_failure: Mutex::new(None),
                panics: Mutex::new(false),
            }),
            endpoint,
            converter: Arc::new(Conv::default()),
            logs: Logs::default(),
            panic_on: Arc::new(Mutex::new(None)),
        }
    }

    fn panic_when_logging(&self, part: &'static str) {
        *lock(&self.panic_on) = Some(part);
    }

    fn manager(&self, o: Options) -> Manager {
        self.manager_over(o, self.store.clone(), None)
    }

    fn manager_over(
        &self,
        o: Options,
        store: Arc<dyn WorkingSetStore>,
        operations: Option<Arc<dyn OperationStore>>,
    ) -> Manager {
        self.manager_with(o, store, operations, None)
    }

    fn manager_with(
        &self,
        o: Options,
        store: Arc<dyn WorkingSetStore>,
        operations: Option<Arc<dyn OperationStore>>,
        activity: Option<Arc<dyn ActivityObserver>>,
    ) -> Manager {
        Manager::new(ManagerOptions {
            store,
            endpoint: self.consumer.clone(),
            converter: self.converter.clone(),
            room: o,
            log: Some({
                let keep = self.logs.log();
                let panic_on = self.panic_on.clone();
                Arc::new(move |line: &str| {
                    keep(line);
                    let part = *lock(&panic_on);
                    if part.is_some_and(|p| line.contains(p)) {
                        panic!("logger failed");
                    }
                })
            }),
            operations,
            activity,
        })
    }

    fn seeds(&self) -> i32 {
        self.converter.seeds.load(Ordering::SeqCst)
    }
}

/// C# Tags.AssertMinted: a fresh lineage at epoch.
fn assert_minted(epoch: i64, tag: &Tag) -> String {
    assert_eq!(tag.format, CURRENT_FORMAT, "{tag:?}");
    assert_eq!(tag.epoch, epoch, "{tag:?}");
    assert!(
        tag.lineage.len() == 32
            && tag
                .lineage
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "{tag:?}"
    );
    assert_ne!(tag.lineage, TAG_LINEAGE, "{tag:?}");
    tag.lineage.clone()
}

fn tag(epoch: i64, lineage: &str) -> Tag {
    Tag {
        format: CURRENT_FORMAT,
        epoch,
        lineage: lineage.to_owned(),
    }
}

async fn try_join(manager: &Manager, doc: &str, peer: &Arc<Peer>) -> blok_collab::JoinResult {
    manager
        .join(doc, peer.clone() as Arc<dyn Member>)
        .await
        .expect("join")
}

async fn status_of(manager: &Manager, doc: &str, peer: &Arc<Peer>) -> JoinStatus {
    try_join(manager, doc, peer).await.status
}

async fn enter(manager: &Manager, doc: &str, peer: &Arc<Peer>) -> Joined {
    let result = try_join(manager, doc, peer).await;
    assert_eq!(result.status, JoinStatus::Joined, "{:?}", result.err);
    result.membership.expect("a membership")
}

fn step2_of(peer: &Peer, last: bool) -> Vec<u8> {
    let updates: Vec<Vec<u8>> = peer
        .m
        .messages()
        .into_iter()
        .filter_map(|m| match m {
            Message::SyncStep2 { update } => Some(update),
            _ => None,
        })
        .collect();
    let picked = if last {
        updates.last()
    } else {
        updates.first()
    };
    picked.cloned().expect("a SyncStep2")
}

/// C# SyncedAsync: a client synced through the member's own connection.
async fn synced(membership: &Joined, peer: &Peer) -> Doc {
    let client = new_client();
    receive(
        membership,
        Message::SyncStep1 {
            state_vector: client.encode_state_vector(),
        },
    )
    .await;
    client
        .apply_update(&step2_of(peer, true))
        .expect("the step2 applies");
    client
}

async fn send_update(membership: &Joined, client: &Doc, text: &str) {
    receive(
        membership,
        Message::SyncUpdate {
            update: update_appending(client, text),
        },
    )
    .await;
}

fn replay(frames: &[Vec<u8>]) -> String {
    let replica = new_client();
    for frame in frames {
        replica.apply_update(frame).expect("a frame applies");
    }
    doc_text(&replica)
}

fn saved_texts(endpoint: &FakeEndpoint) -> Vec<String> {
    endpoint.saves().into_iter().map(|s| s.data).collect()
}

async fn evicted(manager: &Manager) {
    wait_until("the room to be evicted", || manager.live_room_count() == 0).await;
}

async fn edit(manager: &Manager, text: &str) -> EditResult {
    http_edit(manager, DOC, OP_ONE, text).await
}

async fn purge(manager: &Manager, allow: bool) -> Result<PurgeOutcome, Error> {
    manager.purge(DOC, async move { Ok(allow) }).await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_first_join_seeds_from_the_endpoint_exactly_once_even_under_concurrent_joins() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "seeded", None);
    let gate = Gate::new();
    b.endpoint.set_load_gate(Some(gate.clone()));
    let manager = b.manager(fast());
    let mut joins = Vec::new();
    for _ in 0..8 {
        let (manager, peer) = (manager.clone(), Peer::new());
        joins.push(tokio::spawn(
            async move { try_join(&manager, DOC, &peer).await },
        ));
    }
    wait_until("the seed load to start", || b.endpoint.loaded() == 1).await;
    gate.open();
    let mut results = Vec::new();
    for join in joins {
        results.push(join.await.expect("a join"));
    }

    assert!(results.iter().all(|r| r.status == JoinStatus::Joined));
    assert_eq!(b.endpoint.loaded(), 1);
    assert_eq!(b.seeds(), 1);
    assert_eq!(Store::count(&b.store.writes), 1);
    let frames = b.store.frames(DOC);
    assert_eq!(frames.len(), 1);
    assert_minted(0, &b.store.stored(DOC).tag);
    assert_eq!(replay(&frames), "seeded");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_stored_working_set_hydrates_the_room_without_touching_the_endpoint() {
    let b = Bench::new();
    let source = new_client();
    let updates = vec![
        update_appending(&source, "from "),
        update_appending(&source, "disk"),
    ];
    b.store.seed(DOC, &updates, tag_at(3));
    let manager = b.manager(fast());
    let peer = Peer::new();

    let membership = enter(&manager, DOC, &peer).await;
    receive(
        &membership,
        Message::SyncStep1 {
            state_vector: vec![0],
        },
    )
    .await;

    assert_eq!(b.endpoint.loaded(), 0);
    assert_eq!(b.seeds(), 0);
    assert_eq!(peer.tag(), tag_at(3));
    let replica = new_client();
    replica
        .apply_update(&step2_of(&peer, false))
        .expect("the step2 applies");
    assert_eq!(doc_text(&replica), "from disk");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_empty_stored_log_after_a_reset_reseeds_under_the_stored_epoch() {
    let b = Bench::new();
    b.store.seed(DOC, &[], tag_at(5));
    b.endpoint.holds(DOC, "fresh", None);
    let manager = b.manager(fast());
    let peer = Peer::new();

    let _membership = enter(&manager, DOC, &peer).await;

    assert_eq!(b.endpoint.loaded(), 1);
    let lineage = assert_minted(5, &peer.tag());
    assert_eq!(b.store.stored(DOC).tag, tag(5, &lineage));
    assert_eq!(b.store.frames(DOC).len(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_null_document_seeds_an_empty_room_without_failing_and_without_a_converter_call() {
    let b = Bench::new();
    b.endpoint.holds_nothing(DOC, Some("v0"));
    let manager = b.manager(fast());
    let peer = Peer::new();

    let membership = enter(&manager, DOC, &peer).await;
    receive(
        &membership,
        Message::SyncStep1 {
            state_vector: vec![0],
        },
    )
    .await;

    assert_eq!(b.seeds(), 0);
    assert!(b.store.frames(DOC).is_empty());
    assert_minted(0, &b.store.stored(DOC).tag);
    let replica = new_client();
    replica
        .apply_update(&step2_of(&peer, false))
        .expect("the step2 applies");
    assert_eq!(doc_text(&replica), "");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_re_seed_of_a_null_document_keeps_the_lineage_it_persisted() {
    let b = Bench::new();
    b.endpoint.holds_nothing(DOC, None);
    let manager = b.manager(fast());
    let first = Peer::new();
    let membership = enter(&manager, DOC, &first).await;
    let lineage = assert_minted(0, &first.tag());
    membership.leave();
    evicted(&manager).await;

    let second = Peer::new();
    let _again = enter(&manager, DOC, &second).await;

    assert_eq!(b.endpoint.loaded(), 2);
    assert_eq!(second.tag(), tag(0, &lineage));
    assert_eq!(b.store.stored(DOC).tag, tag(0, &lineage));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn every_doc_access_goes_through_one_lane() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "", None);
    *lock(&b.store.write_delay) = Some(ms(1));
    // C# sets both to TimeSpan.Zero; a zero now stays zero here too.
    let manager = b.manager(Options {
        export_debounce: Duration::ZERO,
        export_max_delay: Duration::ZERO,
        ..fast()
    });
    let mut memberships = Vec::new();
    for _ in 0..8 {
        memberships.push(Arc::new(enter(&manager, DOC, &Peer::new()).await));
    }

    let mut storm = Vec::new();
    for _ in 0..25 {
        for membership in &memberships {
            let update = update_appending(&new_client(), "x");
            let m = membership.clone();
            storm.push(tokio::spawn(async move {
                receive(&m, Message::SyncUpdate { update }).await;
            }));
            let m = membership.clone();
            storm.push(tokio::spawn(async move {
                receive(
                    &m,
                    Message::SyncStep1 {
                        state_vector: vec![0],
                    },
                )
                .await;
            }));
        }
        let manager = manager.clone();
        storm.push(tokio::spawn(async move {
            let _ = enter(&manager, DOC, &Peer::reader()).await;
        }));
    }
    for task in storm {
        task.await.expect("a storm task");
    }
    manager.settle().await;

    assert_eq!(b.store.max_in_flight.load(Ordering::SeqCst), 1);
    assert_eq!(exported_text(&manager, DOC).await, "x".repeat(200));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_last_leave_starts_a_linger_and_a_join_during_it_keeps_the_room() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "hello", None);
    let manager = b.manager(Options {
        eviction_linger: ms(400),
        ..fast()
    });
    let first = enter(&manager, DOC, &Peer::new()).await;

    first.leave();
    tokio::time::sleep(ms(100)).await;
    manager.settle().await;
    assert_eq!(manager.live_room_count(), 1);

    let second = try_join(&manager, DOC, &Peer::new()).await;
    tokio::time::sleep(ms(800)).await;
    manager.settle().await;

    assert_eq!(second.status, JoinStatus::Joined);
    assert_eq!(manager.live_room_count(), 1);
    assert_eq!(b.endpoint.loaded(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_cancelled_first_join_leaves_a_room_that_still_evicts() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "hello", None);
    let gate = Gate::new();
    b.endpoint.set_load_gate(Some(gate.clone()));
    let manager = b.manager(fast());
    let m = manager.clone();
    let join = tokio::spawn(async move { try_join(&m, DOC, &Peer::new()).await.status });

    wait_until("the seed load to start", || b.endpoint.loaded() == 1).await;
    join.abort();
    gate.open();
    assert!(
        join.await
            .expect_err("the join was cancelled")
            .is_cancelled(),
        "the join was not cancelled"
    );
    wait_until("the seed", || b.seeds() == 1).await;
    manager.settle().await;

    assert_eq!(manager.live_room_count(), 1);
    evicted(&manager).await;
}

// The join's room work runs in its own task. A caller dropped after that
// task admitted the member never receives the membership, so the room must
// take the member back out itself.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_join_dropped_after_the_room_admitted_the_member_still_evicts() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "hello", None);
    let gate = Gate::new();
    b.endpoint.set_load_gate(Some(gate.clone()));
    let manager = b.manager(fast());
    let peer = Peer::new();
    let mut join = Box::pin(manager.join(DOC, peer.clone() as Arc<dyn Member>));
    let polled = join
        .as_mut()
        .poll(&mut std::task::Context::from_waker(std::task::Waker::noop()));
    assert!(polled.is_pending(), "the join finished in its first poll");
    wait_until("the seed load to start", || b.endpoint.loaded() == 1).await;
    gate.open();

    let mut admitted = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while !admitted {
        assert!(
            tokio::time::Instant::now() < deadline,
            "timed out waiting for the member to be admitted"
        );
        if let Some(room) = manager.live_rooms().pop() {
            admitted = room.state.lock().await.members.len() == 1;
        }
        tokio::time::sleep(ms(5)).await;
    }
    drop(join);

    evicted(&manager).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_cancelled_join_does_not_arm_the_linger_while_others_are_still_in_the_room() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "hello", None);
    let manager = b.manager(fast());
    let _first = enter(&manager, DOC, &Peer::new()).await;
    // C# cancels the join at its lane wait. Holding the lane keeps the join
    // there, or under load it can finish within the one poll.
    let room = manager.live_rooms().pop().expect("the room");
    let held = room.lane.reserve().hold().await;

    let second = Peer::new();
    let mut cancelled = Box::pin(try_join(&manager, DOC, &second));
    let polled = cancelled
        .as_mut()
        .poll(&mut std::task::Context::from_waker(std::task::Waker::noop()));
    assert!(
        polled.is_pending(),
        "the join finished before it was cancelled"
    );
    drop(cancelled);
    drop(held);
    tokio::time::sleep(ms(500)).await;
    manager.settle().await;

    assert_eq!(manager.live_room_count(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_linger_elapsing_compacts_exports_and_drops_the_room() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "a", Some("v1"));
    let manager = b.manager(slow_export());
    let peer = Peer::new();
    let membership = enter(&manager, DOC, &peer).await;
    let client = synced(&membership, &peer).await;

    for piece in ["b", "c", "d"] {
        send_update(&membership, &client, piece).await;
    }
    wait_until("the working set to catch up", || {
        b.store.frame_count(DOC) == 4
    })
    .await;
    membership.leave();
    evicted(&manager).await;

    let frames = b.store.frames(DOC);
    assert_eq!(frames.len(), 1);
    assert_eq!(replay(&frames), "abcd");
    let saves = b.endpoint.saves();
    assert_eq!(saves.len(), 1);
    assert_eq!(saves[0].data, text_json("abcd"));
    assert_eq!(version_of(&saves[0]), "v1");

    let rejoined = Peer::new();
    let _again = enter(&manager, DOC, &rejoined).await;
    assert_eq!(b.endpoint.loaded(), 1);
    assert_eq!(exported_text(&manager, DOC).await, "abcd");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn eviction_waits_for_an_in_flight_export_before_flushing() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "a", None);
    let gate = Gate::new();
    b.endpoint.set_save_gate(Some(gate.clone()));
    let manager = b.manager(fast());
    let peer = Peer::new();
    let membership = enter(&manager, DOC, &peer).await;
    let client = synced(&membership, &peer).await;
    send_update(&membership, &client, "b").await;
    wait_until("the working set to catch up", || {
        b.store.frame_count(DOC) == 2
    })
    .await;
    membership.leave();

    wait_until("the export to start", || b.endpoint.saved() == 1).await;
    tokio::time::sleep(ms(400)).await;

    assert_eq!(manager.live_room_count(), 1);
    assert_eq!(b.store.frame_count(DOC), 2);

    gate.open();
    b.endpoint.set_save_gate(None);
    evicted(&manager).await;

    assert_eq!(b.endpoint.saved(), 1);
    let frames = b.store.frames(DOC);
    assert_eq!(frames.len(), 1);
    assert_eq!(replay(&frames), "ab");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn membership_calls_stay_safe_after_leaving_and_after_the_room_closed() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "a", None);
    let manager = b.manager(Options {
        eviction_linger: HOUR,
        ..fast()
    });
    let peer = Peer::new();
    let membership = enter(&manager, DOC, &peer).await;
    let client = synced(&membership, &peer).await;
    let frames_before = b.store.frame_count(DOC);

    membership.leave();
    membership.leave();
    send_update(&membership, &client, "late").await;
    manager.settle().await;

    assert_eq!(b.store.frame_count(DOC), frames_before);
    assert_eq!(manager.live_room_count(), 1);

    let second = enter(&manager, DOC, &Peer::new()).await;
    manager.drain().await.expect("drain");
    receive(
        &second,
        Message::SyncStep1 {
            state_vector: vec![0],
        },
    )
    .await;
    second.leave();
    membership.leave();

    assert_eq!(manager.live_room_count(), 0);
    assert_eq!(b.store.frame_count(DOC), frames_before);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_headless_edit_is_in_the_blob_before_it_is_answered() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "a", None);
    let manager = b.manager(fast());
    let probe = enter(&manager, DOC, &Peer::new()).await;
    probe.leave();
    let stuck = Gate::new();
    b.store.set_before_write(Some(stuck.clone()));

    let m = manager.clone();
    let pending = tokio::spawn(async move { edit(&m, "b").await });
    wait_until("the edit's blob write to start", || {
        Store::count(&b.store.writes) == 2
    })
    .await;
    tokio::time::sleep(ms(50)).await;

    assert!(
        !pending.is_finished(),
        "the edit was answered before its blob write landed"
    );
    stuck.open();
    b.store.set_before_write(None);
    assert_eq!(pending.await.expect("the edit").status, EditStatus::Applied);
    assert_eq!(replay(&b.store.frames(DOC)), "ab");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_headless_edit_persists_exports_after_the_debounce_and_evicts_after_the_linger() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "a", Some("v1"));
    let manager = b.manager(Options {
        eviction_linger: ms(400),
        ..fast()
    });

    let result = edit(&manager, "b").await;

    assert_eq!(result.status, EditStatus::Applied, "{:?}", result.err);
    assert_eq!(b.endpoint.loaded(), 1);
    assert_eq!(replay(&b.store.frames(DOC)), "ab");
    assert_eq!(manager.live_room_count(), 1);

    wait_until("the debounced export", || b.endpoint.saved() == 1).await;
    manager.settle().await;

    let saves = b.endpoint.saves();
    assert_eq!(saves.len(), 1);
    assert_eq!(saves[0].data, text_json("ab"));
    assert_eq!(version_of(&saves[0]), "v1");
    assert_eq!(manager.live_room_count(), 1);

    evicted(&manager).await;
    assert_eq!(b.endpoint.saved(), 1);
    assert_eq!(replay(&b.store.frames(DOC)), "ab");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_refused_edit_writes_nothing_and_the_room_still_evicts() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "a", None);
    *lock(&b.converter.edit_failure) = Some("collab: op 0: refused.".to_owned());
    let manager = b.manager(fast());

    let result = edit(&manager, "b").await;

    assert_eq!(result.status, EditStatus::Invalid);
    assert!(
        matches!(
            result.err,
            Some(Error::Convert(blok_collab_convert::Error::Edit(_)))
        ),
        "{:?}",
        result.err
    );
    assert_eq!(Store::count(&b.store.writes), 1);
    assert_eq!(replay(&b.store.frames(DOC)), "a");
    assert_eq!(manager.live_room_count(), 1);

    evicted(&manager).await;
    assert_eq!(b.endpoint.saved(), 0);
}

#[test]
#[ignore = "pins ICollabRoomManager's .NET default interface method, which Rust traits have no counterpart for"]
fn legacy_manager_cannot_silently_ignore_an_access_recheck() {}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn recheck_expels_a_member_when_policy_and_logger_throw() {
    let b = Bench::new();
    b.store
        .seed(DOC, &[full_state(&doc_with("seeded"))], tag_at(4));
    let manager = b.manager(fast());
    let revoked = Peer::new();
    let allowed = Peer::new();
    let membership = enter(&manager, DOC, &revoked).await;
    let _allowed = enter(&manager, DOC, &allowed).await;
    revoked.fail_recheck("policy failed");
    b.panic_when_logging("could not recheck member access");
    assert_eq!(manager.live_room_count(), 1);

    let expelled = manager.recheck_access(DOC).await.expect("recheck");

    assert_eq!(expelled, 1);
    assert_eq!(revoked.closed(), [CloseReason::Forbidden]);
    assert!(allowed.closed().is_empty());
    let client = new_client();
    let _ = membership
        .receive(sync_frame(Message::SyncUpdate {
            update: update_appending(&client, " stolen"),
        }))
        .await;
    assert_eq!(exported_text(&manager, DOC).await, "seeded");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn first_join_is_refused_when_policy_and_logger_throw() {
    let b = Bench::new();
    let manager = b.manager(fast());
    let peer = Peer::new();
    peer.fail_recheck("policy failed");
    // C#'s logger throws on every line.
    b.panic_when_logging("");

    let denied = status_of(&manager, DOC, &peer).await;

    assert_eq!(denied, JoinStatus::Forbidden);
    assert_eq!(b.endpoint.loaded(), 0);
    assert_eq!(manager.live_room_count(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelling_an_access_recheck_does_not_expel_an_allowed_member() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "seeded", None);
    let manager = b.manager(fast());
    let peer = Peer::new();
    let _membership = enter(&manager, DOC, &peer).await;
    let (entered, gate) = peer.hold_recheck();
    let m = manager.clone();
    let recheck = tokio::spawn(async move { m.recheck_access(DOC).await });
    tokio::time::timeout(Duration::from_secs(3), entered.wait())
        .await
        .expect("the recheck to start");

    recheck.abort();
    assert!(
        recheck
            .await
            .expect_err("the recheck was cancelled")
            .is_cancelled(),
        "the recheck was not cancelled"
    );
    peer.fail_recheck("canceled");
    gate.open();
    manager.settle().await;

    assert!(peer.closed().is_empty());
    assert_eq!(manager.live_room_count(), 1);
}

// C# APolicyThatFailsAfterTheCallerCancelledStillExpels: only a
// cancellation aborts a cancelled recheck. A Rust policy cannot outlive a
// cancel at an await, so the caller cancels inside the policy, just before
// it fails.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_policy_that_fails_after_the_caller_cancelled_still_expels() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "seeded", None);
    let manager = b.manager(fast());
    let peer = Peer::new();
    let _membership = enter(&manager, DOC, &peer).await;
    let token = Token::new();
    let cancel = token.clone();
    *lock(&peer.on_answer) = Some(Box::new(move || cancel.cancel()));
    peer.fail_recheck("policy failed");

    let expelled = manager
        .recheck_access_with(DOC, &token)
        .await
        .expect("recheck");

    assert_eq!(expelled, 1);
    assert_eq!(peer.closed(), [CloseReason::Forbidden]);
}

// C# hands the caller's token to the policy. In Rust a cancel drops the
// policy's future, so a policy that never answers does not hold the room.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_cancelled_recheck_drops_a_policy_that_never_answers() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "seeded", None);
    let manager = b.manager(fast());
    let peer = Peer::new();
    let _membership = enter(&manager, DOC, &peer).await;
    let (entered, _gate) = peer.hold_recheck();
    let token = Token::new();
    let m = manager.clone();
    let caller = token.clone();
    let recheck = tokio::spawn(async move { m.recheck_access_with(DOC, &caller).await });
    tokio::time::timeout(Duration::from_secs(3), entered.wait())
        .await
        .expect("the recheck to start");

    token.cancel();

    let answer = tokio::time::timeout(Duration::from_secs(3), recheck)
        .await
        .expect("the recheck to end")
        .expect("the recheck task");
    assert!(matches!(answer, Err(Error::Canceled)), "{answer:?}");
    tokio::time::timeout(Duration::from_secs(3), manager.settle())
        .await
        .expect("the room lane to be free");
    assert!(peer.closed().is_empty());
}

/// C# RecordingActivityObserver with Gate: every call waits for the gate,
/// a slow host.
struct SlowObserver {
    records: AtomicUsize,
    gate: Gate,
}

impl ActivityObserver for SlowObserver {
    fn record<'a>(
        &'a self,
        _doc_id: &'a str,
        _actor_id: &'a str,
        _at: SystemTime,
        _kind: ActivityKind,
    ) -> BoxFuture<'a, Result<(), Error>> {
        self.records.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move {
            self.gate.wait().await;
            Ok(())
        })
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_throwing_activity_drop_logger_does_not_strand_other_revoked_members() {
    let b = Bench::new();
    b.store
        .seed(DOC, &[full_state(&doc_with("seeded"))], tag_at(4));
    let observer = Arc::new(SlowObserver {
        records: AtomicUsize::new(0),
        gate: Gate::new(),
    });
    let manager = b.manager_with(
        fast(),
        b.store.clone(),
        None,
        Some(observer.clone() as Arc<dyn ActivityObserver>),
    );
    let _holder = enter(&manager, DOC, &Peer::with("holder", true)).await;
    wait_until("the first activity record", || {
        observer.records.load(Ordering::SeqCst) >= 1
    })
    .await;

    for index in 0..127 {
        let flapping = enter(
            &manager,
            DOC,
            &Peer::with(&format!("visitor-{index}"), true),
        )
        .await;
        flapping.leave();
    }
    let first = Peer::with("revoked-1", true);
    let second = Peer::with("revoked-2", true);
    let _first = enter(&manager, DOC, &first).await;
    let _second = enter(&manager, DOC, &second).await;
    first.deny();
    second.deny();
    b.panic_when_logging("dropped an activity record");

    let expelled = manager.recheck_access(DOC).await;
    observer.gate.open();

    assert_eq!(expelled.expect("recheck"), 2);
    assert_eq!(first.closed(), [CloseReason::Forbidden]);
    assert_eq!(second.closed(), [CloseReason::Forbidden]);
    assert!(b.logs.logged("dropped an activity record"));
}

/// Fails every call and keeps the kinds it was told.
#[derive(Default)]
struct FailingObserver(Mutex<Vec<ActivityKind>>);

impl ActivityObserver for FailingObserver {
    fn record<'a>(
        &'a self,
        _doc_id: &'a str,
        _actor_id: &'a str,
        _at: SystemTime,
        kind: ActivityKind,
    ) -> BoxFuture<'a, Result<(), Error>> {
        lock(&self.0).push(kind);
        Box::pin(async { Err(Error::message("the activity table is down")) })
    }
}

// C# AThrowingObserverAndLoggerDoNotStopTheActivityPump.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_throwing_observer_and_logger_do_not_stop_the_activity_pump() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "hello", None);
    let observer = Arc::new(FailingObserver::default());
    let manager = b.manager_with(
        fast(),
        b.store.clone(),
        None,
        Some(observer.clone() as Arc<dyn ActivityObserver>),
    );
    b.panic_when_logging("activity observer failed");
    let peer = Peer::with("user-1", true);
    let membership = enter(&manager, DOC, &peer).await;
    tokio::time::timeout(Duration::from_secs(3), manager.settle())
        .await
        .expect("the join's activity to settle");

    let _ = membership.receive(sync_frame(Message::Activity)).await;
    tokio::time::timeout(Duration::from_secs(3), manager.settle())
        .await
        .expect("the activity to settle");

    assert_eq!(
        *lock(&observer.0),
        [ActivityKind::Joined, ActivityKind::Active]
    );
    assert!(peer.closed().is_empty());
}

/// The first call fails once released; the second waits on its own gate.
#[derive(Default)]
struct RestartingObserver {
    calls: AtomicUsize,
    first: tokio::sync::Notify,
    first_in: tokio::sync::Notify,
    second: tokio::sync::Notify,
    second_in: tokio::sync::Notify,
}

impl ActivityObserver for RestartingObserver {
    fn record<'a>(
        &'a self,
        _doc_id: &'a str,
        _actor_id: &'a str,
        _at: SystemTime,
        _kind: ActivityKind,
    ) -> BoxFuture<'a, Result<(), Error>> {
        let call = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
        Box::pin(async move {
            match call {
                1 => {
                    self.first_in.notify_one();
                    self.first.notified().await;
                    Err(Error::message("the activity table is down"))
                }
                2 => {
                    self.second_in.notify_one();
                    self.second.notified().await;
                    Ok(())
                }
                _ => Ok(()),
            }
        })
    }
}

// C# ASettleWaitsForRecordsARestartedPumpDelivers.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_settle_waits_for_records_a_restarted_pump_delivers() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "hello", None);
    let observer = Arc::new(RestartingObserver::default());
    let manager = b.manager_with(
        fast(),
        b.store.clone(),
        None,
        Some(observer.clone() as Arc<dyn ActivityObserver>),
    );
    b.panic_when_logging("activity observer failed");
    let peer = Peer::with("user-1", true);
    let membership = enter(&manager, DOC, &peer).await;
    let bound = Duration::from_secs(10);
    tokio::time::timeout(bound, observer.first_in.notified())
        .await
        .expect("the first record");

    let _ = membership.receive(sync_frame(Message::Activity)).await;
    let settling = manager.clone();
    let settled = tokio::spawn(async move { settling.settle().await });
    // Long enough for the settle to pass the lane and hold the first pump.
    tokio::time::sleep(Duration::from_millis(100)).await;

    observer.first.notify_one();
    tokio::time::timeout(bound, observer.second_in.notified())
        .await
        .expect("the second record");
    tokio::time::sleep(Duration::from_millis(200)).await;
    let early = settled.is_finished();
    observer.second.notify_one();
    tokio::time::timeout(bound, settled)
        .await
        .expect("the settle")
        .unwrap();
    assert!(
        !early,
        "the settle returned before the restarted pump delivered"
    );
}

/// The first call fails once released, `fails` more fail at once, and the
/// one after them waits on its own gate.
struct BacklogObserver {
    calls: AtomicUsize,
    fails: usize,
    first: tokio::sync::Notify,
    first_in: tokio::sync::Notify,
    last: tokio::sync::Notify,
    last_in: tokio::sync::Notify,
}

impl ActivityObserver for BacklogObserver {
    fn record<'a>(
        &'a self,
        _doc_id: &'a str,
        _actor_id: &'a str,
        _at: SystemTime,
        _kind: ActivityKind,
    ) -> BoxFuture<'a, Result<(), Error>> {
        let call = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
        Box::pin(async move {
            if call == 1 {
                self.first_in.notify_one();
                self.first.notified().await;
            } else if call == 2 + self.fails {
                self.last_in.notify_one();
                self.last.notified().await;
                return Ok(());
            }
            Err(Error::message("the activity table is down"))
        })
    }
}

// Go TestPumpRestartsUnderABacklogDoNotPileUpGoroutines: N logger throws
// under a backlog do not hold N tasks.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pump_restarts_under_a_backlog_do_not_pile_up_goroutines() {
    const THROWS: usize = 40;
    let b = Bench::new();
    b.endpoint.holds(DOC, "hello", None);
    let observer = Arc::new(BacklogObserver {
        calls: AtomicUsize::new(0),
        fails: THROWS,
        first: tokio::sync::Notify::new(),
        first_in: tokio::sync::Notify::new(),
        last: tokio::sync::Notify::new(),
        last_in: tokio::sync::Notify::new(),
    });
    let manager = b.manager_with(
        fast(),
        b.store.clone(),
        None,
        Some(observer.clone() as Arc<dyn ActivityObserver>),
    );
    b.panic_when_logging("activity observer failed");
    let bound = Duration::from_secs(10);
    let first = Peer::with("user-0", true);
    let _first = enter(&manager, DOC, &first).await;
    tokio::time::timeout(bound, observer.first_in.notified())
        .await
        .expect("the first record");
    let mut joined = Vec::new();
    for i in 1..=THROWS + 1 {
        let peer = Peer::with(&format!("user-{i}"), true);
        let membership = enter(&manager, DOC, &peer).await;
        joined.push((peer, membership));
    }
    let metrics = tokio::runtime::Handle::current().metrics();
    let baseline = metrics.num_alive_tasks();

    observer.first.notify_one();
    tokio::time::timeout(bound, observer.last_in.notified())
        .await
        .expect("the last record");
    let grown = metrics.num_alive_tasks().saturating_sub(baseline);
    observer.last.notify_one();
    manager.settle().await;
    assert!(
        grown <= THROWS / 4,
        "{grown} more tasks after {THROWS} restarts"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn recheck_keeps_queued_writes_out_of_the_journal_and_rejects_a_queued_join() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "seeded", None);
    let operations = FakeJournal::new();
    let manager = b.manager_over(fast(), b.store.clone(), Some(Arc::new(operations.clone())));
    let revoked = Peer::new();
    let allowed = Peer::new();
    let membership = Arc::new(enter(&manager, DOC, &revoked).await);
    let _allowed = enter(&manager, DOC, &allowed).await;
    revoked.deny();
    let (entered, gate) = revoked.hold_recheck();

    let m = manager.clone();
    let recheck = tokio::spawn(async move { m.recheck_access(DOC).await });
    tokio::time::timeout(Duration::from_secs(3), entered.wait())
        .await
        .expect("the recheck to start");
    let update = update_appending(&new_client(), " stolen");
    let queued = membership.clone();
    let write = tokio::spawn(async move {
        let _ = queued
            .receive(sync_frame(Message::SyncUpdate { update }))
            .await;
    });
    let m = manager.clone();
    let denied = tokio::spawn(async move { status_of(&m, DOC, &Peer::denied()).await });
    wait_for_lane_waiters(&manager, 2, "the write and the join to queue").await;
    gate.open();

    assert_eq!(recheck.await.expect("recheck").expect("recheck"), 1);
    write.await.expect("the queued write");
    assert_eq!(denied.await.expect("the join"), JoinStatus::Forbidden);
    assert!(operations.committed(DOC).is_empty());
    assert!(
        !allowed
            .m
            .messages()
            .iter()
            .any(|m| matches!(m, Message::SyncUpdate { .. }))
    );
    assert_eq!(exported_text(&manager, DOC).await, "seeded");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn recheck_closes_a_join_that_passed_access_before_the_acl_changed() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "seeded", None);
    let gate = Gate::new();
    b.endpoint.set_load_gate(Some(gate.clone()));
    let manager = b.manager(fast());
    let revoked = Peer::new();
    let (m, r) = (manager.clone(), revoked.clone());
    let join = tokio::spawn(async move { try_join(&m, DOC, &r).await });
    wait_until("the seed load to start", || b.endpoint.loaded() == 1).await;
    revoked.deny();
    let m = manager.clone();
    let recheck = tokio::spawn(async move { m.recheck_access(DOC).await });
    wait_for_lane_waiters(&manager, 1, "the recheck to queue").await;
    gate.open();

    assert_eq!(join.await.expect("join").status, JoinStatus::Joined);
    assert_eq!(recheck.await.expect("recheck").expect("recheck"), 1);
    assert_eq!(revoked.closed(), [CloseReason::Forbidden]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reset_raises_the_epoch_closes_every_member_and_reseeds_on_the_next_join() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "old", None);
    let manager = b.manager(fast());
    let first = Peer::new();
    let second = Peer::reader();
    let membership = enter(&manager, DOC, &first).await;
    let _second = enter(&manager, DOC, &second).await;
    let seeded = assert_minted(0, &b.store.stored(DOC).tag);

    let result = manager.reset(DOC).await.expect("reset");

    let reset = assert_minted(1, result.tag.as_ref().expect("a tag"));
    assert_ne!(seeded, reset);
    assert_eq!(Store::count(&b.store.resets), 1);
    assert_eq!(b.store.stored(DOC).tag, tag(1, &reset));
    assert!(b.store.frames(DOC).is_empty());
    assert_eq!(first.closed(), [CloseReason::Reset]);
    assert_eq!(second.closed(), [CloseReason::Reset]);
    assert_eq!(manager.live_room_count(), 0);

    let _ = membership
        .receive(sync_frame(Message::SyncUpdate {
            update: update_appending(&new_client(), "late"),
        }))
        .await;
    assert!(b.store.frames(DOC).is_empty());

    b.endpoint.holds(DOC, "new", None);
    let rejoined = Peer::new();
    let _rejoined = enter(&manager, DOC, &rejoined).await;
    assert_eq!(b.endpoint.loaded(), 2);
    let reseeded = assert_minted(1, &rejoined.tag());
    assert_ne!(reset, reseeded);
    assert_eq!(b.store.stored(DOC).tag, tag(1, &reseeded));
    assert_eq!(exported_text(&manager, DOC).await, "new");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reset_without_a_live_room_still_raises_the_stored_epoch() {
    for (stored, stored_epoch, expected) in [(true, 4, 5), (false, 0, 1)] {
        let b = Bench::new();
        if stored {
            b.store
                .seed(DOC, &[full_state(&doc_with("x"))], tag_at(stored_epoch));
        }
        let manager = b.manager(fast());

        let result = manager.reset(DOC).await.expect("reset");

        assert_minted(expected, result.tag.as_ref().expect("a tag"));
        assert_eq!(Store::count(&b.store.resets), 1, "stored {stored}");
        assert_eq!(b.endpoint.loaded(), 0, "stored {stored}");
        assert_eq!(manager.live_room_count(), 0, "stored {stored}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reset_waits_for_an_in_flight_blob_write_instead_of_racing_it() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "a", None);
    let manager = b.manager(fast());
    let peer = Peer::new();
    let membership = enter(&manager, DOC, &peer).await;
    let client = synced(&membership, &peer).await;
    let stuck = Gate::new();
    b.store.set_before_write(Some(stuck.clone()));
    send_update(&membership, &client, "b").await;
    wait_until("the blob write to start", || {
        Store::count(&b.store.writes) == 2
    })
    .await;

    let m = manager.clone();
    let reset = tokio::spawn(async move { m.reset(DOC).await });
    wait_for_lane_waiters(&manager, 1, "the reset to queue").await;
    stuck.open();
    b.store.set_before_write(None);
    let result = reset.await.expect("reset").expect("reset");

    let minted = result.tag.expect("a tag");
    assert_minted(1, &minted);
    let journal = lock(&b.store.journal).clone();
    assert_eq!(journal[journal.len() - 2..], ["write:0", "reset:1"]);
    assert_eq!(b.store.stored(DOC).tag, minted);
    assert!(b.store.frames(DOC).is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_stored_working_set_of_another_format_fails_the_join_closed() {
    let b = Bench::new();
    b.store.seed(
        DOC,
        &[full_state(&doc_with("x"))],
        Tag {
            format: CURRENT_FORMAT + 1,
            epoch: 0,
            lineage: TAG_LINEAGE.to_owned(),
        },
    );
    let manager = b.manager(fast());

    let status = status_of(&manager, DOC, &Peer::new()).await;

    assert_eq!(status, JoinStatus::SeedFailed);
    assert_eq!(b.endpoint.loaded(), 0);
    assert!(b.logs.logged("format"), "{:?}", b.logs.lines());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_store_blip_during_the_on_load_compaction_still_joins_and_retries_the_write() {
    let b = Bench::new();
    let source = new_client();
    let updates: Vec<Vec<u8>> = ["a", "b", "c", "d", "e"]
        .iter()
        .map(|piece| update_appending(&source, piece))
        .collect();
    b.store.seed(DOC, &updates, tag_at(2));
    b.store
        .set_fail_writes(Some(Box::new(|_| Some(Error::message("disk full")))));
    let manager = b.manager(Options {
        compaction_frame_threshold: 4,
        ..fast()
    });

    let _membership = enter(&manager, DOC, &Peer::new()).await;

    assert_eq!(b.store.frames(DOC).len(), 5);
    assert!(b.logs.logged("compacted"), "{:?}", b.logs.lines());
    assert_eq!(exported_text(&manager, DOC).await, "abcde");

    b.store.set_fail_writes(None);
    wait_until("the retried write of the compacted log", || {
        b.store.frame_count(DOC) == 1
    })
    .await;
    assert_eq!(replay(&b.store.frames(DOC)), "abcde");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_request_abort_after_the_store_reset_landed_still_closes_the_room() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "old", None);
    let manager = b.manager(fast());
    let peer = Peer::new();
    let _membership = enter(&manager, DOC, &peer).await;
    let request: Arc<Mutex<Option<tokio::task::AbortHandle>>> = Arc::new(Mutex::new(None));
    let go = Gate::new();
    let m = manager.clone();
    let start = go.clone();
    let reset = tokio::spawn(async move {
        start.wait().await;
        m.reset(DOC).await
    });
    *lock(&request) = Some(reset.abort_handle());
    let abort = request.clone();
    *lock(&b.store.after_reset) = Some(Box::new(move || {
        if let Some(handle) = lock(&abort).as_ref() {
            handle.abort();
        }
    }));

    go.open();
    let _ = reset.await;
    wait_until("the room to close", || !peer.closed().is_empty()).await;
    evicted(&manager).await;

    assert_eq!(Store::count(&b.store.resets), 1);
    assert_eq!(b.store.stored(DOC).tag.epoch, 1);
    assert_eq!(peer.closed(), [CloseReason::Reset]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reset_abandons_an_in_flight_export_instead_of_letting_it_land_afterwards() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "a", None);
    let gate = Gate::new();
    b.endpoint.set_save_gate(Some(gate.clone()));
    let manager = b.manager(fast());
    let peer = Peer::new();
    let membership = enter(&manager, DOC, &peer).await;
    let client = synced(&membership, &peer).await;
    send_update(&membership, &client, "b").await;
    wait_until("the export to start", || b.endpoint.saved() == 1).await;

    let reset = tokio::time::timeout(Duration::from_secs(10), manager.reset(DOC)).await;
    assert!(reset.is_ok(), "the reset waited on the stuck export");
    gate.open();
    b.endpoint.set_save_gate(None);
    wait_until("the room to be evicted", || manager.live_room_count() == 0).await;
    manager.settle().await;

    assert_eq!(b.endpoint.saved(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn drain_flushes_every_room_closes_members_as_draining_and_refuses_new_joins() {
    let b = Bench::new();
    b.endpoint.holds("doc-a", "a", None);
    b.endpoint.holds("doc-b", "b", None);
    let manager = b.manager(slow_export());
    let member_a = Peer::new();
    let member_b = Peer::reader();
    let membership_a = enter(&manager, "doc-a", &member_a).await;
    let _membership_b = enter(&manager, "doc-b", &member_b).await;
    let client = synced(&membership_a, &member_a).await;
    send_update(&membership_a, &client, "!").await;
    send_update(&membership_a, &client, "?").await;

    manager.drain().await.expect("drain");

    assert_eq!(member_a.closed(), [CloseReason::Draining]);
    assert_eq!(member_b.closed(), [CloseReason::Draining]);
    let saves = b.endpoint.saves();
    assert_eq!(saves.len(), 1, "{saves:?}");
    assert_eq!(saves[0].doc, "doc-a");
    assert_eq!(saves[0].data, text_json("a!?"));
    assert_eq!(b.store.frames("doc-a").len(), 1);
    assert_eq!(manager.live_room_count(), 0);

    let refused = status_of(&manager, "doc-c", &Peer::new()).await;
    assert_eq!(refused, JoinStatus::Draining);
    assert_eq!(b.endpoint.loaded(), 2);
}

fn disk_store() -> (Arc<blok_collab_workingset::LocalStore>, TempDir) {
    let dir = TempDir::new();
    (
        Arc::new(blok_collab_workingset::LocalStore::new(dir.path(), None)),
        dir,
    )
}

fn disk_path(dir: &TempDir) -> std::path::PathBuf {
    dir.path().join(blok_collab_workingset::doc_key(DOC))
}

async fn disk_write(disk: &blok_collab_workingset::LocalStore, text: &str, tag: &Tag) {
    let frames =
        blok_collab_workingset::encode_frames(&[full_state(&doc_with(text))]).expect("frames");
    WorkingSetStore::write(disk, DOC, &frames, tag)
        .await
        .expect("the disk write");
}

async fn disk_read(disk: &blok_collab_workingset::LocalStore) -> Set {
    WorkingSetStore::read(disk, DOC)
        .await
        .expect("the disk read")
        .expect("a stored working set")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_re_seed_after_an_unreadable_blob_mints_a_new_lineage() {
    let b = Bench::new();
    let (disk, dir) = disk_store();
    let before = blok_collab_workingset::new_lineage();
    disk_write(&disk, "old", &tag(5, &before)).await;
    let path = disk_path(&dir);
    let mut bytes = std::fs::read(&path).expect("read the blob");
    bytes[0] ^= 0xff;
    std::fs::write(&path, &bytes).expect("write the blob");
    b.endpoint.holds(DOC, "fresh", None);
    let manager = b.manager_over(fast(), disk.clone(), None);
    let peer = Peer::new();

    let _membership = enter(&manager, DOC, &peer).await;

    let announced = peer.tag();
    let lineage = assert_minted(0, &announced);
    assert_ne!(before, lineage);
    assert!(
        matches!(peer.m.messages().first(), Some(Message::BlokControl { .. })),
        "the first frame is not the control frame"
    );
    assert_eq!(disk_read(&disk).await.tag, announced);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_re_seed_after_a_blob_with_corrupt_frames_under_an_intact_header_still_joins() {
    let b = Bench::new();
    let (disk, dir) = disk_store();
    disk_write(&disk, "old", &tag_at(3)).await;
    let path = disk_path(&dir);
    let written = std::fs::read(&path).expect("read the blob");
    let mut damaged = written[..HEADER_LENGTH].to_vec();
    damaged.extend_from_slice(&[0xff, 0xff]);
    std::fs::write(&path, &damaged).expect("write the blob");
    b.endpoint.holds(DOC, "fresh", None);
    let manager = b.manager_over(fast(), disk.clone(), None);
    let peer = Peer::new();

    let _membership = enter(&manager, DOC, &peer).await;

    assert_minted(0, &peer.tag());
    let stored = disk_read(&disk).await;
    assert_eq!(stored.tag, peer.tag());
    let frames = blok_collab_workingset::decode_frames(&stored.updates).unwrap_or_default();
    assert_eq!(replay(&frames), "fresh");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_re_seed_after_a_lost_blob_mints_a_new_lineage_under_the_same_epoch() {
    let b = Bench::new();
    let (disk, dir) = disk_store();
    b.endpoint.holds(DOC, "v1", None);
    let manager = b.manager_over(fast(), disk.clone(), None);
    let first = Peer::new();
    let membership = enter(&manager, DOC, &first).await;
    let before = assert_minted(0, &first.tag());
    membership.leave();
    evicted(&manager).await;
    std::fs::remove_file(disk_path(&dir)).expect("lose the blob");

    let second = Peer::new();
    let _again = enter(&manager, DOC, &second).await;

    assert_eq!(b.seeds(), 2);
    assert_eq!(first.tag().epoch, second.tag().epoch);
    assert_ne!(before, assert_minted(0, &second.tag()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_store_outage_keeps_the_room_loaded_until_the_working_set_catches_up() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "hello", None);
    let manager = b.manager(fast());
    let peer = Peer::new();
    let membership = enter(&manager, DOC, &peer).await;
    let client = synced(&membership, &peer).await;
    b.store
        .set_fail_writes(Some(Box::new(|_| Some(Error::message("disk full")))));

    send_update(&membership, &client, "!").await;
    wait_until("the export", || b.endpoint.saved() == 1).await;
    assert_eq!(saved_texts(&b.endpoint)[0], text_json("hello!"));

    membership.leave();
    wait_until("the eviction's flush to fail", || {
        b.logs.logged("could not flush the working set")
    })
    .await;
    manager.settle().await;

    assert_eq!(manager.live_room_count(), 1);

    b.store.set_fail_writes(None);
    evicted(&manager).await;

    let frames = b.store.frames(DOC);
    assert_eq!(frames.len(), 1);
    assert_eq!(replay(&frames), "hello!");
    assert_eq!(b.endpoint.saved(), 1);

    let _again = enter(&manager, DOC, &Peer::new()).await;
    assert_eq!(b.endpoint.loaded(), 1);
    assert_eq!(exported_text(&manager, DOC).await, "hello!");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_endpoint_outage_at_eviction_keeps_the_room_loaded_until_the_export_lands() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "hello", None);
    let manager = b.manager(Options {
        retry_backoff: ms(300),
        retry_backoff_cap: ms(300),
        ..slow_export()
    });
    let peer = Peer::new();
    let membership = enter(&manager, DOC, &peer).await;
    let client = synced(&membership, &peer).await;
    send_update(&membership, &client, "!").await;
    manager.settle().await;
    *lock(&b.consumer.next_save_failure) =
        Some(Error::message("collab: the doc endpoint PUT returned 502."));

    membership.leave();
    wait_until("the eviction's export", || b.endpoint.saved() == 1).await;
    manager.settle().await;

    assert_eq!(manager.live_room_count(), 1);
    assert!(b.logs.logged("export"), "{:?}", b.logs.lines());

    evicted(&manager).await;

    let saves = saved_texts(&b.endpoint);
    assert_eq!(saves.len(), 2);
    assert_eq!(saves[1], text_json("hello!"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn drain_closes_a_room_whose_store_fails_and_still_drains_the_others() {
    let b = Bench::new();
    b.endpoint.holds("doc-a", "a", None);
    b.endpoint.holds("doc-b", "b", None);
    let manager = b.manager(slow_export());
    let member_a = Peer::new();
    let member_b = Peer::new();
    let membership_a = enter(&manager, "doc-a", &member_a).await;
    let membership_b = enter(&manager, "doc-b", &member_b).await;
    let client_a = synced(&membership_a, &member_a).await;
    let client_b = synced(&membership_b, &member_b).await;
    send_update(&membership_a, &client_a, "!").await;
    send_update(&membership_b, &client_b, "?").await;
    manager.settle().await;
    b.store.set_fail_writes(Some(Box::new(|doc| {
        (doc == "doc-a").then_some(Error::DeadlineExceeded)
    })));

    manager.drain().await.expect("drain");

    assert_eq!(manager.live_room_count(), 0);
    assert_eq!(member_a.closed(), [CloseReason::Draining]);
    assert_eq!(member_b.closed(), [CloseReason::Draining]);
    assert_eq!(b.store.frames("doc-b").len(), 1);
    let mut saves = b.endpoint.saves();
    saves.sort_by(|x, y| x.doc.cmp(&y.doc));
    let texts: Vec<String> = saves.into_iter().map(|s| s.data).collect();
    assert_eq!(texts, [text_json("a!"), text_json("b?")]);
}

/// The shutdown deadline cancels the drain's token mid-flush. Every room
/// still closes, and the only lines are each room's own flush failure.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_drain_cut_short_by_its_token_still_closes_every_room() {
    let b = Bench::new();
    b.endpoint.holds("doc-a", "a", None);
    b.endpoint.holds("doc-b", "b", None);
    let manager = b.manager(slow_export());
    let member_a = Peer::new();
    let member_b = Peer::new();
    let membership_a = enter(&manager, "doc-a", &member_a).await;
    let membership_b = enter(&manager, "doc-b", &member_b).await;
    let client_a = synced(&membership_a, &member_a).await;
    let client_b = synced(&membership_b, &member_b).await;
    send_update(&membership_a, &client_a, "!").await;
    send_update(&membership_b, &client_b, "?").await;
    manager.settle().await;
    settle_writes(&manager).await;
    let gate = Gate::new();
    b.endpoint.set_save_gate(Some(gate.clone()));
    let shutdown = Token::new();

    let m = manager.clone();
    let token = shutdown.clone();
    let drain = tokio::spawn(async move { m.drain_with(&token).await });
    wait_until("both drains to start their export", || {
        b.endpoint.saved() == 2
    })
    .await;
    shutdown.cancel();
    tokio::time::timeout(Duration::from_secs(10), drain)
        .await
        .expect("the cancelled drain to finish")
        .expect("the drain task")
        .expect("drain");
    gate.open();

    assert_eq!(manager.live_room_count(), 0);
    assert_eq!(member_a.closed(), [CloseReason::Draining]);
    assert_eq!(member_b.closed(), [CloseReason::Draining]);
    let mut lines = b.logs.lines();
    lines.sort();
    assert_eq!(
        lines,
        [
            "collab: room \"doc-a\" could not export during flush: The operation was canceled.",
            "collab: room \"doc-b\" could not export during flush: The operation was canceled.",
        ]
    );
}

/// C# ADrainWhoseTokenIsAlreadyCancelledPrintsTheTaskCancelText.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_drain_whose_token_is_already_cancelled_prints_the_task_cancel_text() {
    let b = Bench::new();
    b.endpoint.holds("doc-a", "a", None);
    let manager = b.manager(slow_export());
    let member = Peer::new();
    let membership = enter(&manager, "doc-a", &member).await;
    let client = synced(&membership, &member).await;
    send_update(&membership, &client, "!").await;
    // C#'s fake store writes inline; here the write runs beside the lane,
    // so wait for it and its finish before the drain.
    wait_until("the working set write", || {
        b.store.holds("doc-a") && b.store.frames("doc-a").len() >= 2
    })
    .await;
    manager.settle().await;
    let gate = Gate::new();
    b.endpoint.set_save_gate(Some(gate.clone()));
    let shutdown = Token::new();
    shutdown.cancel();

    tokio::time::timeout(Duration::from_secs(10), manager.drain_with(&shutdown))
        .await
        .expect("the cancelled drain to finish")
        .expect("drain");
    gate.open();

    assert_eq!(manager.live_room_count(), 0);
    // The flush compacts, so it owes the store a write too.
    assert_eq!(
        b.logs.lines(),
        [
            "collab: room \"doc-a\" could not flush the working set: A task was canceled.",
            "collab: room \"doc-a\" could not export during flush: A task was canceled.",
        ]
    );
}

/// C# ALoggerThatThrowsDuringTheDrainFailsTheDrain: the host then says the
/// drain did not complete, and the process lives on.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_logger_that_throws_during_the_drain_fails_the_drain() {
    let b = Bench::new();
    b.endpoint.holds("doc-a", "a", None);
    let manager = b.manager(slow_export());
    let member = Peer::new();
    let membership = enter(&manager, "doc-a", &member).await;
    let client = synced(&membership, &member).await;
    send_update(&membership, &client, "!").await;
    wait_until("the working set write", || {
        b.store.holds("doc-a") && b.store.frames("doc-a").len() >= 2
    })
    .await;
    manager.settle().await;
    b.panic_when_logging("collab: room");
    let shutdown = Token::new();
    shutdown.cancel();

    let draining = manager.clone();
    let drained = tokio::spawn(async move { draining.drain_with(&shutdown).await });
    let result = tokio::time::timeout(Duration::from_secs(10), drained)
        .await
        .expect("the drain to finish");

    match result {
        Ok(Err(err)) => assert_eq!(err.to_string(), "logger failed"),
        other => panic!("drain = {other:?}"),
    }
    // C#'s throw skips Forget: the room stays loaded.
    assert_eq!(manager.live_room_count(), 1);
}

/// C# DrainRoomAsync: a room whose drain throws is logged and forgotten,
/// and the drain still ends. A panic is Rust's throw.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_room_whose_drain_panics_is_logged_and_forgotten() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "a", None);
    let manager = b.manager(slow_export());
    let member = Peer::new();
    let membership = enter(&manager, DOC, &member).await;
    let client = synced(&membership, &member).await;
    send_update(&membership, &client, "!").await;
    manager.settle().await;
    *lock(&b.consumer.panics) = true;

    manager.drain().await.expect("drain");

    assert!(
        b.logs
            .logged("collab: room \"doc-1\" could not be drained: endpoint exploded"),
        "{:?}",
        b.logs.lines()
    );
    assert_eq!(manager.live_room_count(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn purge_rejects_invalid_document_ids_before_authorization() {
    for doc in ["", ".", "..", "a/b", "a\\b"] {
        let b = Bench::new();
        let manager = b.manager(fast());
        let authorized = Arc::new(AtomicBool::new(false));
        let flag = authorized.clone();

        let err = manager
            .purge(doc, async move {
                flag.store(true, Ordering::SeqCst);
                Ok(true)
            })
            .await
            .expect_err("an invalid id");

        assert!(
            matches!(err, Error::EmptyDocId | Error::NotSingleSegment),
            "{doc:?}: {err:?}"
        );
        assert!(!authorized.load(Ordering::SeqCst), "{doc:?}");
        assert_eq!(Store::count(&b.store.deletes), 0, "{doc:?}");
        assert_eq!(manager.live_room_count(), 0, "{doc:?}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn denied_purge_leaves_the_room_and_working_set_untouched() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "visible", None);
    let manager = b.manager(fast());
    let peer = Peer::new();
    let _membership = enter(&manager, DOC, &peer).await;

    let err = purge(&manager, false).await.expect_err("a denied purge");

    assert!(matches!(err, Error::PurgeNotAuthorized), "{err:?}");
    assert!(peer.closed().is_empty());
    assert!(b.store.holds(DOC));
    assert_eq!(Store::count(&b.store.deletes), 0);
    assert_eq!(manager.live_room_count(), 1);
    assert_eq!(
        status_of(&manager, DOC, &Peer::new()).await,
        JoinStatus::Joined
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_journal_without_purge_support_fails_before_the_room_is_closed() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "visible", None);
    let manager = b.manager_over(fast(), b.store.clone(), Some(Arc::new(FakeJournal::new())));
    let peer = Peer::new();
    let _membership = enter(&manager, DOC, &peer).await;
    b.store
        .seed(DOC, &[full_state(&doc_with("legacy"))], tag_at(1));

    let err = purge(&manager, true)
        .await
        .expect_err("an unsupported purge");

    assert!(matches!(err, Error::PurgeUnsupported(_)), "{err:?}");
    assert!(peer.closed().is_empty());
    assert!(b.store.holds(DOC));
    assert_eq!(Store::count(&b.store.deletes), 0);
    assert_eq!(manager.live_room_count(), 1);
    assert_eq!(
        status_of(&manager, DOC, &Peer::new()).await,
        JoinStatus::Joined
    );
    assert!(err.to_string().contains("PurgeStore"), "{err}");
}

async fn assert_every_entry_point_purged(manager: &Manager) {
    let within = Duration::from_secs(3);
    let joined = tokio::time::timeout(within, status_of(manager, DOC, &Peer::new()))
        .await
        .expect("the join answered");
    assert_eq!(joined, JoinStatus::Purged);
    let edited = tokio::time::timeout(within, edit(manager, "late"))
        .await
        .expect("the edit answered");
    assert_eq!(edited.status, EditStatus::Purged);
    let reset = tokio::time::timeout(within, manager.reset(DOC))
        .await
        .expect("the reset answered")
        .expect("reset");
    assert_eq!(reset.status, ResetStatus::Purged);
    let checkpointed = tokio::time::timeout(within, manager.checkpoint(DOC))
        .await
        .expect("the checkpoint answered")
        .expect("checkpoint");
    assert!(!checkpointed);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn purge_closes_members_without_flushing_and_bars_every_entry_point() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "old", None);
    b.endpoint.holds("doc-2", "other", None);
    let manager = b.manager(fast());
    let peer = Peer::new();
    let membership = enter(&manager, DOC, &peer).await;
    let client = synced(&membership, &peer).await;
    send_update(&membership, &client, " edit").await;
    wait_until("the edit blob to land", || b.store.frame_count(DOC) == 2).await;

    let outcome = purge(&manager, true).await.expect("purge");
    let _ = membership
        .receive(sync_frame(Message::SyncUpdate {
            update: update_appending(&client, " late"),
        }))
        .await;
    tokio::time::sleep(ms(300)).await;
    manager.settle().await;

    assert_eq!(outcome, PurgeOutcome::Purged);
    assert_eq!(peer.closed(), [CloseReason::Forbidden]);
    assert!(!b.store.holds(DOC));
    assert_eq!(Store::count(&b.store.deletes), 1);
    assert_eq!(b.endpoint.saved(), 0);
    assert_eq!(manager.live_room_count(), 0);
    assert_every_entry_point_purged(&manager).await;
    assert_eq!(b.endpoint.loaded(), 1);
    assert_eq!(
        status_of(&manager, "doc-2", &Peer::new()).await,
        JoinStatus::Joined
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn purge_bars_admission_while_a_previous_blob_write_is_still_in_flight() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "old", None);
    let manager = b.manager(fast());
    let peer = Peer::new();
    let membership = Arc::new(enter(&manager, DOC, &peer).await);
    let client = synced(&membership, &peer).await;
    let blocked = Gate::new();
    b.store.set_before_write(Some(blocked.clone()));
    send_update(&membership, &client, " edit").await;
    wait_until("the old blob write to start", || {
        Store::count(&b.store.writes) == 2
    })
    .await;

    let m = manager.clone();
    let pending = tokio::spawn(async move { purge(&m, true).await });
    let update = update_appending(&client, " queued");
    let queued = membership.clone();
    let frame = tokio::spawn(async move {
        let _ = queued
            .receive(sync_frame(Message::SyncUpdate { update }))
            .await;
    });
    wait_until("the purge to start", || manager.is_purging(DOC)).await;

    assert!(!pending.is_finished());
    assert_every_entry_point_purged(&manager).await;
    assert!(b.store.holds(DOC));
    blocked.open();
    b.store.set_before_write(None);

    assert_eq!(
        pending.await.expect("purge").expect("purge"),
        PurgeOutcome::Purged
    );
    frame.await.expect("the queued frame");
    assert!(!b.store.holds(DOC));
    assert_eq!(peer.closed(), [CloseReason::Forbidden]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn purge_waits_for_an_in_flight_export_but_starts_no_final_export() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "old", None);
    let gate = Gate::new();
    b.endpoint.set_save_gate(Some(gate.clone()));
    let manager = b.manager(fast());
    let peer = Peer::new();
    let membership = enter(&manager, DOC, &peer).await;
    let client = synced(&membership, &peer).await;
    send_update(&membership, &client, " edit").await;
    wait_until("the blob to land", || b.store.frame_count(DOC) == 2).await;
    wait_until("the export to start", || b.endpoint.saved() == 1).await;

    let m = manager.clone();
    let pending = tokio::spawn(async move { purge(&m, true).await });
    wait_until("the purge to start", || manager.is_purging(DOC)).await;

    assert!(!pending.is_finished());
    let joined = tokio::time::timeout(
        Duration::from_secs(3),
        status_of(&manager, DOC, &Peer::new()),
    )
    .await
    .expect("the join answered");
    assert_eq!(joined, JoinStatus::Purged);
    gate.open();
    b.endpoint.set_save_gate(None);
    assert_eq!(
        pending.await.expect("purge").expect("purge"),
        PurgeOutcome::Purged
    );
    tokio::time::sleep(ms(300)).await;
    manager.settle().await;

    assert_eq!(b.endpoint.saved(), 1);
    assert!(!b.store.holds(DOC));
    assert_eq!(peer.closed(), [CloseReason::Forbidden]);
}

/// The built-in journal with C#'s OnPurge and FailPurgeAfterTombstone: the
/// purge lands, then the call fails.
struct PurgeHooks {
    inner: Arc<dyn OperationStore>,
    events: Arc<Mutex<Vec<String>>>,
    fail_after: AtomicBool,
    purges: AtomicI32,
}

impl OperationStore for PurgeHooks {
    fn open<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
    ) -> BoxFuture<'a, Result<Opened, Error>> {
        self.inner.open(ctx, doc_id)
    }
    fn as_purge(&self) -> Option<&dyn PurgeStore> {
        Some(self)
    }
    fn type_name(&self) -> &'static str {
        "purgeHooks"
    }
}

impl PurgeStore for PurgeHooks {
    fn purge<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
    ) -> BoxFuture<'a, Result<PurgeOutcome, Error>> {
        Box::pin(async move {
            self.purges.fetch_add(1, Ordering::SeqCst);
            let purger = self.inner.as_purge().expect("a purge store");
            let outcome = purger.purge(ctx, doc_id).await?;
            if outcome == PurgeOutcome::Purged {
                lock(&self.events).push("journal".to_owned());
                if self.fail_after.load(Ordering::SeqCst) {
                    return Err(Error::message("journal cleanup failed"));
                }
            }
            Ok(outcome)
        })
    }
}

fn purge_hooks(b: &Bench, fail_after: bool) -> (Arc<PurgeHooks>, TempDir) {
    let (journal, dir) = open_journal();
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    *lock(&b.store.before_delete) = Some(Box::new(move || {
        lock(&sink).push("working-set".to_owned());
    }));
    (
        Arc::new(PurgeHooks {
            inner: journal,
            events,
            fail_after: AtomicBool::new(fail_after),
            purges: AtomicI32::new(0),
        }),
        dir,
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_remote_journal_hold_leaves_the_working_set_and_admission_gate_in_place() {
    let b = Bench::new();
    let (operations, _dir) = open_journal();
    b.store
        .seed(DOC, &[full_state(&doc_with("old"))], tag_at(1));
    let (outcome, held) = operations
        .open(&Context::background(), DOC)
        .await
        .expect("open");
    assert_eq!(outcome, OpenOutcome::Opened);
    let held = held.expect("a session");
    let manager = b.manager_over(fast(), b.store.clone(), Some(operations));

    let busy = purge(&manager, true).await.expect("purge");

    assert_eq!(busy, PurgeOutcome::DocumentOpenElsewhere);
    assert!(b.store.holds(DOC));
    assert_eq!(Store::count(&b.store.deletes), 0);
    assert_eq!(
        status_of(&manager, DOC, &Peer::new()).await,
        JoinStatus::Purged
    );
    held.close().await.expect("close");

    assert_eq!(
        purge(&manager, true).await.expect("purge"),
        PurgeOutcome::Purged
    );
    assert!(!b.store.holds(DOC));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_journal_purge_failure_keeps_the_gate_and_retries_before_working_set_deletion() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "old", None);
    let (operations, _dir) = purge_hooks(&b, true);
    let manager = b.manager_over(fast(), b.store.clone(), Some(operations.clone()));
    let peer = Peer::new();
    let _membership = enter(&manager, DOC, &peer).await;
    b.store
        .seed(DOC, &[full_state(&doc_with("legacy"))], tag_at(1));

    let err = purge(&manager, true)
        .await
        .expect_err("the journal purge fails");

    assert!(err.to_string().contains("journal cleanup failed"), "{err}");
    assert_eq!(*lock(&operations.events), ["journal"]);
    assert_eq!(peer.closed(), [CloseReason::Forbidden]);
    assert!(b.store.holds(DOC));
    assert_eq!(Store::count(&b.store.deletes), 0);
    assert_eq!(
        status_of(&manager, DOC, &Peer::new()).await,
        JoinStatus::Purged
    );
    assert_eq!(b.endpoint.loaded(), 1);

    operations.fail_after.store(false, Ordering::SeqCst);
    assert_eq!(
        purge(&manager, true).await.expect("purge"),
        PurgeOutcome::Purged
    );
    assert_eq!(
        *lock(&operations.events),
        ["journal", "journal", "working-set"]
    );
    assert!(!b.store.holds(DOC));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_working_set_delete_failure_keeps_the_journal_tombstone_and_retries() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "old", None);
    let (operations, _dir) = purge_hooks(&b, false);
    *lock(&b.store.fail_deletes) = Some(Box::new(|_| {
        Some(Error::message("working set delete failed"))
    }));
    let manager = b.manager_over(fast(), b.store.clone(), Some(operations.clone()));
    let _membership = enter(&manager, DOC, &Peer::new()).await;
    b.store
        .seed(DOC, &[full_state(&doc_with("legacy"))], tag_at(1));

    let err = purge(&manager, true).await.expect_err("the delete fails");

    assert!(
        err.to_string().contains("working set delete failed"),
        "{err}"
    );
    assert_eq!(*lock(&operations.events), ["journal", "working-set"]);
    assert!(b.store.holds(DOC));
    assert_eq!(
        status_of(&manager, DOC, &Peer::new()).await,
        JoinStatus::Purged
    );
    assert_eq!(b.endpoint.loaded(), 1);

    *lock(&b.store.fail_deletes) = None;
    assert_eq!(
        purge(&manager, true).await.expect("purge"),
        PurgeOutcome::Purged
    );
    assert_eq!(
        *lock(&operations.events),
        ["journal", "working-set", "journal", "working-set"]
    );
    assert!(!b.store.holds(DOC));
    assert_eq!(operations.purges.load(Ordering::SeqCst), 2);
    assert_eq!(Store::count(&b.store.deletes), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_journal_free_purge_needs_the_hosts_tombstone_on_another_manager() {
    let b = Bench::new();
    b.endpoint.holds(DOC, "old", None);
    let manager = b.manager(fast());
    let _membership = enter(&manager, DOC, &Peer::new()).await;

    assert_eq!(
        purge(&manager, true).await.expect("purge"),
        PurgeOutcome::Purged
    );

    b.endpoint.fail(Some(Error::message("gone")));
    let restarted = b.manager(fast());
    let late = status_of(&restarted, DOC, &Peer::new()).await;

    assert_eq!(late, JoinStatus::SeedFailed);
    assert!(!b.store.holds(DOC));
    assert_eq!(b.endpoint.loaded(), 2);
}

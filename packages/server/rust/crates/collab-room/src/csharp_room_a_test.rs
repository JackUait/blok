use std::sync::atomic::{AtomicBool, AtomicI32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_collab::{BoxFuture, CloseReason, JoinStatus, Member, OperationSource};
use blok_collab_convert::EditOp;
use blok_collab_docendpoint::{Loaded, Projection};
use blok_collab_journal::{Context, PurgeOutcome};
use blok_collab_operation::{
    AppendOutcome, AppendResult, Candidate, Checkpoint, Head, Lookup, LookupOutcome, OpenResult,
    Reset, Source,
};
use blok_collab_wire::Message;
use blok_collab_workingset::{CURRENT_FORMAT, Set, Tag};
use blok_jsjson::{Node, Object, Str, Value};
use blok_yjs::Doc;

use crate::test_support::*;
use crate::*;

// Twins of the C# CollabRoomTests cases with no Go twin (the first half).
// C# advances a ManualTimeProvider to fire timers; here they run on short
// wall-time windows.

/// A hook a fake stops in until released; C# BeforeAppend and friends.
#[derive(Clone)]
struct Pause {
    entered: Arc<AtomicBool>,
    release: Gate,
}

impl Pause {
    fn new() -> Pause {
        Pause {
            entered: Arc::new(AtomicBool::new(false)),
            release: Gate::new(),
        }
    }
    async fn pass(&self) {
        self.entered.store(true, Ordering::SeqCst);
        self.release.wait().await;
    }
}

type Hook = Mutex<Option<Pause>>;

fn hook(h: &Hook) -> Option<Pause> {
    lock(h).clone()
}

fn set_hook(h: &Hook, pause: Option<Pause>) {
    *lock(h) = pause;
}

// --- the working set, with C# BeforeWrite and the write sizes ---

#[derive(Default)]
struct Ws {
    inner: Arc<MemoryStore>,
    before_write: Hook,
    most_frames: AtomicUsize,
    largest_write: AtomicUsize,
    written_bytes: AtomicUsize,
}

impl WorkingSetStore for Ws {
    fn read<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<Option<Set>, Error>> {
        self.inner.read(doc_id)
    }
    fn write<'a>(
        &'a self,
        doc_id: &'a str,
        updates: &'a [u8],
        tag: &'a Tag,
    ) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move {
            let frames = blok_collab_workingset::decode_frames(updates)
                .expect("the room writes framed updates")
                .len();
            self.most_frames.fetch_max(frames, Ordering::SeqCst);
            self.largest_write
                .fetch_max(updates.len(), Ordering::SeqCst);
            self.written_bytes
                .fetch_add(updates.len(), Ordering::SeqCst);
            if let Some(pause) = hook(&self.before_write) {
                pause.pass().await;
            }
            self.inner.write(doc_id, updates, tag).await
        })
    }
    fn reset<'a>(&'a self, doc_id: &'a str, tag: &'a Tag) -> BoxFuture<'a, Result<(), Error>> {
        self.inner.reset(doc_id, tag)
    }
    fn retire<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<(), Error>> {
        self.inner.retire(doc_id)
    }
    fn delete<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<(), Error>> {
        self.inner.delete(doc_id)
    }
}

// --- the endpoint, with C# NextSaveFailure ---

#[derive(Default)]
struct Ep {
    inner: Arc<FakeEndpoint>,
    next_save_failure: Mutex<Option<String>>,
}

impl Endpoint for Ep {
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
            let answer = self
                .inner
                .save(doc_id, output_data, version, projection)
                .await;
            match lock(&self.next_save_failure).take() {
                Some(failure) => Err(Error::message(failure)),
                None => answer,
            }
        })
    }
}

// --- the converter, with the C# FakeDocConverter knobs ---

#[derive(Default)]
struct Conv {
    inner: TextConverter,
    seeds: AtomicI32,
    seeded_client_ids: Mutex<Vec<u64>>,
    next_export_failure: Mutex<Option<fn() -> Error>>,
    edit_failure_after_apply: Mutex<Option<String>>,
    edit_writes_nothing: AtomicBool,
    edit_moves_the_doc_unseen: AtomicBool,
    emit_second_edit_update: AtomicBool,
}

impl Conv {
    fn exports(&self) -> i32 {
        self.inner.exports.load(Ordering::SeqCst)
    }
}

impl Converter for Conv {
    fn seed<'a>(&'a self, doc: &'a Doc, output_data: &'a Node) -> BoxFuture<'a, Result<(), Error>> {
        self.seeds.fetch_add(1, Ordering::SeqCst);
        lock(&self.seeded_client_ids).push(doc.client_id());
        self.inner.seed(doc, output_data)
    }
    fn export<'a>(&'a self, doc: &'a Doc) -> BoxFuture<'a, Result<Object, Error>> {
        if let Some(failure) = lock(&self.next_export_failure).take() {
            self.inner.exports.fetch_add(1, Ordering::SeqCst);
            return Box::pin(async move { Err(failure()) });
        }
        self.inner.export(doc)
    }
    fn apply_ops<'a>(
        &'a self,
        doc: &'a Doc,
        ops: &'a [EditOp],
    ) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move {
            if self.edit_writes_nothing.load(Ordering::SeqCst) {
                return Ok(());
            }
            if self.edit_moves_the_doc_unseen.load(Ordering::SeqCst) {
                let foreign = new_client();
                update_appending(&foreign, "unseen");
                doc.apply_update(&full_state(&foreign))
                    .expect("the foreign update applies");
                return Ok(());
            }
            self.inner.apply_ops(doc, ops).await?;
            if self.emit_second_edit_update.load(Ordering::SeqCst) {
                update_appending(doc, ".");
            }
            match lock(&self.edit_failure_after_apply).clone() {
                Some(failure) => Err(Error::message(failure)),
                None => Ok(()),
            }
        })
    }
    fn migrate_rich_text<'a>(&'a self, doc: &'a Doc) -> BoxFuture<'a, Result<usize, Error>> {
        self.inner.migrate_rich_text(doc)
    }
}

// --- the journal, with the C# FakeCollabOperationStore knobs ---

type AppendFail = Mutex<Option<String>>;

#[derive(Default)]
struct JournalKnobs {
    inner: FakeJournal,
    opens: AtomicI32,
    fail_appends: AppendFail,
    commit_before_failing: AtomicBool,
    before_append: Hook,
    before_lookup: Hook,
    before_dispose: Hook,
}

#[derive(Clone, Default)]
struct Journal(Arc<JournalKnobs>);

impl OperationStore for Journal {
    fn open<'a>(
        &'a self,
        _ctx: &'a Context,
        doc_id: &'a str,
    ) -> BoxFuture<'a, Result<Opened, Error>> {
        self.0.opens.fetch_add(1, Ordering::SeqCst);
        let session = self.0.inner.open_session(doc_id);
        let knobs = self.0.clone();
        Box::pin(async move {
            Ok(match session {
                None => (
                    blok_collab_journal::OpenOutcome::DocumentOpenElsewhere,
                    None,
                ),
                Some(inner) => (
                    blok_collab_journal::OpenOutcome::Opened,
                    Some(Arc::new(Session { knobs, inner }) as Arc<dyn OperationSession>),
                ),
            })
        })
    }
    fn as_purge(&self) -> Option<&dyn PurgeStore> {
        Some(self)
    }
    fn type_name(&self) -> &'static str {
        "*room.fakeJournal"
    }
}

impl PurgeStore for Journal {
    fn purge<'a>(
        &'a self,
        _ctx: &'a Context,
        doc_id: &'a str,
    ) -> BoxFuture<'a, Result<PurgeOutcome, Error>> {
        let mut docs = lock(&self.0.inner.0.docs);
        let doc = docs.entry(doc_id.to_owned()).or_default();
        let outcome = if doc.open {
            PurgeOutcome::DocumentOpenElsewhere
        } else {
            doc.baseline.clear();
            doc.records.clear();
            doc.checkpoint = None;
            doc.head = None;
            PurgeOutcome::Purged
        };
        Box::pin(async move { Ok(outcome) })
    }
}

struct Session {
    knobs: Arc<JournalKnobs>,
    inner: Arc<FakeSession>,
}

impl OperationSession for Session {
    fn open_result(&self) -> &OpenResult {
        self.inner.open_result()
    }
    fn find_committed<'a>(
        &'a self,
        ctx: &'a Context,
        operation_id: &'a str,
        digest: &'a [u8],
    ) -> BoxFuture<'a, Result<Lookup, Error>> {
        Box::pin(async move {
            if let Some(pause) = hook(&self.knobs.before_lookup) {
                pause.pass().await;
            }
            self.inner.find_committed(ctx, operation_id, digest).await
        })
    }
    fn append<'a>(
        &'a self,
        ctx: &'a Context,
        candidate: Candidate,
    ) -> BoxFuture<'a, Result<AppendResult, Error>> {
        Box::pin(async move {
            if let Some(pause) = hook(&self.knobs.before_append) {
                pause.pass().await;
            }
            let Some(failure) = lock(&self.knobs.fail_appends).clone() else {
                return self.inner.do_append(candidate);
            };
            let existing = self
                .inner
                .find_committed(ctx, &candidate.operation_id, &candidate.digest)
                .await?;
            let outcome = match existing.outcome {
                LookupOutcome::NotCommitted => None,
                LookupOutcome::Duplicate => Some(AppendOutcome::Duplicate),
                LookupOutcome::Conflict => Some(AppendOutcome::Conflict),
            };
            if let Some(outcome) = outcome {
                return Ok(AppendResult {
                    outcome,
                    sequence: existing.sequence,
                });
            }
            if self.knobs.commit_before_failing.load(Ordering::SeqCst) {
                self.inner.do_append(candidate)?;
            }
            Err(Error::message(failure))
        })
    }
    fn write_checkpoint<'a>(
        &'a self,
        ctx: &'a Context,
        checkpoint: Checkpoint,
    ) -> BoxFuture<'a, Result<(), Error>> {
        self.inner.write_checkpoint(ctx, checkpoint)
    }
    fn reset<'a>(&'a self, ctx: &'a Context, reset: Reset) -> BoxFuture<'a, Result<Head, Error>> {
        self.inner.reset(ctx, reset)
    }
    fn close(&self) -> BoxFuture<'_, Result<(), Error>> {
        Box::pin(async move {
            if let Some(pause) = hook(&self.knobs.before_dispose) {
                pause.pass().await;
            }
            self.inner.do_close();
            Ok(())
        })
    }
}

// --- the room ---

/// The C# test class's fields: one store, endpoint, converter and journal
/// shared by every manager a test makes.
struct Cs {
    r: TextRoom,
    ws: Arc<Ws>,
    ep: Arc<Ep>,
    conv: Arc<Conv>,
    journal: Journal,
}

impl Cs {
    fn new() -> Cs {
        let r = TextRoom::new();
        let ws = Arc::new(Ws {
            inner: r.store.clone(),
            ..Ws::default()
        });
        let ep = Arc::new(Ep {
            inner: r.endpoint.clone(),
            ..Ep::default()
        });
        let journal = Journal(Arc::new(JournalKnobs {
            inner: r.operations.clone(),
            ..JournalKnobs::default()
        }));
        Cs {
            r,
            ws,
            ep,
            conv: Arc::new(Conv::default()),
            journal,
        }
    }

    fn store(&self) -> &MemoryStore {
        &self.r.store
    }

    fn endpoint(&self) -> &FakeEndpoint {
        &self.r.endpoint
    }

    fn manager_with(
        &self,
        mut o: Options,
        journalled: bool,
        converter: Arc<dyn Converter>,
    ) -> Manager {
        if o.now.is_none() {
            o.now = Some(self.r.clock.clock());
        }
        Manager::new(ManagerOptions {
            store: self.ws.clone(),
            endpoint: self.ep.clone(),
            converter,
            room: o,
            log: Some(self.r.logs.log()),
            operations: journalled
                .then(|| Arc::new(self.journal.clone()) as Arc<dyn OperationStore>),
            activity: None,
        })
    }

    /// C# CreateManager.
    fn manager(&self, o: Options) -> Manager {
        self.manager_with(o, false, self.conv.clone())
    }

    fn frames(&self) -> Vec<Vec<u8>> {
        self.store().frames(TEST_DOC)
    }

    fn frame_count(&self) -> usize {
        self.store()
            .peek(TEST_DOC)
            .map_or(0, |_| self.store().frames(TEST_DOC).len())
    }

    fn saved_texts(&self) -> Vec<String> {
        self.endpoint()
            .saves()
            .iter()
            .map(|save| saved_text(&save.data))
            .collect()
    }

    fn logged(&self, part: &str) -> bool {
        self.r.logged(part)
    }
}

fn saved_text(data: &str) -> String {
    let parsed = node(data);
    match parsed.lookup("text") {
        Ok(Some(value)) => value.text().map(|t| t.to_string()).unwrap_or_default(),
        _ => String::new(),
    }
}

/// No timer fires during a test unless it asks for one.
fn quiet() -> Options {
    Options {
        export_debounce: HOUR,
        export_max_delay: HOUR,
        eviction_linger: HOUR,
        ..Options::default()
    }
}

/// Every room timer fires within milliseconds.
fn brisk() -> Options {
    Options {
        export_debounce: ms(10),
        export_max_delay: ms(10),
        eviction_linger: ms(10),
        retry_backoff: ms(10),
        retry_backoff_cap: ms(10),
        ..Options::default()
    }
}

/// A member that negotiated no blok-sync subprotocol: C#'s default
/// FakeMember, which gets no control frame.
struct Stock(Arc<FakeMember>);

impl Member for Stock {
    fn can_write(&self) -> bool {
        self.0.can_write()
    }
    fn accepts_control_frames(&self) -> bool {
        false
    }
    fn actor_id(&self) -> String {
        self.0.actor_id()
    }
    fn protocol_source(&self) -> OperationSource {
        self.0.protocol_source()
    }
    fn recheck_access(&self) -> BoxFuture<'_, Result<bool, blok_collab::Error>> {
        self.0.recheck_access()
    }
    fn send(&self, frame: Vec<u8>) {
        self.0.send(frame);
    }
    fn close(&self, reason: CloseReason) {
        self.0.close(reason);
    }
}

fn writer() -> Arc<FakeMember> {
    FakeMember::v1(true)
}

fn reader() -> Arc<FakeMember> {
    FakeMember::v1(false)
}

/// C# Join: a v2 member also completes the sync exchange.
async fn enter(manager: &Manager, member: &Arc<FakeMember>) -> Joined {
    if member.source == Some(OperationSource::ClientV2) {
        join_synced(manager, TEST_DOC, member).await
    } else {
        join(manager, TEST_DOC, member).await
    }
}

async fn send(membership: &Joined, message: Message) {
    receive(membership, message).await;
}

async fn update(membership: &Joined, update: Vec<u8>) {
    send(membership, Message::SyncUpdate { update }).await;
}

/// C# Edit: a client synced to the room appends value over a SyncUpdate.
async fn edit(manager: &Manager, membership: &Joined, value: &str) {
    let text = exported_text(manager, TEST_DOC).await;
    let client = synced_client(manager, TEST_DOC, &text).await;
    update(membership, update_appending(&client, value)).await;
}

/// C# YDocs.Replay.
fn replay(frames: &[Vec<u8>]) -> String {
    let replica = new_client();
    for frame in frames {
        replica.apply_update(frame).expect("a stored frame applies");
    }
    doc_text(&replica)
}

fn awareness_claiming(clients: u64) -> Vec<u8> {
    let mut payload = Vec::new();
    write_var_uint(&mut payload, clients);
    for client in 0..clients {
        write_var_uint(&mut payload, 1000 + client);
        payload.extend_from_slice(&[0x01, 0x02, b'{', b'}']);
    }
    payload
}

fn write_var_uint(payload: &mut Vec<u8>, mut value: u64) {
    loop {
        let current = (value & 0x7f) as u8;
        value >>= 7;
        if value == 0 {
            payload.push(current);
            return;
        }
        payload.push(current | 0x80);
    }
}

/// C# SyncFrames.Payload: a frame from the shared sync-frames fixture.
fn fixture_payload(name: &str) -> Vec<u8> {
    let path = format!(
        "{}/../../../../../test/unit/server-conformance/fixtures/sync-frames.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let fixture = blok_jsjson::parse_node(
        &std::fs::read(path).expect("sync-frames.json"),
        blok_jsjson::Options {
            max_depth: 64,
            refuse_duplicates: false,
        },
    )
    .expect("sync-frames.json parses");
    let text = |n: &Node, key: &str| -> String {
        match n.lookup(key) {
            Ok(Some(value)) => value.text().map(|t| t.to_string()).unwrap_or_default(),
            _ => String::new(),
        }
    };
    let frames = fixture
        .lookup("frames")
        .ok()
        .flatten()
        .expect("a frames array");
    let frame = frames
        .items
        .iter()
        .find(|frame| text(frame, "name") == name)
        .unwrap_or_else(|| panic!("sync-frames.json has no frame named {name}"));
    let hex = text(frame, "payloadHex");
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("hex"))
        .collect()
}

fn sync_updates(member: &FakeMember) -> Vec<Vec<u8>> {
    member
        .messages()
        .into_iter()
        .filter_map(|m| match m {
            Message::SyncUpdate { update } => Some(update),
            _ => None,
        })
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn answers_sync_step1_with_the_diff_and_its_own_sync_step1() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.manager(quiet());
    let member = writer();
    let membership = enter(&manager, &member).await;
    let client = new_client();
    member.clear();

    send(
        &membership,
        Message::SyncStep1 {
            state_vector: client.encode_state_vector(),
        },
    )
    .await;

    let got = member.messages();
    assert_eq!(got.len(), 2, "frames: {got:?}");
    let Message::SyncStep2 { update } = &got[0] else {
        panic!("first frame {:?}", got[0]);
    };
    client.apply_update(update).expect("the step2 applies");
    let Message::SyncStep1 { state_vector } = &got[1] else {
        panic!("second frame {:?}", got[1]);
    };
    assert_eq!(*state_vector, client.encode_state_vector());
    assert_eq!(doc_text(&client), "hello");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn applies_a_writer_update_appends_it_once_and_broadcasts_to_others_only() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.manager(quiet());
    let (writer, other) = (writer(), self::writer());
    let membership = enter(&manager, &writer).await;
    enter(&manager, &other).await;
    let frames_before = cs.frame_count();
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, " world");
    writer.clear();
    other.clear();

    update(&membership, edit.clone()).await;

    assert!(writer.messages().is_empty(), "{:?}", writer.messages());
    assert_eq!(
        other.messages(),
        [Message::SyncUpdate {
            update: edit.clone()
        }]
    );
    wait_until("the working set to catch up", || {
        cs.frame_count() == frames_before + 1
    })
    .await;
    assert_eq!(cs.frames().last(), Some(&edit));
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello world");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn applies_a_writer_sync_step2_for_a_late_joiner_with_offline_edits() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.manager(quiet());
    let (early, late) = (writer(), writer());
    enter(&manager, &early).await;
    let membership = enter(&manager, &late).await;
    let offline = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&offline, "!");
    early.clear();

    send(
        &membership,
        Message::SyncStep2 {
            update: edit.clone(),
        },
    )
    .await;

    assert_eq!(early.messages(), [Message::SyncUpdate { update: edit }]);
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello!");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn drops_sync_step2_and_updates_from_read_only_members_but_answers_their_sync_step1() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.manager(quiet());
    let (reader, writer) = (reader(), writer());
    let membership = enter(&manager, &reader).await;
    enter(&manager, &writer).await;
    let frames_before = cs.frame_count();
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, " hacked");
    reader.clear();
    writer.clear();

    update(&membership, edit.clone()).await;
    send(&membership, Message::SyncStep2 { update: edit }).await;
    send(
        &membership,
        Message::SyncStep1 {
            state_vector: vec![0],
        },
    )
    .await;

    assert!(writer.messages().is_empty(), "{:?}", writer.messages());
    assert_eq!(cs.frame_count(), frames_before);
    let got = reader.messages();
    assert_eq!(got.len(), 2, "{got:?}");
    assert!(matches!(got[0], Message::SyncStep2 { .. }), "{:?}", got[0]);
    assert!(matches!(got[1], Message::SyncStep1 { .. }), "{:?}", got[1]);
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn relays_awareness_and_query_awareness_to_others_even_from_read_only_members() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.manager(quiet());
    let (reader, other) = (reader(), writer());
    let membership = enter(&manager, &reader).await;
    enter(&manager, &other).await;
    reader.clear();
    other.clear();
    let stock = fixture_payload("awareness");

    send(
        &membership,
        Message::Awareness {
            update: stock.clone(),
        },
    )
    .await;
    send(&membership, Message::QueryAwareness).await;

    assert!(reader.messages().is_empty(), "{:?}", reader.messages());
    assert_eq!(
        other.messages(),
        [
            Message::Awareness { update: stock },
            Message::QueryAwareness
        ]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn drops_a_malformed_awareness_frame_and_closes_the_sender_on_the_third() {
    for payload in [vec![0x01, 0x02, 0x03], vec![0x01, 0x02, 0x03, 0x01, b'{']] {
        let cs = Cs::new();
        cs.endpoint().holds(TEST_DOC, "hello", None);
        let manager = cs.manager(quiet());
        let (sender, other) = (writer(), writer());
        let membership = enter(&manager, &sender).await;
        enter(&manager, &other).await;
        other.clear();
        let frame = Message::Awareness {
            update: payload.clone(),
        };

        send(&membership, frame.clone()).await;
        send(&membership, frame.clone()).await;
        assert!(sender.closed().is_empty(), "{payload:?}");
        send(&membership, frame).await;
        send(
            &membership,
            Message::Awareness {
                update: fixture_payload("awareness"),
            },
        )
        .await;

        assert_eq!(sender.closed(), [CloseReason::BadAwareness], "{payload:?}");
        assert!(other.messages().is_empty(), "{:?}", other.messages());
        assert!(cs.logged("malformed awareness"), "{:?}", cs.r.logs.lines());
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn drops_an_awareness_frame_that_claims_more_clients_than_the_room_relays() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.manager(quiet());
    let (flooder, victim) = (writer(), writer());
    let membership = enter(&manager, &flooder).await;
    enter(&manager, &victim).await;
    victim.clear();

    send(
        &membership,
        Message::Awareness {
            update: awareness_claiming(100_000),
        },
    )
    .await;

    assert!(victim.messages().is_empty(), "{:?}", victim.messages());
    assert!(cs.logged("100000"), "{:?}", cs.r.logs.lines());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn relays_awareness_at_the_client_cap_and_drops_the_frame_above_it() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.manager(Options {
        max_awareness_clients: 4,
        ..quiet()
    });
    let (sender, other) = (writer(), writer());
    let membership = enter(&manager, &sender).await;
    enter(&manager, &other).await;
    other.clear();

    send(
        &membership,
        Message::Awareness {
            update: awareness_claiming(4),
        },
    )
    .await;
    for _ in 0..3 {
        send(
            &membership,
            Message::Awareness {
                update: awareness_claiming(5),
            },
        )
        .await;
    }

    assert_eq!(
        other.messages(),
        [Message::Awareness {
            update: awareness_claiming(4)
        }]
    );
    assert!(sender.closed().is_empty(), "{:?}", sender.closed());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn holds_a_read_only_members_presence_to_the_same_client_cap() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.manager(Options {
        max_awareness_clients: 4,
        ..quiet()
    });
    let (reader, other) = (reader(), writer());
    let membership = enter(&manager, &reader).await;
    enter(&manager, &other).await;
    other.clear();

    send(
        &membership,
        Message::Awareness {
            update: awareness_claiming(4),
        },
    )
    .await;
    send(
        &membership,
        Message::Awareness {
            update: awareness_claiming(5),
        },
    )
    .await;

    assert_eq!(
        other.messages(),
        [Message::Awareness {
            update: awareness_claiming(4)
        }]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn drops_an_awareness_frame_whose_client_count_cannot_be_read() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.manager(quiet());
    let (sender, other) = (writer(), writer());
    let membership = enter(&manager, &sender).await;
    enter(&manager, &other).await;
    other.clear();

    send(&membership, Message::Awareness { update: vec![0x80] }).await;

    assert!(other.messages().is_empty(), "{:?}", other.messages());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn broadcasts_query_awareness_to_the_others_when_someone_joins() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.manager(quiet());
    let (first, second) = (writer(), writer());
    enter(&manager, &first).await;

    enter(&manager, &second).await;

    let queries = |member: &FakeMember| {
        member
            .messages()
            .iter()
            .filter(|m| matches!(m, Message::QueryAwareness))
            .count()
    };
    assert_eq!(queries(&first), 1, "{:?}", first.messages());
    assert_eq!(queries(&second), 0, "{:?}", second.messages());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sends_the_epoch_control_frame_first_only_to_members_that_negotiated_it() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    cs.store()
        .seed(TEST_DOC, &[full_state(&doc_with("hello"))], tag_at(6));
    let manager = cs.manager(quiet());
    let negotiated = writer();
    let stock = writer();
    enter(&manager, &negotiated).await;
    manager
        .join(TEST_DOC, Arc::new(Stock(stock.clone())))
        .await
        .expect("join");

    let got = negotiated.messages();
    let Message::BlokControl { tag } = &got[0] else {
        panic!("first frame {:?}", got[0]);
    };
    let want = tag_at(6);
    assert_eq!(
        (tag.format, tag.epoch, tag.lineage.as_str()),
        (want.format, want.epoch, want.lineage.as_str())
    );
    assert!(
        !stock
            .messages()
            .iter()
            .any(|m| matches!(m, Message::BlokControl { .. })),
        "{:?}",
        stock.messages()
    );
    assert!(
        !got.iter().any(|m| matches!(m, Message::BlokLimits { .. })),
        "{got:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn announces_the_message_cap_right_after_the_control_frame() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.manager(Options {
        announced_max_message_bytes: 1 << 20,
        ..quiet()
    });
    let negotiated = writer();
    let stock = writer();
    enter(&manager, &negotiated).await;
    manager
        .join(TEST_DOC, Arc::new(Stock(stock.clone())))
        .await
        .expect("join");

    let got = negotiated.messages();
    assert!(
        matches!(got[0], Message::BlokControl { .. }),
        "{:?}",
        got[0]
    );
    assert_eq!(
        got[1],
        Message::BlokLimits {
            max_message_bytes: 1 << 20
        }
    );
    assert!(
        !stock
            .messages()
            .iter()
            .any(|m| matches!(m, Message::BlokLimits { .. })),
        "{:?}",
        stock.messages()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ignores_malformed_frames_and_unusable_updates() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.manager(quiet());
    let (writer, other) = (writer(), self::writer());
    let membership = enter(&manager, &writer).await;
    enter(&manager, &other).await;
    let frames_before = cs.frame_count();
    other.clear();

    membership
        .receive(vec![0xff, 0xff, 0xff])
        .await
        .expect("receive");
    update(&membership, vec![0xde, 0xad, 0xbe, 0xef, 0x01]).await;
    send(
        &membership,
        Message::PermissionDenied {
            reason: "nope".to_owned(),
        },
    )
    .await;

    assert!(other.messages().is_empty(), "{:?}", other.messages());
    assert_eq!(cs.frame_count(), frames_before);
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_malformed_update_is_dropped_without_closing_the_member() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.manager(quiet());
    let (writer, other) = (writer(), self::writer());
    let membership = enter(&manager, &writer).await;
    enter(&manager, &other).await;
    let frames_before = cs.frame_count();
    other.clear();

    update(&membership, vec![0xde, 0xad, 0xbe, 0xef, 0x01]).await;

    assert!(writer.closed().is_empty(), "{:?}", writer.closed());
    assert!(other.closed().is_empty(), "{:?}", other.closed());
    assert!(other.messages().is_empty(), "{:?}", other.messages());
    assert_eq!(cs.frame_count(), frames_before);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_room_applies_a_nul_bearing_update_and_exports_it_intact() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.manager(quiet());
    let (writer, other) = (writer(), self::writer());
    let membership = enter(&manager, &writer).await;
    enter(&manager, &other).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let frames_before = cs.frame_count();
    other.clear();

    update(&membership, update_appending(&client, "a\0b")).await;

    assert!(writer.closed().is_empty(), "{:?}", writer.closed());
    assert_eq!(sync_updates(&other).len(), 1, "{:?}", other.messages());
    wait_until("the working set to catch up", || {
        cs.frame_count() == frames_before + 1
    })
    .await;
    assert_eq!(exported_text(&manager, TEST_DOC).await, "helloa\0b");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn exports_after_the_debounce_and_not_before() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", Some("v7"));
    let manager = cs.manager(Options {
        export_debounce: ms(400),
        ..quiet()
    });
    let membership = enter(&manager, &writer()).await;
    edit(&manager, &membership, " world").await;

    tokio::time::sleep(ms(150)).await;
    manager.settle().await;
    assert!(
        cs.endpoint().saves().is_empty(),
        "exported before the debounce"
    );

    wait_until("the debounced export", || cs.endpoint().saved() == 1).await;

    let saves = cs.endpoint().saves();
    assert_eq!(saves.len(), 1, "{saves:?}");
    assert_eq!(saves[0].doc, TEST_DOC);
    assert_eq!(saved_text(&saves[0].data), "hello world");
    assert_eq!(saves[0].version.as_deref(), Some("v7"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn exports_no_later_than_the_max_delay_under_continuous_edits() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "", None);
    let manager = cs.manager(Options {
        export_debounce: ms(500),
        export_max_delay: ms(1500),
        now: Some(Arc::new(std::time::SystemTime::now)),
        ..quiet()
    });
    let membership = enter(&manager, &writer()).await;

    let started = tokio::time::Instant::now();
    loop {
        edit(&manager, &membership, "x").await;
        tokio::time::sleep(ms(100)).await;
        manager.settle().await;
        if cs.endpoint().saved() >= 1 {
            break;
        }
        assert!(
            started.elapsed() < ms(2400),
            "no export {:?} after the first edit",
            started.elapsed()
        );
    }
    assert!(
        started.elapsed() >= ms(1400),
        "the export came {:?} after the first edit, inside the max delay",
        started.elapsed()
    );
    let first = &cs.saved_texts()[0];
    assert!(
        !first.is_empty() && first.chars().all(|c| c == 'x'),
        "the export: {first:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn retries_a_failed_export_on_the_next_tick_and_keeps_the_blob() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    *lock(&cs.ep.next_save_failure) = Some("collab: the doc endpoint PUT returned 502.".to_owned());
    let manager = cs.manager(Options {
        eviction_linger: HOUR,
        ..brisk()
    });
    let membership = enter(&manager, &writer()).await;
    edit(&manager, &membership, "!").await;

    wait_until("the failing export", || cs.endpoint().saved() >= 1).await;
    wait_until("the retried export", || cs.endpoint().saved() == 2).await;

    assert_eq!(cs.saved_texts()[1], "hello!");
    wait_until("the working set to keep both frames", || {
        cs.frame_count() == 2
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn retries_an_export_the_converter_refused_with_backoff() {
    fn not_a_map() -> Error {
        Error::Journal(blok_collab_journal::Error::InvalidData {
            message: "collab: block \"b-1\" has data that is not a map.".to_owned(),
            source: None,
        })
    }
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    *lock(&cs.conv.next_export_failure) = Some(not_a_map);
    let manager = cs.manager(Options {
        export_debounce: ms(10),
        export_max_delay: ms(10),
        retry_backoff: ms(300),
        retry_backoff_cap: ms(300),
        ..quiet()
    });
    let membership = enter(&manager, &writer()).await;
    edit(&manager, &membership, "!").await;

    wait_until("the refused export", || cs.conv.exports() >= 1).await;
    manager.settle().await;

    assert_eq!(cs.conv.exports(), 1);
    assert!(cs.endpoint().saves().is_empty());
    assert!(cs.logged("b-1"), "{:?}", cs.r.logs.lines());
    assert!(
        !cs.logged("background work failed"),
        "{:?}",
        cs.r.logs.lines()
    );

    wait_until("the retried export", || cs.endpoint().saved() == 1).await;
    assert_eq!(cs.saved_texts()[0], "hello!");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn coalesces_edits_made_during_an_in_flight_export_into_the_next_one() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "a", None);
    let gate = Gate::new();
    cs.endpoint().set_save_gate(Some(gate.clone()));
    let manager = cs.manager(Options {
        eviction_linger: HOUR,
        ..brisk()
    });
    let membership = enter(&manager, &writer()).await;
    edit(&manager, &membership, "b").await;
    wait_until("the first export", || cs.endpoint().saved() == 1).await;

    edit(&manager, &membership, "c").await;
    tokio::time::sleep(ms(100)).await;
    manager.settle().await;
    assert_eq!(cs.endpoint().saved(), 1);

    cs.endpoint().set_save_gate(None);
    gate.open();
    wait_until("the coalesced export", || cs.endpoint().saved() == 2).await;
    tokio::time::sleep(ms(50)).await;

    assert_eq!(cs.saved_texts(), ["ab", "abc"]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn carries_the_version_each_save_answers_with_into_the_next_save() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "a", Some("v1"));
    cs.endpoint().set_next_save_version(Some("v2"));
    let manager = cs.manager(Options {
        eviction_linger: HOUR,
        ..brisk()
    });
    let membership = enter(&manager, &writer()).await;

    edit(&manager, &membership, "b").await;
    wait_until("the first export", || cs.endpoint().saved() == 1).await;
    manager.settle().await;
    edit(&manager, &membership, "c").await;
    wait_until("the second export", || cs.endpoint().saved() == 2).await;

    let versions: Vec<_> = cs
        .endpoint()
        .saves()
        .iter()
        .map(version_of)
        .map(str::to_owned)
        .collect();
    assert_eq!(versions, ["v1", "v2"]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn seeds_every_room_under_its_own_random_client_id() {
    let cs = Cs::new();
    let manager = cs.manager(quiet());

    for index in 0..40 {
        let doc = format!("doc-{index}");
        cs.endpoint().holds(&doc, "seed", None);
        let result = manager.join(&doc, writer()).await.expect("join");
        assert_eq!(result.status, JoinStatus::Joined);
    }

    let mut ids = lock(&cs.conv.seeded_client_ids).clone();
    assert!(ids.iter().all(|id| *id <= u64::from(u32::MAX)), "{ids:?}");
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), 40);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_joiner_cancelling_mid_seed_does_not_poison_the_seed_for_the_others() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let gate = Gate::new();
    cs.endpoint().set_load_gate(Some(gate.clone()));
    let manager = cs.manager(quiet());

    let first = {
        let manager = manager.clone();
        tokio::spawn(async move { manager.join(TEST_DOC, writer()).await })
    };
    wait_until("the seed load to start", || cs.endpoint().loaded() == 1).await;
    let second = {
        let manager = manager.clone();
        tokio::spawn(async move { manager.join(TEST_DOC, writer()).await })
    };
    tokio::time::sleep(ms(20)).await;
    first.abort();
    cs.endpoint().set_load_gate(None);
    gate.open();

    assert!(first.await.is_err_and(|err| err.is_cancelled()));
    let second = second.await.expect("the second join").expect("join");
    assert_eq!(second.status, JoinStatus::Joined);
    assert_eq!(cs.endpoint().loaded(), 1);
    assert_eq!(cs.conv.seeds.load(Ordering::SeqCst), 1);
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_store_timeout_during_an_apply_is_logged_retried_and_still_exports() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.manager(Options {
        eviction_linger: HOUR,
        ..brisk()
    });
    let (writer, other) = (writer(), self::writer());
    let membership = enter(&manager, &writer).await;
    enter(&manager, &other).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, "!");
    other.clear();
    cs.store().timing_out.store(true, Ordering::SeqCst);

    update(&membership, edit.clone()).await;

    assert_eq!(other.messages(), [Message::SyncUpdate { update: edit }]);
    wait_until("the failed write to be reported", || {
        cs.logged("could not persist")
    })
    .await;
    wait_until("the export the failed persist must not cancel", || {
        cs.endpoint().saved() >= 1
    })
    .await;
    assert_eq!(cs.saved_texts()[0], "hello!");

    cs.store().timing_out.store(false, Ordering::SeqCst);
    wait_until("the retried persist", || {
        cs.store().holds(TEST_DOC) && cs.frame_count() == 2
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_slow_store_does_not_stall_the_lane() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.manager(quiet());
    let (writer, other) = (writer(), self::writer());
    let membership = enter(&manager, &writer).await;
    enter(&manager, &other).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    other.clear();
    let stuck = Pause::new();
    set_hook(&cs.ws.before_write, Some(stuck.clone()));

    let received = tokio::time::timeout(
        Duration::from_secs(5),
        update(&membership, update_appending(&client, "!")),
    )
    .await;

    assert!(received.is_ok(), "the receive waited on the stuck store");
    assert_eq!(other.messages().len(), 1, "{:?}", other.messages());
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello!");

    set_hook(&cs.ws.before_write, None);
    stuck.release.open();
    wait_until("the released write", || {
        cs.store().holds(TEST_DOC) && cs.frame_count() == 2
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn no_write_carries_more_frames_than_the_compaction_threshold() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "", None);
    let manager = cs.manager(Options {
        compaction_frame_threshold: 4,
        ..quiet()
    });
    let membership = enter(&manager, &writer()).await;
    let client = synced_client(&manager, TEST_DOC, "").await;

    for _ in 0..60 {
        update(&membership, update_appending(&client, "x")).await;
    }

    manager.settle().await;
    let want = "x".repeat(60);
    wait_until("the last write", || {
        cs.frame_count() > 0 && replay(&cs.frames()) == want
    })
    .await;

    let most = cs.ws.most_frames.load(Ordering::SeqCst);
    assert!(most <= 4, "a write carried {most} frames");
    let largest = cs.ws.largest_write.load(Ordering::SeqCst);
    assert!(largest < 600, "the largest write was {largest} bytes");
    let written = cs.ws.written_bytes.load(Ordering::SeqCst);
    assert!(written < 60 * 400, "{written} bytes written for 60 updates");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn measures_the_log_without_its_compacted_base_when_deciding_to_compact() {
    let cs = Cs::new();
    let seed = "a".repeat(300);
    cs.store()
        .seed(TEST_DOC, &[full_state(&doc_with(&seed))], tag_at(0));
    let manager = cs.manager(Options {
        compaction_byte_threshold: 256,
        ..quiet()
    });
    let membership = enter(&manager, &writer()).await;
    let client = synced_client(&manager, TEST_DOC, &seed).await;

    for piece in ["b", "c", "d"] {
        update(&membership, update_appending(&client, piece)).await;
    }

    manager.settle().await;
    let caught_up = format!("{seed}bcd");
    wait_until("the working set to catch up", || {
        replay(&cs.frames()) == caught_up
    })
    .await;
    assert_eq!(cs.frame_count(), 3);

    let tail = "e".repeat(300);
    update(&membership, update_appending(&client, &tail)).await;

    wait_until("the compaction the tail earned", || cs.frame_count() == 1).await;
    assert_eq!(replay(&cs.frames()), format!("{seed}bcd{tail}"));
}

#[test]
fn compaction_keeps_an_update_that_is_still_pending() {
    let source = new_client();
    let first = update_appending(&source, "a");
    let second = update_appending(&source, "b");
    let server = new_client();

    server
        .apply_update(&second)
        .expect("the second update parks");
    let compacted = full_state(&server);
    let replica = new_client();
    replica
        .apply_update(&compacted)
        .expect("the compacted state");
    replica.apply_update(&first).expect("the first update");

    assert!(server.has_pending());
    assert_eq!(doc_text(&server), "");
    assert_eq!(doc_text(&replica), "ab");
}

impl Pause {
    fn open() -> Pause {
        let pause = Pause::new();
        pause.release.open();
        pause
    }
    fn entered(&self) -> bool {
        self.entered.load(Ordering::SeqCst)
    }
    async fn wait_entered(&self) {
        wait_until("the pause to be entered", || self.entered()).await;
    }
}

impl Journal {
    fn fail_appends(&self, failure: Option<&str>) {
        *lock(&self.0.fail_appends) = failure.map(str::to_owned);
    }
    fn opens(&self) -> i32 {
        self.0.opens.load(Ordering::SeqCst)
    }
    /// C# operations.OpenAsync from outside the room.
    fn open_outside(&self) -> Option<Arc<FakeSession>> {
        self.0.inner.open_session(TEST_DOC)
    }
}

impl Cs {
    fn operations(&self) -> &FakeJournal {
        &self.r.operations
    }

    /// C# CreateJournalManager.
    fn journal_manager(&self, o: Options) -> Manager {
        self.manager_with(o, true, self.conv.clone())
    }

    fn writes(&self) -> i32 {
        self.store().writes.load(Ordering::SeqCst)
    }

    fn committed(&self) -> Vec<blok_collab_operation::Record> {
        self.operations().committed(TEST_DOC)
    }
}

fn v2(actor: &str) -> Arc<FakeMember> {
    FakeMember::new(actor, OperationSource::ClientV2, true)
}

/// C# Operation: a v2 write under lineage.
fn operation(lineage: &str, operation_id: &str, update: Vec<u8>) -> Message {
    Message::Operation {
        lineage: lineage.to_owned(),
        operation_id: operation_id.to_owned(),
        update,
    }
}

fn awareness_updates(member: &FakeMember) -> Vec<Vec<u8>> {
    member
        .messages()
        .into_iter()
        .filter_map(|m| match m {
            Message::Awareness { update } => Some(update),
            _ => None,
        })
        .collect()
}

async fn joined_lineage(manager: &Manager, member: &Arc<FakeMember>) -> (Joined, String) {
    let membership = enter(manager, member).await;
    let lineage = control_tag(member).lineage;
    (membership, lineage)
}

async fn bounded<T>(what: &str, work: impl Future<Output = T>) -> T {
    tokio::time::timeout(Duration::from_secs(10), work)
        .await
        .unwrap_or_else(|_| panic!("timed out waiting for {what}"))
}

fn spawn_receive(membership: Arc<Joined>, message: Message) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move { receive(&membership, message).await })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn does_not_ack_or_broadcast_before_append_completes() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let (writer, other) = (v2(""), self::writer());
    let (membership, lineage) = joined_lineage(&manager, &writer).await;
    enter(&manager, &other).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, "!");
    writer.clear();
    other.clear();
    let pause = Pause::new();
    set_hook(&cs.journal.0.before_append, Some(pause.clone()));

    let received = spawn_receive(Arc::new(membership), operation(&lineage, OP_ONE, edit));
    bounded("the append", pause.wait_entered()).await;

    assert!(other.messages().is_empty(), "{:?}", other.messages());
    assert!(writer.messages().is_empty(), "{:?}", writer.messages());
    assert!(cs.committed().is_empty());
    assert_eq!(cs.writes(), 0);

    pause.release.open();
    bounded("the receive", received).await.expect("receive");

    assert_eq!(sync_updates(&other).len(), 1, "{:?}", other.messages());
    assert!(
        writer
            .messages()
            .iter()
            .any(|m| matches!(m, Message::Acknowledgement { .. })),
        "{:?}",
        writer.messages()
    );
    assert_eq!(cs.committed().len(), 1);
    assert_eq!(cs.writes(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn acknowledges_and_broadcasts_to_every_v2_member_including_the_submitter_after_commit() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let (writer, other) = (v2("user-7"), v2("user-9"));
    let (membership, lineage) = joined_lineage(&manager, &writer).await;
    enter(&manager, &other).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, "!");
    writer.clear();
    other.clear();

    send(&membership, operation(&lineage, OP_ONE, edit.clone())).await;

    assert_eq!(
        other.messages(),
        [Message::SyncUpdate {
            update: edit.clone()
        }]
    );
    assert_eq!(
        writer.messages(),
        [
            Message::SyncUpdate {
                update: edit.clone()
            },
            Message::Acknowledgement {
                lineage: lineage.clone(),
                operation_id: OP_ONE.to_owned(),
                server_sequence: 1,
            },
        ]
    );
    let committed = cs.committed();
    assert_eq!(committed.len(), 1);
    let record = &committed[0];
    assert_eq!(record.operation_id, OP_ONE);
    assert_eq!(record.sequence, 1);
    assert_eq!(record.actor_id.as_deref(), Some("user-7"));
    assert_eq!(record.source, Source::CLIENT_V2);
    assert_eq!(record.update, edit);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn append_failure_closes_every_member_with_commit_unavailable() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let (writer, other) = (v2(""), self::writer());
    let (membership, lineage) = joined_lineage(&manager, &writer).await;
    enter(&manager, &other).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, "!");
    cs.journal.fail_appends(Some("the journal is down"));

    send(&membership, operation(&lineage, OP_ONE, edit)).await;

    assert_eq!(writer.closed(), [CloseReason::CommitUnavailable]);
    assert_eq!(other.closed(), [CloseReason::CommitUnavailable]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn append_failure_closes_and_discards_the_room_without_observation() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let (writer, other) = (v2(""), self::writer());
    let (membership, lineage) = joined_lineage(&manager, &writer).await;
    enter(&manager, &other).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, "!");
    writer.clear();
    other.clear();
    cs.journal.fail_appends(Some("the journal is down"));

    send(&membership, operation(&lineage, OP_ONE, edit)).await;

    assert!(other.messages().is_empty(), "{:?}", other.messages());
    assert!(writer.messages().is_empty(), "{:?}", writer.messages());
    assert!(cs.committed().is_empty());
    assert_eq!(manager.live_room_count(), 0);
    let reopened = cs
        .journal
        .open_outside()
        .expect("the fence went with the room");
    reopened.do_close();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unknown_commit_outcome_closes_and_retry_resolves_by_id() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let (writer, other) = (v2(""), self::writer());
    let (membership, lineage) = joined_lineage(&manager, &writer).await;
    enter(&manager, &other).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, "!");
    writer.clear();
    other.clear();
    cs.journal
        .0
        .commit_before_failing
        .store(true, Ordering::SeqCst);
    cs.journal
        .fail_appends(Some("the journal could not answer"));

    send(&membership, operation(&lineage, OP_ONE, edit.clone())).await;

    assert_eq!(writer.closed(), [CloseReason::CommitUnavailable]);
    assert!(other.messages().is_empty(), "{:?}", other.messages());
    assert!(writer.messages().is_empty(), "{:?}", writer.messages());
    assert_eq!(cs.committed().len(), 1);

    cs.journal.fail_appends(None);
    cs.journal
        .0
        .commit_before_failing
        .store(false, Ordering::SeqCst);
    cs.r.clock.advance(Duration::from_secs(2));
    let retry_member = v2("");
    let (retry, retry_lineage) = joined_lineage(&manager, &retry_member).await;
    retry_member.clear();

    send(&retry, operation(&retry_lineage, OP_ONE, edit)).await;

    assert_eq!(
        retry_member.messages(),
        [Message::Acknowledgement {
            lineage: retry_lineage,
            operation_id: OP_ONE.to_owned(),
            server_sequence: 1,
        }]
    );
    assert_eq!(cs.committed().len(), 1);
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello!");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn repeated_append_failure_does_not_reload_the_document_per_retry() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let writer = v2("");
    let (membership, lineage) = joined_lineage(&manager, &writer).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, "!");
    cs.journal.fail_appends(Some("the journal is down"));

    send(&membership, operation(&lineage, OP_ONE, edit.clone())).await;
    let opens_after_failure = cs.journal.opens();

    for _ in 0..4 {
        let refused = manager.join(TEST_DOC, v2("")).await.expect("join");
        assert_eq!(refused.status, JoinStatus::Unavailable);
    }

    assert_eq!(cs.journal.opens(), opens_after_failure);
    assert_eq!(cs.endpoint().loaded(), 1);

    cs.r.clock.advance(Duration::from_secs(2));
    let second_member = v2("");
    let (second, second_lineage) = joined_lineage(&manager, &second_member).await;
    send(&second, operation(&second_lineage, OP_TWO, edit)).await;

    cs.r.clock.advance(Duration::from_secs(2));
    let refused = manager.join(TEST_DOC, v2("")).await.expect("join");
    assert_eq!(refused.status, JoinStatus::Unavailable);

    cs.r.clock.advance(Duration::from_secs(2));
    let joined = manager.join(TEST_DOC, v2("")).await.expect("join");
    assert_eq!(joined.status, JoinStatus::Joined);

    assert_eq!(cs.journal.opens(), cs.endpoint().loaded());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_append_past_the_store_timeout_is_commit_unavailable() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(Options {
        commit_timeout: ms(300),
        ..quiet()
    });
    let (writer, other) = (v2(""), self::writer());
    let (membership, lineage) = joined_lineage(&manager, &writer).await;
    enter(&manager, &other).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, "!");
    writer.clear();
    other.clear();
    let never = Pause::new();
    set_hook(&cs.journal.0.before_append, Some(never.clone()));

    let received = spawn_receive(Arc::new(membership), operation(&lineage, OP_ONE, edit));
    bounded("the append", never.wait_entered()).await;
    bounded("the receive", received).await.expect("receive");

    assert_eq!(writer.closed(), [CloseReason::CommitUnavailable]);
    assert_eq!(other.closed(), [CloseReason::CommitUnavailable]);
    assert!(other.messages().is_empty(), "{:?}", other.messages());
    assert!(writer.messages().is_empty(), "{:?}", writer.messages());
    assert_eq!(manager.live_room_count(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn open_elsewhere_refuses_the_join_as_unavailable() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let held = cs.journal.open_outside().expect("the journal opens");
    let manager = cs.journal_manager(quiet());

    let refused = manager.join(TEST_DOC, v2("")).await.expect("join");

    assert_eq!(refused.status, JoinStatus::Unavailable);
    assert!(refused.membership.is_none());
    assert_eq!(cs.endpoint().loaded(), 0);
    assert_eq!(manager.live_room_count(), 0);

    held.do_close();

    let joined = manager.join(TEST_DOC, v2("")).await.expect("join");
    assert_eq!(joined.status, JoinStatus::Joined);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn lost_ack_retry_returns_the_same_commit_without_rebroadcast() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let (writer, other) = (v2(""), self::writer());
    let (membership, lineage) = joined_lineage(&manager, &writer).await;
    enter(&manager, &other).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, "!");
    send(&membership, operation(&lineage, OP_ONE, edit.clone())).await;
    writer.clear();
    other.clear();

    send(&membership, operation(&lineage, OP_ONE, edit)).await;

    assert_eq!(
        writer.messages(),
        [Message::Acknowledgement {
            lineage,
            operation_id: OP_ONE.to_owned(),
            server_sequence: 1,
        }]
    );
    assert!(other.messages().is_empty(), "{:?}", other.messages());
    assert_eq!(cs.committed().len(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn same_id_different_bytes_rejects_without_apply() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let (writer, other) = (v2(""), self::writer());
    let (membership, lineage) = joined_lineage(&manager, &writer).await;
    enter(&manager, &other).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    send(
        &membership,
        operation(&lineage, OP_ONE, update_appending(&client, "!")),
    )
    .await;
    let different = update_appending(&client, "?");
    writer.clear();
    other.clear();

    send(&membership, operation(&lineage, OP_ONE, different)).await;

    assert_eq!(
        writer.messages(),
        [Message::Rejection {
            lineage,
            operation_id: OP_ONE.to_owned(),
            code: "operation-id-conflict".to_owned(),
        }]
    );
    assert!(other.messages().is_empty(), "{:?}", other.messages());
    assert!(writer.closed().is_empty(), "{:?}", writer.closed());
    assert!(other.closed().is_empty(), "{:?}", other.closed());
    assert_eq!(manager.live_room_count(), 1);
    assert_eq!(cs.committed().len(), 1);
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello!");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn committed_operations_broadcast_in_server_sequence_order() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let (first, second, observer) = (v2(""), v2(""), reader());
    let (first_membership, first_lineage) = joined_lineage(&manager, &first).await;
    let (second_membership, second_lineage) = joined_lineage(&manager, &second).await;
    enter(&manager, &observer).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let first_update = update_appending(&client, "a");
    let second_update = update_appending(&client, "b");
    observer.clear();
    let pause = Pause::new();
    set_hook(&cs.journal.0.before_append, Some(pause.clone()));

    let slow = spawn_receive(
        Arc::new(first_membership),
        operation(&first_lineage, OP_ONE, first_update.clone()),
    );
    bounded("the first append", pause.wait_entered()).await;
    set_hook(&cs.journal.0.before_append, None);
    let overtaking = spawn_receive(
        Arc::new(second_membership),
        operation(&second_lineage, OP_TWO, second_update.clone()),
    );
    tokio::time::sleep(ms(50)).await;
    pause.release.open();
    bounded("the slow receive", slow).await.expect("receive");
    bounded("the overtaking receive", overtaking)
        .await
        .expect("receive");

    let submitted = vec![first_update, second_update];
    let committed: Vec<_> = cs.committed().into_iter().map(|r| r.update).collect();
    assert_eq!(committed, submitted);
    assert_eq!(sync_updates(&observer), submitted);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reload_replays_every_acknowledged_operation_after_the_checkpoint() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(Options {
        eviction_linger: ms(20),
        ..quiet()
    });
    let writer = v2("");
    let (membership, lineage) = joined_lineage(&manager, &writer).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    send(
        &membership,
        operation(&lineage, OP_ONE, update_appending(&client, "!")),
    )
    .await;
    send(
        &membership,
        operation(&lineage, OP_TWO, update_appending(&client, "?")),
    )
    .await;
    membership.leave();
    manager.settle().await;

    wait_until("the room to be evicted", || manager.live_room_count() == 0).await;

    let session = cs.journal.open_outside().expect("the journal opens");
    let opened = session.open_result().clone();
    let replica = new_client();
    for frame in &opened.baseline {
        replica.apply_update(frame).expect("a baseline frame");
    }
    replica
        .apply_update(&opened.tail[0].update)
        .expect("the first operation");
    session
        .write_checkpoint(
            &Context::background(),
            Checkpoint {
                through: 1,
                state: full_state(&replica),
            },
        )
        .await
        .expect("the checkpoint");
    session.do_close();

    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello!?");
    assert_eq!(cs.endpoint().loaded(), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unjournalled_provisional_state_never_exports_or_checkpoints() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(Options {
        eviction_linger: ms(20),
        ..brisk()
    });
    let writer = v2("");
    let (membership, lineage) = joined_lineage(&manager, &writer).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, "!");
    cs.journal.fail_appends(Some("the journal is down"));

    send(&membership, operation(&lineage, OP_ONE, edit)).await;
    tokio::time::sleep(ms(100)).await;
    manager.settle().await;

    assert!(
        cs.endpoint().saves().is_empty(),
        "{:?}",
        cs.endpoint().saves()
    );
    assert!(cs.committed().is_empty());
    assert!(cs.operations().checkpoint(TEST_DOC).is_none());

    cs.journal.fail_appends(None);
    cs.r.clock.advance(Duration::from_secs(2));
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn working_set_only_room_keeps_the_legacy_relay_path() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.manager(quiet());
    let (writer, other) = (writer(), self::writer());
    let membership = enter(&manager, &writer).await;
    enter(&manager, &other).await;
    let frames_before = cs.frame_count();
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, "!");
    writer.clear();
    other.clear();

    update(&membership, edit.clone()).await;

    assert!(writer.messages().is_empty(), "{:?}", writer.messages());
    assert_eq!(other.messages(), [Message::SyncUpdate { update: edit }]);
    wait_until("the working set to catch up", || {
        cs.frame_count() == frames_before + 1
    })
    .await;

    let negotiated = v2("");
    let (negotiated_membership, lineage) = joined_lineage(&manager, &negotiated).await;
    negotiated.clear();
    writer.clear();
    other.clear();

    send(
        &negotiated_membership,
        operation(&lineage, OP_ONE, update_appending(&client, "?")),
    )
    .await;

    assert!(
        negotiated.messages().is_empty(),
        "{:?}",
        negotiated.messages()
    );
    assert!(writer.messages().is_empty(), "{:?}", writer.messages());
    assert!(other.messages().is_empty(), "{:?}", other.messages());
    assert!(cs.committed().is_empty());
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello!");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_lookup_past_the_store_timeout_is_commit_unavailable() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(Options {
        commit_timeout: ms(300),
        ..quiet()
    });
    let (writer, other) = (v2(""), self::writer());
    let (membership, lineage) = joined_lineage(&manager, &writer).await;
    enter(&manager, &other).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, "!");
    writer.clear();
    other.clear();
    let never = Pause::new();
    set_hook(&cs.journal.0.before_lookup, Some(never.clone()));

    let received = spawn_receive(Arc::new(membership), operation(&lineage, OP_ONE, edit));
    bounded("the lookup", never.wait_entered()).await;
    bounded("the receive", received).await.expect("receive");

    assert_eq!(writer.closed(), [CloseReason::CommitUnavailable]);
    assert!(other.messages().is_empty(), "{:?}", other.messages());
    assert!(cs.committed().is_empty());
    assert_eq!(manager.live_room_count(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resetting_an_operation_store_room_resets_the_journal_and_closes_members() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let writer = v2("");
    enter(&manager, &writer).await;
    let joined = control_tag(&writer);

    let reset = manager.reset(TEST_DOC).await.expect("reset");

    let tag = reset.tag.expect("a reset tag");
    assert_eq!(tag.format, joined.format);
    assert_eq!(tag.epoch, joined.epoch + 1);
    assert_ne!(tag.lineage, joined.lineage);
    assert_eq!(writer.closed(), [CloseReason::Reset]);
    assert_eq!(cs.store().resets.load(Ordering::SeqCst), 0);
    let head = cs.operations().head(TEST_DOC).expect("a head");
    assert_eq!(
        (head.format, head.epoch, head.lineage.as_str()),
        (tag.format, tag.epoch, tag.lineage.as_str())
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_queued_old_lineage_receive_cannot_append_after_journal_reset() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let writer = writer();
    let membership = enter(&manager, &writer).await;
    let joined = control_tag(&writer);
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let old_update = update_appending(&client, "late");
    let release_load = Gate::new();
    cs.endpoint().set_load_gate(Some(release_load.clone()));
    writer.clear();
    let reset = {
        let manager = manager.clone();
        tokio::spawn(async move { manager.reset(TEST_DOC).await })
    };
    wait_until("the reset endpoint load", || cs.endpoint().loaded() == 2).await;
    let append = Pause::open();
    set_hook(&cs.journal.0.before_append, Some(append.clone()));

    let queued = spawn_receive(
        Arc::new(membership),
        Message::SyncUpdate { update: old_update },
    );
    tokio::time::sleep(ms(50)).await;
    assert!(!queued.is_finished(), "the write ran ahead of the reset");

    cs.endpoint().set_load_gate(None);
    release_load.open();
    let reset = bounded("the reset", reset)
        .await
        .expect("the reset task")
        .expect("reset");
    bounded("the queued receive", queued)
        .await
        .expect("receive");

    let tag = reset.tag.expect("a reset tag");
    assert_eq!(tag.epoch, joined.epoch + 1);
    assert_ne!(tag.lineage, joined.lineage);
    assert_eq!(writer.closed(), [CloseReason::Reset]);
    assert!(writer.messages().is_empty(), "{:?}", writer.messages());
    assert!(!append.entered());
    assert!(cs.committed().is_empty());
    assert_eq!(manager.live_room_count(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resetting_a_new_operation_store_room_opens_the_journal_before_the_working_set() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());

    let reset = manager.reset(TEST_DOC).await.expect("reset");

    assert_eq!(cs.journal.opens(), 1);
    assert_eq!(cs.endpoint().loaded(), 1);
    assert_eq!(cs.store().reads.load(Ordering::SeqCst), 1);
    assert_eq!(reset.tag.expect("a reset tag").epoch, 1);
    assert_eq!(manager.live_room_count(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_journal_room_reset_does_not_write_the_working_set() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());

    let reset = manager.reset(TEST_DOC).await.expect("reset");

    assert_eq!(reset.status, ResetStatus::Done);
    assert_eq!(cs.store().resets.load(Ordering::SeqCst), 0);
    assert_eq!(cs.writes(), 0);
    assert_eq!(
        reset.tag.map(|t| t.lineage),
        cs.operations().head(TEST_DOC).map(|h| h.lineage)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_session_that_hangs_in_dispose_does_not_wedge_the_room() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(Options {
        commit_timeout: ms(300),
        ..quiet()
    });
    let writer = v2("");
    let (membership, lineage) = joined_lineage(&manager, &writer).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, "!");
    let never = Pause::new();
    set_hook(&cs.journal.0.before_dispose, Some(never.clone()));
    cs.journal.fail_appends(Some("the journal is down"));

    let received = spawn_receive(Arc::new(membership), operation(&lineage, OP_ONE, edit));
    bounded("the dispose", never.wait_entered()).await;
    bounded("the receive", received).await.expect("receive");

    assert_eq!(writer.closed(), [CloseReason::CommitUnavailable]);
    assert_eq!(manager.live_room_count(), 0);
    assert!(
        cs.journal.open_outside().is_none(),
        "the abandoned session released the fence"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_operation_frame_from_av1_member_is_dropped_without_journalling() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let (stock, other) = (writer(), v2(""));
    let (membership, lineage) = joined_lineage(&manager, &stock).await;
    enter(&manager, &other).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, "!");
    stock.clear();
    other.clear();

    send(&membership, operation(&lineage, OP_ONE, edit)).await;

    assert!(stock.messages().is_empty(), "{:?}", stock.messages());
    assert!(other.messages().is_empty(), "{:?}", other.messages());
    assert!(stock.closed().is_empty(), "{:?}", stock.closed());
    assert!(cs.committed().is_empty());
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_raw_write_from_av2_member_is_dropped_and_the_member_is_closed() {
    for as_sync_step2 in [false, true] {
        let cs = Cs::new();
        cs.endpoint().holds(TEST_DOC, "hello", None);
        let manager = cs.journal_manager(quiet());
        let (writer, other) = (v2(""), v2(""));
        let membership = enter(&manager, &writer).await;
        enter(&manager, &other).await;
        let client = synced_client(&manager, TEST_DOC, "hello").await;
        let edit = update_appending(&client, "!");
        writer.clear();
        other.clear();

        let raw = if as_sync_step2 {
            Message::SyncStep2 { update: edit }
        } else {
            Message::SyncUpdate { update: edit }
        };
        send(&membership, raw).await;

        assert!(other.messages().is_empty(), "{:?}", other.messages());
        assert!(writer.messages().is_empty(), "{:?}", writer.messages());
        assert_eq!(writer.closed(), [CloseReason::RawWriteOnV2]);
        assert!(cs.committed().is_empty());
        assert_eq!(exported_text(&manager, TEST_DOC).await, "hello");

        other.clear();
        send(
            &membership,
            Message::Awareness {
                update: awareness_claiming(1),
            },
        )
        .await;

        assert!(other.messages().is_empty(), "{:?}", other.messages());
        assert_eq!(writer.closed(), [CloseReason::RawWriteOnV2]);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_raw_write_from_av1_member_is_still_applied_on_the_same_room() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let stock = writer();
    let membership = enter(&manager, &stock).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;

    update(&membership, update_appending(&client, "!")).await;

    assert!(stock.closed().is_empty(), "{:?}", stock.closed());
    assert_eq!(cs.committed().len(), 1);
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello!");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_operation_before_the_room_answered_sync_step1_is_rejected_as_not_synced() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let writer = v2("");
    let membership = join(&manager, TEST_DOC, &writer).await;
    let lineage = control_tag(&writer).lineage;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, "!");
    writer.clear();

    send(&membership, operation(&lineage, OP_ONE, edit.clone())).await;

    assert_eq!(
        writer.messages(),
        [Message::Rejection {
            lineage: lineage.clone(),
            operation_id: OP_ONE.to_owned(),
            code: "not-synced".to_owned(),
        }]
    );
    assert!(cs.committed().is_empty());
    assert!(writer.closed().is_empty(), "{:?}", writer.closed());

    send(
        &membership,
        Message::SyncStep1 {
            state_vector: new_client().encode_state_vector(),
        },
    )
    .await;
    writer.clear();

    send(&membership, operation(&lineage, OP_ONE, edit)).await;

    assert!(
        writer
            .messages()
            .iter()
            .any(|m| matches!(m, Message::Acknowledgement { .. })),
        "{:?}",
        writer.messages()
    );
    assert_eq!(cs.committed().len(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_sync_step1_the_room_could_not_answer_does_not_make_the_member_synced() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let writer = v2("");
    let membership = join(&manager, TEST_DOC, &writer).await;
    let lineage = control_tag(&writer).lineage;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, "!");

    send(
        &membership,
        Message::SyncStep1 {
            state_vector: vec![0xff, 0xff, 0xff],
        },
    )
    .await;
    writer.clear();

    send(&membership, operation(&lineage, OP_ONE, edit)).await;

    let got = writer.messages();
    assert!(
        matches!(&got[..], [Message::Rejection { code, .. }] if code == "not-synced"),
        "{got:?}"
    );
    assert!(cs.committed().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn awareness_before_the_sync_exchange_is_still_relayed() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let (writer, other) = (v2(""), v2(""));
    let membership = join(&manager, TEST_DOC, &writer).await;
    join(&manager, TEST_DOC, &other).await;
    other.clear();

    send(
        &membership,
        Message::Awareness {
            update: awareness_claiming(1),
        },
    )
    .await;

    assert_eq!(awareness_updates(&other), [awareness_claiming(1)]);
    assert_eq!(other.messages().len(), 1, "{:?}", other.messages());
    assert!(writer.closed().is_empty(), "{:?}", writer.closed());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn awareness_after_the_sync_exchange_is_still_relayed() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let (writer, other) = (v2(""), v2(""));
    let membership = enter(&manager, &writer).await;
    enter(&manager, &other).await;
    other.clear();

    send(
        &membership,
        Message::Awareness {
            update: awareness_claiming(1),
        },
    )
    .await;

    assert_eq!(awareness_updates(&other), [awareness_claiming(1)]);
    assert_eq!(other.messages().len(), 1, "{:?}", other.messages());
    assert!(writer.closed().is_empty(), "{:?}", writer.closed());
}
/// C# ServerStateVectorAsync: the room's own state vector.
async fn server_state_vector(manager: &Manager, client: &Doc) -> Vec<u8> {
    let probe = reader();
    let membership = join(manager, TEST_DOC, &probe).await;
    send(
        &membership,
        Message::SyncStep1 {
            state_vector: client.encode_state_vector(),
        },
    )
    .await;
    membership.leave();
    probe
        .messages()
        .into_iter()
        .find_map(|m| match m {
            Message::SyncStep1 { state_vector } => Some(state_vector),
            _ => None,
        })
        .expect("the probe got a SyncStep1")
}

fn appending(id: &str, text: &str) -> EditOp {
    EditOp::Insert {
        id: Str::from(id),
        block: node(&format!(
            r#"{{"id":"{id}","type":"paragraph","data":{}}}"#,
            text_json(text)
        )),
        after: None,
        parent: None,
    }
}

/// C# EditAsync with no key of its own: a fresh id per call.
async fn plain_edit(manager: &Manager, ops: Vec<EditOp>) -> EditResult {
    let mut id = [0u8; 16];
    getrandom::fill(&mut id).expect("random");
    let operation_id: String = id.iter().map(|b| format!("{b:02x}")).collect();
    let mut digest = [0u8; 32];
    digest[..16].copy_from_slice(&id);
    manager
        .edit(TEST_DOC, ops, &operation_id, &digest, "", None)
        .await
        .expect("edit")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn v1_update_is_journalled_before_broadcast_with_a_server_generated_id() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let stock = FakeMember::new("user-3", OperationSource::ClientV1, true);
    let other = writer();
    let membership = enter(&manager, &stock).await;
    enter(&manager, &other).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, "!");
    stock.clear();
    other.clear();
    let pause = Pause::new();
    set_hook(&cs.journal.0.before_append, Some(pause.clone()));

    let received = spawn_receive(
        Arc::new(membership),
        Message::SyncUpdate {
            update: edit.clone(),
        },
    );
    bounded("the append", pause.wait_entered()).await;

    assert!(other.messages().is_empty(), "{:?}", other.messages());
    assert!(stock.messages().is_empty(), "{:?}", stock.messages());
    assert!(cs.committed().is_empty());
    assert_eq!(cs.writes(), 0);

    pause.release.open();
    bounded("the receive", received).await.expect("receive");

    assert_eq!(
        other.messages(),
        [Message::SyncUpdate {
            update: edit.clone()
        }]
    );
    assert!(stock.messages().is_empty(), "{:?}", stock.messages());
    let committed = cs.committed();
    assert_eq!(committed.len(), 1);
    let record = &committed[0];
    assert_eq!(record.source, Source::CLIENT_V1);
    assert_eq!(record.actor_id.as_deref(), Some("user-3"));
    assert_eq!(record.update, edit);
    assert_eq!(record.sequence, 1);
    assert!(
        record.operation_id.len() == 32
            && record
                .operation_id
                .chars()
                .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)),
        "{:?}",
        record.operation_id
    );
    assert_eq!(cs.writes(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn v1_duplicate_state_converges_but_has_no_client_receipt() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let (stock, other) = (writer(), self::writer());
    let membership = enter(&manager, &stock).await;
    enter(&manager, &other).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, "!");
    stock.clear();
    other.clear();

    update(&membership, edit.clone()).await;
    send(
        &membership,
        Message::SyncStep2 {
            update: edit.clone(),
        },
    )
    .await;

    assert!(stock.messages().is_empty(), "{:?}", stock.messages());
    let committed = cs.committed();
    assert_eq!(committed.len(), 1);
    assert_eq!(committed[0].update, edit);
    assert_eq!(other.messages(), [Message::SyncUpdate { update: edit }]);
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello!");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_idle_v1_resync_is_not_journalled_even_with_deletion_history() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(Options {
        eviction_linger: HOUR,
        ..brisk()
    });
    let (stock, other) = (writer(), self::writer());
    let membership = enter(&manager, &stock).await;
    enter(&manager, &other).await;
    let pristine = synced_client(&manager, TEST_DOC, "hello").await;
    let two_bytes = pristine
        .encode_state_as_update(&server_state_vector(&manager, &pristine).await)
        .expect("a diff");
    assert_eq!(two_bytes, [0, 0]);
    stock.clear();
    other.clear();

    send(&membership, Message::SyncStep2 { update: two_bytes }).await;

    assert!(cs.committed().is_empty());
    assert!(other.messages().is_empty(), "{:?}", other.messages());

    update(&membership, update_deleting(&pristine, 4, 1)).await;
    let synced = synced_client(&manager, TEST_DOC, "hell").await;
    let answer = synced
        .encode_state_as_update(&server_state_vector(&manager, &synced).await)
        .expect("a diff");
    assert!(
        answer.len() > 2,
        "expected a carried delete set, got {} bytes",
        answer.len()
    );

    tokio::time::sleep(ms(100)).await;
    manager.settle().await;
    let committed = cs.committed().len();
    let writes = cs.writes();
    stock.clear();
    other.clear();

    for _ in 0..3 {
        send(
            &membership,
            Message::SyncStep2 {
                update: answer.clone(),
            },
        )
        .await;
    }

    assert_eq!(cs.committed().len(), committed);
    assert!(stock.messages().is_empty(), "{:?}", stock.messages());
    assert!(other.messages().is_empty(), "{:?}", other.messages());
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hell");

    tokio::time::sleep(ms(100)).await;
    manager.settle().await;
    assert_eq!(cs.writes(), writes);
    assert!(
        cs.endpoint().saves().is_empty(),
        "{:?}",
        cs.endpoint().saves()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_deletion_that_only_widens_parked_ranges_is_still_journalled() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let (stock, other) = (writer(), self::writer());
    let membership = enter(&manager, &stock).await;
    enter(&manager, &other).await;
    let overlapping = vec![0x00, 0x02, 0x07, 0x01, 0x01, 0x04, 0x07, 0x01, 0x02, 0x04];
    let widening = vec![0x00, 0x01, 0x07, 0x01, 0x01, 0x08];
    stock.clear();
    other.clear();

    update(&membership, overlapping).await;
    update(&membership, widening.clone()).await;

    assert_eq!(cs.committed().len(), 2);
    let relayed: Vec<_> = sync_updates(&other)
        .into_iter()
        .filter(|u| u.len() == widening.len())
        .collect();
    assert_eq!(relayed, [widening]);
    assert!(stock.messages().is_empty(), "{:?}", stock.messages());
    assert!(stock.closed().is_empty(), "{:?}", stock.closed());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_idle_v1_resync_is_not_journalled_while_a_delete_is_parked() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(Options {
        eviction_linger: HOUR,
        ..brisk()
    });
    let (stock, other) = (writer(), self::writer());
    let membership = enter(&manager, &stock).await;
    enter(&manager, &other).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let two_bytes = client
        .encode_state_as_update(&server_state_vector(&manager, &client).await)
        .expect("a diff");
    assert_eq!(two_bytes, [0, 0]);

    let stray = new_client();
    update_appending(&stray, "zz");
    update(&membership, update_deleting(&stray, 0, 2)).await;

    tokio::time::sleep(ms(100)).await;
    manager.settle().await;
    let committed = cs.committed().len();
    let writes = cs.writes();
    stock.clear();
    other.clear();

    for _ in 0..3 {
        send(
            &membership,
            Message::SyncStep2 {
                update: two_bytes.clone(),
            },
        )
        .await;
    }

    assert_eq!(cs.committed().len(), committed);
    assert!(stock.messages().is_empty(), "{:?}", stock.messages());
    assert!(other.messages().is_empty(), "{:?}", other.messages());
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello");

    tokio::time::sleep(ms(100)).await;
    manager.settle().await;
    assert_eq!(cs.writes(), writes);
    assert!(
        cs.endpoint().saves().is_empty(),
        "{:?}",
        cs.endpoint().saves()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn av1_deletion_is_journalled_and_relayed() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let (stock, other) = (writer(), self::writer());
    let membership = enter(&manager, &stock).await;
    enter(&manager, &other).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let deletion = update_deleting(&client, 4, 1);
    let vector_before = server_state_vector(&manager, &client).await;
    stock.clear();
    other.clear();

    update(&membership, deletion.clone()).await;

    let committed = cs.committed();
    assert_eq!(committed.len(), 1);
    assert_eq!(committed[0].update, deletion);
    assert_eq!(committed[0].source, Source::CLIENT_V1);
    assert_eq!(other.messages(), [Message::SyncUpdate { update: deletion }]);
    assert!(stock.messages().is_empty(), "{:?}", stock.messages());
    assert_eq!(server_state_vector(&manager, &client).await, vector_before);
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hell");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn av1_update_that_only_parks_pending_is_still_journalled() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let (stock, other) = (writer(), self::writer());
    let membership = enter(&manager, &stock).await;
    enter(&manager, &other).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    update_appending(&client, "a");
    let second = update_appending(&client, "b");
    stock.clear();
    other.clear();

    update(&membership, second.clone()).await;

    let committed = cs.committed();
    assert_eq!(committed.len(), 1);
    assert_eq!(committed[0].update, second);
    assert_eq!(
        other.messages(),
        [Message::SyncUpdate {
            update: second.clone()
        }]
    );

    update(&membership, vec![0xde, 0xad, 0xbe, 0xef, 0x01]).await;

    assert_eq!(cs.committed().len(), 1);
    assert_eq!(other.messages().len(), 1, "{:?}", other.messages());
    assert!(stock.closed().is_empty(), "{:?}", stock.closed());
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_read_only_v1_update_is_dropped_without_journalling() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let (reader, writer) = (reader(), writer());
    let membership = enter(&manager, &reader).await;
    enter(&manager, &writer).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, " hacked");
    reader.clear();
    writer.clear();

    update(&membership, edit.clone()).await;
    send(&membership, Message::SyncStep2 { update: edit }).await;

    assert!(cs.committed().is_empty());
    assert!(reader.messages().is_empty(), "{:?}", reader.messages());
    assert!(writer.messages().is_empty(), "{:?}", writer.messages());
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_failed_v1_append_discards_the_room_without_relaying_or_exporting() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(Options {
        eviction_linger: ms(20),
        ..brisk()
    });
    let (stock, other) = (writer(), self::writer());
    let membership = enter(&manager, &stock).await;
    enter(&manager, &other).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, "!");
    stock.clear();
    other.clear();
    cs.journal.fail_appends(Some("the journal is down"));

    update(&membership, edit).await;

    assert_eq!(stock.closed(), [CloseReason::CommitUnavailable]);
    assert_eq!(other.closed(), [CloseReason::CommitUnavailable]);
    assert!(stock.messages().is_empty(), "{:?}", stock.messages());
    assert!(other.messages().is_empty(), "{:?}", other.messages());
    assert!(cs.committed().is_empty());
    assert_eq!(manager.live_room_count(), 0);

    cs.journal.fail_appends(None);
    tokio::time::sleep(ms(100)).await;
    cs.r.clock.advance(Duration::from_secs(30));

    assert!(
        cs.endpoint().saves().is_empty(),
        "{:?}",
        cs.endpoint().saves()
    );
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn consecutive_v1_updates_are_journalled_under_distinct_ids() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let stock = writer();
    let membership = enter(&manager, &stock).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    stock.clear();

    update(&membership, update_appending(&client, "!")).await;
    update(&membership, update_appending(&client, "?")).await;

    let committed = cs.committed();
    assert_eq!(committed.len(), 2);
    assert_ne!(committed[0].operation_id, committed[1].operation_id);
    let sequences: Vec<_> = committed.iter().map(|r| r.sequence).collect();
    assert_eq!(sequences, [1, 2]);
    assert!(stock.messages().is_empty(), "{:?}", stock.messages());
    assert!(stock.closed().is_empty(), "{:?}", stock.closed());
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello!?");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_edit_is_refused_while_the_document_is_in_its_commit_cooldown() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let writer = v2("");
    let (membership, lineage) = joined_lineage(&manager, &writer).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, "!");
    cs.journal.fail_appends(Some("the journal is down"));
    send(&membership, operation(&lineage, OP_ONE, edit)).await;
    let opens = cs.journal.opens();

    let refused = plain_edit(&manager, vec![appending("b-1", "x")]).await;

    assert_eq!(refused.status, EditStatus::Unavailable);
    assert_eq!(cs.journal.opens(), opens);
    assert_eq!(cs.endpoint().loaded(), 1);
}

/// Joins a v2 writer and a v1 observer to a journal room on "hello" and
/// clears what they were sent.
async fn edit_room(cs: &Cs) -> (Manager, Arc<FakeMember>, Arc<FakeMember>) {
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let (writer, observer) = (v2(""), self::writer());
    enter(&manager, &writer).await;
    enter(&manager, &observer).await;
    writer.clear();
    observer.clear();
    (manager, writer, observer)
}

fn assert_closed_without_observation(
    cs: &Cs,
    writer: &FakeMember,
    observer: &FakeMember,
    result: &EditResult,
) {
    assert_eq!(result.status, EditStatus::Unavailable);
    assert_eq!(writer.closed(), [CloseReason::CommitUnavailable]);
    assert_eq!(observer.closed(), [CloseReason::CommitUnavailable]);
    assert!(writer.messages().is_empty(), "{:?}", writer.messages());
    assert!(observer.messages().is_empty(), "{:?}", observer.messages());
    assert!(cs.committed().is_empty());
    assert!(
        cs.endpoint().saves().is_empty(),
        "{:?}",
        cs.endpoint().saves()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_post_apply_failure_closes_without_observation() {
    let cs = Cs::new();
    let (manager, writer, observer) = edit_room(&cs).await;
    *lock(&cs.conv.edit_failure_after_apply) =
        Some("the converter failed after writing".to_owned());

    let result = plain_edit(&manager, vec![appending("b-1", "x")]).await;

    assert_closed_without_observation(&cs, &writer, &observer, &result);
    cs.r.clock.advance(Duration::from_secs(2));
    *lock(&cs.conv.edit_failure_after_apply) = None;
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_edit_that_moves_the_doc_without_a_local_update_closes_without_observation() {
    let cs = Cs::new();
    let (manager, writer, observer) = edit_room(&cs).await;
    cs.conv
        .edit_moves_the_doc_unseen
        .store(true, Ordering::SeqCst);

    let result = plain_edit(&manager, vec![appending("b-1", "x")]).await;

    assert_closed_without_observation(&cs, &writer, &observer, &result);
    cs.r.clock.advance(Duration::from_secs(2));
    cs.conv
        .edit_moves_the_doc_unseen
        .store(false, Ordering::SeqCst);
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_edit_that_writes_nothing_is_applied_without_an_append() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let writer = v2("");
    enter(&manager, &writer).await;
    writer.clear();
    cs.conv.edit_writes_nothing.store(true, Ordering::SeqCst);

    let result = plain_edit(&manager, vec![appending("b-1", "x")]).await;

    assert_eq!(result.status, EditStatus::Applied);
    assert_eq!(
        cs.operations().head(TEST_DOC).map(|h| h.durable_through),
        result.receipt.map(|r| r.server_sequence)
    );
    assert!(writer.closed().is_empty(), "{:?}", writer.closed());
    assert!(writer.messages().is_empty(), "{:?}", writer.messages());
    assert!(cs.committed().is_empty());
    assert_eq!(manager.live_room_count(), 1);
}

/// C# RichTextRuntime.Reader: the client's own HTML reader.
fn runtime_reader() -> &'static blok_collab_convert::RuntimeHtmlReader<blok_jsruntime::Pool> {
    static READER: std::sync::OnceLock<
        blok_collab_convert::RuntimeHtmlReader<blok_jsruntime::Pool>,
    > = std::sync::OnceLock::new();
    READER.get_or_init(|| blok_collab_convert::RuntimeHtmlReader {
        runtime: blok_jsruntime::Pool::new(blok_jsruntime::Options {
            pool_size: 1,
            ..blok_jsruntime::Options::default()
        })
        .unwrap_or_else(|err| panic!("{err}")),
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn under_a_journal_a_respelled_paragraph_edit_is_applied_and_keeps_the_room() {
    let cs = Cs::new();
    cs.endpoint().holds_document(
        TEST_DOC,
        r#"{"blocks":[{"id":"p","type":"paragraph","data":{"text":"<strong>x</strong>&nbsp;y"}}]}"#,
        None,
    );
    let clock = cs.r.clock.clone();
    let converter = Arc::new(blok_collab_convert::DocConverter {
        now: Box::new(move || clock.now()),
        html: runtime_reader(),
        fields: None,
        log: None,
    });
    let manager = cs.manager_with(quiet(), true, converter);
    let writer = v2("");
    enter(&manager, &writer).await;

    let result = plain_edit(
        &manager,
        vec![EditOp::Update {
            id: Str::from("p"),
            data: node(r#"{"text":"<b>x</b> y<br>"}"#),
        }],
    )
    .await;

    assert_eq!(result.status, EditStatus::Applied, "{:?}", result.err);
    assert!(writer.closed().is_empty(), "{:?}", writer.closed());
    assert!(cs.committed().is_empty());
    assert_eq!(manager.live_room_count(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_edit_with_multiple_local_updates_closes_without_observation() {
    let cs = Cs::new();
    let (manager, writer, observer) = edit_room(&cs).await;
    cs.conv
        .emit_second_edit_update
        .store(true, Ordering::SeqCst);

    let result = plain_edit(&manager, vec![appending("b-1", "x")]).await;

    assert_closed_without_observation(&cs, &writer, &observer, &result);
    cs.r.clock.advance(Duration::from_secs(2));
    cs.conv
        .emit_second_edit_update
        .store(false, Ordering::SeqCst);
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_working_set_in_another_format_fails_the_open_and_is_kept() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "from-endpoint", None);
    cs.store().seed(
        TEST_DOC,
        &[full_state(&doc_with("from-ws"))],
        Tag {
            format: CURRENT_FORMAT + 1,
            epoch: 0,
            lineage: TAG_LINEAGE.to_owned(),
        },
    );
    let manager = cs.journal_manager(quiet());

    let state = manager.state(TEST_DOC).await.expect("state");

    assert_eq!(state.status, StateStatus::SeedFailed);
    assert!(cs.store().holds(TEST_DOC));
    assert!(cs.operations().head(TEST_DOC).is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_failed_working_set_retire_still_opens_and_the_next_load_retries_it() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "from-endpoint", None);
    cs.store()
        .seed(TEST_DOC, &[full_state(&doc_with("from-ws"))], tag_at(3));
    cs.store()
        .set_fail_retires(Some(Box::new(|_| Some("the disk is busy".to_owned()))));
    let manager = cs.journal_manager(quiet());

    let (state, json) = state_text(&manager, TEST_DOC).await;

    assert_eq!(state.status, StateStatus::Ready);
    assert_eq!(json, r#"{"text":"from-ws"}"#);
    assert!(cs.store().holds(TEST_DOC));

    manager.drain().await.expect("drain");
    cs.store().set_fail_retires(None);
    let (_, reloaded) = state_text(&cs.journal_manager(quiet()), TEST_DOC).await;

    assert_eq!(reloaded, r#"{"text":"from-ws"}"#);
    assert!(!cs.store().holds(TEST_DOC));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_reset_of_a_headless_document_drops_its_working_set() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "from-endpoint", None);
    cs.store()
        .seed(TEST_DOC, &[full_state(&doc_with("from-ws"))], tag_at(3));
    let manager = cs.journal_manager(quiet());

    manager.reset(TEST_DOC).await.expect("reset");

    assert!(!cs.store().holds(TEST_DOC));
    let (_, json) = state_text(&manager, TEST_DOC).await;
    assert_eq!(json, r#"{"text":"from-endpoint"}"#);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_journal_room_never_writes_the_working_set() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    http_edit(&manager, TEST_DOC, OP_ONE, "!").await;

    manager.drain().await.expect("drain");

    assert_eq!(cs.writes(), 0);
    assert!(!cs.store().holds(TEST_DOC));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn state_is_the_live_export_and_the_head_it_reflects() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    let edit = http_edit(&manager, TEST_DOC, OP_ONE, "!").await;

    let (state, json) = state_text(&manager, TEST_DOC).await;

    assert_eq!(state.status, StateStatus::Ready);
    assert_eq!(json, r#"{"text":"hello!"}"#);
    assert!(edit.receipt.is_some());
    assert_eq!(state.head, edit.receipt);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn state_without_a_journal_has_no_head() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.manager(quiet());
    plain_edit(&manager, vec![appending("b-1", "!")]).await;

    let (state, json) = state_text(&manager, TEST_DOC).await;

    assert_eq!(state.status, StateStatus::Ready);
    assert_eq!(json, r#"{"text":"hello!"}"#);
    assert!(state.head.is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_cold_room_loaded_by_state_is_evicted() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(Options {
        eviction_linger: ms(200),
        ..quiet()
    });

    let state = manager.state(TEST_DOC).await.expect("state");

    assert_eq!(state.status, StateStatus::Ready);
    assert_eq!(manager.live_room_count(), 1);
    wait_until("the room to be evicted", || manager.live_room_count() == 0).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn state_of_a_purged_document_is_refused() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    http_edit(&manager, TEST_DOC, OP_ONE, "!").await;
    manager
        .purge(TEST_DOC, async { Ok(true) })
        .await
        .expect("purge");
    let loads = cs.endpoint().loaded();

    let state = manager.state(TEST_DOC).await.expect("state");

    assert_eq!(state.status, StateStatus::Purged);
    assert_eq!(cs.endpoint().loaded(), loads);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn state_is_refused_while_draining() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    manager.drain().await.expect("drain");

    let state = manager.state(TEST_DOC).await.expect("state");

    assert_eq!(state.status, StateStatus::Draining);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_export_failure_is_reported_without_closing_the_room() {
    fn unreadable() -> Error {
        Error::message("unreadable block")
    }
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(quiet());
    http_edit(&manager, TEST_DOC, OP_ONE, "!").await;
    *lock(&cs.conv.next_export_failure) = Some(unreadable);

    let state = manager.state(TEST_DOC).await.expect("state");

    assert_eq!(state.status, StateStatus::ExportFailed);
    assert_eq!(manager.live_room_count(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_cold_room_loaded_by_a_committed_key_replay_is_still_evicted() {
    let cs = Cs::new();
    cs.endpoint().holds(TEST_DOC, "hello", None);
    let manager = cs.journal_manager(Options {
        eviction_linger: ms(200),
        ..quiet()
    });
    http_edit(&manager, TEST_DOC, OP_ONE, "!").await;
    wait_until("the first room to be evicted", || {
        manager.live_room_count() == 0
    })
    .await;

    let replay = http_edit(&manager, TEST_DOC, OP_ONE, "!").await;

    assert_eq!(replay.status, EditStatus::Applied);
    assert_eq!(manager.live_room_count(), 1);
    wait_until("the replay's room to be evicted", || {
        manager.live_room_count() == 0
    })
    .await;
}

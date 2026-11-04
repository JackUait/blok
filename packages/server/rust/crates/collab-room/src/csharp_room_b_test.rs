// Twins of the C# CollabRoomTests.cs (second half of the untwinned cases) cases with no Go twin.

#![allow(dead_code, unused_imports, reason = "helpers the later slices use")]

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};

use blok_collab::{BoxFuture, CloseReason, JoinStatus, OperationSource};
use blok_collab_convert::{DocConverter, EditOp, HtmlReader, RichTextHtml, RuntimeHtmlReader};
use blok_collab_docendpoint::{Loaded, Projection};
use blok_collab_journal::Context;
use blok_collab_operation::{AppendResult, Candidate, Checkpoint, Head, Lookup, OpenResult, Reset};
use blok_collab_wire::Message;
use blok_collab_workingset::{Set, Tag};
use blok_jsjson::{Node, Object, Str, Value};
use blok_jsruntime::{Failure, InvokeError, Kind, Pool};
use blok_yjs::Doc;

use crate::test_support::*;
use crate::*;

type MakeError = fn() -> Error;

// --- the endpoint (C# FakeDocEndpoint, with its one-shot failures and echo) ---

#[derive(Default)]
struct Host {
    documents: Mutex<HashMap<String, Loaded>>,
    saves: Mutex<Vec<RecordedSave>>,
    loads: AtomicI32,
    load_failure: Mutex<Option<MakeError>>,
    next_save_failure: Mutex<Option<MakeError>>,
    next_save_version: Mutex<Option<String>>,
    load_gate: Mutex<Option<Gate>>,
    save_gate: Mutex<Option<Gate>>,
    echoes: AtomicBool,
}

fn endpoint_error(message: &str, status_code: u16) -> Error {
    Error::Endpoint(blok_collab_docendpoint::Error::Endpoint {
        message: message.to_owned(),
        status_code,
    })
}

impl Host {
    fn holds(&self, doc: &str, text: &str, version: Option<&str>) {
        self.holds_json(doc, &text_json(text), version);
    }
    fn holds_json(&self, doc: &str, json: &str, version: Option<&str>) {
        lock(&self.documents).insert(
            doc.to_owned(),
            Loaded {
                data: Some(node(json)),
                version: version.map(str::to_owned),
            },
        );
    }
    fn holds_nothing(&self, doc: &str) {
        lock(&self.documents).insert(doc.to_owned(), Loaded::default());
    }
    fn saves(&self) -> Vec<RecordedSave> {
        lock(&self.saves).clone()
    }
    fn saved(&self) -> usize {
        lock(&self.saves).len()
    }
    fn last(&self) -> RecordedSave {
        self.saves().last().cloned().expect("a save")
    }
    fn loaded(&self) -> i32 {
        self.loads.load(Ordering::SeqCst)
    }
    fn gate_loads(&self) -> Gate {
        let gate = Gate::new();
        *lock(&self.load_gate) = Some(gate.clone());
        gate
    }
    fn gate_saves(&self) -> Gate {
        let gate = Gate::new();
        *lock(&self.save_gate) = Some(gate.clone());
        gate
    }
    fn open_saves(&self, gate: &Gate) {
        gate.open();
        *lock(&self.save_gate) = None;
    }
    fn fail_next_save(&self, make: MakeError) {
        *lock(&self.next_save_failure) = Some(make);
    }
    fn fail_loads(&self, make: MakeError) {
        *lock(&self.load_failure) = Some(make);
    }
}

impl Endpoint for Host {
    fn load<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<Loaded, Error>> {
        Box::pin(async move {
            self.loads.fetch_add(1, Ordering::SeqCst);
            let gate = lock(&self.load_gate).clone();
            if let Some(gate) = gate {
                gate.wait().await;
            }
            if let Some(make) = *lock(&self.load_failure) {
                return Err(make());
            }
            lock(&self.documents)
                .get(doc_id)
                .cloned()
                .ok_or_else(|| endpoint_error("collab: the doc endpoint GET returned 404.", 404))
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
                data: data.clone(),
                version: version.map(str::to_owned),
                projection: projection.cloned(),
            });
            let gate = lock(&self.save_gate).clone();
            if let Some(gate) = gate {
                gate.wait().await;
            }
            if let Some(make) = lock(&self.next_save_failure).take() {
                return Err(make());
            }
            let answer = lock(&self.next_save_version).take();
            if self.echoes.load(Ordering::SeqCst) {
                lock(&self.documents).insert(
                    doc_id.to_owned(),
                    Loaded {
                        data: Some(node(&data)),
                        version: answer.clone().or_else(|| version.map(str::to_owned)),
                    },
                );
            }
            Ok(answer)
        })
    }
}

// --- the working set (C# FakeWorkingSetStore's write gate, journal and counts) ---

#[derive(Default)]
struct Disk {
    inner: Arc<MemoryStore>,
    writes: AtomicI32,
    most_frames: AtomicUsize,
    before_write: Mutex<Option<Gate>>,
    landed: Mutex<Vec<String>>,
}

impl Disk {
    fn landed(&self) -> Vec<String> {
        lock(&self.landed).clone()
    }
    fn writes(&self) -> i32 {
        self.writes.load(Ordering::SeqCst)
    }
}

impl WorkingSetStore for Disk {
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
            self.writes.fetch_add(1, Ordering::SeqCst);
            let frames = blok_collab_workingset::decode_frames(updates)
                .expect("a written working set decodes")
                .len();
            self.most_frames.fetch_max(frames, Ordering::SeqCst);
            let gate = lock(&self.before_write).clone();
            if let Some(gate) = gate {
                gate.wait().await;
            }
            self.inner.write(doc_id, updates, tag).await?;
            lock(&self.landed).push(format!("write:{}", tag.epoch));
            Ok(())
        })
    }
    fn reset<'a>(&'a self, doc_id: &'a str, tag: &'a Tag) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move {
            self.inner.reset(doc_id, tag).await?;
            lock(&self.landed).push(format!("reset:{}", tag.epoch));
            Ok(())
        })
    }
    fn retire<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<(), Error>> {
        self.inner.retire(doc_id)
    }
    fn delete<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<(), Error>> {
        self.inner.delete(doc_id)
    }
}

// --- the converter (C# FakeDocConverter's export knobs) ---

#[derive(Default)]
struct Knob {
    inner: TextConverter,
    exports: AtomicI32,
    export_failure: Mutex<Option<MakeError>>,
    next_export_failure: Mutex<Option<MakeError>>,
}

impl Knob {
    fn exports(&self) -> i32 {
        self.exports.load(Ordering::SeqCst)
    }
    fn fail_exports(&self, make: Option<MakeError>) {
        *lock(&self.export_failure) = make;
    }
    fn fail_next_export(&self, make: MakeError) {
        *lock(&self.next_export_failure) = Some(make);
    }
}

impl Converter for Knob {
    fn seed<'a>(&'a self, doc: &'a Doc, output_data: &'a Node) -> BoxFuture<'a, Result<(), Error>> {
        self.inner.seed(doc, output_data)
    }
    fn export<'a>(&'a self, doc: &'a Doc) -> BoxFuture<'a, Result<Object, Error>> {
        self.exports.fetch_add(1, Ordering::SeqCst);
        let failure =
            (*lock(&self.export_failure)).or_else(|| lock(&self.next_export_failure).take());
        match failure {
            Some(make) => Box::pin(async move { Err(make()) }),
            None => self.inner.export(doc),
        }
    }
    fn apply_ops<'a>(
        &'a self,
        doc: &'a Doc,
        ops: &'a [EditOp],
    ) -> BoxFuture<'a, Result<(), Error>> {
        self.inner.apply_ops(doc, ops)
    }
    fn migrate_rich_text<'a>(&'a self, doc: &'a Doc) -> BoxFuture<'a, Result<usize, Error>> {
        self.inner.migrate_rich_text(doc)
    }
}

// --- the journal (FakeJournal with a checkpoint failure of any type) ---

type CheckpointFailure = Arc<Mutex<Option<MakeError>>>;

struct Shaky {
    inner: FakeJournal,
    fail: CheckpointFailure,
}

struct ShakySession {
    inner: Arc<dyn OperationSession>,
    fail: CheckpointFailure,
}

impl OperationStore for Shaky {
    fn open<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
    ) -> BoxFuture<'a, Result<Opened, Error>> {
        Box::pin(async move {
            let (outcome, session) = self.inner.open(ctx, doc_id).await?;
            let session = session.map(|inner| {
                Arc::new(ShakySession {
                    inner,
                    fail: self.fail.clone(),
                }) as Arc<dyn OperationSession>
            });
            Ok((outcome, session))
        })
    }
    fn type_name(&self) -> &'static str {
        self.inner.type_name()
    }
}

impl OperationSession for ShakySession {
    fn open_result(&self) -> &OpenResult {
        self.inner.open_result()
    }
    fn find_committed<'a>(
        &'a self,
        ctx: &'a Context,
        operation_id: &'a str,
        digest: &'a [u8],
    ) -> BoxFuture<'a, Result<Lookup, Error>> {
        self.inner.find_committed(ctx, operation_id, digest)
    }
    fn append<'a>(
        &'a self,
        ctx: &'a Context,
        candidate: Candidate,
    ) -> BoxFuture<'a, Result<AppendResult, Error>> {
        self.inner.append(ctx, candidate)
    }
    fn write_checkpoint<'a>(
        &'a self,
        ctx: &'a Context,
        checkpoint: Checkpoint,
    ) -> BoxFuture<'a, Result<(), Error>> {
        match *lock(&self.fail) {
            Some(make) => Box::pin(async move { Err(make()) }),
            None => self.inner.write_checkpoint(ctx, checkpoint),
        }
    }
    fn reset<'a>(&'a self, ctx: &'a Context, reset: Reset) -> BoxFuture<'a, Result<Head, Error>> {
        self.inner.reset(ctx, reset)
    }
    fn close(&self) -> BoxFuture<'_, Result<(), Error>> {
        self.inner.close()
    }
}

// --- the activity observer (C# RecordingActivityObserver) ---

#[derive(Clone, Debug)]
struct Recorded {
    doc: String,
    actor: String,
    at: SystemTime,
    kind: ActivityKind,
}

#[derive(Default)]
struct Recorder {
    records: Mutex<Vec<Recorded>>,
    failing: AtomicBool,
    gate: Mutex<Option<Gate>>,
}

impl Recorder {
    fn records(&self) -> Vec<Recorded> {
        lock(&self.records).clone()
    }
    fn kinds(&self) -> Vec<ActivityKind> {
        self.records().into_iter().map(|r| r.kind).collect()
    }
    fn hold(&self) -> Gate {
        let gate = Gate::new();
        *lock(&self.gate) = Some(gate.clone());
        gate
    }
    async fn wait_for(&self, count: usize) {
        wait_until("the activity records", || {
            lock(&self.records).len() >= count
        })
        .await;
    }
}

impl ActivityObserver for Recorder {
    fn record<'a>(
        &'a self,
        doc_id: &'a str,
        actor_id: &'a str,
        at: SystemTime,
        kind: ActivityKind,
    ) -> BoxFuture<'a, Result<(), Error>> {
        lock(&self.records).push(Recorded {
            doc: doc_id.to_owned(),
            actor: actor_id.to_owned(),
            at,
            kind,
        });
        let failing = self.failing.load(Ordering::SeqCst);
        let gate = lock(&self.gate).clone();
        Box::pin(async move {
            if failing {
                return Err(Error::message("the activity table is down"));
            }
            if let Some(gate) = gate {
                gate.wait().await;
            }
            Ok(())
        })
    }
}

// --- HTML readers ---

fn runtime() -> &'static RuntimeHtmlReader<Pool> {
    static READER: OnceLock<RuntimeHtmlReader<Pool>> = OnceLock::new();
    READER.get_or_init(|| RuntimeHtmlReader {
        runtime: Pool::new(blok_jsruntime::Options {
            pool_size: 1,
            ..blok_jsruntime::Options::default()
        })
        .unwrap_or_else(|err| panic!("{err}")),
    })
}

fn converter_over<R: HtmlReader + Send + Sync + 'static>(html: R) -> Arc<dyn Converter> {
    Arc::new(DocConverter {
        now: Box::new(SystemTime::now),
        html,
        fields: None,
        log: None,
    })
}

fn rich_converter() -> Arc<dyn Converter> {
    converter_over(runtime())
}

struct FailingHtml(fn() -> blok_collab_convert::Error);

impl HtmlReader for FailingHtml {
    async fn read(
        &self,
        _fields: &[RichTextHtml],
        _timeout: Duration,
    ) -> Result<Vec<Vec<Value>>, blok_collab_convert::Error> {
        Err((self.0)())
    }
}

struct DefaultTimeoutTooShort;

impl HtmlReader for DefaultTimeoutTooShort {
    async fn read(
        &self,
        fields: &[RichTextHtml],
        timeout: Duration,
    ) -> Result<Vec<Vec<Value>>, blok_collab_convert::Error> {
        if timeout.is_zero() {
            return Err(runtime_failure(Kind::TimedOut));
        }
        Ok(fields.iter().map(|_| Vec::new()).collect())
    }
}

fn runtime_failure(kind: Kind) -> blok_collab_convert::Error {
    blok_collab_convert::Error::Runtime(InvokeError::Failure(Failure {
        kind,
        err: blok_jsruntime::Error::Engine("the runtime stopped".to_owned()),
    }))
}

fn transient(err: blok_collab_convert::Error) -> Error {
    Error::Convert(blok_collab_convert::Error::Transient(
        blok_collab_convert::TransientError {
            message: "collab: the rich text HTML could not be read".to_owned(),
            err: Box::new(err),
        },
    ))
}

fn timed_out_export() -> Error {
    transient(runtime_failure(Kind::TimedOut))
}

fn too_large_export() -> Error {
    transient(runtime_failure(Kind::DocumentTooLarge))
}

fn pool_wait_export() -> Error {
    transient(blok_collab_convert::Error::Message(
        "the operation was canceled".to_owned(),
    ))
}

fn plain_timeout_export() -> Error {
    transient(blok_collab_convert::Error::Message(
        "the runtime took too long".to_owned(),
    ))
}

// --- the room under test ---

struct Kit {
    disk: Arc<Disk>,
    host: Arc<Host>,
    journal: FakeJournal,
    fail_checkpoints: CheckpointFailure,
    knob: Arc<Knob>,
    clock: ManualClock,
    logs: Logs,
    activity: Arc<Recorder>,
}

impl Kit {
    fn new() -> Kit {
        Kit {
            disk: Arc::new(Disk::default()),
            host: Arc::new(Host::default()),
            journal: FakeJournal::new(),
            fail_checkpoints: Arc::new(Mutex::new(None)),
            knob: Arc::new(Knob::default()),
            clock: ManualClock::new(),
            logs: Logs::default(),
            activity: Arc::new(Recorder::default()),
        }
    }

    fn store(&self) -> &MemoryStore {
        &self.disk.inner
    }

    fn manager(&self, o: Options, journalled: bool) -> Manager {
        self.build(o, journalled, None, false)
    }

    fn activity_manager(&self, journalled: bool) -> Manager {
        self.build(Options::default(), journalled, None, true)
    }

    fn build(
        &self,
        mut o: Options,
        journalled: bool,
        converter: Option<Arc<dyn Converter>>,
        activity: bool,
    ) -> Manager {
        if o.now.is_none() {
            o.now = Some(self.clock.clock());
        }
        Manager::new(ManagerOptions {
            store: self.disk.clone(),
            endpoint: self.host.clone(),
            converter: converter.unwrap_or_else(|| self.knob.clone()),
            room: o,
            log: Some(self.logs.log()),
            operations: journalled.then(|| {
                Arc::new(Shaky {
                    inner: self.journal.clone(),
                    fail: self.fail_checkpoints.clone(),
                }) as Arc<dyn OperationStore>
            }),
            activity: activity.then(|| self.activity.clone() as Arc<dyn ActivityObserver>),
        })
    }

    fn fail_checkpoints(&self, make: Option<MakeError>) {
        *lock(&self.fail_checkpoints) = make;
    }

    fn committed(&self) -> usize {
        self.journal.committed(TEST_DOC).len()
    }

    fn lines_with(&self, part: &str) -> usize {
        self.logs.matching(part).len()
    }
}

fn quick() -> Options {
    Options {
        export_debounce: ms(10),
        export_max_delay: ms(10),
        eviction_linger: ms(150),
        retry_backoff: ms(10),
        retry_backoff_cap: ms(10),
        commit_timeout: Duration::from_secs(5),
        ..Options::default()
    }
}

fn v1(actor: &str, write: bool) -> Arc<FakeMember> {
    FakeMember::new(actor, OperationSource::ClientV1, write)
}

fn v2(actor: &str, write: bool) -> Arc<FakeMember> {
    FakeMember::new(actor, OperationSource::ClientV2, write)
}

/// C# Join: a v2 member also completes the sync exchange. Answers the
/// lineage the room announced, which a later clear would lose.
async fn enter(manager: &Manager, member: &Arc<FakeMember>) -> (Joined, String) {
    let membership = if member.source == Some(OperationSource::ClientV2) {
        join_synced(manager, TEST_DOC, member).await
    } else {
        join(manager, TEST_DOC, member).await
    };
    let lineage = control_tag(member).lineage;
    (membership, lineage)
}

async fn op(membership: &Joined, lineage: &str, operation_id: &str, update: Vec<u8>) {
    receive(
        membership,
        Message::Operation {
            lineage: lineage.to_owned(),
            operation_id: operation_id.to_owned(),
            update,
        },
    )
    .await;
}

async fn update(membership: &Joined, update: Vec<u8>) {
    receive(membership, Message::SyncUpdate { update }).await;
}

async fn leave(manager: &Manager, membership: Joined) {
    membership.leave();
    manager.settle().await;
}

async fn evicted(manager: &Manager, what: &str) {
    wait_until(what, || manager.live_room_count() == 0).await;
}

async fn run_timers(manager: &Manager) {
    for _ in 0..5 {
        tokio::time::sleep(ms(30)).await;
        manager.settle().await;
    }
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

fn appending_segments(id: &str, text: &str) -> EditOp {
    EditOp::Insert {
        id: Str::from(id),
        block: node(&format!(
            r#"{{"id":"{id}","type":"paragraph","data":{{"text":[{}]}}}}"#,
            text_json(text)
        )),
        after: None,
        parent: None,
    }
}

async fn edit_with(
    manager: &Manager,
    ops: Vec<EditOp>,
    operation_id: &str,
    expect: Option<Precondition>,
) -> EditResult {
    let digest = blok_collab_convert::canonical_body_digest(&ops).expect("a digest");
    manager
        .edit(TEST_DOC, ops, operation_id, &digest, "", expect)
        .await
        .expect("edit")
}

/// C# HttpEdit: the block id is b-{text}, the digest the canonical body.
async fn edit_text(
    manager: &Manager,
    operation_id: &str,
    text: &str,
    expect: Option<Precondition>,
) -> EditResult {
    edit_with(
        manager,
        vec![appending(&format!("b-{text}"), text)],
        operation_id,
        expect,
    )
    .await
}

/// C# EditAsync(doc, ops): a fresh operation id.
async fn edit_ops(manager: &Manager, ops: Vec<EditOp>) -> EditResult {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let id = format!("{:032x}", 0xabc0_0000 + NEXT.fetch_add(1, Ordering::SeqCst));
    edit_with(manager, ops, &id, None).await
}

fn zero_lineage() -> String {
    "0".repeat(32)
}

async fn server_state_vector(manager: &Manager, client: &Doc) -> Vec<u8> {
    let probe = v1("", false);
    let membership = join(manager, TEST_DOC, &probe).await;
    receive(
        &membership,
        Message::SyncStep1 {
            state_vector: client.encode_state_vector(),
        },
    )
    .await;
    leave(manager, membership).await;
    probe
        .messages()
        .into_iter()
        .find_map(|m| match m {
            Message::SyncStep1 { state_vector } => Some(state_vector),
            _ => None,
        })
        .expect("the probe got a SyncStep1")
}

fn data_of(save: &RecordedSave) -> Value {
    blok_jsjson::parse(save.data.as_bytes()).expect("the save is JSON")
}

fn member_of<'v>(value: &'v Value, key: &str) -> &'v Value {
    match value {
        Value::Object(object) => object.get(&Str::from(key)).unwrap_or(&Value::Null),
        _ => &Value::Null,
    }
}

fn save_text(save: &RecordedSave) -> String {
    match member_of(&data_of(save), "text") {
        Value::String(text) => text.to_string(),
        other => panic!("the save has no text: {other:?}"),
    }
}

fn save_blocks(save: &RecordedSave) -> Vec<Value> {
    match member_of(&data_of(save), "blocks") {
        Value::Array(blocks) => blocks.clone(),
        other => panic!("the save has no blocks: {other:?}"),
    }
}

fn assert_projection(save: &RecordedSave, lineage: &str, sequence: u64) {
    let projection = save.projection.as_ref().expect("a projection");
    assert_eq!(
        (projection.lineage.as_str(), projection.server_sequence),
        (lineage, sequence)
    );
}

fn rejection(member: &FakeMember) -> (String, String) {
    match member.messages().as_slice() {
        [Message::Rejection { lineage, code, .. }] => (code.clone(), lineage.clone()),
        other => panic!("expected one rejection, got {other:?}"),
    }
}

fn received_step2(member: &FakeMember) -> bool {
    member
        .messages()
        .iter()
        .any(|m| matches!(m, Message::SyncStep2 { .. }))
}

fn replay(frames: &[Vec<u8>]) -> String {
    let doc = new_client();
    for frame in frames {
        doc.apply_update(frame).expect("a frame applies");
    }
    doc_text(&doc)
}

/// A writer that has committed one operation: the C# setup most checkpoint
/// and projection cases start from.
async fn one_operation(k: &Kit, o: Options) -> (Manager, Arc<FakeMember>, Joined, String, Doc) {
    k.host.holds(TEST_DOC, "hello", None);
    let manager = k.manager(o, true);
    let writer = v2("", true);
    let (membership, lineage) = enter(&manager, &writer).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    op(
        &membership,
        &lineage,
        OP_ONE,
        update_appending(&client, "!"),
    )
    .await;
    (manager, writer, membership, lineage, client)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_cold_room_loaded_by_a_reused_key_conflict_is_still_evicted() {
    let k = Kit::new();
    k.host.holds(TEST_DOC, "hello", None);
    let manager = k.manager(quick(), true);
    edit_text(&manager, OP_ONE, "!", None).await;
    evicted(&manager, "the first room to be evicted").await;

    let conflict = edit_text(&manager, OP_ONE, "different", None).await;

    assert_eq!(conflict.status, EditStatus::Conflict);
    assert_eq!(manager.live_room_count(), 1);
    evicted(&manager, "the conflict's room to be evicted").await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_stale_edit_precondition_is_refused_with_the_head_and_nothing_applied() {
    let k = Kit::new();
    k.host.holds(TEST_DOC, "hello", None);
    let manager = k.manager(quick(), true);
    let first = edit_text(&manager, OP_ONE, "!", None).await;
    let head = first.receipt.expect("a receipt");
    let observer = v1("", true);
    let _observing = join(&manager, TEST_DOC, &observer).await;
    observer.clear();

    let stale_sequence = edit_text(
        &manager,
        OP_TWO,
        "?",
        Some(Precondition {
            lineage: head.tag.lineage.clone(),
            sequence: 0,
        }),
    )
    .await;
    let other_lineage = edit_text(
        &manager,
        OP_THREE,
        "?",
        Some(Precondition {
            lineage: zero_lineage(),
            sequence: head.server_sequence,
        }),
    )
    .await;

    assert_eq!(stale_sequence.status, EditStatus::PreconditionFailed);
    assert_eq!(other_lineage.status, EditStatus::PreconditionFailed);
    assert_eq!(stale_sequence.receipt.as_ref(), Some(&head));
    assert_eq!(other_lineage.receipt.as_ref(), Some(&head));
    assert_eq!(k.committed(), 1);
    assert!(observer.messages().is_empty());
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello!");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_matching_edit_precondition_applies_at_the_next_sequence() {
    let k = Kit::new();
    k.host.holds(TEST_DOC, "hello", None);
    let manager = k.manager(quick(), true);
    let head = edit_text(&manager, OP_ONE, "!", None)
        .await
        .receipt
        .expect("a receipt");

    let result = edit_text(
        &manager,
        OP_TWO,
        "?",
        Some(Precondition {
            lineage: head.tag.lineage.clone(),
            sequence: head.server_sequence,
        }),
    )
    .await;

    assert_eq!(result.status, EditStatus::Applied);
    assert_eq!(
        result.receipt,
        Some(Receipt {
            tag: head.tag,
            server_sequence: 2
        })
    );
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello!?");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_committed_key_replays_its_receipt_even_when_its_precondition_is_now_stale() {
    let k = Kit::new();
    k.host.holds(TEST_DOC, "hello", None);
    let manager = k.manager(quick(), true);
    let original = edit_text(&manager, OP_ONE, "!", None).await;
    edit_text(&manager, OP_TWO, "?", None).await;

    let replay = edit_text(
        &manager,
        OP_ONE,
        "!",
        Some(Precondition {
            lineage: original
                .receipt
                .as_ref()
                .expect("a receipt")
                .tag
                .lineage
                .clone(),
            sequence: 0,
        }),
    )
    .await;

    assert_eq!(replay.status, EditStatus::Applied);
    assert_eq!(replay.receipt, original.receipt);
    assert_eq!(k.committed(), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_edit_precondition_without_a_journal_is_refused_before_the_room_loads() {
    let k = Kit::new();
    k.host.holds(TEST_DOC, "hello", None);
    let manager = k.manager(quick(), false);

    let result = edit_text(
        &manager,
        OP_ONE,
        "!",
        Some(Precondition {
            lineage: zero_lineage(),
            sequence: 0,
        }),
    )
    .await;

    assert_eq!(result.status, EditStatus::PreconditionRequired);
    assert_eq!(k.host.loaded(), 0);
    assert_eq!(manager.live_room_count(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_cold_room_loaded_by_a_failed_precondition_is_still_evicted() {
    let k = Kit::new();
    k.host.holds(TEST_DOC, "hello", None);
    let manager = k.manager(quick(), true);

    let result = edit_text(
        &manager,
        OP_ONE,
        "!",
        Some(Precondition {
            lineage: zero_lineage(),
            sequence: 0,
        }),
    )
    .await;

    assert_eq!(result.status, EditStatus::PreconditionFailed);
    assert_eq!(manager.live_room_count(), 1);
    evicted(&manager, "the room to be evicted").await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_edit_is_refused_while_another_process_holds_the_document() {
    let k = Kit::new();
    k.host.holds(TEST_DOC, "hello", None);
    let held = k.journal.open_session(TEST_DOC).expect("the journal opens");
    let manager = k.manager(quick(), true);

    let refused = edit_ops(&manager, vec![appending("b-1", "x")]).await;

    assert_eq!(refused.status, EditStatus::Unavailable);
    assert_eq!(k.host.loaded(), 0);
    assert_eq!(manager.live_room_count(), 0);

    held.do_close();
    assert_eq!(
        edit_ops(&manager, vec![appending("b-1", "x")]).await.status,
        EditStatus::Applied
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_read_only_members_operation_is_rejected_without_journalling() {
    let k = Kit::new();
    k.host.holds(TEST_DOC, "hello", None);
    let manager = k.manager(quick(), true);
    let reader = v2("", false);
    let (membership, lineage) = enter(&manager, &reader).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, " hacked");
    reader.clear();

    op(&membership, &lineage, OP_ONE, edit).await;

    assert_eq!(rejection(&reader).0, "read-only");
    assert_eq!(k.committed(), 0);
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_operation_from_another_lineage_is_rejected_without_journalling() {
    let k = Kit::new();
    k.host.holds(TEST_DOC, "hello", None);
    let manager = k.manager(quick(), true);
    let writer = v2("", true);
    let (membership, _) = enter(&manager, &writer).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    let edit = update_appending(&client, "!");
    writer.clear();

    op(&membership, TAG_LINEAGE, OP_ONE, edit).await;

    let (code, lineage) = rejection(&writer);
    assert_eq!(code, "lineage-mismatch");
    assert_eq!(lineage, TAG_LINEAGE);
    assert_eq!(k.committed(), 0);
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_unusable_operation_update_is_rejected_without_journalling() {
    let k = Kit::new();
    k.host.holds(TEST_DOC, "hello", None);
    let manager = k.manager(quick(), true);
    let writer = v2("", true);
    let (membership, lineage) = enter(&manager, &writer).await;
    writer.clear();

    op(
        &membership,
        &lineage,
        OP_ONE,
        vec![0xde, 0xad, 0xbe, 0xef, 0x01],
    )
    .await;

    assert_eq!(rejection(&writer).0, "invalid-update");
    assert_eq!(k.committed(), 0);
    assert!(writer.closed().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn operation_ack_does_not_wait_for_json_projection() {
    let k = Kit::new();
    k.host.holds(TEST_DOC, "hello", None);
    let gate = k.host.gate_saves();
    let manager = k.manager(quick(), true);
    let writer = v2("", true);
    let (membership, lineage) = enter(&manager, &writer).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    writer.clear();

    op(
        &membership,
        &lineage,
        OP_ONE,
        update_appending(&client, "!"),
    )
    .await;

    let ack = writer
        .messages()
        .into_iter()
        .find_map(|m| match m {
            Message::Acknowledgement {
                server_sequence, ..
            } => Some(server_sequence),
            _ => None,
        })
        .expect("an acknowledgement");
    assert_eq!(ack, 1);

    tokio::time::sleep(ms(100)).await;
    manager.settle().await;

    assert!(k.host.saves().is_empty());
    assert_eq!(k.committed(), 1);
    k.host.open_saves(&gate);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn edits_do_not_schedule_a_whole_json_put_per_debounce_window() {
    let k = Kit::new();
    k.host.holds(TEST_DOC, "hello", None);
    let manager = k.manager(quick(), true);
    let writer = v2("", true);
    let (membership, lineage) = enter(&manager, &writer).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;

    for id in [OP_ONE, OP_TWO, OP_THREE] {
        op(&membership, &lineage, id, update_appending(&client, "!")).await;
        tokio::time::sleep(ms(50)).await;
        manager.settle().await;
    }

    assert_eq!(k.knob.exports(), 0);
    assert!(k.host.saves().is_empty());
    assert_eq!(k.committed(), 3);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn published_checkpoint_schedules_one_projection() {
    let k = Kit::new();
    k.host.holds(TEST_DOC, "hello", None);
    let gate = k.host.gate_saves();
    let manager = k.manager(quick(), true);
    let writer = v2("", true);
    let (membership, lineage) = enter(&manager, &writer).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    op(
        &membership,
        &lineage,
        OP_ONE,
        update_appending(&client, "!"),
    )
    .await;

    assert!(manager.checkpoint(TEST_DOC).await.expect("checkpoint"));
    wait_until("the projection the checkpoint earned", || {
        k.host.saved() == 1
    })
    .await;

    op(
        &membership,
        &lineage,
        OP_TWO,
        update_appending(&client, "?"),
    )
    .await;
    k.host.open_saves(&gate);
    run_timers(&manager).await;

    assert_eq!(k.knob.exports(), 1);
    let saves = k.host.saves();
    assert_eq!(saves.len(), 1);
    assert_eq!(save_text(&saves[0]), "hello!");
    assert_eq!(
        k.journal
            .checkpoint(TEST_DOC)
            .expect("a checkpoint")
            .through,
        1
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_reloaded_journal_room_still_serves_when_the_endpoint_is_down() {
    let k = Kit::new();
    k.host.holds(TEST_DOC, "hello", None);
    let manager = k.manager(quick(), true);
    let member = v2("", true);
    let (first, lineage) = enter(&manager, &member).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    op(
        &first,
        &lineage,
        OP_ONE,
        update_appending(&client, " world"),
    )
    .await;
    leave(&manager, first).await;
    evicted(&manager, "the seeded room to be evicted").await;
    k.host
        .fail_loads(|| endpoint_error("collab: the doc endpoint GET returned 503.", 503));

    let rejoined = manager.join(TEST_DOC, v2("", true)).await.expect("join");

    assert_eq!(rejoined.status, JoinStatus::Joined);
    assert_eq!(exported_text(&manager, TEST_DOC).await, "hello world");
    wait_until("the version read to report its failure", || {
        k.logs.logged("could not read the document version")
    })
    .await;
}

async fn a_null_seed_reopens_with_one_empty_put(k: &Kit, manager: &Manager) {
    let lineage = k.journal.head(TEST_DOC).expect("a head").lineage;
    run_timers(manager).await;
    evicted(manager, "the first room to be evicted").await;
    assert!(k.host.saves().is_empty());

    let (reopened, _) = enter(manager, &v2("", true)).await;
    leave(manager, reopened).await;
    wait_until("the reopen PUT", || k.host.saved() > 0).await;
    run_timers(manager).await;
    evicted(manager, "the reopened room to be evicted").await;

    assert_eq!(k.host.loaded(), 2);
    let saves = k.host.saves();
    assert_eq!(saves.len(), 1);
    assert!(save_blocks(&saves[0]).is_empty());
    assert_eq!(saves[0].version, None);
    assert_projection(&saves[0], &lineage, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn under_a_journal_a_null_seed_puts_nothing_and_its_reopen_puts_one_empty_document() {
    let k = Kit::new();
    k.host.holds_nothing(TEST_DOC);
    let manager = k.build(quick(), true, Some(rich_converter()), false);
    let (first, _) = enter(&manager, &v2("", true)).await;
    leave(&manager, first).await;

    a_null_seed_reopens_with_one_empty_put(&k, &manager).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_seed_reads_its_html_with_the_one_time_budget() {
    let k = Kit::new();
    k.host.holds_json(
        TEST_DOC,
        r#"{"blocks":[{"id":"b1","type":"paragraph","data":{"text":"<b>large</b>"}}]}"#,
        None,
    );
    let manager = k.build(
        quick(),
        false,
        Some(converter_over(DefaultTimeoutTooShort)),
        false,
    );

    let result = manager.join(TEST_DOC, v1("", true)).await.expect("join");

    assert_eq!(result.status, JoinStatus::Joined);
}

fn object(entries: Vec<(&str, Value)>) -> Object {
    entries
        .into_iter()
        .map(|(key, value)| (Str::from(key), value))
        .collect()
}

/// C# YDocConverterRichTextTests.PoisonFormattedText: between "a" and "b",
/// a malformed equation embed, an "x" with a non-string tag attribute and a
/// non-string color, and a page embed whose id is not a string.
fn poison_formatted_text(doc: &Doc, block_id: &str) {
    let text = doc
        .get_map("blocks")
        .expect("a blocks root")
        .get(block_id)
        .and_then(|block| block.as_map())
        .and_then(|block| block.get("data"))
        .and_then(|data| data.as_map())
        .and_then(|data| data.get("text"))
        .and_then(|v| v.as_xml_text())
        .expect("a YXmlText");
    let marks = object(vec![
        ("color", Value::Object(Object::new())),
        (
            "tag:b",
            Value::Object(object(vec![("x", Value::Number(1.0))])),
        ),
    ]);
    let bad_equation = object(vec![(
        "equation",
        Value::Object(object(vec![("expression", Value::Number(5.0))])),
    )]);
    let bad_page = object(vec![(
        "page",
        Value::Object(object(vec![("id", Value::Object(Object::new()))])),
    )]);
    let empty = Object::new();
    doc.transact(|t| {
        text.insert_embed(Some(t), 1, Value::Object(bad_equation), Some(&empty))?;
        text.insert(Some(t), 2, "x", Some(&marks))?;
        text.insert_embed(Some(t), 3, Value::Object(bad_page), Some(&empty))
    })
    .expect("the poison writes");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn malformed_rich_text_from_the_host_or_a_peer_keeps_the_room_exportable() {
    let k = Kit::new();
    k.host.holds_json(
        TEST_DOC,
        r#"{"blocks":[
          {"id":"b1","type":"paragraph","data":{"text":[{"text":"ab"}]}},
          {"id":"b2","type":"paragraph","data":{"text":[
            {"text":"c","marks":{"tag:b":{"x":1},"color":{}}},
            {"embed":{"equation":null}}
          ]}}
        ]}"#,
        None,
    );
    let manager = k.build(quick(), false, Some(rich_converter()), false);
    let writer = v1("", true);
    let (membership, _) = enter(&manager, &writer).await;
    let client = new_client();
    let update_for = probe_step2(&manager, TEST_DOC, client.encode_state_vector()).await;
    client.apply_update(&update_for).expect("the step2 applies");
    let before = client.encode_state_vector();

    poison_formatted_text(&client, "b1");
    update(
        &membership,
        client.encode_state_as_update(&before).expect("a diff"),
    )
    .await;
    wait_until("the export", || k.host.saved() > 0).await;

    let blocks = save_blocks(&k.host.last());
    let text_of = |block: &Value| {
        blok_jsjson::stringify(member_of(member_of(block, "data"), "text")).expect("stringify")
    };
    assert_eq!(
        text_of(&blocks[0]),
        r#"[{"text":"a"},{"text":"x","marks":{"tag:b":{}}},{"text":"b"}]"#
    );
    assert_eq!(
        text_of(&blocks[1]),
        r#"[{"text":"c","marks":{"tag:b":{}}}]"#
    );

    let edit = edit_ops(
        &manager,
        vec![EditOp::Update {
            id: Str::from("b1"),
            data: node(r#"{"text":[{"text":"abc"}]}"#),
        }],
    )
    .await;

    assert_eq!(edit.status, EditStatus::Applied);
    assert!(writer.closed().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn under_a_journal_an_html_reader_failure_refuses_the_edit_and_keeps_the_room() {
    let k = Kit::new();
    k.host.holds_nothing(TEST_DOC);
    let failing =
        FailingHtml(|| blok_collab_convert::Error::Message("the runtime took too long".to_owned()));
    let manager = k.build(quick(), true, Some(converter_over(failing)), false);
    let writer = v2("", true);
    let _joined = enter(&manager, &writer).await;

    let result = edit_ops(&manager, vec![appending("b-1", "<b>x</b>")]).await;

    assert_eq!(result.status, EditStatus::Invalid);
    assert!(writer.closed().is_empty());
    assert_eq!(k.committed(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn under_a_journal_an_html_read_past_the_runtimes_limits_is_overloaded_and_keeps_the_room() {
    let k = Kit::new();
    k.host.holds_nothing(TEST_DOC);
    let failing = FailingHtml(|| runtime_failure(Kind::TimedOut));
    let manager = k.build(quick(), true, Some(converter_over(failing)), false);
    let writer = v2("", true);
    let _joined = enter(&manager, &writer).await;

    let result = edit_ops(&manager, vec![appending("b-1", "<b>x</b>")]).await;
    let next = edit_ops(&manager, vec![appending_segments("b-2", "y")]).await;

    assert_eq!(result.status, EditStatus::Overloaded);
    assert!(
        matches!(
            &result.err,
            Some(Error::Convert(blok_collab_convert::Error::Transient(t)))
                if matches!(*t.err, blok_collab_convert::Error::Runtime(_))
        ),
        "{:?}",
        result.err
    );
    assert!(writer.closed().is_empty());
    assert_eq!(next.status, EditStatus::Applied);
    assert_eq!(k.committed(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn on_a_working_copy_an_html_read_past_the_runtimes_limits_is_overloaded_and_keeps_the_room()
{
    let k = Kit::new();
    k.host.holds_nothing(TEST_DOC);
    let failing = FailingHtml(|| runtime_failure(Kind::TimedOut));
    let manager = k.build(quick(), false, Some(converter_over(failing)), false);
    let writer = v1("", true);
    let _joined = enter(&manager, &writer).await;

    let result = edit_ops(&manager, vec![appending("b-1", "<b>x</b>")]).await;
    let next = edit_ops(&manager, vec![appending_segments("b-2", "y")]).await;

    assert_eq!(result.status, EditStatus::Overloaded);
    assert!(writer.closed().is_empty());
    assert_eq!(next.status, EditStatus::Applied);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_html_read_past_the_allocation_budget_is_too_large_and_keeps_the_room() {
    for journal in [true, false] {
        let k = Kit::new();
        k.host.holds_nothing(TEST_DOC);
        let failing = FailingHtml(|| runtime_failure(Kind::DocumentTooLarge));
        let manager = k.build(quick(), journal, Some(converter_over(failing)), false);
        let writer = if journal { v2("", true) } else { v1("", true) };
        let _joined = enter(&manager, &writer).await;

        let result = edit_ops(&manager, vec![appending("b-1", "<b>x</b>")]).await;
        let next = edit_ops(&manager, vec![appending_segments("b-2", "y")]).await;

        assert_eq!(result.status, EditStatus::TooLarge, "journal: {journal}");
        assert!(writer.closed().is_empty(), "journal: {journal}");
        assert_eq!(next.status, EditStatus::Applied, "journal: {journal}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_java_script_error_reading_an_edits_html_stays_a_refusal() {
    let k = Kit::new();
    k.host.holds_nothing(TEST_DOC);
    let failing = FailingHtml(|| runtime_failure(Kind::InvalidDocument));
    let manager = k.build(quick(), true, Some(converter_over(failing)), false);
    let _joined = enter(&manager, &v2("", true)).await;

    let result = edit_ops(&manager, vec![appending("b-1", "<b>x</b>")]).await;

    assert_eq!(result.status, EditStatus::Invalid);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_state_export_past_the_runtimes_limits_is_overloaded() {
    let k = Kit::new();
    k.host.holds(TEST_DOC, "hello", None);
    let manager = k.manager(quick(), false);
    let _joined = enter(&manager, &v1("", true)).await;
    k.knob.fail_exports(Some(timed_out_export));

    let state = manager.state(TEST_DOC).await.expect("state");

    assert_eq!(state.status, StateStatus::Overloaded);
    assert!(state.json.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_state_export_that_can_never_be_written_stays_export_failed() {
    let k = Kit::new();
    k.host.holds(TEST_DOC, "hello", None);
    let manager = k.manager(quick(), false);
    let _joined = enter(&manager, &v1("", true)).await;
    k.knob.fail_exports(Some(|| {
        Error::Convert(blok_collab_convert::Error::Data(
            blok_collab_convert::DataError {
                message: "not JSON".to_owned(),
            },
        ))
    }));

    let state = manager.state(TEST_DOC).await.expect("state");

    assert_eq!(state.status, StateStatus::ExportFailed);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn under_a_journal_a_state_read_seeds_a_null_document_and_its_reopen_puts_once() {
    let k = Kit::new();
    k.host.holds_nothing(TEST_DOC);
    let manager = k.build(quick(), true, Some(rich_converter()), false);

    let state = manager.state(TEST_DOC).await.expect("state");

    assert_eq!(state.status, StateStatus::Ready);
    a_null_seed_reopens_with_one_empty_put(&k, &manager).await;
}

const OP_FOUR: &str = "11111111222222223333333344444444";
const OP_FIVE: &str = "5555555566666666777777778888888a";

fn invalid_data(message: &'static str) -> Error {
    Error::Journal(blok_collab_journal::Error::InvalidData {
        message: message.to_owned(),
        source: None,
    })
}

async fn checkpoint(manager: &Manager) -> bool {
    manager.checkpoint(TEST_DOC).await.expect("checkpoint")
}

fn checkpointed_through(k: &Kit) -> u64 {
    k.journal
        .checkpoint(TEST_DOC)
        .expect("a published checkpoint")
        .through
}

fn threshold(operations: i64) -> Options {
    Options {
        checkpoint_operation_threshold: operations,
        ..quick()
    }
}

#[test]
#[ignore = "not ported yet"]
fn a_checkpoint_refused_by_a_corrupt_journal_closes_the_room() {}

#[test]
#[ignore = "not ported yet"]
fn a_checkpoint_sequence_the_store_refuses_closes_the_room() {}

#[test]
#[ignore = "not ported yet"]
fn a_transient_checkpoint_failure_keeps_the_room_and_is_retried() {}

#[test]
#[ignore = "not ported yet"]
fn a_checkpoint_that_lost_the_fence_closes_the_room() {}

#[test]
#[ignore = "not ported yet"]
fn a_reloaded_room_counts_the_tail_it_inherited_toward_the_threshold() {}

#[test]
#[ignore = "not ported yet"]
fn checkpoint_then_tail_replays_the_exact_document() {}

#[test]
#[ignore = "not ported yet"]
fn checkpoint_publication_does_not_delete_operation_history() {}

#[test]
#[ignore = "not ported yet"]
fn the_operation_that_trips_a_fatal_checkpoint_is_still_relayed_and_acknowledged() {}

#[test]
#[ignore = "not ported yet"]
fn resetting_a_journal_room_projects_committed_work_before_it_rebaselines() {}

#[test]
#[ignore = "not ported yet"]
fn a_client_disconnecting_mid_reset_does_not_cost_the_projection() {}

/// C# AJournalledDocumentWhoseRecordMissedAnOperation: the drain's
/// write-back is refused, so the record holds "hello"; answers a fresh
/// manager over the same journal.
async fn a_journalled_document_whose_record_missed_an_operation(k: &Kit) -> Manager {
    k.host.holds(TEST_DOC, "hello", Some("v1"));
    k.host.echoes.store(true, Ordering::SeqCst);
    let first = k.manager(quick(), true);
    let (membership, lineage) = enter(&first, &v2("", true)).await;
    let client = synced_client(&first, TEST_DOC, "hello").await;
    op(
        &membership,
        &lineage,
        OP_ONE,
        update_appending(&client, " world"),
    )
    .await;
    k.host
        .fail_next_save(|| endpoint_error("collab: the doc endpoint PUT returned 503.", 503));
    first.drain().await.expect("drain");

    assert_eq!(k.host.saved(), 1);
    assert!(lock(&k.host.next_save_failure).is_none());

    k.manager(quick(), true)
}

#[test]
#[ignore = "not ported yet"]
fn resetting_a_reloaded_room_projects_the_work_the_record_never_got() {}

fn seed_raw_journal(k: &Kit, baseline: Vec<Vec<u8>>) {
    let session = k.journal.open_session(TEST_DOC).expect("the journal opens");
    session
        .do_reset(Reset {
            format: blok_collab_workingset::CURRENT_FORMAT,
            epoch: 3,
            lineage: blok_collab_workingset::new_lineage(),
            baseline,
        })
        .expect("the reset");
    session.do_close();
}

#[test]
#[ignore = "not ported yet"]
fn resetting_a_cold_document_whose_journal_cannot_be_replayed_still_rebaselines() {}

#[test]
#[ignore = "not ported yet"]
fn resetting_a_cold_document_whose_journal_stops_replaying_still_rebaselines() {}

#[test]
#[ignore = "not ported yet"]
fn resetting_a_cold_journalled_document_projects_it_before_rebaselining() {}

#[test]
#[ignore = "not ported yet"]
fn an_edit_on_a_cold_journalled_document_does_not_wait_for_the_version_read() {}

/// C# AReloadedRoomWhoseVersionReadIsStuck.
async fn a_reloaded_room_whose_version_read_is_stuck(k: &Kit, o: Options) -> (Manager, Gate) {
    k.host.holds(TEST_DOC, "hello", Some("v1"));
    let first = k.manager(o.clone(), true);
    let (membership, lineage) = enter(&first, &v2("", true)).await;
    let client = synced_client(&first, TEST_DOC, "hello").await;
    op(
        &membership,
        &lineage,
        OP_ONE,
        update_appending(&client, " world"),
    )
    .await;
    first.drain().await.expect("drain");
    k.host.holds(TEST_DOC, "hello world", Some("v2"));
    let gate = k.host.gate_loads();
    (k.manager(o, true), gate)
}

#[test]
#[ignore = "not ported yet"]
fn a_version_read_that_lands_after_a_failed_projection_still_fills_the_handle() {}

#[test]
#[ignore = "not ported yet"]
fn a_reset_flush_carries_the_reloaded_version_and_yields_to_the_hosts_save() {}

#[test]
#[ignore = "not ported yet"]
fn a_reloaded_room_inherits_its_committed_sequence_from_the_head() {}

#[test]
#[ignore = "not ported yet"]
fn failed_projection_stays_dirty_and_retries() {}

#[test]
#[ignore = "not ported yet"]
fn eviction_and_drain_project_the_latest_committed_sequence() {}

#[test]
#[ignore = "not ported yet"]
fn eviction_waits_for_a_dirty_projection() {}

#[test]
#[ignore = "not ported yet"]
fn permanent_projection_failure_releases_the_hold_and_marks_the_document_unexportable() {}

#[test]
#[ignore = "not ported yet"]
fn a_transient_export_failure_is_retried_not_refused() {}

#[test]
#[ignore = "not ported yet"]
fn an_engine_pool_wait_never_gives_the_export_up() {}

/// A working copy whose every export fails with `make`, after one v1 edit.
async fn a_failing_working_copy(k: &Kit, make: MakeError) -> (Manager, Joined, Doc) {
    k.host.holds(TEST_DOC, "hello", None);
    let manager = k.manager(quick(), false);
    let (membership, _) = enter(&manager, &v1("", true)).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    k.knob.fail_exports(Some(make));
    update(&membership, update_appending(&client, "!")).await;
    (manager, membership, client)
}

#[test]
#[ignore = "not ported yet"]
fn on_a_working_copy_a_transient_export_failure_that_never_heals_is_given_up() {}

#[test]
#[ignore = "not ported yet"]
fn on_a_working_copy_a_given_up_export_lets_the_room_unload() {}

#[test]
#[ignore = "not ported yet"]
fn on_a_working_copy_an_engine_pool_wait_never_gives_the_export_up() {}

#[test]
#[ignore = "not ported yet"]
fn a_transient_flush_export_failure_is_not_a_refusal() {}

#[test]
#[ignore = "not ported yet"]
fn a_java_script_error_reading_export_html_is_a_refusal() {}

#[test]
#[ignore = "not ported yet"]
fn a_cancelled_export_is_retried_not_refused() {}

#[test]
#[ignore = "not ported yet"]
fn operation_store_room_never_writes_the_working_set_store() {}

#[test]
#[ignore = "not ported yet"]
fn operation_store_room_never_compacts() {}

#[test]
#[ignore = "not ported yet"]
fn operation_store_room_loads_baseline_and_tail_through_the_fenced_session() {}

#[test]
#[ignore = "not ported yet"]
fn operation_store_room_evicts_without_waiting_for_a_blob_write() {}

fn actor_records(k: &Kit, kind: ActivityKind) -> Vec<String> {
    k.activity
        .records()
        .into_iter()
        .filter(|r| r.kind == kind)
        .map(|r| r.actor)
        .collect()
}

async fn heartbeat(membership: &Joined) {
    receive(membership, Message::Activity).await;
}

async fn step1(membership: &Joined) {
    receive(
        membership,
        Message::SyncStep1 {
            state_vector: new_client().encode_state_vector(),
        },
    )
    .await;
}

/// C# HeartbeatDistinctActorsAsync: one Active apiece from actors the room
/// has never seen, each gone before the next; settled every 16 so the
/// bounded activity queue never sheds a record under test.
async fn heartbeat_distinct_actors(manager: &Manager, prefix: &str, count: usize) {
    for index in 0..count {
        let membership = join(manager, TEST_DOC, &v1(&format!("{prefix}-{index}"), true)).await;
        heartbeat(&membership).await;
        membership.leave();
        if index % 16 == 15 {
            manager.settle().await;
        }
    }
}

/// C# RoomActivityStampCount.
async fn stamp_count(manager: &Manager) -> usize {
    manager.settle().await;
    let rooms = manager.live_rooms();
    assert_eq!(rooms.len(), 1, "one live room");
    rooms[0].state.lock().await.activity_stamps.len()
}

const STAMP_ROUND: usize = crate::options::ACTIVITY_STAMP_LIMIT + 1;

#[test]
#[ignore = "not ported yet"]
fn a_join_reports_the_actor_as_joined() {}

#[test]
#[ignore = "not ported yet"]
fn a_connection_with_no_verified_actor_is_never_reported() {}

#[test]
#[ignore = "not ported yet"]
fn an_activity_frame_reports_active_with_the_document_and_the_server_clock() {}

#[test]
#[ignore = "not ported yet"]
fn active_and_edited_share_one_minute_window_per_actor() {}

#[test]
#[ignore = "not ported yet"]
fn a_heartbeat_arriving_just_under_the_clients_minute_is_still_reported() {}

#[test]
#[ignore = "not ported yet"]
fn join_and_leave_are_never_suppressed() {}

#[test]
#[ignore = "not ported yet"]
fn a_reader_that_never_edits_is_reported_joined_then_left() {}

#[test]
#[ignore = "not ported yet"]
fn a_throwing_observer_is_logged_and_neither_closes_the_room_nor_stalls_it() {}

#[test]
#[ignore = "not ported yet"]
fn an_observer_still_inside_record_async_does_not_hold_the_lane() {}

#[test]
#[ignore = "same case as activity_test::the_drain_stops_waiting_for_a_stuck_observer_at_the_commit_timeout"]
fn a_drain_abandons_an_activity_observer_that_never_completes() {}

#[test]
#[ignore = "not ported yet"]
fn a_drain_already_cancelled_does_not_wait_out_the_activity_observer() {}

#[test]
#[ignore = "not ported yet"]
fn a_heartbeat_flood_is_dropped_before_a_session_boundary() {}

#[test]
#[ignore = "not ported yet"]
fn a_room_that_closes_on_a_commit_failure_reports_left_for_every_member() {}

#[test]
#[ignore = "not ported yet"]
fn a_drain_reports_left_for_every_verified_member_it_still_held() {}

#[test]
#[ignore = "not ported yet"]
fn a_member_that_left_is_not_reported_left_again_when_the_room_closes() {}

fn malformed_awareness() -> Message {
    Message::Awareness {
        update: vec![0x01, 0x02, 0x03],
    }
}

#[test]
#[ignore = "not ported yet"]
fn an_expelled_member_is_reported_left_exactly_once() {}

#[test]
#[ignore = "not ported yet"]
fn an_expelled_member_with_no_verified_actor_is_never_reported() {}

#[test]
#[ignore = "not ported yet"]
fn an_actor_inside_its_window_is_still_suppressed_after_a_sweep() {}

#[test]
#[ignore = "not ported yet"]
fn distinct_actors_across_two_windows_leave_the_stamp_map_bounded() {}

#[test]
#[ignore = "not ported yet"]
fn a_stamp_exactly_one_window_old_is_swept() {}

#[test]
#[ignore = "not ported yet"]
fn a_join_and_leave_after_the_limit_still_sweeps_the_inert_stamps() {}

#[test]
#[ignore = "not ported yet"]
fn with_no_observer_an_activity_frame_changes_nothing() {}

#[test]
#[ignore = "not ported yet"]
fn reset_settles_an_in_flight_write_so_it_cannot_overtake_the_reset() {}

#[test]
#[ignore = "not ported yet"]
fn dispose_is_idempotent() {}

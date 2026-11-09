// Twins of the C# CollabHistoryManagerTests.cs cases with no Go twin. They
// run on the built-in journal behind HistoryJournal, which rewrites record
// and lineage times to the C# fake's clock: record N at the Unix epoch plus
// N times the spacing, and every lineage created at the epoch.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, UNIX_EPOCH};

use blok_collab::{BoxFuture, OperationSource};
use blok_collab_convert::{
    DocConverter, EditOp, HtmlReader, RichTextHtml, build_replay, canonical_body_digest,
};
use blok_collab_journal::{Context, LineageDeleteOutcome, LineageInfo, PurgeOutcome, StoreOptions};
use blok_collab_operation::{Record, Source};
use blok_collab_wire::Message;
use blok_jsjson::{Object, Str, Value};
use blok_yjs::{Doc, Out};
use sha2::{Digest, Sha256};

use crate::csharp_changes_test::{runtime_converter, runtime_reader};
use crate::test_support::*;
use crate::*;

const DOC: &str = "doc-1";
const BORDERLINE_TEXT: usize = 1884;
// The built-in journal takes 32 hex characters only, where the C# fake took
// OP_RESTORE and the like.
const OP: &str = "a0000000000000000000000000000000";
const OP_RESTORE: &str = "b0000000000000000000000000000000";
const OP_OTHER: &str = "c0000000000000000000000000000000";
const OP_STALE: &str = "d0000000000000000000000000000000";
const OP_MISSING: &str = "e0000000000000000000000000000000";

struct HistoryJournal {
    inner: LocalJournal,
    spacing: Mutex<Duration>,
    unknown_created_at: AtomicBool,
    fail_listings: AtomicBool,
    corrupt: Mutex<Option<u64>>,
    _dir: TempDir,
}

impl HistoryJournal {
    fn new() -> Arc<HistoryJournal> {
        let dir = TempDir::new();
        let store = blok_collab_journal::Store::new(dir.path(), StoreOptions::default())
            .expect("the journal opens");
        Arc::new(HistoryJournal {
            inner: LocalJournal(store),
            spacing: Mutex::new(Duration::from_secs(1)),
            unknown_created_at: AtomicBool::new(false),
            fail_listings: AtomicBool::new(false),
            corrupt: Mutex::new(None),
            _dir: dir,
        })
    }

    fn spacing(&self) -> Duration {
        *lock(&self.spacing)
    }

    fn lineage(&self) -> String {
        self.inner
            .list_lineages(&Context::background(), DOC)
            .expect("the lineages")
            .into_iter()
            .find(|l| l.current)
            .expect("a current lineage")
            .lineage
    }

    fn committed(&self) -> Vec<Record> {
        let lineage = self.lineage();
        self.read_records(&Context::background(), DOC, &lineage, u64::MAX)
            .collect::<Result<Vec<Record>, Error>>()
            .expect("the records")
    }

    fn replay(&self, through: u64) -> Doc {
        let ctx = Context::background();
        let lineage = self.lineage();
        let baseline = self
            .read_baseline(&ctx, DOC, &lineage)
            .expect("the baseline")
            .expect("a baseline");
        build_replay(
            || Ok::<(), Error>(()),
            &baseline,
            self.read_records(&ctx, DOC, &lineage, through),
        )
        .expect("the replay")
    }
}

impl OperationStore for HistoryJournal {
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
    fn as_history(&self) -> Option<&dyn HistoryStore> {
        Some(self)
    }
    fn type_name(&self) -> &'static str {
        "historyJournal"
    }
}

impl PurgeStore for HistoryJournal {
    fn purge<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
    ) -> BoxFuture<'a, Result<PurgeOutcome, Error>> {
        self.inner.purge(ctx, doc_id)
    }
}

impl HistoryStore for HistoryJournal {
    fn is_purged(&self, ctx: &Context, doc_id: &str) -> Result<bool, Error> {
        self.inner.is_purged(ctx, doc_id)
    }
    fn list_lineages(&self, ctx: &Context, doc_id: &str) -> Result<Vec<LineageInfo>, Error> {
        if self.fail_listings.load(Ordering::SeqCst) {
            return Err(Error::Journal(blok_collab_journal::Error::InvalidData {
                message: "collab: torn ledger".to_owned(),
                source: None,
            }));
        }
        let unknown = self.unknown_created_at.load(Ordering::SeqCst);
        Ok(self
            .inner
            .list_lineages(ctx, doc_id)?
            .into_iter()
            .map(|l| LineageInfo {
                created_at: (!unknown).then_some(UNIX_EPOCH),
                ..l
            })
            .collect())
    }
    fn read_baseline(
        &self,
        ctx: &Context,
        doc_id: &str,
        lineage: &str,
    ) -> Result<Option<Vec<Vec<u8>>>, Error> {
        self.inner.read_baseline(ctx, doc_id, lineage)
    }
    fn read_headers<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
        lineage: &'a str,
    ) -> Headers<'a> {
        let spacing = self.spacing();
        Box::new(self.inner.read_headers(ctx, doc_id, lineage).map(move |h| {
            h.map(|mut h| {
                h.committed_at = UNIX_EPOCH + spacing * h.sequence as u32;
                h
            })
        }))
    }
    fn read_records<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
        lineage: &'a str,
        through: u64,
    ) -> Records<'a> {
        let spacing = self.spacing();
        let corrupt = *lock(&self.corrupt);
        Box::new(
            self.inner
                .read_records(ctx, doc_id, lineage, through)
                .map(move |r| {
                    r.map(|mut r| {
                        r.committed_at = UNIX_EPOCH + spacing * r.sequence as u32;
                        if corrupt == Some(r.sequence) {
                            r.update.truncate(r.update.len() / 2);
                        }
                        r
                    })
                }),
        )
    }
    fn delete_lineage(
        &self,
        ctx: &Context,
        doc_id: &str,
        lineage: &str,
    ) -> Result<LineageDeleteOutcome, Error> {
        self.inner.delete_lineage(ctx, doc_id, lineage)
    }
}

struct Bench {
    journal: Arc<HistoryJournal>,
    store: Arc<MemoryStore>,
    endpoint: Arc<FakeEndpoint>,
}

impl Bench {
    fn new() -> Bench {
        let endpoint = FakeEndpoint::new();
        endpoint.holds_document(DOC, &document(&[("a", "one")]), None);
        Bench {
            journal: HistoryJournal::new(),
            store: MemoryStore::new(),
            endpoint,
        }
    }

    fn manager(&self, o: Options) -> Manager {
        self.manager_over(Some(self.journal.clone()), o)
    }

    fn manager_over(&self, operations: Option<Arc<dyn OperationStore>>, o: Options) -> Manager {
        self.manager_with(operations, o, Arc::new(runtime_converter()))
    }

    fn manager_with(
        &self,
        operations: Option<Arc<dyn OperationStore>>,
        o: Options,
        converter: Arc<dyn Converter>,
    ) -> Manager {
        Manager::new(ManagerOptions {
            store: self.store.clone(),
            endpoint: self.endpoint.clone(),
            converter,
            room: o,
            log: None,
            operations,
            activity: None,
            notes: None,
        })
    }

    fn lineage(&self) -> String {
        self.journal.lineage()
    }

    fn committed(&self) -> Vec<Record> {
        self.journal.committed()
    }
}

fn paragraph(id: &str, text: &str) -> String {
    format!(
        r#"{{"id":{},"type":"paragraph","data":{}}}"#,
        quoted(id),
        text_json(text)
    )
}

fn quoted(text: &str) -> String {
    blok_jsjson::stringify(&Value::String(Str::from(text))).expect("stringify")
}

fn document(blocks: &[(&str, &str)]) -> String {
    let blocks: Vec<String> = blocks.iter().map(|(id, t)| paragraph(id, t)).collect();
    format!(r#"{{"blocks":[{}]}}"#, blocks.join(","))
}

fn update(id: &str, text: &str) -> EditOp {
    EditOp::Update {
        id: Str::from(id),
        data: node(&text_json(text)),
    }
}

fn insert(id: &str, text: &str, after: &str) -> EditOp {
    EditOp::Insert {
        id: Str::from(id),
        block: node(&format!(
            r#"{{"type":"paragraph","data":{}}}"#,
            text_json(text)
        )),
        after: Some(Str::from(after)),
        parent: None,
    }
}

fn insert_segments(id: &str, text: &str, after: &str) -> EditOp {
    EditOp::Insert {
        id: Str::from(id),
        block: node(&format!(
            r#"{{"type":"paragraph","data":{{"text":[{}]}}}}"#,
            text_json(text)
        )),
        after: Some(Str::from(after)),
        parent: None,
    }
}

fn remove(id: &str) -> EditOp {
    EditOp::Remove { id: Str::from(id) }
}

fn fresh_id() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    format!("{:032x}", NEXT.fetch_add(1, Ordering::SeqCst))
}

fn parse(json: &[u8]) -> Object {
    match blok_jsjson::parse(json).expect("JSON") {
        Value::Object(object) => object,
        other => panic!("not an object: {other:?}"),
    }
}

fn field<'a>(object: &'a Object, key: &str) -> Option<&'a Value> {
    object.get(&Str::from(key))
}

fn has(object: &Object, key: &str) -> bool {
    field(object, key).is_some()
}

fn json(value: &Value) -> String {
    blok_jsjson::stringify(value).expect("stringify")
}

/// JsonNode.DeepEquals: object members compare by key, not order.
fn deep_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.members()
                    .iter()
                    .all(|m| b.get(&m.key).is_some_and(|v| deep_eq(&m.value, v)))
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| deep_eq(a, b))
        }
        (Value::BigInt(a), Value::Number(b)) | (Value::Number(b), Value::BigInt(a)) => {
            *a as f64 == *b
        }
        _ => a == b,
    }
}

fn without_stamps(blocks: &Value) -> Value {
    let Value::Array(blocks) = blocks else {
        return blocks.clone();
    };
    Value::Array(
        blocks
            .iter()
            .map(|block| match block {
                Value::Object(object) => Value::Object(
                    object
                        .members()
                        .iter()
                        .filter(|m| {
                            m.key != Str::from("lastEditedAt") && m.key != Str::from("lastEditedBy")
                        })
                        .map(|m| (m.key.clone(), m.value.clone()))
                        .collect(),
                ),
                other => other.clone(),
            })
            .collect(),
    )
}

async fn blocks(manager: &Manager) -> Value {
    let state = manager.state(DOC).await.expect("state");
    assert_eq!(state.status, StateStatus::Ready, "{:?}", state.err);
    field(&parse(&state.json), "blocks")
        .cloned()
        .expect("blocks")
}

async fn edit(manager: &Manager, op: EditOp, actor: Option<&str>) {
    let digest = canonical_body_digest(std::slice::from_ref(&op)).expect("digest");
    let result = manager
        .edit(
            DOC,
            vec![op],
            &fresh_id(),
            &digest,
            actor.unwrap_or(""),
            None,
        )
        .await
        .expect("edit");
    assert_eq!(result.status, EditStatus::Applied, "{:?}", result.err);
}

async fn reset(manager: &Manager) {
    let result = manager.reset(DOC).await.expect("reset");
    assert_eq!(result.status, ResetStatus::Done, "{:?}", result.err);
}

async fn purge(manager: &Manager) {
    let outcome = manager.purge(DOC, async { Ok(true) }).await.expect("purge");
    assert_eq!(outcome, PurgeOutcome::Purged);
}

async fn restore(
    manager: &Manager,
    lineage: &str,
    sequence: u64,
    operation_id: &str,
    actor: Option<&str>,
    expect: Option<Precondition>,
) -> (HistoryStatus, Option<EditResult>) {
    manager
        .restore(
            DOC,
            lineage,
            sequence,
            operation_id,
            actor.unwrap_or(""),
            expect,
        )
        .await
        .expect("restore")
}

async fn read(manager: &Manager, lineage: &str, sequence: u64) -> HistoryRead {
    manager
        .read_version(DOC, lineage, sequence)
        .await
        .expect("read")
}

async fn changes(manager: &Manager, lineage: &str, sequence: u64, since: u64) -> HistoryChanges {
    manager
        .changes(
            DOC,
            lineage,
            sequence,
            since,
            MAX_CHANGE_RECORDS,
            MAX_CHANGE_BYTES,
        )
        .await
        .expect("changes")
}

fn v2_member() -> Arc<FakeMember> {
    FakeMember::new("", OperationSource::ClientV2, true)
}

async fn join_v2(manager: &Manager, member: &Arc<FakeMember>) -> Joined {
    join_synced(manager, DOC, member).await
}

fn sync_updates(member: &FakeMember) -> usize {
    member
        .messages()
        .iter()
        .filter(|m| matches!(m, Message::SyncUpdate { .. }))
        .count()
}

struct TitleWriter {
    membership: Joined,
    member: Arc<FakeMember>,
    client: Doc,
}

impl TitleWriter {
    async fn new(manager: &Manager) -> TitleWriter {
        let member = v2_member();
        let membership = join(manager, DOC, &member).await;
        let client = new_client();
        receive(
            &membership,
            Message::SyncStep1 {
                state_vector: client.encode_state_vector(),
            },
        )
        .await;
        TitleWriter {
            membership,
            member,
            client,
        }
    }

    async fn write(&self, title: &str) {
        self.write_value("title", Value::String(Str::from(title)))
            .await;
    }

    async fn write_value(&self, key: &str, value: Value) {
        let page = self.client.get_map("page").expect("a map root");
        let update = self
            .client
            .transact(|txn| page.set(txn, key, value))
            .expect("a write")
            .expect("an update");
        let acks = || {
            self.member
                .messages()
                .iter()
                .filter(|m| matches!(m, Message::Acknowledgement { .. }))
                .count()
        };
        let committed = acks();
        send_operation(&self.membership, &self.member, &fresh_id(), update).await;
        assert_eq!(
            acks(),
            committed + 1,
            "the title write was not acknowledged"
        );
    }
}

fn seconds(n: u64) -> std::time::SystemTime {
    UNIX_EPOCH + Duration::from_secs(n)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn without_a_history_store_every_method_answers_no_history() {
    let b = Bench::new();
    for manager in [
        b.manager_over(None, Options::default()),
        b.manager_over(Some(Arc::new(FakeJournal::new())), Options::default()),
    ] {
        assert_eq!(
            manager
                .history(DOC, Duration::ZERO)
                .await
                .expect("list")
                .status,
            HistoryStatus::None
        );
        assert_eq!(read(&manager, "l", 0).await.status, HistoryStatus::None);
        assert_eq!(
            manager.delete_lineage(DOC, "l").await.expect("delete"),
            (HistoryStatus::None, None)
        );
        assert_eq!(
            changes(&manager, "l", 0, 0).await.status,
            HistoryStatus::None
        );
        let (status, edit) = restore(&manager, "l", 0, OP, None, None).await;
        assert_eq!(status, HistoryStatus::None);
        assert!(edit.is_none());
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_list_groups_every_lineage_newest_first() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    let first = b.lineage();
    edit(&manager, update("a", "1"), Some("u1")).await;
    reset(&manager).await;
    let second = b.lineage();
    edit(&manager, update("a", "2"), Some("u2")).await;
    edit(&manager, update("a", "3"), Some("u1")).await;
    reset(&manager).await;
    let third = b.lineage();
    edit(&manager, update("a", "4"), None).await;

    let result = manager.history(DOC, Duration::ZERO).await.expect("list");

    assert_eq!(result.status, HistoryStatus::Ready);
    let lineages: Vec<&str> = result.lineages.iter().map(|l| l.lineage.as_str()).collect();
    assert_eq!(lineages, [first.as_str(), second.as_str(), third.as_str()]);
    let current: Vec<bool> = result.lineages.iter().map(|l| l.current).collect();
    assert_eq!(current, [false, false, true]);
    let versions: Vec<(&str, u64)> = result
        .versions
        .iter()
        .map(|v| (v.lineage.as_str(), v.sequence))
        .collect();
    assert_eq!(
        versions,
        [
            (third.as_str(), 1),
            (third.as_str(), 0),
            (second.as_str(), 2),
            (second.as_str(), 0),
            (first.as_str(), 1),
            (first.as_str(), 0),
        ]
    );
    assert_eq!(result.versions[2].actors, ["u2", "u1"]);
    assert_eq!(result.versions[2].started_at, Some(seconds(1)));
    assert_eq!(result.versions[2].saved_at, Some(seconds(2)));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_group_window_replaces_the_default_grouping() {
    let b = Bench::new();
    *lock(&b.journal.spacing) = Duration::from_secs(90);
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    edit(&manager, update("a", "1"), None).await;
    edit(&manager, update("a", "2"), None).await;
    edit(&manager, update("a", "3"), None).await;

    let by_default = manager.history(DOC, Duration::ZERO).await.expect("list");
    let by_minute = manager
        .history(DOC, Duration::from_secs(60))
        .await
        .expect("list");

    let sequences =
        |list: &HistoryList| -> Vec<u64> { list.versions.iter().map(|v| v.sequence).collect() };
    assert_eq!(sequences(&by_default), [3, 0]);
    assert_eq!(sequences(&by_minute), [3, 2, 1, 0]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_read_answers_the_export_at_that_point_with_its_time() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    let at_zero = blocks(&manager).await;
    edit(&manager, update("a", "two"), None).await;
    let at_one = blocks(&manager).await;
    edit(&manager, insert("b", "three", "a"), None).await;
    let at_two = blocks(&manager).await;
    let lineage = b.lineage();

    for (sequence, expected) in [(0, at_zero), (1, at_one), (2, at_two)] {
        let read = read(&manager, &lineage, sequence).await;

        assert_eq!(read.status, HistoryStatus::Ready);
        let body = parse(&read.json);
        let got = field(&body, "blocks").expect("blocks");
        assert!(deep_eq(&expected, got), "point {sequence}: {}", json(got));
        let millis = (sequence * 1000) as f64;
        assert!(
            field(&body, "time").is_some_and(|t| deep_eq(t, &Value::Number(millis))),
            "point {sequence}: time {:?}",
            field(&body, "time")
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn changes_list_each_record_after_since_through_the_point_oldest_first() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    edit(&manager, update("a", "two"), Some("u1")).await;
    edit(&manager, insert("b", "three", "a"), Some("u2")).await;
    edit(&manager, remove("a"), None).await;
    let lineage = b.lineage();

    let all = changes(&manager, &lineage, 3, 0).await;
    let from_one = changes(&manager, &lineage, 3, 1).await;

    assert_eq!(all.status, HistoryStatus::Ready);
    assert!(!all.truncated);
    let sequences: Vec<u64> = all.changes.iter().map(|c| c.sequence).collect();
    assert_eq!(sequences, [1, 2, 3]);
    let actors: Vec<Option<&str>> = all.changes.iter().map(|c| c.actor_id.as_deref()).collect();
    assert_eq!(actors, [Some("u1"), Some("u2"), None]);
    assert_eq!(all.changes[1].committed_at, seconds(2));
    let kinds: Vec<Vec<(String, BlockChangeKind)>> = all
        .changes
        .iter()
        .map(|c| {
            c.blocks
                .iter()
                .map(|b| (b.id.to_string(), b.kind))
                .collect()
        })
        .collect();
    assert_eq!(
        kinds,
        [
            vec![("a".to_owned(), BlockChangeKind::Changed)],
            vec![("b".to_owned(), BlockChangeKind::Added)],
            vec![("a".to_owned(), BlockChangeKind::Removed)],
        ]
    );
    assert_eq!(before_text(&all.changes[2]), r#"[{"text":"two"}]"#);
    let from: Vec<u64> = from_one.changes.iter().map(|c| c.sequence).collect();
    assert_eq!(from, [2, 3]);
}

fn before_text(change: &RecordChanges) -> String {
    let before = change.blocks[0].before.as_ref().expect("a before");
    let Some(Value::Object(data)) = field(before, "data") else {
        panic!("no data in {before:?}");
    };
    json(field(data, "text").expect("a text"))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn changes_of_an_empty_range_are_empty() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    edit(&manager, update("a", "two"), None).await;

    for (sequence, since) in [(0, 0), (1, 1)] {
        let result = changes(&manager, &b.lineage(), sequence, since).await;

        assert_eq!(result.status, HistoryStatus::Ready);
        assert!(result.changes.is_empty());
        assert!(!result.truncated);
    }
}

async fn three_edits() -> (Bench, Manager) {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    edit(&manager, update("a", "two"), None).await;
    edit(&manager, insert("b", "three", "a"), None).await;
    edit(&manager, remove("a"), None).await;
    (b, manager)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn changes_past_the_cap_are_the_newest_and_say_so() {
    let (b, manager) = three_edits().await;

    let result = manager
        .changes(DOC, &b.lineage(), 3, 0, 2, MAX_CHANGE_BYTES)
        .await
        .expect("changes");

    assert_eq!(result.status, HistoryStatus::Ready);
    assert!(result.truncated);
    let sequences: Vec<u64> = result.changes.iter().map(|c| c.sequence).collect();
    assert_eq!(sequences, [2, 3]);
    assert_eq!(result.changes[0].blocks.len(), 1);
    assert_eq!(result.changes[0].blocks[0].kind, BlockChangeKind::Added);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn changes_past_the_byte_budget_are_the_newest_and_say_so() {
    let (b, manager) = three_edits().await;

    let result = manager
        .changes(DOC, &b.lineage(), 3, 0, MAX_CHANGE_RECORDS, 1)
        .await
        .expect("changes");

    assert_eq!(result.status, HistoryStatus::Ready);
    assert!(result.truncated);
    let sequences: Vec<u64> = result.changes.iter().map(|c| c.sequence).collect();
    assert_eq!(sequences, [3]);
    assert_eq!(before_text(&result.changes[0]), r#"[{"text":"two"}]"#);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn changes_of_an_unknown_point_are_not_found() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    edit(&manager, update("a", "two"), None).await;

    assert_eq!(
        changes(&manager, &b.lineage(), 2, 0).await.status,
        HistoryStatus::NotFound
    );
    assert_eq!(
        changes(&manager, &"f".repeat(32), 0, 0).await.status,
        HistoryStatus::NotFound
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_baseline_with_an_unknown_created_at_has_no_time() {
    let b = Bench::new();
    b.journal.unknown_created_at.store(true, Ordering::SeqCst);
    let manager = b.manager(Options::default());
    blocks(&manager).await;

    let read = read(&manager, &b.lineage(), 0).await;

    assert_eq!(read.status, HistoryStatus::Ready);
    assert!(!has(&parse(&read.json), "time"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_version_read_carries_the_page_maps_and_omits_empty_ones() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    let titles = TitleWriter::new(&manager).await;
    titles.write("Old").await;
    titles.write("New").await;

    let old = parse(&read(&manager, &b.lineage(), 1).await.json);
    let baseline = parse(&read(&manager, &b.lineage(), 0).await.json);

    assert_eq!(field(&old, "title"), Some(&Value::String(Str::from("Old"))));
    assert!(!has(&old, "page"));
    assert!(!has(&old, "values"));
    assert!(!has(&baseline, "page"));
    assert!(!has(&baseline, "values"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_version_read_skips_an_icon_that_is_not_json() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    let writer = TitleWriter::new(&manager).await;
    let mut icon = Object::new();
    icon.set(Str::from("type"), Value::String(Str::from("emoji")));
    icon.set(Str::from("value"), Value::String(Str::from("x")));
    icon.set(Str::from("raw"), Value::Bytes(vec![1, 2]));
    writer.write("Plan").await;
    writer.write_value("icon", Value::Object(icon)).await;

    let read = read(&manager, &b.lineage(), 2).await;

    assert_eq!(read.status, HistoryStatus::Ready);
    let body = parse(&read.json);
    assert_eq!(
        field(&body, "title"),
        Some(&Value::String(Str::from("Plan")))
    );
    assert!(!has(&body, "icon"));
    assert!(!has(&body, "page"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_unknown_point_is_not_found() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    edit(&manager, update("a", "two"), None).await;

    assert_eq!(
        read(&manager, &b.lineage(), 2).await.status,
        HistoryStatus::NotFound
    );
    assert_eq!(
        read(&manager, &"f".repeat(32), 0).await.status,
        HistoryStatus::NotFound
    );
    let (status, edit) = restore(&manager, &b.lineage(), 2, OP, None, None).await;
    assert_eq!(status, HistoryStatus::NotFound);
    assert!(edit.is_none());
    assert_eq!(b.committed().len(), 1);
}

async fn assert_purged_everywhere(manager: &Manager, lineage: &str) {
    assert_eq!(
        manager
            .history(DOC, Duration::ZERO)
            .await
            .expect("list")
            .status,
        HistoryStatus::Purged
    );
    assert_eq!(
        read(manager, lineage, 0).await.status,
        HistoryStatus::Purged
    );
    assert_eq!(
        manager
            .delete_lineage(DOC, lineage)
            .await
            .expect("delete")
            .0,
        HistoryStatus::Purged
    );
    assert_eq!(
        restore(manager, lineage, 0, OP, None, None).await.0,
        HistoryStatus::Purged
    );
    assert_eq!(
        changes(manager, lineage, 0, 0).await.status,
        HistoryStatus::Purged
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_purged_document_answers_purged_from_every_method() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    let lineage = b.lineage();
    purge(&manager).await;

    assert_purged_everywhere(&manager, &lineage).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_fresh_manager_sees_a_purge_from_an_earlier_process() {
    let b = Bench::new();
    let earlier = b.manager(Options::default());
    blocks(&earlier).await;
    let lineage = b.lineage();
    purge(&earlier).await;
    let manager = b.manager(Options::default());

    assert_purged_everywhere(&manager, &lineage).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_unreadable_lineage_list_is_corrupt() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    b.journal.fail_listings.store(true, Ordering::SeqCst);

    assert_eq!(
        manager
            .history(DOC, Duration::ZERO)
            .await
            .expect("list")
            .status,
        HistoryStatus::Corrupt
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_corrupt_record_is_corrupt() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    edit(&manager, update("a", "two"), None).await;
    let lineage = b.lineage();
    *lock(&b.journal.corrupt) = Some(1);

    assert_eq!(
        read(&manager, &lineage, 1).await.status,
        HistoryStatus::Corrupt
    );
    assert_eq!(
        read(&manager, &lineage, 0).await.status,
        HistoryStatus::Ready
    );
    assert_eq!(
        restore(&manager, &lineage, 1, OP, None, None).await.0,
        HistoryStatus::Corrupt
    );
    assert_eq!(
        changes(&manager, &lineage, 1, 0).await.status,
        HistoryStatus::Corrupt
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_restore_makes_the_live_document_equal_the_point_as_one_journalled_edit() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    edit(&manager, update("a", "A"), None).await;
    let point_a = blocks(&manager).await;
    edit(&manager, insert("b", "B", "a"), None).await;
    edit(&manager, remove("a"), None).await;
    let lineage = b.lineage();

    let (status, result) = restore(&manager, &lineage, 1, OP_RESTORE, Some("u9"), None).await;

    assert_eq!(status, HistoryStatus::Ready);
    let result = result.expect("an edit");
    assert_eq!(result.status, EditStatus::Applied, "{:?}", result.err);
    assert_eq!(result.receipt.expect("a receipt").server_sequence, 4);
    let live = blocks(&manager).await;
    assert!(
        deep_eq(&without_stamps(&point_a), &without_stamps(&live)),
        "{}",
        json(&live)
    );
    let record = b.committed().pop().expect("a record");
    assert_eq!(record.sequence, 4);
    assert_eq!(record.operation_id, OP_RESTORE);
    assert_eq!(record.actor_id.as_deref(), Some("u9"));
    assert_eq!(record.source, Source::HTTP_EDIT);
    assert_eq!(
        record.digest,
        Sha256::digest(format!("restore\n{lineage}\n1")).to_vec()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_preview_with_trash_counts_the_restorer_in_its_frame() {
    let b = Bench::new();
    let manager = b.manager(Options {
        restore_trashes_pages: true,
        ..Options::default()
    });
    blocks(&manager).await;
    let page = EditOp::Insert {
        id: Str::from("pg"),
        block: node(r#"{"type":"page","data":{"pageId":"sub"}}"#),
        after: Some(Str::from("a")),
        parent: None,
    };
    edit(&manager, page, None).await;
    let lineage = b.lineage();
    let frame = async |actor: &str| {
        let (_, preview, _) = manager
            .preview_restore(DOC, &lineage, 0, None, actor)
            .await
            .expect("preview");
        preview.expect("a preview").frame_bytes
    };

    let (short, long) = (frame("u").await, frame(&"u".repeat(200)).await);

    assert!(long > short, "{short} vs {long}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_restore_removes_a_later_page_pointer_by_default() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    let page = EditOp::Insert {
        id: Str::from("pg"),
        block: node(r#"{"type":"page","data":{"pageId":"sub"}}"#),
        after: Some(Str::from("a")),
        parent: None,
    };
    edit(&manager, page, None).await;

    let (_, result) = restore(&manager, &b.lineage(), 0, OP_RESTORE, Some("u9"), None).await;

    let result = result.expect("an edit");
    assert_eq!(result.status, EditStatus::Applied, "{:?}", result.err);
    let live = blocks(&manager).await;
    assert!(!json(&live).contains(r#""id":"pg""#), "{}", json(&live));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_restore_trashes_a_page_pointer_added_after_the_point() {
    let b = Bench::new();
    let manager = b.manager(Options {
        now: Some(Arc::new(|| seconds(1_700_000_999))),
        restore_trashes_pages: true,
        ..Options::default()
    });
    blocks(&manager).await;
    let page = EditOp::Insert {
        id: Str::from("pg"),
        block: node(r#"{"type":"page","data":{"pageId":"sub"}}"#),
        after: Some(Str::from("a")),
        parent: None,
    };
    edit(&manager, page, None).await;

    let (_, result) = restore(&manager, &b.lineage(), 0, OP_RESTORE, Some("u9"), None).await;

    let result = result.expect("an edit");
    assert_eq!(result.status, EditStatus::Applied, "{:?}", result.err);
    let live = blocks(&manager).await;
    let Value::Array(items) = &live else {
        panic!("{}", json(&live))
    };
    let pointer = items
        .iter()
        .find_map(|item| match item {
            Value::Object(block) if field(block, "id") == Some(&Value::String(Str::from("pg"))) => {
                Some(block)
            }
            _ => None,
        })
        .unwrap_or_else(|| panic!("no pointer in {}", json(&live)));
    let Some(Value::Object(data)) = field(pointer, "data") else {
        panic!("{}", json(&live))
    };
    assert_eq!(
        field(data, "trashed").map(json).as_deref(),
        Some(r#"{"at":1700000999000,"by":"u9","formerParentId":null,"formerIndex":1}"#)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_restore_reaches_a_lineage_a_reset_replaced() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    edit(&manager, update("a", "old"), None).await;
    let old = blocks(&manager).await;
    let lineage = b.lineage();
    reset(&manager).await;

    let (_, result) = restore(&manager, &lineage, 1, OP, None, None).await;

    let result = result.expect("an edit");
    assert_eq!(result.status, EditStatus::Applied, "{:?}", result.err);
    assert!(deep_eq(
        &without_stamps(&old),
        &without_stamps(&blocks(&manager).await)
    ));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_retried_restore_gets_the_first_receipt() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    edit(&manager, update("a", "A"), None).await;
    edit(&manager, update("a", "B"), None).await;
    let lineage = b.lineage();
    let (_, first) = restore(&manager, &lineage, 1, OP_RESTORE, None, None).await;
    edit(&manager, update("a", "C"), None).await;

    let (_, retry) = restore(&manager, &lineage, 1, OP_RESTORE, None, None).await;

    let retry = retry.expect("an edit");
    assert_eq!(retry.status, EditStatus::Applied, "{:?}", retry.err);
    assert_eq!(
        first
            .expect("an edit")
            .receipt
            .expect("a receipt")
            .server_sequence,
        retry.receipt.expect("a receipt").server_sequence
    );
    assert_eq!(b.committed().len(), 4);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_retry_after_its_lineage_was_deleted_gets_the_first_receipt() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    edit(&manager, update("a", "old"), None).await;
    let old = b.lineage();
    reset(&manager).await;
    let (_, first) = restore(&manager, &old, 1, OP_RESTORE, None, None).await;
    let first = first.expect("an edit");
    assert_eq!(first.status, EditStatus::Applied, "{:?}", first.err);
    assert_eq!(
        manager.delete_lineage(DOC, &old).await.expect("delete"),
        (HistoryStatus::Ready, Some(LineageDeleteOutcome::Deleted))
    );

    let (retry_status, retry) = restore(&manager, &old, 1, OP_RESTORE, None, None).await;
    let (fresh_status, fresh) = restore(&manager, &old, 1, OP_OTHER, None, None).await;

    assert_eq!(retry_status, HistoryStatus::Ready);
    let retry = retry.expect("an edit");
    assert_eq!(retry.status, EditStatus::Applied, "{:?}", retry.err);
    assert_eq!(
        first.receipt.expect("a receipt").server_sequence,
        retry.receipt.expect("a receipt").server_sequence
    );
    assert_eq!(fresh_status, HistoryStatus::NotFound);
    assert!(fresh.is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_gate_measures_the_frame_the_live_apply_broadcasts() {
    let converter = runtime_converter();
    let live = Doc::new(blok_yjs::Options::default());
    Converter::seed(&converter, &live, &node(&document(&[("a", "one")])))
        .await
        .expect("seed");
    for round in 0..20u8 {
        let text = char::from(b'a' + round).to_string().repeat(1000);
        Converter::apply_ops(&converter, &live, &[update("a", &text)])
            .await
            .expect("a rewrite");
    }
    let ops: Vec<EditOp> = (0..40)
        .map(|i| {
            let after = if i == 0 {
                "a".to_owned()
            } else {
                format!("n{}", i - 1)
            };
            insert(&format!("n{i}"), &format!("text {i}"), &after)
        })
        .collect();

    let measured = planned_frame_bytes(&live, &converter, &ops)
        .await
        .expect("measured");
    let broadcast = Arc::new(Mutex::new(0i64));
    let counted = broadcast.clone();
    let subscription = live.on_update(move |event| {
        let frame = blok_collab_wire::encode(&Message::SyncUpdate {
            update: event.update.clone(),
        })
        .expect("a frame");
        *lock(&counted) += frame.len() as i64;
    });
    Converter::apply_ops(&converter, &live, &ops)
        .await
        .expect("the apply");
    subscription.unsubscribe();

    assert_eq!(*lock(&broadcast), measured);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn document_replaced_fires_on_a_reset_an_applied_restore_and_a_purge_only() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    let fired = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = fired.clone();
    manager.on_document_replaced(move |doc| lock(&sink).push(doc.to_owned()));
    blocks(&manager).await;
    edit(&manager, update("a", "A"), None).await;
    edit(&manager, update("a", "B"), None).await;
    let lineage = b.lineage();
    let fired_now = || lock(&fired).clone();

    assert!(fired_now().is_empty());
    assert_eq!(
        restore(&manager, &lineage, 9, OP_MISSING, None, None)
            .await
            .0,
        HistoryStatus::NotFound
    );
    let (_, stale) = restore(
        &manager,
        &lineage,
        1,
        OP_STALE,
        None,
        Some(Precondition {
            lineage: lineage.clone(),
            sequence: 1,
        }),
    )
    .await;
    assert_eq!(
        stale.expect("an edit").status,
        EditStatus::PreconditionFailed
    );
    assert!(fired_now().is_empty());

    let (_, applied) = restore(&manager, &lineage, 1, OP_RESTORE, None, None).await;
    assert_eq!(applied.expect("an edit").status, EditStatus::Applied);
    assert_eq!(fired_now(), [DOC]);

    reset(&manager).await;
    assert_eq!(fired_now(), [DOC, DOC]);

    purge(&manager).await;
    assert_eq!(fired_now(), [DOC, DOC, DOC]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_stale_precondition_refuses_the_restore() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    edit(&manager, update("a", "A"), None).await;
    let lineage = b.lineage();

    let (status, result) = restore(
        &manager,
        &lineage,
        0,
        OP,
        None,
        Some(Precondition {
            lineage: lineage.clone(),
            sequence: 0,
        }),
    )
    .await;

    assert_eq!(status, HistoryStatus::Ready);
    let result = result.expect("an edit");
    assert_eq!(result.status, EditStatus::PreconditionFailed);
    assert_eq!(result.receipt.expect("a receipt").server_sequence, 1);
    assert_eq!(b.committed().len(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_stale_precondition_wins_over_a_missing_point() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    edit(&manager, update("a", "A"), None).await;
    let lineage = b.lineage();

    let (status, result) = restore(
        &manager,
        &lineage,
        9,
        OP,
        None,
        Some(Precondition {
            lineage: lineage.clone(),
            sequence: 0,
        }),
    )
    .await;

    assert_eq!(status, HistoryStatus::Ready);
    assert_eq!(
        result.expect("an edit").status,
        EditStatus::PreconditionFailed
    );
    assert_eq!(b.committed().len(), 1);
}

fn limited(bytes: i64) -> Options {
    Options {
        announced_max_message_bytes: bytes,
        ..Options::default()
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_restore_too_large_for_one_frame_changes_nothing() {
    let b = Bench::new();
    let manager = b.manager(limited(2048));
    blocks(&manager).await;
    let member = v2_member();
    let _membership = join_v2(&manager, &member).await;
    edit(&manager, insert("big", &"x".repeat(8192), "a"), None).await;
    edit(&manager, remove("big"), None).await;
    let before = blocks(&manager).await;
    let frames = sync_updates(&member);

    let (_, result) = restore(&manager, &b.lineage(), 1, OP, None, None).await;

    assert_eq!(result.expect("an edit").status, EditStatus::TooLarge);
    assert_eq!(b.committed().len(), 2);
    assert_eq!(sync_updates(&member), frames);
    assert!(deep_eq(&before, &blocks(&manager).await));
    assert!(member.closed().is_empty());
}

struct RecordingReader {
    inner: &'static blok_collab_convert::RuntimeHtmlReader<blok_jsruntime::Pool>,
    largest: Arc<Mutex<usize>>,
}

impl HtmlReader for RecordingReader {
    async fn read(
        &self,
        fields: &[RichTextHtml],
        timeout: Option<Duration>,
    ) -> Result<Vec<Vec<Value>>, blok_collab_convert::Error> {
        let longest = fields.iter().map(|f| f.html.len()).max().unwrap_or(0);
        {
            let mut largest = lock(&self.largest);
            *largest = (*largest).max(longest);
        }
        self.inner.read(fields, timeout).await
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_restore_past_the_store_limit_but_under_the_message_limit_is_refused_and_the_room_stays_open()
 {
    const MIB: usize = 1 << 20;
    let b = Bench::new();
    let dir = TempDir::new();
    let local = blok_collab_journal::Store::new(dir.path(), StoreOptions::default())
        .expect("the journal opens");
    let max_update_bytes = local.max_update_bytes();
    let largest = Arc::new(Mutex::new(0usize));
    let converter = DocConverter {
        now: Box::new(std::time::SystemTime::now),
        html: RecordingReader {
            inner: runtime_reader(),
            largest: largest.clone(),
        },
        fields: None,
        log: None,
    };
    let manager = b.manager_with(
        Some(Arc::new(LocalJournal(local))),
        Options {
            announced_max_message_bytes: 4 * MIB as i64,
            max_update_bytes,
            ..Options::default()
        },
        Arc::new(converter),
    );
    blocks(&manager).await;
    let member = v2_member();
    let _membership = join_v2(&manager, &member).await;
    edit(
        &manager,
        insert_segments("b1", &"x".repeat(MIB / 2), "a"),
        None,
    )
    .await;
    edit(
        &manager,
        insert_segments("b2", &"y".repeat(MIB / 2), "b1"),
        None,
    )
    .await;
    edit(
        &manager,
        insert_segments("b3", &"z".repeat(MIB / 2), "b2"),
        None,
    )
    .await;
    let removes = vec![remove("b1"), remove("b2"), remove("b3")];
    let digest = canonical_body_digest(&removes).expect("digest");
    let result = manager
        .edit(DOC, removes, &fresh_id(), &digest, "", None)
        .await
        .expect("edit");
    assert_eq!(result.status, EditStatus::Applied, "{:?}", result.err);
    let list = manager.history(DOC, Duration::ZERO).await.expect("list");
    let lineage = list.lineages.last().expect("a lineage").lineage.clone();

    let (_, restore) = restore(&manager, &lineage, 3, &fresh_id(), None, None).await;

    assert_eq!(restore.expect("an edit").status, EditStatus::TooLarge);
    assert!(member.closed().is_empty());
    edit(&manager, update("a", "after"), None).await;
    assert!(member.closed().is_empty());
    assert!(*lock(&largest) <= 64, "largest HTML {}", *lock(&largest));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_restore_just_under_the_frame_limit_is_applied() {
    const LIMIT: usize = 2048;
    let b = Bench::new();
    let manager = b.manager(limited(LIMIT as i64));
    blocks(&manager).await;
    edit(
        &manager,
        insert("big", &"x".repeat(BORDERLINE_TEXT), "a"),
        None,
    )
    .await;
    edit(&manager, remove("big"), None).await;

    let (_, result) = restore(&manager, &b.lineage(), 1, OP, None, None).await;

    let result = result.expect("an edit");
    assert_eq!(result.status, EditStatus::Applied, "{:?}", result.err);
    let update = b.committed().pop().expect("a record").update;
    let frame = blok_collab_wire::encode(&Message::SyncUpdate { update })
        .expect("a frame")
        .len();
    assert!(
        (LIMIT - 64..=LIMIT).contains(&frame),
        "the restore frame is {frame} bytes"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_restore_of_the_current_point_writes_nothing() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    edit(&manager, update("a", "A"), None).await;
    edit(&manager, insert("b", "B", "a"), None).await;

    let (_, result) = restore(&manager, &b.lineage(), 2, OP, None, None).await;

    let result = result.expect("an edit");
    assert_eq!(result.status, EditStatus::Applied, "{:?}", result.err);
    assert_eq!(result.receipt.expect("a receipt").server_sequence, 2);
    assert_eq!(b.committed().len(), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_restore_brings_back_the_title_with_the_blocks_in_one_record() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    let titles = TitleWriter::new(&manager).await;
    titles.write("Old").await;
    edit(&manager, update("a", "A"), None).await;
    let point = blocks(&manager).await;
    titles.write("New").await;
    edit(&manager, update("a", "B"), None).await;

    let (_, result) = restore(&manager, &b.lineage(), 2, OP_RESTORE, None, None).await;

    let result = result.expect("an edit");
    assert_eq!(result.status, EditStatus::Applied, "{:?}", result.err);
    assert_eq!(result.receipt.expect("a receipt").server_sequence, 5);
    assert_eq!(b.committed().len(), 5);
    let live = b.journal.replay(5);
    let title = live.get_map("page").expect("a page map").get("title");
    assert!(
        matches!(&title, Some(Out::Any(Value::String(s))) if *s == Str::from("Old")),
        "title {title:?}"
    );
    assert!(deep_eq(
        &without_stamps(&point),
        &without_stamps(&blocks(&manager).await)
    ));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_restore_whose_title_is_too_large_for_one_frame_changes_nothing() {
    let b = Bench::new();
    let manager = b.manager(limited(2048));
    blocks(&manager).await;
    let titles = TitleWriter::new(&manager).await;
    titles.write(&"x".repeat(8192)).await;
    titles.write("short").await;
    let before = blocks(&manager).await;

    let (_, result) = restore(&manager, &b.lineage(), 1, OP, None, None).await;

    assert_eq!(result.expect("an edit").status, EditStatus::TooLarge);
    assert_eq!(b.committed().len(), 2);
    assert!(titles.member.closed().is_empty());
    assert!(deep_eq(&before, &blocks(&manager).await));
    edit(&manager, update("a", "after"), None).await;
    assert!(titles.member.closed().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_delete_refuses_the_current_lineage_and_removes_an_old_one() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    let old = b.lineage();
    reset(&manager).await;

    let delete = |lineage: String| {
        let manager = manager.clone();
        async move { manager.delete_lineage(DOC, &lineage).await.expect("delete") }
    };
    assert_eq!(
        delete(b.lineage()).await,
        (HistoryStatus::Ready, Some(LineageDeleteOutcome::Current))
    );
    assert_eq!(
        delete(old.clone()).await,
        (HistoryStatus::Ready, Some(LineageDeleteOutcome::Deleted))
    );
    assert_eq!(
        delete(old.clone()).await,
        (HistoryStatus::Ready, Some(LineageDeleteOutcome::NotFound))
    );
    let listed = manager.history(DOC, Duration::ZERO).await.expect("list");
    assert!(listed.lineages.iter().all(|l| l.lineage != old));
}

// Changes by time range: one budget across lineages.

fn whole_time() -> (std::time::SystemTime, std::time::SystemTime) {
    (
        blok_dotnet::time_from_ticks(0),
        blok_dotnet::time_from_ticks(3_155_378_975_999_999_999),
    )
}

// Two lineages whose rows together pass the byte cap: the older lineage
// replays with what the newer one left, so the answer stops at the cap.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn changes_between_keeps_one_byte_budget_across_lineages() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    edit(&manager, update("a", "old one"), None).await;
    edit(&manager, update("a", "old two"), None).await;
    reset(&manager).await;
    blocks(&manager).await;
    edit(&manager, update("a", "new one"), None).await;
    let current = b.lineage();
    let (from, to) = whole_time();
    let all = manager
        .changes_between(DOC, from, to, None, MAX_CHANGE_RECORDS, MAX_CHANGE_BYTES)
        .await
        .expect("all");
    assert_eq!((all.records.len(), all.truncated), (3, false));
    let budget = record_bytes(&all.records[0].changes) + record_bytes(&all.records[1].changes) / 2;

    let result = manager
        .changes_between(DOC, from, to, None, MAX_CHANGE_RECORDS, budget)
        .await
        .expect("cut");

    assert!(result.truncated);
    let lineages: Vec<&str> = result.records.iter().map(|r| r.lineage.as_str()).collect();
    assert_eq!(lineages, [current.as_str()]);
}

// A lineage cut by its own replay ends the answer: an older lineage that
// would still fit must not follow it, or the cut rows would be skipped.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn changes_between_stops_at_a_lineage_its_own_replay_cut() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    edit(&manager, update("a", "s"), None).await;
    reset(&manager).await;
    blocks(&manager).await;
    edit(&manager, update("a", &"x".repeat(1000)), None).await;
    edit(&manager, update("a", &"y".repeat(1000)), None).await;
    let current = b.lineage();
    let (from, to) = whole_time();
    let all = manager
        .changes_between(DOC, from, to, None, MAX_CHANGE_RECORDS, MAX_CHANGE_BYTES)
        .await
        .expect("all");
    assert_eq!(all.records.len(), 3);
    let budget = record_bytes(&all.records[0].changes) + record_bytes(&all.records[2].changes);

    let result = manager
        .changes_between(DOC, from, to, None, MAX_CHANGE_RECORDS, budget)
        .await
        .expect("cut");

    assert!(result.truncated);
    let rows: Vec<(&str, u64)> = result
        .records
        .iter()
        .map(|r| (r.lineage.as_str(), r.changes.sequence))
        .collect();
    assert_eq!(rows, [(current.as_str(), 2)]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn changes_between_reads_at_most_eight_lineages() {
    let b = Bench::new();
    let manager = b.manager(Options::default());
    blocks(&manager).await;
    let mut lineages = Vec::new();
    for i in 0..=MAX_RANGE_LINEAGES {
        if i > 0 {
            reset(&manager).await;
            blocks(&manager).await;
        }
        edit(&manager, update("a", &format!("v{i}")), None).await;
        lineages.push(b.lineage());
    }
    let (from, to) = whole_time();

    let result = manager
        .changes_between(DOC, from, to, None, MAX_CHANGE_RECORDS, MAX_CHANGE_BYTES)
        .await
        .expect("range");

    assert!(result.truncated);
    let got: Vec<&str> = result.records.iter().map(|r| r.lineage.as_str()).collect();
    let want: Vec<&str> = lineages[1..].iter().rev().map(String::as_str).collect();
    assert_eq!(got, want);
}

// Twins of C# CollabHistoryManagerTests.Notes.

struct FailingNotes;

impl RecordNotesStore for FailingNotes {
    fn write<'a>(
        &'a self,
        _doc_id: &'a str,
        _lineage: &'a str,
        _sequence: u64,
        _note: RecordNote,
    ) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async { Err(Error::message("the notes are down")) })
    }

    fn read<'a>(
        &'a self,
        _doc_id: &'a str,
        _lineage: &'a str,
    ) -> BoxFuture<'a, Result<std::collections::HashMap<u64, RecordNote>, Error>> {
        Box::pin(async { Err(Error::message("the notes are down")) })
    }
}

impl Bench {
    fn noted(
        &self,
        notes: Arc<dyn RecordNotesStore>,
        logs: Option<Arc<Mutex<Vec<String>>>>,
    ) -> Manager {
        Manager::new(ManagerOptions {
            store: self.store.clone(),
            endpoint: self.endpoint.clone(),
            converter: Arc::new(runtime_converter()),
            room: Options::default(),
            log: logs.map(|logs| -> Log {
                Arc::new(move |line: &str| logs.lock().unwrap().push(line.to_owned()))
            }),
            operations: Some(self.journal.clone()),
            activity: None,
            notes: Some(notes),
        })
    }
}

fn person() -> RecordNote {
    RecordNote {
        kind: KIND_PERSON.to_owned(),
        on_behalf_of: None,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn each_journalled_edit_leaves_a_note_of_its_actors_kind_never_read_from_the_ids_text() {
    let bench = Bench::new();
    let notes = Arc::new(MemoryRecordNotes::default());
    let manager = bench.noted(notes.clone(), None);
    blocks(&manager).await;
    edit(&manager, update("a", "1"), Some("u1")).await;
    edit(&manager, update("a", "2"), Some("agent:alice:claude-code")).await;
    edit(&manager, update("a", "3"), None).await;

    let written = notes.read(DOC, &bench.lineage()).await.unwrap();
    assert_eq!(written.get(&1), Some(&person()));
    assert_eq!(written.get(&2), Some(&person()));
    assert_eq!(written.get(&3), None);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_agent_edit_notes_the_agent_and_its_person() {
    let bench = Bench::new();
    let notes = Arc::new(MemoryRecordNotes::default());
    let manager = bench.noted(notes.clone(), None);
    blocks(&manager).await;
    let op = update("a", "by an agent");
    let digest = canonical_body_digest(std::slice::from_ref(&op)).expect("digest");
    let plan: PlanOps = Arc::new(move |_| {
        let op = op.clone();
        Box::pin(async move { Ok(vec![op]) })
    });
    let result = manager
        .agent_edit(
            DOC,
            plan,
            &fresh_id(),
            &digest,
            "bot-7",
            None,
            None,
            classify_actor("bot-7", true, "carol"),
        )
        .await
        .expect("edit");
    assert_eq!(result.status, EditStatus::Applied, "{:?}", result.err);
    let written = notes.read(DOC, &bench.lineage()).await.unwrap();
    assert_eq!(
        written.get(&1),
        Some(&RecordNote {
            kind: KIND_AGENT.to_owned(),
            on_behalf_of: Some("carol".to_owned()),
        })
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_list_carries_actor_kinds_only_with_a_record_notes_store() {
    let bench = Bench::new();
    let manager = bench.noted(Arc::new(MemoryRecordNotes::default()), None);
    blocks(&manager).await;
    edit(&manager, update("a", "1"), Some("u1")).await;
    edit(&manager, update("a", "2"), Some("agent:u1:cursor")).await;

    let noted = manager.history(DOC, Duration::ZERO).await.unwrap();
    assert_eq!(
        noted.versions[0].actor_kinds,
        Some(vec![
            ActorKind {
                id: "u1".to_owned(),
                note: person()
            },
            ActorKind {
                id: "agent:u1:cursor".to_owned(),
                note: person()
            },
        ])
    );
    assert_eq!(noted.versions[1].actor_kinds, Some(Vec::new()));
    let plain = bench
        .manager(Options::default())
        .history(DOC, Duration::ZERO)
        .await
        .unwrap();
    assert!(
        plain
            .versions
            .iter()
            .all(|version| version.actor_kinds.is_none())
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn by_actor_starts_a_version_when_the_actor_changes() {
    let bench = Bench::new();
    let manager = bench.manager(Options::default());
    blocks(&manager).await;
    edit(&manager, update("a", "1"), Some("u1")).await;
    edit(&manager, update("a", "2"), Some("u1")).await;
    edit(&manager, update("a", "3"), Some("u2")).await;

    let sequences = |list: HistoryList| -> Vec<u64> {
        list.versions
            .iter()
            .map(|version| version.sequence)
            .collect()
    };
    assert_eq!(
        sequences(manager.history(DOC, Duration::ZERO).await.unwrap()),
        [3, 0]
    );
    assert_eq!(
        sequences(manager.history_by(DOC, Duration::ZERO, true).await.unwrap()),
        [3, 2, 0]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_note_that_fails_never_fails_the_edit() {
    let bench = Bench::new();
    let logs = Arc::new(Mutex::new(Vec::new()));
    let manager = bench.noted(Arc::new(FailingNotes), Some(logs.clone()));
    blocks(&manager).await;
    edit(&manager, update("a", "kept"), Some("u1")).await;

    assert_eq!(bench.committed().len(), 1);
    assert!(
        logs.lock()
            .unwrap()
            .iter()
            .any(|line| line.contains("record note")),
        "{:?}",
        logs.lock().unwrap()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_restore_is_noted_as_its_restorer() {
    let bench = Bench::new();
    let notes = Arc::new(MemoryRecordNotes::default());
    let manager = bench.noted(notes.clone(), None);
    blocks(&manager).await;
    edit(&manager, update("a", "1"), Some("u1")).await;
    let lineage = bench.lineage();

    let (status, edit) = restore(&manager, &lineage, 0, &fresh_id(), Some("u2"), None).await;
    assert_eq!(status, HistoryStatus::Ready);
    assert_eq!(edit.map(|edit| edit.status), Some(EditStatus::Applied));
    assert_eq!(
        notes.read(DOC, &lineage).await.unwrap().get(&2),
        Some(&person())
    );
}

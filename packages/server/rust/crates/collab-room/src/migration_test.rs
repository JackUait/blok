use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use base64::Engine as _;
use blok_collab::JoinStatus;
use blok_collab_convert::{
    DocConverter, HtmlReader, RichTextFields, RichTextHtml, RuntimeHtmlReader,
};
use blok_collab_operation::{Candidate, Source};
use blok_collab_wire::Message;
use blok_collab_workingset::{CURRENT_FORMAT, HTML_RICH_TEXT_FORMAT, Tag, is_lineage};
use blok_jsjson::{Str, Value};
use blok_jsruntime::{Failure, InvokeError, Kind, Pool};
use blok_yjs::{Doc, Out, Outcome};

use crate::test_support::*;
use crate::*;

// Twins of C# CollabRoomMigrationTests: a format-1 room is migrated once,
// in place, under a new lineage. The room is the collab-format1
// "rich-marks" fixture; the migrated export is the one C# captured in
// collab-migrations/cases.json, read by both sides.

const MIGRATION_ROOM: &str = "rich-marks";

/// C# RichTextRuntime.Reader: the client's own HTML reader.
fn runtime_reader() -> &'static RuntimeHtmlReader<Pool> {
    static READER: OnceLock<RuntimeHtmlReader<Pool>> = OnceLock::new();
    READER.get_or_init(|| RuntimeHtmlReader {
        runtime: Pool::new(blok_jsruntime::Options {
            pool_size: Some(1),
            ..blok_jsruntime::Options::default()
        })
        .unwrap_or_else(|err| panic!("{err}")),
    })
}

fn field<'a>(value: &'a Value, key: &str) -> &'a Value {
    let Value::Object(object) = value else {
        panic!("not an object: {value:?}");
    };
    object
        .get(&Str::from(key))
        .unwrap_or_else(|| panic!("no {key:?}"))
}

fn migration_fixture(name: &str) -> Value {
    let fixture = blok_collab_collabtest::read("collab-migrations/cases.json");
    let Value::Array(cases) = field(&fixture, "cases") else {
        panic!("no cases");
    };
    cases
        .iter()
        .find(|c| matches!(field(c, "name"), Value::String(s) if s.to_string() == name))
        .unwrap_or_else(|| panic!("no migration case {name:?}"))
        .clone()
}

fn decode64(text: &str) -> Vec<u8> {
    let compact: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    base64::engine::general_purpose::STANDARD
        .decode(compact)
        .expect("base64")
}

/// The fixture room's state.
fn format1_update() -> Vec<u8> {
    let raw =
        blok_collab_collabtest::read_bytes(&format!("collab-format1/{MIGRATION_ROOM}/update.b64"));
    decode64(&String::from_utf8(raw).expect("UTF-8"))
}

/// The room as the released client stored it: rich fields as string leaves
/// (the fixture's string-leaves shape update).
fn string_leaf_room() -> Vec<u8> {
    let doc = Doc::new(blok_yjs::Options::default());
    doc.apply_update(&format1_update())
        .expect("the room applies");
    let case = migration_fixture(&format!("{MIGRATION_ROOM}/string-leaves"));
    let Value::String(shape) = field(&case, "shapeUpdate") else {
        panic!("the string-leaves case has no shape update");
    };
    doc.apply_update(&decode64(&shape.to_string()))
        .expect("the shape applies");
    full_state(&doc)
}

fn format1_tag(epoch: i64) -> Tag {
    Tag {
        format: HTML_RICH_TEXT_FORMAT,
        epoch,
        lineage: TAG_LINEAGE.to_owned(),
    }
}

fn canonical_json(value: &Value) -> String {
    let text = blok_jsjson::stringify(value).expect("stringify");
    let parsed = blok_jsjson::parse_node(
        text.as_bytes(),
        blok_jsjson::Options {
            max_depth: 256,
            refuse_duplicates: false,
        },
    )
    .expect("parse");
    let mut out = Vec::new();
    parsed.append_canonical(&mut out).expect("canonical");
    String::from_utf8(out).expect("UTF-8")
}

/// C# Expected: the captured export, with the tail's "<i>tail</i> " read
/// into m-highlight's text when with_tail.
async fn expected_export(with_tail: bool) -> String {
    let mut blocks = field(&migration_fixture(MIGRATION_ROOM), "export").clone();
    if with_tail {
        let html = "<i>tail</i> a <mark>plain highlight</mark> b";
        let read = runtime_reader()
            .read(
                &[RichTextHtml {
                    kind: Str::from("paragraph"),
                    field: Str::from("text"),
                    html: Str::from(html),
                }],
                None,
            )
            .await
            .expect("the runtime reads the tail");
        let Value::Array(items) = &mut blocks else {
            panic!("the export is not an array");
        };
        for block in items {
            let Value::Object(object) = block else {
                continue;
            };
            if matches!(object.get(&Str::from("id")), Some(Value::String(id)) if id.to_string() == "m-highlight")
                && let Some(Value::Object(data)) = object.get_mut(&Str::from("data"))
            {
                data.set(Str::from("text"), Value::Array(read[0].clone()));
            }
        }
    }
    canonical_json(&blocks)
}

fn replay(updates: &[Vec<u8>]) -> Doc {
    let doc = Doc::new(blok_yjs::Options::default());
    for update in updates {
        let result = doc.apply_update(update).expect("replay");
        assert_eq!(result.outcome, Outcome::Applied, "replay: {result:?}");
    }
    doc
}

fn export_json(doc: &Doc) -> String {
    let (blocks, slots) =
        blok_collab_convert::export(doc, &RichTextFields::built_in(), None).expect("export");
    assert!(slots.is_empty(), "export: {} HTML slots", slots.len());
    canonical_json(&Value::Array(blocks))
}

/// No legacy rich text is left, and every block's text is an XmlText.
fn assert_migrated(doc: &Doc) {
    let left = blok_collab_convert::collect_legacy_rich_text(doc, &RichTextFields::built_in())
        .expect("collect");
    assert!(left.is_empty(), "legacy rich text left: {left:?}");
    let blocks = doc.get_map("blocks").expect("blocks");
    for id in blocks.keys() {
        let block = blocks
            .get(id.clone())
            .and_then(|b| b.as_map())
            .expect("a block map");
        let data = block
            .get("data")
            .and_then(|d| d.as_map())
            .expect("a data map");
        let text = data.get("text");
        assert!(
            text.as_ref().and_then(Out::as_xml_text).is_some(),
            "block {id} text is not an XmlText"
        );
    }
}

fn migration_room() -> TextRoom {
    let r = TextRoom::new();
    r.endpoint.holds_nothing(TEST_DOC, None);
    r
}

fn converter<R: HtmlReader + Send + Sync + 'static>(r: &TextRoom, reader: R) -> Arc<dyn Converter> {
    let clock = r.clock.clone();
    Arc::new(DocConverter {
        now: Box::new(move || clock.now()),
        html: reader,
        fields: None,
        log: None,
    })
}

fn migration_manager_with(
    r: &TextRoom,
    converter: Arc<dyn Converter>,
    journalled: bool,
    o: Options,
) -> Manager {
    Manager::new(ManagerOptions {
        store: r.store.clone(),
        endpoint: r.endpoint.clone(),
        converter,
        room: Options {
            now: Some(r.clock.clock()),
            ..o
        },
        log: Some(r.logs.log()),
        operations: journalled.then(|| Arc::new(r.operations.clone()) as Arc<dyn OperationStore>),
        activity: None,
        notes: None,
    })
}

fn migration_manager<R: HtmlReader + Send + Sync + 'static>(
    r: &TextRoom,
    reader: R,
    journalled: bool,
) -> Manager {
    migration_manager_with(r, converter(r, reader), journalled, Options::default())
}

/// C# SeedJournalAsync: the room as the baseline at epoch 4, and optionally
/// one format-1 edit after it.
fn seed_format1_journal(r: &TextRoom, format: i32, baseline: Vec<u8>, with_tail: bool) {
    let session = seed_journal(&r.operations, TEST_DOC, format, 4, vec![baseline.clone()]);
    if with_tail {
        let client = Doc::new(blok_yjs::Options::default());
        client
            .apply_update(&baseline)
            .expect("the baseline applies");
        let blocks = client.get_map("blocks").expect("blocks");
        let block = blocks
            .get("m-highlight")
            .and_then(|b| b.as_map())
            .expect("m-highlight");
        let data = block.get("data").and_then(|d| d.as_map()).expect("data");
        let text = data
            .get("text")
            .and_then(|t| t.as_text())
            .expect("a Y.Text");
        let update = client
            .transact(|txn| text.insert(Some(txn), 0, "<i>tail</i> ", None))
            .expect("the tail")
            .expect("an update");
        session
            .do_append(Candidate {
                operation_id: OP_ONE.to_owned(),
                actor_id: None,
                source: Source::CLIENT_V2,
                update,
                digest: vec![0; 32],
            })
            .expect("the tail appends");
    }
    session.do_close();
}

async fn join_status(manager: &Manager) -> JoinStatus {
    manager
        .join(TEST_DOC, FakeMember::v2())
        .await
        .expect("join")
        .status
}

fn baseline_frames(r: &TextRoom) -> Vec<Vec<u8>> {
    r.operations.baseline(TEST_DOC)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_format1_journal_is_migrated_on_open() {
    let r = migration_room();
    seed_format1_journal(&r, HTML_RICH_TEXT_FORMAT, format1_update(), true);
    let manager = migration_manager(&r, runtime_reader(), true);
    let member = FakeMember::v2();
    join_synced(&manager, TEST_DOC, &member).await;

    let head = r.operations.head(TEST_DOC).expect("a head");
    assert!(
        head.format == CURRENT_FORMAT
            && head.epoch == 5
            && head.lineage != TAG_LINEAGE
            && is_lineage(&head.lineage)
            && head.durable_through == 0,
        "head = {head:?}"
    );
    assert!(
        r.operations.committed(TEST_DOC).is_empty(),
        "the migrated lineage has records"
    );
    let tag = control_tag(&member);
    assert_eq!(
        (tag.format, tag.epoch, tag.lineage.as_str()),
        (head.format, head.epoch, head.lineage.as_str())
    );
    let (state, _) = state_text(&manager, TEST_DOC).await;
    let state_head = state.head.expect("a state head");
    assert_eq!(
        (state_head.tag.lineage.as_str(), state_head.server_sequence),
        (head.lineage.as_str(), 0)
    );

    // The baseline alone rebuilds the migrated room, the tail's edit
    // included.
    let rebuilt = replay(&baseline_frames(&r));
    assert_migrated(&rebuilt);
    assert_eq!(export_json(&rebuilt), expected_export(true).await);
}

// The released client (v1.15.2) stored rich fields as string leaves.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_string_leaf_journal_is_migrated_on_open() {
    let r = migration_room();
    seed_format1_journal(&r, HTML_RICH_TEXT_FORMAT, string_leaf_room(), false);
    let member = FakeMember::v2();
    join_synced(
        &migration_manager(&r, runtime_reader(), true),
        TEST_DOC,
        &member,
    )
    .await;

    assert_eq!(control_tag(&member).format, CURRENT_FORMAT);
    let rebuilt = replay(&baseline_frames(&r));
    assert_migrated(&rebuilt);
    assert_eq!(export_json(&rebuilt), expected_export(false).await);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_string_leaf_working_set_is_migrated_in_place() {
    let r = migration_room();
    r.store
        .seed(TEST_DOC, &[string_leaf_room()], format1_tag(4));
    let member = FakeMember::v2();
    join_synced(
        &migration_manager(&r, runtime_reader(), false),
        TEST_DOC,
        &member,
    )
    .await;

    assert_eq!(control_tag(&member).format, CURRENT_FORMAT);
    let rebuilt = replay(&r.store.frames(TEST_DOC));
    assert_migrated(&rebuilt);
    assert_eq!(export_json(&rebuilt), expected_export(false).await);
}

/// Fails every read with err.
struct CountingReader {
    calls: Arc<AtomicI32>,
    err: fn() -> blok_collab_convert::Error,
}

impl HtmlReader for CountingReader {
    async fn read(
        &self,
        _fields: &[RichTextHtml],
        _timeout: Option<Duration>,
    ) -> Result<Vec<Vec<Value>>, blok_collab_convert::Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Err((self.err)())
    }
}

fn counting(err: fn() -> blok_collab_convert::Error) -> (CountingReader, Arc<AtomicI32>) {
    let calls = Arc::new(AtomicI32::new(0));
    (
        CountingReader {
            calls: calls.clone(),
            err,
        },
        calls,
    )
}

fn timed_out() -> blok_collab_convert::Error {
    blok_collab_convert::Error::Runtime(InvokeError::Failure(Failure {
        kind: Kind::TimedOut,
        err: blok_jsruntime::Error::Engine("ran past the runtime's timeout".to_owned()),
    }))
}

// A failure that is not a runtime limit also repeats on every open, so it
// is held off the same way.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn any_failed_migration_is_held_off() {
    let r = migration_room();
    seed_format1_journal(&r, HTML_RICH_TEXT_FORMAT, format1_update(), false);
    let (reader, calls) = counting(|| {
        blok_collab_convert::Error::Message(
            "collab: the runtime answered htmlFieldsToSegments with the wrong shape.".to_owned(),
        )
    });
    let manager = migration_manager(&r, reader, true);

    assert_eq!(
        join_status(&manager).await,
        JoinStatus::SeedFailed,
        "first join"
    );
    assert_eq!(
        join_status(&manager).await,
        JoinStatus::Unavailable,
        "a join while held off"
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

// A format-1 copy whose lineage is unusable is still format 1 and migrates.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_format1_working_set_with_an_unusable_lineage_is_migrated_when_adopted() {
    let r = migration_room();
    r.store.seed(
        TEST_DOC,
        &[format1_update()],
        Tag {
            format: HTML_RICH_TEXT_FORMAT,
            epoch: 4,
            lineage: "not-a-lineage".to_owned(),
        },
    );
    let member = FakeMember::v2();
    join_synced(
        &migration_manager(&r, runtime_reader(), true),
        TEST_DOC,
        &member,
    )
    .await;

    assert_eq!(control_tag(&member).format, CURRENT_FORMAT);
    assert_migrated(&replay(&baseline_frames(&r)));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_migrated_journal_is_not_migrated_again() {
    let r = migration_room();
    seed_format1_journal(&r, HTML_RICH_TEXT_FORMAT, format1_update(), false);
    let manager = migration_manager(&r, runtime_reader(), true);
    join_synced(&manager, TEST_DOC, &FakeMember::v2()).await;
    let migrated = r.operations.head(TEST_DOC).expect("a head");
    let baseline = baseline_frames(&r);
    manager.drain().await.expect("drain");

    let member = FakeMember::v2();
    join_synced(
        &migration_manager(&r, runtime_reader(), true),
        TEST_DOC,
        &member,
    )
    .await;

    assert_eq!(r.operations.head(TEST_DOC), Some(migrated.clone()));
    assert_eq!(control_tag(&member).lineage, migrated.lineage);
    assert_eq!(baseline_frames(&r), baseline, "the baseline changed");
}

// The reset is the commit point: until it lands the journal is format 1.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_failed_commit_leaves_the_format1_journal_intact() {
    let r = migration_room();
    seed_format1_journal(&r, HTML_RICH_TEXT_FORMAT, format1_update(), false);
    let before = r.operations.head(TEST_DOC);
    let baseline = baseline_frames(&r);
    r.operations
        .set_fail_resets(Some(Box::new(|_| Some("the disk is full".to_owned()))));

    assert_eq!(
        join_status(&migration_manager(&r, runtime_reader(), true)).await,
        JoinStatus::SeedFailed
    );
    assert_eq!(r.operations.head(TEST_DOC), before);
    assert_eq!(baseline_frames(&r), baseline, "the baseline changed");

    r.operations.set_fail_resets(None);
    let member = FakeMember::v2();
    join_synced(
        &migration_manager(&r, runtime_reader(), true),
        TEST_DOC,
        &member,
    )
    .await;
    assert_eq!(control_tag(&member).format, CURRENT_FORMAT);
    assert_migrated(&replay(&baseline_frames(&r)));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_failed_read_leaves_the_format1_journal_intact() {
    let r = migration_room();
    seed_format1_journal(&r, HTML_RICH_TEXT_FORMAT, format1_update(), false);
    let before = r.operations.head(TEST_DOC);

    let (reader, _) = counting(|| {
        blok_collab_convert::Error::Message("the runtime ran past its timeout".to_owned())
    });
    assert_eq!(
        join_status(&migration_manager(&r, reader, true)).await,
        JoinStatus::SeedFailed
    );
    assert_eq!(r.operations.head(TEST_DOC), before);
    assert!(
        r.logs
            .lines()
            .iter()
            .any(|l| l.contains("could not migrate its format-1 rich text")
                && l.contains("ran past its timeout")),
        "log = {:?}",
        r.logs.lines()
    );
}

// A field too large for the runtime's timeout fails the same way on every
// open, so the document is held off for a doubling wait.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_migration_that_runs_past_the_runtimes_limits_is_held_off() {
    let r = migration_room();
    seed_format1_journal(&r, HTML_RICH_TEXT_FORMAT, format1_update(), false);
    let (reader, calls) = counting(timed_out);
    let manager = migration_manager(&r, reader, true);

    assert_eq!(
        join_status(&manager).await,
        JoinStatus::SeedFailed,
        "first join"
    );
    assert_eq!(
        join_status(&manager).await,
        JoinStatus::Unavailable,
        "a join while held off"
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    // C# prints the wait as a TimeSpan.
    assert!(
        r.logged(&format!(
            "collab: document \"{TEST_DOC}\" failed to load in a way the next open repeats, so it is held off for 00:00:02 (failure 1); the room's own log line says why"
        )),
        "log = {:?}",
        r.logs.lines()
    );

    r.clock
        .advance(Options::default().with_defaults().backoff(1));
    assert_eq!(
        join_status(&manager).await,
        JoinStatus::SeedFailed,
        "join after the hold"
    );
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert_eq!(
        r.operations.head(TEST_DOC).map(|h| h.format),
        Some(HTML_RICH_TEXT_FORMAT)
    );
}

// The pre-reset load does not migrate; a refused reset must not leave that
// format-1 room serving.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_refused_reset_does_not_leave_a_format1_room_serving() {
    let r = migration_room();
    seed_format1_journal(&r, HTML_RICH_TEXT_FORMAT, format1_update(), false);
    r.store
        .set_fail_retires(Some(Box::new(|_| Some("the disk is busy".to_owned()))));
    let manager = migration_manager(&r, runtime_reader(), true);

    let reset = manager.reset(TEST_DOC).await.expect("reset");
    assert_eq!(reset.status, ResetStatus::Unavailable);

    r.store.set_fail_retires(None);
    let member = FakeMember::v2();
    join_synced(&manager, TEST_DOC, &member).await;
    let tag = control_tag(&member);
    assert!(
        tag.format == CURRENT_FORMAT && tag.lineage != TAG_LINEAGE,
        "tag = {tag:?}"
    );
}

// The migration's reset leaves the head at sequence 0, and the room's
// counters follow it.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_edit_after_migration_commits_at_sequence_one_and_checkpoints() {
    let r = migration_room();
    seed_format1_journal(&r, HTML_RICH_TEXT_FORMAT, format1_update(), true);
    let manager = migration_manager(&r, runtime_reader(), true);
    join_synced(&manager, TEST_DOC, &FakeMember::v2()).await;

    let block = node(r#"{"id":"added","type":"paragraph","data":{"text":"<b>after</b>"}}"#);
    let result = manager
        .edit(
            TEST_DOC,
            vec![blok_collab_convert::EditOp::Insert {
                id: Str::from("added"),
                block,
                after: None,
                parent: None,
            }],
            OP_TWO,
            &[0; 32],
            "",
            None,
        )
        .await
        .expect("edit");
    assert_eq!(result.status, EditStatus::Applied, "{:?}", result.err);
    let committed = r.operations.committed(TEST_DOC);
    assert_eq!(
        committed.iter().map(|c| c.sequence).collect::<Vec<_>>(),
        [1]
    );
    assert!(
        manager.checkpoint(TEST_DOC).await.expect("checkpoint"),
        "no checkpoint was published"
    );
    assert_eq!(
        r.operations.checkpoint(TEST_DOC).map(|c| c.through),
        Some(1)
    );
}

// A format-1 client's offline operation, on the old lineage, is refused
// and never journalled.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_format1_clients_operation_is_refused_after_migration() {
    let r = migration_room();
    seed_format1_journal(&r, HTML_RICH_TEXT_FORMAT, format1_update(), false);
    let manager = migration_manager(&r, runtime_reader(), true);
    let writer = FakeMember::v2();
    let membership = join_synced(&manager, TEST_DOC, &writer).await;
    let client = replay(&baseline_frames(&r));
    let blocks = client.get_map("blocks").expect("blocks");
    let block = blocks
        .get("m-simple")
        .and_then(|b| b.as_map())
        .expect("m-simple");
    let data = block.get("data").and_then(|d| d.as_map()).expect("data");
    let update = client
        .transact(|txn| {
            data.set(
                txn,
                "text",
                blok_yjs::Text::new(Some(Str::from("<b>offline</b>"))),
            )
        })
        .expect("a write")
        .expect("an update");
    let seen = writer.messages().len();

    receive(
        &membership,
        Message::Operation {
            lineage: TAG_LINEAGE.to_owned(),
            operation_id: OP_ONE.to_owned(),
            update,
        },
    )
    .await;

    let got = writer.messages()[seen..].to_vec();
    assert_eq!(got.len(), 1, "the writer got {got:?}, want one rejection");
    assert!(
        matches!(&got[0], Message::Rejection { code, .. } if code == "lineage-mismatch"),
        "the writer got {:?}",
        got[0]
    );
    assert!(
        r.operations.committed(TEST_DOC).is_empty(),
        "the old lineage's operation was journalled"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_journal_in_a_newer_format_is_refused_and_kept() {
    let r = migration_room();
    seed_format1_journal(&r, CURRENT_FORMAT + 1, format1_update(), false);
    let before = r.operations.head(TEST_DOC);

    assert_eq!(
        join_status(&migration_manager(&r, runtime_reader(), true)).await,
        JoinStatus::SeedFailed
    );
    assert_eq!(r.operations.head(TEST_DOC), before);
    assert!(r.logged("format 3"), "log = {:?}", r.logs.lines());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_format1_working_set_is_migrated_in_place() {
    let r = migration_room();
    r.store.seed(TEST_DOC, &[format1_update()], format1_tag(4));
    let member = FakeMember::v2();
    join_synced(
        &migration_manager(&r, runtime_reader(), false),
        TEST_DOC,
        &member,
    )
    .await;

    let stored = r.store.stored(TEST_DOC).tag;
    assert!(
        stored.format == CURRENT_FORMAT && stored.epoch == 5 && stored.lineage != TAG_LINEAGE,
        "stored tag = {stored:?}"
    );
    let tag = control_tag(&member);
    assert_eq!(
        (tag.format, tag.epoch, tag.lineage.as_str()),
        (stored.format, stored.epoch, stored.lineage.as_str())
    );
    // A write, never a store reset: a reset stores an empty log.
    assert_eq!(r.store.resets.load(Ordering::SeqCst), 0, "store resets");
    assert_eq!(r.endpoint.loaded(), 0, "endpoint loads");
    let rebuilt = replay(&r.store.frames(TEST_DOC));
    assert_migrated(&rebuilt);
    assert_eq!(export_json(&rebuilt), expected_export(false).await);
}

// The host record still holds HTML; a migrated room writes it back as
// segments.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_migrated_working_set_writes_the_record_back() {
    let r = migration_room();
    r.store.seed(TEST_DOC, &[format1_update()], format1_tag(4));
    let manager = migration_manager_with(
        &r,
        converter(&r, runtime_reader()),
        false,
        Options {
            export_debounce: ms(10),
            export_max_delay: ms(10),
            ..Options::default()
        },
    );
    join_synced(&manager, TEST_DOC, &FakeMember::v2()).await;

    wait_until("the migrated record to be written back", || {
        !r.endpoint.saves().is_empty()
    })
    .await;
    let saved = blok_jsjson::parse(r.endpoint.saves()[0].data.as_bytes()).expect("parse");
    assert_eq!(
        canonical_json(field(&saved, "blocks")),
        expected_export(false).await
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_failed_write_leaves_the_format1_working_set_intact() {
    let r = migration_room();
    let update = format1_update();
    r.store
        .seed(TEST_DOC, std::slice::from_ref(&update), format1_tag(4));
    r.store
        .set_fail_writes(Some(Box::new(|_| Some("the disk is full".to_owned()))));

    assert_eq!(
        join_status(&migration_manager(&r, runtime_reader(), false)).await,
        JoinStatus::SeedFailed
    );
    assert_eq!(r.store.stored(TEST_DOC).tag, format1_tag(4));
    assert_eq!(
        r.store.frames(TEST_DOC),
        [update],
        "the format-1 frames changed"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_empty_format1_working_set_seeds_in_the_current_format() {
    let r = migration_room();
    r.store.seed(TEST_DOC, &[], format1_tag(4));
    let canonical = blok_collab_collabtest::read_bytes(&format!(
        "collab-format1/{MIGRATION_ROOM}/canonical.json"
    ));
    r.endpoint.holds_document(
        TEST_DOC,
        &format!(
            r#"{{"blocks":{}}}"#,
            String::from_utf8(canonical).expect("UTF-8")
        ),
        None,
    );
    let member = FakeMember::v2();
    join_synced(
        &migration_manager(&r, runtime_reader(), false),
        TEST_DOC,
        &member,
    )
    .await;

    assert_eq!(control_tag(&member).format, CURRENT_FORMAT);
    assert_eq!(r.store.stored(TEST_DOC).tag.format, CURRENT_FORMAT);
    assert_migrated(&replay(&r.store.frames(TEST_DOC)));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_format1_working_set_is_migrated_when_the_journal_adopts_it() {
    let r = migration_room();
    r.store.seed(TEST_DOC, &[format1_update()], format1_tag(4));
    let member = FakeMember::v2();
    join_synced(
        &migration_manager(&r, runtime_reader(), true),
        TEST_DOC,
        &member,
    )
    .await;

    let head = r.operations.head(TEST_DOC).expect("a head");
    assert!(
        head.format == CURRENT_FORMAT && head.epoch == 5 && head.lineage != TAG_LINEAGE,
        "head = {head:?}"
    );
    assert_eq!(control_tag(&member).lineage, head.lineage);
    assert_migrated(&replay(&baseline_frames(&r)));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_journal_reset_stamps_the_current_format() {
    let r = migration_room();
    seed_format1_journal(&r, HTML_RICH_TEXT_FORMAT, format1_update(), false);

    let result = migration_manager(&r, runtime_reader(), true)
        .reset(TEST_DOC)
        .await
        .expect("reset");
    assert_eq!(result.status, ResetStatus::Done, "{:?}", result.err);
    let tag = result.tag.expect("a tag");
    assert_eq!((tag.format, tag.epoch), (CURRENT_FORMAT, 5));
    assert_eq!(
        r.operations.head(TEST_DOC).map(|h| h.format),
        Some(CURRENT_FORMAT)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_working_set_reset_stamps_the_current_format() {
    let r = migration_room();
    r.store.seed(TEST_DOC, &[format1_update()], format1_tag(4));

    let result = migration_manager(&r, runtime_reader(), false)
        .reset(TEST_DOC)
        .await
        .expect("reset");
    assert_eq!(result.status, ResetStatus::Done, "{:?}", result.err);
    assert_eq!(result.tag.map(|t| t.format), Some(CURRENT_FORMAT));
    assert_eq!(r.store.stored(TEST_DOC).tag.format, CURRENT_FORMAT);
}

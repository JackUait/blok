use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::{Duration, SystemTime};

use blok_collab_convert::{
    DocConverter, EditOp, Error as ConvertError, HtmlReader, RichTextHtml, RuntimeHtmlReader,
    parse_edit_ops,
};
use blok_collab_operation::{Record, Source};
use blok_jsjson::{Node, Object, Options as JsonOptions, Str, Value, parse, parse_node, stringify};
use blok_jsruntime::{Options as PoolOptions, Pool};
use blok_yjs::{Array, Doc, In, Map, MapEntry, Options, Text, Transaction};

use crate::changes::{BlockChange, BlockChangeKind, diff_blocks, diff_page, page_fields};
use crate::changes_test::diff_blocks_marks_every_kind_fixture_case;
use crate::{Error, replay_changes};

// Twins of C# CollabVersionChangesTests.

pub(crate) fn runtime_reader() -> &'static RuntimeHtmlReader<Pool> {
    static READER: OnceLock<RuntimeHtmlReader<Pool>> = OnceLock::new();
    READER.get_or_init(|| RuntimeHtmlReader {
        runtime: Pool::new(PoolOptions {
            pool_size: 1,
            ..PoolOptions::default()
        })
        .unwrap_or_else(|err| panic!("{err}")),
    })
}

pub(crate) fn converter_with<R>(reader: R) -> DocConverter<R> {
    DocConverter {
        now: Box::new(SystemTime::now),
        html: reader,
        fields: None,
        log: None,
    }
}

/// C# RichTextRuntime: the real runtime reads the HTML.
pub(crate) fn runtime_converter() -> DocConverter<&'static RuntimeHtmlReader<Pool>> {
    converter_with(runtime_reader())
}

pub(crate) fn json(text: &str) -> Value {
    parse(text.as_bytes()).unwrap_or_else(|err| panic!("{err}"))
}

pub(crate) fn node(text: &str) -> Node {
    parse_node(
        text.as_bytes(),
        JsonOptions {
            max_depth: 512,
            ..JsonOptions::default()
        },
    )
    .unwrap_or_else(|err| panic!("{err}"))
}

pub(crate) fn text_of(value: &Value) -> String {
    stringify(value).unwrap_or_else(|err| panic!("{err}"))
}

pub(crate) fn get<'a>(value: &'a Value, key: &str) -> &'a Value {
    match value {
        Value::Object(object) => object
            .get(&key.into())
            .unwrap_or_else(|| panic!("no {key:?}")),
        other => panic!("{other:?} is not an object"),
    }
}

pub(crate) fn ops(op_json: &[&str]) -> Vec<EditOp> {
    parse_edit_ops(format!(r#"{{ "ops": [{}] }}"#, op_json.join(",")).as_bytes())
        .unwrap_or_else(|err| panic!("{err}"))
}

pub(crate) fn transact(doc: &Doc, body: impl FnOnce(&Transaction<'_>)) -> Vec<u8> {
    doc.transact(|txn| {
        body(txn);
        Ok(())
    })
    .unwrap_or_else(|err| panic!("{err}"))
    .unwrap_or_else(|| panic!("the transaction changed nothing"))
}

fn ok<T, E: std::fmt::Display>(result: Result<T, E>) -> T {
    result.unwrap_or_else(|err| panic!("{err}"))
}

/// C# Records: sequence 1.., committed one minute apart from the epoch.
fn records(updates: &[Vec<u8>]) -> Vec<Record> {
    updates
        .iter()
        .enumerate()
        .map(|(i, update)| {
            let sequence = i as u64 + 1;
            Record {
                operation_id: format!("{sequence:032x}"),
                sequence,
                committed_at: SystemTime::UNIX_EPOCH + Duration::from_secs(60 * sequence),
                actor_id: Some(format!("actor-{sequence}")),
                source: Source::HTTP_EDIT,
                update: update.clone(),
                digest: vec![0; 32],
            }
        })
        .collect()
}

fn oks(records: Vec<Record>) -> impl Iterator<Item = Result<Record, Error>> {
    records.into_iter().map(Ok)
}

fn blocks(items: &[Value]) -> Vec<Value> {
    items.to_vec()
}

fn block(id: &str) -> BlockBuilder {
    BlockBuilder {
        id: id.to_owned(),
        kind: "paragraph".to_owned(),
        text: "t".to_owned(),
        parent: None,
        tunes: None,
    }
}

struct BlockBuilder {
    id: String,
    kind: String,
    text: String,
    parent: Option<String>,
    tunes: Option<Value>,
}

impl BlockBuilder {
    fn kind(mut self, kind: &str) -> Self {
        self.kind = kind.to_owned();
        self
    }
    fn text(mut self, text: &str) -> Self {
        self.text = text.to_owned();
        self
    }
    fn parent(mut self, parent: &str) -> Self {
        self.parent = Some(parent.to_owned());
        self
    }
    fn tunes(mut self, tunes: Value) -> Self {
        self.tunes = Some(tunes);
        self
    }
    fn object(self) -> Object {
        let mut block = Object::new();
        block.set("id".into(), Value::String(self.id.as_str().into()));
        block.set("type".into(), Value::String(self.kind.as_str().into()));
        let mut data = Object::new();
        data.set("text".into(), Value::String(self.text.as_str().into()));
        block.set("data".into(), Value::Object(data));
        if let Some(tunes) = self.tunes {
            block.set("tunes".into(), tunes);
        }
        if let Some(parent) = self.parent {
            block.set("parent".into(), Value::String(parent.as_str().into()));
        }
        block
    }
    fn build(self) -> Value {
        Value::Object(self.object())
    }
}

fn summary(changes: &[BlockChange]) -> Vec<(String, BlockChangeKind)> {
    changes
        .iter()
        .map(|change| (change.id.to_string(), change.kind))
        .collect()
}

fn field_text(object: Option<&Object>, path: &[&str]) -> String {
    let mut at = Value::Object(object.unwrap_or_else(|| panic!("no block")).clone());
    for key in path {
        at = get(&at, key).clone();
    }
    match at {
        Value::String(s) => s.to_string(),
        other => text_of(&other),
    }
}

#[test]
fn every_kind_fixture_case_marks_the_expected_blocks() {
    diff_blocks_marks_every_kind_fixture_case();
}

#[test]
fn the_same_blocks_are_no_change() {
    let before = blocks(&[block("a").build(), block("b").build()]);

    assert!(diff_blocks(&before, &before.clone()).is_empty());
}

#[test]
fn a_new_block_is_added_and_a_missing_one_is_removed() {
    let changes = diff_blocks(
        &[block("a").build(), block("gone").kind("header").build()],
        &[block("a").build(), block("new").build()],
    );

    let got: Vec<(String, Option<String>, BlockChangeKind)> = changes
        .iter()
        .map(|c| {
            (
                c.id.to_string(),
                c.kind_type.as_ref().map(Str::to_string),
                c.kind,
            )
        })
        .collect();
    assert_eq!(
        got,
        [
            (
                "new".to_owned(),
                Some("paragraph".to_owned()),
                BlockChangeKind::Added
            ),
            (
                "gone".to_owned(),
                Some("header".to_owned()),
                BlockChangeKind::Removed
            ),
        ]
    );
    assert!(changes[0].before.is_none());
    assert_eq!(field_text(changes[0].after.as_ref(), &["id"]), "new");
    assert_eq!(field_text(changes[1].before.as_ref(), &["id"]), "gone");
    assert!(changes[1].after.is_none());
}

#[test]
fn a_different_type_data_or_tunes_is_a_change() {
    let changes = diff_blocks(
        &[
            block("a").text("x").build(),
            block("b").build(),
            block("c").build(),
        ],
        &[
            block("a").text("y").build(),
            block("b").kind("header").build(),
            block("c").tunes(json(r#"{"align":"center"}"#)).build(),
        ],
    );

    let ids: Vec<String> = changes.iter().map(|c| c.id.to_string()).collect();
    assert_eq!(ids, ["a", "b", "c"]);
    assert!(changes.iter().all(|c| c.kind == BlockChangeKind::Changed));
    assert_eq!(
        field_text(changes[0].before.as_ref(), &["data", "text"]),
        "x"
    );
    assert_eq!(
        field_text(changes[0].after.as_ref(), &["data", "text"]),
        "y"
    );
    assert_eq!(
        changes[1].kind_type.as_ref().map(Str::to_string),
        Some("header".to_owned())
    );
}

#[test]
fn key_order_missing_tunes_and_edit_stamps_are_no_change() {
    let mut before = block("a").object();
    before.set("data".into(), json(r#"{"text":"x","level":2}"#));
    let mut after = block("a").object();
    after.set("data".into(), json(r#"{"level":2,"text":"x"}"#));
    after.set("tunes".into(), json("{}"));
    after.set("lastEditedAt".into(), Value::Number(5.0));
    after.set("lastEditedBy".into(), Value::String("u2".into()));

    assert!(diff_blocks(&[Value::Object(before)], &[Value::Object(after)]).is_empty());
}

/// Never "a different previous sibling": that would flag every block after an insert.
#[test]
fn an_insert_moves_nothing_around_it() {
    let changes = diff_blocks(
        &[block("a").build(), block("b").build(), block("c").build()],
        &[
            block("new").build(),
            block("a").build(),
            block("b").build(),
            block("c").build(),
        ],
    );

    assert_eq!(
        summary(&changes),
        [("new".to_owned(), BlockChangeKind::Added)]
    );
}

#[test]
fn a_block_out_of_the_kept_order_of_its_parent_is_moved() {
    let changes = diff_blocks(
        &[block("a").build(), block("b").build(), block("c").build()],
        &[block("c").build(), block("a").build(), block("b").build()],
    );

    assert_eq!(
        summary(&changes),
        [("c".to_owned(), BlockChangeKind::Moved)]
    );
    assert!(changes[0].before.is_some());
    assert!(changes[0].after.is_some());
}

#[test]
fn a_block_under_a_different_parent_is_moved() {
    let changes = diff_blocks(
        &[block("p").build(), block("a").build()],
        &[block("p").build(), block("a").parent("p").build()],
    );

    assert_eq!(
        summary(&changes),
        [("a".to_owned(), BlockChangeKind::Moved)]
    );
}

/// As the client diff: a block that is changed still takes its place in the kept order.
#[test]
fn a_changed_block_that_also_moved_is_changed() {
    let changes = diff_blocks(
        &[block("a").build(), block("b").text("x").build()],
        &[
            block("b").text("y").build(),
            block("a").build(),
            block("c").parent("a").build(),
        ],
    );

    assert_eq!(
        summary(&changes),
        [
            ("b".to_owned(), BlockChangeKind::Changed),
            ("c".to_owned(), BlockChangeKind::Added)
        ]
    );
}

/// As the client diff, unlike the restore planner's kept order: a changed
/// block still holds its place, so its unchanged sibling is the one moved.
#[test]
fn a_changed_block_still_takes_part_in_the_kept_order() {
    let changes = diff_blocks(
        &[block("a").text("x").build(), block("b").build()],
        &[block("b").build(), block("a").text("y").build()],
    );

    assert_eq!(
        summary(&changes),
        [
            ("b".to_owned(), BlockChangeKind::Moved),
            ("a".to_owned(), BlockChangeKind::Changed)
        ]
    );
}

#[test]
fn sibling_order_is_compared_within_each_parent() {
    let changes = diff_blocks(
        &[
            block("p").build(),
            block("x").parent("p").build(),
            block("y").parent("p").build(),
            block("q").build(),
        ],
        &[
            block("q").build(),
            block("p").build(),
            block("y").parent("p").build(),
            block("x").parent("p").build(),
        ],
    );

    assert_eq!(
        summary(&changes),
        [
            ("q".to_owned(), BlockChangeKind::Moved),
            ("y".to_owned(), BlockChangeKind::Moved)
        ]
    );
}

/// C# groups siblings by `ParentOf(block) ?? ""`, as the client's
/// output-diff.ts does (ROOT = ''), so root blocks and children of a block
/// whose id is "" share one order. Go keeps the root apart and marks
/// nothing here.
#[test]
fn root_blocks_and_children_of_an_empty_id_share_one_order() {
    let changes = diff_blocks(
        &[block("c").parent("").build(), block("r").build()],
        &[block("r").build(), block("c").parent("").build()],
    );

    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].kind, BlockChangeKind::Moved);
}

fn page_and_values(doc: &Doc) -> (Map, Map) {
    (ok(doc.get_map("page")), ok(doc.get_map("values")))
}

fn str_value(s: &str) -> Value {
    Value::String(s.into())
}

#[test]
fn page_and_value_keys_that_changed_are_listed_page_first() {
    let doc = Doc::new(Options {
        client_id: Some(1),
        no_gc: false,
    });
    let (page, values) = page_and_values(&doc);
    transact(&doc, |txn| {
        ok(page.set(txn, "title", str_value("Plan")));
        ok(page.set(txn, "icon", str_value("x")));
        ok(values.set(txn, "count", Value::Number(1.0)));
        ok(values.set(txn, "kept", str_value("same")));
    });
    let before = ok(page_fields(&doc));

    transact(&doc, |txn| {
        ok(page.set(txn, "title", str_value("Plan B")));
        ok(page.delete(txn, "icon"));
        ok(page.set(txn, "cover", str_value("c")));
        ok(values.set(txn, "count", Value::Number(2.0)));
        ok(values.set(txn, "kept", str_value("same")));
    });
    let after = ok(page_fields(&doc));

    assert_eq!(
        diff_page(&before, &after),
        ["cover", "icon", "title", "values.count"]
    );
    assert!(diff_page(&after, &ok(page_fields(&doc))).is_empty());
}

#[test]
fn an_object_value_is_compared_by_content() {
    let doc = Doc::new(Options {
        client_id: Some(1),
        no_gc: false,
    });
    let (_, values) = page_and_values(&doc);
    transact(&doc, |txn| ok(values.set(txn, "o", json(r#"{"a":1}"#))));
    let before = ok(page_fields(&doc));
    transact(&doc, |txn| ok(values.set(txn, "o", json(r#"{"a":2}"#))));

    assert_eq!(diff_page(&before, &ok(page_fields(&doc))), ["values.o"]);
}

fn capture(doc: &Doc) -> Arc<Mutex<Vec<Vec<u8>>>> {
    let emitted = Arc::new(Mutex::new(Vec::new()));
    let sink = emitted.clone();
    let _subscription = doc.on_update(move |event| {
        if event.local {
            sink.lock()
                .unwrap_or_else(PoisonError::into_inner)
                .push(event.update.clone());
        }
    });
    emitted
}

#[tokio::test]
async fn a_replay_diffs_each_record_after_the_first_before_against_the_one_before_it() {
    let converter = runtime_converter();
    let live = Doc::new(Options::default());
    ok(converter
        .seed(
            &live,
            &node(r#"{"blocks":[{ "id": "a", "type": "paragraph", "data": { "text": "one" } }]}"#),
        )
        .await);
    let baseline = vec![ok(live.encode_state_as_update(&[]))];
    let emitted = capture(&live);

    for op in [
        r#"{ "op": "update", "id": "a", "data": { "text": "two" } }"#,
        r#"{ "op": "insert", "id": "b", "after": "a", "block": { "type": "paragraph", "data": { "text": "b" } } }"#,
        r#"{ "op": "remove", "id": "a" }"#,
    ] {
        ok(converter.apply_ops(&live, &ops(&[op])).await);
    }
    let updates = emitted
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone();

    let all = ok(replay_changes(&baseline, oks(records(&updates)), 0, &converter, i64::MAX).await);
    let from_one =
        ok(replay_changes(&baseline, oks(records(&updates)), 1, &converter, i64::MAX).await);

    let sequences: Vec<u64> = all.iter().map(|r| r.sequence).collect();
    assert_eq!(sequences, [1, 2, 3]);
    assert_eq!(
        all[1].committed_at,
        SystemTime::UNIX_EPOCH + Duration::from_secs(120)
    );
    assert_eq!(all[2].actor_id.as_deref(), Some("actor-3"));
    let kinds: Vec<Vec<(String, BlockChangeKind)>> =
        all.iter().map(|r| summary(&r.blocks)).collect();
    assert_eq!(
        kinds,
        [
            vec![("a".to_owned(), BlockChangeKind::Changed)],
            vec![("b".to_owned(), BlockChangeKind::Added)],
            vec![("a".to_owned(), BlockChangeKind::Removed)],
        ]
    );
    let text_json = |block: Option<&Object>| {
        text_of(get(
            get(
                &Value::Object(block.unwrap_or_else(|| panic!("no block")).clone()),
                "data",
            ),
            "text",
        ))
    };
    assert_eq!(
        text_json(all[0].blocks[0].before.as_ref()),
        r#"[{"text":"one"}]"#
    );
    assert_eq!(
        text_json(all[0].blocks[0].after.as_ref()),
        r#"[{"text":"two"}]"#
    );
    assert_eq!(
        text_json(all[2].blocks[0].before.as_ref()),
        r#"[{"text":"two"}]"#
    );
    assert!(all.iter().all(|r| r.page.is_empty()));

    let sequences: Vec<u64> = from_one.iter().map(|r| r.sequence).collect();
    assert_eq!(sequences, [2, 3]);
    assert_eq!(from_one[0].blocks.len(), 1);
    assert_eq!(from_one[0].blocks[0].kind, BlockChangeKind::Added);
}

fn html_block(id: &str, html: &str) -> Map {
    let entry = |key: &str, value: In| MapEntry {
        key: key.into(),
        value,
    };
    Map::new(vec![
        entry("id", In::Any(str_value(id))),
        entry("type", In::Any(str_value("paragraph"))),
        entry(
            "data",
            Map::new(vec![entry("text", Text::new(Some(html.into())).into())]).into(),
        ),
        entry("tunes", Map::new(Vec::new()).into()),
        entry("contentIds", Array::new(Vec::new()).into()),
    ])
}

fn text_at(blocks: &Map, id: &str) -> Text {
    blocks
        .get(id)
        .and_then(|block| block.as_map())
        .and_then(|block| block.get("data"))
        .and_then(|data| data.as_map())
        .and_then(|data| data.get("text"))
        .and_then(|text| text.as_text())
        .unwrap_or_else(|| panic!("no text in {id}"))
}

fn client(id: u32) -> Doc {
    Doc::new(Options {
        client_id: Some(id),
        no_gc: false,
    })
}

#[tokio::test]
async fn a_skipped_block_is_logged_once_per_call() {
    let source = client(1);
    let blocks = ok(source.get_map("blocks"));
    let root = ok(source.get_array("root"));
    let baseline = transact(&source, |txn| {
        ok(blocks.set(txn, "a", html_block("a", "x")));
        ok(blocks.set(
            txn,
            "bad",
            Map::new(vec![
                MapEntry {
                    key: "id".into(),
                    value: In::Any(str_value("bad")),
                },
                MapEntry {
                    key: "type".into(),
                    value: In::Any(str_value("paragraph")),
                },
                MapEntry {
                    key: "data".into(),
                    value: In::Any(str_value("not a map")),
                },
            ]),
        ));
        ok(root.insert(
            txn,
            0,
            vec![In::Any(str_value("a")), In::Any(str_value("bad"))],
        ));
    });
    let a_text = text_at(&blocks, "a");
    let u1 = transact(&source, |txn| ok(a_text.insert(Some(txn), 1, "y", None)));
    let u2 = transact(&source, |txn| ok(a_text.insert(Some(txn), 2, "z", None)));
    let log = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = log.clone();
    let mut converter = runtime_converter();
    converter.log = Some(Box::new(move |message: &str| {
        sink.lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(message.to_owned());
    }));

    let changes = ok(replay_changes(
        &[baseline],
        oks(records(&[u1, u2])),
        0,
        &converter,
        i64::MAX,
    )
    .await);

    assert_eq!(changes.len(), 2);
    let log = log.lock().unwrap_or_else(PoisonError::into_inner);
    assert_eq!(log.len(), 1, "{log:?}");
    assert!(log[0].contains("\"bad\""), "{}", log[0]);
}

/// The first "before" must be that record's state: with it missing, nothing is diffed against the baseline.
#[tokio::test]
async fn a_missing_first_before_record_yields_no_rows() {
    let client = client(1);
    let text = ok(client.get_text("t"));
    let u1 = transact(&client, |txn| ok(text.insert(Some(txn), 0, "a", None)));
    let u2 = transact(&client, |txn| ok(text.insert(Some(txn), 1, "b", None)));
    let u3 = transact(&client, |txn| ok(text.insert(Some(txn), 2, "c", None)));
    let without_two: Vec<Record> = records(&[u1, u2, u3])
        .into_iter()
        .filter(|record| record.sequence != 2)
        .collect();

    let changes =
        ok(replay_changes(&[], oks(without_two), 2, &runtime_converter(), i64::MAX).await);

    assert!(changes.is_empty());
}

/// A record that is parked, or touches nothing shown, is still a row: the client says "not visualizable".
#[tokio::test]
async fn a_record_with_nothing_visible_is_a_row_with_no_blocks() {
    let client = client(1);
    let text = ok(client.get_text("t"));
    let u1 = transact(&client, |txn| ok(text.insert(Some(txn), 0, "a", None)));
    let u2 = transact(&client, |txn| ok(text.insert(Some(txn), 1, "b", None)));

    let changes = ok(replay_changes(
        &[],
        oks(records(&[u2, u1])),
        0,
        &runtime_converter(),
        i64::MAX,
    )
    .await);

    let sequences: Vec<u64> = changes.iter().map(|r| r.sequence).collect();
    assert_eq!(sequences, [1, 2]);
    assert!(
        changes
            .iter()
            .all(|r| r.blocks.is_empty() && r.page.is_empty())
    );
}

#[tokio::test]
async fn a_replay_lists_page_keys_each_record_changed() {
    let client = client(1);
    let page = ok(client.get_map("page"));
    let values = ok(client.get_map("values"));
    let baseline = transact(&client, |txn| ok(page.set(txn, "title", str_value("A"))));
    let u1 = transact(&client, |txn| ok(page.set(txn, "title", str_value("B"))));
    let u2 = transact(&client, |txn| ok(values.set(txn, "k", Value::Bool(true))));

    let changes = ok(replay_changes(
        &[baseline],
        oks(records(&[u1, u2])),
        0,
        &runtime_converter(),
        i64::MAX,
    )
    .await);

    let pages: Vec<Vec<String>> = changes.iter().map(|r| r.page.clone()).collect();
    assert_eq!(
        pages,
        [vec!["title".to_owned()], vec!["values.k".to_owned()]]
    );
}

struct CountingReader {
    inner: &'static RuntimeHtmlReader<Pool>,
    read: Arc<Mutex<Vec<String>>>,
}

impl HtmlReader for CountingReader {
    fn read(
        &self,
        fields: &[RichTextHtml],
        timeout: Duration,
    ) -> impl Future<Output = Result<Vec<Vec<Value>>, ConvertError>> + Send {
        self.read
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .extend(fields.iter().map(|field| field.html.to_string()));
        self.inner.read(fields, timeout)
    }
}

fn counting() -> (DocConverter<CountingReader>, Arc<Mutex<Vec<String>>>) {
    let read = Arc::new(Mutex::new(Vec::new()));
    let converter = converter_with(CountingReader {
        inner: runtime_reader(),
        read: read.clone(),
    });
    (converter, read)
}

fn sorted(read: &Mutex<Vec<String>>) -> Vec<String> {
    let mut read = read.lock().unwrap_or_else(PoisonError::into_inner).clone();
    read.sort();
    read
}

fn replace_text(doc: &Doc, text: &Text, with: &str) -> Vec<u8> {
    transact(doc, |txn| {
        ok(text.delete(Some(txn), 3, 1));
        ok(text.insert(Some(txn), 3, with, None));
    })
}

/// Format 1 keeps HTML in rich fields. Only blocks a record changed go through the runtime.
#[tokio::test]
async fn only_changed_blocks_have_their_html_read() {
    let source = client(1);
    let blocks = ok(source.get_map("blocks"));
    let root = ok(source.get_array("root"));
    let baseline = transact(&source, |txn| {
        ok(blocks.set(txn, "a", html_block("a", "<b>x</b>")));
        ok(blocks.set(txn, "b", html_block("b", "<i>kept</i>")));
        ok(root.insert(
            txn,
            0,
            vec![In::Any(str_value("a")), In::Any(str_value("b"))],
        ));
    });
    let edit = replace_text(&source, &text_at(&blocks, "a"), "z");
    let (converter, read) = counting();

    let changes =
        ok(replay_changes(&[baseline], oks(records(&[edit])), 0, &converter, i64::MAX).await);

    assert_eq!(changes.len(), 1);
    assert_eq!(
        summary(&changes[0].blocks),
        [("a".to_owned(), BlockChangeKind::Changed)]
    );
    let change = &changes[0].blocks[0];
    let text_json = |block: Option<&Object>| {
        text_of(get(
            get(
                &Value::Object(block.unwrap_or_else(|| panic!("no block")).clone()),
                "data",
            ),
            "text",
        ))
    };
    assert_eq!(
        text_json(change.before.as_ref()),
        r#"[{"text":"x","marks":{"bold":true}}]"#
    );
    assert_eq!(
        text_json(change.after.as_ref()),
        r#"[{"text":"z","marks":{"bold":true}}]"#
    );
    assert_eq!(sorted(&read), ["<b>x</b>", "<b>z</b>"]);
}

/// A record dropped by the byte budget never sends its HTML to the runtime.
#[tokio::test]
async fn records_past_the_byte_budget_are_dropped_oldest_first_before_any_html_is_read() {
    let source = client(1);
    let blocks = ok(source.get_map("blocks"));
    let root = ok(source.get_array("root"));
    let baseline = transact(&source, |txn| {
        ok(blocks.set(txn, "a", html_block("a", "<b>x</b>")));
        ok(root.insert(txn, 0, vec![In::Any(str_value("a"))]));
    });
    let a_text = text_at(&blocks, "a");
    let to_y = replace_text(&source, &a_text, "y");
    let to_z = replace_text(&source, &a_text, "z");
    let (converter, read) = counting();

    let changes =
        ok(replay_changes(&[baseline], oks(records(&[to_y, to_z])), 0, &converter, 1).await);

    assert_eq!(sorted(&read), ["<b>y</b>", "<b>z</b>"]);
    let sequences: Vec<u64> = changes.iter().map(|r| r.sequence).collect();
    assert_eq!(sequences, [2]);
}

#[test]
fn the_replay_future_is_send() {
    fn send<T: Send>(_: &T) {}
    let converter = runtime_converter();
    let future = replay_changes(&[], oks(Vec::new()), 0, &converter, i64::MAX);
    send(&future);
}

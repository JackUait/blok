use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};
use std::time::{Duration, SystemTime};

use blok_jsjson::{Node, Options as JsonOptions, Str, Value, parse_node, stringify};
use blok_jsruntime::{Error as RuntimeError, Failure, InvokeError, Kind, Pool};
use blok_yjs::{Doc, Map, MapEntry, Options, Text};

use crate::csharp_apply_test::ops;
use crate::csharp_yrs_compat_test::block_on;
use crate::docconverter::{DocConverter, MIGRATION_READ_TIMEOUT, TransientError, is_too_large};
use crate::editops::{EditError, JSON_MAX_DEPTH};
use crate::error::Error;
use crate::export::{DataError, RichTextHtml};
use crate::fields::{RichTextFieldEntry, RichTextFields};
use crate::htmlreader::{HtmlReader, MAX_EDIT_HTML_CHARS, RuntimeHtmlReader};
use crate::seed_test::reader;

pub(crate) const FIXED_NOW_MS: u64 = 1_793_588_645_006;

pub(crate) fn fixed_now() -> SystemTime {
    SystemTime::UNIX_EPOCH + Duration::from_millis(FIXED_NOW_MS)
}

pub(crate) fn converter<R>(reader: R) -> DocConverter<R> {
    DocConverter {
        now: Box::new(fixed_now),
        html: reader,
        fields: None,
        log: None,
    }
}

pub(crate) fn runtime() -> DocConverter<&'static RuntimeHtmlReader<Pool>> {
    converter(reader())
}

pub(crate) fn parse(text: &str) -> Node {
    parse_node(
        text.as_bytes(),
        JsonOptions {
            max_depth: JSON_MAX_DEPTH,
            ..JsonOptions::default()
        },
    )
    .unwrap_or_else(|err| panic!("{err}"))
}

enum Key<'a> {
    Name(&'a str),
    At(usize),
}

fn path<'a>(value: &'a Value, keys: &[Key<'_>]) -> &'a Value {
    let mut at = value;
    for key in keys {
        at = match (key, at) {
            (Key::Name(name), Value::Object(object)) => {
                object.get(&Str::from(*name)).unwrap_or(&Value::Undefined)
            }
            (Key::At(index), Value::Array(items)) => &items[*index],
            (_, other) => panic!("path leaves the JSON at {other:?}"),
        };
    }
    at
}

fn json(value: &Value) -> String {
    stringify(value).unwrap_or_else(|err| panic!("{err}"))
}

fn s(text: &str) -> Str {
    Str::from(text)
}

fn entry(key: &str, value: impl Into<blok_yjs::In>) -> MapEntry {
    MapEntry {
        key: s(key),
        value: value.into(),
    }
}

fn string(text: &str) -> Value {
    Value::String(s(text))
}

fn set_block(doc: &Doc, id: &str, block: Map) {
    let blocks = doc.get_map("blocks").unwrap_or_else(|err| panic!("{err}"));
    doc.transact(|txn| blocks.set(txn, id, block.clone()))
        .unwrap_or_else(|err| panic!("{err}"));
}

pub(crate) fn new_block(id: &str, kind: &str, data: Map) -> Map {
    Map::new(vec![
        MapEntry {
            key: Str::from("id"),
            value: Value::String(Str::from(id)).into(),
        },
        MapEntry {
            key: Str::from("type"),
            value: Value::String(Str::from(kind)).into(),
        },
        MapEntry {
            key: Str::from("data"),
            value: data.into(),
        },
    ])
}

pub(crate) fn legacy_html_doc() -> Doc {
    let doc = Doc::new(Options::default());
    let data = Map::new(vec![MapEntry {
        key: Str::from("text"),
        value: Text::new(Some(Str::from("<b>x</b>"))).into(),
    }]);
    let blocks = doc.get_map("blocks").unwrap_or_else(|err| panic!("{err}"));
    let root = doc.get_array("root").unwrap_or_else(|err| panic!("{err}"));
    doc.transact(|txn| {
        blocks.set(txn, "a", new_block("a", "paragraph", data.clone()))?;
        root.insert(txn, 0, vec![Value::String(Str::from("a")).into()])
    })
    .unwrap_or_else(|err| panic!("{err}"));
    doc
}

// Twins of CollabDocConverterTests.
#[test]
fn seeds_the_blocks_of_an_output_data_object_and_exports_them_back_with_a_timestamp() {
    let doc = Doc::new(Options::default());
    let c = runtime();
    block_on(c.seed(
        &doc,
        &parse(
            r#"{"time":1,"blocks":[{"id":"a","type":"paragraph","data":{"text":"hi <b>you</b>"}}],"version":"1.12.0"}"#,
        ),
    ))
    .unwrap_or_else(|err| panic!("{err}"));
    let exported = Value::Object(block_on(c.export(&doc)).unwrap_or_else(|err| panic!("{err}")));
    assert_eq!(
        path(&exported, &[Key::Name("time")]),
        &Value::BigInt(FIXED_NOW_MS as i64)
    );
    let blocks = path(&exported, &[Key::Name("blocks")]);
    let Value::Array(items) = blocks else {
        panic!("{blocks:?}");
    };
    assert_eq!(items.len(), 1, "{}", json(blocks));
    assert_eq!(path(blocks, &[Key::At(0), Key::Name("id")]), &string("a"));
    assert_eq!(
        path(blocks, &[Key::At(0), Key::Name("type")]),
        &string("paragraph")
    );
    assert_eq!(
        json(path(
            blocks,
            &[Key::At(0), Key::Name("data"), Key::Name("text")]
        )),
        r#"[{"text":"hi "},{"text":"you","marks":{"bold":true}}]"#
    );
}

#[test]
fn forwards_export_warnings_to_the_log() {
    let doc = Doc::new(Options::default());
    let warnings = Arc::new(Mutex::new(Vec::new()));
    let sink = warnings.clone();
    let mut c = runtime();
    c.log = Some(Box::new(move |message: &str| {
        sink.lock().unwrap().push(message.to_owned())
    }));
    set_block(
        &doc,
        "bad",
        Map::new(vec![
            entry("id", Value::Number(1.0)),
            entry("type", string("paragraph")),
            entry("data", Map::new(Vec::new())),
        ]),
    );
    block_on(c.export(&doc)).unwrap_or_else(|err| panic!("{err}"));
    let warnings = warnings.lock().unwrap();
    assert!(
        warnings.iter().any(|w| w.contains(r#""bad""#)),
        "{warnings:?}"
    );
}

#[test]
fn refuses_a_document_without_a_blocks_array() {
    for body in ["[]", r#""text""#, r#"{"time":1}"#, r#"{"blocks":{}}"#] {
        match block_on(runtime().seed(&Doc::new(Options::default()), &parse(body))) {
            Err(Error::Data(_)) => {}
            other => panic!("{body}: {other:?}"),
        }
    }
}

#[test]
fn export_reads_legacy_html_text_as_segments() {
    let doc = Doc::new(Options::default());
    let nested = Map::new(vec![
        entry("type", string("paragraph")),
        entry("data", Map::new(vec![entry("text", string("<i>n</i>"))])),
    ]);
    let properties = Map::new(vec![entry(
        "notes",
        Map::new(vec![entry(
            "blocks",
            blok_yjs::Array::new(vec![nested.into()]),
        )]),
    )]);
    let blocks = doc.get_map("blocks").unwrap_or_else(|err| panic!("{err}"));
    let root = doc.get_array("root").unwrap_or_else(|err| panic!("{err}"));
    doc.transact(|txn| {
        blocks.set(
            txn,
            "a",
            new_block(
                "a",
                "paragraph",
                Map::new(vec![entry("text", Text::new(Some(s("<b>x</b>"))))]),
            ),
        )?;
        blocks.set(
            txn,
            "r",
            new_block(
                "r",
                "database-row",
                Map::new(vec![entry("properties", properties.clone())]),
            ),
        )?;
        root.insert(txn, 0, vec![string("a").into(), string("r").into()])
    })
    .unwrap_or_else(|err| panic!("{err}"));
    let exported =
        Value::Object(block_on(runtime().export(&doc)).unwrap_or_else(|err| panic!("{err}")));
    let blocks = path(&exported, &[Key::Name("blocks")]);
    assert_eq!(
        json(path(
            blocks,
            &[Key::At(0), Key::Name("data"), Key::Name("text")]
        )),
        r#"[{"text":"x","marks":{"bold":true}}]"#
    );
    assert_eq!(
        json(path(
            blocks,
            &[
                Key::At(1),
                Key::Name("data"),
                Key::Name("properties"),
                Key::Name("notes"),
                Key::Name("blocks"),
                Key::At(0),
                Key::Name("data"),
                Key::Name("text"),
            ]
        )),
        r#"[{"text":"n","marks":{"italic":true}}]"#
    );
}

#[test]
fn custom_rich_fields_come_from_the_constructor() {
    let fields = RichTextFields::new(&[RichTextFieldEntry {
        kind: s("callout"),
        fields: Some(vec![s("title")]),
    }])
    .unwrap_or_else(|err| panic!("{err}"));
    let doc = Doc::new(Options::default());
    let mut c = runtime();
    c.fields = Some(fields);
    block_on(c.seed(
        &doc,
        &parse(r#"{"blocks":[{"id":"c","type":"callout","data":{"title":"<u>T</u>"}}]}"#),
    ))
    .unwrap_or_else(|err| panic!("{err}"));
    let title = doc
        .get_map("blocks")
        .unwrap_or_else(|err| panic!("{err}"))
        .get("c")
        .and_then(|block| block.as_map())
        .and_then(|block| block.get("data"))
        .and_then(|data| data.as_map())
        .and_then(|data| data.get("title"));
    assert!(
        title.as_ref().and_then(|t| t.as_xml_text()).is_some(),
        "{title:?}"
    );
}

/// Answers every read with the error `make` builds.
pub(crate) struct FailingReader(pub(crate) fn() -> Error);

impl HtmlReader for FailingReader {
    async fn read(&self, _: &[RichTextHtml], _: Duration) -> Result<Vec<Vec<Value>>, Error> {
        Err((self.0)())
    }
}

fn failure(kind: Kind, message: &str) -> Error {
    Error::Runtime(InvokeError::Failure(Failure {
        kind,
        err: RuntimeError::Engine(message.to_owned()),
    }))
}

fn kind_of(err: &Error) -> Option<Kind> {
    match err {
        Error::Runtime(InvokeError::Failure(failure)) => Some(failure.kind),
        _ => None,
    }
}

/// The same error: the same variant, kind and text.
fn same_error(got: &Error, want: &Error) -> bool {
    std::mem::discriminant(got) == std::mem::discriminant(want)
        && kind_of(got) == kind_of(want)
        && got.to_string() == want.to_string()
}

fn transient(result: Result<impl std::fmt::Debug, Error>) -> TransientError {
    match result {
        Err(Error::Transient(err)) => err,
        other => panic!("{other:?}"),
    }
}

fn edit_error(result: Result<(), Error>) -> EditError {
    match result {
        Err(Error::Edit(err)) => err,
        other => panic!("{other:?}"),
    }
}

#[test]
fn an_export_runtime_limit_is_transient() {
    let makers: [fn() -> Error; 2] = [
        || failure(Kind::TimedOut, "limit"),
        || failure(Kind::DocumentTooLarge, "limit"),
    ];
    for make in makers {
        let got = transient(block_on(
            converter(FailingReader(make)).export(&legacy_html_doc()),
        ));
        assert!(same_error(&got.err, &make()), "{:?}", got.err);
    }
}

#[test]
#[ignore = "Rust has no cancelled-elsewhere error: blok_jsruntime::Pool::invoke is cancelled only by dropping its future, and a lost engine is Kind::Unknown"]
fn an_engine_pool_wait_cancelled_elsewhere_is_transient() {}

#[test]
fn an_export_failure_that_repeats_is_not_transient() {
    let makers: [fn() -> Error; 4] = [
        || failure(Kind::InvalidDocument, "TypeError"),
        || failure(Kind::Unknown, "RangeError"),
        || {
            Error::Data(DataError::new(
                "collab: the runtime answered htmlFieldsToSegments with the wrong shape.",
            ))
        },
        || Error::Message("not the runtime's own classification".to_owned()),
    ];
    for make in makers {
        match block_on(converter(FailingReader(make)).export(&legacy_html_doc())) {
            Err(err) if same_error(&err, &make()) => {}
            other => panic!("{}: {other:?}", make()),
        }
    }
}

/// A read that never answers and records that its future was dropped.
#[derive(Default)]
pub(crate) struct PendingReader {
    pub(crate) dropped: Arc<AtomicBool>,
}

struct Forever(Arc<AtomicBool>);

impl Future for Forever {
    type Output = Result<Vec<Vec<Value>>, Error>;

    fn poll(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Self::Output> {
        Poll::Pending
    }
}

impl Drop for Forever {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

impl HtmlReader for PendingReader {
    fn read(
        &self,
        _: &[RichTextHtml],
        _: Duration,
    ) -> impl Future<Output = Result<Vec<Vec<Value>>, Error>> + Send {
        Forever(self.dropped.clone())
    }
}

/// Polls once, expects a wait, then drops the call: the caller's cancel.
pub(crate) fn poll_then_drop<F: Future>(future: F) {
    let mut future = Box::pin(future);
    let mut cx = Context::from_waker(Waker::noop());
    assert!(
        future.as_mut().poll(&mut cx).is_pending(),
        "it did not wait"
    );
}

// Go's ctx cancel is dropping the future here: the read's own future must
// go with it, and nothing comes back to classify.
#[test]
fn an_export_cancelled_by_its_token_stays_a_cancel() {
    let c = converter(PendingReader::default());
    let doc = legacy_html_doc();
    poll_then_drop(c.export(&doc));
    assert!(c.html.dropped.load(Ordering::SeqCst));
}

#[derive(Default)]
pub(crate) struct RecordingReader {
    pub(crate) timeouts: Mutex<Vec<Duration>>,
}

impl HtmlReader for RecordingReader {
    async fn read(
        &self,
        fields: &[RichTextHtml],
        timeout: Duration,
    ) -> Result<Vec<Vec<Value>>, Error> {
        self.timeouts.lock().unwrap().push(timeout);
        Ok(vec![Vec::new(); fields.len()])
    }
}

// Twin of SeedAndMigrationReadWithTheOneTimeBudget.
#[test]
fn seed_and_migration_read_with_the_one_time_budget() {
    let c = converter(RecordingReader::default());
    block_on(c.seed(
        &Doc::new(Options::default()),
        &parse(r#"{"blocks":[{"id":"a","type":"paragraph","data":{"text":"<b>x</b>"}}]}"#),
    ))
    .unwrap_or_else(|err| panic!("{err}"));
    block_on(c.export(&legacy_html_doc())).unwrap_or_else(|err| panic!("{err}"));
    block_on(c.apply_ops(
        &legacy_html_doc(),
        &ops(&[r#"{"op":"update","id":"a","data":{"text":"<i>y</i>"}}"#]),
    ))
    .unwrap_or_else(|err| panic!("{err}"));
    let migrated =
        block_on(c.migrate_rich_text(&legacy_html_doc())).unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(migrated, 1);
    assert_eq!(
        *c.html.timeouts.lock().unwrap(),
        [
            MIGRATION_READ_TIMEOUT,
            Duration::ZERO,
            Duration::ZERO,
            MIGRATION_READ_TIMEOUT
        ]
    );
    assert_eq!(MIGRATION_READ_TIMEOUT, Duration::from_secs(60));
}

fn counted_updates(doc: &Doc) -> Arc<AtomicUsize> {
    let updates = Arc::new(AtomicUsize::new(0));
    let sink = updates.clone();
    let _ = doc.on_update(move |_| {
        sink.fetch_add(1, Ordering::SeqCst);
    });
    updates
}

// Twin of AnEditThatOnlyRespellsTheHtmlWritesNothing. The C# edit holds a
// literal U+00A0 where the seed spells &nbsp;.
#[test]
fn an_edit_that_only_respells_the_html_writes_nothing() {
    let c = runtime();
    let doc = Doc::new(Options::default());
    block_on(c.seed(
        &doc,
        &parse(
            r#"{"blocks":[{"id":"a","type":"paragraph","data":{"text":"<strong>x</strong>&nbsp;<a href=\"h\" target=\"_blank\">y</a>"}}]}"#,
        ),
    ))
    .unwrap_or_else(|err| panic!("{err}"));
    let updates = counted_updates(&doc);
    block_on(c.apply_ops(
        &doc,
        &ops(&[
            r#"{"op":"update","id":"a","data":{"text":"<b>x</b> <a target=\"_blank\" href=\"h\">y</a><br>"}}"#,
        ]),
    ))
    .unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(updates.load(Ordering::SeqCst), 0);
}

// Twin of AnEditReadsHtmlForTheBlocksTypeInTheDoc.
#[test]
fn an_edit_reads_html_for_the_blocks_type_in_the_doc() {
    let c = runtime();
    let doc = Doc::new(Options::default());
    block_on(c.seed(
        &doc,
        &parse(r#"{"blocks":[{"id":"a","type":"header","data":{"text":"x","level":2}}]}"#),
    ))
    .unwrap_or_else(|err| panic!("{err}"));
    block_on(c.apply_ops(
        &doc,
        &ops(&[r#"{"op":"update","id":"a","data":{"text":"x <i>y</i>","level":2}}"#]),
    ))
    .unwrap_or_else(|err| panic!("{err}"));
    let exported = Value::Object(block_on(c.export(&doc)).unwrap_or_else(|err| panic!("{err}")));
    assert_eq!(
        json(path(
            &exported,
            &[
                Key::Name("blocks"),
                Key::At(0),
                Key::Name("data"),
                Key::Name("text")
            ]
        )),
        r#"[{"text":"x "},{"text":"y","marks":{"italic":true}}]"#
    );
}

fn update_text(text: &str) -> String {
    format!(r#"{{"op":"update","id":"a","data":{{"text":"{text}"}}}}"#)
}

// Twin of AnEditHtmlFieldPastTheCapIsRefusedAsTooLargeBeforeAnyRead.
#[test]
fn an_edit_html_field_past_the_cap_is_refused_as_too_large_before_any_read() {
    let c = converter(RecordingReader::default());
    let at_cap = "x".repeat(MAX_EDIT_HTML_CHARS);
    block_on(c.apply_ops(&legacy_html_doc(), &ops(&[&update_text(&at_cap)])))
        .unwrap_or_else(|err| panic!("{err}"));
    let edit = edit_error(block_on(c.apply_ops(
        &legacy_html_doc(),
        &ops(&[&update_text(&format!("{at_cap}y"))]),
    )));
    // The room maps exactly this inner failure to 413.
    assert!(
        edit.err.as_deref().is_some_and(is_too_large),
        "{:?}",
        edit.err
    );
    assert_eq!(
        edit.message,
        r#"collab: rich text field "paragraph.text" holds 32769 HTML characters; an edit may send at most 32768."#
    );
    assert_eq!(c.html.timeouts.lock().unwrap().len(), 1);
}

// The cap counts UTF-16 units, as string.Length does.
#[test]
fn the_edit_cap_counts_utf16_units() {
    let c = converter(RecordingReader::default());
    let astral = "😀".repeat(MAX_EDIT_HTML_CHARS / 2);
    block_on(c.apply_ops(&legacy_html_doc(), &ops(&[&update_text(&astral)])))
        .unwrap_or_else(|err| panic!("{err}"));
    let edit = edit_error(block_on(c.apply_ops(
        &legacy_html_doc(),
        &ops(&[&update_text(&format!("{astral}x"))]),
    )));
    assert!(
        edit.err.as_deref().is_some_and(is_too_large),
        "{:?}",
        edit.err
    );
}

// ApplyOpsAsync's catches: a runtime limit is a retry (except the memory
// budget, which the same body hits again), anything else refuses this one
// request, and a cancel by the caller stays a cancel.
#[test]
fn an_edit_read_failure_is_a_retry_or_a_refusal() {
    let update = r#"{"op":"update","id":"a","data":{"text":"<i>y</i>"}}"#;
    let timed_out = || failure(Kind::TimedOut, "slow");
    let got = transient(block_on(
        converter(FailingReader(timed_out)).apply_ops(&legacy_html_doc(), &ops(&[update])),
    ));
    assert!(same_error(&got.err, &timed_out()), "{:?}", got.err);
    assert_eq!(
        got.message,
        format!(
            "collab: reading the rich text HTML in this edit ran past the runtime's limits: {}",
            timed_out()
        )
    );
    let makers: [fn() -> Error; 3] = [
        || failure(Kind::DocumentTooLarge, "budget"),
        || failure(Kind::InvalidDocument, "TypeError"),
        || Error::Message("anything else".to_owned()),
    ];
    for make in makers {
        let edit = edit_error(block_on(
            converter(FailingReader(make)).apply_ops(&legacy_html_doc(), &ops(&[update])),
        ));
        assert!(
            edit.err
                .as_deref()
                .is_some_and(|err| same_error(err, &make())),
            "{}: {:?}",
            make(),
            edit.err
        );
        assert_eq!(
            edit.message,
            format!(
                "collab: the rich text HTML in this edit could not be read: {}",
                make()
            )
        );
    }
    let c = converter(PendingReader::default());
    let doc = legacy_html_doc();
    let before = doc.encode_state_vector();
    poll_then_drop(c.apply_ops(&doc, &ops(&[update])));
    assert!(c.html.dropped.load(Ordering::SeqCst));
    assert_eq!(doc.encode_state_vector(), before);
}

struct CountingReader<R> {
    inner: R,
    fields: AtomicUsize,
}

impl<R: HtmlReader + Sync> HtmlReader for CountingReader<R> {
    async fn read(
        &self,
        fields: &[RichTextHtml],
        timeout: Duration,
    ) -> Result<Vec<Vec<Value>>, Error> {
        self.fields.fetch_add(fields.len(), Ordering::SeqCst);
        self.inner.read(fields, timeout).await
    }
}

// One HTML string read once, however many slots hold it; "" needs no runtime.
#[test]
fn each_distinct_html_is_read_once() {
    let doc = Doc::new(Options::default());
    let blocks = doc.get_map("blocks").unwrap_or_else(|err| panic!("{err}"));
    let root = doc.get_array("root").unwrap_or_else(|err| panic!("{err}"));
    doc.transact(|txn| {
        for id in ["a", "b"] {
            blocks.set(
                txn,
                id,
                new_block(
                    id,
                    "paragraph",
                    Map::new(vec![entry("text", string("<b>x</b>"))]),
                ),
            )?;
        }
        blocks.set(
            txn,
            "e",
            new_block("e", "paragraph", Map::new(vec![entry("text", string(""))])),
        )?;
        root.insert(
            txn,
            0,
            vec![string("a").into(), string("b").into(), string("e").into()],
        )
    })
    .unwrap_or_else(|err| panic!("{err}"));
    let c = converter(CountingReader {
        inner: RecordingReader::default(),
        fields: AtomicUsize::new(0),
    });
    block_on(c.export(&doc)).unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(c.html.fields.load(Ordering::SeqCst), 1);
}

// The room spawns these on tokio, so their futures must be Send.
#[test]
fn the_converter_futures_are_send() {
    fn assert_send<T: Send>(_: &T) {}
    let c = runtime();
    let doc = Doc::new(Options::default());
    let node = parse(r#"{"blocks":[]}"#);
    let mut blocks: Vec<Value> = Vec::new();
    assert_send(&c.seed(&doc, &node));
    assert_send(&c.apply_ops(&doc, &[]));
    assert_send(&c.migrate_rich_text(&doc));
    assert_send(&c.export(&doc));
    assert_send(&c.resolve(&mut blocks, &[]));
}

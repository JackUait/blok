use std::future::Future;
use std::sync::Arc;
use std::task::{Context, Poll, Wake, Waker};
use std::thread::Thread;
use std::time::Duration;

use blok_jsjson::{Object, Str, Value};
use blok_jsruntime::{Options as PoolOptions, Pool};
use blok_yjs::{Doc, Options, Outcome};

use crate::export::{RichTextHtml, export};
use crate::export_test::canonical;
use crate::fields::RichTextFields;
use crate::htmlreader::{HtmlReader, RuntimeHtmlReader};
use crate::richtext::is;
use crate::richtext_test::{field, items, text};

const REPLAY_CLIENT_ID: u32 = 2;

struct Unpark(Thread);

impl Wake for Unpark {
    fn wake(self: Arc<Self>) {
        self.0.unpark();
    }
}

// The pool answers from its engine threads, so the read parks until woken.
pub(crate) fn block_on<F: Future>(future: F) -> F::Output {
    let mut future = std::pin::pin!(future);
    let waker = Waker::from(Arc::new(Unpark(std::thread::current())));
    let mut cx = Context::from_waker(&waker);
    loop {
        if let Poll::Ready(value) = future.as_mut().poll(&mut cx) {
            return value;
        }
        std::thread::park();
    }
}

fn read_all(reader: &RuntimeHtmlReader<Pool>, found: &[RichTextHtml]) -> Vec<Vec<Value>> {
    if found.is_empty() {
        return Vec::new();
    }
    block_on(reader.read(found, Duration::ZERO)).unwrap_or_else(|err| panic!("{err}"))
}

/// The (object path, key) of every HTML string in a built-in rich field, top
/// level or in a database-row's nested documents: RichTextRuntime.WithSegments.
fn html_fields(blocks: &[Value], at: &[Step], found: &mut Vec<(Vec<Step>, Str, Str)>) {
    let fields = RichTextFields::built_in();
    for (index, block) in blocks.iter().enumerate() {
        let Value::Object(entry) = block else {
            continue;
        };
        let (Some(Value::String(kind)), Some(Value::Object(data))) =
            (entry.get(&Str::from("type")), entry.get(&Str::from("data")))
        else {
            continue;
        };
        let mut path = at.to_vec();
        path.extend([Step::Index(index), Step::Key(Str::from("data"))]);
        for member in data.members() {
            if let Value::String(html) = &member.value
                && fields.is_rich(kind, &member.key)
            {
                found.push((path.clone(), member.key.clone(), html.clone()));
            }
        }
        if !is(kind, "database-row") {
            continue;
        }
        let Some(Value::Object(properties)) = data.get(&Str::from("properties")) else {
            continue;
        };
        for property in properties.members() {
            if let Value::Object(document) = &property.value
                && let Some(Value::Array(nested)) = document.get(&Str::from("blocks"))
            {
                let mut inner = path.clone();
                inner.extend([
                    Step::Key(Str::from("properties")),
                    Step::Key(property.key.clone()),
                    Step::Key(Str::from("blocks")),
                ]);
                html_fields(nested, &inner, found);
            }
        }
    }
}

#[derive(Clone)]
enum Step {
    Index(usize),
    Key(Str),
}

fn object_at<'a>(root: &'a mut Value, path: &[Step]) -> &'a mut Object {
    let mut at = root;
    for step in path {
        at = match (step, at) {
            (Step::Index(index), Value::Array(items)) => &mut items[*index],
            (Step::Key(key), Value::Object(object)) => object
                .get_mut(key)
                .unwrap_or_else(|| panic!("no key {key}")),
            _ => panic!("the path leaves the JSON"),
        };
    }
    match at {
        Value::Object(object) => object,
        other => panic!("not an object: {other:?}"),
    }
}

fn with_segments(reader: &RuntimeHtmlReader<Pool>, blocks: &Value) -> Value {
    let mut copy = blocks.clone();
    let mut found = Vec::new();
    html_fields(items(&copy), &[], &mut found);
    // WithSegments reads every string as a paragraph's text.
    let html: Vec<RichTextHtml> = found
        .iter()
        .map(|(_, _, html)| RichTextHtml {
            kind: Str::from("paragraph"),
            field: Str::from("text"),
            html: html.clone(),
        })
        .collect();
    for ((path, key, _), segments) in found.iter().zip(read_all(reader, &html)) {
        object_at(&mut copy, path).set(key.clone(), Value::Array(segments));
    }
    copy
}

/// RichTextRuntime.Export: the export with its legacy HTML slots read.
fn export_resolved(reader: &RuntimeHtmlReader<Pool>, doc: &Doc) -> Value {
    let (mut blocks, slots) =
        export(doc, &RichTextFields::built_in(), None).unwrap_or_else(|err| panic!("{err}"));
    let html: Vec<RichTextHtml> = slots.iter().map(|slot| slot.html.clone()).collect();
    for (slot, segments) in slots.iter().zip(read_all(reader, &html)) {
        slot.target_mut(&mut blocks)
            .unwrap_or_else(|| panic!("a slot names no object"))
            .set(slot.key.clone(), Value::Array(segments));
    }
    Value::Array(blocks)
}

// C# YrsCompatCorpusTests.CapturedUpdatesApplyIntoTheEngineAndExportTheCanonicalJson.
#[test]
fn captured_updates_apply_into_the_engine_and_export_the_canonical_json() {
    let reader = RuntimeHtmlReader {
        runtime: Pool::new(PoolOptions {
            pool_size: 2,
            ..PoolOptions::default()
        })
        .unwrap_or_else(|err| panic!("{err}")),
    };
    let cases = blok_yjs_yjstest::cases("yrs-compat.json").unwrap_or_else(|err| panic!("{err}"));
    assert!(!cases.is_empty());
    let mut failures = Vec::new();
    for entry in &cases {
        let name = text(field(entry, "name"));
        let update = blok_yjs_yjstest::bytes(entry, "update").unwrap_or_else(|err| panic!("{err}"));
        let doc = Doc::new(Options {
            client_id: Some(REPLAY_CLIENT_ID),
            ..Options::default()
        });
        let outcome = doc
            .apply_update(&update)
            .unwrap_or_else(|err| panic!("{name}: {err}"))
            .outcome;
        assert_eq!(outcome, Outcome::Applied, "{name}");

        let expected = canonical(&with_segments(&reader, field(entry, "canonical")));
        let actual = canonical(&export_resolved(&reader, &doc));
        if expected != actual {
            failures.push(format!(
                "{name}: replaying the yrs update does not export the canonical JSON.\n\
                 expected: {expected}\nactual:   {actual}"
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

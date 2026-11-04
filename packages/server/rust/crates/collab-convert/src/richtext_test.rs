use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use blok_collab_collabtest::read;
use blok_jsjson::{Object, Str, Value, stringify};
use blok_yjs::{Delta, Doc, Options, Out, XmlText};

use crate::richtext::{canonicalize, from_delta, normalize, read_input, to_write_ops};
use crate::richtextedit::{RichTextOp, apply_rich_text_ops, plan_rich_text_edit};

pub(crate) fn field<'a>(value: &'a Value, key: &str) -> &'a Value {
    match value {
        Value::Object(object) => object.get(&Str::from(key)).unwrap_or(&Value::Undefined),
        _ => &Value::Undefined,
    }
}

pub(crate) fn items(value: &Value) -> &[Value] {
    match value {
        Value::Array(items) => items,
        other => panic!("not an array: {other:?}"),
    }
}

pub(crate) fn text(value: &Value) -> String {
    match value {
        Value::String(text) => text.to_string(),
        other => panic!("not a string: {other:?}"),
    }
}

pub(crate) fn json(value: &Value) -> String {
    stringify(value).unwrap_or_else(|err| panic!("{err}"))
}

pub(crate) fn json_array(values: Vec<Value>) -> String {
    json(&Value::Array(values))
}

fn delta_of(input: &Value) -> Vec<Delta> {
    items(input)
        .iter()
        .map(|op| Delta {
            insert: Out::Any(field(op, "insert").clone()),
            attributes: match field(op, "attributes") {
                Value::Object(attributes) => Some(attributes.clone()),
                _ => None,
            },
        })
        .collect()
}

#[test]
fn canonicalizes_rich_text_like_the_client() {
    let inputs = read("rich-text-canonical/inputs.json");
    let expected = read("rich-text-canonical/expected.json");
    let mut count = 0;
    let mut failures = Vec::new();
    for entry in items(field(&inputs, "segments")) {
        let name = text(field(entry, "name"));
        let want = json(field(field(&expected, "segments"), &name));
        let got = json_array(canonicalize(items(field(entry, "input"))));
        if got != want {
            failures.push(format!("segments {name}:\n got {got}\nwant {want}"));
        }
        count += 1;
    }
    for entry in items(field(&inputs, "deltas")) {
        let name = text(field(entry, "name"));
        let want = json(field(field(&expected, "deltas"), &name));
        let got = json_array(from_delta(&delta_of(field(entry, "input"))));
        if got != want {
            failures.push(format!("deltas {name}:\n got {got}\nwant {want}"));
        }
        count += 1;
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    assert!(count >= 30, "only {count} cases");
}

#[test]
fn read_input_normalises_malformed_values_like_canonicalize() {
    let inputs = read("rich-text-canonical/inputs.json");
    let expected = read("rich-text-canonical/expected.json");
    let mut count = 0;
    let mut failures = Vec::new();
    for entry in items(field(&inputs, "segments")) {
        let name = text(field(entry, "name"));
        if !name.starts_with("malformed-") {
            continue;
        }
        let want = json(field(field(&expected, "segments"), &name));
        let got = json_array(read_input(items(field(entry, "input"))));
        if got != want {
            failures.push(format!("segments {name}:\n got {got}\nwant {want}"));
        }
        count += 1;
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    assert!(count >= 20, "only {count} malformed cases");
}

#[test]
fn from_delta_never_changes_the_delta_it_reads() {
    let mut link = Object::new();
    link.set(Str::from("rel"), Value::String(Str::from("r")));
    link.set(Str::from("href"), Value::String(Str::from("h")));
    let mut attributes = Object::new();
    attributes.set(Str::from("link"), Value::Object(link));
    attributes.set(Str::from("bold"), Value::Bool(true));
    let before = json(&Value::Object(attributes.clone()));
    let delta = vec![Delta {
        insert: Out::Any(Value::String(Str::from("a"))),
        attributes: Some(attributes),
    }];
    from_delta(&delta);
    let marks = Value::Object(delta[0].attributes.clone().unwrap_or_default());
    normalize(Some(&marks));
    assert_eq!(
        json(&Value::Object(
            delta[0].attributes.clone().unwrap_or_default()
        )),
        before
    );
    assert_eq!(json(&marks), before);
}

#[test]
fn plans_and_applies_every_rich_text_edit_fixture() {
    let cases = read("rich-text-edits/cases.json");
    let cases = items(&cases);
    assert!(cases.len() >= 20, "only {} cases", cases.len());
    let mut failures = Vec::new();
    for entry in cases {
        let name = text(field(entry, "name"));
        let doc = Doc::new(Options::default());
        let live = XmlText::new(None);
        let seed = to_write_ops(&canonicalize(items(field(entry, "current"))))
            .unwrap_or_else(|err| panic!("{name}: {err}"));
        doc.transact(|txn| {
            doc.get_map("blocks")?.set(txn, "b1", &live)?;
            let mut index = 0;
            for op in &seed {
                match &op.insert {
                    Value::String(insert) => {
                        live.insert(Some(txn), index, insert.clone(), Some(&op.attributes))?
                    }
                    embed => {
                        live.insert_embed(Some(txn), index, embed.clone(), Some(&op.attributes))?
                    }
                }
                index += op.length() as i64;
            }
            Ok(())
        })
        .unwrap_or_else(|err| panic!("{name}: {err}"));
        let next = read_input(items(field(entry, "next")));
        let ops = plan_rich_text_edit(&live.to_delta(), &next);
        let (got, want) = (
            json_array(rich_text_ops_json(&ops)),
            json(field(entry, "ops")),
        );
        if got != want {
            failures.push(format!("{name}: ops\n got {got}\nwant {want}"));
            continue;
        }
        let expected = field(entry, "expected");
        let updates = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&updates);
        let subscription = doc.on_update(move |_| {
            counter.fetch_add(1, Ordering::SeqCst);
        });
        if !ops.is_empty() {
            doc.transact(|txn| apply_rich_text_ops(txn, &live, &ops))
                .unwrap_or_else(|err| panic!("{name}: {err}"));
        }
        subscription.unsubscribe();
        let updates = updates.load(Ordering::SeqCst);
        let want_writes = matches!(field(expected, "writes"), Value::Bool(true));
        if (updates == 1) != want_writes || updates > 1 {
            failures.push(format!("{name}: {updates} updates, writes={want_writes}"));
        }
        let (got, want) = (
            json_array(delta_json(&live.to_delta())),
            json(field(expected, "delta")),
        );
        if got != want {
            failures.push(format!("{name}: delta\n got {got}\nwant {want}"));
        }
        let (got, want) = (
            json_array(from_delta(&live.to_delta())),
            json(field(expected, "segments")),
        );
        if got != want {
            failures.push(format!("{name}: segments\n got {got}\nwant {want}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

fn set(object: &mut Object, key: &str, value: Value) {
    object.set(Str::from(key), value);
}

fn rich_text_ops_json(ops: &[RichTextOp]) -> Vec<Value> {
    ops.iter()
        .map(|op| {
            let mut json = Object::new();
            let s = |text: &str| Value::String(Str::from(text));
            match op {
                RichTextOp::Insert {
                    index,
                    text,
                    attributes,
                } => {
                    set(&mut json, "op", s("insert"));
                    set(&mut json, "index", Value::Number(*index as f64));
                    set(&mut json, "text", Value::String(text.clone()));
                    set(&mut json, "attributes", Value::Object(attributes.clone()));
                }
                RichTextOp::InsertEmbed {
                    index,
                    embed,
                    attributes,
                } => {
                    set(&mut json, "op", s("insertEmbed"));
                    set(&mut json, "index", Value::Number(*index as f64));
                    set(&mut json, "embed", Value::Object(embed.clone()));
                    set(&mut json, "attributes", Value::Object(attributes.clone()));
                }
                RichTextOp::Delete { index, length } => {
                    set(&mut json, "op", s("delete"));
                    set(&mut json, "index", Value::Number(*index as f64));
                    set(&mut json, "length", Value::Number(*length as f64));
                }
                RichTextOp::Format {
                    index,
                    length,
                    attributes,
                } => {
                    set(&mut json, "op", s("format"));
                    set(&mut json, "index", Value::Number(*index as f64));
                    set(&mut json, "length", Value::Number(*length as f64));
                    set(&mut json, "attributes", Value::Object(attributes.clone()));
                }
            }
            Value::Object(json)
        })
        .collect()
}

pub(crate) fn delta_json(delta: &[Delta]) -> Vec<Value> {
    delta
        .iter()
        .map(|op| {
            let mut json = Object::new();
            let insert = match &op.insert {
                Out::Any(value) => value.clone(),
                other => panic!("not a JSON insert: {other:?}"),
            };
            set(&mut json, "insert", insert);
            if let Some(attributes) = &op.attributes {
                set(&mut json, "attributes", Value::Object(attributes.clone()));
            }
            Value::Object(json)
        })
        .collect()
}

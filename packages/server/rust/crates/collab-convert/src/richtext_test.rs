use blok_collab_collabtest::read;
use blok_jsjson::{Object, Str, Value, stringify};
use blok_yjs::{Delta, Out};

use crate::richtext::{canonicalize, from_delta, normalize, read_input};

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

fn json_array(values: Vec<Value>) -> String {
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

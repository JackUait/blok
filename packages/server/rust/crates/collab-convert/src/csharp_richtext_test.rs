use std::sync::{Arc, Mutex};

use blok_collab_collabtest::read;
use blok_jsjson::{Object, Options as JsonOptions, Str, Value, parse_node, stringify};
use blok_yjs::{Doc, Options, XmlText};

use crate::apply::apply_ops;
use crate::editops::parse_edit_ops;
use crate::export::BLOCKS_ROOT;
use crate::fields::RichTextFields;
use crate::richtext::from_delta;
use crate::richtext_test::{delta_json, field, items, json, json_array, text};
use crate::richtextinput::RichTextInput;
use crate::seed::seed;

#[test]
fn the_shared_fixture_holds_the_malformed_cases() {
    let inputs = read("rich-text-canonical/inputs.json");
    let malformed = |group: &str| {
        items(field(&inputs, group))
            .iter()
            .filter(|entry| text(field(entry, "name")).starts_with("malformed-"))
            .count()
    };
    assert!(malformed("segments") >= 20);
    assert!(malformed("deltas") > 0);
}

fn text_data(segments: &Value) -> String {
    let mut data = Object::new();
    data.set(Str::from("text"), segments.clone());
    stringify(&Value::Object(data)).unwrap_or_else(|err| panic!("{err}"))
}

fn live_text(doc: &Doc) -> XmlText {
    doc.get_map(BLOCKS_ROOT)
        .unwrap_or_else(|err| panic!("{err}"))
        .get("b1")
        .and_then(|block| block.as_map())
        .and_then(|block| block.get("data"))
        .and_then(|data| data.as_map())
        .and_then(|data| data.get("text"))
        .and_then(|text| text.as_xml_text())
        .unwrap_or_else(|| panic!("no formatted text"))
}

// C# RichTextEditFixtureTests.AnUpdateLeavesTheDeltaYjsLeaves: the same
// (current, next) pairs through Seed and ApplyOps leave the delta and
// segments the TS suite pins in real yjs.
#[test]
fn an_update_leaves_the_delta_yjs_leaves() {
    let cases = read("rich-text-edits/cases.json");
    let fields = RichTextFields::built_in();
    let mut failures = Vec::new();
    for entry in items(&cases) {
        let name = text(field(entry, "name"));
        let expected = field(entry, "expected");
        let block = format!(
            r#"{{ "id": "b1", "type": "paragraph", "data": {} }}"#,
            text_data(field(entry, "current"))
        );
        let block = parse_node(block.as_bytes(), JsonOptions::default())
            .unwrap_or_else(|err| panic!("{name}: {err}"));
        let doc = Doc::new(Options::default());
        seed(&doc, &[block], &mut RichTextInput::refusing(&fields), None)
            .unwrap_or_else(|err| panic!("{name}: {err}"));
        let updates = Arc::new(Mutex::new(0));
        let sink = Arc::clone(&updates);
        let _subscription = doc.on_update(move |_| {
            *sink.lock().unwrap_or_else(|err| panic!("{err}")) += 1;
        });
        let body = format!(
            r#"{{ "ops": [{{ "op": "update", "id": "b1", "data": {} }}] }}"#,
            text_data(field(entry, "next"))
        );
        let ops = parse_edit_ops(body.as_bytes()).unwrap_or_else(|err| panic!("{name}: {err}"));
        apply_ops(&doc, &ops, &mut RichTextInput::refusing(&fields))
            .unwrap_or_else(|err| panic!("{name}: {err}"));
        // The no-write assertion first: it is what the "writes" flag exists for.
        let updates = *updates.lock().unwrap_or_else(|err| panic!("{err}"));
        let want = usize::from(matches!(field(expected, "writes"), Value::Bool(true)));
        if updates != want {
            failures.push(format!("{name}: {updates} updates, want {want}"));
            continue;
        }
        let live = live_text(&doc);
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

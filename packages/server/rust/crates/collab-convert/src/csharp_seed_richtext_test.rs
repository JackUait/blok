use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use blok_jsjson::{Node, Object, Options as JsonOptions, Str, Value, parse, parse_node, stringify};
use blok_yjs::{Array, Doc, In, Map, MapEntry, Options, Out, Text, XmlText};

use crate::apply::{apply_ops, collect_ops_html};
use crate::editops::{EditOp, parse_edit_ops};

use crate::error::Error;
use crate::export::{BLOCKS_ROOT, RichTextHtml, export};
use crate::fields::{RichTextFieldEntry, RichTextFields};
use crate::richtext_test::field;
use crate::richtextinput::RichTextInput;
use crate::seed::{collect_seed_html, seed};

// Format 2: a rich (type, key) is a formatted Y.XmlText holding segments,
// and every reader decides by class (C# YDocConverterRichTextTests).

fn blocks(blocks: &[&str]) -> Vec<Node> {
    blocks
        .iter()
        .map(|block| {
            parse_node(block.as_bytes(), JsonOptions::default())
                .unwrap_or_else(|err| panic!("{err}"))
        })
        .collect()
}

fn try_seeded(json: &[&str]) -> Result<Doc, Error> {
    let doc = Doc::new(Options::default());
    let fields = RichTextFields::built_in();
    seed(
        &doc,
        &blocks(json),
        &mut RichTextInput::refusing(&fields),
        None,
    )?;
    Ok(doc)
}

fn seeded(json: &[&str]) -> Doc {
    try_seeded(json).unwrap_or_else(|err| panic!("{err}"))
}

fn data_value(doc: &Doc, id: &str, key: &str) -> Option<Out> {
    doc.get_map(BLOCKS_ROOT)
        .unwrap_or_else(|err| panic!("{err}"))
        .get(id)
        .and_then(|block| block.as_map())
        .and_then(|block| block.get("data"))
        .and_then(|data| data.as_map())
        .and_then(|data| data.get(key))
}

/// C# YDocConverter.Export(doc): built-in fields, and HTML left over throws.
fn exported(doc: &Doc, fields: &RichTextFields) -> Vec<Value> {
    let (blocks, slots) = export(doc, fields, None).unwrap_or_else(|err| panic!("{err}"));
    assert!(slots.is_empty(), "{} HTML slots", slots.len());
    blocks
}

fn data_field(doc: &Doc, fields: &RichTextFields, id: &str, key: &str) -> Value {
    let block = exported(doc, fields)
        .into_iter()
        .find(|block| matches!(field(block, "id"), Value::String(text) if text.to_string() == id))
        .unwrap_or_else(|| panic!("no block {id}"));
    field(field(&block, "data"), key).clone()
}

fn json(value: &Value) -> String {
    stringify(value).unwrap_or_else(|err| panic!("{err}"))
}

fn text(doc: &Doc, id: &str) -> String {
    json(&data_field(doc, &RichTextFields::built_in(), id, "text"))
}

fn is_xml_text(value: Option<Out>) -> bool {
    value.is_some_and(|value| value.as_xml_text().is_some())
}

fn callout_fields() -> RichTextFields {
    RichTextFields::new(&[RichTextFieldEntry {
        kind: Str::from("callout"),
        fields: Some(vec![Str::from("title")]),
    }])
    .unwrap_or_else(|err| panic!("{err}"))
}

#[test]
fn seeds_segments_as_formatted_text_and_exports_them_canonical() {
    let doc = seeded(&[r#"{ "id": "b1", "type": "paragraph", "data": { "text": [
          { "text": "Hi " },
          { "text": "bold", "marks": { "italic": true, "bold": true } },
          { "embed": { "page": { "id": "p1" } } },
          { "text": "" },
          { "text": "x", "marks": { "link": { "rel": "r", "href": "h" } } }
        ] } }"#]);
    assert!(is_xml_text(data_value(&doc, "b1", "text")));
    assert_eq!(
        text(&doc, "b1"),
        r#"[{"text":"Hi "},{"text":"bold","marks":{"bold":true,"italic":true}},{"embed":{"page":{"id":"p1"}}},{"text":"x","marks":{"link":{"href":"h","rel":"r"}}}]"#
    );
}

#[test]
fn stores_each_mark_as_its_own_attribute_with_sorted_keys() {
    let doc = seeded(&[r#"{ "id": "b1", "type": "paragraph", "data": { "text": [
          { "text": "x", "marks": { "link": { "target": "_blank", "href": "h" }, "bold": true } }
        ] } }"#]);
    let delta = data_value(&doc, "b1", "text")
        .and_then(|text| text.as_xml_text())
        .unwrap_or_else(|| panic!("not formatted text"))
        .to_delta();
    assert_eq!(delta.len(), 1);
    let attributes = delta[0].attributes.clone().unwrap_or_default();
    assert_eq!(
        json(&Value::Object(attributes)),
        r#"{"bold":true,"link":{"href":"h","target":"_blank"}}"#
    );
}

#[test]
fn markup_characters_typed_as_text_stay_text() {
    let doc = seeded(&[
        r#"{ "id": "b1", "type": "paragraph", "data": { "text": [{ "text": "a < b && \"c\" <b>x</b>" }] } }"#,
    ]);
    assert_eq!(text(&doc, "b1"), r#"[{"text":"a < b && \"c\" <b>x</b>"}]"#);
}

#[test]
fn empty_paragraph_data_becomes_an_empty_formatted_text() {
    let doc = seeded(&[r#"{ "id": "b1", "type": "paragraph", "data": {} }"#]);
    assert!(is_xml_text(data_value(&doc, "b1", "text")));
    assert_eq!(text(&doc, "b1"), "[]");
}

#[test]
fn drops_mark_keys_the_client_cannot_render() {
    let doc = seeded(&[r#"{ "id": "b1", "type": "paragraph", "data": { "text": [
          { "text": "x", "marks": { "bold": true, "glow": true, "tag:bad name": {}, "tag:abbr": { "title": "t" } } }
        ] } }"#]);
    assert_eq!(
        text(&doc, "b1"),
        r#"[{"text":"x","marks":{"bold":true,"tag:abbr":{"title":"t"}}}]"#
    );
}

#[test]
fn reads_an_array_that_is_not_segments_leniently() {
    let doc = seeded(&[r#"{ "id": "b1", "type": "paragraph", "data": { "text": [
          { "text": "a", "checked": true }, 5, { "embed": "no" }, { "text": "b", "marks": { "bold": true } }
        ] } }"#]);
    assert_eq!(
        text(&doc, "b1"),
        r#"[{"text":"a"},{"text":"b","marks":{"bold":true}}]"#
    );
}

#[test]
fn refuses_html_that_no_converter_read() {
    match try_seeded(&[r#"{ "id": "b1", "type": "paragraph", "data": { "text": "<b>x</b>" } }"#]) {
        Err(Error::Data(err)) => assert!(err.message.contains("HTML"), "{}", err.message),
        other => panic!("{other:?}"),
    }
}

#[test]
fn reads_html_through_the_converted_table() {
    let nodes = blocks(&[r#"{ "id": "b1", "type": "paragraph", "data": { "text": "<b>x</b>" } }"#]);
    let fields = RichTextFields::built_in();
    let found = collect_seed_html(&nodes, &fields).unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(
        found,
        [RichTextHtml {
            kind: Str::from("paragraph"),
            field: Str::from("text"),
            html: Str::from("<b>x</b>"),
        }]
    );
    let segments = match parse(br#"[{"text":"x","marks":{"bold":true}}]"#) {
        Ok(Value::Array(segments)) => segments,
        other => panic!("{other:?}"),
    };
    let doc = Doc::new(Options::default());
    let converted = HashMap::from([(Str::from("<b>x</b>"), segments)]);
    seed(
        &doc,
        &nodes,
        &mut RichTextInput::converting(&fields, converted),
        None,
    )
    .unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(text(&doc, "b1"), r#"[{"text":"x","marks":{"bold":true}}]"#);
}

#[test]
fn an_empty_html_string_needs_no_converter() {
    let doc = seeded(&[r#"{ "id": "b1", "type": "paragraph", "data": { "text": "" } }"#]);
    assert_eq!(text(&doc, "b1"), "[]");
}

#[test]
fn non_rich_diffable_keys_keep_plain_text() {
    let doc = seeded(&[
        r#"{ "id": "c1", "type": "code", "data": { "code": "a < b", "text": "<b>t</b>" } }"#,
    ]);
    assert!(data_value(&doc, "c1", "code").is_some_and(|v| v.as_text().is_some()));
    assert!(data_value(&doc, "c1", "text").is_some_and(|v| v.as_text().is_some()));
    assert_eq!(
        data_field(&doc, &RichTextFields::built_in(), "c1", "text"),
        Value::String(Str::from("<b>t</b>"))
    );
}

#[test]
fn a_rich_field_holding_neither_string_nor_array_stays_a_plain_leaf() {
    let doc = seeded(&[r#"{ "id": "b1", "type": "paragraph", "data": { "text": 5 } }"#]);
    assert_eq!(
        data_value(&doc, "b1", "text"),
        Some(Out::Any(Value::Number(5.0)))
    );
    assert_eq!(
        data_field(&doc, &RichTextFields::built_in(), "b1", "text"),
        Value::Number(5.0)
    );
}

#[test]
fn custom_fields_from_the_options_are_rich() {
    let fields = callout_fields();
    let doc = Doc::new(Options::default());
    seed(
        &doc,
        &blocks(&[
            r#"{ "id": "c1", "type": "callout", "data": { "title": [{ "text": "T", "marks": { "bold": true } }] } }"#,
        ]),
        &mut RichTextInput::refusing(&fields),
        None,
    )
    .unwrap_or_else(|err| panic!("{err}"));
    assert!(is_xml_text(data_value(&doc, "c1", "title")));
    assert_eq!(
        json(&data_field(&doc, &fields, "c1", "title")),
        r#"[{"text":"T","marks":{"bold":true}}]"#
    );
}

// Export decides by class, so a server whose field list lacks a field a
// client formatted still exports segments, not the bare characters.
#[test]
fn formatted_text_under_any_key_exports_as_segments() {
    let fields = callout_fields();
    let doc = Doc::new(Options::default());
    seed(
        &doc,
        &blocks(&[
            r#"{ "id": "c1", "type": "callout", "data": { "title": [{ "text": "T", "marks": { "bold": true } }] } }"#,
        ]),
        &mut RichTextInput::refusing(&fields),
        None,
    )
    .unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(
        json(&data_field(
            &doc,
            &RichTextFields::built_in(),
            "c1",
            "title"
        )),
        r#"[{"text":"T","marks":{"bold":true}}]"#
    );
}

#[test]
fn legacy_html_strings_inside_database_row_documents_are_handed_out_too() {
    let doc = seeded(&[
        r#"{ "id": "r1", "type": "database-row", "data": { "properties": {
          "notes": { "blocks": [
            { "id": "n1", "type": "paragraph", "data": { "text": "<i>n</i>" } },
            { "id": "n2", "type": "code", "data": { "code": "<i>c</i>" } }
          ] },
          "status": "done"
        } } }"#,
    ]);
    let (_, slots) =
        export(&doc, &RichTextFields::built_in(), None).unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(slots.len(), 1);
    assert_eq!(
        slots[0].html,
        RichTextHtml {
            kind: Str::from("paragraph"),
            field: Str::from("text"),
            html: Str::from("<i>n</i>"),
        }
    );
    assert!(!is_xml_text(data_value(&doc, "r1", "properties")));
}

// Host data is never trusted: a malformed mark or embed is normalised on
// the way in, so no client reading the room later chokes on it.
#[test]
fn seed_normalises_malformed_marks_and_embeds() {
    let doc = seeded(&[
        r#"{ "id": "b1", "type": "paragraph", "data": { "text": [
          { "text": "a", "marks": { "tag:b": { "x": 1, "y": "1" }, "color": {}, "background": 5 } },
          { "embed": { "equation": { "expression": 5 } } },
          { "embed": { "equation": null } },
          { "embed": { "page": { "id": {} } } },
          { "embed": { "html": 5 } },
          { "text": "b", "marks": { "tag:i": "str" } }
        ] } }"#,
        r#"{ "id": "b2", "type": "paragraph", "data": { "text": [{ "text": "other" }] } }"#,
    ]);
    assert_eq!(
        text(&doc, "b1"),
        r#"[{"text":"a","marks":{"tag:b":{"y":"1"}}},{"text":"b"}]"#
    );
    assert_eq!(text(&doc, "b2"), r#"[{"text":"other"}]"#);
}

#[test]
fn an_update_with_unchanged_segments_writes_nothing() {
    let doc = seeded(&[
        r#"{ "id": "b1", "type": "paragraph", "data": { "text": [{ "text": "a", "marks": { "link": { "href": "h", "rel": "r" } } }] } }"#,
    ]);
    let updates = counted(&doc);
    apply(
        &doc,
        &[
            r#"{ "op": "update", "id": "b1", "data": { "text": [{ "marks": { "link": { "rel": "r", "href": "h", "title": "x" } }, "text": "a" }] } }"#,
        ],
    );
    assert_eq!(count(&updates), 0);
}

#[test]
fn an_update_edits_the_formatted_text_in_place() {
    let doc = seeded(&[
        r#"{ "id": "b1", "type": "paragraph", "data": { "text": [{ "text": "hello world" }] } }"#,
    ]);
    let live = data_value(&doc, "b1", "text");
    apply(
        &doc,
        &[
            r#"{ "op": "update", "id": "b1", "data": { "text": [{ "text": "hello " }, { "text": "big", "marks": { "bold": true } }, { "text": " world" }] } }"#,
        ],
    );
    assert!(live.is_some() && live == data_value(&doc, "b1", "text"));
    assert_eq!(
        text(&doc, "b1"),
        r#"[{"text":"hello "},{"text":"big","marks":{"bold":true}},{"text":" world"}]"#
    );
}

#[test]
fn an_update_replaces_legacy_plain_text_with_formatted_text() {
    let doc = Doc::new(Options::default());
    let blocks_map = doc
        .get_map(BLOCKS_ROOT)
        .unwrap_or_else(|err| panic!("{err}"));
    let root = doc.get_array("root").unwrap_or_else(|err| panic!("{err}"));
    doc.transact(|t| {
        let data = Map::new(vec![MapEntry::new(
            "text",
            Text::new(Some(Str::from("<b>x</b>"))),
        )]);
        blocks_map.set(t, "b1", plain_block("b1", "paragraph", data))?;
        root.insert(t, 0, vec![In::Any(Value::String(Str::from("b1")))])
    })
    .unwrap_or_else(|err| panic!("{err}"));
    apply(
        &doc,
        &[
            r#"{ "op": "update", "id": "b1", "data": { "text": [{ "text": "x", "marks": { "bold": true } }] } }"#,
        ],
    );
    assert!(is_xml_text(data_value(&doc, "b1", "text")));
    assert_eq!(text(&doc, "b1"), r#"[{"text":"x","marks":{"bold":true}}]"#);
}

#[test]
fn an_update_finds_html_for_the_converter_using_the_blocks_type_in_the_doc() {
    let doc = seeded(&[
        r#"{ "id": "b1", "type": "paragraph", "data": { "text": [] } }"#,
        r#"{ "id": "c1", "type": "code", "data": { "code": "" } }"#,
    ]);
    let ops = ops(&[
        r#"{ "op": "update", "id": "b1", "data": { "text": "<b>x</b>" } }"#,
        r#"{ "op": "update", "id": "c1", "data": { "code": "<b>y</b>" } }"#,
        r#"{ "op": "insert", "id": "n1", "block": { "type": "header", "data": { "text": "<i>z</i>" } } }"#,
        r#"{ "op": "update", "id": "n1", "data": { "text": "<u>w</u>" } }"#,
    ]);
    let html = |kind: &str, field: &str, html: &str| RichTextHtml {
        kind: Str::from(kind),
        field: Str::from(field),
        html: Str::from(html),
    };
    let fields = RichTextFields::built_in();
    assert_eq!(
        collect_ops_html(&doc, &ops, &fields).unwrap_or_else(|err| panic!("{err}")),
        [
            html("paragraph", "text", "<b>x</b>"),
            html("header", "text", "<i>z</i>"),
            html("header", "text", "<u>w</u>"),
        ]
    );
    let result = apply_ops(&doc, &ops, &mut RichTextInput::refusing(&fields));
    assert!(matches!(result, Err(Error::Edit(_))), "{result:?}");
}

#[test]
fn same_as_live_reads_formatted_text_as_segments() {
    let doc = seeded(&[r#"{ "id": "x1", "type": "custom", "data": { "nested": { "k": 1 } } }"#]);
    let data = block_data(&doc, "x1");
    doc.transact(|t| {
        let rich = XmlText::new(None);
        rich.insert(None, 0, "a", Some(&Object::new()))?;
        data.set(t, "rich", rich)
    })
    .unwrap_or_else(|err| panic!("{err}"));
    let updates = counted(&doc);
    apply(
        &doc,
        &[
            r#"{ "op": "update", "id": "x1", "data": { "nested": { "k": 1 }, "rich": [{ "text": "a" }] } }"#,
        ],
    );
    assert_eq!(count(&updates), 0);
}

#[test]
fn a_rest_edit_normalises_malformed_marks_and_embeds() {
    let doc =
        seeded(&[r#"{ "id": "b1", "type": "paragraph", "data": { "text": [{ "text": "a" }] } }"#]);
    apply(
        &doc,
        &[r#"{ "op": "update", "id": "b1", "data": { "text": [
          { "text": "a", "marks": { "tag:b": { "x": null }, "color": [1] } },
          { "embed": { "page": { "id": "p", "extra": "1" } } },
          { "embed": { "equation": { "expression": "e" } } }
        ] } }"#],
    );
    assert_eq!(
        text(&doc, "b1"),
        r#"[{"text":"a","marks":{"tag:b":{}}},{"embed":{"equation":{"expression":"e"}}}]"#
    );
}

#[test]
fn a_peers_malformed_write_neither_breaks_export_nor_the_next_edit() {
    let doc = seeded(&[
        r#"{ "id": "b1", "type": "paragraph", "data": { "text": [{ "text": "ab" }] } }"#,
        r#"{ "id": "b2", "type": "paragraph", "data": { "text": [{ "text": "other" }] } }"#,
    ]);
    poison_formatted_text(&doc, "b1");
    assert_eq!(
        text(&doc, "b1"),
        r#"[{"text":"a"},{"text":"x","marks":{"tag:b":{}}},{"text":"b"}]"#
    );
    assert_eq!(text(&doc, "b2"), r#"[{"text":"other"}]"#);
    apply(
        &doc,
        &[r#"{ "op": "update", "id": "b1", "data": { "text": [{ "text": "abc" }] } }"#],
    );
    assert_eq!(text(&doc, "b1"), r#"[{"text":"abc"}]"#);
    let live = data_value(&doc, "b1", "text")
        .and_then(|v| v.as_xml_text())
        .unwrap_or_else(|| panic!("not a YXmlText"));
    let inserted: String = live
        .to_delta()
        .iter()
        .filter_map(|op| match &op.insert {
            Out::Any(Value::String(text)) => Some(text.to_string()),
            _ => None,
        })
        .collect();
    assert_eq!(inserted, "abc");
}

fn ops(ops: &[&str]) -> Vec<EditOp> {
    let body = format!(r#"{{ "ops": [{}] }}"#, ops.join(","));
    parse_edit_ops(body.as_bytes()).unwrap_or_else(|err| panic!("{err}"))
}

/// C# YDocConverter.ApplyOps(doc, ops): built-in fields, HTML refused.
fn apply(doc: &Doc, json: &[&str]) {
    let fields = RichTextFields::built_in();
    apply_ops(doc, &ops(json), &mut RichTextInput::refusing(&fields))
        .unwrap_or_else(|err| panic!("{err}"));
}

fn counted(doc: &Doc) -> Arc<Mutex<usize>> {
    let updates = Arc::new(Mutex::new(0));
    let sink = Arc::clone(&updates);
    // Dropping the subscription does not unsubscribe.
    let _subscription = doc.on_update(move |_| {
        *sink.lock().unwrap_or_else(|err| panic!("{err}")) += 1;
    });
    updates
}

fn count(updates: &Arc<Mutex<usize>>) -> usize {
    *updates.lock().unwrap_or_else(|err| panic!("{err}"))
}

fn block_data(doc: &Doc, id: &str) -> Map {
    doc.get_map(BLOCKS_ROOT)
        .unwrap_or_else(|err| panic!("{err}"))
        .get(id)
        .and_then(|block| block.as_map())
        .and_then(|block| block.get("data"))
        .and_then(|data| data.as_map())
        .unwrap_or_else(|| panic!("no data map for {id}"))
}

fn plain_block(id: &str, kind: &str, data: Map) -> Map {
    Map::new(vec![
        MapEntry::new("id", Value::String(Str::from(id))),
        MapEntry::new("type", Value::String(Str::from(kind))),
        MapEntry::new("data", data),
        MapEntry::new("tunes", Map::new(Vec::new())),
        MapEntry::new("contentIds", Array::new(Vec::new())),
    ])
}

fn object(entries: Vec<(&str, Value)>) -> Object {
    entries
        .into_iter()
        .map(|(key, value)| (Str::from(key), value))
        .collect()
}

/// Writes, between "a" and "b": a malformed equation embed, an "x" whose
/// marks are a non-string tag attribute and a non-string color, and a page
/// embed whose id is not a string.
pub(crate) fn poison_formatted_text(doc: &Doc, block_id: &str) {
    let text = data_value(doc, block_id, "text")
        .and_then(|v| v.as_xml_text())
        .unwrap_or_else(|| panic!("not a YXmlText"));
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
        text.insert_embed(
            Some(t),
            1,
            Value::Object(bad_equation),
            Some(&blok_yjs::marks(&empty)),
        )?;
        text.insert(Some(t), 2, "x", Some(&blok_yjs::marks(&marks)))?;
        text.insert_embed(
            Some(t),
            3,
            Value::Object(bad_page),
            Some(&blok_yjs::marks(&empty)),
        )
    })
    .unwrap_or_else(|err| panic!("{err}"));
}

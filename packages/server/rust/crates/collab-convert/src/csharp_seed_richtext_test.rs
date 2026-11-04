use std::collections::HashMap;

use blok_jsjson::{Node, Options as JsonOptions, Str, Value, parse, parse_node, stringify};
use blok_yjs::{Doc, Options, Out};

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
#[ignore = "needs apply (lane E)"]
fn an_update_with_unchanged_segments_writes_nothing() {}

#[test]
#[ignore = "needs apply (lane E)"]
fn an_update_edits_the_formatted_text_in_place() {}

#[test]
#[ignore = "needs apply (lane E)"]
fn an_update_replaces_legacy_plain_text_with_formatted_text() {}

#[test]
#[ignore = "needs apply (lane E)"]
fn an_update_finds_html_for_the_converter_using_the_blocks_type_in_the_doc() {}

#[test]
#[ignore = "needs apply (lane E)"]
fn same_as_live_reads_formatted_text_as_segments() {}

#[test]
#[ignore = "needs apply (lane E)"]
fn a_rest_edit_normalises_malformed_marks_and_embeds() {}

#[test]
#[ignore = "needs apply (lane E)"]
fn a_peers_malformed_write_neither_breaks_export_nor_the_next_edit() {}

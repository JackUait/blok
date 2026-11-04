use blok_jsjson::{Str, Value, parse};
use blok_yjs::{Doc, Options, Outcome};

use crate::csharp_apply_test::{block_named, nodes, rt_apply_json, rt_exported, strings};
use crate::export_test::canonical;
use crate::fields::RichTextFields;
use crate::richtext_test::{field, items};
use crate::richtextinput::RichTextInput;
use crate::seed::seed;
use crate::seed_test::converted;

// C# TableDataLossAuditTests: table data through seed, /edit update and
// export. Each test states what a table must still hold after the path
// runs.

const FULL_TABLE: &str = r#"{ "id": "tb", "type": "table", "content": ["p00", "p01", "p10", "p11", "p12"],
  "data": {
    "withHeadings": true, "withHeadingColumn": true, "stretched": true,
    "colWidths": [120.5, 200, 333.25], "initialColWidth": 217.75, "textSize": "comfortable",
    "content": [
      [ { "id": "c0", "rowId": "r0", "blocks": ["p00"], "colspan": 2, "color": "blue", "textColor": "red", "placement": "middle-center" },
        { "id": "c1", "rowId": "r0", "blocks": [], "mergedInto": [0, 0] },
        { "id": "c2", "rowId": "r0", "blocks": ["p01"], "rowspan": 2 } ],
      [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] },
        { "id": "c1", "rowId": "r1", "blocks": ["p12"], "placement": "bottom-right" },
        { "id": "c2", "rowId": "r1", "blocks": [], "mergedInto": [0, 2] } ]
    ] } }"#;

const CELL_CHILDREN: [&str; 5] = [
    r#"{ "id": "p00", "type": "paragraph", "parent": "tb", "data": { "text": [{ "text": "origin" }] } }"#,
    r#"{ "id": "p01", "type": "paragraph", "parent": "tb", "data": { "text": [{ "text": "tall" }] } }"#,
    r#"{ "id": "p10", "type": "paragraph", "parent": "tb", "data": { "text": [{ "text": "first" }] } }"#,
    r#"{ "id": "p11", "type": "list", "parent": "tb", "data": { "text": [{ "text": "second" }], "style": "unordered" } }"#,
    r#"{ "id": "p12", "type": "paragraph", "parent": "tb", "data": { "text": [{ "text": "x" }] } }"#,
];

fn full_table() -> Vec<&'static str> {
    let mut blocks = vec![FULL_TABLE];
    blocks.extend(CELL_CHILDREN);
    blocks
}

fn doc_with(client: u32) -> Doc {
    Doc::new(Options {
        client_id: Some(client),
        ..Options::default()
    })
}

/// RichTextRuntime.Seed into a client-1 doc.
fn seeded(json: &[&str]) -> Doc {
    let blocks = nodes(json);
    let doc = doc_with(1);
    let fields = RichTextFields::built_in();
    seed(
        &doc,
        &blocks,
        &mut RichTextInput::converting(&fields, converted(&blocks)),
        None,
    )
    .unwrap_or_else(|err| panic!("{err}"));
    doc
}

fn fork(doc: &Doc) -> Doc {
    let peer = doc_with(2);
    let update = doc
        .encode_state_as_update(&[])
        .unwrap_or_else(|err| panic!("{err}"));
    let result = peer
        .apply_update(&update)
        .unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(result.outcome, Outcome::Applied);
    peer
}

fn value(text: &str) -> Value {
    parse(text.as_bytes()).unwrap_or_else(|err| panic!("{err}"))
}

fn input(json: &[&str]) -> Value {
    Value::Array(json.iter().map(|block| value(block)).collect())
}

fn table_data(doc: &Doc) -> Value {
    let exported = rt_exported(doc);
    field(block_named(&exported, "tb"), "data").clone()
}

#[test]
fn seed_then_export_keeps_every_table_field() {
    let blocks = full_table();
    let doc = seeded(&blocks);
    assert_eq!(canonical(&rt_exported(&doc)), canonical(&input(&blocks)));
}

#[test]
fn a_peer_reading_the_seeded_doc_exports_the_same_table() {
    let blocks = full_table();
    let doc = seeded(&blocks);
    assert_eq!(
        canonical(&rt_exported(&fork(&doc))),
        canonical(&input(&blocks))
    );
}

// Legacy string cells, an empty row, and a mixed string/object row.
#[test]
fn seed_then_export_keeps_legacy_and_ragged_grids() {
    let blocks = [
        r#"{ "id": "tb", "type": "table", "data": { "withHeadings": false, "withHeadingColumn": false,
      "content": [ ["a", "<b>b</b>"], [], ["c", { "blocks": [] }], [{ "blocks": [], "text": "d" }] ] } }"#,
    ];
    let doc = seeded(&blocks);
    assert_eq!(canonical(&rt_exported(&doc)), canonical(&input(&blocks)));
}

const TABLE_EDITS: [(&str, &str); 9] = [
    (
        "move column c2 to the front",
        r#"[ [ { "id": "c2", "rowId": "r0", "blocks": ["p01"] }, { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c1", "rowId": "r0", "blocks": [] } ],
    [ { "id": "c2", "rowId": "r1", "blocks": [] }, { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c1", "rowId": "r1", "blocks": ["p12"] } ] ]"#,
    ),
    (
        "insert column c3 in the middle",
        r#"[ [ { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c3", "rowId": "r0", "blocks": [] }, { "id": "c1", "rowId": "r0", "blocks": [] }, { "id": "c2", "rowId": "r0", "blocks": ["p01"] } ],
    [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c3", "rowId": "r1", "blocks": [] }, { "id": "c1", "rowId": "r1", "blocks": ["p12"] }, { "id": "c2", "rowId": "r1", "blocks": [] } ] ]"#,
    ),
    (
        "delete column c1",
        r#"[ [ { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c2", "rowId": "r0", "blocks": ["p01"] } ],
    [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c2", "rowId": "r1", "blocks": [] } ] ]"#,
    ),
    (
        "move row r1 above r0",
        r#"[ [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c1", "rowId": "r1", "blocks": ["p12"] }, { "id": "c2", "rowId": "r1", "blocks": [] } ],
    [ { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c1", "rowId": "r0", "blocks": [] }, { "id": "c2", "rowId": "r0", "blocks": ["p01"] } ] ]"#,
    ),
    (
        "merge then a colour on the covered column",
        r#"[ [ { "id": "c0", "rowId": "r0", "blocks": ["p00"], "colspan": 3, "rowspan": 2, "color": "green" }, { "id": "c1", "rowId": "r0", "blocks": [], "mergedInto": [0, 0] }, { "id": "c2", "rowId": "r0", "blocks": [], "mergedInto": [0, 0] } ],
    [ { "id": "c0", "rowId": "r1", "blocks": [], "mergedInto": [0, 0] }, { "id": "c1", "rowId": "r1", "blocks": [], "mergedInto": [0, 0] }, { "id": "c2", "rowId": "r1", "blocks": [], "mergedInto": [0, 0] } ] ]"#,
    ),
    (
        "cells lose their column ids (legacy save)",
        r#"[ [ { "blocks": ["p00"] }, { "blocks": [] }, { "blocks": ["p01"] } ],
    [ { "blocks": ["p10", "p11"] }, { "blocks": ["p12"] }, { "blocks": [] } ] ]"#,
    ),
    (
        "two columns share an id (paste dup)",
        r#"[ [ { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c0", "rowId": "r0", "blocks": ["p01"] }, { "id": "c2", "rowId": "r0", "blocks": [] } ],
    [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c0", "rowId": "r1", "blocks": ["p12"] }, { "id": "c2", "rowId": "r1", "blocks": [] } ] ]"#,
    ),
    (
        "legacy strings replace the cells",
        r#"[ ["a", "b", "c"], ["d", "e", "f"] ]"#,
    ),
    ("table emptied", "[ ]"),
];

fn update(data: &str) -> String {
    format!(r#"{{ "op": "update", "id": "tb", "data": {data} }}"#)
}

// An /edit carrying a new grid must export exactly that grid.
#[test]
fn an_edit_of_the_table_exports_the_edited_grid() {
    for (scenario, content) in TABLE_EDITS {
        let doc = seeded(&full_table());
        let data = format!(
            r#"{{ "withHeadings": true, "withHeadingColumn": false, "colWidths": [100, 200], "content": {content} }}"#
        );
        rt_apply_json(&doc, &[&update(&data)]);
        assert_eq!(
            canonical(&table_data(&doc)),
            canonical(&value(&data)),
            "{scenario}"
        );
    }
}

// The same edits applied twice in a row must still export what the second
// edit says.
#[test]
fn an_edit_over_an_edited_table_exports_the_second_grid() {
    for (scenario, content) in TABLE_EDITS {
        for (_, first) in TABLE_EDITS {
            let doc = seeded(&full_table());
            rt_apply_json(&doc, &[&update(&format!(r#"{{ "content": {first} }}"#))]);
            let data = format!(r#"{{ "content": {content} }}"#);
            rt_apply_json(&doc, &[&update(&data)]);
            assert_eq!(
                canonical(&table_data(&doc)),
                canonical(&value(&data)),
                "{scenario} after [{first}]"
            );
        }
    }
}

fn merge(doc: &Doc, peer: &Doc, before: &[u8]) {
    let update = peer
        .encode_state_as_update(before)
        .unwrap_or_else(|err| panic!("{err}"));
    doc.apply_update(&update)
        .unwrap_or_else(|err| panic!("{err}"));
}

fn cell_ids(row: &Value) -> Vec<String> {
    items(row)
        .iter()
        .map(|cell| match field(cell, "id") {
            Value::String(id) => id.to_string(),
            _ => String::new(),
        })
        .collect()
}

// A peer adds column c3 while the host's /edit, made before it saw that
// column, changes one cell's colour. Both survive.
#[test]
fn a_peers_new_column_survives_a_concurrent_host_cell_edit() {
    let doc = seeded(&full_table());
    let peer = fork(&doc);
    let before = doc.encode_state_vector();
    rt_apply_json(
        &peer,
        &[r#"{ "op": "update", "id": "tb", "data": { "content": [
      [ { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c1", "rowId": "r0", "blocks": [] }, { "id": "c2", "rowId": "r0", "blocks": ["p01"] }, { "id": "c3", "rowId": "r0", "blocks": [] } ],
      [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c1", "rowId": "r1", "blocks": ["p12"] }, { "id": "c2", "rowId": "r1", "blocks": [] }, { "id": "c3", "rowId": "r1", "blocks": [] } ] ] } }"#],
    );
    rt_apply_json(
        &doc,
        &[r#"{ "op": "update", "id": "tb", "data": { "content": [
      [ { "id": "c0", "rowId": "r0", "blocks": ["p00"], "color": "red" }, { "id": "c1", "rowId": "r0", "blocks": [] }, { "id": "c2", "rowId": "r0", "blocks": ["p01"] } ],
      [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c1", "rowId": "r1", "blocks": ["p12"] }, { "id": "c2", "rowId": "r1", "blocks": [] } ] ] } }"#],
    );
    merge(&doc, &peer, &before);
    let data = table_data(&doc);
    let content = field(&data, "content");
    assert_eq!(
        field(&items(&items(content)[0])[0], "color"),
        &Value::String(Str::from("red"))
    );
    assert_eq!(cell_ids(&items(content)[0]), ["c0", "c1", "c2", "c3"]);
    assert_eq!(cell_ids(&items(content)[1]), ["c0", "c1", "c2", "c3"]);
}

// A peer moves column c2 to the front while the host edits a cell in it;
// the host's write lands in the moved column.
#[test]
fn a_host_cell_edit_follows_a_concurrent_column_move() {
    let doc = seeded(&full_table());
    let peer = fork(&doc);
    let before = doc.encode_state_vector();
    rt_apply_json(
        &peer,
        &[r#"{ "op": "update", "id": "tb", "data": { "content": [
      [ { "id": "c2", "rowId": "r0", "blocks": ["p01"] }, { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c1", "rowId": "r0", "blocks": [] } ],
      [ { "id": "c2", "rowId": "r1", "blocks": [] }, { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c1", "rowId": "r1", "blocks": ["p12"] } ] ] } }"#],
    );
    rt_apply_json(
        &doc,
        &[r#"{ "op": "update", "id": "tb", "data": { "content": [
      [ { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c1", "rowId": "r0", "blocks": [] }, { "id": "c2", "rowId": "r0", "blocks": ["p01", "pNew"] } ],
      [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c1", "rowId": "r1", "blocks": ["p12"] }, { "id": "c2", "rowId": "r1", "blocks": [] } ] ] } }"#],
    );
    merge(&doc, &peer, &before);
    let data = table_data(&doc);
    let row = &items(field(&data, "content"))[0];
    let c2 = items(row)
        .iter()
        .find(|cell| field(cell, "id") == &Value::String(Str::from("c2")))
        .unwrap_or_else(|| panic!("no c2"));
    assert_eq!(strings(field(c2, "blocks")), ["p01", "pNew"]);
}

#[test]
fn a_cell_child_still_named_by_its_cell_is_exported() {
    let doc = seeded(&full_table());
    let exported = rt_exported(&doc);
    let children = ["p00", "p01", "p10", "p11", "p12"];
    for id in children {
        assert_eq!(
            field(block_named(&exported, id), "parent"),
            &Value::String(Str::from("tb")),
            "{id}"
        );
    }
    assert_eq!(
        strings(field(block_named(&exported, "tb"), "content")),
        children
    );
}

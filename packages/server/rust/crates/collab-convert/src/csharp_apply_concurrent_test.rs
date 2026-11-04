use blok_jsjson::{Object, Str, Value};
use blok_yjs::{Array, Doc, Map, Options, Out, Outcome, XmlText};

use crate::apply::apply_ops;
use crate::csharp_apply_test::{block_named, nodes, ops};
use crate::export::{BLOCKS_ROOT, GRID_ORDER_KEY, GRID_ROWS_KEY};
use crate::fields::RichTextFields;
use crate::richtext_test::{field, items};
use crate::richtextinput::RichTextInput;
use crate::seed::seed;
use crate::seed_test::exported;

// C# YDocConverterConcurrentLossTests: the /edit write path against a peer
// editing the same block at the same instant. A peer doc forked off the
// server doc, both edit, then the peer's update merges back, as CollabRoom
// does.

const TABLE: &str = r#"{ "id": "tb", "type": "table", "data": { "content": [[
      { "text": "a1", "blocks": ["p1"] },
      { "text": "b1", "blocks": [] } ]] } }"#;

fn doc_with(client: u32) -> Doc {
    Doc::new(Options {
        client_id: Some(client),
        ..Options::default()
    })
}

fn seeded(json: &[&str]) -> Doc {
    let doc = doc_with(1);
    let fields = RichTextFields::built_in();
    seed(
        &doc,
        &nodes(json),
        &mut RichTextInput::refusing(&fields),
        None,
    )
    .unwrap_or_else(|err| panic!("{err}"));
    doc
}

/// A second peer holding the same document, as a joining client does.
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

fn merge(doc: &Doc, peer: &Doc, before: &[u8]) {
    let update = peer
        .encode_state_as_update(before)
        .unwrap_or_else(|err| panic!("{err}"));
    doc.apply_update(&update)
        .unwrap_or_else(|err| panic!("{err}"));
}

/// C# YDocConverter.ApplyOps: built-in fields, HTML refused.
fn apply(doc: &Doc, json: &[&str]) {
    let fields = RichTextFields::built_in();
    apply_ops(doc, &ops(json), &mut RichTextInput::refusing(&fields))
        .unwrap_or_else(|err| panic!("{err}"));
}

fn get(map: &Map, key: &str) -> Out {
    map.get(key).unwrap_or_else(|| panic!("no entry {key}"))
}

fn as_map(out: Out) -> Map {
    out.as_map()
        .unwrap_or_else(|| panic!("not a YMap: {out:?}"))
}

fn as_array(out: Out) -> Array {
    out.as_array()
        .unwrap_or_else(|| panic!("not a YArray: {out:?}"))
}

fn data(doc: &Doc, id: &str) -> Map {
    let blocks = doc
        .get_map(BLOCKS_ROOT)
        .unwrap_or_else(|err| panic!("{err}"));
    as_map(get(&as_map(get(&blocks, id)), "data"))
}

fn row_keys(doc: &Doc) -> Vec<String> {
    let grid = as_map(get(&data(doc, "tb"), "content"));
    as_array(get(&grid, GRID_ORDER_KEY))
        .values()
        .into_iter()
        .map(|entry| match entry {
            Out::Any(Value::String(key)) => key.to_string(),
            _ => String::new(),
        })
        .collect()
}

fn cell(doc: &Doc, row: i64, column: i64) -> Map {
    let grid = as_map(get(&data(doc, "tb"), "content"));
    let rows = as_map(get(&grid, GRID_ROWS_KEY));
    let order = as_array(get(&grid, GRID_ORDER_KEY));
    let key = match order.get(row) {
        Some(Out::Any(Value::String(key))) => key,
        other => panic!("row key {other:?}"),
    };
    let cells = as_array(get(&rows, &key.to_string()));
    as_map(cells.get(column).unwrap_or_else(|| panic!("no cell")))
}

fn content(exported: &Value) -> Value {
    field(field(block_named(exported, "tb"), "data"), "content").clone()
}

fn string(text: &str) -> Value {
    Value::String(Str::from(text))
}

fn at(value: &Value, index: usize) -> &Value {
    &items(value)[index]
}

fn write(doc: &Doc, map: &Map, key: &str, value: Value) {
    doc.transact(|t| map.set(t, key, value))
        .unwrap_or_else(|err| panic!("{err}"));
}

// One person types in the left cell while the host's /edit carries the
// right cell's new text. The left cell's typing must survive.
#[test]
fn concurrent_cell_typing_survives_a_server_table_update() {
    let doc = seeded(&[TABLE]);
    let peer = fork(&doc);
    let before = doc.encode_state_vector();
    write(&peer, &cell(&peer, 0, 0), "text", string("a1 typed"));
    apply(
        &doc,
        &[r#"{ "op": "update", "id": "tb", "data": { "content": [[
            { "text": "a1", "blocks": ["p1"] },
            { "text": "b1 host", "blocks": [] } ]] } }"#],
    );
    merge(&doc, &peer, &before);
    let content = content(&exported(&doc));
    assert_eq!(field(at(at(&content, 0), 0), "text"), &string("a1 typed"));
    assert_eq!(field(at(at(&content, 0), 1), "text"), &string("b1 host"));
}

// A server /edit that changes one cell leaves the grid's row containers
// where they were.
#[test]
fn a_server_table_update_keeps_the_row_containers() {
    let doc = seeded(&[TABLE]);
    let keys_before = row_keys(&doc);
    apply(
        &doc,
        &[r#"{ "op": "update", "id": "tb", "data": { "content": [[
            { "text": "a1", "blocks": ["p1"] },
            { "text": "b1 host", "blocks": [] } ]] } }"#],
    );
    assert_eq!(row_keys(&doc), keys_before);
}

// Two people each drop a block into one table cell: both ids survive.
#[test]
fn concurrent_block_inserts_into_one_cell_both_survive() {
    let doc = seeded(&[TABLE]);
    let peer = fork(&doc);
    let before = doc.encode_state_vector();
    let blocks = as_array(get(&cell(&peer, 0, 0), "blocks"));
    peer.transact(|t| blocks.insert(t, 1, vec![string("p2").into()]))
        .unwrap_or_else(|err| panic!("{err}"));
    apply(
        &doc,
        &[r#"{ "op": "update", "id": "tb", "data": { "content": [[
            { "text": "a1", "blocks": ["p1", "p3"] },
            { "text": "b1", "blocks": [] } ]] } }"#],
    );
    merge(&doc, &peer, &before);
    let content = content(&exported(&doc));
    let ids = items(field(at(at(&content, 0), 0), "blocks"));
    assert!(ids.contains(&string("p2")), "{ids:?}");
    assert!(ids.contains(&string("p3")), "{ids:?}");
}

const CALLOUT: &str = r#"{ "id": "cb", "type": "callout", "data": { "settings":
    { "icon": "star", "colour": "blue" } } }"#;

// Two people change different keys of a nested plain object; both stay.
#[test]
fn concurrent_writes_to_different_keys_of_a_nested_map_both_survive() {
    let doc = seeded(&[CALLOUT]);
    let peer = fork(&doc);
    let before = doc.encode_state_vector();
    write(
        &peer,
        &as_map(get(&data(&peer, "cb"), "settings")),
        "colour",
        string("red"),
    );
    apply(
        &doc,
        &[r#"{ "op": "update", "id": "cb", "data": { "settings":
            { "icon": "bolt", "colour": "blue" } } }"#],
    );
    merge(&doc, &peer, &before);
    let exported = exported(&doc);
    let settings = field(field(block_named(&exported, "cb"), "data"), "settings");
    assert_eq!(field(settings, "colour"), &string("red"));
    assert_eq!(field(settings, "icon"), &string("bolt"));
}

const DATABASE: &str = r#"{ "id": "db", "type": "database", "data": { "properties": [
    { "id": "p1", "name": "Name" },
    { "id": "p2", "name": "Status" } ] } }"#;

fn property_rows(doc: &Doc) -> Map {
    as_map(get(
        &as_map(get(&data(doc, "db"), "properties")),
        GRID_ROWS_KEY,
    ))
}

fn properties(doc: &Doc) -> Value {
    let exported = exported(doc);
    field(field(block_named(&exported, "db"), "data"), "properties").clone()
}

// A database's property list is identity-keyed, so renames of two
// different properties merge.
#[test]
fn concurrent_renames_of_different_database_properties_both_survive() {
    let doc = seeded(&[DATABASE]);
    let peer = fork(&doc);
    let before = doc.encode_state_vector();
    write(
        &peer,
        &as_map(get(&property_rows(&peer), "p2")),
        "name",
        string("State"),
    );
    apply(
        &doc,
        &[r#"{ "op": "update", "id": "db", "data": { "properties": [
            { "id": "p1", "name": "Title" },
            { "id": "p2", "name": "Status" } ] } }"#],
    );
    merge(&doc, &peer, &before);
    let properties = properties(&doc);
    assert_eq!(field(at(&properties, 1), "name"), &string("State"));
    assert_eq!(field(at(&properties, 0), "name"), &string("Title"));
}

// Control: the same fork/merge shape preserves a peer's concurrent edit
// where the write path edits in place.
#[test]
fn concurrent_typing_in_top_level_text_merges() {
    let doc = seeded(&[
        r#"{ "id": "p", "type": "paragraph", "data": { "text": [{ "text": "hello" }] } }"#,
    ]);
    let peer = fork(&doc);
    let before = doc.encode_state_vector();
    let text: XmlText = get(&data(&peer, "p"), "text")
        .as_xml_text()
        .unwrap_or_else(|| panic!("not a YXmlText"));
    peer.transact(|t| text.insert(Some(t), 0, "X", Some(&Object::new())))
        .unwrap_or_else(|err| panic!("{err}"));
    apply(
        &doc,
        &[r#"{ "op": "update", "id": "p", "data": { "text": [{ "text": "hello!" }] } }"#],
    );
    merge(&doc, &peer, &before);
    let exported = exported(&doc);
    let text = field(field(block_named(&exported, "p"), "data"), "text");
    assert_eq!(
        blok_jsjson::stringify(text).unwrap_or_else(|err| panic!("{err}")),
        r#"[{"text":"Xhello!"}]"#
    );
}

// ReplaceData removes only the keys the doc held when it ran, so a peer's
// later-arriving key survives.
#[test]
fn a_top_level_key_added_concurrently_survives_a_server_update() {
    let doc =
        seeded(&[r#"{ "id": "p", "type": "paragraph", "data": { "text": [{ "text": "hi" }] } }"#]);
    let peer = fork(&doc);
    let before = doc.encode_state_vector();
    write(&peer, &data(&peer, "p"), "align", string("center"));
    apply(
        &doc,
        &[r#"{ "op": "update", "id": "p", "data": { "text": [{ "text": "hi there" }] } }"#],
    );
    merge(&doc, &peer, &before);
    let exported = exported(&doc);
    assert_eq!(
        field(field(block_named(&exported, "p"), "data"), "align"),
        &string("center")
    );
}

const ROW: &str = r#"{ "id": "r", "type": "database-row", "data": { "position": "a0", "title": "One", "properties": { "t": "One" } } }"#;

fn is_plain_string(out: &Out) -> bool {
    matches!(out, Out::Any(Value::String(_)))
}

// A row page icon is a plain leaf: a Y.Text would merge two concurrent
// picks into a mix of both. The peer's change stays.
#[test]
fn a_row_icon_written_by_the_server_is_a_plain_value_and_keeps_a_concurrent_title() {
    let doc = seeded(&[
        r#"{ "id": "r", "type": "database-row", "data": { "position": "a0", "icon": "🌱", "properties": { "t": "One" } } }"#,
    ]);
    assert!(is_plain_string(&get(&data(&doc, "r"), "icon")));
    let peer = fork(&doc);
    let before = doc.encode_state_vector();
    write(&peer, &data(&peer, "r"), "position", string("a5"));
    apply(
        &doc,
        &[
            r#"{ "op": "update", "id": "r", "data": { "position": "a0", "icon": "🚀", "properties": { "t": "One" } } }"#,
        ],
    );
    merge(&doc, &peer, &before);
    assert!(is_plain_string(&get(&data(&doc, "r"), "icon")));
    let exported = exported(&doc);
    assert_eq!(
        field(field(block_named(&exported, "r"), "data"), "icon"),
        &string("🚀")
    );
}

#[test]
fn a_row_cover_written_by_the_server_is_a_plain_value_and_keeps_a_concurrent_change() {
    let doc = seeded(&[
        r#"{ "id": "r", "type": "database-row", "data": { "position": "a0", "cover": "https://example.com/a.png", "properties": { "t": "One" } } }"#,
    ]);
    let peer = fork(&doc);
    let before = doc.encode_state_vector();
    write(&peer, &data(&peer, "r"), "position", string("a5"));
    apply(
        &doc,
        &[
            r#"{ "op": "update", "id": "r", "data": { "position": "a0", "cover": "https://example.com/b.png", "properties": { "t": "One" } } }"#,
        ],
    );
    merge(&doc, &peer, &before);
    assert!(is_plain_string(&get(&data(&doc, "r"), "cover")));
    let exported = exported(&doc);
    assert_eq!(
        field(field(block_named(&exported, "r"), "data"), "cover"),
        &string("https://example.com/b.png")
    );
}

// The marker a client sets when it turns a legacy body into child blocks
// survives a concurrent /edit of the row's values.
#[test]
fn a_row_body_blocks_marker_set_concurrently_survives_a_server_update() {
    let doc = seeded(&[ROW]);
    let peer = fork(&doc);
    let before = doc.encode_state_vector();
    write(&peer, &data(&peer, "r"), "bodyBlocks", Value::Bool(true));
    apply(
        &doc,
        &[
            r#"{ "op": "update", "id": "r", "data": { "position": "a0", "title": "One", "properties": { "t": "One", "n": "note" } } }"#,
        ],
    );
    merge(&doc, &peer, &before);
    let exported = exported(&doc);
    let row = field(block_named(&exported, "r"), "data");
    assert_eq!(field(row, "bodyBlocks"), &Value::Bool(true));
    assert_eq!(field(field(row, "properties"), "n"), &string("note"));
}

// An update states the whole value of the key it names, so a nested key
// the new data omits is removed, as deepAssignYMap removes it.
#[test]
fn an_update_drops_a_nested_key_the_new_data_omits() {
    let doc = seeded(&[CALLOUT]);
    apply(
        &doc,
        &[r#"{ "op": "update", "id": "cb", "data": { "settings": { "icon": "bolt" } } }"#],
    );
    let exported = exported(&doc);
    let settings = field(field(block_named(&exported, "cb"), "data"), "settings");
    assert_eq!(field(settings, "icon"), &string("bolt"));
    assert_eq!(field(settings, "colour"), &Value::Undefined);
}

// Row identity survives a row insert: the rows that were there keep their
// keys and their containers.
#[test]
fn adding_a_table_row_keeps_the_existing_rows_keys() {
    let doc = seeded(&[TABLE]);
    let keys_before = row_keys(&doc);
    apply(
        &doc,
        &[r#"{ "op": "update", "id": "tb", "data": { "content": [
            [ { "text": "a1", "blocks": ["p1"] }, { "text": "b1", "blocks": [] } ],
            [ { "text": "a2", "blocks": [] }, { "text": "b2", "blocks": [] } ] ] } }"#],
    );
    let keys_after = row_keys(&doc);
    assert_eq!(keys_after.len(), 2);
    assert_eq!(keys_after[..1], keys_before[..]);
    let content = content(&exported(&doc));
    assert_eq!(field(at(at(&content, 1), 0), "text"), &string("a2"));
}

// Rows are paired by content, so a number the doc holds pairs with the
// same number in the incoming JSON.
#[test]
fn numeric_rows_pair_with_the_rows_already_in_the_document() {
    let doc = seeded(&[r#"{ "id": "tb", "type": "table", "data": { "content": [
        [ { "count": 1 }, { "count": 2 } ],
        [ { "count": 3 }, { "count": 4.5 } ] ] } }"#]);
    let keys_before = row_keys(&doc);
    apply(
        &doc,
        &[r#"{ "op": "update", "id": "tb", "data": { "content": [
            [ { "count": 1 }, { "count": 2 } ],
            [ { "count": 3 }, { "count": 9.5 } ] ] } }"#],
    );
    assert_eq!(row_keys(&doc), keys_before);
    let content = content(&exported(&doc));
    assert_eq!(field(at(at(&content, 1), 1), "count"), &Value::Number(9.5));
}

// A property list reordered while a peer renames one property keeps the
// rename on that property (the client's own result).
#[test]
fn reordering_database_properties_keeps_a_concurrent_rename() {
    let doc = seeded(&[
        r#"{ "id": "db", "type": "database", "data": { "properties": [
        { "id": "p1", "name": "Name" },
        { "id": "p2", "name": "Status" },
        { "id": "p3", "name": "Owner" } ] } }"#,
    ]);
    let peer = fork(&doc);
    let before = doc.encode_state_vector();
    write(
        &peer,
        &as_map(get(&property_rows(&peer), "p3")),
        "name",
        string("Assignee"),
    );
    apply(
        &doc,
        &[r#"{ "op": "update", "id": "db", "data": { "properties": [
            { "id": "p3", "name": "Owner" },
            { "id": "p1", "name": "Name" },
            { "id": "p2", "name": "Status" } ] } }"#],
    );
    merge(&doc, &peer, &before);
    let properties = properties(&doc);
    let ids: Vec<&Value> = items(&properties).iter().map(|p| field(p, "id")).collect();
    assert_eq!(ids, [&string("p3"), &string("p1"), &string("p2")]);
    assert_eq!(field(at(&properties, 0), "name"), &string("Assignee"));
}

// An element added to a plain array while a peer writes a field of an
// element that stays: the changed middle is assigned in place.
#[test]
fn an_unequal_array_middle_keeps_the_container_that_survives() {
    let doc = seeded(&[r#"{ "id": "x", "type": "tool", "data": { "items": [
        { "a": "1" }, { "a": "2" }, { "a": "3" } ] } }"#]);
    let peer = fork(&doc);
    let before = doc.encode_state_vector();
    let element = as_map(
        as_array(get(&data(&peer, "x"), "items"))
            .get(2)
            .unwrap_or_else(|| panic!("no element")),
    );
    write(&peer, &element, "b", string("peer"));
    apply(
        &doc,
        &[r#"{ "op": "update", "id": "x", "data": { "items": [
            { "a": "1" }, { "a": "2" }, { "a": "3x" }, { "a": "4" } ] } }"#],
    );
    merge(&doc, &peer, &before);
    let exported = exported(&doc);
    let list = field(field(block_named(&exported, "x"), "data"), "items");
    assert_eq!(field(at(list, 2), "b"), &string("peer"));
    assert_eq!(field(at(list, 2), "a"), &string("3x"));
    assert_eq!(items(list).len(), 4);
}

const TABLE_WITH_ROW_IDS: &str = r#"{ "id": "tb", "type": "table", "data": { "content": [
    [ { "blocks": ["p1"], "id": "c0", "rowId": "r0" } ],
    [ { "blocks": ["p2"], "id": "c0", "rowId": "r1" } ] ] } }"#;

#[test]
fn a_seeded_table_row_is_keyed_by_its_row_id() {
    assert_eq!(row_keys(&seeded(&[TABLE_WITH_ROW_IDS])), ["r0", "r1"]);
}

// One /edit both changes row r0 and inserts a row above it; r0 keeps its
// container.
#[test]
fn an_edit_that_changes_a_row_and_inserts_one_above_it_keeps_that_rows_container() {
    let doc = seeded(&[TABLE_WITH_ROW_IDS]);
    apply(
        &doc,
        &[r#"{ "op": "update", "id": "tb", "data": { "content": [
            [ { "blocks": [], "id": "c0", "rowId": "rN" } ],
            [ { "blocks": ["p1", "p3"], "id": "c0", "rowId": "r0" } ],
            [ { "blocks": ["p2"], "id": "c0", "rowId": "r1" } ] ] } }"#],
    );
    assert_eq!(row_keys(&doc), ["rN", "r0", "r1"]);
}

fn filter_data(rules: &str) -> String {
    format!(
        r#"{{
    "schema": [{{ "id": "t", "name": "Name", "type": "title", "position": "a0" }}],
    "activeViewId": "v1",
    "views": [{{ "id": "v1", "name": "Table", "type": "table", "position": "a0",
        "sorts": [], "filters": [], "visibleProperties": [],
        "filterTree": {{ "id": "v1-filters", "conjunction": "and", "filterRules": {rules} }} }}] }}"#
    )
}

// Two people add a rule to the same filter group at once: the list is born
// empty, so both sides mint it as a YArray and both rules stay.
#[test]
fn concurrent_filter_rules_in_one_group_both_survive() {
    let doc = seeded(&[&format!(
        r#"{{ "id": "db", "type": "database", "data": {} }}"#,
        filter_data("[]")
    )]);
    let peer = fork(&doc);
    let before = doc.encode_state_vector();
    let update = |rules: &str| {
        format!(
            r#"{{ "op": "update", "id": "db", "data": {} }}"#,
            filter_data(rules)
        )
    };
    apply(
        &peer,
        &[&update(
            r#"[{ "id": "ra", "propertyId": "t", "operator": "contains", "value": "a" }]"#,
        )],
    );
    apply(
        &doc,
        &[&update(
            r#"[{ "id": "rb", "propertyId": "t", "operator": "contains", "value": "b" }]"#,
        )],
    );
    merge(&doc, &peer, &before);
    let exported = exported(&doc);
    let views = field(field(block_named(&exported, "db"), "data"), "views");
    let rules = field(field(at(views, 0), "filterTree"), "filterRules");
    let ids: Vec<&Value> = items(rules).iter().map(|rule| field(rule, "id")).collect();
    assert!(ids.contains(&&string("ra")), "{ids:?}");
    assert!(ids.contains(&&string("rb")), "{ids:?}");
}

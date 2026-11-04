use blok_jsjson::{Str, Value};
use blok_yjs::{Array, Doc, Map, Options, Out, Outcome};

use crate::apply::apply_ops;
use crate::editops::parse_edit_ops;
use crate::export::{BLOCKS_ROOT, GRID_ORDER_KEY, GRID_ROWS_KEY};
use crate::export_test::{applied, decode64};
use crate::fields::RichTextFields;
use crate::richtext_test::{field, items};
use crate::richtextinput::RichTextInput;
use crate::seed::seed;
use crate::seed_test::{converted, exported, node_of};

fn client_update(case: &str) -> Doc {
    let path = blok_collab_collabtest::path(&format!("collab/{case}/update.b64"));
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|err| panic!("{case}: {err}"));
    applied(&decode64(raw.trim()))
}

fn entry(map: &Map, key: &str) -> Out {
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
    as_map(entry(&as_map(entry(&blocks, id)), "data"))
}

fn row(doc: &Doc, id: &str, index: usize) -> Array {
    let grid = as_map(entry(&data(doc, id), "content"));
    let rows = as_map(entry(&grid, GRID_ROWS_KEY));
    let order = as_array(entry(&grid, GRID_ORDER_KEY));
    let key = match order.get(index as i64) {
        Some(Out::Any(Value::String(key))) => key,
        other => panic!("row key {other:?}"),
    };
    as_array(entry(&rows, &key.to_string()))
}

fn strings(array: &Array) -> Vec<String> {
    array
        .values()
        .into_iter()
        .map(|value| match value {
            Out::Any(Value::String(text)) => text.to_string(),
            other => panic!("not a string: {other:?}"),
        })
        .collect()
}

/// Both cells of row 0, the populated one and the empty one: the empty
/// case is the one the generic array rule would leave a plain leaf.
fn assert_cell_block_ids_are_y_arrays(doc: &Doc) {
    let row0 = row(doc, "tb1", 0);
    let cell = |index: i64| as_map(row0.get(index).unwrap_or_else(|| panic!("no cell")));
    let populated = as_array(entry(&cell(0), "blocks"));
    let empty = as_array(entry(&cell(1), "blocks"));
    assert_eq!(strings(&populated), ["p1", "p2"]);
    assert!(empty.is_empty());

    // A merged-cell marker under the same cell map is not an id list and
    // keeps the generic rules; so does a sibling primitive array on the block.
    let merged = as_map(
        row(doc, "tb1", 1)
            .get(1)
            .unwrap_or_else(|| panic!("no cell")),
    );
    assert!(entry(&merged, "mergedInto").as_array().is_none());
    assert!(entry(&data(doc, "tb1"), "colWidths").as_array().is_none());

    // Nested only: a `blocks` key in a plain object is one, a block's
    // top-level `data.blocks` is not.
    let panel = as_map(entry(&data(doc, "tb2"), "panel"));
    assert!(entry(&panel, "blocks").as_array().is_some());
    assert!(entry(&data(doc, "tb2"), "blocks").as_array().is_none());
}

// C# YDocConverterCellBlockIdsTests.ServerSeedMintsTheCellIdListAsAYArray.
#[test]
fn server_seed_mints_the_cell_id_list_as_a_y_array() {
    let blocks = node_of("collab/cell-block-ids/input.json").items;
    let doc = Doc::new(Options::default());
    let fields = RichTextFields::built_in();
    let mut input = RichTextInput::converting(&fields, converted(&blocks));
    seed(&doc, &blocks, &mut input, None).unwrap_or_else(|err| panic!("{err}"));
    assert_cell_block_ids_are_y_arrays(&doc);
}

// C# YDocConverterCellBlockIdsTests.TheClientUpdateCarriesTheSameRepresentation.
#[test]
fn the_client_update_carries_the_same_representation() {
    assert_cell_block_ids_are_y_arrays(&client_update("cell-block-ids"));
}

/// Row 0 is keyed by its row id. Row 1's cells disagree and row 2 is empty,
/// so both get a minted key that is neither of the ids.
fn assert_row_keys(doc: &Doc) {
    let grid = as_map(entry(&data(doc, "tr1"), "content"));
    let keys = strings(&as_array(entry(&grid, GRID_ORDER_KEY)));
    let cell_row_ids = ["r0", "r1", "rX"];
    assert_eq!(keys.len(), 3);
    assert_eq!(keys[0], "r0");
    assert!(!cell_row_ids.contains(&keys[1].as_str()), "{keys:?}");
    assert!(!cell_row_ids.contains(&keys[2].as_str()), "{keys:?}");
}

// C# YDocConverterTableRowIdsTests.ServerSeedKeysARowByItsRowId.
#[test]
fn server_seed_keys_a_row_by_its_row_id() {
    let blocks = node_of("collab/table-row-ids/input.json").items;
    let doc = Doc::new(Options::default());
    let fields = RichTextFields::built_in();
    seed(&doc, &blocks, &mut RichTextInput::refusing(&fields), None)
        .unwrap_or_else(|err| panic!("{err}"));
    assert_row_keys(&doc);
}

// C# YDocConverterTableRowIdsTests.TheClientUpdateKeysTheRowsTheSameWay.
#[test]
fn the_client_update_keys_the_rows_the_same_way() {
    assert_row_keys(&client_update("table-row-ids"));
}

fn seeded(json: &[&str]) -> Doc {
    let nodes: Vec<blok_jsjson::Node> = json
        .iter()
        .map(|block| {
            blok_jsjson::parse_node(block.as_bytes(), blok_jsjson::Options::default())
                .unwrap_or_else(|err| panic!("{err}"))
        })
        .collect();
    let doc = Doc::new(Options::default());
    let fields = RichTextFields::built_in();
    seed(&doc, &nodes, &mut RichTextInput::refusing(&fields), None)
        .unwrap_or_else(|err| panic!("{err}"));
    doc
}

/// C# YDocConverter.ApplyOps(doc, CollabEditOps.Parse(...)).
fn apply(doc: &Doc, ops: &[&str]) {
    let body = format!(r#"{{ "ops": [{}] }}"#, ops.join(","));
    let ops = parse_edit_ops(body.as_bytes()).unwrap_or_else(|err| panic!("{err}"));
    let fields = RichTextFields::built_in();
    apply_ops(doc, &ops, &mut RichTextInput::refusing(&fields))
        .unwrap_or_else(|err| panic!("{err}"));
}

fn stringify(value: &Value) -> String {
    blok_jsjson::stringify(value).unwrap_or_else(|err| panic!("{err}"))
}

fn peer(server: &Doc) -> Doc {
    let peer = Doc::new(Options::default());
    sync(server, &peer);
    peer
}

fn sync(from: &Doc, to: &Doc) {
    let update = from
        .encode_state_as_update(&to.encode_state_vector())
        .unwrap_or_else(|err| panic!("{err}"));
    let result = to
        .apply_update(&update)
        .unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(result.outcome, Outcome::Applied);
}

fn exchange(left: &Doc, right: &Doc) {
    let to_right = left
        .encode_state_as_update(&right.encode_state_vector())
        .unwrap_or_else(|err| panic!("{err}"));
    let to_left = right
        .encode_state_as_update(&left.encode_state_vector())
        .unwrap_or_else(|err| panic!("{err}"));
    for (doc, update) in [(right, to_right), (left, to_left)] {
        let result = doc
            .apply_update(&update)
            .unwrap_or_else(|err| panic!("{err}"));
        assert_eq!(result.outcome, Outcome::Applied);
    }
}

fn is_keyed_container(value: Option<Out>) -> bool {
    value.and_then(|value| value.as_map()).is_some_and(|map| {
        map.get(GRID_ROWS_KEY)
            .is_some_and(|rows| rows.as_map().is_some())
            && map
                .get(GRID_ORDER_KEY)
                .is_some_and(|order| order.as_array().is_some())
    })
}

fn related_ids(doc: &Doc) -> Vec<String> {
    let blocks = exported(doc);
    let block = items(&blocks)
        .iter()
        .find(|block| matches!(field(block, "id"), Value::String(id) if id.to_string() == "r1"))
        .unwrap_or_else(|| panic!("no r1"));
    let mut ids: Vec<String> = match field(field(field(block, "data"), "properties"), "rel") {
        Value::Array(relation) => relation
            .iter()
            .map(|item| match field(item, "id") {
                Value::String(id) => id.to_string(),
                _ => String::new(),
            })
            .collect(),
        _ => Vec::new(),
    };
    ids.sort();
    ids
}

const ROW_WITH_RELATION: &str = r#"{ "id": "r1", "type": "database-row",
    "data": { "title": "Alpha", "properties": { "rel": [{ "id": "z" }] } } }"#;

// C# YDocConverterDatabaseRelationTests: a relation value is a list of
// { "id": rowId } objects inside a row's properties, stored keyed by id
// through the generic identity rule.
#[test]
fn seed_stores_a_relation_value_keyed_by_id() {
    let doc = seeded(&[ROW_WITH_RELATION]);
    let properties = as_map(entry(&data(&doc, "r1"), "properties"));
    let relation = entry(&properties, "rel");
    assert!(!matches!(relation, Out::Any(Value::String(_))));
    assert!(relation.as_array().is_none());
    assert_eq!(related_ids(&doc), ["z"]);
}

#[test]
fn seed_stores_an_empty_list_under_properties_as_a_keyed_container() {
    let doc = seeded(&[r#"{ "id": "r1", "type": "database-row",
        "data": { "properties": { "rel": [], "tags": ["a"] }, "other": { "x": [] } } }"#]);
    let properties = as_map(entry(&data(&doc, "r1"), "properties"));
    let other = as_map(entry(&data(&doc, "r1"), "other"));
    assert!(is_keyed_container(properties.get("rel")));
    assert!(!is_keyed_container(other.get("x")));
    let blocks = exported(&doc);
    let rel = field(
        field(field(&items(&blocks)[0], "data"), "properties"),
        "rel",
    );
    assert_eq!(rel, &Value::Array(Vec::new()));
}

#[test]
fn two_peers_relating_different_rows_at_once_keep_both() {
    let server = seeded(&[ROW_WITH_RELATION]);
    let peer = peer(&server);
    apply(
        &server,
        &[
            r#"{ "op": "update", "id": "r1", "data": { "properties": { "rel": [{ "id": "z" }, { "id": "b" }] } } }"#,
        ],
    );
    apply(
        &peer,
        &[
            r#"{ "op": "update", "id": "r1", "data": { "properties": { "rel": [{ "id": "z" }, { "id": "c" }] } } }"#,
        ],
    );
    exchange(&server, &peer);
    assert_eq!(related_ids(&server), ["b", "c", "z"]);
    assert_eq!(related_ids(&peer), ["b", "c", "z"]);
}

#[test]
fn a_removal_and_an_add_made_at_once_keep_the_add() {
    let server = seeded(&[r#"{ "id": "r1", "type": "database-row",
        "data": { "properties": { "rel": [{ "id": "z" }, { "id": "y" }] } } }"#]);
    let peer = peer(&server);
    apply(
        &server,
        &[
            r#"{ "op": "update", "id": "r1", "data": { "properties": { "rel": [{ "id": "y" }] } } }"#,
        ],
    );
    apply(
        &peer,
        &[
            r#"{ "op": "update", "id": "r1", "data": { "properties": { "rel": [{ "id": "z" }, { "id": "y" }, { "id": "c" }] } } }"#,
        ],
    );
    exchange(&server, &peer);
    assert_eq!(related_ids(&server), ["c", "y"]);
    assert_eq!(related_ids(&peer), related_ids(&server));
}

#[test]
fn two_peers_relating_the_first_row_of_a_list_born_empty_keep_both() {
    let server = seeded(&[
        r#"{ "id": "r1", "type": "database-row", "data": { "properties": { "rel": [] } } }"#,
    ]);
    let peer = peer(&server);
    apply(
        &server,
        &[
            r#"{ "op": "update", "id": "r1", "data": { "properties": { "rel": [{ "id": "b" }] } } }"#,
        ],
    );
    apply(
        &peer,
        &[
            r#"{ "op": "update", "id": "r1", "data": { "properties": { "rel": [{ "id": "c" }] } } }"#,
        ],
    );
    exchange(&server, &peer);
    assert_eq!(related_ids(&server), ["b", "c"]);
    assert_eq!(related_ids(&peer), ["b", "c"]);
}

#[test]
fn a_clear_and_an_add_made_at_once_keep_the_add() {
    let server = seeded(&[ROW_WITH_RELATION]);
    let peer = peer(&server);
    apply(
        &server,
        &[r#"{ "op": "update", "id": "r1", "data": { "properties": { "rel": [] } } }"#],
    );
    apply(
        &peer,
        &[
            r#"{ "op": "update", "id": "r1", "data": { "properties": { "rel": [{ "id": "z" }, { "id": "c" }] } } }"#,
        ],
    );
    exchange(&server, &peer);
    assert_eq!(related_ids(&server), ["c"]);
    assert_eq!(related_ids(&peer), ["c"]);
}

#[test]
fn an_update_that_adds_an_empty_list_makes_a_keyed_container() {
    let doc = seeded(&[
        r#"{ "id": "r1", "type": "database-row", "data": { "properties": { "n": 1 } } }"#,
    ]);
    apply(
        &doc,
        &[r#"{ "op": "update", "id": "r1", "data": { "properties": { "n": 1, "rel": [] } } }"#],
    );
    let properties = as_map(entry(&data(&doc, "r1"), "properties"));
    assert!(is_keyed_container(properties.get("rel")));
}

const ROW_WITH_TITLE: &str = r#"{ "id": "r1", "type": "database-row",
    "data": { "title": "Ship it", "properties": { "status": "todo" } } }"#;

fn title(doc: &Doc) -> String {
    entry(&data(doc, "r1"), "title")
        .as_text()
        .unwrap_or_else(|| panic!("not a YText"))
        .units()
        .to_string()
}

fn type_title(doc: &Doc, index: i64, characters: &str) {
    let title = entry(&data(doc, "r1"), "title")
        .as_text()
        .unwrap_or_else(|| panic!("not a YText"));
    doc.transact(|t| title.insert(Some(t), index, characters, None))
        .unwrap_or_else(|err| panic!("{err}"));
}

// C# YDocConverterDatabaseRowTitleTests: a database-row's top-level title
// is a Y.Text whoever seeds it, because title is a diffable text key.
#[test]
fn seed_stores_a_database_row_title_as_a_y_text() {
    assert_eq!(title(&seeded(&[ROW_WITH_TITLE])), "Ship it");
}

#[test]
fn two_clients_typing_in_one_row_title_keep_both_bursts() {
    let server = seeded(&[ROW_WITH_TITLE]);
    let left = peer(&server);
    let right = peer(&server);
    type_title(&left, 0, "A ");
    type_title(&right, "Ship it".len() as i64, " B");
    exchange(&server, &left);
    exchange(&server, &right);
    exchange(&server, &left);
    for doc in [&server, &left, &right] {
        assert_eq!(title(doc), "A Ship it B");
    }
}

// A row written before the top-level title existed keeps its title inside
// properties, a nested key and so an atomic leaf, as on the client.
#[test]
fn an_old_row_keeps_its_nested_title_atomic() {
    let doc = seeded(&[r#"{ "id": "r0", "type": "database-row",
        "data": { "properties": { "title": "Legacy", "status": "todo" } } }"#]);
    let properties = as_map(entry(&data(&doc, "r0"), "properties"));
    assert_eq!(
        entry(&properties, "title"),
        Out::Any(Value::String(Str::from("Legacy")))
    );
}

#[test]
fn an_insert_op_mints_a_y_text_for_the_row_title() {
    let doc = seeded(&[r#"{ "id": "p", "type": "paragraph", "data": { "text": "" } }"#]);
    apply(
        &doc,
        &[r#"{ "op": "insert", "id": "r1", "after": "p",
        "block": { "type": "database-row", "data": { "title": "Ship it" } } }"#],
    );
    assert_eq!(title(&doc), "Ship it");
}

#[test]
fn an_edit_keeps_the_same_y_text_instance_for_the_row_title() {
    let doc = seeded(&[ROW_WITH_TITLE]);
    let before = entry(&data(&doc, "r1"), "title").as_text();
    apply(
        &doc,
        &[r#"{ "op": "update", "id": "r1", "data": { "title": "Ship it!" } }"#],
    );
    let after = entry(&data(&doc, "r1"), "title").as_text();
    assert!(before.is_some() && before == after, "{before:?} {after:?}");
    assert_eq!(title(&doc), "Ship it!");
}

#[test]
fn a_server_seeded_row_merges_a_clients_typing_with_an_edit() {
    let server = seeded(&[ROW_WITH_TITLE]);
    let client = peer(&server);
    // The client types " now" at the end of the title.
    type_title(&client, "Ship it".len() as i64, " now");
    // At the same moment the server pushes an edit that prepends "Do ".
    apply(
        &server,
        &[r#"{ "op": "update", "id": "r1", "data": { "title": "Do Ship it" } }"#],
    );
    exchange(&server, &client);
    assert_eq!(title(&server), "Do Ship it now");
    assert_eq!(title(&client), title(&server));
}

#[test]
fn the_server_never_invents_a_top_level_title_for_an_old_row() {
    let doc = seeded(&[r#"{ "id": "r0", "type": "database-row",
        "data": { "properties": { "title": "Legacy" } } }"#]);
    assert_eq!(data(&doc, "r0").keys(), [Str::from("properties")]);
    // An edit that does not carry a title must not grow one either.
    apply(
        &doc,
        &[r#"{ "op": "update", "id": "r0",
        "data": { "properties": { "title": "Legacy", "status": "done" } } }"#],
    );
    assert_eq!(data(&doc, "r0").keys(), [Str::from("properties")]);
    let want = blok_jsjson::parse(
        br#"[{ "id": "r0", "type": "database-row",
           "data": { "properties": { "title": "Legacy", "status": "done" } } }]"#,
    )
    .unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(stringify(&exported(&doc)), stringify(&want));
}

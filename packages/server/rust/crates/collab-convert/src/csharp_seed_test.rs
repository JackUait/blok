use blok_jsjson::Value;
use blok_yjs::{Array, Doc, Map, Options, Out};

use crate::export::{BLOCKS_ROOT, GRID_ORDER_KEY, GRID_ROWS_KEY};
use crate::export_test::{applied, decode64};
use crate::fields::RichTextFields;
use crate::richtextinput::RichTextInput;
use crate::seed::seed;
use crate::seed_test::{converted, node_of};

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

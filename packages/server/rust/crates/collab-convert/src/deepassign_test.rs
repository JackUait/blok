use blok_jsjson::{Options as JsonOptions, Str, Value, parse_node};
use blok_yjs::{Doc, Map, MapEntry, Options, Out};

use crate::deepassign::{assign_entry, common_ends, decimal_is_integer, number_equal, pair_rows};
use crate::export::{BLOCK_FIELD_DEPTH, GRID_ORDER_KEY, GRID_ROWS_KEY};
use crate::export_test::canonical;
use crate::seed::{SourceValue, edit_value, plain_to_y_value};

fn source(text: &str) -> SourceValue {
    let node =
        parse_node(text.as_bytes(), JsonOptions::default()).unwrap_or_else(|err| panic!("{err}"));
    edit_value(&node).unwrap_or_else(|err| panic!("{err}"))
}

/// A doc whose "data" map holds key = the seed form of text.
fn data_with(key: &str, text: &str) -> (Doc, Map) {
    let doc = Doc::new(Options::default());
    let data = doc.get_map("data").unwrap_or_else(|err| panic!("{err}"));
    let value = plain_to_y_value(&source(text), BLOCK_FIELD_DEPTH + 1)
        .unwrap_or_else(|err| panic!("{err}"));
    doc.transact(|t| data.set(t, key, value))
        .unwrap_or_else(|err| panic!("{err}"));
    (doc, data)
}

fn assign(doc: &Doc, data: &Map, key: &str, text: &str, nested: bool, list_slot: bool) {
    let v = source(text);
    doc.transact(|t| {
        assign_entry(
            t,
            data,
            &Str::from(key),
            &v,
            BLOCK_FIELD_DEPTH + 1,
            nested,
            list_slot,
        )
        .map_err(|err| blok_yjs::EngineError::new(err.to_string()))
    })
    .unwrap_or_else(|err| panic!("{err}"));
}

fn plain(data: &Map, key: &str) -> String {
    let exported = crate::deepassign::try_plain(data.get(key).as_ref(), BLOCK_FIELD_DEPTH + 1)
        .unwrap_or_else(|| panic!("no plain form"));
    canonical(&exported)
}

fn number(text: &str) -> SourceValue {
    source(text)
}

// .NET compares a live long to the request's number text by exact decimal
// value (probed on .NET 10, per the Go port's numberEqual).
#[test]
fn a_live_integer_equals_a_number_text_by_exact_decimal_value() {
    for (raw, n, want) in [
        ("100", 100, true),
        ("1.00e2", 100, true),
        ("1E2", 100, true),
        ("1000e-1", 100, true),
        ("5", 5, true),
        ("5.0000000000000000001", 5, false),
        ("5.5", 5, false),
        ("-7", -7, true),
        ("7", -7, false),
        ("-0", 0, true),
        ("0.000", 0, true),
        ("0e999999999999999999999", 0, true),
        ("1e999999999999999999999", 1, false),
        ("1e-999999999999999999999", 1, false),
        ("1.5e-9223372036854775808", 1, false),
        ("120", 12, false),
        ("12", 120, false),
        ("00012", 12, true),
    ] {
        assert_eq!(decimal_is_integer(raw.as_bytes(), n), want, "{raw} vs {n}");
    }
}

#[test]
fn a_live_double_compares_by_its_double() {
    assert!(number_equal(0.5, &number("5e-1")));
    assert!(number_equal(0.5, &number("0.50000000000000000001e0")));
    // Past 2^53 a live number is a double, so the text's double decides.
    assert!(number_equal(
        9007199254740994.0,
        &number("9007199254740994.0000001")
    ));
    assert!(!number_equal(5.0, &number("5.0000000000000000001")));
    assert!(number_equal(
        5.0,
        &SourceValue::Number(5.000_000_000_000_000_000_1)
    ));
    assert!(!number_equal(5.0, &SourceValue::String(Str::from("5"))));
}

#[test]
fn common_ends_never_overlap() {
    let same = |a: &[i32], b: &[i32]| common_ends(a.len(), b.len(), |i, j| a[i] == b[j]);
    assert_eq!(same(&[1, 2, 3], &[1, 2, 3]), (3, 0));
    assert_eq!(same(&[1, 1], &[1, 1, 1]), (2, 0));
    assert_eq!(same(&[1, 2, 3], &[1, 9, 3]), (1, 1));
    assert_eq!(same(&[], &[1]), (0, 0));
}

#[test]
fn pair_rows_matches_ends_then_equals_then_similar_then_rank() {
    let current = [10, 20, 30, 40];
    let next = [10, 31, 40];
    let similar = |c: usize, s: usize| usize::from(current[c] / 10 == next[s] / 10);
    let got = pair_rows(
        current.len(),
        next.len(),
        |c, s| current[c] == next[s],
        similar,
        true,
    );
    assert_eq!(got, vec![Some(0), Some(2), Some(3)]);
    // A rank pair that would cross a similarity pair is refused under
    // enforce_order.
    let current = [10, 20, 30];
    let next = [25, 99];
    let similar = |c: usize, s: usize| usize::from(current[c] / 10 == next[s] / 10);
    let ranked = |enforce| pair_rows(3, 2, |c, s| current[c] == next[s], similar, enforce);
    assert_eq!(ranked(true), vec![Some(1), None]);
    assert_eq!(ranked(false), vec![Some(1), Some(0)]);
}

#[test]
fn an_emptied_list_slot_is_cleared_in_place() {
    let (doc, data) = data_with("properties", r#"{"tags":[{"id":"a","v":1}]}"#);
    let properties = data
        .get("properties")
        .and_then(|v| v.as_map())
        .unwrap_or_else(|| panic!("no map"));
    let slot = properties
        .get("tags")
        .and_then(|v| v.as_map())
        .unwrap_or_else(|| panic!("no slot"));
    assign(&doc, &data, "properties", r#"{"tags":[]}"#, false, false);
    let after = data
        .get("properties")
        .and_then(|v| v.as_map())
        .and_then(|m| m.get("tags"))
        .and_then(|v| v.as_map())
        .unwrap_or_else(|| panic!("no slot"));
    assert_eq!(after, slot);
    assert_eq!(plain(&data, "properties"), r#"{"tags":[]}"#);
}

#[test]
fn a_grid_reorder_keeps_each_row_and_rewrites_the_order() {
    let (doc, data) = data_with("content", r#"[[{"rowId":"a"}],[{"rowId":"b"}]]"#);
    let grid = data
        .get("content")
        .and_then(|v| v.as_map())
        .unwrap_or_else(|| panic!("no grid"));
    let rows = grid
        .get(GRID_ROWS_KEY)
        .and_then(|v| v.as_map())
        .unwrap_or_else(|| panic!("no rows"));
    let row_a = rows.get("a");
    assign(
        &doc,
        &data,
        "content",
        r#"[[{"rowId":"b"}],[{"rowId":"a","x":1}]]"#,
        false,
        false,
    );
    assert_eq!(
        plain(&data, "content"),
        r#"[[{"rowId":"b"}],[{"rowId":"a","x":1}]]"#
    );
    assert_eq!(rows.get("a"), row_a);
    let order: Vec<Out> = grid
        .get(GRID_ORDER_KEY)
        .and_then(|v| v.as_array())
        .unwrap_or_else(|| panic!("no order"))
        .values();
    assert_eq!(
        order,
        vec![
            Out::Any(Value::String(Str::from("b"))),
            Out::Any(Value::String(Str::from("a")))
        ]
    );
}

#[test]
fn a_nested_ordered_id_list_written_plain_is_promoted() {
    let doc = Doc::new(Options::default());
    let data = doc.get_map("data").unwrap_or_else(|err| panic!("{err}"));
    let cell = Map::new(vec![MapEntry::new(
        "blocks",
        Value::Array(vec![Value::String(Str::from("x"))]),
    )]);
    doc.transact(|t| data.set(t, "cell", cell.clone()))
        .unwrap_or_else(|err| panic!("{err}"));
    assign(&doc, &data, "cell", r#"{"blocks":["x","y"]}"#, false, false);
    let blocks = cell
        .get("blocks")
        .and_then(|v| v.as_array())
        .unwrap_or_else(|| panic!("not promoted"));
    assert_eq!(blocks.len(), 2);
}

#[test]
fn an_unchanged_leaf_is_not_rewritten() {
    let (doc, data) = data_with("n", "100");
    let before = doc.encode_state_vector();
    assign(&doc, &data, "n", "1.00e2", false, false);
    assert_eq!(doc.encode_state_vector(), before);
    assign(&doc, &data, "n", "100.5", false, false);
    assert_ne!(doc.encode_state_vector(), before);
}

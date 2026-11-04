use std::collections::HashSet;

use blok_collab_convert::describe_structure;
use blok_jsjson::{Object, Value};
use blok_yjs::{Array, Doc, In, Map, MapEntry, Options};

use crate::changes::diff_blocks;
use crate::csharp_changes_test::transact;
use crate::history_fixture_test::no_html_converter;
use crate::restore::plan_restore;

// A peer can write a bigint inside block data; the export keeps it. C#
// compares exported data with JsonNode.DeepEquals (changes) and its own
// ToJsonString canonical form (restore), where a long equals itself and
// the double of the same value.

fn holding(n: Value) -> Value {
    Value::Object([("n".into(), n)].into_iter().collect::<Object>())
}

fn block(data: Value) -> Value {
    Value::Object(
        [
            ("id".into(), Value::String("a".into())),
            ("type".into(), Value::String("paragraph".into())),
            (
                "data".into(),
                Value::Object([("o".into(), data)].into_iter().collect()),
            ),
        ]
        .into_iter()
        .collect::<Object>(),
    )
}

#[test]
fn identical_blocks_holding_a_peer_bigint_are_no_change() {
    let blocks = [block(holding(Value::BigInt(7)))];

    assert!(diff_blocks(&blocks, &blocks.clone()).is_empty());
}

#[test]
fn a_peer_bigint_and_the_same_number_are_no_change() {
    let changes = diff_blocks(
        &[block(holding(Value::BigInt(7)))],
        &[block(holding(Value::Number(7.0)))],
    );

    assert!(changes.is_empty(), "{changes:?}");
}

#[test]
fn a_peer_bigint_and_another_value_are_a_change() {
    let changes = diff_blocks(
        &[block(holding(Value::BigInt(7)))],
        &[block(holding(Value::BigInt(8)))],
    );

    assert_eq!(changes.len(), 1);
}

#[test]
fn a_restore_of_an_identical_doc_holding_a_peer_bigint_plans_nothing() {
    let doc = Doc::new(Options {
        client_id: Some(1),
        no_gc: false,
    });
    let blocks = doc.get_map("blocks").unwrap_or_else(|err| panic!("{err}"));
    let root = doc.get_array("root").unwrap_or_else(|err| panic!("{err}"));
    let entry = |key: &str, value: In| MapEntry {
        key: key.into(),
        value,
    };
    transact(&doc, |txn| {
        let data = Map::new(vec![entry("o", In::Any(holding(Value::BigInt(7))))]);
        let block = Map::new(vec![
            entry("id", In::Any(Value::String("a".into()))),
            entry("type", In::Any(Value::String("paragraph".into()))),
            entry("data", data.into()),
            entry("contentIds", Array::new(Vec::new()).into()),
        ]);
        blocks
            .set(txn, "a", block)
            .unwrap_or_else(|err| panic!("{err}"));
        root.insert(txn, 0, vec![In::Any(Value::String("a".into()))])
            .unwrap_or_else(|err| panic!("{err}"));
    });
    let (exported, _) = no_html_converter()
        .export_blocks(&doc, &mut HashSet::new())
        .unwrap_or_else(|err| panic!("{err}"));

    let ops = plan_restore(
        &exported,
        &describe_structure(&doc).unwrap_or_else(|err| panic!("{err}")),
        &exported,
        &[],
        &[],
    );

    assert!(ops.is_empty(), "{ops:?}");
}

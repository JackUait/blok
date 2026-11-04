use blok_jsjson::{append_quoted, compare, stringify};
use blok_yjs::{Doc, Options, Out};

use crate::export::{
    BLOCKS_ROOT, GRID_ORDER_KEY, GRID_ROWS_KEY, ORDER_ROOT, grid_row_keys, is_grid_map,
};
use crate::export_test::{applied, canonical, collab_cases};
use crate::fields::RichTextFields;
use crate::richtext::from_delta;
use crate::richtextinput::RichTextInput;
use crate::seed::{ROW_KEY_LENGTH, seed};
use crate::seed_test::{converted, node_of};

/// Names every shared type and leaf under v. Grid and identity row keys
/// are left out (the client mints random ones); a row keyed by its table
/// rowId is marked, since the key is then deterministic.
pub(crate) fn shape(v: &Out) -> String {
    let mut b = String::new();
    walk(v, &mut b);
    b
}

fn walk(v: &Out, b: &mut String) {
    if let Some(m) = v.as_map() {
        if is_grid_map(&m) {
            let rows = m.get(GRID_ROWS_KEY).and_then(|v| v.as_map());
            let order = m.get(GRID_ORDER_KEY).and_then(|v| v.as_array());
            let (Some(rows), Some(order)) = (rows, order) else {
                unreachable!("a grid map holds both")
            };
            b.push_str("G[");
            for key in grid_row_keys(&order, &rows) {
                let row = rows
                    .get(&key[..])
                    .unwrap_or(Out::Any(blok_jsjson::Value::Null));
                if key.len() != ROW_KEY_LENGTH {
                    b.push_str(&key.to_string());
                    b.push('=');
                }
                walk(&row, b);
                b.push(',');
            }
            b.push(']');
            return;
        }
        let mut keys = m.keys();
        keys.sort_by(|x, y| compare(x, y));
        b.push_str("M{");
        for key in keys {
            b.push_str(&key.to_string());
            b.push(':');
            let child = m
                .get(&key[..])
                .unwrap_or(Out::Any(blok_jsjson::Value::Null));
            walk(&child, b);
            b.push(',');
        }
        b.push('}');
        return;
    }
    if let Some(array) = v.as_array() {
        b.push_str("A[");
        for item in array.values() {
            walk(&item, b);
            b.push(',');
        }
        b.push(']');
        return;
    }
    if let Some(text) = v.as_xml_text() {
        b.push('X');
        b.push_str(&canonical(&blok_jsjson::Value::Array(from_delta(
            &text.to_delta(),
        ))));
        return;
    }
    if let Some(text) = v.as_text() {
        let mut quoted = Vec::new();
        append_quoted(&mut quoted, &text.units());
        b.push('T');
        b.push_str(&String::from_utf8(quoted).unwrap_or_else(|err| panic!("{err}")));
        return;
    }
    match v {
        Out::Any(value) => {
            b.push('V');
            b.push_str(&stringify(value).unwrap_or_else(|err| panic!("{value:?}: {err}")));
        }
        other => panic!("{other:?}"),
    }
}

pub(crate) fn doc_shape(doc: &Doc) -> String {
    let blocks = doc
        .get_map(BLOCKS_ROOT)
        .unwrap_or_else(|err| panic!("{err}"));
    let order = doc
        .get_array(ORDER_ROOT)
        .unwrap_or_else(|err| panic!("{err}"));
    shape(&Out::Type(blocks.as_type().clone())) + "|" + &shape(&Out::Type(order.as_type().clone()))
}

// The seed builds the same shared types the client's fromJSON wrote into
// update.b64. The cases with a mutate step in
// scripts/generate-collab-fixtures.mjs are left out: their update.b64
// holds a shape fromJSON never writes.
#[test]
fn seed_builds_the_types_the_client_builds() {
    let mut mutated = vec![
        "grid-normalization",
        "legacy-bare-grid",
        "malformed-doc-blocks",
    ];
    let mut compared = 0;
    let mut failures = Vec::new();
    let fields = RichTextFields::built_in();
    for c in collab_cases() {
        if let Some(at) = mutated.iter().position(|name| *name == c.name) {
            mutated.remove(at);
            continue;
        }
        compared += 1;
        let blocks = node_of(&format!("collab/{}/input.json", c.name)).items;
        let seeded = Doc::new(Options::default());
        let mut input = RichTextInput::converting(&fields, converted(&blocks));
        seed(&seeded, &blocks, &mut input, None).unwrap_or_else(|err| panic!("{}: {err}", c.name));
        let (got, want) = (doc_shape(&seeded), doc_shape(&applied(&c.update)));
        if got != want {
            failures.push(format!("{}:\n got {got}\nwant {want}", c.name));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    assert!(
        mutated.is_empty() && compared >= 25,
        "missing mutate cases {mutated:?}, compared {compared}"
    );
}

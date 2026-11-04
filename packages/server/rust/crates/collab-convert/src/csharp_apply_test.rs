use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_jsjson::{
    Node, Options as JsonOptions, Str, Value, new_member, new_number, new_object, new_string,
    parse_node,
};
use blok_yjs::{Doc, In, Map, MapEntry, Options};

use crate::apply::{apply_ops, apply_ops_counted, collect_ops_html};
use crate::csharp_yrs_compat_test::{block_on, export_resolved};
use crate::editops::{EditOp, parse_edit_ops};
use crate::error::Error;
use crate::export::{BLOCKS_ROOT, MAX_VALUE_DEPTH, ORDER_ROOT};
use crate::export_test::canonical;
use crate::fields::RichTextFields;
use crate::htmlreader::HtmlReader;
use crate::richtext_test::{field, items};
use crate::richtextinput::RichTextInput;
use crate::seed::seed;
use crate::seed_test::{converted, reader};

// C# YDocConverterEditTests: the block-level edit path behind
// POST /sync/{doc}/edit. Every op is validated against the doc before
// anything is written, so a refused request leaves the doc untouched.

const ROOT: &str = r#"{ "id": "root", "type": "paragraph", "data": { "text": "r" } }"#;
const SECOND: &str = r#"{ "id": "second", "type": "paragraph", "data": { "text": "s" } }"#;

pub(crate) fn nodes(json: &[&str]) -> Vec<Node> {
    json.iter()
        .map(|block| {
            parse_node(block.as_bytes(), JsonOptions::default())
                .unwrap_or_else(|err| panic!("{err}"))
        })
        .collect()
}

/// RichTextRuntime.Seed: the seed's HTML read by the runtime first.
pub(crate) fn rt_seeded(json: &[&str]) -> Doc {
    let blocks = nodes(json);
    let doc = Doc::new(Options::default());
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

/// RichTextRuntime.ApplyOps: the ops' HTML read by the runtime first.
pub(crate) fn rt_apply(doc: &Doc, ops: &[EditOp]) -> Result<(), Error> {
    let fields = RichTextFields::built_in();
    let found = collect_ops_html(doc, ops, &fields)?;
    let mut table = std::collections::HashMap::new();
    if !found.is_empty() {
        let read = block_on(reader().read(&found, Duration::ZERO))?;
        for (html, segments) in found.iter().zip(read) {
            table.insert(html.html.clone(), segments);
        }
    }
    apply_ops(doc, ops, &mut RichTextInput::converting(&fields, table))
}

/// Ops as the endpoint builds them, so the tests carry the real request shape.
pub(crate) fn ops(json: &[&str]) -> Vec<EditOp> {
    let body = format!(r#"{{ "ops": [{}] }}"#, json.join(","));
    parse_edit_ops(body.as_bytes()).unwrap_or_else(|err| panic!("{body}: {err}"))
}

pub(crate) fn rt_apply_json(doc: &Doc, json: &[&str]) {
    rt_apply(doc, &ops(json)).unwrap_or_else(|err| panic!("{err}"));
}

pub(crate) fn refused_ops(doc: &Doc, ops: &[EditOp]) -> String {
    match rt_apply(doc, ops) {
        Err(Error::Edit(err)) => err.message,
        other => panic!("{other:?}, want an edit refusal"),
    }
}

fn refused(doc: &Doc, json: &[&str]) -> String {
    refused_ops(doc, &ops(json))
}

/// RichTextRuntime.Export: legacy HTML slots read to segments.
pub(crate) fn rt_exported(doc: &Doc) -> Value {
    export_resolved(reader(), doc)
}

fn canonical_doc(doc: &Doc) -> String {
    canonical(&rt_exported(doc))
}

pub(crate) fn ids(exported: &Value) -> Vec<String> {
    items(exported)
        .iter()
        .map(|block| match field(block, "id") {
            Value::String(id) => id.to_string(),
            _ => String::new(),
        })
        .collect()
}

pub(crate) fn block_named<'a>(exported: &'a Value, id: &str) -> &'a Value {
    items(exported)
        .iter()
        .find(|block| matches!(field(block, "id"), Value::String(found) if found.to_string() == id))
        .unwrap_or_else(|| panic!("no block {id}"))
}

pub(crate) fn strings(array: &Value) -> Vec<String> {
    match array {
        Value::Array(entries) => entries
            .iter()
            .map(|entry| match entry {
                Value::String(text) => text.to_string(),
                _ => String::new(),
            })
            .collect(),
        _ => Vec::new(),
    }
}

pub(crate) fn json(value: &Value) -> String {
    blok_jsjson::stringify(value).unwrap_or_else(|err| panic!("{err}"))
}

fn text_of(exported: &Value, id: &str) -> String {
    json(field(field(block_named(exported, id), "data"), "text"))
}

#[test]
fn inserts_first_when_after_is_null() {
    let doc = rt_seeded(&[ROOT, SECOND]);
    rt_apply_json(
        &doc,
        &[r#"{ "op": "insert", "id": "new", "block": { "type": "header", "data": {} } }"#],
    );
    assert_eq!(ids(&rt_exported(&doc)), ["new", "root", "second"]);
}

#[test]
fn inserts_after_the_named_sibling() {
    let doc = rt_seeded(&[ROOT, SECOND]);
    rt_apply_json(
        &doc,
        &[r#"{ "op": "insert", "id": "new", "after": "root",
          "block": { "type": "header", "data": { "text": "n", "level": 2 } } }"#],
    );
    let exported = rt_exported(&doc);
    assert_eq!(ids(&exported), ["root", "new", "second"]);
    assert_eq!(
        field(block_named(&exported, "new"), "type"),
        &Value::String(Str::from("header"))
    );
    assert_eq!(text_of(&exported, "new"), r#"[{"text":"n"}]"#);
}

// parentId is the membership arbiter: an inserted child that carried only
// its parent's contentIds entry would be filtered out on export and come
// back as a root orphan.
#[test]
fn inserts_under_a_parent_and_links_it_both_ways() {
    let doc = rt_seeded(&[
        r#"{ "id": "root", "type": "toggle", "data": {}, "content": ["kid"] }"#,
        r#"{ "id": "kid", "type": "paragraph", "data": {}, "parent": "root" }"#,
    ]);
    rt_apply_json(
        &doc,
        &[
            r#"{ "op": "insert", "id": "new", "parent": "root", "after": "kid",
          "block": { "type": "paragraph", "data": { "text": "n" } } }"#,
        ],
    );
    let exported = rt_exported(&doc);
    assert_eq!(ids(&exported), ["root", "kid", "new"]);
    assert_eq!(
        field(block_named(&exported, "new"), "parent"),
        &Value::String(Str::from("root"))
    );
    assert_eq!(
        strings(field(block_named(&exported, "root"), "content")),
        ["kid", "new"]
    );
}

#[test]
fn later_ops_see_the_effects_of_earlier_ones() {
    let doc = rt_seeded(&[ROOT]);
    rt_apply_json(
        &doc,
        &[
            r#"{ "op": "insert", "id": "a", "after": "root", "block": { "type": "p", "data": {} } }"#,
            r#"{ "op": "insert", "id": "b", "parent": "a", "block": { "type": "p", "data": {} } }"#,
            r#"{ "op": "update", "id": "b", "data": { "text": "late" } }"#,
            r#"{ "op": "remove", "id": "root" }"#,
        ],
    );
    let exported = rt_exported(&doc);
    assert_eq!(ids(&exported), ["a", "b"]);
    assert_eq!(
        field(field(block_named(&exported, "b"), "data"), "text"),
        &Value::String(Str::from("late"))
    );
}

#[test]
fn update_replaces_the_data_wholesale() {
    let doc = rt_seeded(&[
        r#"{ "id": "root", "type": "paragraph", "data": { "text": "old", "level": 3 } }"#,
    ]);
    rt_apply_json(
        &doc,
        &[r#"{ "op": "update", "id": "root", "data": { "text": "new" } }"#],
    );
    let exported = rt_exported(&doc);
    let data = field(block_named(&exported, "root"), "data");
    assert_eq!(json(field(data, "text")), r#"[{"text":"new"}]"#);
    assert_eq!(field(data, "level"), &Value::Undefined);
}

// Same normalization as a seed, for a block read from the doc and one
// inserted in the request.
#[test]
fn update_normalizes_empty_paragraph_data_like_a_seed() {
    let doc = rt_seeded(&[
        r#"{ "id": "p", "type": "paragraph", "data": { "text": "x" } }"#,
        r#"{ "id": "h", "type": "header", "data": { "text": "x" } }"#,
    ]);
    rt_apply_json(
        &doc,
        &[
            r#"{ "op": "update", "id": "p", "data": {} }"#,
            r#"{ "op": "update", "id": "h", "data": {} }"#,
            r#"{ "op": "insert", "id": "q", "block": { "type": "paragraph", "data": { "text": "q" } } }"#,
            r#"{ "op": "update", "id": "q", "data": {} }"#,
        ],
    );
    let exported = rt_exported(&doc);
    assert_eq!(text_of(&exported, "p"), "[]");
    assert_eq!(text_of(&exported, "q"), "[]");
    assert_eq!(json(field(block_named(&exported, "h"), "data")), "{}");
}

#[test]
fn update_keeps_the_block_type_and_its_place() {
    let doc = rt_seeded(&[ROOT, SECOND]);
    rt_apply_json(
        &doc,
        &[r#"{ "op": "update", "id": "second", "data": { "text": "new" } }"#],
    );
    let exported = rt_exported(&doc);
    assert_eq!(ids(&exported), ["root", "second"]);
    assert_eq!(
        field(block_named(&exported, "second"), "type"),
        &Value::String(Str::from("paragraph"))
    );
}

#[test]
fn remove_takes_the_whole_subtree_and_the_parents_entry() {
    let doc = rt_seeded(&[
        r#"{ "id": "root", "type": "toggle", "data": {}, "content": ["kid", "other"] }"#,
        r#"{ "id": "kid", "type": "toggle", "data": {}, "parent": "root", "content": ["grandkid"] }"#,
        r#"{ "id": "grandkid", "type": "paragraph", "data": {}, "parent": "kid" }"#,
        r#"{ "id": "other", "type": "paragraph", "data": {}, "parent": "root" }"#,
    ]);
    rt_apply_json(&doc, &[r#"{ "op": "remove", "id": "kid" }"#]);
    let exported = rt_exported(&doc);
    assert_eq!(ids(&exported), ["root", "other"]);
    assert_eq!(
        strings(field(block_named(&exported, "root"), "content")),
        ["other"]
    );
}

// A block whose parentId names the removed one but that its contentIds
// never listed would be left behind with a dangling parent, and the
// client's orphan pass would resurrect it at the top of the document.
#[test]
fn remove_takes_a_block_parented_to_it_even_when_it_is_not_listed() {
    let doc = rt_seeded(&[
        ROOT,
        r#"{ "id": "gone", "type": "toggle", "data": {} }"#,
        r#"{ "id": "stray", "type": "paragraph", "data": {}, "parent": "gone" }"#,
    ]);
    rt_apply_json(&doc, &[r#"{ "op": "remove", "id": "gone" }"#]);
    assert_eq!(ids(&rt_exported(&doc)), ["root"]);
}

// "gone" lists x, but x names another parent, so x is displayed there and
// survives the removal.
#[test]
fn remove_keeps_a_listed_block_that_names_another_parent() {
    let doc = rt_seeded(&[
        r#"{ "id": "root", "type": "toggle", "data": {}, "content": ["x"] }"#,
        r#"{ "id": "x", "type": "paragraph", "data": {}, "parent": "root" }"#,
        r#"{ "id": "gone", "type": "toggle", "data": {}, "content": ["x"] }"#,
    ]);
    rt_apply_json(&doc, &[r#"{ "op": "remove", "id": "gone" }"#]);
    let exported = rt_exported(&doc);
    assert_eq!(ids(&exported), ["root", "x"]);
    assert_eq!(
        strings(field(block_named(&exported, "root"), "content")),
        ["x"]
    );
}

// A stale root-order entry would put a later re-insert of the same id back
// at the removed block's old position.
#[test]
fn remove_drops_the_root_order_entry_so_the_id_can_be_used_again() {
    let doc = rt_seeded(&[ROOT, SECOND]);
    rt_apply_json(
        &doc,
        &[
            r#"{ "op": "remove", "id": "root" }"#,
            r#"{ "op": "insert", "id": "root", "after": "second",
              "block": { "type": "paragraph", "data": { "text": "again" } } }"#,
        ],
    );
    let exported = rt_exported(&doc);
    assert_eq!(ids(&exported), ["second", "root"]);
    assert_eq!(text_of(&exported, "root"), r#"[{"text":"again"}]"#);
}

/// Writes a non-block into the blocks map, as a peer can.
pub(crate) fn poison(doc: &Doc, id: &str) {
    let blocks = doc
        .get_map(BLOCKS_ROOT)
        .unwrap_or_else(|err| panic!("{err}"));
    doc.transact(|t| blocks.set(t, id, Value::String(Str::from("not a block"))))
        .unwrap_or_else(|err| panic!("{err}"));
}

// A step that throws mid-transaction is the one way a partial edit could be
// written, so an op aimed at a non-block is refused while planning.
#[test]
fn refuses_an_op_aimed_at_something_that_is_not_a_block() {
    for op in [
        r#"{ "op": "update", "id": "poison", "data": { "text": "x" } }"#,
        r#"{ "op": "insert", "id": "new", "parent": "poison", "block": { "type": "p", "data": {} } }"#,
    ] {
        let doc = rt_seeded(&[ROOT]);
        poison(&doc, "poison");
        let message = refused(&doc, &[op]);
        assert!(message.contains("not a block"), "{op}: {message}");
        assert_eq!(ids(&rt_exported(&doc)), ["root"]);
    }
}

// The removal walk is linear in the subtree, not in the document. Pinned by
// counting the walk's steps, never by the clock.
#[test]
fn removes_from_a_large_document_without_rescanning_it_per_step() {
    const CHAIN_LENGTH: usize = 10;
    let mut json: Vec<String> = (0..4000)
        .map(|i| format!(r#"{{ "id": "n{i}", "type": "paragraph", "data": {{ "text": "x" }} }}"#))
        .collect();
    // n0 owns a chain c1 -> c2 -> ... by parentId alone.
    for i in 1..=CHAIN_LENGTH {
        let parent = if i == 1 {
            "n0".to_string()
        } else {
            format!("c{}", i - 1)
        };
        json.push(format!(
            r#"{{ "id": "c{i}", "type": "paragraph", "data": {{}}, "parent": "{parent}" }}"#
        ));
    }
    let json: Vec<&str> = json.iter().map(String::as_str).collect();
    let doc = rt_seeded(&json);
    let fields = RichTextFields::built_in();
    let visited = apply_ops_counted(
        &doc,
        &ops(&[r#"{ "op": "remove", "id": "n0" }"#]),
        &mut RichTextInput::refusing(&fields),
    )
    .unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(items(&rt_exported(&doc)).len(), 3999);
    assert_eq!(visited, CHAIN_LENGTH + 1);
}

// A block may list a child that names somebody else. Removing that child
// has to clear the stale entry too.
#[test]
fn remove_clears_the_entry_of_a_block_that_lists_it_without_parenting_it() {
    let doc = rt_seeded(&[
        r#"{ "id": "lister", "type": "toggle", "data": {}, "content": ["kid"] }"#,
        r#"{ "id": "owner", "type": "toggle", "data": {}, "content": ["kid"] }"#,
        r#"{ "id": "kid", "type": "paragraph", "data": {}, "parent": "owner" }"#,
    ]);
    rt_apply_json(&doc, &[r#"{ "op": "remove", "id": "owner" }"#]);
    let exported = rt_exported(&doc);
    assert_eq!(ids(&exported), ["lister"]);
    assert!(strings(field(block_named(&exported, "lister"), "content")).is_empty());
}

// The planner's picture has to follow its own inserts.
#[test]
fn removing_a_block_inserted_earlier_in_the_request_unlinks_it_from_its_parent() {
    let doc = rt_seeded(&[
        r#"{ "id": "root", "type": "toggle", "data": {}, "content": ["kid"] }"#,
        r#"{ "id": "kid", "type": "paragraph", "data": {}, "parent": "root" }"#,
    ]);
    rt_apply_json(
        &doc,
        &[
            r#"{ "op": "insert", "id": "x", "parent": "root", "after": "kid",
              "block": { "type": "p", "data": {} } }"#,
            r#"{ "op": "remove", "id": "x" }"#,
        ],
    );
    let exported = rt_exported(&doc);
    assert_eq!(ids(&exported), ["root", "kid"]);
    assert_eq!(
        strings(field(block_named(&exported, "root"), "content")),
        ["kid"]
    );
}

// And its own removals: a child removed from one parent and re-inserted
// under another must not be doomed again when the first parent goes.
#[test]
fn removing_a_parent_spares_a_child_re_inserted_elsewhere_earlier_in_the_request() {
    let doc = rt_seeded(&[
        r#"{ "id": "p", "type": "toggle", "data": {}, "content": ["x"] }"#,
        r#"{ "id": "x", "type": "paragraph", "data": {}, "parent": "p" }"#,
        r#"{ "id": "q", "type": "toggle", "data": {} }"#,
    ]);
    rt_apply_json(
        &doc,
        &[
            r#"{ "op": "remove", "id": "x" }"#,
            r#"{ "op": "insert", "id": "x", "parent": "q",
              "block": { "type": "p", "data": { "text": "moved" } } }"#,
            r#"{ "op": "remove", "id": "p" }"#,
        ],
    );
    let exported = rt_exported(&doc);
    assert_eq!(ids(&exported), ["q", "x"]);
    assert_eq!(
        field(block_named(&exported, "x"), "parent"),
        &Value::String(Str::from("q"))
    );
}

// The planner's root order lines up slot for slot with the real array,
// including a slot holding something that is not an id.
#[test]
fn removes_the_right_entry_when_the_root_order_holds_something_that_is_not_an_id() {
    let doc = rt_seeded(&[ROOT, SECOND]);
    let root_order = doc
        .get_array(ORDER_ROOT)
        .unwrap_or_else(|err| panic!("{err}"));
    doc.transact(|t| root_order.insert(t, 0, vec![In::Any(Value::Number(1.0))]))
        .unwrap_or_else(|err| panic!("{err}"));
    rt_apply_json(&doc, &[r#"{ "op": "remove", "id": "root" }"#]);
    assert_eq!(ids(&rt_exported(&doc)), ["second"]);
}

#[test]
fn refuses_an_after_that_the_document_order_does_not_list() {
    let doc = rt_seeded(&[ROOT]);
    let order = doc
        .get_array(ORDER_ROOT)
        .unwrap_or_else(|err| panic!("{err}"));
    doc.transact(|t| order.delete(t, 0, order.len() as i64))
        .unwrap_or_else(|err| panic!("{err}"));
    let message = refused(
        &doc,
        &[
            r#"{ "op": "insert", "id": "new", "after": "root", "block": { "type": "p", "data": {} } }"#,
        ],
    );
    assert!(message.contains("document order"), "{message}");
}

// A peer can write a block with no contentIds array; placing a child under
// it would link nothing.
#[test]
fn refuses_an_insert_under_a_parent_that_has_no_children_list() {
    let doc = rt_seeded(&[ROOT]);
    let blocks = doc
        .get_map(BLOCKS_ROOT)
        .unwrap_or_else(|err| panic!("{err}"));
    doc.transact(|t| {
        blocks.set(
            t,
            "bare",
            Map::new(vec![
                MapEntry::new("id", Value::String(Str::from("bare"))),
                MapEntry::new("type", Value::String(Str::from("toggle"))),
                MapEntry::new("data", Map::new(Vec::new())),
            ]),
        )
    })
    .unwrap_or_else(|err| panic!("{err}"));
    let before = canonical_doc(&doc);
    let message = refused(
        &doc,
        &[
            r#"{ "op": "insert", "id": "new", "parent": "bare", "block": { "type": "p", "data": {} } }"#,
        ],
    );
    assert!(message.contains("children"), "{message}");
    assert_eq!(canonical_doc(&doc), before);
}

// "after" has to be in the parent's order, not merely parented to it.
#[test]
fn refuses_an_after_that_the_parents_children_list_does_not_hold() {
    let doc = rt_seeded(&[
        r#"{ "id": "root", "type": "toggle", "data": {} }"#,
        r#"{ "id": "kid", "type": "paragraph", "data": {}, "parent": "root" }"#,
    ]);
    let before = canonical_doc(&doc);
    let message = refused(
        &doc,
        &[
            r#"{ "op": "insert", "id": "new", "parent": "root", "after": "kid",
          "block": { "type": "p", "data": {} } }"#,
        ],
    );
    assert!(message.contains("document order"), "{message}");
    assert_eq!(canonical_doc(&doc), before);
}

fn block(json: &str) -> Node {
    parse_node(json.as_bytes(), JsonOptions::default()).unwrap_or_else(|err| panic!("{err}"))
}

fn s(text: &str) -> Str {
    Str::from(text)
}

// The NUL screen covers every compared id, not merely some.
#[test]
fn refuses_a_nul_in_an_id_that_is_only_ever_compared() {
    for op in [
        EditOp::Insert {
            id: s("new"),
            block: block(r#"{ "type": "p", "data": {} }"#),
            after: Some(s("root\0x")),
            parent: None,
        },
        EditOp::Update {
            id: s("root\0x"),
            data: new_object(Vec::new()),
        },
    ] {
        let doc = rt_seeded(&[ROOT]);
        let message = refused_ops(&doc, &[op]);
        assert!(message.contains("NUL"), "{message}");
    }
}

#[test]
fn refuses_an_op_that_disagrees_with_the_doc_and_writes_nothing() {
    for (op, mentions) in [
        (
            r#"{ "op": "insert", "id": "root", "block": { "type": "p", "data": {} } }"#,
            "already",
        ),
        (
            r#"{ "op": "insert", "id": "new", "parent": "ghost", "block": { "type": "p", "data": {} } }"#,
            "ghost",
        ),
        (
            r#"{ "op": "insert", "id": "new", "after": "ghost", "block": { "type": "p", "data": {} } }"#,
            "ghost",
        ),
        (r#"{ "op": "update", "id": "ghost", "data": {} }"#, "ghost"),
        (r#"{ "op": "remove", "id": "ghost" }"#, "ghost"),
    ] {
        let doc = rt_seeded(&[ROOT, SECOND]);
        let before = canonical_doc(&doc);
        let message = refused(&doc, &[op]);
        assert!(message.starts_with("collab: op 0:"), "{op}: {message}");
        assert!(message.contains(mentions), "{op}: {message}");
        assert_eq!(canonical_doc(&doc), before);
    }
}

// "after" names a sibling, so a block from another container is not one.
#[test]
fn refuses_an_after_that_is_not_a_child_of_the_target_parent() {
    let doc = rt_seeded(&[
        r#"{ "id": "root", "type": "toggle", "data": {}, "content": ["kid"] }"#,
        r#"{ "id": "kid", "type": "paragraph", "data": {}, "parent": "root" }"#,
    ]);
    let message = refused(
        &doc,
        &[
            r#"{ "op": "insert", "id": "new", "after": "kid", "block": { "type": "p", "data": {} } }"#,
        ],
    );
    assert!(message.contains("kid"), "{message}");
    assert_eq!(ids(&rt_exported(&doc)), ["root", "kid"]);
}

#[test]
fn writes_nothing_when_a_later_op_is_invalid() {
    let doc = rt_seeded(&[ROOT]);
    let before = canonical_doc(&doc);
    let message = refused(
        &doc,
        &[
            r#"{ "op": "insert", "id": "new", "block": { "type": "p", "data": {} } }"#,
            r#"{ "op": "remove", "id": "ghost" }"#,
        ],
    );
    assert!(message.starts_with("collab: op 1:"), "{message}");
    assert_eq!(canonical_doc(&doc), before);
}

#[test]
fn refuses_data_nested_deeper_than_the_value_limit() {
    let doc = rt_seeded(&[ROOT]);
    let deep = r#"{ "k": "#.repeat(MAX_VALUE_DEPTH + 2) + "1" + &"}".repeat(MAX_VALUE_DEPTH + 2);
    let message = refused(
        &doc,
        &[&format!(
            r#"{{ "op": "update", "id": "root", "data": {deep} }}"#
        )],
    );
    assert!(message.contains("nested"), "{message}");
    assert_eq!(ids(&rt_exported(&doc)), ["root"]);
}

/// Built node by node, never by parsing: a raw NUL inside a JSON string
/// literal is refused by the reader itself.
fn nul_op(position: &str) -> EditOp {
    let insert = |id: &str, block: Node, parent: Option<&str>| EditOp::Insert {
        id: s(id),
        block,
        after: None,
        parent: parent.map(s),
    };
    let block_of = |kind: &str, data: Node| {
        new_object(vec![
            new_member("type", new_string(&s(kind))),
            new_member("data", data),
        ])
    };
    match position {
        "insert id" => insert("new\0id", block(r#"{ "type": "p", "data": {} }"#), None),
        "insert type" => insert("new", block_of("p\0p", new_object(Vec::new())), None),
        "insert data key" => insert(
            "new",
            block_of("p", new_object(vec![new_member("k\0", new_number("1"))])),
            None,
        ),
        "insert data value" => insert(
            "new",
            block_of(
                "p",
                new_object(vec![new_member("k", new_string(&s("a\0b")))]),
            ),
            None,
        ),
        "insert parent" => insert(
            "new",
            block(r#"{ "type": "p", "data": {} }"#),
            Some("root\0"),
        ),
        "update data" => EditOp::Update {
            id: s("root"),
            data: new_object(vec![new_member("text", new_string(&s("a\0b")))]),
        },
        _ => EditOp::Remove { id: s("root\0") },
    }
}

// The request parser is the first NUL gate; this is the second one, for
// any caller that reaches the converter directly.
#[test]
fn refuses_a_nul_that_did_not_come_through_the_request_parser() {
    for position in [
        "insert id",
        "insert type",
        "insert data key",
        "insert data value",
        "insert parent",
        "update data",
        "remove id",
    ] {
        let doc = rt_seeded(&[ROOT]);
        let message = refused_ops(&doc, &[nul_op(position)]);
        assert!(
            message.starts_with("collab: op 0:"),
            "{position}: {message}"
        );
        assert!(message.contains("NUL"), "{position}: {message}");
        assert_eq!(ids(&rt_exported(&doc)), ["root"]);
    }
}

// The room fails an edit that does not emit exactly one update: every op of
// a batch lands in one transaction.
#[test]
fn a_batch_emits_exactly_one_update() {
    let doc = rt_seeded(&[ROOT, SECOND]);
    let emitted = Arc::new(Mutex::new(0));
    let sink = Arc::clone(&emitted);
    let _subscription = doc.on_update(move |update| {
        if update.local {
            *sink.lock().unwrap_or_else(|err| panic!("{err}")) += 1;
        }
    });
    rt_apply_json(
        &doc,
        &[
            r#"{ "op": "insert", "id": "first", "after": "root", "block": { "type": "header", "data": {} } }"#,
            r#"{ "op": "insert", "id": "third", "after": "first", "block": { "type": "header", "data": {} } }"#,
            r#"{ "op": "remove", "id": "second" }"#,
        ],
    );
    assert_eq!(*emitted.lock().unwrap_or_else(|err| panic!("{err}")), 1);
    assert_eq!(ids(&rt_exported(&doc)), ["root", "first", "third"]);
}

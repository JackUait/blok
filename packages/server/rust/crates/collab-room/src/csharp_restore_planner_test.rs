use blok_collab_convert::{
    DocConverter, EditOp, Error as ConvertError, MapPatch, RuntimeHtmlReader, describe_structure,
    read_page_maps,
};
use blok_jsjson::{Object, Str, Value};
use blok_jsruntime::Pool;
use blok_yjs::{Doc, In, Map, Options, Out, Text};

use crate::csharp_changes_test::{get, node, runtime_converter, text_of, transact};
use crate::restore::{normalize_target, plan_restore};

// Twins of C# CollabRestorePlannerTests: a restore planned against a real
// doc, applied through the /edit path, and exported again. The export must
// equal the normalized target.

type Converter = DocConverter<&'static RuntimeHtmlReader<Pool>>;

fn ok<T, E: std::fmt::Display>(result: Result<T, E>) -> T {
    result.unwrap_or_else(|err| panic!("{err}"))
}

fn p(id: &str, parent: Option<&str>, text: Option<&str>) -> String {
    let mut block = Object::new();
    block.set("id".into(), Value::String(id.into()));
    block.set("type".into(), Value::String("paragraph".into()));
    let mut data = Object::new();
    data.set("text".into(), Value::String(text.unwrap_or(id).into()));
    block.set("data".into(), Value::Object(data));
    if let Some(parent) = parent {
        block.set("parent".into(), Value::String(parent.into()));
    }
    text_of(&Value::Object(block))
}

fn parent(id: &str, kind: &str, content: &[&str], parent: Option<&str>) -> String {
    let mut block = Object::new();
    block.set("id".into(), Value::String(id.into()));
    block.set("type".into(), Value::String(kind.into()));
    block.set("data".into(), Value::Object(Object::new()));
    block.set(
        "content".into(),
        Value::Array(
            content
                .iter()
                .map(|child| Value::String((*child).into()))
                .collect(),
        ),
    );
    if let Some(parent) = parent {
        block.set("parent".into(), Value::String(parent.into()));
    }
    text_of(&Value::Object(block))
}

async fn doc(blocks: &[String]) -> Doc {
    let doc = Doc::new(Options::default());
    ok(runtime_converter()
        .seed(
            &doc,
            &node(&format!(r#"{{"blocks":[{}]}}"#, blocks.join(","))),
        )
        .await);
    doc
}

async fn export(converter: &Converter, doc: &Doc) -> Vec<Value> {
    match ok(converter.export(doc).await).get(&"blocks".into()) {
        Some(Value::Array(blocks)) => blocks.clone(),
        other => panic!("blocks is {other:?}"),
    }
}

/// A target as a replay hands it over: the export of a seeded doc.
async fn target(blocks: &[String]) -> Vec<Value> {
    export(&runtime_converter(), &doc(blocks).await).await
}

fn sort_keys(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut members: Vec<_> = object.members().iter().collect();
            members.sort_by(|a, b| a.key.cmp(&b.key));
            Value::Object(
                members
                    .into_iter()
                    .map(|member| (member.key.clone(), sort_keys(&member.value)))
                    .collect(),
            )
        }
        Value::Array(items) => Value::Array(items.iter().map(sort_keys).collect()),
        other => other.clone(),
    }
}

/// Canonical JSON without lastEditedAt/lastEditedBy.
fn unstamped(blocks: &[Value]) -> String {
    let stamps = [Str::from("lastEditedAt"), Str::from("lastEditedBy")];
    let copy: Vec<Value> = blocks
        .iter()
        .map(|block| match block {
            Value::Object(object) => Value::Object(
                object
                    .members()
                    .iter()
                    .filter(|member| !stamps.contains(&member.key))
                    .map(|member| (member.key.clone(), member.value.clone()))
                    .collect(),
            ),
            other => other.clone(),
        })
        .collect();
    text_of(&sort_keys(&Value::Array(copy)))
}

fn string(value: &Value) -> String {
    match value {
        Value::String(s) => s.to_string(),
        other => text_of(other),
    }
}

/// Export order as "id" or "id<parent", an independent check on normalize_target.
fn outline(blocks: &[Value]) -> Vec<String> {
    blocks
        .iter()
        .map(|block| {
            let Value::Object(object) = block else {
                panic!("{block:?}");
            };
            let id = string(get(block, "id"));
            match object.get(&"parent".into()) {
                Some(parent) => format!("{id}<{}", string(parent)),
                None => id,
            }
        })
        .collect()
}

fn block<'a>(blocks: &'a [Value], id: &str) -> &'a Value {
    let found: Vec<&Value> = blocks
        .iter()
        .filter(|block| matches!(block, Value::Object(o) if o.get(&"id".into()) == Some(&Value::String(id.into()))))
        .collect();
    assert_eq!(found.len(), 1, "{id}");
    found[0]
}

fn rich_text(blocks: &[Value], id: &str) -> String {
    match get(get(block(blocks, id), "data"), "text") {
        Value::Array(segments) => string(get(&segments[0], "text")),
        other => panic!("{other:?}"),
    }
}

fn outlined(items: &[&str]) -> Vec<String> {
    items.iter().map(|item| (*item).to_owned()).collect()
}

async fn restore(doc: &Doc, target: &[Value]) -> Vec<Value> {
    restore_plan(doc, target).await.1
}

/// Plans against doc, applies the plan, and checks the export equals the
/// normalized target, edit stamps aside.
async fn restore_plan(doc: &Doc, target: &[Value]) -> (Vec<EditOp>, Vec<Value>) {
    let converter = runtime_converter();
    let current = export(&converter, doc).await;
    let expected = unstamped(&normalize_target(target));

    // Otherwise an empty plan would pass.
    assert_ne!(expected, unstamped(&current));

    let ops = plan_restore(&current, &ok(describe_structure(doc)), target, &[], &[]);
    ok(converter.apply_ops(doc, &ops).await);
    let after = export(&converter, doc).await;

    assert_eq!(expected, unstamped(&after));
    (ops, after)
}

async fn plan_with_maps(converter: &Converter, doc: &Doc, target: &Doc) -> Vec<EditOp> {
    plan_restore(
        &export(converter, doc).await,
        &ok(describe_structure(doc)),
        &export(converter, target).await,
        &ok(read_page_maps(doc)),
        &ok(read_page_maps(target)),
    )
}

fn set_map(doc: &Doc, map: &str, key: &str, value: impl Into<In>) {
    let map = ok(doc.get_map(map));
    let value = value.into();
    transact(doc, |txn| ok(map.set(txn, key, value)));
}

fn map_value(doc: &Doc, map: &str, key: &str) -> Option<Out> {
    ok(doc.get_map(map)).get(key)
}

fn icon(emoji: &str) -> Value {
    let mut icon = Object::new();
    icon.set("type".into(), Value::String("emoji".into()));
    icon.set("value".into(), Value::String(emoji.into()));
    Value::Object(icon)
}

fn block_map(doc: &Doc, id: &str) -> Map {
    ok(doc.get_map("blocks"))
        .get(id)
        .and_then(|block| block.as_map())
        .unwrap_or_else(|| panic!("{id} is not a map"))
}

#[tokio::test]
async fn swaps_roots() {
    let doc = doc(&[p("a", None, None), p("b", None, None)]).await;

    let after = restore(
        &doc,
        &target(&[p("b", None, None), p("a", None, None)]).await,
    )
    .await;

    assert_eq!(outline(&after), outlined(&["b", "a"]));
}

/// Review Focus 1: the first draft lost the children of a moved block.
#[tokio::test]
async fn moves_a_block_with_children_to_another_parent_and_keeps_the_children() {
    let doc = doc(&[
        parent("a", "toggle", &["c"], None),
        parent("c", "toggle", &["g"], Some("a")),
        p("g", Some("c"), Some("grandchild")),
        parent("b", "toggle", &[], None),
    ])
    .await;

    let after = restore(
        &doc,
        &target(&[
            parent("a", "toggle", &[], None),
            parent("b", "toggle", &["c"], None),
            parent("c", "toggle", &["g"], Some("b")),
            p("g", Some("c"), Some("grandchild")),
        ])
        .await,
    )
    .await;

    assert_eq!(outline(&after), outlined(&["a", "b", "c<b", "g<c"]));
    assert_eq!(rich_text(&after, "g"), "grandchild");
}

#[tokio::test]
async fn moves_a_parent_after_its_sibling_with_its_children() {
    let doc = doc(&[
        parent("a", "toggle", &["k1", "k2"], None),
        p("k1", Some("a"), None),
        p("k2", Some("a"), None),
        p("b", None, None),
    ])
    .await;

    let after = restore(
        &doc,
        &target(&[
            p("b", None, None),
            parent("a", "toggle", &["k1", "k2"], None),
            p("k1", Some("a"), None),
            p("k2", Some("a"), None),
        ])
        .await,
    )
    .await;

    assert_eq!(outline(&after), outlined(&["b", "a", "k1<a", "k2<a"]));
}

#[tokio::test]
async fn moves_a_parent_whose_children_stay_where_they_were() {
    let doc = doc(&[
        parent("a", "toggle", &["k1", "k2"], None),
        p("k1", Some("a"), None),
        p("k2", Some("a"), None),
        parent("b", "toggle", &[], None),
    ])
    .await;

    let after = restore(
        &doc,
        &target(&[
            p("k1", None, None),
            p("k2", None, None),
            parent("b", "toggle", &["a"], None),
            parent("a", "toggle", &[], Some("b")),
        ])
        .await,
    )
    .await;

    assert_eq!(outline(&after), outlined(&["k1", "k2", "b", "a<b"]));
}

#[tokio::test]
async fn deletes_a_parent_whose_child_moves_to_root_and_keeps_the_grandchild() {
    let doc = doc(&[
        parent("p", "toggle", &["c"], None),
        parent("c", "toggle", &["g"], Some("p")),
        p("g", Some("c"), Some("deep")),
        p("x", None, None),
    ])
    .await;

    let after = restore(
        &doc,
        &target(&[
            parent("c", "toggle", &["g"], None),
            p("g", Some("c"), Some("deep")),
            p("x", None, None),
        ])
        .await,
    )
    .await;

    assert_eq!(outline(&after), outlined(&["c", "g<c", "x"]));
}

#[tokio::test]
async fn changes_the_type_of_a_block_with_children() {
    let doc = doc(&[
        parent("t", "toggle", &["k"], None),
        p("k", Some("t"), Some("kid")),
    ])
    .await;

    let after = restore(
        &doc,
        &target(&[
            parent("t", "callout", &["k"], None),
            p("k", Some("t"), Some("kid")),
        ])
        .await,
    )
    .await;

    assert_eq!(outline(&after), outlined(&["t", "k<t"]));
    assert_eq!(string(get(block(&after, "t"), "type")), "callout");
}

#[tokio::test]
async fn changes_tunes() {
    let doc = doc(&[
        r#"{ "id": "a", "type": "paragraph", "data": { "text": "a" }, "tunes": { "align": "left" } }"#.to_owned(),
        p("b", None, None),
    ])
    .await;

    let after = restore(
        &doc,
        &target(&[
            r#"{ "id": "a", "type": "paragraph", "data": { "text": "a" }, "tunes": { "align": "center" } }"#.to_owned(),
            p("b", None, None),
        ])
        .await,
    )
    .await;

    assert_eq!(
        string(get(get(block(&after, "a"), "tunes"), "align")),
        "center"
    );
}

#[tokio::test]
async fn changes_the_data_of_a_moved_block() {
    let doc = doc(&[
        p("a", None, None),
        parent("b", "toggle", &["c"], None),
        p("c", Some("b"), Some("old")),
    ])
    .await;

    let after = restore(
        &doc,
        &target(&[
            p("a", None, None),
            p("c", None, Some("new")),
            parent("b", "toggle", &[], None),
        ])
        .await,
    )
    .await;

    assert_eq!(outline(&after), outlined(&["a", "c", "b"]));
    assert_eq!(rich_text(&after, "c"), "new");
}

/// c names p as its parent but p does not list it, so c cannot be an
/// anchor: inserting after it would be refused.
#[tokio::test]
async fn replaces_an_orphan_child_its_parent_does_not_list() {
    let doc = doc(&[
        parent("p", "toggle", &["k"], None),
        p("k", Some("p"), None),
        p("c", Some("p"), None),
    ])
    .await;

    // k then c is c's current order too, so only the anchor rule keeps c
    // from staying and n from being refused after it.
    let after = restore(
        &doc,
        &target(&[
            parent("p", "toggle", &["k", "c", "n"], None),
            p("k", Some("p"), None),
            p("c", Some("p"), None),
            p("n", Some("p"), None),
        ])
        .await,
    )
    .await;

    assert_eq!(outline(&after), outlined(&["p", "k<p", "c<p", "n<p"]));
}

#[tokio::test]
async fn replaces_a_root_block_missing_from_the_root_order() {
    let doc = doc(&[p("a", None, None), p("r", None, None)]).await;
    let order = ok(doc.get_array("root"));
    transact(&doc, |txn| ok(order.delete(txn, 1, 1)));

    let after = restore(
        &doc,
        &target(&[p("a", None, None), p("r", None, None), p("n", None, None)]).await,
    )
    .await;

    assert_eq!(outline(&after), outlined(&["a", "r", "n"]));
}

/// The export reads a self-parent as root, but the edit planner reads the
/// stored value, so nothing can be inserted after that block.
#[tokio::test]
async fn replaces_a_root_block_whose_stored_parent_is_itself() {
    let doc = doc(&[p("a", None, None), p("x", None, None)]).await;
    let x = block_map(&doc, "x");
    transact(&doc, |txn| {
        ok(x.set(txn, "parentId", Value::String("x".into())))
    });

    let after = restore(
        &doc,
        &target(&[p("a", None, None), p("x", None, None), p("n", None, None)]).await,
    )
    .await;

    assert_eq!(outline(&after), outlined(&["a", "x", "n"]));
}

#[tokio::test]
async fn puts_a_block_whose_target_parent_is_missing_at_root() {
    let doc = doc(&[p("a", None, None)]).await;

    let target = target(&[
        p("a", None, None),
        p("x", Some("ghost"), None),
        p("y", None, None),
    ])
    .await;

    // The export puts the orphan at its tail; root keeps that order.
    assert_eq!(outline(&target), outlined(&["a", "y", "x<ghost"]));

    let after = restore(&doc, &target).await;

    assert_eq!(outline(&after), outlined(&["a", "y", "x"]));
}

#[tokio::test]
async fn replaces_a_non_block_key_whose_id_the_target_uses() {
    let doc = doc(&[p("a", None, None)]).await;
    set_map(&doc, "blocks", "x", Value::String("not a block".into()));

    let after = restore(
        &doc,
        &target(&[p("a", None, None), p("x", None, None)]).await,
    )
    .await;

    assert_eq!(outline(&after), outlined(&["a", "x"]));
}

#[tokio::test]
async fn gives_a_child_to_a_parent_without_a_children_list() {
    let doc = doc(&[p("p", None, None), p("q", None, None)]).await;
    let block = block_map(&doc, "p");
    transact(&doc, |txn| ok(block.delete(txn, "contentIds")));

    let after = restore(
        &doc,
        &target(&[
            r#"{ "id": "p", "type": "paragraph", "data": { "text": "p" }, "content": ["k"] }"#
                .to_owned(),
            p("k", Some("p"), None),
            p("q", None, None),
        ])
        .await,
    )
    .await;

    assert_eq!(outline(&after), outlined(&["p", "k<p", "q"]));
}

#[tokio::test]
async fn plans_nothing_for_an_identical_document() {
    let blocks = [
        parent("a", "toggle", &["c"], None),
        p("c", Some("a"), None),
        p("b", None, None),
    ];
    let doc = doc(&blocks).await;
    let converter = runtime_converter();

    let ops = plan_restore(
        &export(&converter, &doc).await,
        &ok(describe_structure(&doc)),
        &target(&blocks).await,
        &[],
        &[],
    );

    assert!(ops.is_empty(), "{ops:?}");
}

#[tokio::test]
async fn plans_one_update_for_a_data_only_change() {
    let doc = doc(&[
        parent("a", "toggle", &["c"], None),
        p("c", Some("a"), None),
        p("b", None, Some("before")),
    ])
    .await;

    let (ops, _) = restore_plan(
        &doc,
        &target(&[
            parent("a", "toggle", &["c"], None),
            p("c", Some("a"), None),
            p("b", None, Some("after")),
        ])
        .await,
    )
    .await;

    assert_eq!(ops.len(), 1);
    let EditOp::Update { id, .. } = &ops[0] else {
        panic!("{:?}", ops[0]);
    };
    assert_eq!(id.to_string(), "b");
}

#[tokio::test]
async fn reinserted_blocks_carry_the_targets_edit_stamps() {
    let doc = doc(&[
        r#"{ "id": "a", "type": "paragraph", "data": { "text": "a" }, "lastEditedAt": 1, "lastEditedBy": "u1" }"#.to_owned(),
        r#"{ "id": "b", "type": "paragraph", "data": { "text": "b" }, "lastEditedAt": 2, "lastEditedBy": "u2" }"#.to_owned(),
    ])
    .await;
    let target = target(&[
        r#"{ "id": "b", "type": "paragraph", "data": { "text": "b" }, "lastEditedAt": 20, "lastEditedBy": "v2" }"#.to_owned(),
        r#"{ "id": "a", "type": "paragraph", "data": { "text": "a" }, "lastEditedAt": 10, "lastEditedBy": "v1" }"#.to_owned(),
    ])
    .await;

    let (ops, after) = restore_plan(&doc, &target).await;
    let inserted: Vec<String> = ops
        .iter()
        .filter_map(|op| match op {
            EditOp::Insert { id, .. } => Some(id.to_string()),
            _ => None,
        })
        .collect();

    assert!(!inserted.is_empty());
    for id in &inserted {
        assert_eq!(
            get(block(&target, id), "lastEditedAt"),
            get(block(&after, id), "lastEditedAt")
        );
        assert_eq!(
            get(block(&target, id), "lastEditedBy"),
            get(block(&after, id), "lastEditedBy")
        );
    }
}

#[tokio::test]
async fn plans_one_map_patch_for_a_title_only_change() {
    let blocks = [p("a", None, None), p("b", None, None)];
    let doc = doc(&blocks).await;
    let target = self::doc(&blocks).await;
    set_map(&doc, "page", "title", Value::String("Old".into()));
    set_map(&target, "page", "title", Value::String("New".into()));
    let converter = runtime_converter();
    let before = export(&converter, &doc).await;

    let ops = plan_with_maps(&converter, &doc, &target).await;
    ok(converter.apply_ops(&doc, &ops).await);

    assert_eq!(
        ops,
        [EditOp::PatchMaps {
            patches: vec![MapPatch {
                map: "page".into(),
                key: "title".into(),
                value: Out::Any(Value::String("New".into())),
                remove: false,
            }],
        }]
    );
    assert_eq!(
        map_value(&doc, "page", "title"),
        Some(Out::Any(Value::String("New".into())))
    );
    assert_eq!(
        unstamped(&before),
        unstamped(&export(&converter, &doc).await)
    );
}

#[tokio::test]
async fn deletes_map_keys_the_target_lacks() {
    let doc = doc(&[p("a", None, None)]).await;
    let target = self::doc(&[p("a", None, None)]).await;
    set_map(&doc, "page", "icon", icon("🌿"));
    set_map(&doc, "values", "k", Value::Number(5.0));
    let converter = runtime_converter();

    let ops = plan_with_maps(&converter, &doc, &target).await;
    ok(converter.apply_ops(&doc, &ops).await);

    assert_eq!(map_value(&doc, "page", "icon"), None);
    assert_eq!(map_value(&doc, "values", "k"), None);
}

/// C#'s NotSame checks have no Rust form: values are owned copies.
#[tokio::test]
async fn sets_a_plain_value_over_a_live_nested_type_and_copies_it() {
    let doc = doc(&[p("a", None, None)]).await;
    let target = self::doc(&[p("a", None, None)]).await;
    set_map(&doc, "values", "k", Map::new(Vec::new()));
    set_map(&target, "values", "k", icon("🌿"));
    let converter = runtime_converter();

    let ops = plan_with_maps(&converter, &doc, &target).await;
    ok(converter.apply_ops(&doc, &ops).await);

    assert_eq!(map_value(&doc, "values", "k"), Some(Out::Any(icon("🌿"))));
}

#[tokio::test]
async fn leaves_a_key_alone_when_the_target_holds_a_nested_type_or_undefined() {
    let doc = doc(&[p("a", None, None)]).await;
    let target = self::doc(&[p("a", None, None)]).await;
    set_map(&doc, "page", "title", Value::String("Live".into()));
    set_map(&doc, "values", "k", Value::Number(5.0));
    let (page, values) = (ok(target.get_map("page")), ok(target.get_map("values")));
    transact(&target, |txn| {
        ok(page.set(txn, "title", Text::new(Some("nested".into()))));
        ok(values.set(txn, "k", Value::Undefined));
        ok(values.set(txn, "absent", Value::Undefined));
    });

    let ops = plan_with_maps(&runtime_converter(), &doc, &target).await;

    assert!(ops.is_empty(), "{ops:?}");
}

#[tokio::test]
async fn plans_nothing_for_equal_maps() {
    let doc = doc(&[p("a", None, None)]).await;
    let target = self::doc(&[p("a", None, None)]).await;
    for side in [&doc, &target] {
        set_map(side, "page", "title", Value::String("Same".into()));
        set_map(side, "values", "k", icon("🌿"));
    }

    assert!(
        plan_with_maps(&runtime_converter(), &doc, &target)
            .await
            .is_empty()
    );
}

async fn refused(patches: Vec<MapPatch>) {
    let doc = doc(&[p("a", None, None)]).await;
    let state = ok(doc.encode_state_as_update(&[]));

    let result = runtime_converter()
        .apply_ops(&doc, &[EditOp::PatchMaps { patches }])
        .await;

    assert!(matches!(result, Err(ConvertError::Edit(_))), "{result:?}");
    assert_eq!(state, ok(doc.encode_state_as_update(&[])));
}

#[tokio::test]
async fn the_edit_planner_refuses_a_patch_of_another_map() {
    for map in ["blocks", "root"] {
        refused(vec![MapPatch {
            map: map.into(),
            key: "a".into(),
            value: Out::Any(Value::String("x".into())),
            remove: false,
        }])
        .await;
    }
}

#[tokio::test]
async fn the_edit_planner_refuses_a_value_a_map_cannot_hold() {
    refused(vec![
        MapPatch {
            map: "page".into(),
            key: "title".into(),
            value: Out::Any(Value::String("ok".into())),
            remove: false,
        },
        MapPatch {
            map: "values".into(),
            key: "k".into(),
            value: Out::Any(Value::BigInt(7)),
            remove: false,
        },
    ])
    .await;
}

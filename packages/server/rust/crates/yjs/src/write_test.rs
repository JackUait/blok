//! Ports of the YDocWriteTests, YTextFormattingTests and StructStoreTests
//! cases that need no Node replay.

use std::sync::Arc;

use blok_jsjson::{Str, Value};

use crate::content::{Content, FormatContent};
use crate::item::Struct;
use crate::pending_test::{apply_structs, decoded_item};
use crate::store_test::{Shape, shape_of};
use crate::test_support::*;
use crate::text::{equal_attrs, strict_equals};
use crate::{Array, Doc, Id, Map, MapEntry, Out, XmlText};

pub fn own_contents(doc: &Doc) -> Vec<Content> {
    let st = doc.lock();
    st.store.clients[&st.client_id]
        .iter()
        .map(|&s| match s {
            Struct::Item(at) => st.store.items[at].content.clone(),
            Struct::Gc(_) => panic!("a GC"),
        })
        .collect()
}

#[test]
fn set_packs_every_primitive_as_any_of_length_one() {
    let doc = doc_with_id(4242);
    let blocks = doc.get_map("blocks").unwrap();
    doc.transact(|txn| {
        blocks.set(txn, "nothing", Value::Null)?;
        blocks.set(txn, "flag", Value::Bool(true))?;
        blocks.set(txn, "number", num(42.0))?;
        blocks.set(txn, "text", sv("v"))?;
        blocks.set(txn, "object", vobj(vec![("a", num(1.0))]))?;
        blocks.set(txn, "array", Value::Array(vec![sv("x")]))?;
        blocks.set(txn, "binary", Value::Bytes(vec![1, 2, 3]))
    })
    .unwrap();
    let contents = own_contents(&doc);
    assert_eq!(contents.len(), 7);
    for content in &contents[..6] {
        assert!(
            matches!(content, Content::Any(items) if items.len() == 1),
            "{content:?}"
        );
    }
    assert!(
        matches!(contents[6], Content::Binary(_)),
        "bytes are not ContentBinary"
    );
}

#[test]
fn insert_packs_consecutive_anys_into_one_item_and_a_type_flushes() {
    let doc = doc_with_id(4242);
    let list = doc.get_array("list").unwrap();
    doc.transact(|txn| {
        list.insert(
            txn,
            0,
            vec![
                sv("a").into(),
                num(1.0).into(),
                Value::Bool(true).into(),
                Value::Null.into(),
            ],
        )
    })
    .unwrap();
    let contents = own_contents(&doc);
    assert!(
        contents.len() == 1 && contents[0].len() == 4,
        "the run was not packed"
    );
    let other = doc_with_id(4242);
    let other_list = other.get_array("list").unwrap();
    other
        .transact(|txn| {
            other_list.insert(
                txn,
                0,
                vec![sv("a").into(), Map::new(Vec::new()).into(), sv("b").into()],
            )
        })
        .unwrap();
    let kinds: Vec<u8> = own_contents(&other)
        .iter()
        .map(Content::ref_number)
        .collect();
    assert_eq!(kinds, vec![8, 7, 8]);
}

#[test]
fn no_change_emits_nothing() {
    let doc = doc_with_id(4242);
    let blocks = doc.get_map("blocks").unwrap();
    let list = doc.get_array("list").unwrap();
    let content = doc.get_text("content").unwrap();
    let emitted = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = emitted.clone();
    let _subscription = doc.on_update(move |_| {
        counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    });
    type Body<'a> = Box<dyn Fn(&crate::Transaction<'_>) -> crate::EngineResult<()> + 'a>;
    let bodies: Vec<(&str, Body)> = vec![
        ("nothing", Box::new(|_| Ok(()))),
        ("absent key", Box::new(|txn| blocks.delete(txn, "absent"))),
        ("clear", Box::new(|txn| blocks.clear(txn))),
        (
            "empty insert",
            Box::new(|txn| list.insert(txn, 0, Vec::new())),
        ),
        ("empty delete", Box::new(|txn| list.delete(txn, 0, 0))),
        (
            "empty text",
            Box::new(|txn| content.insert(Some(txn), 0, "", None)),
        ),
        (
            "empty removal",
            Box::new(|txn| content.delete(Some(txn), 0, 0)),
        ),
    ];
    for (name, body) in bodies {
        assert!(doc.transact(body).unwrap().is_none(), "{name} emitted");
    }
    assert_eq!(emitted.load(std::sync::atomic::Ordering::SeqCst), 0);
}

#[test]
fn nested_transact_joins_and_only_the_outermost_emits() {
    let doc = doc_with_id(4242);
    let blocks = doc.get_map("blocks").unwrap();
    let mut inner = None;
    let outer = doc
        .transact(|txn| {
            blocks.set(txn, "a", num(1.0))?;
            inner = doc.transact(|nested| {
                assert!(
                    nested.doc() == txn.doc(),
                    "a nested call opened a second transaction"
                );
                assert!(nested.local());
                blocks.set(nested, "b", num(2.0))
            })?;
            Ok(())
        })
        .unwrap();
    assert!(inner.is_none());
    assert_eq!(must_decode(&outer.unwrap()).groups[0].structs.len(), 2);
}

#[test]
fn prelim_map_integrates_with_its_parent() {
    let doc = doc_with_id(4242);
    let blocks = doc.get_map("blocks").unwrap();
    let row = Map::new(vec![
        MapEntry::new("title", sv("first")),
        MapEntry::new("tags", Array::new(vec![sv("a").into(), sv("b").into()])),
    ]);
    assert!(row.doc().is_none(), "a prelim map has a doc");
    doc.transact(|txn| blocks.set(txn, "b1", &row)).unwrap();
    assert!(row.doc() == Some(doc.clone()));
    assert_eq!(blocks.get("b1"), Some(Out::Type(row.as_type().clone())));
    assert_eq!(row.get("title"), Some(Out::Any(sv("first"))));
    assert!(
        doc.transact(|txn| blocks.set(txn, "again", &row)).is_err(),
        "a type already in a document"
    );
}

#[test]
fn delete_from_array_splits_a_run() {
    let doc = doc_with_id(4242);
    let list = doc.get_array("list").unwrap();
    doc.transact(|txn| {
        list.insert(
            txn,
            0,
            vec![
                sv("a").into(),
                sv("b").into(),
                sv("c").into(),
                sv("d").into(),
            ],
        )
    })
    .unwrap();
    doc.transact(|txn| list.delete(txn, 1, 2)).unwrap();
    assert_eq!(
        shape_of(&doc.lock(), 4242),
        vec![Shape(0, 1, false), Shape(1, 2, true), Shape(3, 1, false)]
    );
    let values = list.values();
    assert!(values.len() == 2 && is_str(&values[1], "d"), "{values:?}");
    assert!(
        doc.transact(|txn| list.delete(txn, 1, 5)).is_err(),
        "a delete past the end"
    );
}

#[test]
fn insert_rejects_undefined_and_big_int_like_yjs() {
    let doc = doc_with_id(4242);
    let list = doc.get_array("list").unwrap();
    let blocks = doc.get_map("blocks").unwrap();
    assert!(
        doc.transact(|txn| list.insert(txn, 0, vec![Value::Undefined.into()]))
            .is_err(),
        "undefined in a list"
    );
    assert!(
        doc.transact(|txn| list.insert(txn, 0, vec![Value::BigInt(1).into()]))
            .is_err(),
        "bigint in a list"
    );
    assert!(
        doc.transact(|txn| blocks.set(txn, "big", Value::BigInt(1)))
            .is_err(),
        "bigint in a map"
    );
    assert!(
        doc.lock().store.order.is_empty(),
        "a refused write reached the store"
    );
    doc.transact(|txn| blocks.set(txn, "undef", Value::Undefined))
        .unwrap();
    assert_eq!(blocks.get("undef"), Some(Out::Any(Value::Undefined)));
}

#[test]
fn a_detached_type_refuses_writes() {
    let doc = doc_with_id(4242);
    assert!(
        doc.transact(|txn| Map::new(Vec::new()).set(txn, "k", num(1.0)))
            .is_err(),
        "a write to a prelim map"
    );
    assert!(
        doc.transact(|txn| Array::new(Vec::new()).insert(txn, 0, vec![num(1.0).into()]))
            .is_err(),
        "a write to a prelim array"
    );
    assert!(
        doc.get_text("t")
            .unwrap()
            .insert(None, 0, "a", None)
            .is_err(),
        "an attached text with no transaction"
    );
    assert!(doc.get_array("t").is_err(), "a root typed twice");
}

#[test]
fn a_queued_text_write_is_checked_when_made() {
    let text = XmlText::new(None);
    assert!(
        text.insert(
            None,
            0,
            "a",
            Some(&crate::marks(&obj(vec![("bold", Value::Undefined)])))
        )
        .is_err(),
        "an undefined mark"
    );
    assert!(
        text.insert_embed(None, 0, sv("x"), None).is_err(),
        "a string embed"
    );
    text.insert(
        None,
        0,
        "ab",
        Some(&crate::marks(&obj(vec![("bold", Value::Bool(true))]))),
    )
    .unwrap();
    let doc = doc_with_id(4242);
    let m = doc.get_map("m").unwrap();
    doc.transact(|txn| m.set(txn, "t", &text)).unwrap();
    let delta = text.to_delta();
    assert!(
        delta.len() == 1 && delta[0].insert == Out::Any(sv("ab")) && delta[0].attributes.is_some(),
        "{delta:?}"
    );
}

#[test]
fn marks_are_written_in_js_key_order() {
    let doc = doc_with_id(4242);
    let text = doc.get_text("t").unwrap();
    let marks = obj(vec![
        ("b", Value::Bool(true)),
        ("1", Value::Bool(true)),
        ("a", Value::Bool(true)),
    ]);
    doc.transact(|txn| text.insert(Some(txn), 0, "a", Some(&crate::marks(&marks))))
        .unwrap();
    let st = doc.lock();
    let id = text.as_type().attached_id().unwrap();
    let mut keys = Vec::new();
    let mut current = st.store.types[id].start;
    while let Some(at) = current {
        if let Content::Format(format) = &st.store.items[at].content
            && *format.value() != Value::Null
        {
            keys.push(format.key.to_string());
        }
        current = st.store.items[at].right;
    }
    assert_eq!(keys, vec!["1", "b", "a"]);
}

#[test]
fn to_delta_reads_a_null_embed_and_skips_formats_in_to_string() {
    let doc = doc_with_id(4242);
    let text = doc.get_text("t").unwrap();
    let mut embed = decoded_item(Id::new(PEER, 0), Content::Embed(Arc::new(s("null"))), 0x05);
    embed.parent_root = Some(s("t"));
    let mut format = decoded_item(
        Id::new(PEER, 1),
        Content::Format(Arc::new(FormatContent::new(s("bold"), s("true")))),
        0x86,
    );
    format.origin = Some(Id::new(PEER, 0));
    let mut chunk = decoded_item(Id::new(PEER, 2), Content::String(s("hi")), 0x84);
    chunk.origin = Some(Id::new(PEER, 1));
    apply_structs(&doc, vec![embed, format, chunk], None);
    let delta = text.to_delta();
    assert!(
        delta.len() == 2 && delta[0].insert == Out::Any(Value::Null),
        "{delta:?}"
    );
    assert!(
        delta[1].insert == Out::Any(sv("hi")) && delta[1].attributes.is_some(),
        "{delta:?}"
    );
    assert_eq!(text.to_string(), "hi");
}

#[test]
fn content_string_splice_replaces_a_split_surrogate_pair() {
    let mut left = Content::String(s("a😀b"));
    let right = left.splice(2).unwrap();
    let (Content::String(left), Content::String(right)) = (left, right) else {
        panic!("strings")
    };
    assert_eq!(left, Str(vec![u16::from(b'a'), 0xfffd]));
    assert_eq!(right, Str(vec![0xfffd, u16::from(b'b')]));
}

#[test]
fn equal_attrs_compares_flat_and_strict_equals_by_identity() {
    let a = Arc::new(vobj(vec![("href", sv("x")), ("rel", sv("y"))]));
    let b = Arc::new(vobj(vec![("rel", sv("y")), ("href", sv("x"))]));
    assert!(
        equal_attrs(&a, &b) && !strict_equals(&a, &b) && strict_equals(&a, &a),
        "objects"
    );
    let nan = Arc::new(num(blok_jsjson::nan()));
    assert!(!strict_equals(&nan, &nan), "numbers");
    assert!(
        strict_equals(&Arc::new(num(0.0)), &Arc::new(num(-0.0))),
        "numbers"
    );
    let items = Arc::new(Value::Array(vec![num(1.0)]));
    let other = Arc::new(Value::Array(vec![num(1.0)]));
    assert!(
        strict_equals(&items, &items)
            && !strict_equals(&items, &other)
            && equal_attrs(&items, &other),
        "arrays"
    );
    let nested = |_: ()| Arc::new(vobj(vec![("a", vobj(Vec::new()))]));
    assert!(
        !equal_attrs(&nested(()), &nested(())),
        "a nested object only equals itself"
    );
}

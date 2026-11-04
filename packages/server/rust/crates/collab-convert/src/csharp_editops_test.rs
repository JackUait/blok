use blok_jsjson::{Kind, Node, Str};

use crate::editops::{EditOp, JSON_MAX_DEPTH, MapPatch, canonical_body, member, parse_edit_ops};
use crate::error::Error;

// C# CollabEditOpsTests: the POST /sync/{doc}/edit request schema, and the
// NUL screen every string passes before the doc is touched.

fn parse(body: &str) -> Vec<EditOp> {
    parse_edit_ops(body.as_bytes()).unwrap_or_else(|err| panic!("{body}: {err}"))
}

fn refused(body: &str) -> String {
    match parse_edit_ops(body.as_bytes()) {
        Err(Error::Edit(err)) => err.message,
        other => panic!("{body}: {other:?}"),
    }
}

fn text_at(node: &Node, path: &[&str]) -> String {
    let mut at = node;
    for key in path {
        at = member(at, key)
            .unwrap_or_else(|err| panic!("{err}"))
            .unwrap_or_else(|| panic!("no {key}"));
    }
    at.text().unwrap_or_else(|err| panic!("{err}")).to_string()
}

fn s(text: &str) -> Str {
    Str::from(text)
}

#[test]
fn parses_the_three_ops_in_request_order() {
    let ops = parse(
        r#"{ "ops": [
          { "op": "insert", "id": "b1",
            "block": { "type": "paragraph", "data": { "text": "hi" } },
            "after": "b0", "parent": "p1" },
          { "op": "update", "id": "b2", "data": { "text": "bye" } },
          { "op": "remove", "id": "b3" }
        ] }"#,
    );
    let EditOp::Insert {
        id,
        block,
        after,
        parent,
    } = &ops[0]
    else {
        panic!("{:?}", ops[0])
    };
    assert_eq!(id, &s("b1"));
    assert_eq!(text_at(block, &["type"]), "paragraph");
    assert_eq!(after, &Some(s("b0")));
    assert_eq!(parent, &Some(s("p1")));
    let EditOp::Update { id, data } = &ops[1] else {
        panic!("{:?}", ops[1])
    };
    assert_eq!(id, &s("b2"));
    assert_eq!(text_at(data, &["text"]), "bye");
    assert_eq!(ops[2], EditOp::Remove { id: s("b3") });
}

// Absent and explicit null mean the same: first child of the root.
#[test]
fn an_insert_without_after_or_parent_places_first_under_the_root() {
    for op in [
        r#"{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {} } }"#,
        r#"{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {} },
            "after": null, "parent": null }"#,
    ] {
        match &parse(&format!(r#"{{ "ops": [{op}] }}"#))[0] {
            EditOp::Insert {
                after: None,
                parent: None,
                ..
            } => {}
            other => panic!("{other:?}"),
        }
    }
}

#[test]
fn keeps_the_optional_block_members_the_converter_writes() {
    let ops = parse(
        r#"{ "ops": [{ "op": "insert", "id": "b1", "block": {
          "id": "b1", "type": "paragraph", "data": { "text": "hi" },
          "tunes": { "align": "left" },
          "lastEditedAt": 17, "lastEditedBy": "u1" } }] }"#,
    );
    let EditOp::Insert { block, .. } = &ops[0] else {
        panic!("{:?}", ops[0])
    };
    assert_eq!(text_at(block, &["tunes", "align"]), "left");
    let at = member(block, "lastEditedAt")
        .unwrap_or_else(|err| panic!("{err}"))
        .unwrap_or_else(|| panic!("no lastEditedAt"));
    assert_eq!((at.kind, at.raw()), (Kind::Number, &b"17"[..]));
    assert_eq!(text_at(block, &["lastEditedBy"]), "u1");
}

#[test]
fn rejects_an_envelope_that_is_not_a_non_empty_ops_array() {
    for (body, mentions) in [
        ("not json at all", "not valid JSON"),
        ("", "not valid JSON"),
        (
            r#"{ "ops": [{ "op": "remove", "id": "a", "id": "b" }] }"#,
            "not valid JSON",
        ),
        ("[]", "ops"),
        ("null", "ops"),
        (r#"{ "ops": {} }"#, "ops"),
        (r#"{ "ops": [] }"#, "ops"),
    ] {
        let message = refused(body);
        assert!(message.contains(mentions), "{body}: {message}");
    }
}

#[test]
fn rejects_a_schema_violation_naming_the_failing_op() {
    for op in [
        r#"{ "op": "move", "id": "b1" }"#,
        r#"{ "op": 7, "id": "b1" }"#,
        r#"{ "id": "b1" }"#,
        r#"["remove", "b1"]"#,
        "null",
        r#"{ "op": "remove" }"#,
        r#"{ "op": "remove", "id": "" }"#,
        r#"{ "op": "remove", "id": 7 }"#,
        r#"{ "op": "remove", "id": "b1", "data": {} }"#,
        r#"{ "op": "insert", "id": "b1" }"#,
        r#"{ "op": "insert", "id": "b1", "block": [] }"#,
        r#"{ "op": "insert", "id": "b1", "block": { "data": {} } }"#,
        r#"{ "op": "insert", "id": "b1", "block": { "type": "", "data": {} } }"#,
        r#"{ "op": "insert", "id": "b1", "block": { "type": "p" } }"#,
        r#"{ "op": "insert", "id": "b1", "block": { "type": "p", "data": [] } }"#,
        r#"{ "op": "insert", "id": "b1", "block": { "id": "x", "type": "p", "data": {} } }"#,
        r#"{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {}, "parent": "p" } }"#,
        r#"{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {}, "content": [] } }"#,
        r#"{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {}, "extra": 1 } }"#,
        r#"{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {} }, "after": 7 }"#,
        r#"{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {} }, "parent": "" }"#,
        r#"{ "op": "update", "id": "b1" }"#,
        r#"{ "op": "update", "id": "b1", "data": "text" }"#,
        r#"{ "op": "update", "id": "b1", "data": null }"#,
    ] {
        // Index 1: the message must name the op that failed, not the request.
        let message = refused(&format!(
            r#"{{ "ops": [{{ "op": "remove", "id": "ok" }}, {op}] }}"#
        ));
        assert!(message.starts_with("collab: op 1:"), "{op}: {message}");
    }
}

// A restore's page/values patch is internal: no wire spelling reaches it.
#[test]
fn refuses_a_map_patch_from_the_wire() {
    for op in [
        r#"{ "op": "patchMaps", "patches": [{ "map": "page", "key": "title", "value": "x" }] }"#,
        r#"{ "op": "PatchMaps", "patches": [{ "map": "page", "key": "title", "value": "x" }] }"#,
        r#"{ "op": "patch", "map": "page", "key": "title", "value": "x" }"#,
    ] {
        let message = refused(&format!(r#"{{ "ops": [{op}] }}"#));
        assert!(message.starts_with("collab: op 0:"), "{op}: {message}");
    }
}

#[test]
fn rejects_a_nul_in_every_string_position() {
    for op in [
        r#"{ "op": "remove", "id": "b\u00001" }"#,
        r#"{ "op": "insert", "id": "b\u00001", "block": { "type": "p", "data": {} } }"#,
        r#"{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {} },
            "after": "a\u00000" }"#,
        r#"{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {} },
            "parent": "p\u00000" }"#,
        r#"{ "op": "insert", "id": "b1", "block": { "type": "p\u0000p", "data": {} } }"#,
        r#"{ "op": "insert", "id": "b1", "block": { "type": "p", "data": { "te\u0000xt": "hi" } } }"#,
        r#"{ "op": "insert", "id": "b1", "block": { "type": "p",
            "data": { "rows": [{ "cell": "a\u0000b" }] } } }"#,
        r#"{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {},
            "tunes": { "align": "le\u0000ft" } } }"#,
        r#"{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {},
            "lastEditedBy": "u\u00001" } }"#,
        r#"{ "op": "update", "id": "b1", "data": { "text": "hi\u0000" } }"#,
        r#"{ "op": "update", "id": "b1", "data": { "k\u0000": 1 } }"#,
    ] {
        let message = refused(&format!(r#"{{ "ops": [{op}] }}"#));
        assert!(message.starts_with("collab: op 0:"), "{op}: {message}");
        assert!(message.contains("NUL"), "{op}: {message}");
    }
}

// Restore digests its request line, never its plan, so a map patch has no
// canonical body.
#[test]
fn says_a_map_patch_has_no_canonical_body() {
    let err = canonical_body(&[EditOp::PatchMaps {
        patches: vec![MapPatch {
            map: s("page"),
            key: s("title"),
            value: blok_yjs::Out::Any(blok_jsjson::Value::String(s("x"))),
            remove: false,
        }],
    }])
    .err()
    .unwrap_or_else(|| panic!("a map patch digested"));
    assert!(err.to_string().contains("restore"), "{err}");
}

#[test]
fn rejects_a_body_nested_deeper_than_the_json_reader_allows() {
    let deep = "[".repeat(JSON_MAX_DEPTH + 2) + &"]".repeat(JSON_MAX_DEPTH + 2);
    let message = refused(&format!(
        r#"{{ "ops": [{{ "op": "update", "id": "b1", "data": {deep} }}] }}"#
    ));
    assert!(message.contains("not valid JSON"), "{message}");
}

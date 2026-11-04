use blok_collab_collabtest::{read, read_bytes};
use blok_jsjson::{Kind, Node, Object, Options as JsonOptions, Str, Value, parse_node};
use blok_yjs::{Doc, Options};

use crate::apply::apply_ops;
use crate::csharp_yrs_compat_test::block_on;
use crate::docconverter::DocConverter;
use crate::docconverter_test::FailingReader;
use crate::editops::{EditOp, member};
use crate::error::Error;
use crate::export::{export, export_page};
use crate::export_test::canonical;
use crate::fields::RichTextFields;
use crate::richtext_test::{field, items, text};
use crate::richtextinput::RichTextInput;
use crate::seed::seed;

// The reader of agent-moves.json (from document-store moves) and
// agent-page-fields.json (from page-fields.ts), and twins of the inline
// cases in C# AgentRoomOpsTests.

fn node(json: &str) -> Node {
    parse_node(json.as_bytes(), JsonOptions::default()).unwrap_or_else(|err| panic!("{err}"))
}

fn s(text: &str) -> Str {
    Str::from(text)
}

fn seeded_nodes(blocks: &Node) -> Doc {
    let doc = Doc::new(Options::default());
    let items: &[Node] = if blocks.kind == Kind::Array {
        &blocks.items
    } else {
        &[]
    };
    let fields = RichTextFields::built_in();
    seed(&doc, items, &mut RichTextInput::refusing(&fields), None)
        .unwrap_or_else(|err| panic!("{err}"));
    doc
}

pub(crate) fn ag_seeded(blocks: &str) -> Doc {
    seeded_nodes(&node(blocks))
}

pub(crate) fn ag_apply(doc: &Doc, ops: &[EditOp]) -> Result<(), Error> {
    let fields = RichTextFields::built_in();
    apply_ops(doc, ops, &mut RichTextInput::refusing(&fields))
}

pub(crate) fn ag_exported(doc: &Doc) -> Vec<Value> {
    let fields = RichTextFields::built_in();
    export(doc, &fields, None)
        .unwrap_or_else(|err| panic!("{err}"))
        .0
}

/// The value under key, or null (Go nil) when absent.
pub(crate) fn ag_field(value: &Value, key: &str) -> Value {
    match value {
        Value::Object(object) => object.get(&s(key)).cloned().unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

pub(crate) fn ag_block(blocks: &[Value], id: &str) -> Value {
    blocks
        .iter()
        .find(|block| ag_field(block, "id") == Value::String(s(id)))
        .cloned()
        .unwrap_or(Value::Null)
}

fn ag_ids(blocks: &[Value]) -> String {
    blocks
        .iter()
        .map(|block| match ag_field(block, "id") {
            Value::String(id) => id.to_string(),
            _ => String::new(),
        })
        .collect::<Vec<_>>()
        .join(",")
}

/// Ids, parents and children in order; the data spelling differs between
/// the two exports.
fn ag_structure(blocks: &[Value]) -> String {
    let out = blocks
        .iter()
        .map(|block| {
            let mut entry = Object::new();
            for key in ["id", "type", "parent"] {
                entry.set(s(key), ag_field(block, key));
            }
            let content = match ag_field(block, "content") {
                Value::Null => Value::Array(Vec::new()),
                content => content,
            };
            entry.set(s("content"), content);
            Value::Object(entry)
        })
        .collect();
    canonical(&Value::Array(out))
}

fn moves_seed() -> Node {
    let raw = parse_node(&read_bytes("agent-moves.json"), JsonOptions::default())
        .unwrap_or_else(|err| panic!("{err}"));
    member(&raw, "seed")
        .unwrap_or_else(|err| panic!("{err}"))
        .cloned()
        .unwrap_or_else(|| panic!("no seed"))
}

fn ag_refused(result: Result<(), Error>) {
    assert!(
        matches!(result, Err(Error::Edit(_))),
        "{result:?}, want an edit refusal"
    );
}

fn optional_str(value: &Value) -> Option<Str> {
    match value {
        Value::String(text) => Some(text.clone()),
        _ => None,
    }
}

#[test]
fn move_matches_document_store() {
    let fixture = read("agent-moves.json");
    let cases = items(field(&fixture, "cases"));
    assert_eq!(cases.len(), 4, "move cases");
    let seed = moves_seed();
    for c in cases {
        let name = text(field(c, "name"));
        let doc = seeded_nodes(&seed);
        ag_apply(
            &doc,
            &[EditOp::Move {
                id: s(&text(field(c, "id"))),
                after: optional_str(field(c, "after")),
                parent: optional_str(field(c, "parent")),
            }],
        )
        .unwrap_or_else(|err| panic!("{name}: {err}"));
        assert_eq!(
            ag_structure(&ag_exported(&doc)),
            ag_structure(items(field(c, "expected"))),
            "{name}"
        );
    }
}

#[test]
fn set_page_field_matches_page_fields_ts() {
    let fixture = read("agent-page-fields.json");
    let raw = parse_node(
        &read_bytes("agent-page-fields.json"),
        JsonOptions::default(),
    )
    .unwrap_or_else(|err| panic!("{err}"));
    let steps = &member(&raw, "steps")
        .unwrap_or_else(|err| panic!("{err}"))
        .unwrap_or_else(|| panic!("no steps"))
        .items;
    assert_eq!(steps.len(), 4, "steps");
    let after = items(field(&fixture, "after"));
    let doc = ag_seeded("[]");
    for (i, step) in steps.iter().enumerate() {
        let key = member(step, "key")
            .unwrap_or_else(|err| panic!("{err}"))
            .unwrap_or_else(|| panic!("no key"))
            .text()
            .unwrap_or_else(|err| panic!("{err}"));
        let value = member(step, "value")
            .unwrap_or_else(|err| panic!("{err}"))
            .filter(|v| v.kind != Kind::Null)
            .cloned();
        ag_apply(&doc, &[EditOp::SetPageField { key, value }])
            .unwrap_or_else(|err| panic!("step {i}: {err}"));
        let page = export_page(&doc).unwrap_or_else(|err| panic!("{err}"));
        assert_eq!(
            canonical(&Value::Object(page)),
            canonical(&after[i]),
            "step {i}"
        );
    }
}

#[test]
fn set_page_field_refuses_a_bad_icon_and_an_unknown_key() {
    let doc = Doc::new(Options::default());
    ag_refused(ag_apply(
        &doc,
        &[EditOp::SetPageField {
            key: s("icon"),
            value: Some(node(r#"{"type":"emoji"}"#)),
        }],
    ));
    ag_refused(ag_apply(
        &doc,
        &[EditOp::SetPageField {
            key: s("cover"),
            value: Some(node(r#""x""#)),
        }],
    ));
    let page = export_page(&doc).unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(canonical(&Value::Object(page)), "{}");
}

fn move_op(id: &str, after: Option<&str>, parent: Option<&str>) -> EditOp {
    EditOp::Move {
        id: s(id),
        after: after.map(s),
        parent: parent.map(s),
    }
}

#[test]
fn move_refuses_its_own_subtree() {
    let seed = moves_seed();
    ag_refused(ag_apply(
        &seeded_nodes(&seed),
        &[move_op("a", None, Some("a1"))],
    ));
    ag_refused(ag_apply(
        &seeded_nodes(&seed),
        &[move_op("a", None, Some("a"))],
    ));
}

#[test]
fn a_moved_child_survives_its_old_parents_removal_in_the_same_request() {
    let doc = seeded_nodes(&moves_seed());
    ag_apply(
        &doc,
        &[
            move_op("a1", Some("b"), None),
            EditOp::Remove { id: s("a") },
        ],
    )
    .unwrap_or_else(|err| panic!("{err}"));
    let blocks = ag_exported(&doc);
    assert!(
        ag_ids(&blocks) == "b,a1" && ag_field(&blocks[1], "parent") == Value::Null,
        "blocks {}",
        canonical(&Value::Array(blocks.clone()))
    );
}

#[test]
fn a_moved_block_can_be_an_anchor_later_in_the_same_request() {
    let doc = seeded_nodes(&moves_seed());
    ag_apply(
        &doc,
        &[
            move_op("b", None, Some("a")),
            EditOp::Insert {
                id: s("n"),
                block: node(r#"{"type":"paragraph","data":{}}"#),
                after: Some(s("b")),
                parent: Some(s("a")),
            },
            move_op("a2", Some("n"), Some("a")),
        ],
    )
    .unwrap_or_else(|err| panic!("{err}"));
    let content = ag_field(&ag_block(&ag_exported(&doc), "a"), "content");
    assert_eq!(canonical(&content), r#"["b","n","a2","a1"]"#);
}

#[test]
fn retype_keeps_the_block_and_its_children() {
    let doc = ag_seeded(
        r#"[{"id":"t","type":"toggle","data":{"text":[{"text":"T"}]},"content":["k"],"tunes":{"align":{"value":"left"}}},{"id":"k","type":"paragraph","data":{},"parent":"t"}]"#,
    );
    ag_apply(
        &doc,
        &[EditOp::Retype {
            id: s("t"),
            kind: s("header"),
            data: node(r#"{"text":[{"text":"T"}],"level":2}"#),
        }],
    )
    .unwrap_or_else(|err| panic!("{err}"));
    let block = ag_block(&ag_exported(&doc), "t");
    let got = canonical(&block);
    let data = ag_field(&block, "data");
    assert!(got.contains(r#""type":"header""#), "block {got}");
    assert_eq!(canonical(&ag_field(&data, "level")), "2", "block {got}");
    assert_eq!(
        canonical(&ag_field(&data, "text")),
        r#"[{"text":"T"}]"#,
        "block {got}"
    );
    assert_eq!(
        canonical(&ag_field(&block, "content")),
        r#"["k"]"#,
        "block {got}"
    );
    assert_eq!(
        canonical(&ag_field(
            &ag_field(&ag_field(&block, "tunes"), "align"),
            "value"
        )),
        r#""left""#,
        "block {got}"
    );
}

#[test]
fn set_tunes_and_metadata_land_on_the_block() {
    let doc = ag_seeded(r#"[{"id":"p","type":"paragraph","data":{},"tunes":{"gone":{"x":1}}}]"#);
    ag_apply(
        &doc,
        &[
            EditOp::SetTunes {
                id: s("p"),
                tunes: node(r#"{"align":{"value":"center"},"gone":null}"#),
            },
            EditOp::SetMetadata {
                id: s("p"),
                last_edited_at: 42.0,
                last_edited_by: s("agent-cs"),
                last_edited_with: None,
            },
        ],
    )
    .unwrap_or_else(|err| panic!("{err}"));
    let p = &ag_exported(&doc)[0];
    assert_eq!(
        canonical(&ag_field(p, "tunes")),
        r#"{"align":{"value":"center"}}"#
    );
    assert_eq!(canonical(&ag_field(p, "lastEditedBy")), r#""agent-cs""#);
    assert_eq!(canonical(&ag_field(p, "lastEditedAt")), "42");
}

#[test]
fn metadata_sets_the_co_editor_and_an_edit_without_one_removes_it() {
    let doc = ag_seeded(r#"[{"id":"p","type":"paragraph","data":{}}]"#);
    let stamp = |at: f64, by: &str, with: Option<&str>| EditOp::SetMetadata {
        id: s("p"),
        last_edited_at: at,
        last_edited_by: s(by),
        last_edited_with: with.map(s),
    };
    ag_apply(&doc, &[stamp(42.0, "human-1", Some("agent-cs"))])
        .unwrap_or_else(|err| panic!("{err}"));
    let p = &ag_exported(&doc)[0];
    assert_eq!(canonical(&ag_field(p, "lastEditedBy")), r#""human-1""#);
    assert_eq!(canonical(&ag_field(p, "lastEditedWith")), r#""agent-cs""#);
    ag_apply(&doc, &[stamp(43.0, "agent-cs", None)]).unwrap_or_else(|err| panic!("{err}"));
    let p = &ag_exported(&doc)[0];
    let Value::Object(object) = p else {
        panic!("{p:?}")
    };
    assert!(
        object.get(&s("lastEditedWith")).is_none(),
        "block {}",
        canonical(p)
    );
    assert_eq!(canonical(&ag_field(p, "lastEditedBy")), r#""agent-cs""#);
}

#[test]
fn an_insert_carries_the_co_author_ids() {
    let doc = ag_seeded("[]");
    ag_apply(
        &doc,
        &[EditOp::Insert {
            id: s("n"),
            block: node(
                r#"{"type":"paragraph","data":{},"createdBy":"human-1","createdWith":"agent-cs"}"#,
            ),
            after: None,
            parent: None,
        }],
    )
    .unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(
        canonical(&ag_field(&ag_exported(&doc)[0], "createdWith")),
        r#""agent-cs""#
    );
}

#[test]
fn lift_then_remove_keeps_the_children_in_the_slot() {
    let doc = seeded_nodes(&moves_seed());
    ag_apply(
        &doc,
        &[EditOp::Lift { id: s("a") }, EditOp::Remove { id: s("a") }],
    )
    .unwrap_or_else(|err| panic!("{err}"));
    let blocks = ag_exported(&doc);
    let shown = canonical(&Value::Array(blocks.clone()));
    assert_eq!(ag_ids(&blocks), "a1,a2,b", "blocks {shown}");
    for block in &blocks {
        assert_eq!(ag_field(block, "parent"), Value::Null, "blocks {shown}");
    }
}

#[test]
fn the_new_ops_refuse_an_unknown_block() {
    for op in [
        EditOp::Retype {
            id: s("x"),
            kind: s("header"),
            data: node("{}"),
        },
        EditOp::SetTunes {
            id: s("x"),
            tunes: node("{}"),
        },
        EditOp::SetMetadata {
            id: s("x"),
            last_edited_at: 1.0,
            last_edited_by: s("a"),
            last_edited_with: None,
        },
        EditOp::Lift { id: s("x") },
    ] {
        ag_refused(ag_apply(&ag_seeded("[]"), &[op]));
    }
}

fn sync(to: &Doc, from: &Doc) {
    let update = from
        .encode_state_as_update(&[])
        .unwrap_or_else(|err| panic!("{err}"));
    to.apply_update(&update)
        .unwrap_or_else(|err| panic!("{err}"));
}

// Twins of C# AgentRoomMoveTests: a peer types in a block while the server
// moves or retypes it, then they sync both ways; the typing survives.
#[test]
fn a_move_or_retype_keeps_a_peers_concurrent_typing() {
    type Check = fn(&[Value]);
    let rows: [(&str, &str, EditOp, Check); 2] = [
        (
            "move",
            r#"[{"id":"t","type":"toggle","data":{"text":[]}},{"id":"p","type":"paragraph","data":{"text":[{"text":"ab"}]}}]"#,
            move_op("p", None, Some("t")),
            |blocks| {
                let p = ag_block(blocks, "p");
                let shown = canonical(&Value::Array(blocks.to_vec()));
                assert_eq!(canonical(&ag_field(&p, "parent")), r#""t""#, "{shown}");
                assert_eq!(
                    canonical(&ag_field(&ag_field(&p, "data"), "text")),
                    r#"[{"text":"aXb"}]"#,
                    "{shown}"
                );
                assert_eq!(
                    canonical(&ag_field(&ag_block(blocks, "t"), "content")),
                    r#"["p"]"#,
                    "{shown}"
                );
            },
        ),
        (
            "retype",
            r#"[{"id":"p","type":"paragraph","data":{"text":[{"text":"ab"}]}}]"#,
            EditOp::Retype {
                id: s("p"),
                kind: s("header"),
                data: node(r#"{"text":[{"text":"ab"}],"level":2}"#),
            },
            |blocks| {
                let p = &blocks[0];
                let shown = canonical(&Value::Array(blocks.to_vec()));
                assert_eq!(canonical(&ag_field(p, "type")), r#""header""#, "{shown}");
                assert_eq!(
                    canonical(&ag_field(&ag_field(p, "data"), "text")),
                    r#"[{"text":"aXb"}]"#,
                    "{shown}"
                );
            },
        ),
    ];
    for (name, seed, op, check) in rows {
        let server = ag_seeded(seed);
        let peer = Doc::new(Options::default());
        sync(&peer, &server);
        ag_apply(
            &peer,
            &[EditOp::Update {
                id: s("p"),
                data: node(r#"{"text":[{"text":"aXb"}]}"#),
            }],
        )
        .unwrap_or_else(|err| panic!("{name}: {err}"));
        ag_apply(&server, &[op]).unwrap_or_else(|err| panic!("{name}: {err}"));
        sync(&server, &peer);
        sync(&peer, &server);
        for doc in [&server, &peer] {
            check(&ag_exported(doc));
        }
    }
}

// C# AgentRoomOpsTests.SeedCarriesTitleAndIconIntoThePageRoot.
#[test]
fn seed_carries_title_and_icon_into_the_page_root() {
    // Go's converter has no reader: nothing here is HTML.
    let converter = DocConverter {
        now: Box::new(std::time::SystemTime::now),
        html: FailingReader(|| Error::Message("no reader".to_owned())),
        fields: None,
        log: None,
    };
    let doc = Doc::new(Options::default());
    block_on(converter.seed(
        &doc,
        &node(r#"{"title":"T","icon":{"type":"emoji","value":"x"},"blocks":[]}"#),
    ))
    .unwrap_or_else(|err| panic!("{err}"));
    let exported =
        Value::Object(block_on(converter.export(&doc)).unwrap_or_else(|err| panic!("{err}")));
    assert!(
        canonical(&ag_field(&exported, "title")) == r#""T""#
            && canonical(&ag_field(&ag_field(&exported, "icon"), "value")) == r#""x""#,
        "export {}",
        canonical(&exported)
    );
}

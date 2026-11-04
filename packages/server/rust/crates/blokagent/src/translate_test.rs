use blok_collab_convert::EditOp;
use blok_jsjson::{Node, Str};

use crate::Error;
use crate::test_support::must_parse;
use crate::translate::translate;
use crate::wire::write;

// Twins of C# RoomEditTranslatorTests: the translator has no runtime and no
// room, so a fixture adds nothing over the same three inputs.

fn op_string(op: &EditOp) -> String {
    let optional = |s: &Option<Str>| s.as_ref().map_or("<nil>".to_owned(), Str::to_string);
    let node = |n: &Node| write(n).expect("write");
    match op {
        EditOp::Insert {
            id,
            block,
            after,
            parent,
        } => format!(
            "Insert({id} after {} under {} {})",
            optional(after),
            optional(parent),
            node(block)
        ),
        EditOp::Update { id, data } => format!("Update({id} {})", node(data)),
        EditOp::Remove { id } => format!("Remove({id})"),
        EditOp::Lift { id } => format!("Lift({id})"),
        EditOp::Move { id, after, parent } => format!(
            "Move({id} after {} under {})",
            optional(after),
            optional(parent)
        ),
        EditOp::SetPageField { key, value } => format!(
            "SetPageField({key} {})",
            value.as_ref().map_or("<nil>".to_owned(), node)
        ),
        EditOp::SetTunes { id, tunes } => format!("SetTunes({id} {})", node(tunes)),
        EditOp::Retype { id, kind, data } => format!("Retype({id} {kind} {})", node(data)),
        EditOp::SetMetadata {
            id,
            last_edited_at,
            last_edited_by,
            last_edited_with,
        } => format!(
            "SetMetadata({id} {last_edited_at} {last_edited_by} {})",
            optional(last_edited_with)
        ),
        EditOp::PatchMaps { .. } => panic!("unknown op {op:?}"),
    }
}

fn translate_text(edits: &str, after: &str, result: &str) -> Result<Vec<String>, Error> {
    let ops = translate(&must_parse(edits), &must_parse(after), &must_parse(result))?;
    Ok(ops.iter().map(op_string).collect())
}

fn check_ops(got: Vec<String>, want: &[&str]) {
    assert_eq!(
        got,
        want,
        "ops\n got {}\nwant {}",
        got.join("\n     "),
        want.join("\n     ")
    );
}

#[test]
fn translates_each_edit_kind() {
    let got = translate_text(
        r#"[
		{"op":"insert","parentId":null,"afterId":"p","block":{"id":"n","type":"toggle","data":{"text":[]},"children":[{"id":"n1","type":"paragraph","data":{},"children":[]}]}},
		{"op":"setRichText","id":"p","field":"text","value":[{"text":"x"}]},
		{"op":"setData","id":"p","patch":{"keep":null}},
		{"op":"move","id":"q","parentId":"n","afterId":"n1"},
		{"op":"setPageField","key":"title","value":"T"}
	]"#,
        r#"{"title":"T","blocks":[
		{"id":"p","type":"paragraph","data":{"text":[{"text":"x"}]},"lastEditedAt":7,"lastEditedBy":"agent"},
		{"id":"n","type":"toggle","data":{"text":[]},"content":["n1","q"],"lastEditedAt":7,"lastEditedBy":"agent"},
		{"id":"n1","type":"paragraph","data":{},"parent":"n","lastEditedAt":7,"lastEditedBy":"agent"},
		{"id":"q","type":"paragraph","data":{},"parent":"n"}
	]}"#,
        r#"{"ok":true,"changed":{"created":["n","n1"],"updated":["p"],"moved":["q"],"removed":[]}}"#,
    )
    .expect("translate");
    check_ops(
        got,
        &[
            r#"Insert(n after p under <nil> {"type":"toggle","data":{"text":[]}})"#,
            r#"Insert(n1 after <nil> under n {"type":"paragraph","data":{}})"#,
            r#"Update(p {"text":[{"text":"x"}]})"#,
            "Move(q after n1 under n)",
            r#"SetPageField(title "T")"#,
            "SetMetadata(n 7 agent <nil>)",
            "SetMetadata(n1 7 agent <nil>)",
            "SetMetadata(p 7 agent <nil>)",
        ],
    );
}

#[test]
fn carries_the_co_author_ids_the_json_applier_wrote() {
    let got = translate_text(
        r#"[
		{"op":"insert","parentId":null,"afterId":null,"block":{"id":"n","type":"paragraph","data":{},"children":[]}},
		{"op":"setData","id":"p","patch":{"keep":1}}
	]"#,
        r#"{"blocks":[
		{"id":"n","type":"paragraph","data":{},"createdAt":7,"createdBy":"human-1","createdWith":"agent","lastEditedAt":7,"lastEditedBy":"human-1","lastEditedWith":"agent"},
		{"id":"p","type":"paragraph","data":{"keep":1},"lastEditedAt":7,"lastEditedBy":"human-1","lastEditedWith":"agent"}
	]}"#,
        r#"{"ok":true,"changed":{"created":["n"],"updated":["p"],"moved":[],"removed":[]}}"#,
    )
    .expect("translate");
    check_ops(
        got,
        &[
            r#"Insert(n after <nil> under <nil> {"type":"paragraph","data":{},"createdAt":7,"createdBy":"human-1","createdWith":"agent"})"#,
            r#"Update(p {"keep":1})"#,
            "SetMetadata(n 7 human-1 agent)",
            "SetMetadata(p 7 human-1 agent)",
        ],
    );
}

#[test]
fn a_remove_that_keeps_children_lifts_them_and_stamps_them() {
    let got = translate_text(
        r#"[
		{"op":"remove","id":"a","withChildren":false},
		{"op":"remove","id":"b","withChildren":true},
		{"op":"setTunes","id":"a1","tunes":{"align":{"value":"center"},"gone":null}},
		{"op":"replaceType","id":"a2","type":"header","data":{"text":[],"level":2}}
	]"#,
        r#"{"blocks":[
		{"id":"a1","type":"paragraph","data":{},"tunes":{"align":{"value":"center"}},"lastEditedAt":9,"lastEditedBy":"agent"},
		{"id":"a2","type":"header","data":{"text":[{"text":"H"}],"level":2},"lastEditedAt":9,"lastEditedBy":"agent"}
	]}"#,
        r#"{"ok":true,"changed":{"created":[],"updated":["a1","a2"],"moved":["a1","a2"],"removed":["a","b","b1"]}}"#,
    )
    .expect("translate");
    check_ops(
        got,
        &[
            "Lift(a)",
            "Remove(a)",
            "Remove(b)",
            r#"SetTunes(a1 {"align":{"value":"center"},"gone":null})"#,
            r#"Retype(a2 header {"text":[{"text":"H"}],"level":2})"#,
            "SetMetadata(a1 9 agent <nil>)",
            "SetMetadata(a2 9 agent <nil>)",
        ],
    );
}

// What the translator cannot read is an InvalidDataException in C#
// (RoomEditTranslator.cs:43,121,165); an op it does not know is skipped.
#[test]
fn refuses_an_edit_it_cannot_read_and_skips_an_unknown_op() {
    let ok = r#"{"ok":true,"changed":{"created":[],"updated":[],"moved":[],"removed":[]}}"#;
    for (name, edits, message) in [
        ("a null edit", "[null]", "An agent edit is not an object."),
        (
            "an insert without a block",
            r#"[{"op":"insert"}]"#,
            "An agent edit field is not an object.",
        ),
        (
            "a block without an id",
            r#"[{"op":"insert","block":{"type":"paragraph","data":{}}}]"#,
            "A planned block has no id.",
        ),
        (
            "a block whose data is not an object",
            r#"[{"op":"insert","block":{"id":"n","type":"paragraph","data":[]}}]"#,
            "An agent edit field is not an object.",
        ),
        (
            "a page field without a key",
            r#"[{"op":"setPageField","value":"T"}]"#,
            "A page field edit has no key.",
        ),
    ] {
        match translate_text(edits, r#"{"blocks":[]}"#, ok) {
            Err(Error::InvalidData(got)) if got == message => {}
            other => panic!("{name}: {other:?}, want InvalidData {message:?}"),
        }
    }
    let got = translate_text(
        r#"[{"op":"later"},{"op":"remove"}]"#,
        r#"{"blocks":[]}"#,
        ok,
    )
    .expect("translate");
    assert!(got.is_empty(), "ops {got:?}");
    match translate_text(
        r#"[{"op":"replaceType","id":"a"}]"#,
        r#"{"blocks":[{"id":"a","data":{}}]}"#,
        ok,
    ) {
        Err(Error::InvalidData(got)) if got == r#"Block "a" has no type."# => {}
        other => panic!("{other:?}"),
    }
}

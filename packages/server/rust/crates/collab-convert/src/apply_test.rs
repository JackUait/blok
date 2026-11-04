use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use blok_collab_collabtest::{read, read_bytes};
use blok_jsjson::{Kind, Node, Options as JsonOptions, Str, Value, parse, parse_node};
use blok_yjs::{Doc, EngineError, Options, Out, Outcome};

use crate::apply::{Step, apply_ops, apply_ops_counted, collect_ops_html, put_block, run_steps};
use crate::editops::{EditOp, MapPatch, member, parse_edit_ops};
use crate::error::Error;
use crate::export::{export, export_page};
use crate::export_test::canonical;
use crate::fields::RichTextFields;
use crate::richtext_test::{field, items, text};
use crate::richtextinput::RichTextInput;
use crate::seed::{
    SourceValue, collect_seed_html, replace_row_keys, seed, source_object, strict_value,
};
use crate::seed_test::row_key_counter;

fn sub<'a>(op: &'a Node, key: &str) -> Option<&'a Node> {
    member(op, key).unwrap_or_else(|err| panic!("{err}"))
}

fn optional(op: &Node, key: &str) -> Option<Str> {
    match sub(op, key) {
        None => None,
        Some(v) if v.kind == Kind::Null => None,
        Some(v) => Some(v.text().unwrap_or_else(|err| panic!("{err}"))),
    }
}

fn required(op: &Node, key: &str) -> Str {
    optional(op, key).unwrap_or_else(|| panic!("agent op lacks {key:?}"))
}

fn present(op: &Node, key: &str) -> Node {
    sub(op, key)
        .cloned()
        .unwrap_or_else(|| panic!("agent op lacks {key:?}"))
}

/// strictValue's JS values, as the patch's Any value.
pub(crate) fn plain(v: &SourceValue) -> Value {
    match v {
        SourceValue::Null => Value::Null,
        SourceValue::Bool(flag) => Value::Bool(*flag),
        SourceValue::Number(number) => Value::Number(*number),
        SourceValue::Source(number) => Value::Number(number.value),
        SourceValue::String(text) => Value::String(text.clone()),
        SourceValue::Array(items) => Value::Array(items.iter().map(plain).collect()),
        SourceValue::Object(object) => Value::Object(
            object
                .members()
                .iter()
                .map(|m| (m.key.clone(), plain(&m.value)))
                .collect(),
        ),
        SourceValue::Unsupported => Value::Undefined,
    }
}

/// The capture's AgentOp: the agent-only ops from a small JSON shape,
/// insert, update and remove through the /edit parser.
pub(crate) fn agent_op(op: &Node) -> EditOp {
    let kind = required(op, "op").to_string();
    match kind.as_str() {
        "move" => EditOp::Move {
            id: required(op, "id"),
            after: optional(op, "after"),
            parent: optional(op, "parent"),
        },
        "lift" => EditOp::Lift {
            id: required(op, "id"),
        },
        "retype" => EditOp::Retype {
            id: required(op, "id"),
            kind: required(op, "type"),
            data: present(op, "data"),
        },
        "setTunes" => EditOp::SetTunes {
            id: required(op, "id"),
            tunes: present(op, "tunes"),
        },
        "setMetadata" => {
            let at = match parse(present(op, "lastEditedAt").raw()) {
                Ok(Value::Number(at)) => at,
                other => panic!("lastEditedAt {other:?}"),
            };
            EditOp::SetMetadata {
                id: required(op, "id"),
                last_edited_at: at,
                last_edited_by: required(op, "lastEditedBy"),
                last_edited_with: optional(op, "lastEditedWith"),
            }
        }
        "setPageField" => EditOp::SetPageField {
            key: required(op, "key"),
            value: sub(op, "value").cloned(),
        },
        "patchMaps" => EditOp::PatchMaps {
            patches: present(op, "patches")
                .items
                .iter()
                .map(|p| MapPatch {
                    map: required(p, "map"),
                    key: required(p, "key"),
                    value: Out::Any(match sub(p, "value") {
                        Some(v) => plain(&strict_value(v).unwrap_or_else(|err| panic!("{err}"))),
                        None => Value::Null,
                    }),
                    remove: sub(p, "remove").is_some_and(|v| v.kind == Kind::True),
                })
                .collect(),
        },
        _ => {
            let mut body = br#"{"ops":["#.to_vec();
            op.append_json(&mut body)
                .unwrap_or_else(|err| panic!("{err}"));
            body.extend_from_slice(b"]}");
            parse_edit_ops(&body)
                .unwrap_or_else(|err| panic!("{err}"))
                .remove(0)
        }
    }
}

fn raw_cases() -> Node {
    // Go keeps seeds and agent ops as raw JSON, for the strict reader.
    let raw = parse_node(
        &read_bytes("collab-edits/cases.json"),
        JsonOptions {
            max_depth: 1024,
            ..JsonOptions::default()
        },
    )
    .unwrap_or_else(|err| panic!("{err}"));
    member(&raw, "cases")
        .unwrap_or_else(|err| panic!("{err}"))
        .unwrap_or_else(|| panic!("no cases"))
        .clone()
}

fn client_of(fixture: &Value, key: &str) -> u32 {
    match field(fixture, key) {
        Value::Number(client) => *client as u32,
        other => panic!("{other:?}"),
    }
}

/// One edit case; Err is the first difference.
fn check_edit_case(c: &Value, raw_case: &Node, client: u32) -> Result<(), String> {
    let fields = RichTextFields::built_in();
    let _keys = replace_row_keys(row_key_counter("e"));
    let doc = Doc::new(Options {
        client_id: Some(client),
        ..Options::default()
    });
    match doc.apply_update(
        &STANDARD
            .decode(text(field(c, "seedUpdate")))
            .map_err(|e| e.to_string())?,
    ) {
        Ok(result) if result.outcome == Outcome::Applied => {}
        other => return Err(format!("seed: {other:?}")),
    }
    let mut ops = Vec::new();
    if let Value::String(body) = field(c, "body") {
        ops = parse_edit_ops(body.to_string().as_bytes()).map_err(|e| e.to_string())?;
    }
    if let Some(agent) = sub(raw_case, "agent") {
        ops.extend(agent.items.iter().map(agent_op));
    }
    let mut converted = HashMap::new();
    let mut want_html = Vec::new();
    if let Value::Array(html) = field(c, "html") {
        for h in html {
            want_html.push(text(field(h, "html")));
            converted.insert(
                Str::from(text(field(h, "html")).as_str()),
                items(field(h, "segments")).to_vec(),
            );
        }
    }
    let updates = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&updates);
    let _subscription = doc.on_update(move |e| {
        if e.local {
            sink.lock()
                .unwrap_or_else(|err| panic!("{err}"))
                .push(STANDARD.encode(&e.update));
        }
    });
    let vector = doc.encode_state_vector();
    // As the room calls it: collect the HTML, then apply. Both plan, and
    // planning mints grid row keys, so the order counts.
    let result = collect_ops_html(&doc, &ops, &fields).and_then(|found| {
        let html: Vec<String> = found.iter().map(|h| h.html.to_string()).collect();
        if html != want_html {
            return Err(Error::Message(format!(
                "html\n got {html:?}\nwant {want_html:?}"
            )));
        }
        if let Value::Array(recorded) = field(c, "html") {
            let failures = crate::csharp_capture_html_test::check_read("ops", &found, recorded);
            if !failures.is_empty() {
                return Err(Error::Message(failures.join("\n")));
            }
        }
        apply_ops(
            &doc,
            &ops,
            &mut RichTextInput::converting(&fields, converted),
        )
    });
    let updates = updates.lock().unwrap_or_else(|err| panic!("{err}")).clone();
    if let Value::Object(_) = field(c, "refused") {
        let want = text(field(field(c, "refused"), "message"));
        match &result {
            Err(Error::Edit(edit))
                if text(field(field(c, "refused"), "kind")) == "edit" && edit.message == want => {}
            other => return Err(format!("refusal: got {other:?}, want {want:?}")),
        }
        if !updates.is_empty() || vector != doc.encode_state_vector() {
            return Err(format!("a refused request wrote: {updates:?}"));
        }
        return Ok(());
    }
    result.map_err(|e| e.to_string())?;
    let want: Vec<String> = items(field(c, "updates")).iter().map(text).collect();
    if updates != want {
        return Err(format!("updates\n got {updates:?}\nwant {want:?}"));
    }
    let exported = |doc: &Doc| -> Result<String, String> {
        let (blocks, _) = export(doc, &fields, None).map_err(|e| e.to_string())?;
        Ok(canonical(&Value::Array(blocks)))
    };
    let (got, want) = (exported(&doc)?, canonical(field(c, "export")));
    if got != want {
        return Err(format!("export\n got {got}\nwant {want}"));
    }
    let page = export_page(&doc).map_err(|e| e.to_string())?;
    let (got, want) = (
        canonical(&Value::Object(page)),
        canonical(field(c, "exportPage")),
    );
    if got != want {
        return Err(format!("page\n got {got}\nwant {want}"));
    }
    let Value::String(peer) = field(c, "peerUpdate") else {
        return Ok(());
    };
    match doc.apply_update(
        &STANDARD
            .decode(peer.to_string())
            .map_err(|e| e.to_string())?,
    ) {
        Ok(result) if result.outcome == Outcome::Applied => {}
        other => return Err(format!("peer: {other:?}")),
    }
    let (got, want) = (exported(&doc)?, canonical(field(c, "mergedExport")));
    if got != want {
        return Err(format!("merged\n got {got}\nwant {want}"));
    }
    Ok(())
}

// Twin of YDocConverterEditCaptureTests: the same seed and ops emit the same
// update bytes, export the same blocks, or refuse with the same message and
// write nothing.
#[test]
fn apply_ops_writes_what_csharp_writes() {
    let fixture = read("collab-edits/cases.json");
    let cases = items(field(&fixture, "cases"));
    assert!(!cases.is_empty(), "no cases");
    let client = client_of(&fixture, "editClient");
    let raw = raw_cases();
    let failures: Vec<String> = cases
        .iter()
        .zip(&raw.items)
        .filter_map(|(c, raw_case)| {
            check_edit_case(c, raw_case, client)
                .err()
                .map(|err| format!("{}: {err}", text(field(c, "name"))))
        })
        .collect();
    assert!(
        failures.is_empty(),
        "{} failed:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

// Each edit case's seed, seeded as client 1, must give C#'s seed update
// byte for byte: the bytes pin every container the seed mints (Y.Text or
// atomic, Y.Array or leaf, keyed grids, doubles), which no export can see.
#[test]
fn seed_writes_what_csharp_writes() {
    let fixture = read("collab-edits/cases.json");
    // The seeds as written, for the strict reader: Go keeps them as raw JSON.
    let raw = raw_cases();
    let raw_cases = &raw.items;
    let client = client_of(&fixture, "seedClient");
    let fields = RichTextFields::built_in();
    let mut compared = 0;
    let mut failures = Vec::new();
    for (c, raw_case) in items(field(&fixture, "cases")).iter().zip(raw_cases) {
        if !matches!(field(c, "shape"), Value::Undefined | Value::Null)
            || !matches!(field(c, "prior"), Value::Undefined | Value::Null)
        {
            continue;
        }
        compared += 1;
        let name = text(field(c, "name"));
        let _keys = replace_row_keys(row_key_counter("s"));
        let doc = Doc::new(Options {
            client_id: Some(client),
            ..Options::default()
        });
        let page = match field(c, "page") {
            Value::Object(page) => Some(source_object(page)),
            _ => None,
        };
        let blocks = &member(raw_case, "seed")
            .unwrap_or_else(|err| panic!("{name}: {err}"))
            .unwrap_or_else(|| panic!("{name}: no seed"))
            .items;
        // As C# RichTextRuntime.Seed calls it: collecting plans the grids,
        // and planning mints row keys, so the call shows in the bytes.
        collect_seed_html(blocks, &fields).unwrap_or_else(|err| panic!("{name}: {err}"));
        let mut converted = HashMap::new();
        if let Value::Array(html) = field(c, "seedHtml") {
            for h in html {
                converted.insert(
                    Str::from(text(field(h, "html")).as_str()),
                    items(field(h, "segments")).to_vec(),
                );
            }
        }
        seed(
            &doc,
            blocks,
            &mut RichTextInput::converting(&fields, converted),
            page.as_ref(),
        )
        .unwrap_or_else(|err| panic!("{name}: {err}"));
        let update = STANDARD.encode(
            doc.encode_state_as_update(&[])
                .unwrap_or_else(|err| panic!("{name}: {err}")),
        );
        let want = text(field(c, "seedUpdate"));
        if update != want {
            failures.push(format!("{name}: seed update\n got {update}\nwant {want}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    assert!(compared >= 80, "only {compared} seeds compared");
}

fn seed_node(json: &str) -> Node {
    parse_node(json.as_bytes(), JsonOptions::default()).unwrap_or_else(|err| panic!("{err}"))
}

// Twin of YDocConverterEditTests.RemovesFromALargeDocumentWithoutRescanningItPerStep:
// the removal walk is linear in the subtree, never the document.
#[test]
fn removal_visits_only_the_subtree() {
    const CHAIN: usize = 10;
    let mut blocks: Vec<Node> = (0..4000)
        .map(|i| {
            seed_node(&format!(
                r#"{{"id":"n{i}","type":"paragraph","data":{{}}}}"#
            ))
        })
        .collect();
    // n0 owns a chain c1 -> c2 -> ... by parentId alone.
    for i in 1..=CHAIN {
        let parent = if i == 1 {
            "n0".to_string()
        } else {
            format!("c{}", i - 1)
        };
        blocks.push(seed_node(&format!(
            r#"{{"id":"c{i}","type":"paragraph","data":{{}},"parent":"{parent}"}}"#
        )));
    }
    let fields = RichTextFields::built_in();
    let doc = Doc::new(Options::default());
    seed(&doc, &blocks, &mut RichTextInput::refusing(&fields), None)
        .unwrap_or_else(|err| panic!("{err}"));
    let ops = parse_edit_ops(br#"{"ops":[{"op":"remove","id":"n0"}]}"#)
        .unwrap_or_else(|err| panic!("{err}"));
    let visited = apply_ops_counted(&doc, &ops, &mut RichTextInput::refusing(&fields))
        .unwrap_or_else(|err| panic!("{err}"));
    let (exported, _) = export(&doc, &fields, None).unwrap_or_else(|err| panic!("{err}"));
    assert_eq!((exported.len(), visited), (3999, CHAIN + 1));
}

fn emitted_count(doc: &Doc) -> Arc<Mutex<usize>> {
    let emitted = Arc::new(Mutex::new(0));
    let sink = Arc::clone(&emitted);
    // Dropping the subscription does not unsubscribe.
    let _subscription = doc.on_update(move |_| {
        *sink.lock().unwrap_or_else(|err| panic!("{err}")) += 1;
    });
    emitted
}

fn assert_failed_mid_write(failing: Step) {
    let doc = Doc::new(Options::default());
    let emitted = emitted_count(&doc);
    let before = doc.encode_state_vector();
    let err = run_steps(
        &doc,
        vec![
            put_block(Str::from("a"), blok_yjs::Map::new(Vec::new())),
            failing,
        ],
    );
    assert!(
        matches!(err, Err(Error::EditFailedMidWrite(_))),
        "got {err:?}"
    );
    assert_eq!(*emitted.lock().unwrap_or_else(|err| panic!("{err}")), 0);
    assert_ne!(
        before,
        doc.encode_state_vector(),
        "the write must stay unemitted"
    );
}

// A step failing inside the transaction emits nothing, keeps what it wrote,
// and is reported as a failed write, not a refusal (C# ApplyOps catch).
#[test]
fn a_step_that_fails_mid_write_is_a_server_error() {
    assert_failed_mid_write(Box::new(|_, _, _| Err(EngineError::new("boom").into())));
    assert_failed_mid_write(Box::new(|_, _, _| panic!("boom")));
}

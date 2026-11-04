use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use blok_collab_collabtest::read;
use blok_jsjson::{Options as JsonOptions, Str, Value, parse, parse_node};
use blok_yjs::{Doc, Options, Outcome};

use crate::error::Error;
use crate::export::{RichTextHtmlSlot, export, export_page};
use crate::export_test::{canonical, decode64};
use crate::fields::RichTextFields;
use crate::richtext_test::{field, items, text};
use crate::richtextinput::RichTextInput;
use crate::seed::{collect_seed_html, replace_row_keys, seed, source_object};
use crate::seed_test::row_key_counter;

fn slot_rows(slots: &[RichTextHtmlSlot]) -> Vec<[String; 4]> {
    slots
        .iter()
        .map(|slot| {
            [
                slot.html.kind.to_string(),
                slot.html.field.to_string(),
                slot.key.to_string(),
                slot.html.html.to_string(),
            ]
        })
        .collect()
}

fn rows(value: &Value) -> Vec<[String; 4]> {
    items(value)
        .iter()
        .map(|row| {
            let row = items(row);
            assert_eq!(row.len(), 4, "a slot row is not four strings");
            [text(&row[0]), text(&row[1]), text(&row[2]), text(&row[3])]
        })
        .collect()
}

fn strings(value: &Value) -> Vec<String> {
    items(value).iter().map(text).collect()
}

// fixtures/collab-hardening/cases.json: the seed and export cases of C#
// YDocConverterHardeningTests, LawTests, TextMergeTests and ViewSettingsTests,
// captured by YDocConverterHardeningCaptureTests.
#[test]
fn export_reads_every_peer_shape_like_csharp() {
    let fixture = read("collab-hardening/cases.json");
    let exports = items(field(&fixture, "exports"));
    assert!(exports.len() >= 30, "only {} export cases", exports.len());
    let mut failures = Vec::new();
    for c in exports {
        let name = text(field(c, "name"));
        let doc = Doc::new(Options::default());
        match doc.apply_update(&decode64(&text(field(c, "update")))) {
            Ok(result) if result.outcome == Outcome::Applied => {}
            other => panic!("{name}: {other:?}"),
        }
        let mut warnings = Vec::new();
        let mut warn = |line: &str| warnings.push(line.to_owned());
        let (blocks, slots) = export(&doc, &RichTextFields::built_in(), Some(&mut warn))
            .unwrap_or_else(|err| panic!("{name}: {err}"));
        let (got, want) = (
            canonical(&Value::Array(blocks)),
            canonical(field(c, "export")),
        );
        if got != want {
            failures.push(format!("{name}: export\n got {got}\nwant {want}"));
        }
        let page = export_page(&doc).unwrap_or_else(|err| panic!("{name}: {err}"));
        let (got, want) = (
            canonical(&Value::Object(page)),
            canonical(field(c, "exportPage")),
        );
        if got != want {
            failures.push(format!("{name}: page\n got {got}\nwant {want}"));
        }
        let want = strings(field(c, "warnings"));
        if warnings != want {
            failures.push(format!(
                "{name}: warnings\n got {warnings:?}\nwant {want:?}"
            ));
        }
        let (got, want) = (slot_rows(&slots), rows(field(c, "slots")));
        if got != want {
            failures.push(format!("{name}: slots\n got {got:?}\nwant {want:?}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

// A seed must write C#'s bytes, or refuse with C#'s words and write nothing.
#[test]
fn seed_writes_or_refuses_like_csharp() {
    let fixture = read("collab-hardening/cases.json");
    let seeds = items(field(&fixture, "seeds"));
    assert!(seeds.len() >= 50, "only {} seed cases", seeds.len());
    let client = match field(&fixture, "seedClient") {
        Value::Number(client) => *client as u32,
        other => panic!("{other:?}"),
    };
    let fields = RichTextFields::built_in();
    let mut failures = Vec::new();
    for c in seeds {
        let name = text(field(c, "name"));
        let _keys = replace_row_keys(row_key_counter("s"));
        let doc = Doc::new(Options {
            client_id: Some(client),
            ..Options::default()
        });
        if let Value::String(before) = field(c, "before")
            && !before.is_empty()
        {
            match doc.apply_update(&decode64(&before.to_string())) {
                Ok(result) if result.outcome == Outcome::Applied => {}
                other => panic!("{name}: before: {other:?}"),
            }
        }
        let page = match field(c, "page") {
            Value::String(page) => match parse(page.to_string().as_bytes()) {
                Ok(Value::Object(page)) => Some(source_object(&page)),
                other => panic!("{name}: page {other:?}"),
            },
            _ => None,
        };
        // The fixture nests past jsjson's default depth of 64, as C# read it.
        let parsed = parse_node(
            text(field(c, "blocks")).as_bytes(),
            JsonOptions {
                max_depth: 1024,
                ..JsonOptions::default()
            },
        )
        .unwrap_or_else(|err| panic!("{name}: {err}"));
        let blocks = parsed.items;
        let mut converted = HashMap::new();
        if let Value::Array(html) = field(c, "html") {
            for h in html {
                converted.insert(
                    Str::from(text(field(h, "html")).as_str()),
                    items(field(h, "segments")).to_vec(),
                );
            }
        }
        let emitted = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&emitted);
        let _listener = doc.on_update(move |_| {
            counter.fetch_add(1, Ordering::SeqCst);
        });
        let vector = doc.encode_state_vector();
        let result = collect_seed_html(&blocks, &fields).and_then(|_| {
            seed(
                &doc,
                &blocks,
                &mut RichTextInput::converting(&fields, converted),
                page.as_ref(),
            )
        });
        if let Value::String(refused) = field(c, "refused") {
            match &result {
                Err(Error::Data(data)) if data.message == refused.to_string() => {}
                other => {
                    failures.push(format!("{name}: refusal: got {other:?}, want {refused}"));
                    continue;
                }
            }
            if emitted.load(Ordering::SeqCst) != 0 || vector != doc.encode_state_vector() {
                failures.push(format!("{name}: a refused seed wrote"));
            }
            continue;
        }
        if let Err(err) = result {
            failures.push(format!("{name}: {err}"));
            continue;
        }
        let state = STANDARD.encode(
            doc.encode_state_as_update(&[])
                .unwrap_or_else(|err| panic!("{name}: {err}")),
        );
        let want = text(field(c, "state"));
        if state != want {
            failures.push(format!("{name}: state\n got {state}\nwant {want}"));
        }
        let (blocks, slots) =
            export(&doc, &fields, None).unwrap_or_else(|err| panic!("{name}: {err}"));
        let (got, want) = (
            canonical(&Value::Array(blocks)),
            canonical(field(c, "export")),
        );
        if got != want {
            failures.push(format!("{name}: export\n got {got}\nwant {want}"));
        }
        let page = export_page(&doc).unwrap_or_else(|err| panic!("{name}: {err}"));
        let (got, want) = (
            canonical(&Value::Object(page)),
            canonical(field(c, "exportPage")),
        );
        if got != want {
            failures.push(format!("{name}: page\n got {got}\nwant {want}"));
        }
        let (got, want) = (slot_rows(&slots), rows(field(c, "slots")));
        if got != want {
            failures.push(format!("{name}: slots\n got {got:?}\nwant {want:?}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

// Twin of ExportWalksALongParentChainWithoutRecursing. Too big for the
// fixture: a chain far past any recursion limit must export whole.
#[test]
fn export_walks_a_long_parent_chain_without_recursing() {
    const LENGTH: usize = 20000;
    let mut json = String::from("[");
    for i in 0..LENGTH {
        if i > 0 {
            json.push(',');
        }
        json.push_str(&format!(
            r#"{{"id":"b{i}","type":"paragraph","data":{{"text":[{{"text":"x"}}]}}"#
        ));
        if i > 0 {
            json.push_str(&format!(r#","parent":"b{}""#, i - 1));
        }
        if i < LENGTH - 1 {
            json.push_str(&format!(r#","content":["b{}"]"#, i + 1));
        }
        json.push('}');
    }
    json.push(']');
    let nodes =
        parse_node(json.as_bytes(), JsonOptions::default()).unwrap_or_else(|err| panic!("{err}"));
    let doc = Doc::new(Options::default());
    let fields = RichTextFields::built_in();
    seed(
        &doc,
        &nodes.items,
        &mut RichTextInput::refusing(&fields),
        None,
    )
    .unwrap_or_else(|err| panic!("{err}"));
    let (blocks, _) = export(&doc, &fields, None).unwrap_or_else(|err| panic!("{err}"));
    let first = match blocks.first() {
        Some(Value::Object(block)) => block.members()[0].value.clone(),
        other => panic!("{other:?}"),
    };
    assert!(
        blocks.len() == LENGTH && first == Value::String(Str::from("b0")),
        "{} blocks",
        blocks.len()
    );
}

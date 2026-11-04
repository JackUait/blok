use std::collections::HashMap;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use blok_collab_collabtest::{read, read_bytes};
use blok_jsjson::{Options as JsonOptions, Str, Value, parse_node};
use blok_yjs::{Doc, Options};

use crate::editops::member;
use crate::fields::RichTextFields;
use crate::richtext_test::{field, items, text};
use crate::richtextinput::RichTextInput;
use crate::seed::{collect_seed_html, replace_row_keys, seed, source_object};
use crate::seed_test::row_key_counter;

// Each edit case's seed, seeded as client 1, must give C#'s seed update
// byte for byte: the bytes pin every container the seed mints (Y.Text or
// atomic, Y.Array or leaf, keyed grids, doubles), which no export can see.
#[test]
fn seed_writes_what_csharp_writes() {
    let fixture = read("collab-edits/cases.json");
    // The seeds as written, for the strict reader: Go keeps them as raw JSON.
    let raw = parse_node(
        &read_bytes("collab-edits/cases.json"),
        JsonOptions {
            max_depth: 1024,
            ..JsonOptions::default()
        },
    )
    .unwrap_or_else(|err| panic!("{err}"));
    let raw_cases = &member(&raw, "cases")
        .unwrap_or_else(|err| panic!("{err}"))
        .unwrap_or_else(|| panic!("no cases"))
        .items;
    let client = match field(&fixture, "seedClient") {
        Value::Number(client) => *client as u32,
        other => panic!("{other:?}"),
    };
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

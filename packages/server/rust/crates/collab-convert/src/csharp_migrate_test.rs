use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_collab_collabtest::path;
use blok_jsjson::{Str, Value};
use blok_yjs::{Doc, Options, Out, Outcome};

use crate::csharp_yrs_compat_test::{block_on, export_resolved, with_segments};
use crate::export::export;
use crate::export_test::{canonical, collab_cases, decode64};
use crate::fields::{RichTextFieldEntry, RichTextFields};
use crate::htmlreader::HtmlReader;
use crate::migrate::{collect_legacy_rich_text, migrate_rich_text};
use crate::migrate_test::format1_canonical;
use crate::richtext::from_delta;
use crate::richtext_test::{field, items, json_array, text};
use crate::richtextinput::RichTextInput;
use crate::seed_test::reader;

fn s(text: &str) -> Str {
    Str::from(text)
}

fn format1_names() -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(path("collab-format1"))
        .unwrap_or_else(|err| panic!("{err}"))
        .map(|entry| entry.unwrap_or_else(|err| panic!("{err}")))
        .filter(|entry| entry.path().is_dir())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert!(!names.is_empty());
    names
}

fn format1_room(name: &str) -> Doc {
    let raw = std::fs::read_to_string(path("collab-format1").join(name).join("update.b64"))
        .unwrap_or_else(|err| panic!("{err}"));
    let doc = Doc::new(Options::default());
    match doc.apply_update(&decode64(raw.trim())) {
        Ok(result) if result.outcome == Outcome::Applied => {}
        other => panic!("{name}: {other:?}"),
    }
    doc
}

/// Every built-in rich Y.Text becomes the string it holds, as the released
/// client stored it.
fn string_leaves(doc: &Doc) {
    let fields = RichTextFields::built_in();
    let blocks = doc.get_map("blocks").unwrap_or_else(|err| panic!("{err}"));
    doc.transact(|txn| {
        for id in blocks.keys() {
            let Some(block) = blocks.get(id).and_then(|v| v.as_map()) else {
                continue;
            };
            let (Some(Out::Any(Value::String(kind))), Some(data)) = (
                block.get("type"),
                block.get("data").and_then(|v| v.as_map()),
            ) else {
                continue;
            };
            for key in data.keys() {
                if !fields.is_rich(&kind, &key) {
                    continue;
                }
                if let Some(text) = data.get(key.clone()).and_then(|v| v.as_text()) {
                    data.set(txn, key, Value::String(text.units()))?;
                }
            }
        }
        Ok(())
    })
    .unwrap_or_else(|err| panic!("{err}"));
}

/// Collect, read in the runtime, then migrate with the answers.
fn migrate(doc: &Doc, fields: &RichTextFields) -> usize {
    let found = collect_legacy_rich_text(doc, fields).unwrap_or_else(|err| panic!("{err}"));
    let mut table = HashMap::new();
    if !found.is_empty() {
        let read =
            block_on(reader().read(&found, Duration::ZERO)).unwrap_or_else(|err| panic!("{err}"));
        for (html, segments) in found.iter().zip(read) {
            table.insert(html.html.clone(), segments);
        }
    }
    migrate_rich_text(doc, &mut RichTextInput::converting(fields, table))
        .unwrap_or_else(|err| panic!("{err}"))
}

fn data_value(doc: &Doc, id: &str, key: &str) -> Option<Out> {
    let blocks = doc.get_map("blocks").unwrap_or_else(|err| panic!("{err}"));
    blocks
        .get(id)
        .and_then(|block| block.as_map())
        .and_then(|block| block.get("data"))
        .and_then(|data| data.as_map())
        .and_then(|data| data.get(key))
}

fn plain_text(doc: &Doc, id: &str, key: &str) -> String {
    match data_value(doc, id, key).and_then(|v| v.as_text()) {
        Some(text) => text.units().to_string(),
        other => panic!("{id}.{key} is not a Y.Text: {other:?}"),
    }
}

fn formatted_json(doc: &Doc, id: &str, key: &str) -> String {
    match data_value(doc, id, key).and_then(|v| v.as_xml_text()) {
        Some(text) => json_array(from_delta(&text.to_delta())),
        None => panic!("{id}.{key} is not a Y.XmlText"),
    }
}

fn is_formatted(doc: &Doc, id: &str, key: &str) -> bool {
    data_value(doc, id, key)
        .and_then(|v| v.as_xml_text())
        .is_some()
}

// Twin of YDocConverterMigrationTests.StringLeafRoomsMigrateToTheSameSegments.
// The capture's string-leaves rows are never checked against the format-1
// client's canonical; this is.
#[test]
fn string_leaf_rooms_migrate_to_the_same_segments() {
    let fields = RichTextFields::built_in();
    for name in format1_names() {
        let doc = format1_room(&name);
        string_leaves(&doc);
        migrate(&doc, &fields);
        assert_eq!(
            canonical(&export_resolved(reader(), &doc)),
            canonical(&with_segments(reader(), &format1_canonical(&name))),
            "{name}"
        );
        assert!(
            collect_legacy_rich_text(&doc, &fields)
                .unwrap_or_else(|err| panic!("{err}"))
                .is_empty(),
            "{name}: left"
        );
    }
}

// Twin of YDocConverterMigrationTests.MigrationMatchesWhatTheFormat2ClientWrites:
// the format-2 client seeded the same input.json and wrote what it reads back.
#[test]
fn migration_matches_what_the_format2_client_writes() {
    let fields = RichTextFields::built_in();
    let names = format1_names();
    let mut copied = 0;
    for case in collab_cases() {
        if !names.contains(&case.name) {
            continue;
        }
        copied += 1;
        let doc = format1_room(&case.name);
        migrate(&doc, &fields);
        assert_eq!(
            canonical(&export_resolved(reader(), &doc)),
            canonical(&case.segments),
            "{}",
            case.name
        );
    }
    assert!(copied > 0, "no copied cases");
}

// Twin of YDocConverterMigrationTests.EveryMigratedRichFieldIsFormattedText.
#[test]
fn every_migrated_rich_field_is_formatted_text() {
    let fields = RichTextFields::built_in();
    for name in [
        "rich-block-types",
        "rich-marks",
        "rich-links",
        "rich-embeds",
    ] {
        let doc = format1_room(name);
        let found = collect_legacy_rich_text(&doc, &fields).unwrap_or_else(|err| panic!("{err}"));
        assert!(!found.is_empty(), "{name}: nothing found");
        migrate(&doc, &fields);
        let mut checked = 0;
        for block in items(&format1_canonical(name)) {
            let kind = text(field(block, "type"));
            let has_text = !matches!(
                field(field(block, "data"), "text"),
                Value::Undefined | Value::Null
            );
            if fields.is_rich(&s(&kind), &s("text")) && has_text {
                checked += 1;
                let id = text(field(block, "id"));
                assert!(is_formatted(&doc, &id, "text"), "{name}: {id}");
            }
        }
        assert!(checked > 0, "{name}: no rich field checked");
    }
}

// Twin of YDocConverterMigrationTests.MigrationIsIdempotent.
#[test]
fn migration_is_idempotent() {
    let fields = RichTextFields::built_in();
    let doc = format1_room("rich-marks");
    assert!(migrate(&doc, &fields) > 0);
    let before = doc.encode_state_vector();
    let updates = Arc::new(Mutex::new(0));
    let sink = updates.clone();
    let _subscription = doc.on_update(move |_| *sink.lock().unwrap() += 1);
    assert_eq!(migrate(&doc, &fields), 0);
    assert_eq!(*updates.lock().unwrap(), 0);
    assert_eq!(before, doc.encode_state_vector());
}

// Twin of YDocConverterMigrationTests.LeavesEveryNonRichFieldAsItWas: not
// rich are diffable fields, a callout title, an unregistered tool's text,
// and a database-row's nested documents.
#[test]
fn leaves_every_non_rich_field_as_it_was() {
    let fields = RichTextFields::built_in();
    let doc = format1_room("rich-negatives");
    assert_eq!(migrate(&doc, &fields), 0);
    assert_eq!(
        plain_text(&doc, "n-code", "code"),
        "<b>not markup</b> &amp; a < b"
    );
    assert_eq!(
        plain_text(&doc, "n-image", "caption"),
        "a <b>bold</b> caption"
    );
    assert_eq!(
        plain_text(&doc, "n-callout", "title"),
        "<b>legacy</b> title"
    );
    assert_eq!(
        plain_text(&doc, "n-widget", "text"),
        "<b>custom</b> tool text"
    );
    let (blocks, _) = export(&doc, &fields, None).unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(
        canonical(&Value::Array(blocks)),
        canonical(&format1_canonical("rich-negatives"))
    );
}

// Twin of YDocConverterMigrationTests.AHostRichFieldIsMigratedToo.
#[test]
fn a_host_rich_field_is_migrated_too() {
    let doc = format1_room("rich-negatives");
    let fields = RichTextFields::new(&[RichTextFieldEntry {
        kind: s("widget"),
        fields: Some(vec![s("text")]),
    }])
    .unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(migrate(&doc, &fields), 1);
    assert_eq!(
        formatted_json(&doc, "n-widget", "text"),
        r#"[{"text":"custom","marks":{"bold":true}},{"text":" tool text"}]"#
    );
}

// Twin of YDocConverterMigrationTests.MigratesUnreachableBlocksAndStringLeaves.
// The capture row unreachable-blocks-and-string-leaves checks the bytes;
// this checks both fields end formatted.
#[test]
fn migrates_unreachable_blocks_and_string_leaves() {
    let fields = RichTextFields::built_in();
    let doc = Doc::new(Options::default());
    let blocks = doc.get_map("blocks").unwrap_or_else(|err| panic!("{err}"));
    let root = doc.get_array("root").unwrap_or_else(|err| panic!("{err}"));
    doc.transact(|txn| {
        blocks.set(
            txn,
            "orphan",
            legacy_block(
                "orphan",
                "paragraph",
                "<b>lost</b> child",
                Some("nowhere"),
                false,
            ),
        )?;
        blocks.set(
            txn,
            "leaf",
            legacy_block("leaf", "header", "<i>leaf</i>", None, true),
        )?;
        root.insert(txn, 0, vec![Value::String(s("leaf")).into()])
    })
    .unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(migrate(&doc, &fields), 2);
    assert!(is_formatted(&doc, "orphan", "text"));
    assert!(is_formatted(&doc, "leaf", "text"));
}

fn legacy_block(
    id: &str,
    kind: &str,
    html: &str,
    parent: Option<&str>,
    as_string: bool,
) -> blok_yjs::Map {
    use blok_yjs::{In, Map, MapEntry, Text};
    let value: In = if as_string {
        Value::String(s(html)).into()
    } else {
        Text::new(Some(s(html))).into()
    };
    let mut entries = vec![
        MapEntry {
            key: s("id"),
            value: Value::String(s(id)).into(),
        },
        MapEntry {
            key: s("type"),
            value: Value::String(s(kind)).into(),
        },
        MapEntry {
            key: s("data"),
            value: Map::new(vec![MapEntry {
                key: s("text"),
                value,
            }])
            .into(),
        },
    ];
    if let Some(parent) = parent {
        entries.push(MapEntry {
            key: s("parentId"),
            value: Value::String(s(parent)).into(),
        });
    }
    Map::new(entries)
}

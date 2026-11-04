use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use blok_collab_collabtest::{path, read};
use blok_jsjson::{Str, Value};
use blok_yjs::{Doc, Options, Outcome};

use crate::csharp_yrs_compat_test::{block_on, with_segments};
use crate::docconverter_test::runtime;
use crate::error::Error;
use crate::export::export;
use crate::export_test::{canonical, decode64};
use crate::fields::{RichTextFieldEntry, RichTextFields};
use crate::migrate::{collect_legacy_rich_text, migrate_rich_text};
use crate::richtext_test::{field, items, text};
use crate::richtextinput::RichTextInput;
use crate::seed_test::reader;

fn optional<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    match value {
        Value::Object(object) => match object.get(&Str::from(key)) {
            None | Some(Value::Null) => None,
            Some(found) => Some(found),
        },
        _ => None,
    }
}

/// The room a case names: a format-1 fixture's update.b64, or its own
/// roomUpdate, then its shapeUpdate.
pub(crate) fn migration_room(case: &Value, edit_client: u32) -> Doc {
    let room = match optional(case, "room") {
        Some(room) => {
            let raw =
                std::fs::read_to_string(path("collab-format1").join(text(room)).join("update.b64"))
                    .unwrap_or_else(|err| panic!("{err}"));
            decode64(raw.trim())
        }
        None => decode64(&text(field(case, "roomUpdate"))),
    };
    let doc = Doc::new(Options {
        client_id: Some(edit_client),
        ..Options::default()
    });
    match doc.apply_update(&room) {
        Ok(result) if result.outcome == Outcome::Applied => {}
        other => panic!("room: {other:?}"),
    }
    if let Some(shape) = optional(case, "shapeUpdate") {
        doc.apply_update(&decode64(&text(shape)))
            .unwrap_or_else(|err| panic!("{err}"));
    }
    doc
}

pub(crate) fn migration_fields(case: &Value) -> RichTextFields {
    let Some(Value::Object(custom)) = optional(case, "customFields") else {
        return RichTextFields::built_in();
    };
    // One type per case, so the map's order does not matter.
    assert!(
        custom.members().len() <= 1,
        "a case with several custom types needs their order"
    );
    let entries: Vec<RichTextFieldEntry> = custom
        .members()
        .iter()
        .map(|member| RichTextFieldEntry {
            kind: member.key.clone(),
            fields: Some(
                items(&member.value)
                    .iter()
                    .map(|name| Str::from(text(name).as_str()))
                    .collect(),
            ),
        })
        .collect();
    RichTextFields::new(&entries).unwrap_or_else(|err| panic!("{err}"))
}

// Twin of YDocConverterMigrationCaptureTests: the same room collects the
// same HTML, and migrating it with the same segments emits the same bytes.
#[test]
fn migrate_rich_text_writes_what_csharp_writes() {
    let fixture = read("collab-migrations/cases.json");
    let edit_client = match field(&fixture, "editClient") {
        Value::Number(client) => *client as u32,
        other => panic!("{other:?}"),
    };
    let cases = items(field(&fixture, "cases"));
    assert!(!cases.is_empty(), "no cases");
    let mut oracles = 0;
    for case in cases {
        let name = text(field(case, "name"));
        let doc = migration_room(case, edit_client);
        let fields = migration_fields(case);
        let found = collect_legacy_rich_text(&doc, &fields).unwrap_or_else(|err| panic!("{err}"));
        let got: Vec<String> = found
            .iter()
            .map(|f| format!("{}.{}={:?}", f.kind, f.field, f.html.to_string()))
            .collect();
        let mut want = Vec::new();
        let mut converted = HashMap::new();
        for f in items(field(case, "found")) {
            let html = text(field(f, "html"));
            want.push(format!(
                "{}.{}={:?}",
                text(field(f, "type")),
                text(field(f, "field")),
                html
            ));
            let Value::Array(segments) = field(f, "segments") else {
                panic!("{name}: segments");
            };
            converted.insert(Str::from(html.as_str()), segments.clone());
        }
        assert_eq!(got, want, "{name}: found");
        if let Some(refusing) = optional(case, "refusing") {
            let vector = doc.encode_state_vector();
            match migrate_rich_text(&doc, &mut RichTextInput::refusing(&fields)) {
                Err(Error::Data(data)) if data.message == text(refusing) => {}
                other => panic!("{name}: refusing: {other:?}"),
            }
            assert_eq!(vector, doc.encode_state_vector(), "{name}: refusing wrote");
        }
        let updates = Arc::new(Mutex::new(Vec::new()));
        let sink = updates.clone();
        let _subscription = doc.on_update(move |e| {
            if e.local {
                sink.lock().unwrap().push(STANDARD.encode(&e.update));
            }
        });
        let migrated = migrate_rich_text(&doc, &mut RichTextInput::converting(&fields, converted))
            .unwrap_or_else(|err| panic!("{name}: {err}"));
        let want_migrated = match field(case, "migrated") {
            Value::Number(count) => *count as usize,
            other => panic!("{other:?}"),
        };
        assert_eq!(migrated, want_migrated, "{name}: migrated");
        let want_updates: Vec<String> = items(field(case, "updates")).iter().map(text).collect();
        assert_eq!(*updates.lock().unwrap(), want_updates, "{name}: updates");
        let (blocks, _) = export(&doc, &fields, None).unwrap_or_else(|err| panic!("{err}"));
        assert_eq!(
            canonical(&Value::Array(blocks)),
            canonical(field(case, "export")),
            "{name}: export"
        );
        let left = collect_legacy_rich_text(&doc, &fields).unwrap_or_else(|err| panic!("{err}"));
        assert!(left.is_empty(), "{name}: left {left:?}");
        // Twin of YDocConverterMigrationTests.MigrationKeepsEveryCharacterAndMark
        // and StringLeafRoomsMigrateToTheSameSegments: an oracle that is not
        // C#'s, what the format-1 client read from the same room.
        if let Some(room) = optional(case, "room")
            && optional(case, "customFields").is_none()
            && optional(case, "shapeUpdate").is_none()
        {
            oracles += 1;
            // RichTextRuntime.Export: nested HTML the plain export leaves is read too.
            let full = block_on(runtime().export(&doc)).unwrap_or_else(|err| panic!("{err}"));
            let read = with_segments(reader(), &format1_canonical(&text(room)));
            assert_eq!(
                canonical(field(&Value::Object(full), "blocks")),
                canonical(&read),
                "{name}: format-1 canonical"
            );
        }
    }
    assert!(oracles > 0, "no case checked against the format-1 client");
}

pub(crate) fn format1_canonical(room: &str) -> Value {
    read(&format!("collab-format1/{room}/canonical.json"))
}

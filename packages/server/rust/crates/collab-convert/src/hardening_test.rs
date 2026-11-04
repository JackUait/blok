use blok_collab_collabtest::read;
use blok_jsjson::Value;
use blok_yjs::{Doc, Options, Outcome};

use crate::export::{RichTextHtmlSlot, export, export_page};
use crate::export_test::{canonical, decode64};
use crate::fields::RichTextFields;
use crate::richtext_test::{field, items, text};

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

#[test]
#[ignore = "needs seed (seed lane)"]
fn seed_writes_or_refuses_like_csharp() {}

#[test]
#[ignore = "needs seed (seed lane)"]
fn export_walks_a_long_parent_chain_without_recursing() {}

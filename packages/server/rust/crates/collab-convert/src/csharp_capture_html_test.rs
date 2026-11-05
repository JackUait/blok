use blok_collab_collabtest::{read, read_bytes};
use blok_jsjson::{Node, Options as JsonOptions, Value, parse_node};
use blok_yjs::{Doc, Options};

use crate::editops::member;
use crate::export::{MAX_VALUE_DEPTH, RichTextHtml, export};
use crate::fields::RichTextFields;
use crate::htmlreader::HtmlReader;
use crate::migrate::collect_legacy_rich_text;
use crate::migrate_test::{migration_fields, migration_room};
use crate::richtext_test::{field, items, text};
use crate::seed::{collect_seed_html, replace_row_keys};
use crate::seed_test::{converted, reader, row_key_counter};

fn wide_node(json: &[u8]) -> Node {
    parse_node(
        json,
        JsonOptions {
            max_depth: 1024,
            ..JsonOptions::default()
        },
    )
    .unwrap_or_else(|err| panic!("{err}"))
}

/// Reads found in the runtime and returns one failure line per entry whose
/// segments differ from the recorded ones, or whose HTML differs.
pub(crate) fn check_read(name: &str, found: &[RichTextHtml], recorded: &[Value]) -> Vec<String> {
    let mut failures = Vec::new();
    let got: Vec<String> = found.iter().map(|f| f.html.to_string()).collect();
    let want: Vec<String> = recorded.iter().map(|r| text(field(r, "html"))).collect();
    if got != want {
        return vec![format!("{name}: html\n got {got:?}\nwant {want:?}")];
    }
    if found.is_empty() {
        return failures;
    }
    let read = crate::csharp_yrs_compat_test::block_on(reader().read(found, None))
        .unwrap_or_else(|err| panic!("{name}: {err}"));
    for ((f, segments), r) in found.iter().zip(read).zip(recorded) {
        let (got, want) = (
            crate::export_test::canonical(&Value::Array(segments)),
            crate::export_test::canonical(field(r, "segments")),
        );
        if got != want {
            failures.push(format!("{name}: {:?}\n got {got}\nwant {want}", f.html));
        }
    }
    failures
}

// The segments each capture records are what C#'s runtime read from the
// HTML. The replays feed them in as input, so these pin the reader.
#[test]
fn the_hardening_capture_reads_its_html_like_csharp() {
    let fixture = read("collab-hardening/cases.json");
    let raw = wide_node(&read_bytes("collab-hardening/cases.json"));
    let raw_seeds = &member(&raw, "seeds")
        .unwrap_or_else(|err| panic!("{err}"))
        .unwrap_or_else(|| panic!("no seeds"))
        .items;
    let fields = RichTextFields::built_in();
    let (mut checked, mut failures) = (0, Vec::new());
    for (c, _) in items(field(&fixture, "seeds")).iter().zip(raw_seeds) {
        let Value::Array(recorded) = field(c, "html") else {
            continue;
        };
        if recorded.is_empty() {
            continue;
        }
        checked += 1;
        let name = text(field(c, "name"));
        let blocks = wide_node(text(field(c, "blocks")).as_bytes()).items;
        let _keys = replace_row_keys(row_key_counter("s"));
        let found =
            collect_seed_html(&blocks, &fields).unwrap_or_else(|err| panic!("{name}: {err}"));
        failures.extend(check_read(&name, &found, recorded));
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    assert!(checked >= 6, "only {checked} cases carry HTML");
}

#[test]
fn the_edit_capture_reads_its_seed_html_like_csharp() {
    let fixture = read("collab-edits/cases.json");
    let raw = wide_node(&read_bytes("collab-edits/cases.json"));
    let raw_cases = &member(&raw, "cases")
        .unwrap_or_else(|err| panic!("{err}"))
        .unwrap_or_else(|| panic!("no cases"))
        .items;
    let fields = RichTextFields::built_in();
    let (mut checked, mut failures) = (0, Vec::new());
    for (c, raw_case) in items(field(&fixture, "cases")).iter().zip(raw_cases) {
        let name = text(field(c, "name"));
        let Some(seed) = member(raw_case, "seed").unwrap_or_else(|err| panic!("{name}: {err}"))
        else {
            continue;
        };
        let recorded = match field(c, "seedHtml") {
            Value::Array(recorded) => recorded.clone(),
            _ => Vec::new(),
        };
        checked += 1;
        let _keys = replace_row_keys(row_key_counter("s"));
        let found =
            collect_seed_html(&seed.items, &fields).unwrap_or_else(|err| panic!("{name}: {err}"));
        failures.extend(check_read(&name, &found, &recorded));
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    assert!(checked >= 80, "only {checked} seeds checked");
}

#[test]
fn the_migration_capture_reads_its_html_like_csharp() {
    let fixture = read("collab-migrations/cases.json");
    let edit_client = match field(&fixture, "editClient") {
        Value::Number(client) => *client as u32,
        other => panic!("{other:?}"),
    };
    let mut failures = Vec::new();
    for case in items(field(&fixture, "cases")) {
        let name = text(field(case, "name"));
        let doc = migration_room(case, edit_client);
        let found = collect_legacy_rich_text(&doc, &migration_fields(case))
            .unwrap_or_else(|err| panic!("{name}: {err}"));
        failures.extend(check_read(&name, &found, items(field(case, "found"))));
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

// Twin of SeedAndExportHandleDataNestedToTheLimit, which runs on a 1 MiB
// stack: the deepest data a seed takes must not need a bigger one. A debug
// build's frames are bigger (it needs about 1.3 MiB), so only release pins
// C#'s 1 MiB.
#[test]
fn seed_and_export_handle_data_nested_to_the_limit_on_a_one_megabyte_stack() {
    std::thread::Builder::new()
        .stack_size(if cfg!(debug_assertions) {
            3 << 19
        } else {
            1 << 20
        })
        .spawn(|| {
            let data =
                r#"{"a":"#.repeat(MAX_VALUE_DEPTH) + r#"{"v":1}"# + &"}".repeat(MAX_VALUE_DEPTH);
            let json = format!(r#"[{{"id":"a","type":"paragraph","data":{data}}}]"#);
            let blocks = wide_node(json.as_bytes()).items;
            let doc = Doc::new(Options::default());
            let fields = RichTextFields::built_in();
            let mut input =
                crate::richtextinput::RichTextInput::converting(&fields, converted(&blocks));
            crate::seed::seed(&doc, &blocks, &mut input, None)
                .unwrap_or_else(|err| panic!("{err}"));
            let (exported, _) = export(&doc, &fields, None).unwrap_or_else(|err| panic!("{err}"));
            assert_eq!(exported.len(), 1);
            let mut at = field(&exported[0], "data");
            for _ in 0..MAX_VALUE_DEPTH {
                at = field(at, "a");
            }
            assert_eq!(field(at, "v"), &Value::Number(1.0));
        })
        .unwrap_or_else(|err| panic!("{err}"))
        .join()
        .unwrap_or_else(|_| panic!("the seed overflowed a 1 MiB stack"));
}

// HostileNulUpdateExportsTheNulIntact and
// ExportSkipsAWireJsonValueItCannotMaterialise check the export after the
// runtime read its slots; the fixture records only the slots.
#[test]
fn the_hardening_exports_read_their_slots_like_csharp() {
    let fixture = read("collab-hardening/cases.json");
    let converter = crate::docconverter_test::runtime();
    let want = [
        ("hostile-nul-update", "a\u{0}b", r#"[{"text":"x"}]"#),
        (
            "wire-json-that-cannot-materialise",
            "n1",
            r#"[{"text":"n1"}]"#,
        ),
    ];
    for (name, id, want_text) in want {
        let case = items(field(&fixture, "exports"))
            .iter()
            .find(|c| text(field(c, "name")) == name)
            .unwrap_or_else(|| panic!("no case {name}"));
        let doc = Doc::new(Options::default());
        doc.apply_update(&crate::export_test::decode64(&text(field(case, "update"))))
            .unwrap_or_else(|err| panic!("{name}: {err}"));
        let (mut blocks, slots) = export(&doc, &RichTextFields::built_in(), None)
            .unwrap_or_else(|err| panic!("{name}: {err}"));
        crate::csharp_yrs_compat_test::block_on(converter.resolve(&mut blocks, &slots))
            .unwrap_or_else(|err| panic!("{name}: {err}"));
        assert_eq!(blocks.len(), 1, "{name}");
        assert_eq!(text(field(&blocks[0], "id")), id, "{name}");
        let data = field(&blocks[0], "data");
        assert_eq!(
            crate::export_test::canonical(field(data, "text")),
            want_text,
            "{name}"
        );
        if name == "wire-json-that-cannot-materialise" {
            assert_eq!(field(data, "lone"), &Value::Undefined, "{name}");
        }
    }
}

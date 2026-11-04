use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use blok_collab_collabtest::{path, read};
use blok_jsjson::{Member, Value, append_quoted, compare};
use blok_yjs::{Doc, Options, Outcome};

use crate::export::{export, export_page};
use crate::fields::RichTextFields;
use crate::richtext_test::{field, items, text};

const MAX_SAFE_INTEGER: f64 = 9007199254740992.0;

/// YDocConverterFixtures.Canonicalize: keys in ordinal order, numbers by
/// value. Compare two of these, never raw JSON text.
pub(crate) fn canonical(value: &Value) -> String {
    let mut out = Vec::new();
    write_canonical(&mut out, value);
    String::from_utf8(out).unwrap_or_else(|err| panic!("{err}"))
}

fn write_canonical(out: &mut Vec<u8>, value: &Value) {
    match value {
        Value::Null => out.extend_from_slice(b"null"),
        Value::Bool(flag) => out.extend_from_slice(flag.to_string().as_bytes()),
        Value::BigInt(big) => write_canonical(out, &Value::Number(*big as f64)),
        Value::Number(number) => {
            let text = if *number == number.trunc() && number.abs() <= MAX_SAFE_INTEGER {
                (*number as i64).to_string()
            } else {
                blok_dotnet::format_double(*number)
            };
            out.extend_from_slice(text.as_bytes());
        }
        Value::String(text) => append_quoted(out, text),
        Value::Array(items) => {
            out.push(b'[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                write_canonical(out, item);
            }
            out.push(b']');
        }
        Value::Object(object) => {
            let mut members: Vec<&Member> = object.members().iter().collect();
            members.sort_by(|x, y| compare(&x.key, &y.key));
            out.push(b'{');
            for (i, member) in members.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                append_quoted(out, &member.key);
                out.push(b':');
                write_canonical(out, &member.value);
            }
            out.push(b'}');
        }
        other => panic!("not JSON: {other:?}"),
    }
}

// Go's base64 decoder skips CR and LF; update.b64 wraps its lines.
pub(crate) fn decode64(text: &str) -> Vec<u8> {
    let joined: String = text.chars().filter(|c| !matches!(c, '\r' | '\n')).collect();
    STANDARD
        .decode(joined)
        .unwrap_or_else(|err| panic!("{text:?}: {err}"))
}

struct CollabCase {
    name: String,
    update: Vec<u8>,
    segments: Value,
    page_canon: Option<Value>,
}

fn collab_cases() -> Vec<CollabCase> {
    let root = path("collab");
    let mut names: Vec<String> = std::fs::read_dir(&root)
        .unwrap_or_else(|err| panic!("{err}"))
        .map(|entry| entry.unwrap_or_else(|err| panic!("{err}")))
        .filter(|entry| entry.path().is_dir())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    // Go's os.ReadDir sorts by name.
    names.sort();
    let cases: Vec<CollabCase> = names
        .into_iter()
        .map(|name| {
            read(&format!("collab/{name}/input.json"));
            let raw = std::fs::read_to_string(root.join(&name).join("update.b64"))
                .unwrap_or_else(|err| panic!("{name}: {err}"));
            let page_canon = root.join(&name).join("page.json").exists().then(|| {
                read(&format!("collab/{name}/page.json"));
                read(&format!("collab/{name}/page-canonical.json"))
            });
            CollabCase {
                update: decode64(raw.trim()),
                segments: read(&format!("collab/{name}/canonical.segments.json")),
                page_canon,
                name,
            }
        })
        .collect();
    // Twin of ManifestListsExactlyTheCommittedCases.
    let manifest = read("collab/manifest.json");
    let mut listed: Vec<String> = items(field(&manifest, "cases"))
        .iter()
        .map(|entry| text(field(entry, "name")))
        .collect();
    listed.sort();
    let found: Vec<String> = cases.iter().map(|c| c.name.clone()).collect();
    assert!(
        !found.is_empty() && listed == found,
        "manifest {listed:?}, folders {found:?}"
    );
    cases
}

pub(crate) fn applied(update: &[u8]) -> Doc {
    let doc = Doc::new(Options::default());
    let result = doc.apply_update(update);
    // A parked update would export empty and still match empty-doc.
    match &result {
        Ok(result) if result.outcome == Outcome::Applied && !doc.has_pending() => {}
        other => panic!("{other:?}"),
    }
    doc
}

#[test]
fn exporting_the_client_update_gives_the_canonical_json() {
    let mut failures = Vec::new();
    for c in collab_cases() {
        let (blocks, slots) = match export(&applied(&c.update), &RichTextFields::built_in(), None) {
            Ok(read) => read,
            Err(err) => {
                failures.push(format!("{}: {err}", c.name));
                continue;
            }
        };
        if !slots.is_empty() {
            failures.push(format!(
                "{}: {} HTML slots from a format-2 client",
                c.name,
                slots.len()
            ));
        }
        let (got, want) = (canonical(&Value::Array(blocks)), canonical(&c.segments));
        if got != want {
            failures.push(format!("{}:\n got {got}\nwant {want}", c.name));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn exporting_the_client_update_gives_the_canonical_page() {
    let mut pages = 0;
    let mut failures = Vec::new();
    for c in collab_cases() {
        let Some(want) = &c.page_canon else {
            continue;
        };
        pages += 1;
        let page = export_page(&applied(&c.update)).unwrap_or_else(|err| panic!("{err}"));
        let (got, want) = (canonical(&Value::Object(page)), canonical(want));
        if got != want {
            failures.push(format!("{}:\n got {got}\nwant {want}", c.name));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    assert_eq!(pages, 7, "{pages} page cases, want 7");
}

use std::fmt::Write as _;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

use crate::runtime_test::fixture;
use crate::test_json::Json;
use crate::{Error, InvokeError, Options, Pool};

fn input(case: &Json) -> String {
    let Json::Object(map) = case else {
        panic!("a case is not an object")
    };
    let Some(recipe) = map.get("inputRecipe") else {
        return case.get("input").str().to_owned();
    };
    let mut text = String::new();
    for part in recipe.get("parts").array() {
        if let Json::String(literal) = part {
            text.push_str(literal);
            continue;
        }
        let items = part.get("items").array();
        let join = part.get("join").str();
        let repeat = part.get("repeat").number() as usize;
        for i in 0..repeat {
            if i > 0 {
                text.push_str(join);
            }
            text.push_str(&items[i % items.len()].str().replace("{i}", &i.to_string()));
        }
    }
    text
}

/// `"(md|html)-[a-z0-9]+-` becomes `"$1-X-`, as Go and C# normalize the
/// random part of import ids.
fn normalize_import_ids(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('"') {
        out.push_str(&rest[..=at]);
        rest = &rest[at + 1..];
        for prefix in ["md-", "html-"] {
            let Some(tail) = rest.strip_prefix(prefix) else {
                continue;
            };
            let id = tail
                .bytes()
                .take_while(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
                .count();
            if id > 0 && tail.as_bytes().get(id) == Some(&b'-') {
                out.push_str(prefix);
                out.push_str("X-");
                rest = &tail[id + 1..];
            }
            break;
        }
    }
    out.push_str(rest);
    out
}

fn sha256_hex(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .fold(String::new(), |mut hex, byte| {
            let _ = write!(hex, "{byte:02x}");
            hex
        })
}

// Outputs are node:vm's answers (scripts/generate-documents-ops-fixture.mjs);
// C# DocumentOpsFixtureTests checks Jint against the same file, exactly, and
// so does this. Go rewrites the lone.* answers to U+FFFD for goja.
#[tokio::test]
async fn matches_node_on_the_document_ops_fixture() {
    let cases = fixture("test/unit/server-conformance/fixtures/documents/ops.json");
    assert!(
        cases.array().len() >= 300,
        "only {} cases",
        cases.array().len()
    );
    let pool = Pool::new(Options {
        pool_size: 1,
        ..Options::default()
    })
    .expect("new");
    let mut failures = Vec::new();
    for case in cases.array() {
        let (name, op) = (case.get("name").str(), case.get("op").str());
        let Json::Object(map) = case else {
            unreachable!()
        };
        let start = Instant::now();
        let got = pool
            .invoke(op, &input(case), Duration::from_secs(300))
            .await;
        if name.starts_with("big.") {
            println!("{name} {op}: {:?}", start.elapsed());
        }
        if let Some(error_name) = map.get("errorName") {
            match &got {
                Err(InvokeError::Failure(failure)) if matches!(&failure.err, Error::Js(err) if err.name == error_name.str()) =>
                    {}
                other => failures.push(format!("{name}: {other:?}, want a {}", error_name.str())),
            }
            continue;
        }
        let mut got = match got {
            Ok(got) => got,
            Err(err) => {
                failures.push(format!("{name}: {err}"));
                continue;
            }
        };
        if map.get("normalizeIds").is_some_and(Json::bool) {
            got = normalize_import_ids(&got);
        }
        if let Some(want) = map.get("output") {
            if got != want.str() {
                let shown: String = got.chars().take(400).collect();
                failures.push(format!("{name}: output differs, got {shown:?}"));
            }
            continue;
        }
        if sha256_hex(&got) != case.get("outputSha256").str() {
            let shown: String = got.chars().take(200).collect();
            failures.push(format!(
                "{name}: sha256 differs; got {} bytes starting {shown:?}",
                got.len()
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn normalizes_import_ids_like_go_and_csharp() {
    assert_eq!(
        normalize_import_ids(r#"{"id":"md-abc12-3","x":"html-z9-","y":"md-ABC-"}"#),
        r#"{"id":"md-X-3","x":"html-X-","y":"md-ABC-"}"#
    );
}

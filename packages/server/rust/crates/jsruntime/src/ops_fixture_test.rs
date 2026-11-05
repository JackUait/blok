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

/// Go gojaReadsLoneSurrogates and C# ReadLoneSurrogatesAsGoDoes: each
/// `\\uD800`-`\\uDFFF` escape becomes U+FFFD unless a high escape sits right
/// before a low one.
fn reads_lone_surrogates_as_go_does(want: &str) -> String {
    let bytes = want.as_bytes();
    let escape_at = |i: usize| -> Option<bool> {
        let unit = bytes.get(i..i + 6)?;
        if unit[0] != b'\\' || unit[1] != b'u' || !matches!(unit[2], b'd' | b'D') {
            return None;
        }
        if !unit[3..].iter().all(u8::is_ascii_hexdigit) {
            return None;
        }
        match unit[3] {
            b'8' | b'9' | b'a' | b'b' | b'A' | b'B' => Some(true),
            b'c'..=b'f' | b'C'..=b'F' => Some(false),
            _ => None,
        }
    };
    let mut out = String::with_capacity(want.len());
    let mut i = 0;
    let mut copied = 0;
    while i < bytes.len() {
        let Some(high) = escape_at(i) else {
            i += 1;
            continue;
        };
        out.push_str(&want[copied..i]);
        if high && escape_at(i + 6) == Some(false) {
            out.push_str(&want[i..i + 12]);
            i += 12;
        } else {
            out.push('\u{fffd}');
            i += 6;
        }
        copied = i;
    }
    out.push_str(&want[copied..]);
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
// C# DocumentOpsFixtureTests checks Jint against the same file. Node keeps a
// lone-surrogate escape; Go, C# and this runtime read it as U+FFFD, so the
// lone.* answers are rewritten as Go and C# rewrite them.
#[tokio::test]
async fn matches_node_on_the_document_ops_fixture() {
    let cases = fixture("test/unit/server-conformance/fixtures/documents/ops.json");
    assert!(
        cases.array().len() >= 300,
        "only {} cases",
        cases.array().len()
    );
    let pool = Pool::new(Options {
        pool_size: Some(1),
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
            let want = if name.starts_with("lone.") {
                reads_lone_surrogates_as_go_does(want.str())
            } else {
                want.str().to_owned()
            };
            if got != want {
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

#[test]
fn rewrites_lone_escapes_and_keeps_pairs_as_go_does() {
    assert_eq!(
        reads_lone_surrogates_as_go_does(r"a\ud800b\uD83D\uDE80\udc00\\x"),
        "a\u{fffd}b\\uD83D\\uDE80\u{fffd}\\\\x"
    );
}

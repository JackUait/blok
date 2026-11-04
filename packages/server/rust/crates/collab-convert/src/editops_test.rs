use std::collections::HashMap;

use blok_collab_collabtest::{hex, read};
use blok_jsjson::{Node, Options, Str, Value, parse_node};
use sha2::{Digest, Sha256};

use crate::editops::{
    EditOp, canonical_body, canonical_body_digest, normalize_idempotency_key, parse_edit_ops,
    restore_digest,
};
use crate::richtext_test::{field, items, text};

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn optional_text(value: &Value) -> Option<String> {
    match value {
        Value::Undefined | Value::Null => None,
        other => Some(text(other)),
    }
}

fn load_digest() -> Value {
    let fixture = read("canonical-edit-digest.json");
    for section in ["parse", "agent", "keys", "restore"] {
        assert!(
            !items(field(&fixture, section)).is_empty(),
            "the fixture is missing a section"
        );
    }
    fixture
}

#[test]
fn parses_every_edit_body_like_csharp() {
    let fixture = load_digest();
    let mut failures = Vec::new();
    for c in items(field(&fixture, "parse")) {
        let name = text(field(c, "name"));
        let body = match optional_text(field(c, "body")) {
            Some(body) => body.into_bytes(),
            None => hex(&text(field(c, "bodyHex"))),
        };
        let ops = parse_edit_ops(&body);
        if let Some(want) = optional_text(field(c, "error")) {
            match &ops {
                Err(err) if err.to_string() == want => {}
                other => failures.push(format!("{name}: got {other:?}, want {want:?}")),
            }
            continue;
        }
        let ops = match ops {
            Ok(ops) => ops,
            Err(err) => {
                failures.push(format!("{name}: {err}"));
                continue;
            }
        };
        let want = text(field(c, "canonical"));
        match canonical_body(&ops) {
            Ok(canonical) if canonical == want.as_bytes() => {}
            other => {
                failures.push(format!(
                    "{name}:\n got {:?}\nwant {want}",
                    other.map(|b| String::from_utf8_lossy(&b).into_owned())
                ));
                continue;
            }
        }
        let digest = canonical_body_digest(&ops).unwrap_or_default();
        if to_hex(&digest) != text(field(c, "digestHex")) {
            failures.push(format!("{name}: digest differs"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

fn node(json: &str) -> Node {
    parse_node(json.as_bytes(), Options::default()).unwrap_or_else(|err| panic!("{err}"))
}

fn s(text: &str) -> Str {
    Str::from(text)
}

// The agent builds these ops in code; each must digest like C#.
#[test]
fn digests_every_agent_op_like_csharp() {
    let ops: HashMap<&str, EditOp> = HashMap::from([
        (
            "move",
            EditOp::Move {
                id: s("b1"),
                after: Some(s("b0")),
                parent: Some(s("p1")),
            },
        ),
        (
            "move to the start of the root",
            EditOp::Move {
                id: s("b1"),
                after: None,
                parent: None,
            },
        ),
        ("lift", EditOp::Lift { id: s("b1") }),
        (
            "retype",
            EditOp::Retype {
                id: s("b1"),
                kind: s("header"),
                data: node(r#"{"z":1,"a":"é","level":2.5}"#),
            },
        ),
        (
            "setTunes",
            EditOp::SetTunes {
                id: s("b1"),
                tunes: node(r#"{"align":"left","anchor":null}"#),
            },
        ),
        (
            "setPageField",
            EditOp::SetPageField {
                key: s("title"),
                value: Some(node(r#""Hi""#)),
            },
        ),
        (
            "setPageField null",
            EditOp::SetPageField {
                key: s("icon"),
                value: None,
            },
        ),
        (
            "setPageField object",
            EditOp::SetPageField {
                key: s("icon"),
                value: Some(node(r#"{"value":"x","type":"emoji"}"#)),
            },
        ),
    ]);
    let metadata: HashMap<&str, (&str, Option<&str>)> = HashMap::from([
        ("setMetadata", ("user-1", None)),
        ("setMetadata with", ("u<1>", Some("agent"))),
        ("setMetadata large", ("u", None)),
        ("setMetadata small", ("u", None)),
        ("setMetadata negative zero", ("u", None)),
        ("setMetadata max", ("u", None)),
    ]);
    let fixture = load_digest();
    let mut failures = Vec::new();
    for c in items(field(&fixture, "agent")) {
        let name = text(field(c, "name"));
        let op = if let Some((by, with)) = metadata.get(name.as_str()) {
            let bits: i64 = text(field(c, "lastEditedAtBits"))
                .parse()
                .unwrap_or_else(|err| panic!("{name}: {err}"));
            EditOp::SetMetadata {
                id: s("b1"),
                last_edited_at: f64::from_bits(bits as u64),
                last_edited_by: s(by),
                last_edited_with: with.map(s),
            }
        } else if let Some(op) = ops.get(name.as_str()) {
            op.clone()
        } else {
            failures.push(format!("{name}: no Rust op for this case"));
            continue;
        };
        let want = text(field(c, "canonical"));
        let canonical = match canonical_body(&[op]) {
            Ok(canonical) if canonical == want.as_bytes() => canonical,
            other => {
                failures.push(format!(
                    "{name}:\n got {:?}\nwant {want}",
                    other.map(|b| String::from_utf8_lossy(&b).into_owned())
                ));
                continue;
            }
        };
        if to_hex(&Sha256::digest(&canonical)) != text(field(c, "digestHex")) {
            failures.push(format!("{name}: digest differs"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    assert!(
        canonical_body(&[EditOp::PatchMaps {
            patches: Vec::new()
        }])
        .is_err(),
        "a map patch has no canonical body"
    );
}

#[test]
fn maps_idempotency_keys_like_csharp() {
    let fixture = load_digest();
    for c in items(field(&fixture, "keys")) {
        let key = text(field(c, "key"));
        let want = optional_text(field(c, "operationId"));
        assert_eq!(normalize_idempotency_key(key.as_bytes()), want, "{key:?}");
    }
}

#[test]
fn digests_a_restore_like_csharp() {
    let fixture = load_digest();
    for c in items(field(&fixture, "restore")) {
        let lineage = text(field(c, "lineage"));
        let sequence: u64 = text(field(c, "sequence"))
            .parse()
            .unwrap_or_else(|err| panic!("{err}"));
        assert_eq!(
            to_hex(&restore_digest(&lineage, sequence)),
            text(field(c, "digestHex")),
            "{lineage} {sequence}"
        );
    }
}

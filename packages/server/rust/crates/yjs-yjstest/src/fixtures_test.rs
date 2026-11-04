use blok_jsjson::{Object, Str, Value};
use sha2::{Digest, Sha256};

use crate::*;

#[test]
fn loader_finds_every_manifested_file() {
    let manifest = load("manifest.json").unwrap();
    let dir = dir().unwrap();
    let files = items(&manifest, "files");
    assert!(!files.is_empty(), "manifest lists no files");
    let mut failures = Vec::new();
    for file in files {
        let path = string(file, "path");
        let data = match std::fs::read(dir.join(&path)) {
            Ok(data) => data,
            Err(err) => {
                failures.push(format!("{path}: {err}"));
                continue;
            }
        };
        if let Err(err) = load(&path) {
            failures.push(format!("{path}: {err}"));
        }
        if !has(file, "sha256") {
            continue;
        }
        if data.len() as f64 != number(file, "bytes") {
            failures.push(format!(
                "{path}: {} bytes, manifest says {}",
                data.len(),
                number(file, "bytes")
            ));
        }
        let sum: String = Sha256::digest(&data)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        if sum != string(file, "sha256") {
            failures.push(format!("{path}: sha256 differs from the manifest"));
        }
    }
    assert!(failures.is_empty(), "{failures:?}");
}

#[test]
fn canonical_sorts_keys_by_utf16_units() {
    let mut object = Object::new();
    object.set(Str::from("～"), Value::Number(1.0));
    object.set(Str::from("\u{1F600}"), Value::Number(2.0));
    object.set(Str::from("a"), Value::Number(3.0));
    let got = canonical(&Value::Object(object)).unwrap();
    assert_eq!(got, "{\"a\":3,\"\u{1F600}\":2,\"～\":1}");
}

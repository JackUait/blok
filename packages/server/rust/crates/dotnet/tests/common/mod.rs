#![allow(dead_code)]

use blok_jsjson::{Str, Value};

pub fn fixture_path(rel: &str) -> String {
    format!(
        "{}/../../../../../test/unit/server-conformance/fixtures/{rel}",
        env!("CARGO_MANIFEST_DIR")
    )
}

pub fn load(rel: &str) -> Value {
    let path = fixture_path(rel);
    let data = std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    blok_jsjson::parse(&data).unwrap_or_else(|e| panic!("{path}: {e}"))
}

pub fn field<'a>(value: &'a Value, key: &str) -> &'a Value {
    match value {
        Value::Object(object) => object.get(&Str::from(key)).unwrap_or(&Value::Undefined),
        _ => &Value::Undefined,
    }
}

// Lossy, as encoding/json reads a lone surrogate escape.
pub fn text(value: &Value, key: &str) -> Option<String> {
    match field(value, key) {
        Value::String(s) => Some(s.to_string()),
        _ => None,
    }
}

pub fn string(value: &Value, key: &str) -> String {
    text(value, key).unwrap_or_default()
}

pub fn flag(value: &Value, key: &str) -> bool {
    matches!(field(value, key), Value::Bool(true))
}

pub fn number(value: &Value, key: &str) -> f64 {
    match field(value, key) {
        Value::Number(n) => *n,
        _ => 0.0,
    }
}

pub fn items<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    match field(value, key) {
        Value::Array(items) => items,
        _ => &[],
    }
}

pub fn as_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.to_string(),
        other => panic!("{other:?} is not a string"),
    }
}

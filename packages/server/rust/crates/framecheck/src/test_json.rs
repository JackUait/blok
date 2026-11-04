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

pub fn text(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.to_string()),
        _ => None,
    }
}

pub fn string(value: &Value, key: &str) -> String {
    text(field(value, key)).unwrap_or_default()
}

pub fn items(value: &Value) -> &[Value] {
    match value {
        Value::Array(items) => items,
        _ => &[],
    }
}

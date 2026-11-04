//! Reads the shared yjs-engine fixtures under
//! test/unit/server-conformance/fixtures/yjs-engine, the same files Go's
//! yjstest and Blok.Server.Tests (YjsEngineFixtures.cs) read.

use std::path::{Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use blok_jsjson::{Object, Str, Value};

#[cfg(test)]
mod fixtures_test;

const FIXTURE_REL: &str = "test/unit/server-conformance/fixtures/yjs-engine";

/// The folder that holds test/unit/server-conformance, found by walking up
/// from this crate. BLOK_REPO_ROOT overrides it.
pub fn repo_root() -> Result<PathBuf, String> {
    if let Ok(root) = std::env::var("BLOK_REPO_ROOT")
        && !root.is_empty()
    {
        return Ok(PathBuf::from(root));
    }
    let mut dir: &Path = Path::new(env!("CARGO_MANIFEST_DIR"));
    loop {
        if dir
            .join("test")
            .join("unit")
            .join("server-conformance")
            .is_dir()
        {
            return Ok(dir.to_path_buf());
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => {
                return Err(
                    "yjstest: no test/unit/server-conformance above the crate; set BLOK_REPO_ROOT"
                        .into(),
                );
            }
        }
    }
}

/// The yjs-engine fixture directory.
pub fn dir() -> Result<PathBuf, String> {
    Ok(repo_root()?.join(FIXTURE_REL))
}

/// Parses one fixture file as JS values, keys in file order.
pub fn load(name: &str) -> Result<Value, String> {
    let path = dir()?.join(name);
    let data = std::fs::read(&path).map_err(|err| format!("yjstest: {name}: {err}"))?;
    blok_jsjson::parse(&data).map_err(|err| format!("yjstest: {name}: {err}"))
}

/// A member of a JS object, or None.
pub fn field<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    match value {
        Value::Object(object) => object.get(&Str::from(key)),
        _ => None,
    }
}

/// Whether a JS object has the member.
pub fn has(value: &Value, key: &str) -> bool {
    field(value, key).is_some()
}

/// A string member, or "".
pub fn string(value: &Value, key: &str) -> String {
    match field(value, key) {
        Some(Value::String(text)) => text.to_string(),
        _ => String::new(),
    }
}

/// A boolean member, or false.
pub fn bool(value: &Value, key: &str) -> bool {
    matches!(field(value, key), Some(Value::Bool(true)))
}

/// A number member, or 0.
pub fn number(value: &Value, key: &str) -> f64 {
    match field(value, key) {
        Some(Value::Number(number)) => *number,
        _ => 0.0,
    }
}

/// An array member, or nothing.
pub fn items<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    match field(value, key) {
        Some(Value::Array(items)) => items,
        _ => &[],
    }
}

/// Decodes a standard base64 member.
pub fn bytes(value: &Value, key: &str) -> Result<Vec<u8>, String> {
    match field(value, key) {
        Some(Value::String(text)) => STANDARD
            .decode(text.to_string())
            .map_err(|err| format!("yjstest: {key:?}: {err}")),
        _ => Err(format!("yjstest: {key:?} is not a string")),
    }
}

/// A file's "cases" array.
pub fn cases(name: &str) -> Result<Vec<Value>, String> {
    match field(&load(name)?, "cases") {
        Some(Value::Array(cases)) => Ok(cases.clone()),
        _ => Err(format!("yjstest: {name} has no cases array")),
    }
}

/// A fixture value as an engine value, reading the sentinel objects $num,
/// $undefined, $bigint and $u8.
pub fn to_engine(value: &Value) -> Result<Value, String> {
    match value {
        Value::Object(object) => {
            if object.len() == 1 {
                let member = &object.members()[0];
                let text = match &member.value {
                    Value::String(text) => text.to_string(),
                    _ => String::new(),
                };
                match member.key.to_string().as_str() {
                    "$num" => return sentinel_number(&text).map(Value::Number),
                    "$undefined" => return Ok(Value::Undefined),
                    "$bigint" => {
                        return text
                            .parse::<i64>()
                            .map(Value::BigInt)
                            .map_err(|_| format!("yjstest: bad $bigint {text:?}"));
                    }
                    "$u8" => {
                        return STANDARD
                            .decode(&text)
                            .map(Value::Bytes)
                            .map_err(|err| format!("yjstest: bad $u8: {err}"));
                    }
                    _ => {}
                }
            }
            let mut converted = Object::new();
            for member in object.members() {
                converted.set(member.key.clone(), to_engine(&member.value)?);
            }
            Ok(Value::Object(converted))
        }
        Value::Array(items) => items
            .iter()
            .map(to_engine)
            .collect::<Result<_, _>>()
            .map(Value::Array),
        other => Ok(other.clone()),
    }
}

fn sentinel_number(text: &str) -> Result<f64, String> {
    match text {
        "NaN" => Ok(blok_jsjson::nan()),
        "-0" => Ok(-0.0),
        "Infinity" => Ok(f64::INFINITY),
        "-Infinity" => Ok(f64::NEG_INFINITY),
        _ => Err(format!("yjstest: bad $num {text:?}")),
    }
}

/// The inverse of [`to_engine`]: the shape scripts/yjs-engine-render.mjs
/// writes for an engine value.
pub fn to_fixture(value: &Value) -> Value {
    match value {
        Value::Number(number) => {
            let number = *number;
            if number.is_nan() {
                sentinel("$num", Value::String(Str::from("NaN")))
            } else if number == 0.0 && number.is_sign_negative() {
                sentinel("$num", Value::String(Str::from("-0")))
            } else if number == f64::INFINITY {
                sentinel("$num", Value::String(Str::from("Infinity")))
            } else if number == f64::NEG_INFINITY {
                sentinel("$num", Value::String(Str::from("-Infinity")))
            } else {
                Value::Number(number)
            }
        }
        Value::Undefined => sentinel("$undefined", Value::Bool(true)),
        Value::BigInt(n) => sentinel("$bigint", Value::String(Str::from(n.to_string()))),
        Value::Bytes(data) => sentinel("$u8", Value::String(Str::from(STANDARD.encode(data)))),
        Value::Object(object) => Value::Object(
            object
                .members()
                .iter()
                .map(|member| (member.key.clone(), to_fixture(&member.value)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(to_fixture).collect()),
        other => other.clone(),
    }
}

fn sentinel(key: &str, value: Value) -> Value {
    let mut object = Object::new();
    object.set(Str::from(key), value);
    Value::Object(object)
}

/// JSON.stringify(canonicalize(value)) from
/// scripts/generate-yjs-engine-fixtures.mjs: keys sorted by UTF-16 units at
/// every level.
pub fn canonical(value: &Value) -> Result<String, String> {
    blok_jsjson::stringify(&canonicalize(value)).map_err(|err| err.to_string())
}

fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut members: Vec<_> = object.members().iter().collect();
            members.sort_by(|a, b| a.key.cmp(&b.key));
            Value::Object(
                members
                    .into_iter()
                    .map(|member| (member.key.clone(), canonicalize(&member.value)))
                    .collect(),
            )
        }
        Value::Array(items) => Value::Array(items.iter().map(canonicalize).collect()),
        other => other.clone(),
    }
}

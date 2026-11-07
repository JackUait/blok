//! Message shapes Node's SDK refuses before any handler, in its words
//! (measured; see the protocol and http conformance fixtures). rmcp would
//! drop them, answer -32601 or run the call, so they are answered here.

use serde_json::{Value, json};

/// The SDK's HTTP answer to a body that is not a JSON-RPC message.
pub const NOT_A_MESSAGE: &str = "Bad Request: the request body is not a valid JSON-RPC message";

/// What to do with a client message.
#[derive(Debug, PartialEq, Eq)]
pub enum Shaped {
    /// Pass this text on.
    Forward(String),
    /// Node's SDK drops it: no answer over stdio, 400 over HTTP. Holds the id.
    NotAMessage(Value),
    /// This -32602 answer, as the SDK gives it.
    Refused(String),
}

/// params, or params._meta, present and not an object.
fn not_a_message(message: &Value) -> bool {
    match message.get("params") {
        None => false,
        Some(Value::Object(params)) => params.get("_meta").is_some_and(|meta| !meta.is_object()),
        Some(_) => true,
    }
}

// zod's names for a JSON value's type.
fn type_of(value: Option<&Value>) -> &'static str {
    match value {
        None => "undefined",
        Some(Value::Null) => "null",
        Some(Value::Object(_)) => "object",
        Some(Value::Array(_)) => "array",
        Some(Value::String(_)) => "string",
        Some(Value::Number(_)) => "number",
        Some(Value::Bool(_)) => "boolean",
    }
}

fn issue(expected: &str, path: &[&str], received: &str) -> Value {
    json!({
        "expected": expected,
        "code": "invalid_type",
        "path": path,
        "message": format!("Invalid input: expected {expected}, received {received}"),
    })
}

/// The -32602 message Node gives a tools/call with no params, or a bad name
/// or arguments; None when it passes.
fn tools_call_refusal(message: &Value) -> Option<String> {
    let mut issues = Vec::new();
    match message.get("params") {
        Some(Value::Object(call)) => {
            if !call.get("name").is_some_and(Value::is_string) {
                issues.push(issue(
                    "string",
                    &["params", "name"],
                    type_of(call.get("name")),
                ));
            }
            if let Some(arguments) = call.get("arguments").filter(|a| !a.is_object()) {
                issues.push(issue(
                    "record",
                    &["params", "arguments"],
                    type_of(Some(arguments)),
                ));
            }
        }
        other => issues.push(issue("object", &["params"], type_of(other))),
    }
    if issues.is_empty() {
        return None;
    }
    // JSON.stringify(issues, null, 2), as zod's message carries it.
    let text = serde_json::to_string_pretty(&issues).ok()?;
    Some(format!("Invalid tools/call request: {text}"))
}

/// Whether any object in the JSON repeats a key.
struct Repeats(bool);

impl<'de> serde::Deserialize<'de> for Repeats {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Scan;
        impl<'de> serde::de::Visitor<'de> for Scan {
            type Value = Repeats;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("JSON")
            }
            fn visit_bool<E>(self, _: bool) -> Result<Repeats, E> {
                Ok(Repeats(false))
            }
            fn visit_i64<E>(self, _: i64) -> Result<Repeats, E> {
                Ok(Repeats(false))
            }
            fn visit_u64<E>(self, _: u64) -> Result<Repeats, E> {
                Ok(Repeats(false))
            }
            fn visit_f64<E>(self, _: f64) -> Result<Repeats, E> {
                Ok(Repeats(false))
            }
            fn visit_str<E>(self, _: &str) -> Result<Repeats, E> {
                Ok(Repeats(false))
            }
            fn visit_unit<E>(self) -> Result<Repeats, E> {
                Ok(Repeats(false))
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<Repeats, A::Error> {
                let mut found = false;
                while let Some(Repeats(inner)) = seq.next_element()? {
                    found |= inner;
                }
                Ok(Repeats(found))
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut map: A,
            ) -> Result<Repeats, A::Error> {
                let mut keys = std::collections::HashSet::new();
                let mut found = false;
                while let Some(key) = map.next_key::<String>()? {
                    found |= !keys.insert(key);
                    found |= map.next_value::<Repeats>()?.0;
                }
                Ok(Repeats(found))
            }
        }
        deserializer.deserialize_any(Scan)
    }
}

/// Shapes one client message for rmcp.
pub fn shape(text: &str) -> Shaped {
    let Ok(message) = serde_json::from_str::<Value>(text) else {
        return Shaped::Forward(text.to_owned());
    };
    if !message.is_object() {
        return Shaped::Forward(text.to_owned());
    }
    if not_a_message(&message) {
        return Shaped::NotAMessage(message.get("id").cloned().unwrap_or(Value::Null));
    }
    if message.get("method").and_then(Value::as_str) == Some("tools/call")
        && let Some(id) = message.get("id")
        && let Some(refusal) = tools_call_refusal(&message)
    {
        return Shaped::Refused(
            json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32602, "message": refusal } })
                .to_string(),
        );
    }
    // A repeated key: JSON.parse keeps its last value, and rmcp's types
    // refuse it or fall back to an unknown method. The parsed value kept the last.
    if serde_json::from_str::<Repeats>(text).is_ok_and(|r| r.0) {
        return Shaped::Forward(message.to_string());
    }
    Shaped::Forward(text.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn refusal(text: &str) -> String {
        match shape(text) {
            Shaped::Refused(answer) => {
                serde_json::from_str::<Value>(&answer).unwrap()["error"]["message"]
                    .as_str()
                    .unwrap()
                    .to_owned()
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_bad_name_and_arguments_get_zods_words() {
        assert_eq!(
            refusal(
                r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":5,"arguments":"x"}}"#
            ),
            "Invalid tools/call request: [\n  {\n    \"expected\": \"string\",\n    \"code\": \"invalid_type\",\n    \"path\": [\n      \"params\",\n      \"name\"\n    ],\n    \"message\": \"Invalid input: expected string, received number\"\n  },\n  {\n    \"expected\": \"record\",\n    \"code\": \"invalid_type\",\n    \"path\": [\n      \"params\",\n      \"arguments\"\n    ],\n    \"message\": \"Invalid input: expected record, received string\"\n  }\n]"
        );
        assert!(
            refusal(r#"{"jsonrpc":"2.0","id":5,"method":"tools/call"}"#)
                .contains("received undefined")
        );
    }

    #[test]
    fn params_or_meta_not_an_object_is_not_a_message() {
        for text in [
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":"x"}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":null}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"a","_meta":"x"}}"#,
        ] {
            assert_eq!(shape(text), Shaped::NotAMessage(json!(1)), "{text}");
        }
    }

    #[test]
    fn a_repeated_key_keeps_its_last_value() {
        assert_eq!(
            shape(r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"a","name":"b","arguments":{}}}"#),
            Shaped::Forward(r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"b","arguments":{}}}"#.to_owned())
        );
        let fine = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
        assert_eq!(shape(fine), Shaped::Forward(fine.to_owned()));
    }
}

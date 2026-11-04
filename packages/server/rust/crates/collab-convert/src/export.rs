// Only what htmlreader and richtextinput need so far; the export.go port
// adds the rest here.

use std::fmt;

use blok_jsjson::{Object, Str, Value, key_order};

/// C#'s InvalidDataException from the converter: data a reader refuses. The
/// message is C#'s, word for word.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DataError {
    pub message: String,
}

impl DataError {
    pub(crate) fn new(message: impl Into<String>) -> DataError {
        DataError {
            message: message.into(),
        }
    }
}

impl fmt::Display for DataError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for DataError {}

/// One rich field holding HTML, as htmlFieldsToSegments takes it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RichTextHtml {
    pub kind: Str,
    pub field: Str,
    pub html: Str,
}

fn number_node(number: f64) -> Value {
    if number.is_finite() {
        Value::Number(number)
    } else {
        Value::Null
    }
}

/// The .NET type name C# RichText.ToJsonNode puts in its refusal.
fn csharp_type_name(value: &Value) -> &'static str {
    match value {
        Value::Undefined => "YUndefined",
        Value::BigInt(_) => "BigInteger",
        Value::Bytes(_) => "Byte[]",
        _ => "Object",
    }
}

/// C# RichText.ToJson: each item through `to_json_node`.
pub(crate) fn to_json_array(items: &[Value]) -> Result<Vec<Value>, DataError> {
    items.iter().map(to_json_node).collect()
}

/// C# RichText.ToJsonNode: keys in JS order, undefined members dropped,
/// non-finite numbers null.
pub(crate) fn to_json_node(value: &Value) -> Result<Value, DataError> {
    Ok(match value {
        Value::Null => Value::Null,
        Value::String(_) | Value::Bool(_) => value.clone(),
        Value::Number(number) => number_node(*number),
        Value::Array(items) => Value::Array(to_json_array(items)?),
        Value::Object(object) => {
            let mut result = Object::new();
            for member in key_order(object.members()) {
                if matches!(member.value, Value::Undefined) {
                    continue;
                }
                result.set(member.key.clone(), to_json_node(&member.value)?);
            }
            Value::Object(result)
        }
        other => {
            return Err(DataError::new(format!(
                "collab: unsupported value {} in rich text.",
                csharp_type_name(other)
            )));
        }
    })
}

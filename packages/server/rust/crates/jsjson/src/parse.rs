use crate::error::Error;
use crate::node::{Kind, Node, Options, decode_js, parse_node};
use crate::value::{Object, Value};

/// The depth C# validates JSON.parse input at (YContent.JsonLimits); a
/// browser has no limit.
pub const PARSE_MAX_DEPTH: usize = 512;

/// JSON.parse as C# JsJson.Parse does it: refused past depth 512, every
/// number an f64, a repeated key keeps its first place and last value, and
/// an escaped lone surrogate stays one.
pub fn parse(data: &[u8]) -> Result<Value, Error> {
    let node = parse_node(
        data,
        Options {
            max_depth: PARSE_MAX_DEPTH,
            refuse_duplicates: false,
        },
    )?;
    Ok(node.js())
}

impl Node {
    pub(crate) fn js(&self) -> Value {
        match self.kind {
            Kind::Null => Value::Null,
            Kind::True => Value::Bool(true),
            Kind::False => Value::Bool(false),
            // Out of range reads as ±Infinity or 0, as in JS.
            Kind::Number => Value::Number(
                std::str::from_utf8(self.raw())
                    .ok()
                    .and_then(|text| text.parse().ok())
                    .expect("validated number parses"),
            ),
            Kind::String => Value::String(decode_js(self.raw()).0),
            Kind::Array => Value::Array(self.items.iter().map(Node::js).collect()),
            Kind::Object => {
                let mut object = Object::default();
                for member in &self.members {
                    object.set(decode_js(member.raw()).0, member.value.js());
                }
                Value::Object(object)
            }
        }
    }
}

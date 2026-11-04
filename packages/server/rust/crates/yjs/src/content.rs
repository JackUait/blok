use std::sync::{Arc, OnceLock};

use blok_jsjson::{Options, Str, Value};
use blok_lib0::Writer;

use crate::types::{Out, TypeRef};
use crate::{EngineResult, FormatError, JSON_MAX_DEPTH, fail, format_err};

/// An item's payload, one of the nine kinds 1..9 (the wire's content ref).
#[derive(Clone, Debug)]
pub enum Content {
    /// 1: a tombstone that keeps its length.
    Deleted(usize),
    /// 2: legacy JSON content, kept as the wire's raw strings. "undefined"
    /// is yjs's sentinel, not JSON.
    Json(Vec<Str>),
    /// 3: one opaque byte array.
    Binary(Arc<Vec<u8>>),
    /// 4: Y.Text's characters, one tick per UTF-16 unit.
    String(Str),
    /// 5: one embedded value in a Y.Text, kept as raw JSON.
    Embed(Arc<Str>),
    /// 6: a formatting mark. It occupies a tick and counts for nothing.
    Format(Arc<FormatContent>),
    /// 7: a nested shared type.
    Type(TypeRef),
    /// 8: a run of Any values, one tick each.
    Any(Vec<Value>),
    /// 9: a subdocument.
    Doc(Arc<Subdoc>),
}

/// A formatting mark: a key and a raw JSON value.
#[derive(Debug)]
pub struct FormatContent {
    pub key: Str,
    pub json: Str,
    // Parsed once per item: yjs compares marks with ===, which for an object
    // is identity.
    value: OnceLock<Arc<Value>>,
}

impl FormatContent {
    pub fn new(key: Str, json: Str) -> FormatContent {
        FormatContent {
            key,
            json,
            value: OnceLock::new(),
        }
    }

    pub(crate) fn local(key: Str, value: Arc<Value>) -> EngineResult<FormatContent> {
        let text = match blok_jsjson::stringify(&value) {
            Ok(text) => text,
            Err(err) => fail!("{err}"),
        };
        let content = FormatContent::new(key, Str::from(text));
        let _ = content.value.set(value);
        Ok(content)
    }

    /// The parsed mark value.
    pub fn value(&self) -> Arc<Value> {
        self.value
            .get_or_init(|| Arc::new(parse_validated(&self.json)))
            .clone()
    }
}

/// A subdocument as a value: opaque, never a string.
#[derive(Clone, Debug, PartialEq)]
pub struct Subdoc {
    pub guid: Str,
    pub options: Value,
}

impl Content {
    /// The wire's content ref.
    pub fn ref_number(&self) -> u8 {
        match self {
            Content::Deleted(_) => 1,
            Content::Json(_) => 2,
            Content::Binary(_) => 3,
            Content::String(_) => 4,
            Content::Embed(_) => 5,
            Content::Format(_) => 6,
            Content::Type(_) => 7,
            Content::Any(_) => 8,
            Content::Doc(_) => 9,
        }
    }

    /// How many clock ticks the content occupies.
    pub fn len(&self) -> usize {
        match self {
            Content::Deleted(ticks) => *ticks,
            Content::Json(raw) => raw.len(),
            Content::String(text) => text.len(),
            Content::Any(items) => items.len(),
            _ => 1,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// False for tombstones and formatting marks.
    pub fn countable(&self) -> bool {
        !matches!(self, Content::Deleted(_) | Content::Format(_))
    }

    /// One value per tick, or none for content that holds none.
    pub fn values(&self) -> Vec<Out> {
        match self {
            Content::Deleted(_) | Content::Format(_) => Vec::new(),
            Content::Json(raw) => raw
                .iter()
                .map(|raw| {
                    if raw.units() == UNDEFINED {
                        Out::Any(Value::Undefined)
                    } else {
                        Out::Any(parse_validated(raw))
                    }
                })
                .collect(),
            Content::Binary(bytes) => vec![Out::Any(Value::Bytes(bytes.to_vec()))],
            // One unit per tick, so an astral character reads back as its
            // two halves.
            Content::String(text) => text
                .iter()
                .map(|&unit| Out::Any(Value::String(Str(vec![unit]))))
                .collect(),
            Content::Embed(json) => vec![Out::Any(parse_validated(json))],
            Content::Type(handle) => vec![Out::Type(handle.clone())],
            Content::Any(items) => items.iter().cloned().map(Out::Any).collect(),
            Content::Doc(doc) => vec![Out::Subdoc((**doc).clone())],
        }
    }

    /// The value at one tick, without building the rest.
    pub(crate) fn value_at(&self, index: usize) -> Option<Out> {
        match self {
            Content::Any(items) => items.get(index).cloned().map(Out::Any),
            Content::String(text) => text
                .get(index)
                .map(|&unit| Out::Any(Value::String(Str(vec![unit])))),
            _ => self.values().into_iter().nth(index),
        }
    }

    pub(crate) fn write(&self, w: &mut Writer, offset: usize) {
        match self {
            Content::Deleted(ticks) => w.write_var_uint((ticks - offset) as u64),
            Content::Json(raw) => {
                w.write_var_uint((raw.len() - offset) as u64);
                for raw in &raw[offset..] {
                    w.write_var_string(raw);
                }
            }
            Content::Binary(bytes) => w.write_var_bytes(bytes),
            Content::String(text) => w.write_var_string(&text[offset..]),
            Content::Embed(json) => w.write_var_string(json),
            Content::Format(format) => {
                w.write_var_string(&format.key);
                w.write_var_string(&format.json);
            }
            Content::Type(handle) => {
                w.write_var_uint(u64::from(handle.kind().ref_number()));
                if let Some(name) = handle.name() {
                    w.write_var_string(name);
                }
            }
            Content::Any(items) => {
                w.write_var_uint((items.len() - offset) as u64);
                for item in &items[offset..] {
                    blok_lib0::write_any(w, item);
                }
            }
            Content::Doc(doc) => {
                w.write_var_string(&doc.guid);
                blok_lib0::write_any(w, &doc.options);
            }
        }
    }

    /// Cuts the content at offset, keeps the left part and returns the right.
    pub(crate) fn splice(&mut self, offset: usize) -> EngineResult<Content> {
        match self {
            Content::Deleted(ticks) => {
                let right = Content::Deleted(*ticks - offset);
                *ticks = offset;
                Ok(right)
            }
            Content::Json(raw) => Ok(Content::Json(raw.split_off(offset))),
            Content::Any(items) => Ok(Content::Any(items.split_off(offset))),
            // Both halves of a split surrogate pair become U+FFFD, keeping
            // each side's unit count.
            Content::String(text) => {
                let mut right = Str(text.0.split_off(offset));
                if offset > 0 && is_high_surrogate(text[offset - 1]) {
                    text.0[offset - 1] = 0xfffd;
                    if right.is_empty() {
                        right.0.push(0xfffd);
                    } else {
                        right.0[0] = 0xfffd;
                    }
                }
                Ok(Content::String(right))
            }
            other => fail!(
                "yjs: content ref {} occupies one tick and cannot be split.",
                other.ref_number()
            ),
        }
    }

    /// The copy a decoded update hands to the runtime, so it can be applied
    /// again. A nested type is always a fresh one.
    pub(crate) fn copy(&self) -> Content {
        match self {
            Content::Type(handle) => {
                Content::Type(TypeRef::new_detached(handle.kind(), handle.name().cloned()))
            }
            other => other.clone(),
        }
    }
}

const UNDEFINED: &[u16] = &[
    b'u' as u16,
    b'n' as u16,
    b'd' as u16,
    b'e' as u16,
    b'f' as u16,
    b'i' as u16,
    b'n' as u16,
    b'e' as u16,
    b'd' as u16,
];

pub(crate) fn is_undefined_sentinel(raw: &Str) -> bool {
    raw.units() == UNDEFINED
}

fn is_high_surrogate(unit: u16) -> bool {
    (0xd800..=0xdbff).contains(&unit)
}

/// Parses JSON the decoder already validated with the same options
/// (`blok_jsjson::parse` reads at depth 512 and keeps repeated keys).
pub(crate) fn parse_validated(raw: &Str) -> Value {
    blok_jsjson::parse(blok_jsjson::to_string_lossy(raw).as_bytes()).expect("validated JSON parses")
}

/// Refuses a payload no yjs peer's JSON.parse would read.
pub(crate) fn validate_json(raw: &Str, position: usize, what: &str) -> Result<(), FormatError> {
    let options = Options {
        max_depth: JSON_MAX_DEPTH,
        refuse_duplicates: false,
    };
    match blok_jsjson::parse_node(blok_jsjson::to_string_lossy(raw).as_bytes(), options) {
        Ok(_) => Ok(()),
        Err(err) => Err(format_err!(
            "yjs: the {what} at {position} is not JSON: {err}"
        )),
    }
}

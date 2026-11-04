use std::collections::HashMap;

use crate::error::{Error, ErrorKind};
use crate::number::format_number;
use crate::str::{Str, is_high, is_low};

/// A JS value, plus the two lib0 Any kinds JSON cannot write (`BigInt`,
/// `Bytes`); `stringify` refuses those with `NoJsonForm`, as Go does.
#[derive(Debug, Clone, PartialEq, Default)]
pub enum Value {
    /// JSON.stringify skips it as an object member, writes it as null in an
    /// array, and writes nothing for it at the top.
    Undefined,
    #[default]
    Null,
    Bool(bool),
    Number(f64),
    String(Str),
    Object(Object),
    Array(Vec<Value>),
    /// A peer's bigint (lib0 tag 122).
    BigInt(i64),
    /// A Uint8Array (lib0 tag 116).
    Bytes(Vec<u8>),
}

/// One own property of an [`Object`].
#[derive(Debug, Clone, PartialEq)]
pub struct Member<V = Value> {
    pub key: Str,
    pub value: V,
}

/// A JS object's own string keys in insertion order. Generic so callers
/// can hold their own value kinds in the same shape.
#[derive(Debug, Clone)]
pub struct Object<V = Value> {
    members: Vec<Member<V>>,
    index: HashMap<Str, usize>,
}

impl<V> Default for Object<V> {
    fn default() -> Self {
        Object {
            members: Vec::new(),
            index: HashMap::new(),
        }
    }
}

impl<V: PartialEq> PartialEq for Object<V> {
    fn eq(&self, other: &Self) -> bool {
        self.members == other.members
    }
}

impl<V> Object<V> {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds key at the end, or replaces its value in place when it exists.
    pub fn set(&mut self, key: Str, value: V) {
        if let Some(&at) = self.index.get(&key) {
            self.members[at].value = value;
            return;
        }
        self.index.insert(key.clone(), self.members.len());
        self.members.push(Member { key, value });
    }

    pub fn get(&self, key: &Str) -> Option<&V> {
        self.index.get(key).map(|&at| &self.members[at].value)
    }

    pub fn get_mut(&mut self, key: &Str) -> Option<&mut V> {
        self.index.get(key).map(|&at| &mut self.members[at].value)
    }

    pub fn len(&self) -> usize {
        self.members.len()
    }

    pub fn is_empty(&self) -> bool {
        self.members.is_empty()
    }

    /// The members in insertion order.
    pub fn members(&self) -> &[Member<V>] {
        &self.members
    }

    /// Values only: keys stay fixed so the index stays right.
    pub fn values_mut(&mut self) -> impl Iterator<Item = &mut V> {
        self.members.iter_mut().map(|member| &mut member.value)
    }

    pub fn into_members(self) -> Vec<Member<V>> {
        self.members
    }
}

impl<V> FromIterator<(Str, V)> for Object<V> {
    fn from_iter<I: IntoIterator<Item = (Str, V)>>(iter: I) -> Self {
        let mut object = Object::default();
        for (key, value) in iter {
            object.set(key, value);
        }
        object
    }
}

/// The order JS gives own string keys: array indexes (canonical integers
/// below 2^32-1) ascending, then the rest in insertion order.
pub fn key_order<V>(members: &[Member<V>]) -> Vec<&Member<V>> {
    let mut indexes: Vec<(u32, &Member<V>)> = Vec::new();
    let mut rest = Vec::new();
    for member in members {
        match array_index(&member.key) {
            Some(index) => indexes.push((index, member)),
            None => rest.push(member),
        }
    }
    indexes.sort_by_key(|entry| entry.0);
    let mut ordered: Vec<&Member<V>> = indexes.into_iter().map(|entry| entry.1).collect();
    ordered.extend(rest);
    ordered
}

fn array_index(key: &[u16]) -> Option<u32> {
    if key.is_empty() || key.len() > 10 || (key.len() > 1 && key[0] == u16::from(b'0')) {
        return None;
    }
    let mut value: u64 = 0;
    for &unit in key {
        if !(u16::from(b'0')..=u16::from(b'9')).contains(&unit) {
            return None;
        }
        value = value * 10 + u64::from(unit - u16::from(b'0'));
    }
    if value >= (1 << 32) - 1 {
        return None;
    }
    Some(value as u32)
}

/// JSON.stringify.
pub fn stringify(value: &Value) -> Result<String, Error> {
    if matches!(value, Value::Undefined) {
        return Err(Error::new(
            ErrorKind::NoJsonForm,
            "JSON.stringify(undefined) writes nothing",
        ));
    }
    let mut out = String::new();
    append_js(&mut out, value)?;
    Ok(out)
}

fn append_js(dst: &mut String, value: &Value) -> Result<(), Error> {
    match value {
        Value::Null => dst.push_str("null"),
        Value::Bool(true) => dst.push_str("true"),
        Value::Bool(false) => dst.push_str("false"),
        Value::Number(number) => dst.push_str(&format_number(*number)),
        Value::String(s) => append_js_quoted(dst, s),
        Value::Object(object) => {
            dst.push('{');
            let mut first = true;
            for member in key_order(object.members()) {
                if matches!(member.value, Value::Undefined) {
                    continue;
                }
                if !first {
                    dst.push(',');
                }
                first = false;
                append_js_quoted(dst, &member.key);
                dst.push(':');
                append_js(dst, &member.value)?;
            }
            dst.push('}');
        }
        Value::Array(items) => {
            dst.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    dst.push(',');
                }
                match item {
                    Value::Undefined => dst.push_str("null"),
                    item => append_js(dst, item)?,
                }
            }
            dst.push(']');
        }
        Value::Undefined => {
            return Err(Error::new(ErrorKind::NoJsonForm, "undefined"));
        }
        Value::BigInt(_) => return Err(Error::new(ErrorKind::NoJsonForm, "BigInt")),
        Value::Bytes(_) => return Err(Error::new(ErrorKind::NoJsonForm, "bytes")),
    }
    Ok(())
}

const LOWER_HEX: &[u8; 16] = b"0123456789abcdef";
pub(crate) const UPPER_HEX: &[u8; 16] = b"0123456789ABCDEF";

pub(crate) fn hex_escape(unit: u16, digits: &[u8; 16]) -> [u8; 6] {
    [
        b'\\',
        b'u',
        digits[usize::from(unit >> 12)],
        digits[usize::from(unit >> 8 & 0xf)],
        digits[usize::from(unit >> 4 & 0xf)],
        digits[usize::from(unit & 0xf)],
    ]
}

pub(crate) fn short_escape(unit: u16) -> Option<&'static str> {
    match unit {
        0x08 => Some("\\b"),
        0x0c => Some("\\f"),
        0x0a => Some("\\n"),
        0x0d => Some("\\r"),
        0x09 => Some("\\t"),
        _ => None,
    }
}

/// QuoteJSONString: the short escapes, other controls and lone surrogates
/// as lowercase \uxxxx, everything else raw.
fn append_js_quoted(dst: &mut String, s: &[u16]) {
    let push_hex = |dst: &mut String, unit: u16| {
        dst.push_str(std::str::from_utf8(&hex_escape(unit, LOWER_HEX)).expect("ASCII"));
    };
    dst.push('"');
    let mut i = 0;
    while i < s.len() {
        let unit = s[i];
        if unit == u16::from(b'"') {
            dst.push_str("\\\"");
        } else if unit == u16::from(b'\\') {
            dst.push_str("\\\\");
        } else if unit < 0x20 {
            match short_escape(unit) {
                Some(short) => dst.push_str(short),
                None => push_hex(dst, unit),
            }
        } else if is_high(unit) && i + 1 < s.len() && is_low(s[i + 1]) {
            let pair = char::decode_utf16([unit, s[i + 1]])
                .next()
                .and_then(Result::ok)
                .expect("surrogate pair");
            dst.push(pair);
            i += 1;
        } else if is_high(unit) || is_low(unit) {
            push_hex(dst, unit);
        } else {
            dst.push(char::from_u32(u32::from(unit)).expect("BMP scalar"));
        }
        i += 1;
    }
    dst.push('"');
}

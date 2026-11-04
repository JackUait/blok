//! Rich text segments ({text|embed, marks}) and the Y.XmlText delta, in the
//! client's canonical form (C# RichText.cs, client rich-text.ts). The export,
//! the echo check and the edit no-op check compare this form as JSON text.

use blok_jsjson::{Member, Object, Str, Value, compare, stringify};
use blok_yjs::{Delta, Out};

use crate::export::DataError;

const MARK_ORDER: &[&str] = &[
    "link",
    "color",
    "background",
    "highlight",
    "bold",
    "italic",
    "underline",
    "strikethrough",
    "code",
    "sup",
    "sub",
];

const BOOLEAN_MARKS: &[&str] = &[
    "highlight",
    "bold",
    "italic",
    "underline",
    "strikethrough",
    "code",
    "sup",
    "sub",
];

/// One insert that builds a formatted text from canonical segments.
#[derive(Clone, Debug, PartialEq)]
pub struct WriteOp {
    /// A string, or an embed object.
    pub insert: Value,
    pub attributes: Object,
}

impl WriteOp {
    /// The op's length in Y.Text units.
    pub fn length(&self) -> usize {
        match &self.insert {
            Value::String(text) => text.len(),
            _ => 1,
        }
    }
}

pub(crate) fn is(key: &[u16], name: &str) -> bool {
    key.iter().copied().eq(name.encode_utf16())
}

fn is_one_of(key: &[u16], names: &[&str]) -> bool {
    names.iter().any(|name| is(key, name))
}

pub(crate) fn lookup<'a>(object: &'a Object, key: &str) -> Option<&'a Value> {
    object.get(&Str::from(key))
}

fn put(object: &mut Object, key: &str, value: Value) {
    object.set(Str::from(key), value);
}

/// A value already in segment shape.
pub fn is_rich_text(value: &[Value]) -> bool {
    value.iter().all(is_segment)
}

/// Segments a host sent, read leniently, in canonical form.
pub fn read_input(value: &[Value]) -> Vec<Value> {
    let lenient;
    let segments = if is_rich_text(value) {
        value
    } else {
        lenient = read_leniently(value);
        &lenient
    };
    let kept: Vec<Value> = segments.iter().map(drop_unknown_marks).collect();
    canonicalize(&kept)
}

/// Keeps only content and known marks in order, drops empty text and merges
/// neighbouring runs with the same marks.
pub fn canonicalize(segments: &[Value]) -> Vec<Value> {
    let mut result: Vec<Object> = Vec::new();
    for item in segments {
        let Value::Object(raw) = item else {
            continue;
        };
        let mut segment = Object::new();
        if let Some(content) = text_of(raw) {
            put(&mut segment, "text", Value::String(content.clone()));
        } else if let Some(embed) = lookup(raw, "embed")
            && is_embed(embed)
        {
            put(&mut segment, "embed", embed.clone());
        } else {
            continue;
        }
        let empty = Object::new();
        let record = match lookup(raw, "marks") {
            Some(Value::Object(record)) => record,
            _ => &empty,
        };
        if let Some(ordered) = order_marks(record) {
            put(&mut segment, "marks", Value::Object(ordered));
        }
        if let Some(text) = text_of(&segment) {
            if text.is_empty() {
                continue;
            }
            if let Some(last) = result.last_mut()
                && let Some(previous) = text_of(last)
                && same_marks(last, &segment)
            {
                let mut joined = previous.clone();
                joined.extend_from_slice(text);
                let mut merged = last.clone();
                put(&mut merged, "text", Value::String(joined));
                *last = merged;
                continue;
            }
        }
        result.push(segment);
    }
    result.into_iter().map(Value::Object).collect()
}

/// A live delta as canonical segments. It never changes the delta.
pub fn from_delta(delta: &[Delta]) -> Vec<Value> {
    let mut segments = Vec::new();
    for op in delta {
        let mut segment = Object::new();
        match &op.insert {
            Out::Any(Value::String(text)) => put(&mut segment, "text", Value::String(text.clone())),
            Out::Any(embed @ Value::Object(_)) if is_embed(embed) => {
                put(&mut segment, "embed", embed.clone())
            }
            _ => continue,
        }
        if let Some(attributes) = &op.attributes
            && !attributes.is_empty()
        {
            put(&mut segment, "marks", Value::Object(attributes.clone()));
        }
        segments.push(Value::Object(segment));
    }
    canonicalize(&segments)
}

/// One insert per canonical segment, with normalised marks.
pub fn to_write_ops(canonical: &[Value]) -> Result<Vec<WriteOp>, DataError> {
    canonical
        .iter()
        .map(|item| {
            let segment = match item {
                Value::Object(segment) => segment,
                _ => return Err(neither_text_nor_embed()),
            };
            let insert = if let Some(text) = text_of(segment) {
                Value::String(text.clone())
            } else if let Some(embed) = lookup(segment, "embed") {
                embed.clone()
            } else {
                return Err(neither_text_nor_embed());
            };
            Ok(WriteOp {
                insert,
                attributes: normalize(lookup(segment, "marks")),
            })
        })
        .collect()
}

fn neither_text_nor_embed() -> DataError {
    DataError::new("collab: a rich text segment has neither text nor embed.")
}

/// The marks a write carries: keys sorted, undefined dropped, NUL removed.
/// Absent or not an object gives an empty object.
pub fn normalize(marks: Option<&Value>) -> Object {
    match marks.map(normalize_value) {
        Some(Value::Object(record)) => record,
        _ => Object::new(),
    }
}

/// A copy of value with NUL removed from every string and key, undefined
/// members dropped and object keys in UTF-16 order.
pub fn normalize_value(value: &Value) -> Value {
    match value {
        Value::String(text) => Value::String(without_nul(text)),
        Value::Array(items) => Value::Array(items.iter().map(normalize_value).collect()),
        Value::Object(record) => {
            let mut entries: Vec<(Str, &Value)> = record
                .members()
                .iter()
                .filter(|m| !matches!(m.value, Value::Undefined))
                .map(|m| (without_nul(&m.key), &m.value))
                .collect();
            // Stable: keys that only differ by NUL collide, and the later
            // one must replace the earlier in place, as C# and Go do.
            entries.sort_by(|a, b| compare(&a.0, &b.0));
            let mut normalized = Object::new();
            for (key, child) in entries {
                normalized.set(key, normalize_value(child));
            }
            Value::Object(normalized)
        }
        other => other.clone(),
    }
}

pub(crate) fn without_nul(text: &[u16]) -> Str {
    Str::from(
        text.iter()
            .copied()
            .filter(|&unit| unit != 0)
            .collect::<Vec<u16>>(),
    )
}

/// Marks ordered the canonical way, or None when none survive.
pub fn canonical_marks(marks: Option<&Object>) -> Option<Object> {
    order_marks(marks?)
}

/// Equal as JSON text with object keys sorted, arrays included.
pub fn same_value(left: &Value, right: &Value) -> bool {
    same_text(&sort_deep(left, true), &sort_deep(right, true))
}

fn same_text(left: &Value, right: &Value) -> bool {
    matches!((stringify(left), stringify(right)), (Ok(a), Ok(b)) if a == b)
}

fn text_of(segment: &Object) -> Option<&Str> {
    match lookup(segment, "text") {
        Some(Value::String(text)) => Some(text),
        _ => None,
    }
}

fn is_segment(item: &Value) -> bool {
    let Value::Object(record) = item else {
        return false;
    };
    let text = lookup(record, "text");
    let embed = lookup(record, "embed");
    if text.is_some() && embed.is_some() {
        return false;
    }
    if let Some(marks) = lookup(record, "marks")
        && !matches!(marks, Value::Object(_))
    {
        return false;
    }
    if matches!(text, Some(Value::String(_))) && has_only_keys(record, "text") {
        return true;
    }
    embed.is_some_and(is_embed) && has_only_keys(record, "embed")
}

fn present(record: &Object) -> Vec<&Member> {
    record
        .members()
        .iter()
        .filter(|m| !matches!(m.value, Value::Undefined))
        .collect()
}

fn is_embed(value: &Value) -> bool {
    let Value::Object(embed) = value else {
        return false;
    };
    let [only] = present(embed)[..] else {
        return false;
    };
    if is(&only.key, "html") {
        matches!(only.value, Value::String(_))
    } else if is(&only.key, "equation") {
        has_one_string(&only.value, "expression")
    } else if is(&only.key, "page") {
        has_one_string(&only.value, "id")
    } else {
        false
    }
}

fn has_one_string(value: &Value, key: &str) -> bool {
    let Value::Object(record) = value else {
        return false;
    };
    matches!(present(record)[..], [only] if is(&only.key, key) && matches!(only.value, Value::String(_)))
}

fn has_only_keys(record: &Object, shape_key: &str) -> bool {
    record.members().iter().all(|m| {
        is(&m.key, shape_key) || is(&m.key, "marks") || matches!(m.value, Value::Undefined)
    })
}

fn read_leniently(value: &[Value]) -> Vec<Value> {
    let mut segments = Vec::new();
    for item in value {
        let Value::Object(record) = item else {
            continue;
        };
        let mut segment = Object::new();
        match lookup(record, "text") {
            Some(text @ Value::String(_)) => put(&mut segment, "text", text.clone()),
            _ => {
                if !put_embed(&mut segment, record) {
                    continue;
                }
            }
        }
        if let Some(marks @ Value::Object(_)) = lookup(record, "marks") {
            put(&mut segment, "marks", marks.clone());
        }
        segments.push(Value::Object(segment));
    }
    segments
}

fn put_embed(segment: &mut Object, record: &Object) -> bool {
    match lookup(record, "embed") {
        Some(embed) if is_embed(embed) => {
            put(segment, "embed", embed.clone());
            true
        }
        _ => false,
    }
}

/// segments-to-html.ts's tag name rule: ASCII, like JS /i.
fn is_safe_tag_name(name: &[u16]) -> bool {
    let letter = |c: u16| u8::try_from(c).is_ok_and(|c| c.is_ascii_alphabetic());
    let rest = |c: u16| u8::try_from(c).is_ok_and(|c| c.is_ascii_alphanumeric() || c == b'-');
    match name.split_first() {
        Some((&first, tail)) => letter(first) && tail.iter().all(|&c| rest(c)),
        None => false,
    }
}

fn drop_unknown_marks(item: &Value) -> Value {
    let Value::Object(segment) = item else {
        return item.clone();
    };
    let Some(Value::Object(record)) = lookup(segment, "marks") else {
        return item.clone();
    };
    let mut kept = Object::new();
    for m in record.members() {
        let keep = match tag_name(&m.key) {
            Some(tag) => is_safe_tag_name(tag),
            None => is_one_of(&m.key, MARK_ORDER),
        };
        if keep {
            kept.set(m.key.clone(), m.value.clone());
        }
    }
    let mut result = Object::new();
    for m in segment.members() {
        if is(&m.key, "marks") {
            result.set(m.key.clone(), Value::Object(kept.clone()));
        } else {
            result.set(m.key.clone(), m.value.clone());
        }
    }
    Value::Object(result)
}

/// The name after "tag:", compared by units.
fn tag_name(key: &[u16]) -> Option<&[u16]> {
    const PREFIX: [u16; 4] = [b't' as u16, b'a' as u16, b'g' as u16, b':' as u16];
    key.strip_prefix(&PREFIX[..])
}

fn order_marks(record: &Object) -> Option<Object> {
    let mut unknown: Vec<&Str> = record
        .members()
        .iter()
        .map(|m| &m.key)
        .filter(|key| !is_one_of(key, MARK_ORDER))
        .collect();
    unknown.sort_by(|a, b| compare(a, b));
    let mut keys: Vec<Str> = MARK_ORDER.iter().map(|&key| Str::from(key)).collect();
    keys.extend(unknown.into_iter().cloned());
    let mut ordered = Object::new();
    for key in keys {
        let Some(raw) = record.get(&key) else {
            continue;
        };
        if let Some(value) = mark_value(&key, raw) {
            ordered.set(key, value);
        }
    }
    (!ordered.is_empty()).then_some(ordered)
}

fn mark_value(key: &[u16], raw: &Value) -> Option<Value> {
    if matches!(raw, Value::Undefined) {
        return None;
    }
    if is(key, "link") {
        let Value::Object(link) = raw else {
            return None;
        };
        let href @ Value::String(_) = lookup(link, "href")? else {
            return None;
        };
        let mut canonical = Object::new();
        put(&mut canonical, "href", href.clone());
        for extra in ["target", "rel"] {
            if let Some(value @ Value::String(_)) = lookup(link, extra) {
                put(&mut canonical, extra, value.clone());
            }
        }
        return Some(Value::Object(canonical));
    }
    if is_one_of(key, BOOLEAN_MARKS) {
        return matches!(raw, Value::Bool(true)).then_some(Value::Bool(true));
    }
    if matches!(raw, Value::Null) {
        return None;
    }
    // The client's HTML writer escapes these with string calls.
    if is(key, "color") || is(key, "background") {
        return matches!(raw, Value::String(_)).then(|| raw.clone());
    }
    if tag_name(key).is_some() {
        let Value::Object(attributes) = raw else {
            return None;
        };
        let mut members: Vec<&Member> = attributes
            .members()
            .iter()
            .filter(|m| matches!(m.value, Value::String(_)))
            .collect();
        members.sort_by(|a, b| compare(&a.key, &b.key));
        return Some(Value::Object(
            members
                .into_iter()
                .map(|m| (m.key.clone(), m.value.clone()))
                .collect(),
        ));
    }
    Some(raw.clone())
}

fn same_marks(left: &Object, right: &Object) -> bool {
    let marks = |segment: &Object| match lookup(segment, "marks") {
        None | Some(Value::Null) => Value::Object(Object::new()),
        Some(marks) => sort_deep(marks, false),
    };
    same_text(&marks(left), &marks(right))
}

fn sort_deep(value: &Value, into_arrays: bool) -> Value {
    match value {
        Value::Object(record) => {
            let mut members: Vec<&Member> = record.members().iter().collect();
            members.sort_by(|a, b| compare(&a.key, &b.key));
            Value::Object(
                members
                    .into_iter()
                    .map(|m| (m.key.clone(), sort_deep(&m.value, into_arrays)))
                    .collect(),
            )
        }
        Value::Array(items) if into_arrays => Value::Array(
            items
                .iter()
                .map(|item| sort_deep(item, into_arrays))
                .collect(),
        ),
        other => other.clone(),
    }
}

use std::collections::HashSet;

use blok_jsjson::{Kind, Node, Object, Str, Value};
use blok_yjs::{Array, Doc, In, Map, MapEntry, XmlText};

use crate::editops::member;
use crate::error::Error;
use crate::export::{
    BLOCK_FIELD_DEPTH, BLOCKS_ROOT, DataError, GRID_ORDER_KEY, GRID_ROWS_KEY, MAX_VALUE_DEPTH,
    ORDER_ROOT, PAGE_ROOT, RichTextHtml, is_page_icon,
};
use crate::fields::RichTextFields;
use crate::keys::{DIFFABLE_TEXT_KEYS, ORDERED_ID_ARRAY_KEYS};
use crate::richtext::{is, read_input, to_write_ops};
use crate::richtextinput::RichTextInput;

// Seed input is read the System.Text.Json way (Node), then turned into JS
// values one block at a time: a string .NET cannot read fails when its
// block is read, as GetValue<string> fails in C#.

/// The length of a minted grid row key.
pub const ROW_KEY_LENGTH: usize = 10;
const LIST_SLOT_MAP_KEY: &str = "properties";
// nanoid's default alphabet; keys are random so two peers never collide.
const ROW_KEY_ALPHABET: &[u8; 64] =
    b"useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

/// Request JSON as JS values (Go's `any` from strictValue/editValue).
#[derive(Clone, Debug, PartialEq)]
pub enum SourceValue {
    Null,
    Bool(bool),
    Number(f64),
    /// A number read for an edit, keeping its text (Go sourceNumber).
    Source(SourceNumber),
    String(Str),
    Array(Vec<SourceValue>),
    Object(Object<SourceValue>),
    /// A JS value JSON has no form for (undefined, bigint, bytes). The
    /// conversion refuses it where its walk meets it, so an earlier refusal
    /// keeps its message.
    Unsupported,
}

/// A request number and its text. .NET's DeepEquals compares a live
/// integer to it by exact decimal value, a live double by GetDouble.
#[derive(Clone, Debug, PartialEq)]
pub struct SourceNumber {
    pub value: f64,
    pub raw: Vec<u8>,
}

impl From<&Value> for SourceValue {
    fn from(value: &Value) -> SourceValue {
        match value {
            Value::Null => SourceValue::Null,
            Value::Bool(flag) => SourceValue::Bool(*flag),
            Value::Number(number) => SourceValue::Number(*number),
            Value::String(text) => SourceValue::String(text.clone()),
            Value::Array(items) => {
                SourceValue::Array(items.iter().map(SourceValue::from).collect())
            }
            Value::Object(object) => SourceValue::Object(source_object(object)),
            Value::Undefined | Value::BigInt(_) | Value::Bytes(_) => SourceValue::Unsupported,
        }
    }
}

/// A JS-values object as source values.
pub fn source_object(object: &Object) -> Object<SourceValue> {
    object
        .members()
        .iter()
        .map(|m| (m.key.clone(), SourceValue::from(&m.value)))
        .collect()
}

/// Mints a grid row key.
pub fn generate_row_key() -> Str {
    #[cfg(test)]
    if let Some(key) = ROW_KEYS.with(|keys| keys.borrow_mut().as_mut().map(|next| next())) {
        return key;
    }
    let mut b = [0u8; ROW_KEY_LENGTH];
    getrandom::fill(&mut b).expect("the OS random source failed");
    // 64 letters, so the low six bits pick one uniformly.
    b.iter()
        .map(|byte| u16::from(ROW_KEY_ALPHABET[usize::from(byte & 63)]))
        .collect::<Vec<u16>>()
        .into()
}

#[cfg(test)]
type RowKeySource = Box<dyn FnMut() -> Str>;

#[cfg(test)]
thread_local! {
    static ROW_KEYS: std::cell::RefCell<Option<RowKeySource>> = const { std::cell::RefCell::new(None) };
}

/// Restores the previous row-key source on drop.
#[cfg(test)]
pub(crate) struct RowKeys(Option<RowKeySource>);

#[cfg(test)]
impl Drop for RowKeys {
    fn drop(&mut self) {
        let previous = self.0.take();
        ROW_KEYS.with(|keys| *keys.borrow_mut() = previous);
    }
}

/// Go's `GenerateRowKey = ...` in a test: this thread mints from next until
/// the guard drops.
#[cfg(test)]
pub(crate) fn replace_row_keys(next: impl FnMut() -> Str + 'static) -> RowKeys {
    RowKeys(ROW_KEYS.with(|keys| keys.borrow_mut().replace(Box::new(next))))
}

/// A Node as JS values, every string and key read strictly.
pub fn strict_value(n: &Node) -> Result<SourceValue, Error> {
    read_value(n, false)
}

/// strict_value keeping each number's text, for the values an edit
/// compares against the live doc.
pub(crate) fn edit_value(n: &Node) -> Result<SourceValue, Error> {
    read_value(n, true)
}

fn read_value(n: &Node, keep_text: bool) -> Result<SourceValue, Error> {
    Ok(match n.kind {
        Kind::Null => SourceValue::Null,
        Kind::True => SourceValue::Bool(true),
        Kind::False => SourceValue::Bool(false),
        Kind::Number => {
            // GetDouble reads an overflow as an infinity, as Rust's parse does.
            let number = std::str::from_utf8(n.raw())
                .ok()
                .and_then(|text| text.parse::<f64>().ok())
                .ok_or_else(|| DataError::new("collab: unsupported JSON node."))?;
            if keep_text {
                SourceValue::Source(SourceNumber {
                    value: number,
                    raw: n.raw().to_vec(),
                })
            } else {
                SourceValue::Number(number)
            }
        }
        Kind::String => SourceValue::String(n.text().map_err(Error::NotUnicode)?),
        Kind::Array => SourceValue::Array(
            n.items
                .iter()
                .map(|item| read_value(item, keep_text))
                .collect::<Result<_, _>>()?,
        ),
        Kind::Object => {
            let mut object = Object::new();
            for m in &n.members {
                let key = m.key().map_err(Error::NotUnicode)?;
                object.set(key, read_value(&m.value, keep_text)?);
            }
            SourceValue::Object(object)
        }
    })
}

pub(crate) fn no_nul(value: &[u16], what: &str) -> Result<(), DataError> {
    if value.contains(&0) {
        return Err(DataError::new(format!(
            "collab: {what} contains a NUL character, which this endpoint does not accept."
        )));
    }
    Ok(())
}

fn guard_depth(depth: usize, what: &str) -> Result<(), DataError> {
    if depth > MAX_VALUE_DEPTH {
        return Err(DataError::new(format!(
            "collab: {what} is nested deeper than {MAX_VALUE_DEPTH} levels."
        )));
    }
    Ok(())
}

pub(crate) fn source_lookup<'a>(
    object: &'a Object<SourceValue>,
    key: &str,
) -> Option<&'a SourceValue> {
    object.get(&Str::from(key))
}

pub(crate) fn get_string<'a>(object: &'a Object<SourceValue>, key: &str) -> Option<&'a Str> {
    match source_lookup(object, key) {
        Some(SourceValue::String(text)) => Some(text),
        _ => None,
    }
}

/// What JS Object.entries yields for a malformed data or tunes: index keys
/// for an array, one key per UTF-16 unit for a string, nothing for a number
/// or boolean, and null (or absent) throws.
fn object_entries(v: Option<&SourceValue>, what: &str) -> Result<Object<SourceValue>, DataError> {
    Ok(match v {
        None | Some(SourceValue::Null) => {
            return Err(DataError::new(format!("collab: {what} is null.")));
        }
        Some(SourceValue::Object(object)) => object.clone(),
        Some(SourceValue::Array(items)) => items
            .iter()
            .enumerate()
            .map(|(i, item)| (Str::from(i.to_string()), item.clone()))
            .collect(),
        Some(SourceValue::String(text)) => text
            .iter()
            .enumerate()
            .map(|(i, unit)| {
                (
                    Str::from(i.to_string()),
                    SourceValue::String(vec![*unit].into()),
                )
            })
            .collect(),
        Some(_) => Object::new(),
    })
}

/// Empty paragraph data becomes { text: [] }.
pub(crate) fn normalize_block_data(kind: &[u16], data: Object<SourceValue>) -> Object<SourceValue> {
    if is(kind, "paragraph") && data.is_empty() {
        let mut normalized = Object::new();
        normalized.set(Str::from("text"), SourceValue::Array(Vec::new()));
        return normalized;
    }
    data
}

/// One block-data value as the write path takes it.
#[derive(Clone, Debug)]
pub(crate) enum EntryValue {
    Plain(SourceValue),
    /// A string bound for a Y.Text, kept as a string so the update path can
    /// diff it against the live text (Go mergeableText).
    Text(Str),
    /// A rich field's canonical segments, bound for a Y.XmlText (Go
    /// mergeableRichText).
    Rich(Vec<Value>),
}

#[derive(Clone, Debug)]
pub(crate) struct Entry {
    pub(crate) key: Str,
    pub(crate) value: EntryValue,
}

/// Screens only the keys; the update path must screen values.
pub(crate) fn block_data_entries(
    kind: Option<&[u16]>,
    data: &Object<SourceValue>,
    input: &mut RichTextInput<'_>,
) -> Result<Vec<Entry>, DataError> {
    guard_depth(BLOCK_FIELD_DEPTH, "a data value")?;
    let mut entries = Vec::new();
    for m in data.members() {
        no_nul(&m.key, "a data key")?;
        let is_string = matches!(m.value, SourceValue::String(_));
        let is_array = matches!(m.value, SourceValue::Array(_));
        if let Some(kind) = kind
            && input.fields.is_rich(kind, &m.key)
            && (is_string || is_array)
        {
            let segments = rich_segments(kind, &m.key, &m.value, input)?;
            entries.push(Entry {
                key: m.key.clone(),
                value: EntryValue::Rich(segments),
            });
            continue;
        }
        if let SourceValue::String(text) = &m.value
            && DIFFABLE_TEXT_KEYS.iter().any(|k| is(&m.key, k))
        {
            no_nul(text, "a string value")?;
            entries.push(Entry {
                key: m.key.clone(),
                value: EntryValue::Text(text.clone()),
            });
            continue;
        }
        entries.push(Entry {
            key: m.key.clone(),
            value: EntryValue::Plain(m.value.clone()),
        });
    }
    Ok(entries)
}

/// HTML through the caller's table, then the NUL and depth guards, then the
/// client's lenient input read.
fn rich_segments(
    kind: &[u16],
    key: &[u16],
    v: &SourceValue,
    input: &mut RichTextInput<'_>,
) -> Result<Vec<Value>, DataError> {
    let segments = match v {
        SourceValue::String(html) => {
            no_nul(html, "a string value")?;
            SourceValue::Array(
                input
                    .segments(kind, key, html)?
                    .iter()
                    .map(SourceValue::from)
                    .collect(),
            )
        }
        other => other.clone(),
    };
    match atomic_value(&segments, BLOCK_FIELD_DEPTH + 1)? {
        Value::Array(items) => Ok(read_input(&items)),
        _ => unreachable!("an array stays an array"),
    }
}

/// A prelim formatted text. Every insert names its marks, {} included: one
/// without would inherit the run before it.
pub(crate) fn new_rich_text(segments: &[Value]) -> Result<XmlText, Error> {
    let text = XmlText::new(None);
    let mut index = 0;
    for op in to_write_ops(segments)? {
        match &op.insert {
            Value::String(characters) => {
                text.insert(None, index as i64, characters.clone(), Some(&op.attributes))?;
            }
            embed => {
                text.insert_embed(None, index as i64, embed.clone(), Some(&op.attributes))?;
            }
        }
        index += op.length();
    }
    Ok(text)
}

/// Runs the NUL and depth guards over the entries and throws the result
/// away: the conversion is the validator.
pub(crate) fn screen(entries: &[Entry]) -> Result<(), DataError> {
    for e in entries {
        if let EntryValue::Plain(v) = &e.value {
            plain_to_y_value(v, BLOCK_FIELD_DEPTH + 1)?;
        }
    }
    Ok(())
}

pub(crate) fn to_data_map(entries: &[Entry]) -> Result<Map, Error> {
    let mut map_entries = Vec::with_capacity(entries.len());
    for e in entries {
        let v = to_shared(&e.key, &e.value, BLOCK_FIELD_DEPTH + 1)?;
        map_entries.push(MapEntry::new(e.key.clone(), v));
    }
    Ok(Map::new(map_entries))
}

fn to_shared(key: &[u16], v: &EntryValue, depth: usize) -> Result<In, Error> {
    Ok(match v {
        EntryValue::Rich(segments) => new_rich_text(segments)?.into(),
        EntryValue::Text(text) => blok_yjs::Text::new(Some(text.clone())).into(),
        EntryValue::Plain(v) => plain_data_value(key, v, depth)?,
    })
}

/// Builds one block's Y.Map from its JSON.
pub(crate) fn block_map(
    id: &Str,
    block: &Object<SourceValue>,
    input: &mut RichTextInput<'_>,
) -> Result<Map, Error> {
    // Export skips such a block, so accepting it would PUT the record back short.
    let Some(kind) = get_string(block, "type") else {
        return Err(DataError::new(format!("collab: block \"{id}\" type is not a string.")).into());
    };
    no_nul(kind, &format!("block \"{id}\" type"))?;
    let data_entries = object_entries(
        source_lookup(block, "data"),
        &format!("block \"{id}\" data"),
    )?;
    let entries = block_data_entries(Some(kind), &normalize_block_data(kind, data_entries), input)?;
    let data = to_data_map(&entries)?;
    let mut out = vec![
        MapEntry::new("id", Value::String(id.clone())),
        MapEntry::new("type", Value::String(kind.clone())),
        MapEntry::new("data", data),
    ];

    // Eager even with no tunes, like contentIds: a container two peers can
    // create must be minted by the one that creates the block, or map-set
    // last-writer-wins drops a concurrent tune. LOCKSTEP with the client serializer.
    let tune_entries = match source_lookup(block, "tunes") {
        Some(tunes) => object_entries(Some(tunes), &format!("block \"{id}\" tunes"))?,
        None => Object::new(),
    };
    out.push(MapEntry::new(
        "tunes",
        object_to_y_map(&tune_entries, BLOCK_FIELD_DEPTH, false)?,
    ));
    if let Some(parent) = source_lookup(block, "parent") {
        out.push(MapEntry::new("parentId", atomic_value(parent, 1)?));
    }
    out.push(MapEntry::new(
        "contentIds",
        content_ids_array(id, source_lookup(block, "content"))?,
    ));
    for key in ["lastEditedAt", "lastEditedBy"] {
        if let Some(v) = source_lookup(block, key) {
            out.push(MapEntry::new(key, atomic_value(v, 1)?));
        }
    }
    // Written only when the type is right, so a malformed stamp never reaches the client.
    for (key, number) in [
        ("createdAt", true),
        ("createdBy", false),
        ("createdWith", false),
        ("lastEditedWith", false),
    ] {
        let v = source_lookup(block, key);
        let right = match v {
            Some(SourceValue::Number(_)) => number,
            Some(SourceValue::String(_)) => !number,
            _ => false,
        };
        if let (true, Some(v)) = (right, v) {
            out.push(MapEntry::new(key, atomic_value(v, 1)?));
        }
    }
    Ok(Map::new(out))
}

/// Y.Array.from(content ?? []): a string spreads into its code points.
/// Strings were read strictly, so none holds a lone surrogate.
fn content_ids_array(id: &Str, content: Option<&SourceValue>) -> Result<Array, DataError> {
    match content {
        None | Some(SourceValue::Null) => Ok(Array::new(Vec::new())),
        Some(SourceValue::Array(items)) => Ok(Array::new(
            items
                .iter()
                .map(|item| atomic_value(item, 1).map(In::Any))
                .collect::<Result<_, _>>()?,
        )),
        Some(SourceValue::String(content)) => {
            let mut values = Vec::new();
            let mut i = 0;
            while i < content.len() {
                let unit = content[i];
                let character: Vec<u16> = if (0xd800..=0xdbff).contains(&unit)
                    && i + 1 < content.len()
                    && (0xdc00..=0xdfff).contains(&content[i + 1])
                {
                    i += 1;
                    vec![unit, content[i]]
                } else {
                    vec![unit]
                };
                no_nul(&character, &format!("block \"{id}\" content"))?;
                values.push(In::Any(Value::String(character.into())));
                i += 1;
            }
            Ok(Array::new(values))
        }
        Some(_) => Err(DataError::new(format!(
            "collab: block \"{id}\" has non-iterable content."
        ))),
    }
}

/// plain_to_y_value, except the list-slot map mints its empty lists as
/// keyed wrappers (plainDataValue in the client serializer).
pub(crate) fn plain_data_value(
    key: &[u16],
    v: &SourceValue,
    depth: usize,
) -> Result<In, DataError> {
    if let SourceValue::Object(object) = v
        && is(key, LIST_SLOT_MAP_KEY)
    {
        return Ok(object_to_y_map(object, depth, true)?.into());
    }
    plain_to_y_value(v, depth)
}

fn object_to_y_map(
    object: &Object<SourceValue>,
    depth: usize,
    list_slots: bool,
) -> Result<Map, DataError> {
    guard_depth(depth, "a data value")?;
    let mut entries = Vec::new();
    for m in object.members() {
        no_nul(&m.key, "a data key")?;
        let name = &m.key;
        if let SourceValue::Array(array) = &m.value {
            if (list_slots
                || is(name, "definitions")
                || is(name, "triggers")
                || is(name, "actions"))
                && array.is_empty()
            {
                let wrapper = plain_to_identity_map(array, depth + 1)?;
                entries.push(MapEntry::new(name.clone(), wrapper));
                continue;
            }
            if ORDERED_ID_ARRAY_KEYS.iter().any(|k| is(name, k))
                && !is_grid_array(array)
                && !is_identity_array(array)
            {
                entries.push(MapEntry::new(
                    name.clone(),
                    plain_to_y_array(array, depth + 1)?,
                ));
                continue;
            }
        }
        entries.push(MapEntry::new(
            name.clone(),
            plain_to_y_value(&m.value, depth + 1)?,
        ));
    }
    Ok(Map::new(entries))
}

/// Element-wise whatever the elements are: only the ordered-id rule uses it.
pub(crate) fn plain_to_y_array(array: &[SourceValue], depth: usize) -> Result<Array, DataError> {
    guard_depth(depth, "a data value")?;
    Ok(Array::new(
        array
            .iter()
            .map(|element| plain_to_y_value(element, depth + 1))
            .collect::<Result<_, _>>()?,
    ))
}

/// The grid rule, the identity rule, the array rule, then nested maps;
/// primitives and other arrays stay atomic leaves.
pub(crate) fn plain_to_y_value(v: &SourceValue, depth: usize) -> Result<In, DataError> {
    if let SourceValue::Array(array) = v
        && is_convertible_array(array)
    {
        guard_depth(depth, "a data value")?;
        if is_grid_array(array) {
            return Ok(plain_to_grid_map(array, depth)?.into());
        }
        if is_identity_array(array) {
            return Ok(plain_to_identity_map(array, depth)?.into());
        }
        return Ok(Array::new(
            array
                .iter()
                .map(|element| plain_to_y_value(element, depth + 1))
                .collect::<Result<_, _>>()?,
        )
        .into());
    }
    if let SourceValue::Object(object) = v {
        return Ok(object_to_y_map(object, depth, false)?.into());
    }
    Ok(In::Any(atomic_value(v, depth)?))
}

fn grid_wrapper(row_entries: Vec<MapEntry>, order: Vec<In>) -> Map {
    Map::new(vec![
        MapEntry::new(GRID_ROWS_KEY, Map::new(row_entries)),
        MapEntry::new(GRID_ORDER_KEY, Array::new(order)),
    ])
}

fn plain_to_grid_map(rows: &[SourceValue], depth: usize) -> Result<Map, DataError> {
    let mut row_entries = Vec::new();
    let mut order = Vec::new();
    let mut taken = HashSet::new();
    for row in rows {
        let key = new_grid_row_key(row, &taken);
        taken.insert(key.clone());
        // A grid row costs two levels, matching the read-back walk.
        let v = plain_to_y_value(row, depth + 2)?;
        row_entries.push(MapEntry::new(key.clone(), v));
        order.push(In::Any(Value::String(key)));
    }
    Ok(grid_wrapper(row_entries, order))
}

/// Keys each element by its own id, in the grid's shape.
pub(crate) fn plain_to_identity_map(
    elements: &[SourceValue],
    depth: usize,
) -> Result<Map, DataError> {
    let mut row_entries = Vec::new();
    let mut order = Vec::new();
    for element in elements {
        let key = element_id(element);
        no_nul(&key, "a data key")?;
        let v = plain_to_y_value(element, depth + 2)?;
        row_entries.push(MapEntry::new(key.clone(), v));
        order.push(In::Any(Value::String(key)));
    }
    Ok(grid_wrapper(row_entries, order))
}

/// An identity element's id; "" where it has none.
pub(crate) fn element_id(element: &SourceValue) -> Str {
    match element {
        SourceValue::Object(object) => get_string(object, "id").cloned().unwrap_or_default(),
        _ => Str::new(),
    }
}

/// What a bare ymap.set(key, value) stores: plain all the way down.
pub(crate) fn atomic_value(v: &SourceValue, depth: usize) -> Result<Value, DataError> {
    Ok(match v {
        SourceValue::Null => Value::Null,
        SourceValue::Bool(flag) => Value::Bool(*flag),
        SourceValue::Number(number) => Value::Number(*number),
        SourceValue::Source(number) => Value::Number(number.value),
        SourceValue::String(text) => {
            no_nul(text, "a string value")?;
            Value::String(text.clone())
        }
        SourceValue::Object(object) => {
            guard_depth(depth, "a data value")?;
            let mut entries = Object::new();
            for m in object.members() {
                no_nul(&m.key, "a data key")?;
                entries.set(m.key.clone(), atomic_value(&m.value, depth + 1)?);
            }
            Value::Object(entries)
        }
        SourceValue::Array(items) => {
            guard_depth(depth, "a data value")?;
            Value::Array(
                items
                    .iter()
                    .map(|item| atomic_value(item, depth + 1))
                    .collect::<Result<_, _>>()?,
            )
        }
        SourceValue::Unsupported => return Err(DataError::new("collab: unsupported JSON node.")),
    })
}

pub(crate) fn is_convertible_array(array: &[SourceValue]) -> bool {
    !array.is_empty()
        && array
            .iter()
            .all(|element| matches!(element, SourceValue::Object(_) | SourceValue::Array(_)))
}

pub(crate) fn is_grid_array(array: &[SourceValue]) -> bool {
    is_convertible_array(array)
        && array
            .iter()
            .all(|element| matches!(element, SourceValue::Array(_)))
}

/// Every element carries a unique, non-empty string id, and it is not a grid.
pub(crate) fn is_identity_array(array: &[SourceValue]) -> bool {
    if !is_convertible_array(array) || is_grid_array(array) {
        return false;
    }
    let mut ids = HashSet::new();
    for element in array {
        let SourceValue::Object(object) = element else {
            return false;
        };
        match get_string(object, "id") {
            Some(id) if !id.is_empty() && ids.insert(id.clone()) => {}
            _ => return false,
        }
    }
    true
}

/// The rowId every cell of a row carries, or None.
pub(crate) fn grid_row_id(row: &SourceValue) -> Option<Str> {
    let SourceValue::Array(cells) = row else {
        return None;
    };
    let mut first: Option<&Str> = None;
    for cell in cells {
        let SourceValue::Object(object) = cell else {
            return None;
        };
        let id = get_string(object, "rowId")?;
        match first {
            None => first = Some(id),
            Some(first) if first != id => return None,
            Some(_) => {}
        }
    }
    first.filter(|id| !id.is_empty()).cloned()
}

pub(crate) fn new_grid_row_key(row: &SourceValue, taken: &HashSet<Str>) -> Str {
    match grid_row_id(row) {
        Some(id) if !taken.contains(&id) => id,
        _ => generate_row_key(),
    }
}

pub(crate) fn is_source_page_icon(v: &SourceValue) -> bool {
    let SourceValue::Object(icon) = v else {
        return false;
    };
    let is_str = |key| matches!(source_lookup(icon, key), Some(SourceValue::String(_)));
    match get_string(icon, "type") {
        Some(kind) if is(kind, "emoji") => is_str("value"),
        Some(kind) if is(kind, "image") => is_str("url"),
        _ => false,
    }
}

/// The page fields to write: a valid value, or None for "delete the key". A
/// malformed icon is dropped before the guards run.
fn compose_page(
    page: &Object<SourceValue>,
) -> Result<Vec<(&'static str, Option<Value>)>, DataError> {
    let mut title = None;
    if let Some(text) = get_string(page, "title")
        && !text.is_empty()
    {
        no_nul(text, "a page title")?;
        title = Some(Value::String(text.clone()));
    }
    let mut icon = None;
    if let Some(raw @ SourceValue::Object(_)) = source_lookup(page, "icon")
        && is_source_page_icon(raw)
    {
        let atomic = atomic_value(raw, 1)?;
        if is_page_icon(&atomic) {
            icon = Some(atomic);
        }
    }
    Ok(vec![("title", title), ("icon", icon)])
}

type Prepared = (Vec<(Str, Map)>, Vec<In>);

fn compose(blocks: &[Node], input: &mut RichTextInput<'_>) -> Result<Prepared, Error> {
    let mut prepared = Vec::new();
    let mut top_level = Vec::new();
    for node in blocks {
        // fromJSON reads block.id off every entry: null throws, a primitive is skipped.
        if node.kind == Kind::Null {
            return Err(DataError::new("collab: a block entry is null.").into());
        }
        if node.kind != Kind::Object {
            continue;
        }
        let id_node = member(node, "id").map_err(Error::NotUnicode)?;
        if id_node.is_none_or(|id| id.kind != Kind::String) {
            continue;
        }
        let SourceValue::Object(block) = strict_value(node)? else {
            unreachable!("an object node reads as an object")
        };
        let id = get_string(&block, "id").cloned().unwrap_or_default();
        no_nul(&id, "a block id")?;
        let m = block_map(&id, &block, input)?;
        if source_lookup(&block, "parent").is_none() {
            top_level.push(In::Any(Value::String(id.clone())));
        }
        prepared.push((id, m));
    }
    Ok((prepared, top_level))
}

/// The HTML in the rich fields of blocks, each once, found by the walk
/// `seed` runs. It writes nothing and fails where `seed` would.
pub fn collect_seed_html(
    blocks: &[Node],
    fields: &RichTextFields,
) -> Result<Vec<RichTextHtml>, Error> {
    let mut input = RichTextInput::collecting(fields);
    compose(blocks, &mut input)?;
    Ok(input.found().to_vec())
}

/// Replaces the doc's blocks with blocks: every block becomes a map entry,
/// and each one with no parent key joins the root order in input order. A
/// page (read strictly) replaces the page map's title and icon; values is
/// never touched. Everything that can refuse runs before the transaction
/// opens, so a refused document leaves the doc as it was.
pub fn seed(
    doc: &Doc,
    blocks: &[Node],
    input: &mut RichTextInput<'_>,
    page: Option<&Object<SourceValue>>,
) -> Result<(), Error> {
    let (prepared, top_level) = compose(blocks, input)?;
    let page_fields = page.map(compose_page).transpose()?;
    let block_map = doc.get_map(BLOCKS_ROOT)?;
    let root_order = doc.get_array(ORDER_ROOT)?;
    let page_map = match page_fields {
        Some(_) => Some(doc.get_map(PAGE_ROOT)?),
        None => None,
    };
    doc.transact(|t| {
        if let (Some(fields), Some(page_map)) = (&page_fields, &page_map) {
            for (key, value) in fields {
                match value {
                    Some(value) => page_map.set(t, *key, value.clone())?,
                    None if page_map.get(*key).is_some() => page_map.delete(t, *key)?,
                    None => {}
                }
            }
        }
        let length = root_order.len();
        if length > 0 {
            root_order.delete(t, 0, length as i64)?;
        }
        block_map.clear(t)?;
        for (id, block) in prepared {
            block_map.set(t, id, block)?;
        }
        if !top_level.is_empty() {
            root_order.insert(t, 0, top_level)?;
        }
        Ok(())
    })?;
    Ok(())
}

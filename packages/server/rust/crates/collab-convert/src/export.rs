use std::collections::{HashMap, HashSet};
use std::fmt;

use blok_jsjson::{Object, Str, Value, compare, key_order};
use blok_yjs::{Array, Doc, EngineError, Map, Out, TypeKind};

use crate::error::Error;
use crate::fields::RichTextFields;
use crate::richtext::{from_delta, is, lookup};

/// How deep block data may nest (C# YDocConverter.MaxValueDepth).
pub const MAX_VALUE_DEPTH: usize = 256;
const BLOCK_FIELD_DEPTH: usize = 0;
pub(crate) const BLOCKS_ROOT: &str = "blocks";
pub(crate) const ORDER_ROOT: &str = "root";
pub(crate) const PAGE_ROOT: &str = "page";
const GRID_ROWS_KEY: &str = "__rows";
const GRID_ORDER_KEY: &str = "__rowKeys";

/// The top-level maps that hold page fields.
pub const PAGE_MAPS: &[&str] = &["page", "values"];

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

/// One step from the exported blocks array down to a slot's object.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SlotStep {
    Index(usize),
    Key(Str),
}

/// An exported rich field still holding HTML: the caller converts it and
/// writes the segments into the object at `path` under `key`. Go holds a
/// pointer to that object; here the path leads to it from the exported
/// blocks, starting with the block's index.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RichTextHtmlSlot {
    pub path: Vec<SlotStep>,
    pub key: Str,
    pub html: RichTextHtml,
}

impl RichTextHtmlSlot {
    /// The object the segments go into, inside the blocks `export` returned.
    pub fn target_mut<'a>(&self, blocks: &'a mut [Value]) -> Option<&'a mut Object> {
        let (SlotStep::Index(first), rest) = self.path.split_first()? else {
            return None;
        };
        let mut at = blocks.get_mut(*first)?;
        for step in rest {
            at = match (step, at) {
                (SlotStep::Index(index), Value::Array(items)) => items.get_mut(*index)?,
                (SlotStep::Key(key), Value::Object(object)) => object.get_mut(key)?,
                _ => return None,
            };
        }
        match at {
            Value::Object(object) => Some(object),
            _ => None,
        }
    }
}

// Exported block JSON is JS values, plus Value::BigInt for a peer's bigint,
// which a double cannot hold exactly.

fn value(m: &Map, key: &str) -> Option<Out> {
    m.get(key)
}

fn str_value(m: &Map, key: &str) -> Option<Str> {
    match value(m, key) {
        Some(Out::Any(Value::String(text))) => Some(text),
        _ => None,
    }
}

fn is_grid_map(m: &Map) -> bool {
    value(m, GRID_ROWS_KEY).and_then(|v| v.as_map()).is_some()
        && value(m, GRID_ORDER_KEY)
            .and_then(|v| v.as_array())
            .is_some()
}

/// First occurrence wins, keys with no row are dropped, rows missing from
/// the order follow, sorted.
fn grid_row_keys(order: &Array, rows: &Map) -> Vec<Str> {
    let mut seen = HashSet::new();
    let mut keys = Vec::new();
    for entry in order.values() {
        let Out::Any(Value::String(key)) = entry else {
            continue;
        };
        if seen.contains(&key) || rows.get(&key[..]).is_none() {
            continue;
        }
        seen.insert(key.clone());
        keys.push(key);
    }
    let mut rest: Vec<Str> = rows
        .keys()
        .into_iter()
        .filter(|key| !seen.contains(key))
        .collect();
    rest.sort_by(|a, b| compare(a, b));
    keys.extend(rest);
    keys
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

fn has_lone_surrogate(text: &[u16]) -> bool {
    let mut i = 0;
    while i < text.len() {
        let unit = text[i];
        if (0xd800..=0xdbff).contains(&unit)
            && i + 1 < text.len()
            && (0xdc00..=0xdfff).contains(&text[i + 1])
        {
            i += 1;
        } else if (0xd800..=0xdfff).contains(&unit) {
            return true;
        }
        i += 1;
    }
    false
}

struct BlockEntry {
    m: Map,
    raw_parent: Option<Str>,
    content_ids: Vec<Out>,
}

fn read_entry(id: &Str, m: Map) -> BlockEntry {
    // A self-parent is never a real link.
    let raw_parent = str_value(&m, "parentId").filter(|parent| parent != id);
    let content_ids = value(&m, "contentIds")
        .and_then(|v| v.as_array())
        .map(|array| array.values())
        .unwrap_or_default();
    BlockEntry {
        m,
        raw_parent,
        content_ids,
    }
}

type Hierarchy = HashMap<Str, Option<Str>>;

type Warn<'a> = Option<&'a mut dyn FnMut(&str)>;

/// Doc -> JSON, mirroring the client's DocumentStore.toJSON.
pub(crate) struct DocReader<'f, 'w> {
    root_order: Array,
    fields: &'f RichTextFields,
    warn: Warn<'w>,
    /// This block's slots, their paths starting at the block object.
    pending: Vec<RichTextHtmlSlot>,
    path: Vec<String>,
    all_ids: HashSet<Str>,
    ids: Vec<Str>,
    entries: HashMap<Str, BlockEntry>,
}

impl<'f, 'w> DocReader<'f, 'w> {
    pub(crate) fn new(
        block_map: &Map,
        root_order: Array,
        fields: &'f RichTextFields,
        warn: Warn<'w>,
    ) -> DocReader<'f, 'w> {
        let mut reader = DocReader {
            root_order,
            fields,
            warn,
            pending: Vec::new(),
            path: Vec::new(),
            all_ids: HashSet::new(),
            ids: Vec::new(),
            entries: HashMap::new(),
        };
        for key in block_map.keys() {
            reader.all_ids.insert(key.clone());
            reader.ids.push(key.clone());
            if let Some(block) = block_map.get(&key[..]).and_then(|v| v.as_map()) {
                let entry = read_entry(&key, block);
                reader.entries.insert(key, entry);
            }
        }
        reader
    }

    fn export(&mut self) -> Result<(Vec<Value>, Vec<RichTextHtmlSlot>), DataError> {
        let hierarchy = self.hierarchy_view();
        let mut exported = Vec::new();
        let mut slots = Vec::new();
        for id in self.derive_ordered_ids(&hierarchy) {
            if let Some(block) = self.read_block(&id)? {
                for mut slot in self.pending.drain(..) {
                    slot.path.insert(0, SlotStep::Index(exported.len()));
                    slots.push(slot);
                }
                exported.push(Value::Object(project_hierarchy(&id, block, &hierarchy)));
            }
        }
        Ok((exported, slots))
    }

    fn read_block(&mut self, key: &Str) -> Result<Option<Object>, DataError> {
        self.path.clear();
        self.pending.clear();
        self.y_block_to_output_data(key).map_err(|err| {
            let at = if self.path.is_empty() {
                "its fields".to_owned()
            } else {
                self.path.join(".")
            };
            DataError::new(format!("collab: block \"{key}\" at {at}: {err}"))
        })
    }

    fn skip(&mut self, key: &Str, reason: &str) -> Option<Object> {
        if let Some(warn) = self.warn.as_mut() {
            warn(&format!(
                "collab: block \"{key}\" was skipped on export: {reason}."
            ));
        }
        None
    }

    fn enter(&mut self, key: String) {
        self.path.push(key);
    }

    fn leave(&mut self) {
        self.path.pop();
    }

    /// Every id's effective parent: its parentId, or None where a cycle
    /// broke the link. A dangling parent stays, for a peer not yet arrived.
    fn hierarchy_view(&self) -> Hierarchy {
        let broken = self.broken_cycle_members();
        self.all_ids
            .iter()
            .map(|id| {
                let parent = if broken.contains(id) {
                    None
                } else {
                    self.raw_parent_id(id).cloned()
                };
                (id.clone(), parent)
            })
            .collect()
    }

    fn raw_parent_id(&self, id: &Str) -> Option<&Str> {
        self.entries
            .get(id)
            .and_then(|entry| entry.raw_parent.as_ref())
    }

    fn broken_cycle_members(&self) -> HashSet<Str> {
        let mut broken = HashSet::new();
        let mut state = HashMap::new();
        for id in &self.ids {
            self.mark_parent_chain(id, &mut state, &mut broken);
        }
        broken
    }

    /// Walks one parentId chain without recursion: a document may nest
    /// thousands of blocks deep.
    fn mark_parent_chain(
        &self,
        start: &Str,
        state: &mut HashMap<Str, bool>,
        broken: &mut HashSet<Str>,
    ) {
        let mut path: Vec<Str> = Vec::new();
        let mut id = start;
        loop {
            if let Some(&visiting) = state.get(id) {
                if visiting {
                    let from = path.iter().position(|member| member == id).unwrap_or(0);
                    break_cycle(&path[from..], broken);
                }
                break;
            }
            if !self.all_ids.contains(id) {
                break;
            }
            state.insert(id.clone(), true);
            path.push(id.clone());
            match self.raw_parent_id(id) {
                Some(parent) => id = parent,
                None => break,
            }
        }
        for visited in path {
            state.insert(visited, false);
        }
    }

    fn derive_ordered_ids(&self, hierarchy: &Hierarchy) -> Vec<Str> {
        let mut ordered = Vec::new();
        let mut seen = HashSet::new();
        self.main_pass(hierarchy, &mut seen, &mut ordered);
        for id in self.unreached(&seen) {
            let parent = parent_of(hierarchy, &id);
            if parent.is_none_or(|parent| !self.all_ids.contains(parent)) {
                self.visit_block(&id, parent, hierarchy, &mut seen, &mut ordered);
            }
        }
        for id in self.unreached(&seen) {
            let parent = parent_of(hierarchy, &id);
            self.visit_block(&id, parent, hierarchy, &mut seen, &mut ordered);
        }
        ordered
    }

    /// The ids the export reaches from the root order.
    pub(crate) fn main_pass_ids(&self) -> HashSet<Str> {
        let mut seen = HashSet::new();
        let mut ordered = Vec::new();
        self.main_pass(&self.hierarchy_view(), &mut seen, &mut ordered);
        seen
    }

    fn main_pass(&self, hierarchy: &Hierarchy, seen: &mut HashSet<Str>, ordered: &mut Vec<Str>) {
        for entry in self.root_order.values() {
            if let Out::Any(Value::String(id)) = entry {
                self.visit_block(&id, None, hierarchy, seen, ordered);
            }
        }
    }

    fn unreached(&self, seen: &HashSet<Str>) -> Vec<Str> {
        let mut ids: Vec<Str> = self
            .ids
            .iter()
            .filter(|id| !seen.contains(*id))
            .cloned()
            .collect();
        ids.sort();
        ids
    }

    /// Emits an id once, only where its effective parent is the block whose
    /// order is walked; a disagreeing slot is skipped without marking it
    /// seen, so a later agreeing one can claim it. No recursion, as above.
    fn visit_block(
        &self,
        start: &Str,
        expected: Option<&Str>,
        hierarchy: &Hierarchy,
        seen: &mut HashSet<Str>,
        ordered: &mut Vec<Str>,
    ) {
        let mut stack: Vec<(Str, Option<Str>)> = vec![(start.clone(), expected.cloned())];
        while let Some((id, expected)) = stack.pop() {
            let Some(entry) = self.entries.get(&id) else {
                continue;
            };
            if seen.contains(&id) || parent_of(hierarchy, &id) != expected.as_ref() {
                continue;
            }
            seen.insert(id.clone());
            ordered.push(id.clone());
            for child in entry.content_ids.iter().rev() {
                if let Out::Any(Value::String(child)) = child {
                    stack.push((child.clone(), Some(id.clone())));
                }
            }
        }
    }

    fn y_block_to_output_data(&mut self, key: &Str) -> Result<Option<Object>, DataError> {
        let m = self.entries[key].m.clone();
        let content_ids = self.entries[key].content_ids.clone();
        let Some(id) = str_value(&m, "id") else {
            return Ok(self.skip(key, "its id is not a string"));
        };
        let Some(kind) = str_value(&m, "type") else {
            return Ok(self.skip(key, "its type is not a string"));
        };
        let Some(data) = value(&m, "data").and_then(|v| v.as_map()) else {
            return Ok(self.skip(key, "its data is not a map"));
        };
        self.enter("data".to_owned());
        let block_data = self.y_map_to_object(&data, BLOCK_FIELD_DEPTH)?;

        // What is left holding HTML after the generic read is a legacy text or string.
        for data_key in data.keys() {
            if !self.fields.is_rich(&kind, &data_key) {
                continue;
            }
            let legacy = match data.get(&data_key[..]) {
                Some(Out::Any(Value::String(_))) => true,
                Some(out) => out.as_text().is_some(),
                None => false,
            };
            if !legacy {
                continue;
            }
            if let Some(Value::String(html)) = block_data.get(&data_key) {
                self.pending.push(RichTextHtmlSlot {
                    path: vec![SlotStep::Key(Str::from("data"))],
                    key: data_key.clone(),
                    html: RichTextHtml {
                        kind: kind.clone(),
                        field: data_key.clone(),
                        html: html.clone(),
                    },
                });
            }
        }
        self.nested_document_slots(&kind, &block_data, &[SlotStep::Key(Str::from("data"))]);

        let mut block = Object::new();
        put(&mut block, "id", Value::String(id));
        put(&mut block, "type", Value::String(kind));
        put(&mut block, "data", Value::Object(block_data));
        self.leave();

        if let Some(tunes) = value(&m, "tunes").and_then(|v| v.as_map())
            && !tunes.is_empty()
        {
            self.enter("tunes".to_owned());
            let plain = self.y_map_to_object(&tunes, BLOCK_FIELD_DEPTH)?;
            put(&mut block, "tunes", Value::Object(plain));
            self.leave();
        }
        // Any string parentId, self-parent included: the projection re-decides it.
        if let Some(parent) = str_value(&m, "parentId") {
            put(&mut block, "parent", Value::String(parent));
        }
        if !content_ids.is_empty() {
            self.enter("content".to_owned());
            let plain = self.plain_array(&content_ids, 1)?;
            put(&mut block, "content", Value::Array(plain));
            self.leave();
        }
        self.stamp(&m, &mut block, "lastEditedAt")?;
        if let Some(by) = str_value(&m, "lastEditedBy") {
            put(&mut block, "lastEditedBy", Value::String(by));
        }
        self.stamp(&m, &mut block, "createdAt")?;
        for key in ["createdBy", "createdWith", "lastEditedWith"] {
            if let Some(text) = str_value(&m, key) {
                put(&mut block, key, Value::String(text));
            }
        }
        Ok(Some(block))
    }

    fn stamp(&mut self, m: &Map, block: &mut Object, key: &str) -> Result<(), DataError> {
        if let Some(at @ Out::Any(Value::Number(_) | Value::BigInt(_))) = value(m, key) {
            self.enter(key.to_owned());
            let plain = self.plain_or_null(&at, 1)?;
            put(block, key, plain);
            self.leave();
        }
        Ok(())
    }

    /// A database-row keeps whole documents in properties.*.blocks as plain
    /// JSON, and their rich HTML is converted too.
    fn nested_document_slots(&mut self, kind: &[u16], data: &Object, at: &[SlotStep]) {
        if !is(kind, "database-row") {
            return;
        }
        let Some(Value::Object(properties)) = lookup(data, "properties") else {
            return;
        };
        for property in properties.members() {
            let Value::Object(document) = &property.value else {
                continue;
            };
            let Some(Value::Array(nested)) = lookup(document, "blocks") else {
                continue;
            };
            for (index, node) in nested.iter().enumerate() {
                let Value::Object(block) = node else {
                    continue;
                };
                let Some(Value::String(nested_type)) = lookup(block, "type") else {
                    continue;
                };
                let Some(Value::Object(nested_data)) = lookup(block, "data") else {
                    continue;
                };
                let mut path = at.to_vec();
                path.extend([
                    SlotStep::Key(Str::from("properties")),
                    SlotStep::Key(property.key.clone()),
                    SlotStep::Key(Str::from("blocks")),
                    SlotStep::Index(index),
                    SlotStep::Key(Str::from("data")),
                ]);
                for member in nested_data.members() {
                    if let Value::String(html) = &member.value
                        && self.fields.is_rich(nested_type, &member.key)
                    {
                        self.pending.push(RichTextHtmlSlot {
                            path: path.clone(),
                            key: member.key.clone(),
                            html: RichTextHtml {
                                kind: nested_type.clone(),
                                field: member.key.clone(),
                                html: html.clone(),
                            },
                        });
                    }
                }
                self.nested_document_slots(nested_type, nested_data, &path);
            }
        }
    }

    fn y_map_to_object(&mut self, m: &Map, depth: usize) -> Result<Object, DataError> {
        let mut result = Object::new();
        for key in m.keys() {
            self.enter(key.to_string());
            let v = m.get(&key[..]).unwrap_or(Out::Any(Value::Null));
            // JSON.stringify drops undefined-valued keys.
            if let Some(plain) = self.try_to_plain(&v, depth + 1)? {
                result.set(key, plain);
            }
            self.leave();
        }
        Ok(result)
    }

    fn plain_array(&mut self, items: &[Out], depth: usize) -> Result<Vec<Value>, DataError> {
        let mut result = Vec::with_capacity(items.len());
        for (i, item) in items.iter().enumerate() {
            self.enter(i.to_string());
            result.push(self.plain_or_null(item, depth)?);
            self.leave();
        }
        Ok(result)
    }

    fn plain_values(&mut self, items: &[Value], depth: usize) -> Result<Vec<Value>, DataError> {
        let mut result = Vec::with_capacity(items.len());
        for (i, item) in items.iter().enumerate() {
            self.enter(i.to_string());
            result.push(self.try_value_to_plain(item, depth)?.unwrap_or(Value::Null));
            self.leave();
        }
        Ok(result)
    }

    fn plain_or_null(&mut self, v: &Out, depth: usize) -> Result<Value, DataError> {
        Ok(self.try_to_plain(v, depth)?.unwrap_or(Value::Null))
    }

    /// Reads back what the write rules stored. The grid branch comes first:
    /// a keyed grid IS a map, and reading it as one would leak row keys.
    /// None is undefined, which JSON has no value for.
    fn try_to_plain(&mut self, v: &Out, depth: usize) -> Result<Option<Value>, DataError> {
        if let Some(map) = v.as_map() {
            if depth > MAX_VALUE_DEPTH {
                return Ok(Some(Value::Null));
            }
            if is_grid_map(&map) {
                return Ok(Some(Value::Array(self.grid_map_to_plain(&map, depth)?)));
            }
            return Ok(Some(Value::Object(self.y_map_to_object(&map, depth)?)));
        }
        if let Some(array) = v.as_array() {
            if depth > MAX_VALUE_DEPTH {
                return Ok(Some(Value::Null));
            }
            return Ok(Some(Value::Array(
                self.plain_array(&array.values(), depth + 1)?,
            )));
        }
        // Formatted rich text by class, never by field list, read through the
        // delta so embeds and marks survive.
        if let Some(rich) = v.as_xml_text() {
            return Ok(Some(Value::Array(to_json_array(&from_delta(
                &rich.to_delta(),
            ))?)));
        }
        if let Some(text) = v.as_text() {
            return Ok(Some(Value::String(text.units())));
        }
        match v {
            Out::Any(value) => self.try_value_to_plain(value, depth),
            Out::Subdoc(_) => Ok(Some(Value::Object(Object::new()))),
            // The XML containers hold no markup in this engine and read as "".
            Out::Type(handle) => match handle.kind() {
                TypeKind::XmlElement | TypeKind::XmlFragment | TypeKind::XmlHook => {
                    Ok(Some(Value::String(Str::new())))
                }
                _ => Err(DataError::new(
                    "collab: unsupported value YUntypedType in block data.",
                )),
            },
        }
    }

    fn try_value_to_plain(&mut self, v: &Value, depth: usize) -> Result<Option<Value>, DataError> {
        Ok(match v {
            Value::Object(_) | Value::Array(_) if depth > MAX_VALUE_DEPTH => Some(Value::Null),
            Value::Null => Some(Value::Null),
            Value::Object(object) => {
                let mut result = Object::new();
                for member in object.members() {
                    self.enter(member.key.to_string());
                    if let Some(plain) = self.try_value_to_plain(&member.value, depth + 1)? {
                        result.set(member.key.clone(), plain);
                    }
                    self.leave();
                }
                Some(Value::Object(result))
            }
            Value::Array(items) => Some(Value::Array(self.plain_values(items, depth + 1)?)),
            // Only wire JSON can carry a lone surrogate; .NET would write
            // U+FFFD, so it is dropped as undefined is.
            Value::String(text) if has_lone_surrogate(text) => None,
            Value::String(_) | Value::Bool(_) | Value::BigInt(_) => Some(v.clone()),
            Value::Number(number) => Some(number_node(*number)),
            Value::Bytes(bytes) => {
                let mut result = Object::new();
                for (i, byte) in bytes.iter().enumerate() {
                    result.set(Str::from(i.to_string()), Value::Number(f64::from(*byte)));
                }
                Some(Value::Object(result))
            }
            Value::Undefined => None,
        })
    }

    fn grid_map_to_plain(&mut self, grid: &Map, depth: usize) -> Result<Vec<Value>, DataError> {
        let (Some(rows), Some(order)) = (
            value(grid, GRID_ROWS_KEY).and_then(|v| v.as_map()),
            value(grid, GRID_ORDER_KEY).and_then(|v| v.as_array()),
        ) else {
            return Ok(Vec::new());
        };
        let keys = grid_row_keys(&order, &rows);
        let mut result = Vec::with_capacity(keys.len());
        for (i, key) in keys.iter().enumerate() {
            self.enter(i.to_string());
            let row = rows.get(&key[..]).unwrap_or(Out::Any(Value::Null));
            // The keyed wrapper costs the two levels the write side spends.
            result.push(self.plain_or_null(&row, depth + 2)?);
            self.leave();
        }
        Ok(result)
    }
}

fn parent_of<'h>(hierarchy: &'h Hierarchy, id: &Str) -> Option<&'h Str> {
    hierarchy.get(id).and_then(Option::as_ref)
}

/// Keeps the parent of the smallest member (UTF-16 order).
fn break_cycle(members: &[Str], broken: &mut HashSet<Str>) {
    let Some(keeper) = members.iter().min() else {
        return;
    };
    for member in members {
        if member != keeper {
            broken.insert(member.clone());
        }
    }
}

fn put(object: &mut Object, key: &str, value: Value) {
    object.set(Str::from(key), value);
}

/// Reports the effective parent and keeps only the children that name this
/// block as theirs. Ids with no entry stay; nothing is deduplicated. Both
/// keys keep their place, as a JsonObject set does.
fn project_hierarchy(id: &Str, block: Object, hierarchy: &Hierarchy) -> Object {
    let parent = parent_of(hierarchy, id);
    let mut owned = Vec::new();
    if let Some(Value::Array(content)) = lookup(&block, "content") {
        for child in content {
            let Value::String(child_id) = child else {
                owned.push(child.clone());
                continue;
            };
            match hierarchy.get(child_id) {
                None => owned.push(child.clone()),
                Some(Some(child_parent)) if child_parent == id => owned.push(child.clone()),
                Some(_) => {}
            }
        }
    }
    let mut projected = Object::new();
    for member in block.into_members() {
        if is(&member.key, "parent") {
            if let Some(parent) = parent {
                projected.set(member.key, Value::String(parent.clone()));
            }
        } else if is(&member.key, "content") {
            if !owned.is_empty() {
                projected.set(member.key, Value::Array(std::mem::take(&mut owned)));
            }
        } else {
            projected.set(member.key, member.value);
        }
    }
    projected
}

/// Reads the doc as block JSON. A rich field still holding HTML is left as
/// that string and listed in the slots: the caller converts it.
pub fn export(
    doc: &Doc,
    fields: &RichTextFields,
    warn: Option<&mut dyn FnMut(&str)>,
) -> Result<(Vec<Value>, Vec<RichTextHtmlSlot>), Error> {
    let block_map = doc.get_map(BLOCKS_ROOT)?;
    let root_order = doc.get_array(ORDER_ROOT)?;
    Ok(DocReader::new(&block_map, root_order, fields, warn).export()?)
}

/// The page map's title and icon, by the client's readPageFields; a title
/// or icon holding U+0000 is left out too.
pub fn export_page(doc: &Doc) -> Result<Object, EngineError> {
    let m = doc.get_map(PAGE_ROOT)?;
    let mut page = Object::new();
    if let Some(title) = str_value(&m, "title")
        && !title.is_empty()
        && !title.contains(&0)
    {
        put(&mut page, "title", Value::String(title));
    }
    if let Some(Out::Any(icon)) = value(&m, "icon")
        && is_page_icon(&icon)
        // A value JSON cannot hold is left out: refusing would fail every PUT.
        && let Ok(node) = to_json_node(&icon)
        && !has_nul(&node)
    {
        put(&mut page, "icon", node);
    }
    Ok(page)
}

fn has_nul(node: &Value) -> bool {
    match node {
        Value::Object(object) => object
            .members()
            .iter()
            .any(|member| member.key.contains(&0) || has_nul(&member.value)),
        Value::Array(items) => items.iter().any(has_nul),
        Value::String(text) => text.contains(&0),
        _ => false,
    }
}

/// The client's isPageIcon: {type:'emoji', value} or {type:'image', url}.
fn is_page_icon(v: &Value) -> bool {
    let Value::Object(icon) = v else {
        return false;
    };
    let is_str = |key| matches!(lookup(icon, key), Some(Value::String(_)));
    match lookup(icon, "type") {
        Some(Value::String(kind)) if is(kind, "emoji") => is_str("value"),
        Some(Value::String(kind)) if is(kind, "image") => is_str("url"),
        _ => false,
    }
}

/// C# RichText.ToJsonNode: a plain page map value as JSON, keys in JS order
/// and undefined members dropped.
pub fn plain_json(v: &Value) -> Result<Value, DataError> {
    to_json_node(v)
}

use std::collections::HashSet;

use blok_jsjson::{Object, Str, Value};
use blok_lib0::{Writer, write_any};
use blok_yjs::{Doc, EngineError, Out};

use crate::error::Error;
use crate::export::{BLOCKS_ROOT, DocReader, ORDER_ROOT, PAGE_MAPS, PAGE_ROOT, to_json_node};
use crate::fields::RichTextFields;
use crate::richtext::is;

/// One of the PAGE_MAPS with its live top-level keys, raw: a value may be a
/// shared type or undefined.
#[derive(Clone, Debug)]
pub struct PageMap {
    pub name: &'static str,
    pub entries: Vec<(Str, Out)>,
}

/// C# ReadPageMaps, in PAGE_MAPS order and key order.
pub fn read_page_maps(doc: &Doc) -> Result<Vec<PageMap>, EngineError> {
    PAGE_MAPS
        .iter()
        .map(|&name| {
            let m = doc.get_map(name)?;
            let entries = m
                .keys()
                .into_iter()
                .map(|key| {
                    let value = m.get(&key[..]).unwrap_or(Out::Any(Value::Null));
                    (key, value)
                })
                .collect();
            Ok(PageMap { name, entries })
        })
        .collect()
}

/// A page map as JSON for a version read.
#[derive(Clone, Debug, PartialEq)]
pub struct PlainPageMap {
    pub name: &'static str,
    pub map: Object,
}

/// Keeps only the plain keys a restore can copy, and no empty map. `skip`
/// names keys left out of the page map before conversion, so a value that
/// is not JSON there cannot fail the read. A plain object can still hold a
/// peer's nested bigint or bytes: that is a DataError, as C# throws.
pub fn plain_page_maps(doc: &Doc, skip: &[&str]) -> Result<Vec<PlainPageMap>, Error> {
    let mut maps = Vec::new();
    for m in read_page_maps(doc)? {
        let mut plain = Object::new();
        for (key, value) in m.entries {
            if m.name == PAGE_ROOT && skip.iter().any(|name| is(&key, name)) {
                continue;
            }
            if let Out::Any(value) = &value
                && is_plain_value(value)
            {
                plain.set(key, to_json_node(value)?);
            }
        }
        if !plain.is_empty() {
            maps.push(PlainPageMap {
                name: m.name,
                map: plain,
            });
        }
    }
    Ok(maps)
}

/// What the client writes into the page maps (plain JSON) and one Any value
/// a map can hold.
pub fn is_plain_map_value(v: &Out) -> bool {
    matches!(v, Out::Any(value) if is_plain_value(value))
}

fn is_plain_value(v: &Value) -> bool {
    matches!(
        v,
        Value::Null
            | Value::Bool(_)
            | Value::Number(_)
            | Value::String(_)
            | Value::Object(_)
            | Value::Array(_)
    )
}

/// Equal plain values encode to the same bytes, keys in their stored order.
pub fn plain_map_values_equal(left: &Out, right: &Out) -> bool {
    match (left, right) {
        (Out::Any(left), Out::Any(right)) if is_plain_value(left) && is_plain_value(right) => {
            encode_any(left) == encode_any(right)
        }
        _ => false,
    }
}

fn encode_any(v: &Value) -> Vec<u8> {
    let mut w = Writer::new();
    write_any(&mut w, v);
    w.into_bytes()
}

/// One key of the blocks map. `stored_parent` is the raw string parentId of
/// any map entry (None for a non-map), `listed` the string entries of its
/// contentIds (None when there is no array).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KeyShape {
    pub id: Str,
    pub is_block: bool,
    pub stored_parent: Option<Str>,
    pub listed: Option<Vec<Str>>,
}

/// The doc's raw structure for the restore planner: every key as the edit
/// planner reads it, plus which blocks the export's main pass reaches.
#[derive(Clone, Debug)]
pub struct DocStructure {
    pub keys: Vec<KeyShape>,
    pub root_order: Vec<Str>,
    reached: HashSet<Str>,
}

impl DocStructure {
    /// Whether the export's main pass reaches id.
    pub fn reached(&self, id: &Str) -> bool {
        self.reached.contains(id)
    }
}

fn string(v: Option<Out>) -> Option<Str> {
    match v {
        Some(Out::Any(Value::String(text))) => Some(text),
        _ => None,
    }
}

/// C# DescribeStructure, keys in map order.
pub fn describe_structure(doc: &Doc) -> Result<DocStructure, EngineError> {
    let block_map = doc.get_map(BLOCKS_ROOT)?;
    let root_order = doc.get_array(ORDER_ROOT)?;
    let mut keys = Vec::new();
    for id in block_map.keys() {
        let Some(block) = block_map.get(&id[..]).and_then(|v| v.as_map()) else {
            keys.push(KeyShape {
                id,
                is_block: false,
                stored_parent: None,
                listed: None,
            });
            continue;
        };
        // Raw, self-parent included: the edit planner's removal walk follows
        // it, and the restore planner predicts that walk.
        let stored_parent = string(block.get("parentId"));
        let listed = block
            .get("contentIds")
            .and_then(|v| v.as_array())
            .map(|ids| {
                ids.values()
                    .into_iter()
                    .filter_map(|entry| string(Some(entry)))
                    .collect()
            });
        let is_block = string(block.get("id")).is_some_and(|own| own == id)
            && string(block.get("type")).is_some()
            && block.get("data").and_then(|v| v.as_map()).is_some();
        keys.push(KeyShape {
            id,
            is_block,
            stored_parent,
            listed,
        });
    }
    let order = root_order
        .values()
        .into_iter()
        .filter_map(|entry| string(Some(entry)))
        .collect();
    let fields = RichTextFields::built_in();
    let reached = DocReader::new(&block_map, root_order, &fields, None).main_pass_ids();
    Ok(DocStructure {
        keys,
        root_order: order,
        reached,
    })
}

use std::collections::HashSet;
use std::sync::Arc;

use blok_jsjson::{Str, Value};
use blok_lib0::Reader;

use crate::content::{Content, FormatContent, Subdoc, is_undefined_sentinel, validate_json};
use crate::deleteset::{DeleteSet, read_delete_set};
use crate::item::{CONTENT_REF_MASK, ORIGIN_BIT, PARENT_SUB_BIT, RIGHT_ORIGIN_BIT};
use crate::types::{MAX_TYPE_REF, TypeKind, TypeRef};
use crate::{FormatError, Id, format_err};

type Result<T> = std::result::Result<T, FormatError>;

/// Tells decoded structs apart.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StructKind {
    Item,
    Gc,
    Skip,
}

/// One struct as the wire spelled it. `info` is the raw info byte: an item
/// can arrive flagged with a parentSub it does not carry.
#[derive(Clone, Debug)]
pub struct DecodedStruct {
    pub id: Id,
    pub length: usize,
    pub kind: StructKind,
    pub origin: Option<Id>,
    pub right_origin: Option<Id>,
    pub parent_root: Option<Str>,
    pub parent_id: Option<Id>,
    pub parent_sub: Option<Str>,
    pub content: Option<Content>,
    pub info: u8,
}

/// One client group of an update.
#[derive(Clone, Debug)]
pub struct ClientStructs {
    pub client: u64,
    pub structs: Vec<DecodedStruct>,
}

/// A v1 update parsed and not yet applied. Groups keep the update's own
/// order, which keeps a decode then re-encode byte-identical.
#[derive(Clone, Debug, Default)]
pub struct DecodedUpdate {
    pub groups: Vec<ClientStructs>,
    pub delete_set: DeleteSet,
    pub max_nesting_depth: usize,
}

/// Reads a whole v1 update and refuses anything unexpected: a client listed
/// twice, trailing bytes (which is how a v2 update fails), a length past
/// int32. 00 00 is the valid empty update.
pub fn decode(update: &[u8]) -> Result<DecodedUpdate> {
    let mut r = Reader::new(update);
    let mut decoded = DecodedUpdate::default();
    let mut seen = HashSet::new();
    let groups = r.read_var_uint()?;
    for _ in 0..groups {
        // Never preallocate from the wire's count.
        let count = r.read_var_uint()?;
        let client = r.read_var_uint()?;
        let mut clock = r.read_var_uint()?;
        if !seen.insert(client) {
            return Err(format_err!(
                "yjs: client {client} is listed twice; a v1 update lists each client once."
            ));
        }
        let mut structs = Vec::new();
        for _ in 0..count {
            let read = read_struct(&mut r, client, clock)?;
            clock = clock.wrapping_add(read.length as u64);
            structs.push(read);
        }
        decoded.groups.push(ClientStructs { client, structs });
    }
    decoded.delete_set = read_delete_set(&mut r)?;
    if !r.at_end() {
        return Err(format_err!(
            "yjs: {} bytes follow the delete set.",
            r.len() - r.pos()
        ));
    }
    decoded.max_nesting_depth = measure_nesting(&decoded.groups);
    Ok(decoded)
}

fn read_struct(r: &mut Reader<'_>, client: u64, clock: u64) -> Result<DecodedStruct> {
    let info = r.read_uint8()?;
    let id = Id::new(client, clock);
    let bare = |length, kind| DecodedStruct {
        id,
        length,
        kind,
        origin: None,
        right_origin: None,
        parent_root: None,
        parent_id: None,
        parent_sub: None,
        content: None,
        info,
    };
    match info & CONTENT_REF_MASK {
        0 => Ok(bare(read_length(r, "GC length")?, StructKind::Gc)),
        // A raw varuint: it stands for a gap no run-length scheme predicts.
        10 => Ok(bare(read_length(r, "Skip length")?, StructKind::Skip)),
        _ => read_item(r, id, info),
    }
}

fn read_id(r: &mut Reader<'_>) -> Result<Id> {
    let client = r.read_var_uint()?;
    Ok(Id::new(client, r.read_var_uint()?))
}

fn read_item(r: &mut Reader<'_>, id: Id, info: u8) -> Result<DecodedStruct> {
    let origin = if info & ORIGIN_BIT != 0 {
        Some(read_id(r)?)
    } else {
        None
    };
    let right_origin = if info & RIGHT_ORIGIN_BIT != 0 {
        Some(read_id(r)?)
    } else {
        None
    };
    let mut parent_root = None;
    let mut parent_id = None;
    let mut parent_sub = None;
    // Parent and parentSub are on the wire only when neither origin is.
    if origin.is_none() && right_origin.is_none() {
        match r.read_var_uint()? {
            1 => parent_root = Some(r.read_var_string()?),
            0 => parent_id = Some(read_id(r)?),
            parent_info => {
                return Err(format_err!(
                    "yjs: the parent info at {} is {parent_info}; a v1 update writes 1 for a root name and 0 for a parent id.",
                    r.pos()
                ));
            }
        }
        if info & PARENT_SUB_BIT != 0 {
            parent_sub = Some(r.read_var_string()?);
        }
    }
    let content = read_content(info, r)?;
    if let Content::Deleted(0) = content {
        // yjs throws on this one mid-apply; refusing it here leaves the doc as it was.
        return Err(format_err!(
            "yjs: the deleted item at {}:{} has length 0.",
            id.client,
            id.clock
        ));
    }
    Ok(DecodedStruct {
        id,
        length: content.len(),
        kind: StructKind::Item,
        origin,
        right_origin,
        parent_root,
        parent_id,
        parent_sub,
        content: Some(content),
        info,
    })
}

/// Guards a count the engine holds in an int32, as C# does.
fn read_length(r: &mut Reader<'_>, what: &str) -> Result<usize> {
    let value = r.read_var_uint()?;
    if value > (1 << 31) - 1 {
        return Err(format_err!(
            "yjs: the {what} at {} is {value}, past int.MaxValue.",
            r.pos()
        ));
    }
    Ok(value as usize)
}

fn read_json(r: &mut Reader<'_>, what: &str) -> Result<Str> {
    let raw = r.read_var_string()?;
    validate_json(&raw, r.pos(), what)?;
    Ok(raw)
}

fn read_content(info: u8, r: &mut Reader<'_>) -> Result<Content> {
    let content = match info & CONTENT_REF_MASK {
        1 => Content::Deleted(read_length(r, "ContentDeleted length")?),
        2 => {
            let count = read_length(r, "ContentJSON element count")?;
            let mut raws = Vec::new();
            for _ in 0..count {
                let raw = r.read_var_string()?;
                // 'undefined' is yjs's sentinel and deliberately not JSON.
                if !is_undefined_sentinel(&raw) {
                    validate_json(&raw, r.pos(), "ContentJSON element")?;
                }
                raws.push(raw);
            }
            Content::Json(raws)
        }
        3 => Content::Binary(Arc::new(r.read_var_bytes()?.to_vec())),
        4 => Content::String(r.read_var_string()?),
        5 => Content::Embed(Arc::new(read_json(r, "ContentEmbed")?)),
        6 => {
            let key = r.read_var_string()?;
            let json = read_json(r, "ContentFormat")?;
            Content::Format(Arc::new(FormatContent::new(key, json)))
        }
        7 => Content::Type(read_content_type(r)?),
        8 => {
            let count = read_length(r, "ContentAny element count")?;
            let mut items = Vec::new();
            for _ in 0..count {
                items.push(blok_lib0::read_any(r)?);
            }
            Content::Any(items)
        }
        9 => {
            let guid = r.read_var_string()?;
            let options = blok_lib0::read_any(r)?;
            // yjs spreads these into a Doc constructor, so null and
            // undefined are a TypeError on every yjs peer.
            match options {
                Value::Null => {
                    return Err(format_err!(
                        "yjs: the subdocument options at {} are null; yjs writes an object.",
                        r.pos()
                    ));
                }
                Value::Undefined => {
                    return Err(format_err!(
                        "yjs: the subdocument options at {} are undefined; yjs writes an object.",
                        r.pos()
                    ));
                }
                _ => {}
            }
            Content::Doc(Arc::new(Subdoc { guid, options }))
        }
        content_ref => {
            return Err(format_err!(
                "yjs: {content_ref} at {} is not an item content ref.",
                r.pos() - 1
            ));
        }
    };
    Ok(content)
}

pub(crate) fn read_content_type(r: &mut Reader<'_>) -> Result<TypeRef> {
    let type_ref = r.read_var_uint()?;
    if type_ref > u64::from(MAX_TYPE_REF) {
        return Err(format_err!(
            "yjs: {type_ref} at {} is not a shared type ref.",
            r.pos()
        ));
    }
    let kind = TypeKind::from_ref(type_ref as u8).expect("a ref up to 6");
    let name = if matches!(kind, TypeKind::XmlElement | TypeKind::XmlHook) {
        Some(r.read_var_string()?)
    } else {
        None
    };
    Ok(TypeRef::new_detached(kind, name))
}

impl DecodedUpdate {
    /// Whether any string the update carries holds a NUL. It never refuses.
    pub fn contains_nul(&self) -> bool {
        self.groups.iter().flat_map(|g| &g.structs).any(|decoded| {
            has_nul(decoded.parent_root.as_ref())
                || has_nul(decoded.parent_sub.as_ref())
                || decoded.content.as_ref().is_some_and(content_has_nul)
        })
    }
}

fn has_nul(value: Option<&Str>) -> bool {
    value.is_some_and(|value| units_have_nul(value))
}

fn units_have_nul(value: &[u16]) -> bool {
    value.contains(&0)
}

fn content_has_nul(content: &Content) -> bool {
    match content {
        Content::String(text) => units_have_nul(text),
        Content::Format(format) => units_have_nul(&format.key) || units_have_nul(&format.json),
        Content::Embed(json) => units_have_nul(json),
        Content::Json(raws) => raws.iter().any(|raw| units_have_nul(raw)),
        Content::Type(handle) => has_nul(handle.name()),
        Content::Doc(doc) => units_have_nul(&doc.guid) || any_has_nul(&doc.options),
        Content::Any(items) => items.iter().any(any_has_nul),
        Content::Deleted(_) | Content::Binary(_) => false,
    }
}

fn any_has_nul(value: &Value) -> bool {
    let mut pending = vec![value];
    while let Some(current) = pending.pop() {
        match current {
            Value::String(text) => {
                if units_have_nul(text) {
                    return true;
                }
            }
            Value::Object(object) => {
                for member in object.members() {
                    if units_have_nul(&member.key) {
                        return true;
                    }
                    pending.push(&member.value);
                }
            }
            Value::Array(items) => pending.extend(items),
            _ => {}
        }
    }
    false
}

/// The deepest Any nesting in ContentAny and ContentDoc. Raw JSON is not
/// measured.
fn measure_nesting(groups: &[ClientStructs]) -> usize {
    let mut deepest = 0;
    for decoded in groups.iter().flat_map(|g| &g.structs) {
        match &decoded.content {
            Some(Content::Any(items)) => {
                for item in items {
                    deepest = deepest.max(any_depth(item));
                }
            }
            Some(Content::Doc(doc)) => deepest = deepest.max(any_depth(&doc.options)),
            _ => {}
        }
    }
    deepest
}

fn any_depth(value: &Value) -> usize {
    let mut deepest = 0;
    let mut pending = vec![(value, 0)];
    while let Some((current, depth)) = pending.pop() {
        match current {
            Value::Object(object) => {
                deepest = deepest.max(depth + 1);
                pending.extend(object.members().iter().map(|m| (&m.value, depth + 1)));
            }
            Value::Array(items) => {
                deepest = deepest.max(depth + 1);
                pending.extend(items.iter().map(|item| (item, depth + 1)));
            }
            _ => {}
        }
    }
    deepest
}

/// UpdateInspector's answer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    Ok,
    Malformed,
    TooDeep,
}

/// A verdict with its reason and, when OK, the decoded update.
#[derive(Clone, Debug)]
pub struct Inspection {
    pub verdict: Verdict,
    pub reason: String,
    pub decoded: Option<DecodedUpdate>,
}

/// The room's nesting cap.
pub const DEFAULT_INSPECT_DEPTH: usize = 256;

/// Decodes once and judges the update.
pub fn inspect(update: &[u8], max_depth: usize) -> Inspection {
    match decode(update) {
        Err(err) => Inspection {
            verdict: Verdict::Malformed,
            reason: err.to_string(),
            decoded: None,
        },
        Ok(decoded) if decoded.max_nesting_depth > max_depth => Inspection {
            verdict: Verdict::TooDeep,
            reason: format!(
                "yjs: a value nests {} levels, past the {max_depth} allowed.",
                decoded.max_nesting_depth
            ),
            decoded: None,
        },
        Ok(decoded) => Inspection {
            verdict: Verdict::Ok,
            reason: String::new(),
            decoded: Some(decoded),
        },
    }
}

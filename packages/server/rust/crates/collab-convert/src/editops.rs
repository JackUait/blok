use std::fmt;

use blok_jsjson::{ErrorKind, Kind, Node, Options, Str, append_quoted, parse_node};
use blok_yjs::Out;
use sha2::{Digest, Sha256};

use crate::error::Error;
use crate::richtext::is;

/// A refused edit request (C# CollabEditException): a 422 whose body is the
/// message, or a 413 when err is the runtime's memory budget.
#[derive(Debug)]
pub struct EditError {
    pub message: String,
    pub err: Option<Box<Error>>,
}

impl EditError {
    pub fn new(message: impl Into<String>) -> EditError {
        EditError {
            message: message.into(),
            err: None,
        }
    }
}

impl fmt::Display for EditError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for EditError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.err
            .as_deref()
            .map(|err| err as &(dyn std::error::Error + 'static))
    }
}

/// One block-level operation. Only Insert, Update and Remove come from
/// POST /edit; the rest are built by restore and the agent.
#[derive(Clone, Debug, PartialEq)]
pub enum EditOp {
    /// Places block after `after` (None = first) under `parent` (None = the root).
    Insert {
        id: Str,
        block: Node,
        after: Option<Str>,
        parent: Option<Str>,
    },
    /// Replaces the block's data map wholesale.
    Update { id: Str, data: Node },
    /// Removes the block and everything under it.
    Remove { id: Str },
    /// Sets or deletes keys of the page and values maps. Restore only.
    PatchMaps { patches: Vec<MapPatch> },
    /// Writes the page title or icon; None or "" deletes it. Agent only.
    SetPageField { key: Str, value: Option<Node> },
    /// Places an existing block, keeping its map. Agent only.
    Move {
        id: Str,
        after: Option<Str>,
        parent: Option<Str>,
    },
    /// Moves the block's children into its slot, right after it. Agent only.
    Lift { id: Str },
    /// Sets the type and replaces the data. Agent only.
    Retype { id: Str, kind: Str, data: Node },
    /// Writes each named tune; a null deletes it. Agent only.
    SetTunes { id: Str, tunes: Node },
    /// Writes lastEditedAt, lastEditedBy and lastEditedWith. Agent only.
    SetMetadata {
        id: Str,
        last_edited_at: f64,
        last_edited_by: Str,
        last_edited_with: Option<Str>,
    },
}

/// One key of a root map: set to value, or deleted when remove.
#[derive(Clone, Debug, PartialEq)]
pub struct MapPatch {
    pub map: Str,
    pub key: Str,
    pub value: Out,
    pub remove: bool,
}

/// YDocConverter.JsonMaxDepth, the reader bound for edits and the doc endpoint.
pub const JSON_MAX_DEPTH: usize = 512;

const NOT_UNICODE_BODY: &str = "collab: the request body holds text that is not valid Unicode.";

/// Reads POST /edit: {"ops":[…]} with at least one op, each a closed
/// schema, and no NUL in any string of any op.
pub fn parse_edit_ops(body: &[u8]) -> Result<Vec<EditOp>, Error> {
    let root = parse_node(
        body,
        Options {
            max_depth: JSON_MAX_DEPTH,
            refuse_duplicates: true,
        },
    )
    .map_err(|err| {
        refusal(
            err.into(),
            Some("collab: the request body is not valid JSON."),
        )
    })?;
    parse_ops(&root).map_err(|err| refusal(err, None))
}

/// Maps a reader error the way C# maps its exceptions: a string .NET cannot
/// read (InvalidOperationException) is a Unicode refusal, other reader
/// errors (JsonException) the given message.
fn refusal(err: Error, invalid_json: Option<&str>) -> Error {
    match err {
        Error::Json(json)
            if json.is(ErrorKind::LoneSurrogate) || json.is(ErrorKind::InvalidUtf8) =>
        {
            EditError::new(NOT_UNICODE_BODY).into()
        }
        Error::Edit(_) => err,
        _ => match invalid_json {
            Some(message) => EditError::new(message).into(),
            None => err,
        },
    }
}

fn parse_ops(root: &Node) -> Result<Vec<EditOp>, Error> {
    let requested = member(root, "ops")?;
    let Some(requested) = requested
        .filter(|r| root.kind == Kind::Object && r.kind == Kind::Array && !r.items.is_empty())
    else {
        return Err(EditError::new(
            r#"collab: the request body must be an object with a non-empty "ops" array."#,
        )
        .into());
    };
    requested
        .items
        .iter()
        .enumerate()
        .map(|(index, item)| parse_op(item, index))
        .collect()
}

/// Looks up a key the way a JsonObject does: its first read decodes every
/// key of the object, so any bad key fails it. None for a non-object.
pub(crate) fn member<'a>(
    object: &'a Node,
    key: &str,
) -> Result<Option<&'a Node>, blok_jsjson::Error> {
    if object.kind != Kind::Object {
        return Ok(None);
    }
    let want: Vec<u16> = key.encode_utf16().collect();
    let mut found = None;
    for m in &object.members {
        let name = m.key()?;
        if found.is_none() && name[..] == want[..] {
            found = Some(&m.value);
        }
    }
    Ok(found)
}

fn parse_op(node: &Node, index: usize) -> Result<EditOp, Error> {
    if node.kind != Kind::Object {
        return Err(refused(index, "an op must be a JSON object"));
    }
    guard_no_nul(node, index)?;
    let kind = required_string(node, "op", index)?;
    if is(&kind, "insert") {
        allowed_members(node, index, &["op", "id", "block", "after", "parent"])?;
        let id = required_string(node, "id", index)?;
        let block = insert_block(node, index)?;
        let after = optional_string(node, "after", index)?;
        let parent = optional_string(node, "parent", index)?;
        return Ok(EditOp::Insert {
            id,
            block: block.clone(),
            after,
            parent,
        });
    }
    if is(&kind, "update") {
        allowed_members(node, index, &["op", "id", "data"])?;
        let id = required_string(node, "id", index)?;
        let data = required_object(node, "data", index)?;
        return Ok(EditOp::Update {
            id,
            data: data.clone(),
        });
    }
    if is(&kind, "remove") {
        allowed_members(node, index, &["op", "id"])?;
        let id = required_string(node, "id", index)?;
        return Ok(EditOp::Remove { id });
    }
    Err(refused(
        index,
        r#""op" must be "insert", "update" or "remove""#,
    ))
}

/// Everything the converter writes for a block except its place in the
/// tree, which the op owns.
fn insert_block(op: &Node, index: usize) -> Result<&Node, Error> {
    let id = required_string(op, "id", index)?;
    let block = required_object(op, "block", index)?;
    allowed_members(
        block,
        index,
        &[
            "id",
            "type",
            "data",
            "tunes",
            "lastEditedAt",
            "lastEditedBy",
            "lastEditedWith",
            "createdAt",
            "createdBy",
            "createdWith",
        ],
    )?;
    if has(block, "id") && required_string(block, "id", index)? != id {
        return Err(refused(
            index,
            r#"the block's "id" disagrees with the op's"#,
        ));
    }
    required_string(block, "type", index)?;
    required_object(block, "data", index)?;
    if has(block, "tunes") {
        required_object(block, "tunes", index)?;
    }
    // A null time passes: C# tests "is { }" before the kind.
    for key in ["lastEditedAt", "createdAt"] {
        if let Ok(Some(value)) = member(block, key)
            && value.kind != Kind::Null
            && value.kind != Kind::Number
        {
            return Err(refused(
                index,
                &format!(r#"the block's "{key}" must be a number"#),
            ));
        }
    }
    for key in ["lastEditedBy", "createdBy", "createdWith", "lastEditedWith"] {
        if has(block, key) {
            required_string(block, key, index)?;
        }
    }
    Ok(block)
}

/// JsonObject.ContainsKey. Keys were decoded by the NUL guard already.
fn has(object: &Node, key: &str) -> bool {
    matches!(member(object, key), Ok(Some(_)))
}

fn allowed_members(object: &Node, index: usize, allowed: &[&str]) -> Result<(), Error> {
    for m in &object.members {
        let name = m.key()?;
        if !allowed.iter().any(|a| is(&name, a)) {
            return Err(refused(
                index,
                &format!(r#""{name}" is not part of this op"#),
            ));
        }
    }
    Ok(())
}

fn required_string(object: &Node, key: &str, index: usize) -> Result<Str, Error> {
    if let Some(value) = member(object, key)?
        && value.kind == Kind::String
    {
        let text = value.text()?;
        if !text.is_empty() {
            return Ok(text);
        }
    }
    Err(refused(
        index,
        &format!(r#""{key}" must be a non-empty string"#),
    ))
}

/// Absent and null both mean "not given".
fn optional_string(object: &Node, key: &str, index: usize) -> Result<Option<Str>, Error> {
    match member(object, key)? {
        None => Ok(None),
        Some(value) if value.kind == Kind::Null => Ok(None),
        Some(_) => required_string(object, key, index).map(Some),
    }
}

fn required_object<'a>(object: &'a Node, key: &str, index: usize) -> Result<&'a Node, Error> {
    match member(object, key)? {
        Some(value) if value.kind == Kind::Object => Ok(value),
        _ => Err(refused(index, &format!(r#""{key}" must be a JSON object"#))),
    }
}

/// Walks every key and string in document order; the reader's depth bound
/// keeps the recursion short.
fn guard_no_nul(node: &Node, index: usize) -> Result<(), Error> {
    match node.kind {
        Kind::Object => {
            // C# enumerates a JsonObject, which decodes all its keys first.
            let mut names = Vec::with_capacity(node.members.len());
            for m in &node.members {
                names.push(m.key()?);
            }
            for (name, m) in names.iter().zip(&node.members) {
                if name.contains(&0) {
                    return Err(nul_refused(index));
                }
                guard_no_nul(&m.value, index)?;
            }
        }
        Kind::Array => {
            for item in &node.items {
                guard_no_nul(item, index)?;
            }
        }
        Kind::String if node.text()?.contains(&0) => return Err(nul_refused(index)),
        _ => {}
    }
    Ok(())
}

fn nul_refused(index: usize) -> Error {
    refused(
        index,
        "a string contains a NUL character, which this endpoint does not accept",
    )
}

fn refused(index: usize, reason: &str) -> Error {
    EditError::new(format!("collab: op {index}: {reason}.")).into()
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Maps a printable key of 1–128 bytes to a 32-hex op id.
pub fn normalize_idempotency_key(key: &[u8]) -> Option<String> {
    if key.is_empty() || key.len() > 128 || key.iter().any(|&b| !(b' '..=b'~').contains(&b)) {
        return None;
    }
    Some(to_hex(&Sha256::digest(key)[..16]))
}

/// The restore key's digest: the request line, never the plan.
pub fn restore_digest(lineage: &str, sequence: u64) -> Vec<u8> {
    Sha256::digest(format!("restore\n{lineage}\n{sequence}")).to_vec()
}

/// The SHA-256 of `canonical_body`.
pub fn canonical_body_digest(ops: &[EditOp]) -> Result<Vec<u8>, Error> {
    Ok(Sha256::digest(canonical_body(ops)?).to_vec())
}

/// Stable JSON for parsed ops, independent of whitespace and key order,
/// written the way Utf8JsonWriter writes it (the digest is stored in the
/// journal, so one byte of difference turns a retry into a 409).
pub fn canonical_body(ops: &[EditOp]) -> Result<Vec<u8>, Error> {
    let mut out = br#"{"ops":["#.to_vec();
    for (i, op) in ops.iter().enumerate() {
        if i > 0 {
            out.push(b',');
        }
        append_canonical_op(&mut out, op)?;
    }
    out.extend_from_slice(b"]}");
    Ok(out)
}

struct CanonicalWriter<'a> {
    out: &'a mut Vec<u8>,
    first: bool,
}

impl CanonicalWriter<'_> {
    fn name(&mut self, key: &str) {
        if !self.first {
            self.out.push(b',');
        }
        self.first = false;
        append_quoted(self.out, &Str::from(key));
        self.out.push(b':');
    }

    fn text(&mut self, key: &str, value: Option<&Str>) {
        self.name(key);
        match value {
            Some(value) => append_quoted(self.out, value),
            None => self.out.extend_from_slice(b"null"),
        }
    }

    fn str(&mut self, key: &str, value: &Str) {
        self.text(key, Some(value));
    }

    fn literal(&mut self, key: &str, value: &str) {
        self.str(key, &Str::from(value));
    }

    fn node(&mut self, key: &str, value: Option<&Node>) -> Result<(), Error> {
        self.name(key);
        match value {
            Some(value) => value.append_canonical(self.out)?,
            None => self.out.extend_from_slice(b"null"),
        }
        Ok(())
    }
}

fn append_canonical_op(out: &mut Vec<u8>, op: &EditOp) -> Result<(), Error> {
    out.push(b'{');
    let mut w = CanonicalWriter { out, first: true };
    match op {
        EditOp::Insert {
            id,
            block,
            after,
            parent,
        } => {
            w.text("after", after.as_ref());
            w.node("block", Some(block))?;
            w.str("id", id);
            w.literal("op", "insert");
            w.text("parent", parent.as_ref());
        }
        EditOp::Update { id, data } => {
            w.node("data", Some(data))?;
            w.str("id", id);
            w.literal("op", "update");
        }
        EditOp::Remove { id } => {
            w.str("id", id);
            w.literal("op", "remove");
        }
        EditOp::Move { id, after, parent } => {
            w.text("after", after.as_ref());
            w.str("id", id);
            w.literal("op", "move");
            w.text("parent", parent.as_ref());
        }
        EditOp::Lift { id } => {
            w.str("id", id);
            w.literal("op", "lift");
        }
        EditOp::Retype { id, kind, data } => {
            w.node("data", Some(data))?;
            w.str("id", id);
            w.literal("op", "retype");
            w.str("type", kind);
        }
        EditOp::SetTunes { id, tunes } => {
            w.str("id", id);
            w.literal("op", "setTunes");
            w.node("tunes", Some(tunes))?;
        }
        EditOp::SetMetadata {
            id,
            last_edited_at,
            last_edited_by,
            last_edited_with,
        } => {
            w.str("id", id);
            w.name("lastEditedAt");
            w.out
                .extend_from_slice(blok_dotnet::format_double(*last_edited_at).as_bytes());
            w.str("lastEditedBy", last_edited_by);
            if let Some(with) = last_edited_with {
                w.str("lastEditedWith", with);
            }
            w.literal("op", "setMetadata");
        }
        EditOp::SetPageField { key, value } => {
            w.str("key", key);
            w.literal("op", "setPageField");
            w.node("value", value.as_ref())?;
        }
        EditOp::PatchMaps { .. } => {
            return Err(Error::Message(
                "collab: a map patch comes only from restore, which never digests its ops.".into(),
            ));
        }
    }
    out.push(b'}');
    Ok(())
}

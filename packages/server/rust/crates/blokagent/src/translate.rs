use std::collections::{HashMap, HashSet};

use blok_collab_convert::EditOp;
use blok_jsjson::{Kind, Node, Str, new_null, new_object};

use crate::errors::{Error, from_json};
use crate::wire::{field, get, member, str_node, text};

/// C# RoomEditTranslator.Translate: the planner's edits as room ops.
/// `after` is the document the bundle returned, `result` its AgentResult.
pub(crate) fn translate(edits: &Node, after: &Node, result: &Node) -> Result<Vec<EditOp>, Error> {
    let mut blocks: HashMap<String, &Node> = HashMap::new();
    if let Some(listed) = field(Some(after), "blocks")?.filter(|l| l.kind == Kind::Array) {
        for block in listed.items.iter().filter(|b| b.kind == Kind::Object) {
            if let Some(id) = string_field(block, "id")? {
                blocks.insert(id, block);
            }
        }
    }

    // Data edits collapse into one Update at the last one, carrying the
    // final data: the room replaces data wholesale, so a patch alone would
    // lose keys.
    let mut last_data_edit: HashMap<String, usize> = HashMap::new();
    for (i, edit) in edits.items.iter().enumerate() {
        let op = string_field(edit, "op")?.unwrap_or_default();
        if op != "setData" && op != "setRichText" {
            continue;
        }
        if let Some(id) = string_field(edit, "id")? {
            last_data_edit.insert(id, i);
        }
    }

    let mut ops = Vec::new();
    for (i, edit) in edits.items.iter().enumerate() {
        if edit.kind != Kind::Object {
            return Err(invalid_data("An agent edit is not an object."));
        }
        let id = string_field(edit, "id")?;
        let op = string_field(edit, "op")?.unwrap_or_default();
        let known = id.as_deref().and_then(|id| blocks.get(id).copied());
        match (op.as_str(), id) {
            ("insert", _) => {
                let planned = object_field(edit, "block")?;
                let parent = string_field(edit, "parentId")?;
                let after_id = string_field(edit, "afterId")?;
                insert_tree(planned, parent, after_id, &blocks, &mut ops)?;
            }
            ("remove", Some(id)) => {
                // The bundle lifts the children into the slot; Remove alone
                // takes the subtree.
                let with_children = get(edit, "withChildren")?;
                if !with_children.is_some_and(|w| w.kind == Kind::True) {
                    ops.push(EditOp::Lift { id: s(&id) });
                }
                ops.push(EditOp::Remove { id: s(&id) });
            }
            ("move", Some(id)) => {
                let after_id = string_field(edit, "afterId")?;
                let parent = string_field(edit, "parentId")?;
                ops.push(EditOp::Move {
                    id: s(&id),
                    after: after_id.as_deref().map(s),
                    parent: parent.as_deref().map(s),
                });
            }
            ("setData" | "setRichText", Some(id))
                if last_data_edit.get(&id) == Some(&i) && known.is_some() =>
            {
                let data = object_field(known.expect("known"), "data")?;
                ops.push(EditOp::Update {
                    id: s(&id),
                    data: data.clone(),
                });
            }
            ("setTunes", Some(id)) if known.is_some() => {
                let named = object_field(edit, "tunes")?;
                let current = field(known, "tunes")?;
                // The final value of each tune the edit named; null where the
                // batch removed it.
                let mut tunes = new_object(Vec::new());
                for m in &named.members {
                    let key = m.key().map_err(from_json)?.to_string();
                    let value = field(current, &key)?.cloned().unwrap_or_else(new_null);
                    tunes.set(&key, value).map_err(from_json)?;
                }
                ops.push(EditOp::SetTunes { id: s(&id), tunes });
            }
            ("replaceType", Some(id)) if known.is_some() => {
                let block = known.expect("known");
                let Some(kind) = string_field(block, "type")? else {
                    return Err(invalid_data(&format!("Block \"{id}\" has no type.")));
                };
                let data = object_field(block, "data")?;
                ops.push(EditOp::Retype {
                    id: s(&id),
                    kind: s(&kind),
                    data: data.clone(),
                });
            }
            ("setPageField", _) => {
                let Some(key) = string_field(edit, "key")? else {
                    return Err(invalid_data("A page field edit has no key."));
                };
                let value = get(edit, "value")?.cloned();
                ops.push(EditOp::SetPageField {
                    key: s(&key),
                    value,
                });
            }
            _ => {}
        }
    }

    // Every block the bundle stamped: created, updated, moved and lifted.
    let changed = field(Some(result), "changed")?;
    let mut seen = HashSet::new();
    for kind in ["created", "updated", "moved"] {
        let Some(list) = field(changed, kind)?.filter(|l| l.kind == Kind::Array) else {
            continue;
        };
        for item in &list.items {
            let Some(stamped) = text(Some(item))? else {
                continue;
            };
            if !seen.insert(stamped.clone()) {
                continue;
            }
            let Some(block) = blocks.get(&stamped).copied() else {
                continue;
            };
            let Some(by) = string_field(block, "lastEditedBy")? else {
                continue;
            };
            let Some(at) = get(block, "lastEditedAt")?.filter(|at| at.kind == Kind::Number) else {
                continue;
            };
            let time = parse_double(at.raw()).ok_or_else(|| {
                Error::InvalidOperation(
                    "The JSON value is either too large or too small for a Double.".to_owned(),
                )
            })?;
            let with = string_field(block, "lastEditedWith")?;
            ops.push(EditOp::SetMetadata {
                id: s(&stamped),
                last_edited_at: time,
                last_edited_by: s(&by),
                last_edited_with: with.as_deref().map(s),
            });
        }
    }
    Ok(ops)
}

/// strconv.ParseFloat: a JSON number past the double range is an error,
/// where Rust's parse gives infinity.
fn parse_double(raw: &[u8]) -> Option<f64> {
    let value: f64 = std::str::from_utf8(raw).ok()?.parse().ok()?;
    value.is_finite().then_some(value)
}

fn insert_tree(
    planned: &Node,
    parent: Option<String>,
    after: Option<String>,
    blocks: &HashMap<String, &Node>,
    ops: &mut Vec<EditOp>,
) -> Result<(), Error> {
    let Some(id) = string_field(planned, "id")? else {
        return Err(invalid_data("A planned block has no id."));
    };
    let kind = get(planned, "type")?.cloned().unwrap_or_else(new_null);
    let data = object_field(planned, "data")?;
    let mut block = new_object(vec![member("type", kind), member("data", data.clone())]);
    if let Some(tunes) = get(planned, "tunes")?.filter(|t| t.kind == Kind::Object) {
        block.members.push(member("tunes", tunes.clone()));
    }

    // The creation stamp the bundle wrote, so the room saves the same
    // metadata. createdWith only travels with createdBy.
    if let Some(drafted) = blocks.get(&id).copied() {
        if let Some(created_at) = get(drafted, "createdAt")?.filter(|c| c.kind == Kind::Number) {
            block.members.push(member("createdAt", created_at.clone()));
        }
        if let Some(created_by) = string_field(drafted, "createdBy")? {
            block
                .members
                .push(member("createdBy", str_node(&created_by)));
            if let Some(created_with) = string_field(drafted, "createdWith")? {
                block
                    .members
                    .push(member("createdWith", str_node(&created_with)));
            }
        }
    }
    ops.push(EditOp::Insert {
        id: s(&id),
        block,
        after: after.as_deref().map(s),
        parent: parent.as_deref().map(s),
    });

    let Some(children) = get(planned, "children")?.filter(|c| c.kind == Kind::Array) else {
        return Ok(());
    };
    let mut previous: Option<String> = None;
    for child in &children.items {
        if child.kind != Kind::Object {
            return Err(invalid_data("An agent edit field is not an object."));
        }
        insert_tree(child, Some(id.clone()), previous.take(), blocks, ops)?;
        previous = string_field(child, "id")?;
    }
    Ok(())
}

fn s(value: &str) -> Str {
    Str::from(value)
}

fn invalid_data(message: &str) -> Error {
    Error::InvalidData(message.to_owned())
}

/// Text(node[key]); like the JsonObject indexer it fails on a node that is
/// not an object.
fn string_field(node: &Node, key: &str) -> Result<Option<String>, Error> {
    text(field(Some(node), key)?)
}

/// The translator's Object(node[key]).
fn object_field<'a>(node: &'a Node, key: &str) -> Result<&'a Node, Error> {
    field(Some(node), key)?
        .filter(|found| found.kind == Kind::Object)
        .ok_or_else(|| invalid_data("An agent edit field is not an object."))
}

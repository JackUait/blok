use std::collections::{BTreeMap, HashMap, HashSet};

use blok_collab_convert::{
    DocStructure, EditOp, KeyShape, MapPatch, PAGE_MAPS, PageMap, is_plain_map_value,
    longest_kept_order, plain_map_values_equal,
};
use blok_dotnet::format_double;
use blok_jsjson::{
    Node, Object, Str, Value, new_array, new_bool, new_member, new_null, new_number, new_object,
    new_string,
};
use blok_yjs::Out;

use crate::changes::{data_of, parent_of, same_data, string_of, tunes_of, type_of};

/// CollabRestorePlanner.Plan: /edit ops that make the live doc equal the
/// target. Blocks that can stay keep their place; everything else is
/// removed and inserted again. Page and values keys are patched with plain
/// JSON only.
pub fn plan_restore(
    current_blocks: &[Value],
    current: &DocStructure,
    target_blocks: &[Value],
    current_maps: &[PageMap],
    target_maps: &[PageMap],
) -> Vec<EditOp> {
    plan_restore_trashing(
        current_blocks,
        current,
        target_blocks,
        current_maps,
        target_maps,
        None,
    )
}

/// Who restores and when, in ms since the epoch. With it, a restore trashes
/// a page pointer the target lacks instead of removing it.
#[derive(Clone, Debug)]
pub struct RestoreTrash {
    pub by: Option<String>,
    pub at: i64,
}

/// plan_restore with the C# planner's trash argument.
pub fn plan_restore_trashing(
    current_blocks: &[Value],
    current: &DocStructure,
    target_blocks: &[Value],
    current_maps: &[PageMap],
    target_maps: &[PageMap],
    trash: Option<&RestoreTrash>,
) -> Vec<EditOp> {
    let with_trash;
    let target_blocks = match trash {
        Some(trash) => {
            with_trash = with_trashed_pages(current_blocks, target_blocks, trash);
            &with_trash[..]
        }
        None => target_blocks,
    };
    let mut ops = plan_blocks(current_blocks, current, target_blocks);
    let mut patches = Vec::new();
    for name in PAGE_MAPS {
        let live = page_map_entries(current_maps, name);
        let wanted = page_map_entries(target_maps, name);
        for key in live.keys().filter(|key| !wanted.contains_key(*key)) {
            patches.push(MapPatch {
                map: Str::from(*name),
                key: key.clone(),
                value: Out::Any(Value::Null),
                remove: true,
            });
        }
        for (key, value) in &wanted {
            // A shared type or undefined has no copy this server can make.
            if !is_plain_map_value(value) {
                continue;
            }
            if live
                .get(key)
                .is_some_and(|now| plain_map_values_equal(now, value))
            {
                continue;
            }
            patches.push(MapPatch {
                map: Str::from(*name),
                key: key.clone(),
                value: (*value).clone(),
                remove: false,
            });
        }
    }
    if !patches.is_empty() {
        ops.push(EditOp::PatchMaps { patches });
    }
    ops
}

/// The target plus every live page pointer it lacks, with trashed set, so the
/// sub-page is not cut off. A pointer keeps its place among its live
/// siblings; one whose parent the target lacks goes to the end of the root.
/// A pointer already trashed keeps its stamps.
fn with_trashed_pages(
    current_blocks: &[Value],
    target_blocks: &[Value],
    trash: &RestoreTrash,
) -> Vec<Value> {
    let mut target_ids: HashSet<Str> = target_blocks
        .iter()
        .filter_map(|item| match item {
            Value::Object(block) => string_of(block, "id").cloned(),
            _ => None,
        })
        .collect();
    let live: Vec<&Object> = current_blocks
        .iter()
        .filter_map(|item| match item {
            Value::Object(block) if string_of(block, "id").is_some() => Some(block),
            _ => None,
        })
        .collect();
    let mut slots: HashMap<Str, (Option<Str>, usize)> = HashMap::new();
    let mut counts: HashMap<Option<Str>, usize> = HashMap::new();
    for block in &live {
        let parent = parent_of(block).cloned();
        let count = counts.entry(parent.clone()).or_insert(0);
        slots
            .entry(target_id(block).clone())
            .or_insert((parent, *count));
        *count += 1;
    }
    let mut result: Vec<Value> = target_blocks.to_vec();
    for block in &live {
        let id = target_id(block);
        if type_of(block).is_none_or(|kind| *kind != Str::from("page"))
            || !target_ids.insert(id.clone())
        {
            continue;
        }
        let former = parent_of(block).cloned();
        let index = slots[id].1;
        let mut data = match data_of(block) {
            Value::Object(data) => data.clone(),
            _ => Object::new(),
        };
        if !is_trashed(data.get(&Str::from("trashed"))) {
            let mut stamp = Object::new();
            stamp.set(Str::from("at"), Value::Number(trash.at as f64));
            stamp.set(
                Str::from("by"),
                trash
                    .by
                    .as_deref()
                    .map_or(Value::Null, |by| Value::String(Str::from(by))),
            );
            stamp.set(
                Str::from("formerParentId"),
                former.clone().map_or(Value::Null, Value::String),
            );
            stamp.set(Str::from("formerIndex"), Value::Number(index as f64));
            data.set(Str::from("trashed"), Value::Object(stamp));
        }
        let mut trashed = Object::new();
        for member in block.members() {
            let name = member.key.to_string();
            if name == "parent" || name == "content" || name == "data" {
                continue;
            }
            trashed.set(member.key.clone(), member.value.clone());
        }
        trashed.set(Str::from("data"), Value::Object(data));
        match former {
            Some(parent) if !target_ids.contains(&parent) => result.push(Value::Object(trashed)),
            parent => {
                if let Some(parent) = &parent {
                    trashed.set(Str::from("parent"), Value::String(parent.clone()));
                }
                let at = slot_among_siblings(&result, parent.as_ref(), &slots, index);
                result.insert(at, Value::Object(trashed));
            }
        }
    }
    result
}

/// The page tool's readTrashed check, so a value it would drop is stamped
/// afresh here.
fn is_trashed(value: Option<&Value>) -> bool {
    let Some(Value::Object(trashed)) = value else {
        return false;
    };
    let id_or_null = |key: &str| {
        matches!(
            trashed.get(&Str::from(key)),
            Some(Value::Null | Value::String(_))
        )
    };
    matches!(trashed.get(&Str::from("at")), Some(Value::Number(at)) if at.is_finite())
        && id_or_null("by")
        && id_or_null("formerParentId")
        && matches!(
            trashed.get(&Str::from("formerIndex")),
            Some(Value::Number(index)) if *index >= 0.0 && index.fract() == 0.0
        )
}

/// Where in the target list a block goes so that, among the target's
/// children of parent, it follows every one that sat before it live.
fn slot_among_siblings(
    target: &[Value],
    parent: Option<&Str>,
    slots: &HashMap<Str, (Option<Str>, usize)>,
    index: usize,
) -> usize {
    let (mut first, mut after_last) = (None, None);
    for (position, item) in target.iter().enumerate() {
        let Value::Object(block) = item else {
            continue;
        };
        if parent_of(block) != parent {
            continue;
        }
        first.get_or_insert(position);
        if let Some(id) = string_of(block, "id")
            && let Some((live_parent, live_index)) = slots.get(id)
            && live_parent.as_ref() == parent
            && *live_index < index
        {
            after_last = Some(position + 1);
        }
    }
    after_last.or(first).unwrap_or(target.len())
}

/// The map's entries in ordinal key order; a later map of the same name wins.
fn page_map_entries<'a>(maps: &'a [PageMap], name: &str) -> BTreeMap<Str, &'a Out> {
    let mut entries = BTreeMap::new();
    for map in maps.iter().filter(|map| map.name == name) {
        for (key, value) in &map.entries {
            entries.insert(key.clone(), value);
        }
    }
    entries
}

fn plan_blocks(
    current_blocks: &[Value],
    current: &DocStructure,
    target_blocks: &[Value],
) -> Vec<EditOp> {
    let normalized = normalize_target(target_blocks);
    let target: Vec<&Object> = normalized
        .iter()
        .filter_map(|item| match item {
            Value::Object(block) => Some(block),
            _ => None,
        })
        .collect();
    let mut exported: HashMap<&Str, (&Object, usize)> = HashMap::new();
    for item in current_blocks {
        let Value::Object(block) = item else {
            continue;
        };
        if let Some(id) = string_of(block, "id")
            && !exported.contains_key(id)
        {
            let position = exported.len();
            exported.insert(id, (block, position));
        }
    }
    let has_target_children: HashSet<&Str> =
        target.iter().filter_map(|block| parent_of(block)).collect();
    let mut shapes: HashMap<&Str, &KeyShape> = HashMap::new();
    for shape in &current.keys {
        shapes.insert(&shape.id, shape);
    }
    let mut kept = kept_in_place(&target, &exported, current, &shapes, &has_target_children);
    let mut ops = Vec::new();
    let removed = removals(current_blocks, current, &shapes, &kept, &mut ops);
    kept.retain(|id| !removed.contains(id));
    for block in &target {
        let id = target_id(block);
        if !kept.contains(id) {
            continue;
        }
        let target_data = data_of(block);
        if !same_data(target_data, data_of(exported[id].0)) {
            let data = match target_data {
                Value::Object(_) => to_node(target_data),
                _ => new_object(Vec::new()),
            };
            ops.push(EditOp::Update {
                id: id.clone(),
                data,
            });
        }
    }
    // Pre-order, so a parent is in place before its first child.
    let mut last_child: HashMap<Option<&Str>, &Str> = HashMap::new();
    for block in &target {
        let id = target_id(block);
        let parent = parent_of(block);
        let after = last_child.insert(parent, id).cloned();
        if kept.contains(id) {
            continue;
        }
        ops.push(EditOp::Insert {
            id: id.clone(),
            block: to_node(&Value::Object(inserted_block(block))),
            after,
            parent: parent.cloned(),
        });
    }
    ops
}

/// normalize_target gives every block a string id.
fn target_id(block: &Object) -> &Str {
    string_of(block, "id").unwrap_or_else(|| unreachable!("a normalized block has an id"))
}

/// CollabRestorePlanner.NormalizeTarget: the target as a restore
/// reproduces it. A parent naming no target block becomes root, blocks come
/// in pre-order, content is rebuilt from the parent links, and empty tunes
/// are dropped.
pub fn normalize_target(target_blocks: &[Value]) -> Vec<Value> {
    let mut blocks: Vec<(&Str, &Object)> = Vec::new();
    let mut by_id: HashMap<&Str, &Object> = HashMap::new();
    for item in target_blocks {
        let Value::Object(block) = item else {
            continue;
        };
        let Some(id) = string_of(block, "id") else {
            continue;
        };
        if by_id.contains_key(id) {
            continue;
        }
        by_id.insert(id, block);
        blocks.push((id, block));
    }
    let mut parents: HashMap<&Str, Option<&Str>> = HashMap::new();
    for (id, block) in &blocks {
        let parent = parent_of(block).filter(|named| named != id && by_id.contains_key(*named));
        parents.insert(id, parent);
    }
    let mut children: HashMap<Option<&Str>, Vec<&Str>> = HashMap::new();
    for (id, _) in &blocks {
        children.entry(parents[id]).or_default().push(id);
    }
    let mut ordered = Vec::new();
    let mut seen = HashSet::new();
    let starts: Vec<&Str> = children
        .get(&None)
        .into_iter()
        .flatten()
        .copied()
        .chain(blocks.iter().map(|(id, _)| *id))
        .collect();
    // A block still unreached sits on a parent cycle and is made a root.
    for start in starts {
        if seen.contains(start) {
            continue;
        }
        parents.insert(start, None);
        let mut pending = vec![start];
        while let Some(id) = pending.pop() {
            if !seen.insert(id) {
                continue;
            }
            ordered.push(id);
            if let Some(below) = children.get(&Some(id)) {
                pending.extend(below.iter().rev());
            }
        }
    }
    let (parent_key, content_key, tunes_key) = (
        Str::from("parent"),
        Str::from("content"),
        Str::from("tunes"),
    );
    ordered
        .into_iter()
        .map(|id| {
            let mut block = Object::new();
            for member in by_id[id].members() {
                if member.key == parent_key || member.key == content_key {
                    continue;
                }
                if member.key == tunes_key
                    && matches!(&member.value, Value::Object(tunes) if tunes.is_empty())
                {
                    continue;
                }
                block.set(member.key.clone(), member.value.clone());
            }
            if let Some(parent) = parents[id] {
                block.set(parent_key.clone(), Value::String(parent.clone()));
            }
            // A cycle member made root is still in its old parent's list.
            let content: Vec<Value> = children
                .get(&Some(id))
                .into_iter()
                .flatten()
                .filter(|child| parents[*child] == Some(id))
                .map(|child| Value::String((*child).clone()))
                .collect();
            if !content.is_empty() {
                block.set(content_key.clone(), Value::Array(content));
            }
            Value::Object(block)
        })
        .collect()
}

/// Per target parent, the anchorable live blocks under the same parent with
/// the same type and tunes, cut to the longest run whose live positions
/// increase.
fn kept_in_place<'a>(
    target: &[&'a Object],
    exported: &HashMap<&Str, (&Object, usize)>,
    current: &DocStructure,
    shapes: &HashMap<&Str, &KeyShape>,
    has_target_children: &HashSet<&Str>,
) -> HashSet<&'a Str> {
    let root_order: HashSet<&Str> = current.root_order.iter().collect();
    let mut parents = Vec::new();
    let mut groups: HashMap<Option<&Str>, Vec<&'a Str>> = HashMap::new();
    for block in target {
        let id = target_id(block);
        let (Some((live, _)), Some(shape)) = (exported.get(id), shapes.get(id)) else {
            continue;
        };
        if !shape.is_block || !current.reached(id) {
            continue;
        }
        let parent = parent_of(live);
        if parent != parent_of(block)
            || shape.stored_parent.as_ref() != parent
            || !lists_it(parent, id, shapes, &root_order)
            || type_of(live) != type_of(block)
            || !same_data(&tunes_of(live), &tunes_of(block))
            || (has_target_children.contains(id) && shape.listed.is_none())
        {
            continue;
        }
        if !groups.contains_key(&parent) {
            parents.push(parent);
        }
        groups.entry(parent).or_default().push(id);
    }
    let mut kept = HashSet::new();
    for parent in &parents {
        let members = &groups[parent];
        let positions: Vec<i64> = members.iter().map(|id| exported[id].1 as i64).collect();
        for index in longest_kept_order(&positions) {
            kept.insert(members[index]);
        }
    }
    kept
}

fn lists_it(
    parent: Option<&Str>,
    id: &Str,
    shapes: &HashMap<&Str, &KeyShape>,
    root_order: &HashSet<&Str>,
) -> bool {
    let Some(parent) = parent else {
        return root_order.contains(id);
    };
    shapes
        .get(parent)
        .and_then(|shape| shape.listed.as_ref())
        .is_some_and(|listed| listed.contains(id))
}

/// Every key that does not stay is removed, never twice; a remove takes
/// everything below it by stored parentId.
fn removals<'a>(
    current_blocks: &'a [Value],
    current: &'a DocStructure,
    shapes: &HashMap<&Str, &KeyShape>,
    kept: &HashSet<&Str>,
    ops: &mut Vec<EditOp>,
) -> HashSet<&'a Str> {
    let mut below: HashMap<&Str, Vec<&Str>> = HashMap::new();
    for shape in &current.keys {
        if let Some(parent) = &shape.stored_parent {
            below.entry(parent).or_default().push(&shape.id);
        }
    }
    // Export order first, so a parent's remove usually covers its children.
    let mut marked: Vec<&Str> = current_blocks
        .iter()
        .filter_map(|item| match item {
            Value::Object(block) => string_of(block, "id"),
            _ => None,
        })
        .filter(|id| shapes.contains_key(id))
        .collect();
    let mut sorted_keys: Vec<&Str> = current.keys.iter().map(|shape| &shape.id).collect();
    sorted_keys.sort();
    marked.extend(sorted_keys);

    let mut removed = HashSet::new();
    let mut distinct = HashSet::new();
    for id in marked {
        if kept.contains(id) || !distinct.insert(id) {
            continue;
        }
        if !removed.insert(id) {
            continue;
        }
        ops.push(EditOp::Remove { id: id.clone() });
        let mut pending = std::collections::VecDeque::from([id]);
        while let Some(next) = pending.pop_front() {
            for child in below.get(next).into_iter().flatten() {
                if removed.insert(*child) {
                    pending.push_back(child);
                }
            }
        }
    }
    removed
}

const INSERTED_KEYS: &[&str] = &[
    "type",
    "data",
    "tunes",
    "lastEditedAt",
    "lastEditedBy",
    "lastEditedWith",
    "createdAt",
    "createdBy",
    "createdWith",
];

/// Never parent or content: the op owns the position.
fn inserted_block(block: &Object) -> Object {
    let mut inserted = Object::new();
    for key in INSERTED_KEYS {
        let key = Str::from(*key);
        if let Some(value) = block.get(&key) {
            inserted.set(key, value.clone());
        }
    }
    inserted
}

/// An exported JS value as the node an edit op carries. Numbers are
/// written as .NET writes a double, which reads back the same; a peer's
/// bigint as its integer.
pub(crate) fn to_node(value: &Value) -> Node {
    match value {
        Value::Bool(b) => new_bool(*b),
        Value::Number(n) => new_number(&format_double(*n)),
        Value::BigInt(n) => new_number(&n.to_string()),
        Value::String(s) => new_string(s),
        Value::Object(object) => new_object(
            object
                .members()
                .iter()
                .map(|member| new_member(&member.key.to_string(), to_node(&member.value)))
                .collect(),
        ),
        Value::Array(items) => new_array(items.iter().map(to_node).collect()),
        Value::Null | Value::Undefined | Value::Bytes(_) => new_null(),
    }
}

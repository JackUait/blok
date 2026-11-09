use std::collections::{HashMap, HashSet};

use blok_jsjson::{Object, Str, Value};

use crate::changes::{parent_of, string_of, type_of};
use crate::restore::normalize_target;
use crate::restore_guards::RestoreGuard;

/// A kept database whose parent the restore removes. It is never
/// confirmable: the restore is refused.
pub const GUARD_ORPHANED_DATABASE: &str = "orphanedDatabase";

/// CollabKeptDatabases: the target with every kept block as it is now, the
/// kept blocks that exist now, and one guard per kept root the restore
/// would orphan.
#[derive(Debug, Default)]
pub struct KeptDatabases {
    pub target: Vec<Value>,
    pub pinned: HashSet<Str>,
    pub orphaned: Vec<RestoreGuard>,
}

fn is_database(block: &Object) -> bool {
    type_of(block).is_some_and(|kind| *kind == Str::from("database"))
}

/// CollabRestorePlanner.KeepDatabases: a databases=keep restore. Every
/// database on either side stays as it is now, with everything below it on
/// either side. One deleted since the point stays deleted; one made since
/// stays. Each kept root follows the nearest sibling it follows now. A kept
/// root whose parent the restore removes is orphaned.
pub fn keep_databases(current_blocks: &[Value], target_blocks: &[Value]) -> KeptDatabases {
    let normalized = normalize_target(target_blocks);
    let target: Vec<&Object> = normalized
        .iter()
        .filter_map(|item| match item {
            Value::Object(block) => Some(block),
            _ => None,
        })
        .collect();
    let mut live: HashMap<&Str, &Object> = HashMap::new();
    let mut live_order: Vec<&Str> = Vec::new();
    let mut live_children: HashMap<Option<&Str>, Vec<&Str>> = HashMap::new();
    let mut target_children: HashMap<Option<&Str>, Vec<&Str>> = HashMap::new();
    // First copy wins, as the planner reads the export.
    for item in current_blocks {
        let Value::Object(block) = item else {
            continue;
        };
        let Some(id) = string_of(block, "id") else {
            continue;
        };
        if live.contains_key(id) {
            continue;
        }
        live.insert(id, block);
        live_order.push(id);
        live_children.entry(parent_of(block)).or_default().push(id);
    }
    let mut by_id: HashMap<&Str, &Object> = HashMap::new();
    for block in &target {
        let id =
            string_of(block, "id").unwrap_or_else(|| unreachable!("a normalized block has an id"));
        by_id.insert(id, block);
        target_children
            .entry(parent_of(block))
            .or_default()
            .push(id);
    }

    let mut kept: HashSet<&Str> = HashSet::new();
    let mut pending: Vec<&Str> = live_order
        .iter()
        .copied()
        .filter(|id| is_database(live[id]))
        .chain(
            target
                .iter()
                .filter(|block| is_database(block))
                .filter_map(|block| string_of(block, "id")),
        )
        .collect();
    while let Some(id) = pending.pop() {
        if !kept.insert(id) {
            continue;
        }
        for children in [&live_children, &target_children] {
            pending.extend(children.get(&Some(id)).into_iter().flatten().copied());
        }
    }

    let mut placed: HashMap<Option<&Str>, Vec<&Str>> = HashMap::new();
    let mut restored: HashSet<&Str> = HashSet::new();
    for block in &target {
        let id = by_id
            .iter()
            .find(|(_, b)| std::ptr::eq(**b, *block))
            .map(|(id, _)| *id)
            .unwrap_or_else(|| unreachable!("every target block is indexed"));
        if kept.contains(id) {
            continue;
        }
        restored.insert(id);
        placed.entry(parent_of(block)).or_default().push(id);
    }

    let mut orphaned = Vec::new();
    let mut orphans: HashSet<&Str> = HashSet::new();
    // Roots in current order, so a kept root can follow one placed before it.
    for &id in &live_order {
        if !kept.contains(id) {
            continue;
        }
        let parent = parent_of(live[id]);
        if parent.is_some_and(|parent| kept.contains(parent) && live.contains_key(parent)) {
            continue;
        }
        if let Some(parent) = parent
            && !restored.contains(parent)
        {
            orphaned.push(RestoreGuard {
                kind: GUARD_ORPHANED_DATABASE,
                block_id: id.to_string(),
                view_id: None,
            });
            orphans.insert(id);
            placed.entry(None).or_default().push(id);
            continue;
        }
        let before = live_children.get(&parent).cloned().unwrap_or_default();
        let siblings = placed.entry(parent).or_default();
        let position = before.iter().position(|item| *item == id).unwrap_or(0);
        let at = before[..position]
            .iter()
            .rev()
            .find_map(|sibling| siblings.iter().position(|item| item == sibling))
            .map_or(0, |found| found + 1);
        siblings.insert(at, id);
    }

    let mut blocks = Vec::new();
    let mut walk: Vec<&Str> = placed.get(&None).cloned().unwrap_or_default();
    walk.reverse();
    while let Some(id) = walk.pop() {
        let children = if kept.contains(id) {
            let skip_parent = orphans.contains(id);
            blocks.push(Value::Object(
                live[id]
                    .members()
                    .iter()
                    .filter(|member| !(skip_parent && member.key == Str::from("parent")))
                    .map(|member| (member.key.clone(), member.value.renewed()))
                    .collect(),
            ));
            live_children.get(&Some(id))
        } else {
            blocks.push(Value::Object(by_id[id].clone()).renewed());
            placed.get(&Some(id))
        };
        walk.extend(children.into_iter().flatten().rev().copied());
    }

    KeptDatabases {
        target: blocks,
        pinned: kept
            .iter()
            .filter(|id| live.contains_key(*id))
            .map(|id| (*id).clone())
            .collect(),
        orphaned,
    }
}

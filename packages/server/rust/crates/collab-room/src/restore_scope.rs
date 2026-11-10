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

    let mut restored: HashMap<&Str, &Object> = HashMap::new();
    for block in &target {
        let id =
            string_of(block, "id").unwrap_or_else(|| unreachable!("a normalized block has an id"));
        if !kept.contains(id) {
            restored.insert(id, block);
        }
    }

    let mut orphaned = Vec::new();
    let mut orphans: HashSet<&Str> = HashSet::new();
    let mut orphan_roots: Vec<&Str> = Vec::new();
    // A kept root goes right after the nearest sibling it follows now that
    // the restore places under the same parent, or first. One pass in
    // current order: each parent's anchor is the last such sibling seen.
    let mut first: HashMap<Option<&Str>, Vec<&Str>> = HashMap::new();
    let mut after: HashMap<&Str, Vec<&Str>> = HashMap::new();
    let mut anchors: HashMap<Option<&Str>, &Str> = HashMap::new();
    for &id in &live_order {
        let parent = parent_of(live[id]);
        if !kept.contains(id) {
            if restored
                .get(id)
                .is_some_and(|block| parent_of(block) == parent)
            {
                anchors.insert(parent, id);
            }
            continue;
        }
        if parent.is_some_and(|parent| kept.contains(parent) && live.contains_key(parent)) {
            continue;
        }
        if let Some(parent) = parent
            && !restored.contains_key(parent)
        {
            orphaned.push(RestoreGuard {
                kind: GUARD_ORPHANED_DATABASE,
                block_id: id.to_string(),
                view_id: None,
            });
            orphans.insert(id);
            orphan_roots.push(id);
            continue;
        }
        match anchors.get(&parent) {
            Some(anchor) => after.entry(*anchor).or_default().push(id),
            None => first.entry(parent).or_default().push(id),
        }
        anchors.insert(parent, id);
    }
    let mut placed: HashMap<Option<&Str>, Vec<&Str>> = HashMap::new();
    for (key, ids) in &first {
        follow(&mut placed, &after, *key, ids);
    }
    for block in &target {
        let id =
            string_of(block, "id").unwrap_or_else(|| unreachable!("a normalized block has an id"));
        if restored.contains_key(id) {
            follow(&mut placed, &after, parent_of(block), &[id]);
        }
    }
    placed.entry(None).or_default().extend(orphan_roots);

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

/// Each id, then the roots that follow it, depth first; a stack, since a run
/// of kept roots can be long.
fn follow<'a>(
    placed: &mut HashMap<Option<&'a Str>, Vec<&'a Str>>,
    after: &HashMap<&'a Str, Vec<&'a Str>>,
    key: Option<&'a Str>,
    ids: &[&'a Str],
) {
    let mut stack: Vec<&Str> = ids.iter().rev().copied().collect();
    while let Some(id) = stack.pop() {
        placed.entry(key).or_default().push(id);
        stack.extend(after.get(id).into_iter().flatten().rev().copied());
    }
}

/// CollabRestoreGuards.Kept: the guards of a keep restore. Those of the kept
/// target, less any on a kept block, which stays as it is now, then the
/// orphans.
pub fn kept_restore_guards(current_blocks: &[Value], kept: &KeptDatabases) -> Vec<RestoreGuard> {
    let mut guards: Vec<RestoreGuard> =
        crate::restore_guards::restore_guards(current_blocks, &kept.target)
            .into_iter()
            .filter(|guard| !kept.pinned.contains(&Str::from(guard.block_id.as_str())))
            .collect();
    guards.extend(kept.orphaned.iter().cloned());
    guards
}

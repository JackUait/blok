//! Yjs's UndoManager, scoped to the whole document: a transaction is
//! captured while the owner says so (yjs's captureTransaction), and undo and
//! redo replay a step as new items, so a peer's concurrent edits stay. Port
//! of yjs 13.6 UndoManager, popStackItem and redoItem.

use std::collections::HashSet;

use crate::deleteset::DeleteSet;
use crate::doc::{DocState, TxnState};
use crate::item::{ItemId, Parent, Struct};
use crate::types::TypeId;
use crate::{EngineResult, Id};

/// One undoable step: what it inserted and what it deleted.
#[derive(Clone, Debug)]
pub(crate) struct StackItem {
    pub serial: u64,
    pub insertions: DeleteSet,
    pub deletions: DeleteSet,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct UndoState {
    pub undo: Vec<StackItem>,
    pub redo: Vec<StackItem>,
    pub capturing: bool,
    pub undoing: bool,
    pub redoing: bool,
    pub next_serial: u64,
}

/// Which stack a replay reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Undo,
    Redo,
}

fn is_deleted(set: &DeleteSet, id: Id) -> bool {
    set.ranges(id.client)
        .iter()
        .any(|r| r.clock <= id.clock && id.clock < r.clock + r.length)
}

impl DocState {
    /// yjs's afterTransactionHandler, run before the GC so the deleted items
    /// a step may bring back are kept.
    pub(crate) fn capture_step(&mut self, t: &TxnState) -> EngineResult<()> {
        let Some(mut um) = self.undo.take() else {
            return Ok(());
        };
        let result = self.capture_into(&mut um, t);
        self.undo = Some(um);
        result
    }

    fn capture_into(&mut self, um: &mut UndoState, t: &TxnState) -> EngineResult<()> {
        let tracked = um.undoing || um.redoing || (um.capturing && t.local);
        let Some(after) = &t.after_state else {
            return Ok(());
        };
        let mut insertions = DeleteSet::new();
        for client in after.clients() {
            let start = t.before_state.get(client);
            let end = after.get(client);
            if end > start {
                insertions.add(client, start, end - start);
            }
        }
        if !tracked || (insertions.is_empty() && t.delete_set.is_empty()) {
            return Ok(());
        }
        let serial = um.next_serial;
        um.next_serial += 1;
        let item = StackItem {
            serial,
            insertions,
            deletions: t.delete_set.clone(),
        };
        if um.undoing {
            um.redo.push(item);
        } else {
            if !um.redoing {
                um.redo.clear();
            }
            um.undo.push(item);
        }
        for at in self.structs_in(&t.delete_set)? {
            self.keep_item(at, true);
        }
        Ok(())
    }

    /// keepItem: the item and every holder above it survive the GC.
    fn keep_item(&mut self, mut at: ItemId, keep: bool) {
        loop {
            if self.store.items[at].keep == keep {
                return;
            }
            self.store.items[at].keep = keep;
            let Parent::Type(parent) = self.store.items[at].parent else {
                return;
            };
            match self.store.types[parent].item {
                Some(holder) => at = holder,
                None => return,
            }
        }
    }

    /// iterateDeletedStructs: the items the ranges cover, split on both
    /// edges. GC structs are skipped.
    pub(crate) fn structs_in(&mut self, set: &DeleteSet) -> EngineResult<Vec<ItemId>> {
        let mut found = Vec::new();
        for client in set.clients() {
            let Some(structs) = self.store.clients.get(&client) else {
                continue;
            };
            let last = *structs.last().expect("no empty run");
            let state = self.store.head(last).end();
            for r in set.ranges(client).to_vec() {
                if r.clock >= state || r.length == 0 {
                    continue;
                }
                let end = r.clock + r.length;
                self.store
                    .get_struct_clean_start(Id::new(client, r.clock))?;
                let mut index = self.store.find_index(client, r.clock)?;
                loop {
                    let current = self.store.clients[&client][index];
                    let head = self.store.head(current);
                    if head.id.clock >= end {
                        break;
                    }
                    if end < head.end() {
                        self.store.get_struct_clean_start(Id::new(client, end))?;
                    }
                    if let Struct::Item(at) = self.store.clients[&client][index] {
                        found.push(at);
                    }
                    index += 1;
                    if index >= self.store.clients[&client].len() {
                        break;
                    }
                }
            }
        }
        Ok(found)
    }

    /// followRedone: the live copy an id was redone to, and the offset into it.
    fn follow_redone(&self, id: Id) -> EngineResult<(Option<ItemId>, u64)> {
        let mut next = Some(id);
        let mut diff = 0;
        let mut item = None;
        while let Some(current) = next {
            let probe = Id::new(current.client, current.clock + diff);
            let Some(found) = self.store.find_item(probe)? else {
                return Ok((None, 0));
            };
            diff = probe.clock - self.store.items[found].id.clock;
            next = self.store.items[found].redone;
            item = Some(found);
        }
        Ok((item, diff))
    }

    fn holder_of(&self, at: ItemId) -> Option<ItemId> {
        match self.store.items[at].parent {
            Parent::Type(parent) => self.store.types[parent].item,
            _ => None,
        }
    }

    fn type_of_holder(&self, holder: Option<ItemId>, fallback: TypeId) -> Option<TypeId> {
        match holder {
            None => Some(fallback),
            Some(at) => match &self.store.items[at].content {
                crate::content::Content::Type(handle) => handle.attached_id(),
                _ => None,
            },
        }
    }

    fn deleted_by_stacks(&self, um: &UndoState, id: Id) -> bool {
        um.undo
            .iter()
            .chain(um.redo.iter())
            .any(|s| is_deleted(&s.deletions, id))
    }

    /// redoItem.
    fn redo_item(
        &mut self,
        um: &UndoState,
        at: ItemId,
        redo_items: &HashSet<ItemId>,
        items_to_delete: &DeleteSet,
    ) -> EngineResult<Option<ItemId>> {
        if let Some(redone) = self.store.items[at].redone {
            return Ok(Some(self.store.get_item_clean_start(redone)?));
        }
        let Parent::Type(own_parent) = self.store.items[at].parent else {
            return Ok(None);
        };
        let mut parent_item = self.store.types[own_parent].item;
        if let Some(mut holder) = parent_item
            && self.store.items[holder].deleted
        {
            if self.store.items[holder].redone.is_none()
                && (!redo_items.contains(&holder)
                    || self
                        .redo_item(um, holder, redo_items, items_to_delete)?
                        .is_none())
            {
                return Ok(None);
            }
            while let Some(redone) = self.store.items[holder].redone {
                holder = self.store.get_item_clean_start(redone)?;
            }
            parent_item = Some(holder);
        }
        let Some(parent_type) = self.type_of_holder(parent_item, own_parent) else {
            return Ok(None);
        };
        let parent_sub = self.store.items[at].parent_sub.clone();
        let (left, right) = match &parent_sub {
            None => {
                let mut left = self.store.items[at].left;
                while let Some(l) = left {
                    let mut trace = Some(l);
                    while let Some(t) = trace
                        && self.holder_of(t) != parent_item
                    {
                        trace = match self.store.items[t].redone {
                            Some(r) => Some(self.store.get_item_clean_start(r)?),
                            None => None,
                        };
                    }
                    if let Some(t) = trace
                        && self.holder_of(t) == parent_item
                    {
                        left = Some(t);
                        break;
                    }
                    left = self.store.items[l].left;
                }
                let mut right = Some(at);
                while let Some(r) = right {
                    let mut trace = Some(r);
                    while let Some(t) = trace
                        && self.holder_of(t) != parent_item
                    {
                        trace = match self.store.items[t].redone {
                            Some(next) => Some(self.store.get_item_clean_start(next)?),
                            None => None,
                        };
                    }
                    if let Some(t) = trace
                        && self.holder_of(t) == parent_item
                    {
                        right = Some(t);
                        break;
                    }
                    right = self.store.items[r].right;
                }
                (left, right)
            }
            Some(sub) => {
                let mut left;
                if self.store.items[at].right.is_some() {
                    left = Some(at);
                    while let Some(l) = left
                        && let Some(r) = self.store.items[l].right
                        && (self.store.items[r].redone.is_some()
                            || is_deleted(items_to_delete, self.store.items[r].id)
                            || self.deleted_by_stacks(um, self.store.items[r].id))
                    {
                        let mut next = r;
                        while let Some(redone) = self.store.items[next].redone {
                            next = self.store.get_item_clean_start(redone)?;
                        }
                        left = Some(next);
                    }
                    // A newer value from someone else sits on the key.
                    if left.is_some_and(|l| self.store.items[l].right.is_some()) {
                        return Ok(None);
                    }
                } else {
                    left = self.store.types[parent_type].map_get(sub);
                }
                if left.is_some_and(|l| self.holder_of(l) != parent_item) {
                    left = self.store.types[parent_type].map_get(sub);
                }
                (left, None)
            }
        };
        let content = self.store.items[at].content.copy();
        let mut item = self.new_item(parent_type, left, right, parent_sub, content);
        item.keep = true;
        self.store.items[at].redone = Some(item.id);
        let integrated = self.integrate(item, 0)?;
        if let Some(added) = integrated {
            self.keep_item(added, true);
        }
        Ok(integrated)
    }

    /// popStackItem's body, inside the open transaction. Answers the serial
    /// of the step it applied, or None when no step changed anything.
    pub(crate) fn pop_stack_item(&mut self, direction: Direction) -> EngineResult<Option<u64>> {
        let Some(mut um) = self.undo.take() else {
            return Ok(None);
        };
        let result = self.pop_into(&mut um, direction);
        self.undo = Some(um);
        result
    }

    fn pop_into(&mut self, um: &mut UndoState, direction: Direction) -> EngineResult<Option<u64>> {
        loop {
            let popped = match direction {
                Direction::Undo => um.undo.pop(),
                Direction::Redo => um.redo.pop(),
            };
            let Some(step) = popped else {
                return Ok(None);
            };
            let mut to_delete = Vec::new();
            for at in self.structs_in(&step.insertions)? {
                let mut current = at;
                if self.store.items[at].redone.is_some() {
                    let (followed, diff) = self.follow_redone(self.store.items[at].id)?;
                    let Some(mut followed) = followed else {
                        continue;
                    };
                    if diff > 0 {
                        let id = self.store.items[followed].id;
                        followed = self
                            .store
                            .get_item_clean_start(Id::new(id.client, id.clock + diff))?;
                    }
                    current = followed;
                }
                if !self.store.items[current].deleted {
                    to_delete.push(current);
                }
            }
            let mut to_redo = Vec::new();
            for at in self.structs_in(&step.deletions)? {
                if !is_deleted(&step.insertions, self.store.items[at].id) {
                    to_redo.push(at);
                }
            }
            let redo_set: HashSet<ItemId> = to_redo.iter().copied().collect();
            let mut changed = false;
            for at in to_redo {
                changed = self
                    .redo_item(um, at, &redo_set, &step.insertions)?
                    .is_some()
                    || changed;
            }
            // Children before parents.
            for at in to_delete.into_iter().rev() {
                self.delete(at)?;
                changed = true;
            }
            if changed {
                return Ok(Some(step.serial));
            }
        }
    }
}

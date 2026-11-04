use std::collections::HashSet;

use blok_jsjson::Str;

use crate::content::Content;
use crate::doc::DocState;
use crate::item::{Item, ItemId, Parent, Struct};
use crate::types::TypeId;
use crate::{EngineResult, Header, Id, fail};

impl DocState {
    /// The client whose structs must arrive first, or None once every
    /// dependency is in the store; then it resolves the neighbours. Nothing
    /// is mutated before all three checks pass, and the same client is
    /// checked too (stricter than yjs), so dishonest bytes park instead of
    /// failing mid-integration.
    pub(crate) fn get_missing(&mut self, item: &mut Item) -> EngineResult<Option<u64>> {
        let store = &mut self.store;
        if let Some(origin) = item.origin
            && origin.clock >= store.get_state(origin.client)
        {
            return Ok(Some(origin.client));
        }
        if let Some(right_origin) = item.right_origin
            && right_origin.clock >= store.get_state(right_origin.client)
        {
            return Ok(Some(right_origin.client));
        }
        if let Parent::Id(parent) = item.parent
            && parent.clock >= store.get_state(parent.client)
        {
            return Ok(Some(parent.client));
        }
        let mut left = None;
        let mut right = None;
        if let Some(origin) = item.origin {
            let found = store.get_item_clean_end(origin)?;
            item.origin = Some(store.head(found).last_id());
            left = Some(found);
        }
        if let Some(right_origin) = item.right_origin {
            let found = store.get_struct_clean_start(right_origin)?;
            item.right_origin = Some(store.head(found).id);
            right = Some(found);
        }
        item.left = match left {
            Some(Struct::Item(at)) => Some(at),
            _ => None,
        };
        item.right = match right {
            Some(Struct::Item(at)) => Some(at),
            _ => None,
        };
        let collected = matches!(left, Some(Struct::Gc(_))) || matches!(right, Some(Struct::Gc(_)));
        match std::mem::replace(&mut item.parent, Parent::None) {
            Parent::None => {
                if !collected {
                    let neighbour = item.left.or(item.right);
                    if let Some(neighbour) = neighbour {
                        let neighbour = &self.store.items[neighbour];
                        item.parent = neighbour.parent.clone();
                        item.parent_sub = neighbour.parent_sub.clone();
                    }
                }
            }
            Parent::Id(parent) => {
                if !collected
                    && let Some(found) = self.store.find_item(parent)?
                    && let Content::Type(handle) = &self.store.items[found].content
                    && let Some(id) = handle.attached_id()
                {
                    item.parent = Parent::Type(id);
                }
            }
            Parent::Root(name) => {
                if !collected {
                    item.parent = Parent::Type(self.root(&name).1);
                }
            }
            Parent::Type(id) => {
                if !collected {
                    item.parent = Parent::Type(id);
                }
            }
        }
        Ok(None)
    }

    /// YATA. offset trims the clocks the store already has. Answers the
    /// item's arena id, or None when it became a GC.
    pub(crate) fn integrate(
        &mut self,
        mut item: Box<Item>,
        offset: usize,
    ) -> EngineResult<Option<ItemId>> {
        if offset > 0 {
            item.id.clock += offset as u64;
            let trimmed = self
                .store
                .get_item_clean_end(Id::new(item.id.client, item.id.clock - 1))?;
            item.origin = Some(self.store.head(trimmed).last_id());
            item.left = match trimmed {
                Struct::Item(at) => Some(at),
                _ => {
                    // Our own prefix was collected; yjs walks into the GC and crashes.
                    item.parent = Parent::None;
                    None
                }
            };
            item.content = item.content.splice(offset)?;
            item.length -= offset;
        }
        let parent = match item.parent {
            Parent::None => {
                self.store.add_struct(Struct::Gc(item.header()))?;
                return Ok(None);
            }
            Parent::Type(parent) => parent,
            ref unresolved => fail!(
                "yjs: {} was integrated with an unresolved parent ({unresolved:?}); getMissing resolves it first.",
                item.id
            ),
        };
        let conflict = match item.left {
            None => item
                .right
                .is_none_or(|right| self.store.items[right].left.is_some()),
            Some(left) => self.store.items[left].right != item.right,
        };
        if conflict {
            item.left = self.scan_for_conflicts(&item, parent)?;
        }
        let parent_sub = item.parent_sub.clone();
        let id = self.store.alloc(*item);
        match self.store.items[id].left {
            Some(left) => {
                self.store.items[id].right = self.store.items[left].right;
                self.store.items[left].right = Some(id);
            }
            None => {
                self.store.items[id].right = self.first_at(parent, parent_sub.as_ref());
                if parent_sub.is_none() {
                    self.store.types[parent].start = Some(id);
                }
            }
        }
        if let Some(right) = self.store.items[id].right {
            self.store.items[right].left = Some(id);
        } else if let Some(sub) = &parent_sub {
            // Last one written for the key wins; the value it replaces dies here.
            self.store.types[parent].map_set_head(sub.clone(), id);
            if let Some(left) = self.store.items[id].left {
                self.delete(left)?;
            }
        }
        let added = &self.store.items[id];
        if parent_sub.is_none() && added.countable() && !added.deleted {
            self.store.types[parent].length += added.length as i64;
        }
        self.store.add_struct(Struct::Item(id))?;
        match &self.store.items[id].content {
            // The wire's own tombstone arrives deleted, so the deletion is
            // recorded in this transaction.
            Content::Deleted(ticks) => {
                let (at, ticks) = (self.store.items[id].id, *ticks as u64);
                self.txn()?.delete_set.add(at.client, at.clock, ticks);
                self.store.items[id].deleted = true;
            }
            Content::Type(handle) => {
                let handle = handle.clone();
                self.attach_type(&handle, id)?;
            }
            _ => {}
        }
        let parent_deleted = self.store.types[parent]
            .item
            .is_some_and(|holder| self.store.items[holder].deleted);
        if parent_deleted || (parent_sub.is_some() && self.store.items[id].right.is_some()) {
            self.delete(id)?;
        }
        Ok(Some(id))
    }

    /// Marks the item deleted and cascades into a nested type.
    pub(crate) fn delete(&mut self, id: ItemId) -> EngineResult<()> {
        if self.delete_here(id)?
            && let Content::Type(handle) = &self.store.items[id].content
            && let Some(nested) = handle.attached_id()
        {
            self.cascade_delete(nested)?;
        }
        Ok(())
    }

    /// The delete without the cascade; false when already deleted. The
    /// parent's length is adjusted before the mark, which stops the count.
    pub(crate) fn delete_here(&mut self, id: ItemId) -> EngineResult<bool> {
        let item = &self.store.items[id];
        if item.deleted {
            return Ok(false);
        }
        let Parent::Type(parent) = item.parent else {
            fail!(
                "yjs: {} was deleted before its parent was resolved.",
                item.id
            );
        };
        if item.countable() && item.parent_sub.is_none() {
            self.store.types[parent].length -= item.length as i64;
        }
        let (at, length) = (item.id, item.length as u64);
        self.store.items[id].deleted = true;
        self.txn()?.delete_set.add(at.client, at.clock, length);
        Ok(true)
    }

    // An already-deleted child older than this transaction is queued for
    // merging in yjs; the engine never merges, so it is skipped.
    /// Cascades into the whole subtree with an explicit stack.
    fn cascade_delete(&mut self, root: TypeId) -> EngineResult<()> {
        let mut pending = vec![root];
        while let Some(core) = pending.pop() {
            let mut current = self.store.types[core].start;
            while let Some(at) = current {
                self.cascade(at, &mut pending)?;
                current = self.store.items[at].right;
            }
            let heads: Vec<ItemId> = self.store.types[core].entries.iter().map(|e| e.1).collect();
            for head in heads {
                self.cascade(head, &mut pending)?;
            }
        }
        Ok(())
    }

    fn cascade(&mut self, at: ItemId, pending: &mut Vec<TypeId>) -> EngineResult<()> {
        if self.store.items[at].deleted {
            return Ok(());
        }
        if let Content::Type(handle) = &self.store.items[at].content {
            let nested = handle.attached_id();
            self.delete_here(at)?;
            pending.extend(nested);
            return Ok(());
        }
        self.delete(at)
    }

    /// Drops a deleted item's payload. Inside a collected parent the
    /// struct becomes a GC; on its own its content becomes a tombstone.
    pub(crate) fn gc_item(&mut self, at: ItemId, parent_collected: bool) -> EngineResult<()> {
        self.require_deleted(at)?;
        if let Content::Type(handle) = &self.store.items[at].content
            && let Some(nested) = handle.attached_id()
        {
            self.gc_subtree(nested)?;
        }
        self.collect_here(at, parent_collected)
    }

    fn collect_here(&mut self, at: ItemId, parent_collected: bool) -> EngineResult<()> {
        self.require_deleted(at)?;
        let item = &mut self.store.items[at];
        let header = Header {
            id: item.id,
            length: item.length,
        };
        // Either way the payload is unreachable now, so it is dropped.
        item.content = Content::Deleted(item.length);
        if parent_collected {
            self.store.replace_struct(header.id, Struct::Gc(header))?;
        }
        Ok(())
    }

    fn require_deleted(&self, at: ItemId) -> EngineResult<()> {
        if !self.store.items[at].deleted {
            fail!(
                "yjs: {} is still live and cannot be collected.",
                self.store.items[at].id
            );
        }
        Ok(())
    }

    /// Turns the subtree into GC structs. Map chains are walked LEFT from
    /// each head: the older values under a key are the rest of that chain.
    fn gc_subtree(&mut self, root: TypeId) -> EngineResult<()> {
        let mut pending = vec![root];
        while let Some(core) = pending.pop() {
            let mut current = self.store.types[core].start;
            while let Some(at) = current {
                self.collect(at, &mut pending)?;
                current = self.store.items[at].right;
            }
            self.store.types[core].start = None;
            let heads: Vec<ItemId> = self.store.types[core].entries.iter().map(|e| e.1).collect();
            for head in heads {
                let mut current = Some(head);
                while let Some(at) = current {
                    self.collect(at, &mut pending)?;
                    current = self.store.items[at].left;
                }
            }
            self.store.types[core].map_clear();
        }
        Ok(())
    }

    fn collect(&mut self, at: ItemId, pending: &mut Vec<TypeId>) -> EngineResult<()> {
        if let Content::Type(handle) = &self.store.items[at].content {
            pending.extend(handle.attached_id());
        }
        self.collect_here(at, true)
    }

    /// yjs's conflict scan. Case 1 is a tie at the same origin, broken by
    /// lower client id; case 2 is an item whose own origin sits before ours.
    fn scan_for_conflicts(&self, item: &Item, parent: TypeId) -> EngineResult<Option<ItemId>> {
        let mut left = item.left;
        let mut current = match left {
            Some(left) => self.store.items[left].right,
            None => self.first_at(parent, item.parent_sub.as_ref()),
        };
        let mut conflicting: HashSet<ItemId> = HashSet::new();
        let mut before_origin: HashSet<ItemId> = HashSet::new();
        while let Some(at) = current {
            if Some(at) == item.right {
                break;
            }
            before_origin.insert(at);
            conflicting.insert(at);
            let other = &self.store.items[at];
            if item.origin == other.origin {
                if other.id.client < item.id.client {
                    left = Some(at);
                    conflicting.clear();
                } else if item.right_origin == other.right_origin {
                    break;
                }
            } else if let Some(origin) = self.origin_item(other)?
                && before_origin.contains(&origin)
            {
                if !conflicting.contains(&origin) {
                    left = Some(at);
                    conflicting.clear();
                }
            } else {
                break;
            }
            current = self.store.items[at].right;
        }
        Ok(left)
    }

    fn origin_item(&self, current: &Item) -> EngineResult<Option<ItemId>> {
        match current.origin {
            None => Ok(None),
            Some(origin) => self.store.find_item(origin),
        }
    }

    /// The head of the chain a new item with no left neighbour joins.
    pub(crate) fn first_at(&self, parent: TypeId, parent_sub: Option<&Str>) -> Option<ItemId> {
        let core = &self.store.types[parent];
        let Some(sub) = parent_sub else {
            return core.start;
        };
        let mut head = core.map_get(sub)?;
        while let Some(left) = self.store.items[head].left {
            head = left;
        }
        Some(head)
    }
}

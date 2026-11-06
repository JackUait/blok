use std::collections::HashMap;

use blok_lib0::{Reader, Writer};

use crate::deleteset::DeleteSet;
use crate::item::{Item, ItemId, Parent, Runtime, Struct};
use crate::types::TypeCore;
use crate::{EngineResult, FormatError, Header, Id, fail, format_err};

/// Every integrated struct, one contiguous ascending run per client, plus
/// what could not be integrated yet. Clients keep the order they were first
/// added in, as a .NET Dictionary does. Items and types live in the two
/// arenas here.
#[derive(Debug, Default)]
pub(crate) struct Store {
    pub clients: HashMap<u64, Vec<Struct>>,
    pub order: Vec<u64>,
    pub items: Vec<Item>,
    pub types: Vec<TypeCore>,
    pub pending_structs: Vec<Runtime>,
    pub has_pending: bool,
    pub pending_ds: Option<DeleteSet>,
    pub pending_missing: Option<StateVector>,
}

impl Store {
    pub fn new() -> Store {
        Store::default()
    }

    pub fn head(&self, s: Struct) -> Header {
        match s {
            Struct::Item(id) => self.items[id].header(),
            Struct::Gc(h) => h,
        }
    }

    pub fn is_deleted(&self, s: Struct) -> bool {
        match s {
            Struct::Item(id) => self.items[id].deleted,
            _ => true,
        }
    }

    pub fn get_state(&self, client: u64) -> u64 {
        match self.clients.get(&client) {
            Some(structs) => self.head(*structs.last().expect("no empty run")).end(),
            None => 0,
        }
    }

    pub fn get_state_vector(&self) -> StateVector {
        let mut vector = StateVector::new();
        for &client in &self.order {
            vector.set(client, self.get_state(client));
        }
        vector
    }

    pub fn structs(&self, client: u64) -> EngineResult<&Vec<Struct>> {
        match self.clients.get(&client) {
            Some(structs) => Ok(structs),
            None => fail!("yjs: client {client} is not in the store."),
        }
    }

    pub fn find(&self, id: Id) -> EngineResult<Struct> {
        let index = self.find_index(id.client, id.clock)?;
        Ok(self.clients[&id.client][index])
    }

    pub fn find_item(&self, id: Id) -> EngineResult<Option<ItemId>> {
        Ok(match self.find(id)? {
            Struct::Item(item) => Some(item),
            _ => None,
        })
    }

    /// Bisects a client's contiguous run. A missing clock is an engine
    /// error: callers check the state first.
    pub fn find_index(&self, client: u64, clock: u64) -> EngineResult<usize> {
        let structs = self.structs(client)?;
        // yjs tests the last struct for an exact clock first. Only that
        // finds a length-0 last struct, which the state vector names:
        // without it every encode of such a document fails.
        if let Some(&last) = structs.last()
            && self.head(last).id.clock == clock
        {
            return Ok(structs.len() - 1);
        }
        let (mut left, mut right) = (0usize, structs.len());
        while left < right {
            let middle = left + (right - left) / 2;
            let current = self.head(structs[middle]);
            if clock < current.id.clock {
                right = middle;
                continue;
            }
            if clock < current.end() {
                return Ok(middle);
            }
            left = middle + 1;
        }
        fail!("yjs: client {client} has no struct at clock {clock}; check the state first.")
    }

    pub fn get_item_clean_start(&mut self, id: Id) -> EngineResult<ItemId> {
        match self.get_struct_clean_start(id)? {
            Struct::Item(item) => Ok(item),
            _ => fail!("yjs: {id} is a collected struct, not an item."),
        }
    }

    /// The struct starting exactly at id, splitting the item that covers
    /// it. A GC is returned whole.
    pub fn get_struct_clean_start(&mut self, id: Id) -> EngineResult<Struct> {
        let index = self.find_index(id.client, id.clock)?;
        let found = self.clients[&id.client][index];
        if let Struct::Item(item) = found
            && self.items[item].id.clock < id.clock
        {
            let diff = (id.clock - self.items[item].id.clock) as usize;
            return Ok(Struct::Item(self.split(id.client, index, item, diff)?));
        }
        Ok(found)
    }

    /// The struct ending exactly at id. A GC is returned whole.
    pub fn get_item_clean_end(&mut self, id: Id) -> EngineResult<Struct> {
        let index = self.find_index(id.client, id.clock)?;
        let found = self.clients[&id.client][index];
        if let Struct::Item(item) = found
            && id.clock != self.items[item].last_id().clock
        {
            let diff = (id.clock - self.items[item].id.clock) as usize + 1;
            self.split(id.client, index, item, diff)?;
        }
        Ok(found)
    }

    pub fn replace_struct(&mut self, existing: Id, replacement: Struct) -> EngineResult<()> {
        let index = self.find_index(existing.client, existing.clock)?;
        self.clients.get_mut(&existing.client).expect("found")[index] = replacement;
        Ok(())
    }

    // yjs queues each split's halves for merging; the engine never merges
    // (C# and Go do not either), so nothing is queued.
    /// Cuts item and files the right half straight after it.
    pub fn split(
        &mut self,
        client: u64,
        index: usize,
        item: ItemId,
        diff: usize,
    ) -> EngineResult<ItemId> {
        let right = self.split_at(item, diff)?;
        self.clients
            .get_mut(&client)
            .expect("a split client is in the store")
            .insert(index + 1, Struct::Item(right));
        Ok(right)
    }

    /// Cuts the item at diff clocks and returns the right half. The map head
    /// moves to the right half when it becomes the key's last value.
    pub fn split_at(&mut self, item: ItemId, diff: usize) -> EngineResult<ItemId> {
        let length = self.items[item].length;
        if diff == 0 || diff >= length {
            fail!("yjs: cannot split a {length}-clock item at {diff}.");
        }
        let content = self.items[item].content.splice(diff)?;
        let left = &self.items[item];
        let clock = left.id.clock + diff as u64;
        let old_right = left.right;
        let right = Item {
            id: Id::new(left.id.client, clock),
            length: length - diff,
            origin: Some(Id::new(left.id.client, clock - 1)),
            right_origin: left.right_origin,
            left: Some(item),
            right: old_right,
            parent: left.parent.clone(),
            parent_sub: left.parent_sub.clone(),
            wire_parent_sub_bit: false,
            content,
            deleted: left.deleted,
            keep: left.keep,
            redone: left
                .redone
                .map(|redone| Id::new(redone.client, redone.clock + diff as u64)),
        };
        let right_id = self.items.len();
        self.items.push(right);
        self.items[item].right = Some(right_id);
        self.items[item].length = diff;
        if let Some(old_right) = old_right {
            self.items[old_right].left = Some(right_id);
        }
        let added = &self.items[right_id];
        if let (Some(sub), None) = (&added.parent_sub, old_right) {
            let Parent::Type(tid) = added.parent else {
                fail!(
                    "yjs: the map head for '{sub}' has an unresolved parent ({:?}); resolve it before splitting.",
                    added.parent
                );
            };
            let sub = sub.clone();
            self.types[tid].map_set_head(sub, right_id);
        }
        Ok(right_id)
    }

    /// Appends to the client's run. A first struct may start at any clock;
    /// a later gap is refused, and no empty run is ever left behind.
    pub fn add_struct(&mut self, added: Struct) -> EngineResult<()> {
        let id = self.head(added).id;
        let Some(structs) = self.clients.get(&id.client) else {
            self.clients.insert(id.client, vec![added]);
            self.order.push(id.client);
            return Ok(());
        };
        let end = self.head(*structs.last().expect("no empty run")).end();
        if end != id.clock {
            fail!(
                "yjs: client {} jumps from clock {end} to {}.",
                id.client,
                id.clock
            );
        }
        self.clients
            .get_mut(&id.client)
            .expect("present")
            .push(added);
        Ok(())
    }

    /// Adds an item to the arena, not yet to any run.
    pub fn alloc(&mut self, item: Item) -> ItemId {
        self.items.push(item);
        self.items.len() - 1
    }
}

/// Per client, the next clock that client has not produced. It encodes
/// clients in descending id order.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StateVector {
    clocks: HashMap<u64, u64>,
    order: Vec<u64>,
}

impl StateVector {
    pub fn new() -> StateVector {
        StateVector::default()
    }

    /// The client's clock, 0 when unknown.
    pub fn get(&self, client: u64) -> u64 {
        self.clocks.get(&client).copied().unwrap_or(0)
    }

    pub fn has(&self, client: u64) -> bool {
        self.clocks.contains_key(&client)
    }

    pub fn set(&mut self, client: u64, clock: u64) {
        if self.clocks.insert(client, clock).is_none() {
            self.order.push(client);
        }
    }

    /// The number of clients.
    pub fn len(&self) -> usize {
        self.order.len()
    }

    pub fn is_empty(&self) -> bool {
        self.order.is_empty()
    }

    /// The listed clients, highest id first.
    pub fn clients(&self) -> Vec<u64> {
        let mut clients = self.order.clone();
        clients.sort_by(|a, b| b.cmp(a));
        clients
    }

    /// Clients descending. The empty vector is 00.
    pub fn encode(&self) -> Vec<u8> {
        let mut w = Writer::new();
        w.write_var_uint(self.len() as u64);
        for client in self.clients() {
            w.write_var_uint(client);
            w.write_var_uint(self.clocks[&client]);
        }
        w.into_bytes()
    }
}

/// Refuses a client listed twice and trailing bytes.
pub fn decode_state_vector(data: &[u8]) -> Result<StateVector, FormatError> {
    let mut r = Reader::new(data);
    let mut vector = StateVector::new();
    let count = r.read_var_uint()?;
    for _ in 0..count {
        let client = r.read_var_uint()?;
        let clock = r.read_var_uint()?;
        if vector.has(client) {
            return Err(format_err!(
                "yjs: client {client} is listed twice in a state vector."
            ));
        }
        vector.set(client, clock);
    }
    if !r.at_end() {
        return Err(format_err!(
            "yjs: {} bytes trail the state vector.",
            r.len() - r.pos()
        ));
    }
    Ok(vector)
}

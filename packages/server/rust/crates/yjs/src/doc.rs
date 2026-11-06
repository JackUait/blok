use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, Weak};

use blok_jsjson::Str;

use crate::decode::{DecodedUpdate, decode};
use crate::deleteset::{DeleteSet, copy_ranges, merge_delete_sets};
use crate::encode::update_from_transaction;
use crate::integrator::{ClientStructMap, flatten, group, merge_parked, to_runtime_structs};
use crate::item::Runtime;
use crate::store::{StateVector, Store};
use crate::types::{Array, Map, Text, TypeKind, TypeRef};
use crate::{EngineError, EngineResult};

/// One emitted update.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpdateEvent {
    pub update: Vec<u8>,
    pub local: bool,
}

/// Whether apply_update could read the bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Applied,
    Malformed,
}

/// What apply_update reports. `changed` is true when the update integrated
/// a struct, deleted something new, or grew what is parked; a false FALSE
/// would apply an update that is then neither journalled nor relayed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ApplyResult {
    pub outcome: Outcome,
    pub pending_remains: bool,
    pub changed: bool,
    pub reason: String,
}

/// Configures Doc::new.
#[derive(Clone, Copy, Debug, Default)]
pub struct Options {
    /// Pins the client id; None mints a random u32.
    pub client_id: Option<u32>,
    /// Keeps deleted content (yjs gc: false).
    pub no_gc: bool,
}

type Listener = Arc<Mutex<dyn FnMut(&UpdateEvent) + Send>>;

/// The per-transaction state; the open one lives in DocState.current.
pub(crate) struct TxnState {
    pub local: bool,
    pub before_state: StateVector,
    pub after_state: Option<StateVector>,
    pub delete_set: DeleteSet,
}

pub(crate) type EncoderHook = Box<dyn FnMut(&TxnState) -> Option<Vec<u8>> + Send>;

pub(crate) struct DocState {
    pub client_id: u64,
    pub store: Store,
    pub share: HashMap<Str, TypeRef>,
    pub gc: bool,
    pub current: Option<TxnState>,
    listeners: Vec<(u64, Listener)>,
    next_listener: u64,
    /// Replaces update_from_transaction in tests.
    pub encoder: Option<EncoderHook>,
    /// The undo manager, once enable_undo turned it on.
    pub(crate) undo: Option<crate::undo::UndoState>,
    pub self_ref: Weak<DocShared>,
}

pub(crate) struct DocShared {
    state: Mutex<DocState>,
}

impl DocShared {
    // A panic in the engine is a bug; the state stays readable, as Go's
    // does after a recovered panic.
    pub(crate) fn lock(shared: &DocShared) -> MutexGuard<'_, DocState> {
        shared.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// A Yjs document: the struct store, the named roots, and the transaction
/// that turns applied bytes or local writes into one update. Cloning gives
/// another handle to the same document.
///
/// Every public method takes the document's lock for its own duration
/// only, so a transaction body may call any of them, the document's own
/// transact and apply included. Callers serialize transactions, as Go's
/// room does: a transact from another thread while one is open joins it
/// as if nested.
#[derive(Clone)]
pub struct Doc(Arc<DocShared>);

impl PartialEq for Doc {
    fn eq(&self, other: &Doc) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

impl std::fmt::Debug for Doc {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "yjs.Doc(client {})", self.client_id())
    }
}

/// One local or remote change to a Doc.
pub struct Transaction<'a> {
    doc: &'a Doc,
}

impl Transaction<'_> {
    /// The transaction's document.
    pub fn doc(&self) -> &Doc {
        self.doc
    }

    /// False once a remote apply joined the transaction.
    pub fn local(&self) -> bool {
        self.doc.lock().current.as_ref().is_some_and(|t| t.local)
    }
}

/// Ends one on_update subscription.
pub struct Subscription {
    doc: Weak<DocShared>,
    id: u64,
}

impl Subscription {
    pub fn unsubscribe(self) {
        if let Some(shared) = self.doc.upgrade() {
            DocShared::lock(&shared)
                .listeners
                .retain(|(id, _)| *id != self.id);
        }
    }
}

pub(crate) fn new_client_id() -> u64 {
    let mut b = [0u8; 4];
    getrandom::fill(&mut b).expect("the OS random source failed");
    u64::from(u32::from_le_bytes(b))
}

impl Doc {
    /// An empty document.
    pub fn new(options: Options) -> Doc {
        let client_id = match options.client_id {
            Some(id) => u64::from(id),
            None => new_client_id(),
        };
        Doc(Arc::new_cyclic(|weak| DocShared {
            state: Mutex::new(DocState {
                client_id,
                store: Store::new(),
                share: HashMap::new(),
                gc: !options.no_gc,
                current: None,
                listeners: Vec::new(),
                next_listener: 0,
                encoder: None,
                undo: None,
                self_ref: weak.clone(),
            }),
        }))
    }

    pub(crate) fn from_shared(shared: Arc<DocShared>) -> Doc {
        Doc(shared)
    }

    pub(crate) fn is_shared(&self, shared: &Arc<DocShared>) -> bool {
        Arc::ptr_eq(&self.0, shared)
    }

    pub(crate) fn lock(&self) -> MutexGuard<'_, DocState> {
        DocShared::lock(&self.0)
    }

    /// The id local writes use.
    pub fn client_id(&self) -> u64 {
        self.lock().client_id
    }

    /// Writes from now on under id, continuing its clock. Call it after the
    /// state is applied: a remote update advancing the doc's own id mints a
    /// new one.
    pub fn adopt_client_id(&self, id: u64) {
        self.lock().client_id = id;
    }

    /// Parked structs or deletes.
    pub fn has_pending(&self) -> bool {
        self.lock().has_pending()
    }

    /// Subscribes to emitted updates. Listeners run in subscription order
    /// after each emitting transaction, outside the document's lock.
    pub fn on_update(&self, listener: impl FnMut(&UpdateEvent) + Send + 'static) -> Subscription {
        let mut st = self.lock();
        let id = st.next_listener;
        st.next_listener += 1;
        st.listeners.push((id, Arc::new(Mutex::new(listener))));
        Subscription {
            doc: Arc::downgrade(&self.0),
            id,
        }
    }

    /// The root under name, untyped until something asks for a kind.
    pub fn get(&self, name: impl Into<Str>) -> TypeRef {
        self.lock().root(&name.into()).0
    }

    /// The root map under name.
    pub fn get_map(&self, name: impl Into<Str>) -> EngineResult<Map> {
        Ok(Map(self.lock().root_typed(&name.into(), TypeKind::Map)?))
    }

    /// The root array under name.
    pub fn get_array(&self, name: impl Into<Str>) -> EngineResult<Array> {
        Ok(Array(
            self.lock().root_typed(&name.into(), TypeKind::Array)?,
        ))
    }

    /// The root text under name.
    pub fn get_text(&self, name: impl Into<Str>) -> EngineResult<Text> {
        Ok(Text(self.lock().root_typed(&name.into(), TypeKind::Text)?))
    }

    /// The integrated state only.
    pub fn encode_state_vector(&self) -> Vec<u8> {
        self.lock().store.get_state_vector().encode()
    }

    /// Everything target has not seen: integrated and parked structs plus
    /// the whole delete history and parked deletes. An empty target means
    /// "seen nothing".
    pub fn encode_state_as_update(&self, target: &[u8]) -> Result<Vec<u8>, crate::Error> {
        self.lock().encode_state_as_update(target)
    }

    /// Decodes and applies. Malformed bytes leave the doc untouched. An
    /// engine error mid-apply is returned; the doc may be half-changed, as
    /// in C#, where the room catches it.
    pub fn apply_update(&self, update: &[u8]) -> EngineResult<ApplyResult> {
        match decode(update) {
            Ok(decoded) => self.apply_decoded(&decoded),
            Err(err) => Ok(ApplyResult {
                outcome: Outcome::Malformed,
                pending_remains: self.has_pending(),
                changed: false,
                reason: err.to_string(),
            }),
        }
    }

    /// Applies an already decoded update in one remote transaction.
    pub fn apply_decoded(&self, update: &DecodedUpdate) -> EngineResult<ApplyResult> {
        let parked_before = self.lock().parked_coverage();
        let (_, moved) = self.transact_with(false, |txn| {
            let mut st = txn.doc.lock();
            st.current.as_mut().expect("open").local = false;
            st.apply_structs(to_runtime_structs(update), &update.delete_set)
        })?;
        let st = self.lock();
        Ok(ApplyResult {
            outcome: Outcome::Applied,
            pending_remains: st.has_pending(),
            changed: moved || st.parked_coverage() != parked_before,
            reason: String::new(),
        })
    }

    /// Runs body in a local transaction and returns the update it emitted,
    /// or None when nothing changed. A nested call joins the open one and
    /// returns None: only the outermost emits. When body fails, the
    /// transaction ends without cleanup or emit and the error is returned.
    pub fn transact(
        &self,
        body: impl FnOnce(&Transaction<'_>) -> EngineResult<()>,
    ) -> EngineResult<Option<Vec<u8>>> {
        Ok(self.transact_with(true, body)?.0)
    }

    fn transact_with(
        &self,
        local: bool,
        body: impl FnOnce(&Transaction<'_>) -> EngineResult<()>,
    ) -> EngineResult<(Option<Vec<u8>>, bool)> {
        let txn = Transaction { doc: self };
        {
            let mut st = self.lock();
            if st.current.is_some() {
                drop(st);
                body(&txn)?;
                return Ok((None, false));
            }
            let before_state = st.store.get_state_vector();
            st.current = Some(TxnState {
                local,
                before_state,
                after_state: None,
                delete_set: DeleteSet::new(),
            });
        }
        // Go clears the open transaction in a defer; a body that unwinds
        // must not leave every later transaction looking nested.
        let result = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| body(&txn))) {
            Ok(result) => result,
            Err(panic) => {
                self.lock().current = None;
                std::panic::resume_unwind(panic);
            }
        };
        let mut st = self.lock();
        let mut t = st.current.take().expect("the transaction is open");
        result?;
        let update = st.cleanup(&mut t)?;
        let moved = moved(&t, &st.store);
        let listeners: Vec<Listener> = match update {
            Some(_) => st.listeners.iter().map(|(_, l)| l.clone()).collect(),
            None => Vec::new(),
        };
        drop(st);
        if let Some(update) = &update {
            let event = UpdateEvent {
                update: update.clone(),
                local: t.local,
            };
            for listener in listeners {
                (listener.lock().unwrap_or_else(PoisonError::into_inner))(&event);
            }
        }
        Ok((update, moved))
    }

    /// Turns on the undo manager. Nothing is captured until set_capturing.
    pub fn enable_undo(&self) {
        let mut st = self.lock();
        if st.undo.is_none() {
            st.undo = Some(crate::undo::UndoState::default());
        }
    }

    /// While on, local transactions become undo steps (yjs's
    /// captureTransaction); a new step clears the redo stack.
    pub fn set_capturing(&self, capturing: bool) {
        if let Some(um) = self.lock().undo.as_mut() {
            um.capturing = capturing;
        }
    }

    /// The serial of the step an undo (or redo) would replay next.
    pub fn stack_top(&self, direction: crate::undo::Direction) -> Option<u64> {
        let st = self.lock();
        let um = st.undo.as_ref()?;
        let stack = match direction {
            crate::undo::Direction::Undo => &um.undo,
            crate::undo::Direction::Redo => &um.redo,
        };
        stack.last().map(|s| s.serial)
    }

    /// Drops one undo step, as a history limit does.
    pub fn forget_step(&self, serial: u64) {
        if let Some(um) = self.lock().undo.as_mut() {
            um.undo.retain(|s| s.serial != serial);
        }
    }

    /// Undoes (or redoes) the top step in one local transaction. Answers
    /// the serial of the step applied, or None when nothing changed, and
    /// the update the transaction emitted.
    pub fn replay(
        &self,
        direction: crate::undo::Direction,
    ) -> EngineResult<(Option<u64>, Option<Vec<u8>>)> {
        {
            let mut st = self.lock();
            let Some(um) = st.undo.as_mut() else {
                return Ok((None, None));
            };
            um.undoing = direction == crate::undo::Direction::Undo;
            um.redoing = direction == crate::undo::Direction::Redo;
        }
        let mut applied = None;
        let result = self.transact(|txn| {
            applied = txn.doc.lock().pop_stack_item(direction)?;
            Ok(())
        });
        if let Some(um) = self.lock().undo.as_mut() {
            um.undoing = false;
            um.redoing = false;
        }
        Ok((applied, result?))
    }

    /// Replaces the update encoder, so a test can see each transaction.
    #[cfg(test)]
    pub(crate) fn set_encoder(&self, encoder: Option<EncoderHook>) {
        self.lock().encoder = encoder;
    }
}

/// Must agree with update_from_transaction's "nothing to emit" test.
fn moved(t: &TxnState, store: &Store) -> bool {
    if !t.delete_set.is_empty() {
        return true;
    }
    let after = match &t.after_state {
        Some(after) => after.clone(),
        None => store.get_state_vector(),
    };
    advanced(&t.before_state, &after)
}

pub(crate) fn advanced(before: &StateVector, after: &StateVector) -> bool {
    after
        .clients()
        .into_iter()
        .any(|client| before.get(client) != after.get(client))
}

impl DocState {
    pub(crate) fn has_pending(&self) -> bool {
        self.store.has_pending || self.store.pending_ds.is_some()
    }

    pub(crate) fn txn(&mut self) -> EngineResult<&mut TxnState> {
        match self.current.as_mut() {
            Some(t) => Ok(t),
            None => Err(EngineError::new("yjs: no transaction is open.")),
        }
    }

    /// Two unions, ADDED: clocks covered by parked structs plus clocks
    /// covered by parked deletes. A sum of lengths or an identity test gives
    /// false FALSEs.
    pub(crate) fn parked_coverage(&self) -> u64 {
        let mut structs = DeleteSet::new();
        for waiting in &self.store.pending_structs {
            let h = waiting.header();
            structs.add(h.id.client, h.id.clock, h.length as u64);
        }
        let mut deletions = DeleteSet::new();
        if let Some(pending) = &self.store.pending_ds {
            copy_ranges(pending, &mut deletions);
        }
        union_length(structs) + union_length(deletions)
    }

    pub(crate) fn deleted_so_far(&self) -> DeleteSet {
        let mut deletions = DeleteSet::new();
        for &client in &self.store.order {
            for &s in &self.store.clients[&client] {
                if self.store.is_deleted(s) {
                    let h = self.store.head(s);
                    deletions.add(client, h.id.clock, h.length as u64);
                }
            }
        }
        if let Some(pending) = &self.store.pending_ds {
            copy_ranges(pending, &mut deletions);
        }
        deletions.sort_and_merge();
        deletions
    }

    /// yjs's readUpdateV2 body. The retry runs inside the SAME transaction,
    /// so an update closing a gap lands with what it unblocks.
    pub(crate) fn apply_structs(
        &mut self,
        structs: ClientStructMap<Runtime>,
        delete_set: &DeleteSet,
    ) -> EngineResult<()> {
        let rest = self.integrate_structs(structs)?;
        let mut retry = false;
        if self.store.has_pending {
            // A map, not the vector: "no entry" and "waiting for 0" differ.
            let pending_missing = self.store.pending_missing.clone().unwrap_or_default();
            let mut missing: HashMap<u64, u64> = HashMap::new();
            for client in pending_missing.clients() {
                missing.insert(client, pending_missing.get(client));
            }
            for client in pending_missing.clients() {
                if missing[&client] < self.store.get_state(client) {
                    retry = true;
                    break;
                }
            }
            if let Some(rest) = rest {
                for (&client, &clock) in &rest.missing {
                    if missing.get(&client).is_none_or(|&known| known > clock) {
                        missing.insert(client, clock);
                    }
                }
                self.store.pending_missing = Some(vector_of(&missing));
                let parked = std::mem::take(&mut self.store.pending_structs);
                self.store.pending_structs = merge_parked(parked, rest.structs);
            }
        } else if let Some(rest) = rest {
            self.store.pending_structs = flatten(rest.structs);
            self.store.has_pending = true;
            self.store.pending_missing = Some(vector_of(&rest.missing));
        }
        let unapplied_now = self.apply_delete_set(delete_set)?;
        self.store.pending_ds = match self.store.pending_ds.take() {
            Some(pending) => {
                let still = self.apply_delete_set(&pending)?;
                merge_delete_sets(unapplied_now, still)
            }
            None => unapplied_now,
        };
        if !retry {
            return Ok(());
        }
        let parked = std::mem::take(&mut self.store.pending_structs);
        self.store.has_pending = false;
        self.store.pending_missing = None;
        self.apply_structs(group(parked), &DeleteSet::new())
    }

    /// Deletes everything the ranges name and returns what could not be
    /// applied yet, or None. A range is split on both edges; a range
    /// starting past the state parks whole, one reaching past it parks only
    /// its tail.
    pub(crate) fn apply_delete_set(&mut self, set: &DeleteSet) -> EngineResult<Option<DeleteSet>> {
        use crate::item::Struct;
        let mut unapplied = DeleteSet::new();
        for entry in &set.clients {
            let client = entry.client;
            let state = self.store.get_state(client);
            for r in &entry.ranges {
                let clock_end = r.clock + r.length;
                if r.clock >= state {
                    unapplied.add(client, r.clock, r.length);
                    continue;
                }
                if state < clock_end {
                    unapplied.add(client, state, clock_end - state);
                }
                let mut index = self.store.find_index(client, r.clock)?;
                if let Struct::Item(head) = self.store.clients[&client][index] {
                    let item = &self.store.items[head];
                    if !item.deleted && item.id.clock < r.clock {
                        let diff = (r.clock - item.id.clock) as usize;
                        self.store.split(client, index, head, diff)?;
                        index += 1;
                    }
                }
                // Re-read the run each step: a split inserts into it.
                while index < self.store.clients[&client].len() {
                    let current = self.store.clients[&client][index];
                    index += 1;
                    if self.store.head(current).id.clock >= clock_end {
                        break;
                    }
                    let Struct::Item(at) = current else { continue };
                    if self.store.items[at].deleted {
                        continue;
                    }
                    if clock_end < self.store.items[at].end() {
                        let diff = (clock_end - self.store.items[at].id.clock) as usize;
                        self.store.split(client, index - 1, at, diff)?;
                    }
                    self.delete(at)?;
                }
            }
        }
        Ok((!unapplied.is_empty()).then_some(unapplied))
    }

    /// yjs's cleanupTransactions minus observers and merging.
    fn cleanup(&mut self, t: &mut TxnState) -> EngineResult<Option<Vec<u8>>> {
        t.delete_set.sort_and_merge();
        let after = self.store.get_state_vector();
        t.after_state = Some(after.clone());
        self.capture_step(t)?;
        if self.gc {
            self.collect_deleted(&t.delete_set)?;
        }
        self.find_deleted_ends(&t.delete_set)?;
        // yjs compares Map.get results, so a client first seen at clock 0 moved.
        let own = self.client_id;
        if !t.local
            && (after.get(own) != t.before_state.get(own)
                || after.has(own) != t.before_state.has(own))
        {
            self.client_id = new_client_id();
        }
        t.after_state = Some(after);
        match self.encoder.as_mut() {
            Some(hook) => Ok(hook(t)),
            None => update_from_transaction(t, &self.store),
        }
    }

    /// The lookup yjs's tryMergeDeleteSet starts every deleted range with:
    /// the struct holding its last clock. A length-0 item at clock 0 ends at
    /// clock -1, so yjs throws "Unexpected case" there, after the change and
    /// before it emits. The merge itself is left out, as elsewhere.
    fn find_deleted_ends(&self, deleted: &DeleteSet) -> EngineResult<()> {
        for entry in &deleted.clients {
            if !self.store.clients.contains_key(&entry.client) {
                continue;
            }
            for r in entry.ranges.iter().rev() {
                match (r.clock + r.length).checked_sub(1) {
                    Some(last) => {
                        self.store.find_index(entry.client, last)?;
                    }
                    None => crate::fail!("Unexpected case"),
                }
            }
        }
        Ok(())
    }

    /// yjs's tryGcDeleteSet. The struct at an index is re-read every step
    /// because collecting replaces entries in the same run.
    fn collect_deleted(&mut self, deleted: &DeleteSet) -> EngineResult<()> {
        use crate::item::Struct;
        for entry in &deleted.clients {
            if !self.store.clients.contains_key(&entry.client) {
                continue;
            }
            for r in entry.ranges.iter().rev() {
                let end = r.clock + r.length;
                let mut index = self.store.find_index(entry.client, r.clock)?;
                while index < self.store.clients[&entry.client].len() {
                    let current = self.store.clients[&entry.client][index];
                    if self.store.head(current).id.clock >= end {
                        break;
                    }
                    if let Struct::Item(at) = current {
                        let item = &self.store.items[at];
                        if item.deleted && !item.keep {
                            self.gc_item(at, false)?;
                        }
                    }
                    index += 1;
                }
            }
        }
        Ok(())
    }

    pub(crate) fn encode_state_as_update(&self, target: &[u8]) -> Result<Vec<u8>, crate::Error> {
        let vector = if target.is_empty() {
            StateVector::new()
        } else {
            crate::store::decode_state_vector(target)?
        };
        let mut w = blok_lib0::Writer::new();
        let runs = crate::encode::build_runs(&self.store, &vector, true)?;
        crate::encode::write_runs(&mut w, &runs, &self.store)?;
        self.deleted_so_far().write(&mut w);
        Ok(w.into_bytes())
    }
}

/// Mutates its argument; pass only a scratch set.
fn union_length(mut ranges: DeleteSet) -> u64 {
    ranges.sort_and_merge();
    ranges
        .clients
        .iter()
        .flat_map(|entry| &entry.ranges)
        .map(|r| r.length)
        .sum()
}

/// Sorts the clients so the order is fixed; a StateVector only encodes and
/// enumerates sorted anyway.
fn vector_of(clocks: &HashMap<u64, u64>) -> StateVector {
    let mut clients: Vec<u64> = clocks.keys().copied().collect();
    clients.sort();
    let mut vector = StateVector::new();
    for client in clients {
        vector.set(client, clocks[&client]);
    }
    vector
}

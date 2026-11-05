use std::collections::HashMap;

use crate::decode::{DecodedStruct, DecodedUpdate, StructKind};
use crate::doc::DocState;
use crate::item::{Item, PARENT_SUB_BIT, Parent, Runtime, Struct};
use crate::{EngineResult, Header, Id, fail};

/// client -> structs in insertion order.
#[derive(Debug)]
pub(crate) struct ClientStructMap<T> {
    pub order: Vec<u64>,
    pub runs: HashMap<u64, Vec<T>>,
}

impl<T> ClientStructMap<T> {
    pub fn new() -> Self {
        ClientStructMap {
            order: Vec::new(),
            runs: HashMap::new(),
        }
    }

    pub fn set(&mut self, client: u64, structs: Vec<T>) {
        if self.runs.insert(client, structs).is_none() {
            self.order.push(client);
        }
    }

    pub fn len(&self) -> usize {
        self.order.len()
    }
}

/// What a pass could not place: the structs, and per client the clock they
/// wait for.
pub(crate) struct IntegrationRest {
    pub missing: HashMap<u64, u64>,
    pub structs: ClientStructMap<Runtime>,
}

/// Runtime structs from a decoded update. A root parent stays the wire's
/// name until integration; contents are copied so the decoded update can
/// be applied again.
pub(crate) fn to_runtime_structs(update: &DecodedUpdate) -> ClientStructMap<Runtime> {
    let mut structs = ClientStructMap::new();
    for group in &update.groups {
        structs.set(
            group.client,
            group.structs.iter().map(to_runtime_struct).collect(),
        );
    }
    structs
}

pub(crate) fn to_runtime_struct(decoded: &DecodedStruct) -> Runtime {
    let h = Header {
        id: decoded.id,
        length: decoded.length,
    };
    match decoded.kind {
        StructKind::Gc => return Runtime::Gc(h),
        StructKind::Skip => return Runtime::Skip(h),
        StructKind::Item => {}
    }
    let parent = match (&decoded.parent_root, decoded.parent_id) {
        (Some(root), _) => Parent::Root(root.clone()),
        (None, Some(id)) => Parent::Id(id),
        (None, None) => Parent::None,
    };
    Runtime::Item(Box::new(Item {
        id: decoded.id,
        length: decoded.length,
        origin: decoded.origin,
        right_origin: decoded.right_origin,
        left: None,
        right: None,
        parent,
        parent_sub: decoded.parent_sub.clone(),
        wire_parent_sub_bit: decoded.info & PARENT_SUB_BIT != 0,
        content: decoded
            .content
            .as_ref()
            .expect("a decoded item has content")
            .copy(),
        deleted: false,
        keep: false,
    }))
}

struct ClientRefs {
    refs: Vec<usize>,
    index: usize,
}

impl ClientRefs {
    fn has_more(&self) -> bool {
        self.index < self.refs.len()
    }

    fn next(&mut self) -> usize {
        self.index += 1;
        self.refs[self.index - 1]
    }
}

impl DocState {
    /// yjs's integrateStructs: a stack machine that walks clients from the
    /// highest id, follows dependencies across clients, and parks only what
    /// is genuinely absent. The pass's structs sit in `slots`; integrating
    /// one moves it into the store.
    pub(crate) fn integrate_structs(
        &mut self,
        structs: ClientStructMap<Runtime>,
    ) -> EngineResult<Option<IntegrationRest>> {
        let mut ids = structs.order.clone();
        ids.sort();
        if ids.is_empty() {
            return Ok(None);
        }
        let ClientStructMap { order, mut runs } = structs;
        let mut slots: Vec<Option<Runtime>> = Vec::new();
        let mut pending: HashMap<u64, ClientRefs> = HashMap::new();
        for client in order {
            let mut refs = Vec::new();
            for s in runs.remove(&client).unwrap_or_default() {
                refs.push(slots.len());
                slots.push(Some(s));
            }
            pending.insert(client, ClientRefs { refs, index: 0 });
        }
        let Some(mut current) = next_target(&mut ids, &pending) else {
            return Ok(None);
        };
        let mut stack: Vec<usize> = Vec::new();
        let mut rest: ClientStructMap<usize> = ClientStructMap::new();
        let mut missing: HashMap<u64, u64> = HashMap::new();
        let mut state: HashMap<u64, u64> = HashMap::new();
        // Where each integrated slot now starts in the store. C# parks the
        // live struct when its client's tail is parked after it integrated.
        let mut integrated: HashMap<usize, Id> = HashMap::new();
        let mut head = pending.get_mut(&current).expect("target").next();
        loop {
            let slot = slots[head].as_ref().expect("an unread struct");
            if !slot.is_skip() {
                let h = slot.header();
                let client = h.id.client;
                let local_clock = *state
                    .entry(client)
                    .or_insert_with(|| self.store.get_state(client));
                if local_clock < h.id.clock {
                    // A gap in this client's own run.
                    stack.push(head);
                    record_missing(&mut missing, client, h.id.clock - 1);
                    park(&mut stack, &mut pending, &mut rest, &slots);
                } else {
                    let offset = local_clock - h.id.clock;
                    let blocked = match slots[head].as_mut() {
                        Some(Runtime::Item(item)) => self.get_missing(item)?,
                        _ => None,
                    };
                    if let Some(waiting_for) = blocked {
                        stack.push(head);
                        if let Some(carrier) = pending.get_mut(&waiting_for)
                            && carrier.has_more()
                        {
                            head = carrier.next();
                            continue;
                        }
                        record_missing(
                            &mut missing,
                            waiting_for,
                            self.store.get_state(waiting_for),
                        );
                        park(&mut stack, &mut pending, &mut rest, &slots);
                    } else if offset == 0 || offset < h.length as u64 {
                        let taken = slots[head].take().expect("present");
                        self.integrate_struct(taken, offset as usize)?;
                        integrated.insert(head, Id::new(client, h.id.clock + offset));
                        state.insert(client, h.id.clock + h.length as u64);
                    }
                    // Anything else is a run the store already holds: dropped.
                }
            }
            if let Some(top) = stack.pop() {
                head = top;
            } else if let Some(refs) = pending.get_mut(&current)
                && refs.has_more()
            {
                head = refs.next();
            } else {
                match next_target(&mut ids, &pending) {
                    Some(next) => {
                        current = next;
                        head = pending.get_mut(&current).expect("target").next();
                    }
                    None => {
                        if rest.len() == 0 {
                            return Ok(None);
                        }
                        let mut structs = ClientStructMap::new();
                        for client in rest.order {
                            let run = rest.runs.remove(&client).unwrap_or_default();
                            let mut parked = Vec::with_capacity(run.len());
                            for at in run {
                                match slots[at].take() {
                                    Some(waiting) => parked.push(waiting),
                                    None => parked.push(self.integrated_copy(integrated[&at])?),
                                }
                            }
                            structs.set(client, parked);
                        }
                        return Ok(Some(IntegrationRest { missing, structs }));
                    }
                }
            }
        }
    }

    /// A copy of what the store holds at id. C# parks the struct object
    /// itself; this copy is that object as it stands at the park.
    fn integrated_copy(&self, id: Id) -> EngineResult<Runtime> {
        Ok(match self.store.find(id)? {
            Struct::Item(at) => {
                // Out of the store's list, as C# and Go detach it.
                let mut copy = self.store.items[at].clone();
                (copy.left, copy.right, copy.deleted, copy.keep) = (None, None, false, false);
                Runtime::Item(Box::new(copy))
            }
            Struct::Gc(header) => Runtime::Gc(header),
        })
    }

    fn integrate_struct(&mut self, head: Runtime, offset: usize) -> EngineResult<()> {
        match head {
            Runtime::Item(item) => {
                self.integrate(item, offset)?;
            }
            Runtime::Gc(mut h) => {
                if offset > 0 {
                    h.id.clock += offset as u64;
                    h.length -= offset;
                }
                self.store.add_struct(Struct::Gc(h))?;
            }
            Runtime::Skip(_) => fail!("yjs: a Skip is never integrated."),
        }
        Ok(())
    }
}

fn record_missing(missing: &mut HashMap<u64, u64>, client: u64, clock: u64) {
    if missing.get(&client).is_none_or(|&known| known > clock) {
        missing.insert(client, clock);
    }
}

/// Parks the stack and, with each struct, its client's unread tail. Skips
/// are dropped: a parked Skip would make later real content for those
/// clocks look like a duplicate. The client is struck off this pass.
fn park(
    stack: &mut Vec<usize>,
    pending: &mut HashMap<u64, ClientRefs>,
    rest: &mut ClientStructMap<usize>,
    slots: &[Option<Runtime>],
) {
    for parked in stack.drain(..) {
        let client = slots[parked]
            .as_ref()
            .expect("a parked struct")
            .header()
            .id
            .client;
        match pending.remove(&client) {
            Some(refs) => {
                let waiting = refs.refs[refs.index - 1..]
                    .iter()
                    .copied()
                    .filter(|&at| slots[at].as_ref().is_none_or(|s| !s.is_skip()))
                    .collect();
                rest.set(client, waiting);
            }
            None => rest.set(client, vec![parked]),
        }
    }
}

/// The next client to read, highest id first.
fn next_target(ids: &mut Vec<u64>, pending: &HashMap<u64, ClientRefs>) -> Option<u64> {
    while let Some(&last) = ids.last() {
        if pending.get(&last).is_some_and(ClientRefs::has_more) {
            return Some(last);
        }
        ids.pop();
    }
    None
}

/// Unions per client by clock, dropping a struct only when one kept before
/// it covers it fully.
pub(crate) fn merge_parked(
    parked: Vec<Runtime>,
    arriving: ClientStructMap<Runtime>,
) -> Vec<Runtime> {
    let mut by_client = group(parked);
    let ClientStructMap { order, mut runs } = arriving;
    for client in order {
        let structs = runs.remove(&client).unwrap_or_default();
        let Some(known) = by_client.runs.remove(&client) else {
            by_client.set(client, structs);
            continue;
        };
        let mut known: Vec<Runtime> = known.into_iter().chain(structs).collect();
        known.sort_by_key(|s| s.header().id.clock);
        let mut kept = Vec::new();
        let mut covered = 0u64;
        for candidate in known {
            let end = candidate.header().end();
            if !kept.is_empty() && end <= covered {
                continue;
            }
            kept.push(candidate);
            covered = covered.max(end);
        }
        by_client.runs.insert(client, kept);
    }
    flatten(by_client)
}

pub(crate) fn group(structs: Vec<Runtime>) -> ClientStructMap<Runtime> {
    let mut by_client: ClientStructMap<Runtime> = ClientStructMap::new();
    for s in structs {
        let client = s.header().id.client;
        match by_client.runs.get_mut(&client) {
            Some(run) => run.push(s),
            None => by_client.set(client, vec![s]),
        }
    }
    by_client
}

pub(crate) fn flatten(mut by_client: ClientStructMap<Runtime>) -> Vec<Runtime> {
    let mut clients = by_client.order.clone();
    clients.sort();
    let mut flat = Vec::new();
    for client in clients {
        flat.extend(by_client.runs.remove(&client).unwrap_or_default());
    }
    flat
}

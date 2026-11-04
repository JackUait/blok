use std::collections::HashMap;

use blok_lib0::Writer;

use crate::doc::{TxnState, advanced};
use crate::item::{Runtime, Struct, write_gc, write_skip};
use crate::store::{StateVector, Store};
use crate::{EngineResult, Header, Id};

pub(crate) enum Written<'a> {
    Stored(Struct, usize),
    Parked(&'a Runtime, usize),
    Skip(Header),
}

impl Written<'_> {
    fn header(&self, store: &Store) -> Header {
        match self {
            Written::Stored(s, _) => store.head(*s),
            Written::Parked(s, _) => s.header(),
            Written::Skip(h) => *h,
        }
    }
}

/// One client's group: a start clock and a contiguous run.
pub(crate) struct EncodedRun<'a> {
    client: u64,
    clock: u64,
    structs: Vec<Written<'a>>,
}

/// yjs's LazyStructWriter: per run the count, client, clock, then the
/// structs.
pub(crate) fn write_runs(
    w: &mut Writer,
    runs: &[EncodedRun<'_>],
    store: &Store,
) -> EngineResult<()> {
    w.write_var_uint(runs.len() as u64);
    for run in runs {
        w.write_var_uint(run.structs.len() as u64);
        w.write_var_uint(run.client);
        w.write_var_uint(run.clock);
        for written in &run.structs {
            match written {
                Written::Stored(Struct::Item(at), offset) => {
                    store.items[*at].write(w, *offset, &store.types)?;
                }
                Written::Stored(Struct::Gc(h), offset) => write_gc(w, h, *offset),
                Written::Parked(s, offset) => s.write(w, *offset, &store.types)?,
                Written::Skip(h) => write_skip(w, h, 0),
            }
        }
    }
    Ok(())
}

/// yjs's writeUpdateMessageFromTransaction, or None when the transaction
/// changed nothing. Only integrated structs are written.
pub(crate) fn update_from_transaction(
    t: &mut TxnState,
    store: &Store,
) -> EngineResult<Option<Vec<u8>>> {
    let after = match &t.after_state {
        Some(after) => after.clone(),
        None => store.get_state_vector(),
    };
    if t.delete_set.is_empty() && !advanced(&t.before_state, &after) {
        return Ok(None);
    }
    t.delete_set.sort_and_merge();
    let mut w = Writer::new();
    let runs = build_runs(store, &t.before_state, false)?;
    write_runs(&mut w, &runs, store)?;
    t.delete_set.write(&mut w);
    Ok(Some(w.into_bytes()))
}

/// The store, and optionally what is parked, as v1 client runs: one group
/// per client, descending, holes as Skips, overlaps written at an offset.
pub(crate) fn build_runs<'a>(
    store: &'a Store,
    target: &StateVector,
    include_pending: bool,
) -> EngineResult<Vec<EncodedRun<'a>>> {
    let starts = start_clocks(store, target);
    let parked = if include_pending {
        parked_by_client(store, target)
    } else {
        HashMap::new()
    };
    let mut clients: Vec<u64> = starts.keys().copied().collect();
    clients.extend(parked.keys().filter(|c| !starts.contains_key(c)));
    clients.sort_by(|a, b| b.cmp(a));
    let mut runs = Vec::new();
    for client in clients {
        let mut written = Vec::new();
        let mut clock = 0;
        if let Some(&start) = starts.get(&client) {
            clock = append_integrated(store, client, start, &mut written)?;
        }
        if let Some(waiting) = parked.get(&client) {
            let from = if written.is_empty() {
                target.get(client)
            } else {
                clock
            };
            clock = append_parked(store, waiting, from, &mut written);
        }
        if !written.is_empty() {
            runs.push(EncodedRun {
                client,
                clock,
                structs: written,
            });
        }
    }
    Ok(runs)
}

/// yjs's writeClientsStructs: a client the target has seen part of starts
/// at its clock, an unknown client at 0, a level one is left out.
fn start_clocks(store: &Store, target: &StateVector) -> HashMap<u64, u64> {
    let mut starts = HashMap::new();
    for client in target.clients() {
        let clock = target.get(client);
        if store.get_state(client) > clock {
            starts.insert(client, clock);
        }
    }
    for &client in &store.order {
        if !target.has(client) {
            starts.insert(client, 0);
        }
    }
    starts
}

fn append_integrated<'a>(
    store: &'a Store,
    client: u64,
    start: u64,
    written: &mut Vec<Written<'a>>,
) -> EngineResult<u64> {
    let structs = &store.clients[&client];
    let clock = start.max(store.head(structs[0]).id.clock);
    let first = store.find_index(client, clock)?;
    let offset = (clock - store.head(structs[first]).id.clock) as usize;
    written.push(Written::Stored(structs[first], offset));
    for &s in &structs[first + 1..] {
        written.push(Written::Stored(s, 0));
    }
    Ok(clock)
}

/// Folds parked structs in after the integrated tail. A gap past int32 is
/// written as several Skips, never refused: refusing it once broke every
/// sync answer for a room's life.
fn append_parked<'a>(
    store: &Store,
    waiting: &[&'a Runtime],
    clock: u64,
    written: &mut Vec<Written<'a>>,
) -> u64 {
    let mut start = clock;
    let mut covered = written.last().map_or(0, |last| last.header(store).end());
    for &parked in waiting {
        let h = parked.header();
        let boundary = clock.max(covered);
        let end = h.end();
        if end <= boundary {
            continue;
        }
        if h.id.clock > boundary && !written.is_empty() {
            let mut hole = boundary;
            while hole < h.id.clock {
                let span = (h.id.clock - hole).min(i32::MAX as u64);
                written.push(Written::Skip(Header {
                    id: Id::new(h.id.client, hole),
                    length: span as usize,
                }));
                hole += span;
            }
        }
        let offset = boundary.saturating_sub(h.id.clock);
        if written.is_empty() {
            start = h.id.clock + offset;
        }
        written.push(Written::Parked(parked, offset as usize));
        covered = end;
    }
    start
}

/// Drops Skips and what the target has seen, then sorts each client's run
/// by clock (stable, so equal clocks keep their parked order).
fn parked_by_client<'a>(store: &'a Store, target: &StateVector) -> HashMap<u64, Vec<&'a Runtime>> {
    let mut parked: HashMap<u64, Vec<&Runtime>> = HashMap::new();
    for waiting in &store.pending_structs {
        let h = waiting.header();
        if waiting.is_skip() || h.end() <= target.get(h.id.client) {
            continue;
        }
        parked.entry(h.id.client).or_default().push(waiting);
    }
    for run in parked.values_mut() {
        run.sort_by_key(|s| s.header().id.clock);
    }
    parked
}

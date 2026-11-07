//! The agent's awareness, as y-protocols 1.0.7 keeps it: the local state
//! with its clock, the peers' states, renewal at 15 s and the 30 s timeout.
//! The provider sends what changed at most every 100 ms.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use blok_lib0::Writer;
use serde_json::{Map, Value};

/// y-protocols' outdatedTimeout.
pub const OUTDATED: Duration = Duration::from_secs(30);
/// y-protocols checks this often.
pub const CHECK_EVERY: Duration = Duration::from_secs(3);

struct Meta {
    clock: u64,
    updated: Instant,
}

pub struct Awareness {
    pub client_id: u64,
    /// Each state with the insertion number the JS Map iterates by.
    states: HashMap<u64, (u64, Value)>,
    meta: HashMap<u64, Meta>,
    next: u64,
}

/// Which clients changed, to be sent.
pub type Changed = Vec<u64>;

fn read_var_uint(input: &[u8], at: &mut usize) -> Option<u64> {
    let mut value = 0u64;
    let mut shift = 0;
    loop {
        let byte = *input.get(*at)?;
        *at += 1;
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Some(value);
        }
        shift += 7;
        if shift > 63 {
            return None;
        }
    }
}

impl Awareness {
    /// A new member: its own state starts as {} (the Awareness constructor).
    pub fn new(client_id: u64) -> Awareness {
        let mut awareness = Awareness {
            client_id,
            states: HashMap::new(),
            meta: HashMap::new(),
            next: 0,
        };
        awareness.put(client_id, Value::Object(Map::new()));
        awareness.meta.insert(
            client_id,
            Meta {
                clock: 0,
                updated: Instant::now(),
            },
        );
        awareness
    }

    fn put(&mut self, client: u64, state: Value) {
        let at = match self.states.get(&client) {
            Some((at, _)) => *at,
            None => {
                self.next += 1;
                self.next
            }
        };
        self.states.insert(client, (at, state));
    }

    /// Removes a state. A peer's clock goes with it, so nothing about a
    /// departed client is kept.
    fn drop_state(&mut self, client: u64) {
        self.states.remove(&client);
        if client != self.client_id {
            self.meta.remove(&client);
        }
    }

    fn order(&self) -> Vec<u64> {
        let mut clients: Vec<(u64, u64)> =
            self.states.iter().map(|(c, (at, _))| (*at, *c)).collect();
        clients.sort_unstable();
        clients.into_iter().map(|(_, c)| c).collect()
    }

    pub fn has_states(&self) -> bool {
        !self.states.is_empty()
    }

    /// setLocalStateField: always a new clock, so always sent.
    pub fn set_field(&mut self, field: &str, value: Value) -> Changed {
        let own = self.client_id;
        let mut state = match self.states.get(&own) {
            Some((_, Value::Object(map))) => map.clone(),
            _ => Map::new(),
        };
        state.insert(field.to_owned(), value);
        self.set_local(Value::Object(state));
        vec![own]
    }

    fn set_local(&mut self, state: Value) {
        let own = self.client_id;
        let clock = self.meta.get(&own).map_or(0, |m| m.clock) + 1;
        self.meta.insert(
            own,
            Meta {
                clock,
                updated: Instant::now(),
            },
        );
        self.put(own, state);
    }

    /// The 3 s check: renews our own state at half the timeout, and drops
    /// peers nothing was heard from for the whole of it.
    pub fn check(&mut self) -> Changed {
        let mut changed = Vec::new();
        let own = self.client_id;
        if let (Some((_, state)), Some(meta)) = (self.states.get(&own), self.meta.get(&own))
            && meta.updated.elapsed() >= OUTDATED / 2
        {
            let state = state.clone();
            self.set_local(state);
            changed.push(own);
        }
        let stale: Vec<u64> = self
            .meta
            .iter()
            .filter(|(client, meta)| {
                **client != own
                    && meta.updated.elapsed() >= OUTDATED
                    && self.states.contains_key(client)
            })
            .map(|(client, _)| *client)
            .collect();
        for client in stale {
            self.drop_state(client);
            changed.push(client);
        }
        changed
    }

    /// applyAwarenessUpdate from the room. Nothing is sent back for it.
    pub fn apply(&mut self, update: &[u8]) {
        let mut at = 0;
        let Some(count) = read_var_uint(update, &mut at) else {
            return;
        };
        for _ in 0..count {
            let (Some(client), Some(clock), Some(length)) = (
                read_var_uint(update, &mut at),
                read_var_uint(update, &mut at),
                read_var_uint(update, &mut at),
            ) else {
                return;
            };
            let Some(end) = usize::try_from(length).ok().and_then(|n| at.checked_add(n)) else {
                return;
            };
            let Some(bytes) = update.get(at..end) else {
                return;
            };
            at = end;
            let Ok(state) = serde_json::from_slice::<Value>(bytes) else {
                return;
            };
            let current = self.meta.get(&client).map_or(0, |m| m.clock);
            let fresher = current < clock
                || (current == clock && state.is_null() && self.states.contains_key(&client));
            if !fresher {
                continue;
            }
            let mut clock = clock;
            if state.is_null() {
                if client == self.client_id && self.states.contains_key(&client) {
                    // Someone removed us: say we are still here.
                    clock += 1;
                } else {
                    self.drop_state(client);
                    if client != self.client_id {
                        continue;
                    }
                }
            } else {
                self.put(client, state);
            }
            self.meta.insert(
                client,
                Meta {
                    clock,
                    updated: Instant::now(),
                },
            );
        }
    }

    /// Forgets the peers when a connection ends (clearRemoteAwarenessStates).
    pub fn clear_remote(&mut self) {
        let own = self.client_id;
        self.states.retain(|client, _| *client == own);
        self.meta.retain(|client, _| *client == own);
    }

    /// encodeAwarenessUpdate for `clients`, or every known state.
    pub fn encode(&self, clients: Option<&[u64]>) -> Vec<u8> {
        let all;
        let clients = match clients {
            Some(clients) => clients,
            None => {
                all = self.order();
                &all
            }
        };
        let mut w = Writer::new();
        w.write_var_uint(clients.len() as u64);
        for client in clients {
            let state = self
                .states
                .get(client)
                .map_or(Value::Null, |(_, s)| s.clone());
            let clock = self.meta.get(client).map_or(0, |m| m.clock);
            w.write_var_uint(*client);
            w.write_var_uint(clock);
            w.write_var_string(&blok_jsjson::Str::from(state.to_string().as_str()));
        }
        w.into_bytes()
    }

    /// Our own removal at the next clock, sent right away on close.
    pub fn departure(&mut self) -> Vec<u8> {
        let own = self.client_id;
        let clock = self.meta.get(&own).map_or(0, |m| m.clock) + 1;
        self.meta.insert(
            own,
            Meta {
                clock,
                updated: Instant::now(),
            },
        );
        self.drop_state(own);
        let mut w = Writer::new();
        w.write_var_uint(1);
        w.write_var_uint(own);
        w.write_var_uint(clock);
        w.write_var_string(&blok_jsjson::Str::from("null"));
        w.into_bytes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entries(update: &[u8]) -> Vec<(u64, u64, Value)> {
        let mut at = 0;
        let count = read_var_uint(update, &mut at).unwrap();
        (0..count)
            .map(|_| {
                let client = read_var_uint(update, &mut at).unwrap();
                let clock = read_var_uint(update, &mut at).unwrap();
                let length = read_var_uint(update, &mut at).unwrap() as usize;
                let state = serde_json::from_slice(&update[at..at + length]).unwrap();
                at += length;
                (client, clock, state)
            })
            .collect()
    }

    #[test]
    fn fields_keep_the_order_they_were_set_in() {
        let mut awareness = Awareness::new(7);
        awareness.set_field("user", json!({ "name": "a" }));
        awareness.set_field("agent", json!({ "via": "mcp" }));
        let sent = entries(&awareness.encode(Some(&[7])));
        assert_eq!(
            sent,
            vec![(
                7,
                2,
                json!({ "user": { "name": "a" }, "agent": { "via": "mcp" } })
            )]
        );
        assert_eq!(
            serde_json::to_string(&sent[0].2).unwrap(),
            r#"{"user":{"name":"a"},"agent":{"via":"mcp"}}"#
        );
    }

    #[test]
    fn a_full_flush_carries_peers_and_a_departure_is_a_null_state() {
        let mut awareness = Awareness::new(7);
        awareness.set_field("user", json!({}));
        let mut peer = Awareness::new(9);
        peer.set_field("user", json!({ "id": "alice" }));
        awareness.apply(&peer.encode(Some(&[9])));
        let all = entries(&awareness.encode(None));
        assert_eq!(all.iter().map(|e| e.0).collect::<Vec<_>>(), vec![7, 9]);
        let gone = awareness.departure();
        assert_eq!(entries(&gone), vec![(7, 2, Value::Null)]);
        awareness.clear_remote();
        assert!(!awareness.has_states());
    }

    #[test]
    fn a_removed_peer_leaves_nothing_behind() {
        let mut awareness = Awareness::new(7);
        let mut peer = Awareness::new(9);
        peer.set_field("a", json!(1));
        awareness.apply(&peer.encode(Some(&[9])));
        awareness.apply(&peer.departure());
        assert!(!awareness.states.contains_key(&9));
        assert!(!awareness.meta.contains_key(&9));
        awareness.apply(&peer.encode(Some(&[9])));
        awareness.clear_remote();
        assert_eq!(awareness.states.len(), 1);
        assert_eq!(awareness.meta.len(), 1);
    }

    #[test]
    fn ten_thousand_clients_apply_and_leave_quickly() {
        let mut w = Writer::new();
        w.write_var_uint(10_000);
        for client in 0..10_000u64 {
            w.write_var_uint(100 + client);
            w.write_var_uint(1);
            w.write_var_string(&blok_jsjson::Str::from(r#"{"user":{}}"#));
        }
        let joined = w.into_bytes();
        let mut w = Writer::new();
        w.write_var_uint(10_000);
        for client in 0..10_000u64 {
            w.write_var_uint(100 + client);
            w.write_var_uint(1);
            w.write_var_string(&blok_jsjson::Str::from("null"));
        }
        let left = w.into_bytes();
        let mut awareness = Awareness::new(7);
        let started = std::time::Instant::now();
        awareness.apply(&joined);
        assert!(awareness.encode(None).len() > 10_000);
        awareness.apply(&left);
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "{:?}",
            started.elapsed()
        );
        assert_eq!(awareness.states.len(), 1);
        assert_eq!(awareness.meta.len(), 1);
    }

    #[test]
    fn an_older_clock_is_ignored() {
        let mut awareness = Awareness::new(7);
        let mut peer = Awareness::new(9);
        peer.set_field("a", json!(1));
        let first = peer.encode(Some(&[9]));
        peer.set_field("a", json!(2));
        awareness.apply(&peer.encode(Some(&[9])));
        awareness.apply(&first);
        assert_eq!(
            entries(&awareness.encode(Some(&[9])))[0].2,
            json!({ "a": 2 })
        );
    }

    // A peer's entry with a length near u64::MAX is ignored, not a panic.
    #[test]
    fn a_huge_length_is_ignored() {
        let mut update = vec![1u8, 1, 1];
        update.extend([0xff; 9]);
        update.push(0x01);
        update.extend(b"{}");
        let mut awareness = Awareness::new(7);
        awareness.apply(&update);
        assert!(!awareness.states.contains_key(&1));
    }
}

use crate::jsonreader::JsonReader;
use crate::{append_var_bytes, append_var_uint, read_var_bytes, read_var_uint};

/// One entry of an awareness payload; `removed` marks the exact state bytes
/// "null" a departing client publishes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AwarenessEntry {
    pub client_id: u64,
    pub clock: u64,
    pub removed: bool,
}

const NULL_STATE: &[u8] = b"null";

/// Walks [clients]{[clientId][clock][varstring state]}* and checks each
/// state is one JSON value, which is what a stock client throws on. Returns
/// the claimed count (capped at 2^31-1), set as soon as it is read, so a
/// caller can tell over-cap from malformed, and whether the payload is
/// valid. `entries`, when given, is cleared and filled with what was read.
pub fn validate_awareness_update(
    payload: &[u8],
    max_clients: usize,
    mut entries: Option<&mut Vec<AwarenessEntry>>,
) -> (usize, bool) {
    if let Some(entries) = entries.as_deref_mut() {
        entries.clear();
    }
    let Some((claimed, mut payload)) = read_var_uint(payload) else {
        return (0, false);
    };
    let client_count = claimed.min(i32::MAX as u64) as usize;
    if claimed > max_clients as u64 {
        return (client_count, false);
    }
    for _ in 0..claimed {
        let Some((client_id, rest)) = read_var_uint(payload) else {
            return (client_count, false);
        };
        let Some((clock, rest)) = read_var_uint(rest) else {
            return (client_count, false);
        };
        let Some((state, rest)) = read_var_bytes(rest) else {
            return (client_count, false);
        };
        if !is_json_document(state) {
            return (client_count, false);
        }
        payload = rest;
        if let Some(entries) = entries.as_deref_mut() {
            entries.push(AwarenessEntry {
                client_id,
                clock,
                removed: state == NULL_STATE,
            });
        }
    }
    (client_count, payload.is_empty())
}

/// Writes each client at its last clock with a null state: y-protocols'
/// removeAwarenessStates on the wire.
pub fn encode_awareness_removal(clients: &[AwarenessEntry]) -> Vec<u8> {
    let mut b = Vec::new();
    append_var_uint(&mut b, clients.len() as u64);
    for client in clients {
        append_var_uint(&mut b, client.client_id);
        append_var_uint(&mut b, client.clock);
        append_var_bytes(&mut b, NULL_STATE);
    }
    b
}

pub(crate) fn is_json_document(json: &[u8]) -> bool {
    let mut reader = JsonReader::new(json);
    if reader.read() != Ok(true) || reader.skip().is_err() {
        return false;
    }
    reader.read() == Ok(false)
}

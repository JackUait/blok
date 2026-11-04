//! SyncWire: y-protocols framing as y-websocket puts it on the wire, one
//! message per WebSocket frame, plus Blok's own types 100-107. Pinned byte
//! for byte by sync-frames.json and sync-wire-decode.json, which the C#
//! SyncWire tests read too. Port of Go `internal/collab/wire`.

mod awareness;
mod decode;
mod encode;
mod jsonreader;

pub use awareness::{AwarenessEntry, encode_awareness_removal, validate_awareness_update};
pub use decode::{DecodeError, decode};
pub use encode::{NotEncodable, encode};

#[cfg(test)]
mod csharp_test;
#[cfg(test)]
mod fuzz_test;
#[cfg(test)]
mod wire_test;

// Message types. 105 is unassigned and decodes as Unknown.
pub const MESSAGE_SYNC: u64 = 0;
pub const MESSAGE_AWARENESS: u64 = 1;
pub const MESSAGE_AUTH: u64 = 2;
pub const MESSAGE_QUERY_AWARENESS: u64 = 3;
pub const MESSAGE_BLOK_CONTROL: u64 = 100;
pub const MESSAGE_BLOK_LIMITS: u64 = 101;
pub const MESSAGE_OPERATION: u64 = 102;
pub const MESSAGE_ACKNOWLEDGEMENT: u64 = 103;
pub const MESSAGE_REJECTION: u64 = 104;
pub const MESSAGE_ACTIVITY: u64 = 106;
pub const MESSAGE_IDENTITIES: u64 = 107;

/// The SyncStep1 sub-type; the inbound budget classifies frames by it.
pub const SYNC_STEP1_TYPE: u64 = 0;
pub(crate) const SYNC_STEP2_TYPE: u64 = 1;
pub(crate) const SYNC_UPDATE: u64 = 2;
pub(crate) const AUTH_PERMISSION_DENIED: u64 = 0;

// 64 bits is ten LEB128 bytes.
const MAX_VAR_UINT_BYTES: usize = 10;

/// 2^53-1: identities are JSON, and a JS client reads a larger id with lost
/// precision and refuses the whole frame.
pub const MAX_AWARENESS_CLIENT_ID: u64 = (1 << 53) - 1;

/// One decoded frame.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Message {
    SyncStep1 {
        state_vector: Vec<u8>,
    },
    SyncStep2 {
        update: Vec<u8>,
    },
    SyncUpdate {
        update: Vec<u8>,
    },
    /// Relayed verbatim, never parsed.
    Awareness {
        update: Vec<u8>,
    },
    QueryAwareness,
    PermissionDenied {
        reason: String,
    },
    /// Announces the working set: epoch, format and lineage.
    BlokControl {
        tag: Tag,
    },
    /// Announces the message cap in bytes.
    BlokLimits {
        max_message_bytes: i64,
    },
    /// A v2 client write; lineage and operation_id are 32 lowercase hex
    /// characters.
    Operation {
        lineage: String,
        operation_id: String,
        update: Vec<u8>,
    },
    /// server_sequence is at least 1.
    Acknowledgement {
        lineage: String,
        operation_id: String,
        server_sequence: u64,
    },
    /// code is an open set matching ^[a-z][a-z0-9-]{0,63}$.
    Rejection {
        lineage: String,
        operation_id: String,
        code: String,
    },
    Activity,
    /// Maps awareness client ids to verified actor ids.
    Identities {
        identities: Vec<Identity>,
    },
    /// A type this codec does not know; the room ignores it.
    Unknown {
        message_type: u64,
    },
}

/// One verified awareness client.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Identity {
    pub client_id: u64,
    pub actor_id: String,
}

/// CollabWorkingSetTag as the control frame carries it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Tag {
    pub format: i32,
    pub epoch: i64,
    pub lineage: String,
}

impl Tag {
    /// format >= 1, epoch >= 0 and a 32-hex lineage.
    pub fn is_announceable(&self) -> bool {
        self.format >= 1 && self.epoch >= 0 && is_lineage(&self.lineage)
    }
}

/// 32 lowercase hex characters.
pub fn is_lineage(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

/// Reads a lib0 varuint: at most ten bytes, and the tenth may carry only
/// bit 0. Returns the value and the rest, or None on a short or wide input.
pub fn read_var_uint(input: &[u8]) -> Option<(u64, &[u8])> {
    let mut value = 0u64;
    for (i, &current) in input.iter().take(MAX_VAR_UINT_BYTES).enumerate() {
        let bits = u64::from(current & 0x7f);
        if i == MAX_VAR_UINT_BYTES - 1 && bits > 1 {
            return None;
        }
        value |= bits << (7 * i);
        if current & 0x80 == 0 {
            return Some((value, &input[i + 1..]));
        }
    }
    None
}

/// Checks the length against what is left BEFORE slicing, so a huge prefix
/// never allocates.
pub fn read_var_bytes(input: &[u8]) -> Option<(&[u8], &[u8])> {
    let (length, remaining) = read_var_uint(input)?;
    if length > remaining.len() as u64 {
        return None;
    }
    Some(remaining.split_at(length as usize))
}

pub(crate) fn append_var_uint(dst: &mut Vec<u8>, mut value: u64) {
    loop {
        let mut current = (value & 0x7f) as u8;
        value >>= 7;
        if value != 0 {
            current |= 0x80;
        }
        dst.push(current);
        if value == 0 {
            return;
        }
    }
}

pub(crate) fn append_var_bytes(dst: &mut Vec<u8>, b: &[u8]) {
    append_var_uint(dst, b.len() as u64);
    dst.extend_from_slice(b);
}

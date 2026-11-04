use blok_collab_operation::{Record, Source};
use blok_collab_workingset::is_lineage;
use blok_dotnet::{MAX_TICKS, ticks, time_from_ticks};
use sha2::{Digest, Sha256};

use crate::error::Error;

/// How one record decoded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    /// Both checksums verified.
    Ok,
    /// A torn tail: a header or body not fully present.
    Incomplete,
    /// Corruption: the bytes were altered after being written.
    Invalid,
}

impl std::fmt::Display for Status {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Status::Ok => "Ok",
            Status::Incomplete => "Incomplete",
            Status::Invalid => "Invalid",
        })
    }
}

pub const CURRENT_VERSION: u8 = 1;
/// A disk-side backstop, not the wire limit.
pub const MAX_UPDATE_LENGTH: usize = 32 * 1024 * 1024;

const SHA256_SIZE: usize = 32;
const MAX_ACTOR_ID_LENGTH: usize = 4 * 1024;
const HEADER_CONTENT_SIZE: usize = 4 + 1 + 1;
const HEADER_SIZE: usize = HEADER_CONTENT_SIZE + SHA256_SIZE;
// operationId + sequence + ticks + actor length + digest + update length
const FIXED_BODY_SIZE: usize = 16 + 8 + 8 + 4 + SHA256_SIZE + 4;
const MIN_BODY_LENGTH: usize = FIXED_BODY_SIZE + 1 + SHA256_SIZE;
pub const MAX_BODY_LENGTH: usize =
    FIXED_BODY_SIZE + MAX_ACTOR_ID_LENGTH + MAX_UPDATE_LENGTH + SHA256_SIZE;

pub(crate) fn sha256(data: &[u8]) -> [u8; 32] {
    Sha256::digest(data).into()
}

pub(crate) fn lower_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Decodes lower or upper hex into `dst`, which must be half its length.
pub(crate) fn decode_hex(text: &str, dst: &mut [u8]) -> bool {
    let text = text.as_bytes();
    if text.len() != dst.len() * 2 {
        return false;
    }
    for (i, pair) in text.chunks(2).enumerate() {
        let (Some(high), Some(low)) = (
            (pair[0] as char).to_digit(16),
            (pair[1] as char).to_digit(16),
        ) else {
            return false;
        };
        dst[i] = (high * 16 + low) as u8;
    }
    true
}

fn u32_at(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(b[at..at + 4].try_into().expect("four bytes"))
}

fn u64_at(b: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(b[at..at + 8].try_into().expect("eight bytes"))
}

// C# interpolates an undefined enum value as its number.
fn source_name(source: Source) -> String {
    if source.defined() {
        source.to_string()
    } else {
        source.0.to_string()
    }
}

/// Writes one record. It refuses what C# refuses with an ArgumentException.
pub fn encode_record(record: &Record) -> Result<Vec<u8>, Error> {
    if !is_lineage(&record.operation_id) {
        return Err(Error::argument(format!(
            "collab: the operation id {} is not 32 lowercase-hex characters.",
            record.operation_id
        )));
    }
    if record.sequence < 1 {
        return Err(Error::argument(
            "collab: server sequence 0 means nothing has been committed; a record must be at least 1.",
        ));
    }
    if !record.source.defined() {
        return Err(Error::argument(format!(
            "collab: {} is not a known operation source.",
            source_name(record.source)
        )));
    }
    if record.digest.len() != SHA256_SIZE {
        return Err(Error::argument(format!(
            "collab: the digest must be {SHA256_SIZE} bytes (SHA-256)."
        )));
    }
    if record.update.is_empty() || record.update.len() > MAX_UPDATE_LENGTH {
        return Err(Error::argument(format!(
            "collab: the update must be 1..{MAX_UPDATE_LENGTH} bytes."
        )));
    }
    let actor = record.actor_id.as_deref().map(str::as_bytes);
    if actor.is_some_and(|a| a.len() > MAX_ACTOR_ID_LENGTH) {
        return Err(Error::argument(format!(
            "collab: the actor id exceeds {MAX_ACTOR_ID_LENGTH} bytes."
        )));
    }
    let actor_length = actor.map_or(-1, |a| a.len() as i32);
    let actor = actor.unwrap_or_default();
    let body_length = FIXED_BODY_SIZE + actor.len() + record.update.len() + SHA256_SIZE;
    let mut buffer = Vec::with_capacity(HEADER_SIZE + body_length);
    buffer.extend_from_slice(&(body_length as u32).to_le_bytes());
    buffer.push(CURRENT_VERSION);
    buffer.push(record.source.0);
    let header_sum = sha256(&buffer);
    buffer.extend_from_slice(&header_sum);
    let mut id = [0u8; 16];
    decode_hex(&record.operation_id, &mut id);
    buffer.extend_from_slice(&id);
    buffer.extend_from_slice(&record.sequence.to_le_bytes());
    buffer.extend_from_slice(&(ticks(record.committed_at) as u64).to_le_bytes());
    buffer.extend_from_slice(&(actor_length as u32).to_le_bytes());
    buffer.extend_from_slice(actor);
    buffer.extend_from_slice(&record.digest);
    buffer.extend_from_slice(&(record.update.len() as u32).to_le_bytes());
    buffer.extend_from_slice(&record.update);
    let body_sum = sha256(&buffer[HEADER_SIZE..]);
    buffer.extend_from_slice(&body_sum);
    Ok(buffer)
}

/// One decoded record: the status, the record when Ok, the bytes it used,
/// and C#'s message for an Invalid one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Decoded {
    pub status: Status,
    pub record: Option<Record>,
    pub consumed: usize,
    pub message: String,
}

fn incomplete() -> Decoded {
    Decoded {
        status: Status::Incomplete,
        record: None,
        consumed: 0,
        message: String::new(),
    }
}

fn invalid(message: impl Into<String>) -> Decoded {
    Decoded {
        status: Status::Invalid,
        record: None,
        consumed: 0,
        message: message.into(),
    }
}

/// Reads the record at the start of `input`.
pub fn decode_record(input: &[u8]) -> Decoded {
    if input.len() < HEADER_SIZE {
        return incomplete();
    }
    // Checked before the length is trusted, so a corrupt length is never
    // mistaken for an honest one that needs more bytes.
    if sha256(&input[..HEADER_CONTENT_SIZE])[..] != input[HEADER_CONTENT_SIZE..HEADER_SIZE] {
        return invalid("the header checksum does not match its content");
    }
    let body_length = u32_at(input, 0) as i32;
    let version = input[4];
    if version != CURRENT_VERSION {
        return invalid(format!("unsupported codec version {version}"));
    }
    let source = Source(input[5]);
    if !source.defined() {
        return invalid(format!("unknown operation source {}", input[5]));
    }
    // The ceiling first: a hostile writer can checksum any length it likes.
    if body_length < MIN_BODY_LENGTH as i32 || body_length > MAX_BODY_LENGTH as i32 {
        return invalid(format!("the body length {body_length} is out of range"));
    }
    let body_length = body_length as usize;
    if input.len() - HEADER_SIZE < body_length {
        return incomplete();
    }
    let body = &input[HEADER_SIZE..HEADER_SIZE + body_length];
    let content = &body[..body.len() - SHA256_SIZE];
    if sha256(content)[..] != body[content.len()..] {
        return invalid("the body checksum does not match its content");
    }
    let operation_id = lower_hex(&content[..16]);
    let sequence = u64_at(content, 16);
    if sequence < 1 {
        return invalid("server sequence 0 means nothing was committed on this lineage");
    }
    let tick_count = u64_at(content, 24) as i64;
    if !(0..=MAX_TICKS).contains(&tick_count) {
        return invalid("committedAt is out of range");
    }
    let actor_length = u32_at(content, 32) as i32;
    let mut offset = 36;
    if actor_length < -1
        || actor_length > MAX_ACTOR_ID_LENGTH as i32
        || actor_length > (content.len() - offset) as i32
    {
        return invalid("the actor id length is invalid");
    }
    let mut actor_id = None;
    if actor_length >= 0 {
        let actor = &content[offset..offset + actor_length as usize];
        let Ok(text) = std::str::from_utf8(actor) else {
            return invalid("the actor id is not valid UTF-8");
        };
        actor_id = Some(text.to_owned());
        offset += actor_length as usize;
    }
    if content.len() - offset < SHA256_SIZE {
        return invalid("the digest is truncated");
    }
    let digest = content[offset..offset + SHA256_SIZE].to_vec();
    offset += SHA256_SIZE;
    if content.len() - offset < 4 {
        return invalid("the update length is missing");
    }
    let update_length = u32_at(content, offset) as i32;
    offset += 4;
    if update_length < 1
        || update_length > MAX_UPDATE_LENGTH as i32
        || update_length > (content.len() - offset) as i32
    {
        return invalid("the update length is invalid");
    }
    let update = content[offset..offset + update_length as usize].to_vec();
    offset += update_length as usize;
    if offset != content.len() {
        return invalid(format!(
            "{} trailing byte(s) inside the record body",
            content.len() - offset
        ));
    }
    Decoded {
        status: Status::Ok,
        record: Some(Record {
            operation_id,
            sequence,
            committed_at: time_from_ticks(tick_count),
            actor_id,
            source,
            update,
            digest,
        }),
        consumed: HEADER_SIZE + body_length,
        message: String::new(),
    }
}

use sha2::{Digest, Sha256};

use crate::{Error, Tag};

/// "BKW2", int32 format, int64 epoch, 16 lineage bytes.
pub const HEADER_LENGTH: usize = 32;

const FRAME_PREFIX_LENGTH: usize = 4;
const LINEAGE_OFFSET: usize = 16;

// "BKWS" was the pre-lineage header; it now reads as unreadable. It never shipped.
const MAGIC: &[u8; 4] = b"BKW2";

pub(crate) fn lower_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(DIGITS[usize::from(byte >> 4)] as char);
        out.push(DIGITS[usize::from(byte & 0xf)] as char);
    }
    out
}

/// The lower-hex SHA-256 of the UTF-8 doc id: it names every file and S3 key.
///
/// # Panics
/// On an empty doc id.
pub fn doc_key(doc_id: &str) -> String {
    assert!(!doc_id.is_empty(), "collab: an empty doc id has no key");
    lower_hex(&Sha256::digest(doc_id.as_bytes()))
}

/// Writes the header, then the frame section as it is.
pub fn encode_document(tag: &Tag, frame_section: &[u8]) -> Result<Vec<u8>, Error> {
    if !tag.is_announceable() {
        return Err(Error::Refused(format!(
            "collab: the tag {tag} is not encodable. (Parameter 'tag')"
        )));
    }
    if !validate_frames(frame_section) {
        return Err(Error::Refused(
            "collab: the frame section is not a valid update log. (Parameter 'frameSection')"
                .to_owned(),
        ));
    }
    let mut document = Vec::with_capacity(HEADER_LENGTH + frame_section.len());
    document.extend_from_slice(MAGIC);
    document.extend_from_slice(&tag.format.to_le_bytes());
    document.extend_from_slice(&tag.epoch.to_le_bytes());
    let lineage = tag.lineage.as_bytes();
    for pair in lineage.chunks(2) {
        document.push((hex_digit(pair[0]) << 4) | hex_digit(pair[1]));
    }
    document.extend_from_slice(frame_section);
    Ok(document)
}

// Only called on a lineage `is_lineage` accepted.
fn hex_digit(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        _ => c - b'a' + 10,
    }
}

/// Reads just the header; the message is C#'s for a refusal.
pub fn decode_header(header: &[u8]) -> Result<Tag, String> {
    if header.len() < HEADER_LENGTH {
        return Err("the header is truncated".to_owned());
    }
    if &header[..MAGIC.len()] != MAGIC {
        return Err("the magic bytes do not match".to_owned());
    }
    let format = i32::from_le_bytes(header[4..8].try_into().expect("4 bytes"));
    let epoch = i64::from_le_bytes(header[8..16].try_into().expect("8 bytes"));
    if format < 1 || epoch < 0 {
        return Err(format!("the tag ({format}, {epoch}) is invalid"));
    }
    Ok(Tag {
        format,
        epoch,
        lineage: lower_hex(&header[LINEAGE_OFFSET..HEADER_LENGTH]),
    })
}

/// The tag and a copy of the frame section.
pub fn decode_document(document: &[u8]) -> Result<(Tag, Vec<u8>), String> {
    let tag = decode_header(document)?;
    if !validate_frames(&document[HEADER_LENGTH..]) {
        return Err("an update frame is empty or truncated".to_owned());
    }
    Ok((tag, document[HEADER_LENGTH..].to_vec()))
}

/// Each update with its int32 length prefix.
pub fn encode_frames<U: AsRef<[u8]>>(updates: &[U]) -> Result<Vec<u8>, Error> {
    if updates.iter().any(|update| update.as_ref().is_empty()) {
        return Err(Error::Refused(
            "collab: update frames must not be empty. (Parameter 'updates')".to_owned(),
        ));
    }
    let mut section = Vec::new();
    for update in updates {
        append_frame(&mut section, update.as_ref());
    }
    Ok(section)
}

/// Writes one length-prefixed frame: the room's log uses the same writer.
pub fn append_frame(buffer: &mut Vec<u8>, update: &[u8]) {
    let length = u32::try_from(update.len()).expect("an update frame over 4 GiB");
    buffer.extend_from_slice(&length.to_le_bytes());
    buffer.extend_from_slice(update);
}

/// Walks the section without copying.
pub fn validate_frames(section: &[u8]) -> bool {
    walk_frames(section, false).is_some()
}

/// A copy of each update.
pub fn decode_frames(section: &[u8]) -> Option<Vec<Vec<u8>>> {
    walk_frames(section, true)
}

fn walk_frames(mut section: &[u8], collect: bool) -> Option<Vec<Vec<u8>>> {
    let mut updates = Vec::new();
    while !section.is_empty() {
        if section.len() < FRAME_PREFIX_LENGTH {
            return None;
        }
        // Read as int32, as C# does: a length with the top bit set is negative.
        let length = i32::from_le_bytes(section[..4].try_into().expect("4 bytes"));
        if length < 1 || length as usize > section.len() - FRAME_PREFIX_LENGTH {
            return None;
        }
        let end = FRAME_PREFIX_LENGTH + length as usize;
        if collect {
            updates.push(section[FRAME_PREFIX_LENGTH..end].to_vec());
        }
        section = &section[end..];
    }
    Some(updates)
}

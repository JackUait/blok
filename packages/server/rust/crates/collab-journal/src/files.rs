use std::fs::File;
use std::io::{self, Write};
use std::os::unix::fs::FileExt;
use std::path::Path;

use crate::codec::{decode_hex, lower_hex, sha256};
use crate::error::Error;
use crate::lock::{Flags, open_file, read_shared};

// File names and magics inside a document's journal directory (C#
// LocalCollabOperationStore).
pub const MANIFEST_FILE_NAME: &str = "manifest";
pub const MANIFEST_MAGIC: &str = "BKJM";
pub const BASELINE_MAGIC: &str = "BKJB";
pub const CHECKPOINT_MAGIC: &str = "BKJC";

const MANIFEST_VERSION: u8 = 2;
pub const MANIFEST_SLOT_SIZE: usize = 128;
const MANIFEST_CONTENT_SIZE: usize = 96;
pub const MANIFEST_SIZE: usize = 2 * MANIFEST_SLOT_SIZE;
const SEALED_VERSION: u8 = 1;
const SEALED_HEADER_SIZE: usize = 24;
const CHECKSUM_SIZE: usize = 32;

/// One published manifest slot.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Manifest {
    pub write_counter: u64,
    pub fence: u64,
    pub generation: u64,
    pub seeded: bool,
    pub format: i32,
    pub epoch: i64,
    pub lineage: String,
    pub checkpoint_through: u64,
    pub generation_fence: u64,
    pub checkpoint_fence: u64,
}

/// One 128-byte slot: 96 bytes of fields, then their SHA-256. Panics on a
/// lineage that is not 32 hex characters, as Go does.
pub fn encode_manifest_slot(m: &Manifest) -> Vec<u8> {
    let mut slot = vec![0u8; MANIFEST_SLOT_SIZE];
    slot[..4].copy_from_slice(MANIFEST_MAGIC.as_bytes());
    slot[4] = MANIFEST_VERSION;
    slot[5] = u8::from(m.seeded);
    slot[8..16].copy_from_slice(&m.write_counter.to_le_bytes());
    slot[16..24].copy_from_slice(&m.fence.to_le_bytes());
    slot[24..32].copy_from_slice(&m.generation.to_le_bytes());
    slot[32..36].copy_from_slice(&m.format.to_le_bytes());
    slot[36..44].copy_from_slice(&m.epoch.to_le_bytes());
    assert!(
        decode_hex(&m.lineage, &mut slot[44..60]),
        "collab: lineage {:?} is not hex",
        m.lineage
    );
    slot[60..68].copy_from_slice(&m.checkpoint_through.to_le_bytes());
    slot[68..76].copy_from_slice(&m.generation_fence.to_le_bytes());
    slot[76..84].copy_from_slice(&m.checkpoint_fence.to_le_bytes());
    let sum = sha256(&slot[..MANIFEST_CONTENT_SIZE]);
    slot[MANIFEST_CONTENT_SIZE..].copy_from_slice(&sum);
    slot
}

enum SlotStatus {
    Ok(Manifest),
    Unreadable,
    Foreign,
}

fn decode_manifest_slot(slot: &[u8]) -> SlotStatus {
    if &slot[..4] != MANIFEST_MAGIC.as_bytes() {
        return SlotStatus::Unreadable;
    }
    // The checksum is checked before the version byte is trusted, so a
    // flipped byte reads as corruption, not as another version.
    if sha256(&slot[..MANIFEST_CONTENT_SIZE])[..] != slot[MANIFEST_CONTENT_SIZE..] {
        return SlotStatus::Unreadable;
    }
    if slot[4] != MANIFEST_VERSION {
        return SlotStatus::Foreign;
    }
    let u64_at = |at: usize| u64::from_le_bytes(slot[at..at + 8].try_into().expect("eight bytes"));
    SlotStatus::Ok(Manifest {
        write_counter: u64_at(8),
        fence: u64_at(16),
        generation: u64_at(24),
        seeded: slot[5] == 1,
        format: i32::from_le_bytes(slot[32..36].try_into().expect("four bytes")),
        epoch: u64_at(36) as i64,
        lineage: lower_hex(&slot[44..60]),
        checkpoint_through: u64_at(60),
        generation_fence: u64_at(68),
        checkpoint_fence: u64_at(76),
    })
}

/// None when the manifest does not exist yet or is empty (created, never
/// published). It fails when no slot decodes, so an unreadable document is
/// never handed back as a fresh one.
pub fn read_manifest(path: &Path, document_id: &str) -> Result<Option<Manifest>, Error> {
    let data = match read_shared(path) {
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
        other => other?,
    };
    if data.is_empty() {
        return Ok(None);
    }
    if data.len() != MANIFEST_SIZE {
        return Err(Error::invalid_data(format!(
            "collab: the manifest for \"{document_id}\" is {} bytes, not {MANIFEST_SIZE}.",
            data.len()
        )));
    }
    let mut best: Option<Manifest> = None;
    let mut foreign = None;
    for slot in data.chunks(MANIFEST_SLOT_SIZE) {
        match decode_manifest_slot(slot) {
            SlotStatus::Ok(candidate)
                if best
                    .as_ref()
                    .is_none_or(|b| candidate.write_counter > b.write_counter) =>
            {
                best = Some(candidate)
            }
            SlotStatus::Foreign => foreign = Some(slot[4]),
            _ => {}
        }
    }
    if best.is_some() {
        return Ok(best);
    }
    if let Some(version) = foreign {
        return Err(Error::invalid_data(format!(
            "collab: the manifest for \"{document_id}\" is version {version}, and this build writes version {MANIFEST_VERSION}."
        )));
    }
    Err(Error::invalid_data(format!(
        "collab: neither manifest slot for \"{document_id}\" decodes."
    )))
}

/// Writes a baseline or checkpoint: magic, version, tag, length, the
/// content, then a SHA-256 over all of it; flushed before it returns.
pub fn write_sealed(path: &Path, magic: &str, tag: u64, content: &[u8]) -> io::Result<()> {
    let mut buffer = Vec::with_capacity(SEALED_HEADER_SIZE + content.len() + CHECKSUM_SIZE);
    buffer.extend_from_slice(magic.as_bytes());
    buffer.resize(SEALED_HEADER_SIZE, 0);
    buffer[4] = SEALED_VERSION;
    buffer[8..16].copy_from_slice(&tag.to_le_bytes());
    buffer[16..24].copy_from_slice(&(content.len() as u64).to_le_bytes());
    buffer.extend_from_slice(content);
    let sum = sha256(&buffer);
    buffer.extend_from_slice(&sum);
    let flags = Flags {
        write: true,
        create: true,
        truncate: true,
        ..Flags::default()
    };
    let mut file = open_file(path, flags, true)?;
    file.write_all(&buffer)?;
    file.sync_all()
}

/// A sealed file's content and tag, or C#'s message for why it cannot be
/// trusted.
pub fn read_sealed(path: &Path, magic: &str, document_id: &str) -> Result<(Vec<u8>, u64), Error> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let data = match read_shared(path) {
        Err(err) if err.kind() == io::ErrorKind::NotFound => {
            return Err(Error::InvalidData {
                message: format!("collab: \"{document_id}\" names {name}, which is not there."),
                source: Some(err),
            });
        }
        other => other?,
    };
    if data.len() < SEALED_HEADER_SIZE + CHECKSUM_SIZE
        || &data[..magic.len()] != magic.as_bytes()
        || data[4] != SEALED_VERSION
    {
        return Err(Error::invalid_data(format!(
            "collab: {name} for \"{document_id}\" is not a readable record."
        )));
    }
    let tag = u64::from_le_bytes(data[8..16].try_into().expect("eight bytes"));
    let length = u64::from_le_bytes(data[16..24].try_into().expect("eight bytes")) as i64;
    if length < 0 || length != (data.len() - SEALED_HEADER_SIZE - CHECKSUM_SIZE) as i64 {
        return Err(Error::invalid_data(format!(
            "collab: {name} for \"{document_id}\" declares {length} content bytes, which is not what it holds."
        )));
    }
    let hashed = SEALED_HEADER_SIZE + length as usize;
    if sha256(&data[..hashed])[..] != data[hashed..hashed + CHECKSUM_SIZE] {
        return Err(Error::invalid_data(format!(
            "collab: {name} for \"{document_id}\" fails its checksum."
        )));
    }
    Ok((data[SEALED_HEADER_SIZE..hashed].to_vec(), tag))
}

/// Writes slot write_counter&1 in place. A torn write damages only the slot
/// it was writing, so publication needs no rename and no directory sync.
pub(crate) fn publish(manifest_file: &File, next: &Manifest) -> io::Result<()> {
    manifest_file.write_all_at(
        &encode_manifest_slot(next),
        (next.write_counter & 1) * MANIFEST_SLOT_SIZE as u64,
    )?;
    manifest_file.sync_all()
}

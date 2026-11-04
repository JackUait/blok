use std::io;
use std::path::Path;
use std::time::SystemTime;

use blok_dotnet::{MAX_TICKS, ticks, time_from_ticks};

use crate::codec::{decode_hex, lower_hex, sha256};
use crate::lock::read_shared;

/// The lineage ledger inside a document's journal directory.
pub const LEDGER_FILE_NAME: &str = "lineages";

/// What one ledger entry records.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LineageEntryKind(pub u8);

impl LineageEntryKind {
    pub const PUBLISHED: LineageEntryKind = LineageEntryKind(1);
    pub const DELETED: LineageEntryKind = LineageEntryKind(2);
}

/// One ledger entry. `created_at` is None for a lineage that began before
/// the ledger existed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LineageEntry {
    pub kind: LineageEntryKind,
    pub generation: u64,
    pub generation_fence: u64,
    pub lineage: String,
    pub epoch: i64,
    pub format: i32,
    pub created_at: Option<SystemTime>,
}

const LEDGER_CONTENT_SIZE: usize = 53;
const LEDGER_CHECKSUM_SIZE: usize = 8;
/// Every entry is the same size, so a reader steps over a bad one.
pub const LEDGER_ENTRY_SIZE: usize = LEDGER_CONTENT_SIZE + LEDGER_CHECKSUM_SIZE;
const UNKNOWN_TICKS: i64 = i64::MIN;

/// Writes kind, generation, fence, lineage, epoch, format and ticks, then
/// the first 8 bytes of a SHA-256 over them. Panics on a lineage that is not
/// 32 hex characters, as Go does.
pub fn encode_lineage_entry(entry: &LineageEntry) -> Vec<u8> {
    let mut slot = vec![0u8; LEDGER_ENTRY_SIZE];
    slot[0] = entry.kind.0;
    slot[1..9].copy_from_slice(&entry.generation.to_le_bytes());
    slot[9..17].copy_from_slice(&entry.generation_fence.to_le_bytes());
    assert!(
        decode_hex(&entry.lineage, &mut slot[17..33]),
        "collab: lineage {:?} is not hex",
        entry.lineage
    );
    slot[33..41].copy_from_slice(&entry.epoch.to_le_bytes());
    slot[41..45].copy_from_slice(&entry.format.to_le_bytes());
    let tick_count = entry.created_at.map_or(UNKNOWN_TICKS, ticks);
    slot[45..53].copy_from_slice(&tick_count.to_le_bytes());
    let sum = sha256(&slot[..LEDGER_CONTENT_SIZE]);
    slot[LEDGER_CONTENT_SIZE..].copy_from_slice(&sum[..LEDGER_CHECKSUM_SIZE]);
    slot
}

/// Reads one slot; None for a wrong size, checksum, kind or time.
pub fn decode_lineage_entry(slot: &[u8]) -> Option<LineageEntry> {
    if slot.len() != LEDGER_ENTRY_SIZE {
        return None;
    }
    if sha256(&slot[..LEDGER_CONTENT_SIZE])[..LEDGER_CHECKSUM_SIZE] != slot[LEDGER_CONTENT_SIZE..] {
        return None;
    }
    let kind = LineageEntryKind(slot[0]);
    if kind != LineageEntryKind::PUBLISHED && kind != LineageEntryKind::DELETED {
        return None;
    }
    let u64_at = |at: usize| u64::from_le_bytes(slot[at..at + 8].try_into().expect("eight bytes"));
    let tick_count = u64_at(45) as i64;
    if tick_count != UNKNOWN_TICKS && !(0..=MAX_TICKS).contains(&tick_count) {
        return None;
    }
    Some(LineageEntry {
        kind,
        generation: u64_at(1),
        generation_fence: u64_at(9),
        lineage: lower_hex(&slot[17..33]),
        epoch: u64_at(33) as i64,
        format: i32::from_le_bytes(slot[41..45].try_into().expect("four bytes")),
        created_at: (tick_count != UNKNOWN_TICKS).then(|| time_from_ticks(tick_count)),
    })
}

/// Every entry that decodes, in file order. A missing file is empty.
pub fn read_ledger(path: &Path, warn: Option<&dyn Fn(&str)>) -> io::Result<Vec<LineageEntry>> {
    let data = match read_shared(path) {
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        other => other?,
    };
    let mut entries = Vec::new();
    let mut offset = 0;
    while offset + LEDGER_ENTRY_SIZE <= data.len() {
        match decode_lineage_entry(&data[offset..offset + LEDGER_ENTRY_SIZE]) {
            Some(entry) => entries.push(entry),
            None => {
                if let Some(warn) = warn {
                    warn(&format!(
                        "collab: skipped a bad entry at byte {offset} of {}.",
                        path.display()
                    ));
                }
            }
        }
        offset += LEDGER_ENTRY_SIZE;
    }
    if offset < data.len()
        && let Some(warn) = warn
    {
        warn(&format!(
            "collab: skipped a torn entry at byte {offset} of {}.",
            path.display()
        ));
    }
    Ok(entries)
}

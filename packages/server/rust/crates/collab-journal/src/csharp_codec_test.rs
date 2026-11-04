//! C# CollabJournalCodecTests cases with no Go twin.

use std::time::{Duration, UNIX_EPOCH};

use blok_collab_operation::{Record, Source};
use blok_dotnet::ticks;

use crate::codec::sha256;
use crate::*;

const OPERATION_ID: &str = "0123456789abcdef0123456789abcdef";
// 2026-09-01T12:00:00Z.
const COMMITTED_AT_UNIX: u64 = 1_788_264_000;
const HEADER_SIZE: usize = 4 + 1 + 1 + 32;

fn make_record(
    sequence: u64,
    actor_id: Option<&str>,
    source: Source,
    update: &[u8],
    digest: Option<Vec<u8>>,
) -> Record {
    Record {
        operation_id: OPERATION_ID.into(),
        sequence,
        committed_at: UNIX_EPOCH + Duration::from_secs(COMMITTED_AT_UNIX),
        actor_id: actor_id.map(str::to_owned),
        source,
        update: update.to_vec(),
        digest: digest.unwrap_or_else(|| sha256(update).to_vec()),
    }
}

fn record(sequence: u64) -> Record {
    make_record(
        sequence,
        Some("actor-1"),
        Source::CLIENT_V2,
        &[1, 2, 3],
        None,
    )
}

// A 38-byte header with an honest checksum over a chosen, possibly hostile
// body length.
fn valid_header(body_length: i32) -> Vec<u8> {
    let mut header = body_length.to_le_bytes().to_vec();
    header.push(CURRENT_VERSION);
    header.push(Source::CLIENT_V2.0);
    let sum = sha256(&header);
    header.extend_from_slice(&sum);
    header
}

// Both checksums honest, but the update length lies about how many bytes
// follow: what a hostile writer, never encode_record, produces.
fn record_with_lying_update_length(declared: i32, actual: usize) -> Vec<u8> {
    let mut content = vec![0u8; 16];
    for i in 0..16 {
        content[i] = u8::from_str_radix(&OPERATION_ID[2 * i..2 * i + 2], 16).unwrap();
    }
    content.extend_from_slice(&1u64.to_le_bytes());
    content.extend_from_slice(
        &ticks(UNIX_EPOCH + Duration::from_secs(COMMITTED_AT_UNIX)).to_le_bytes(),
    );
    content.extend_from_slice(&(-1i32).to_le_bytes());
    content.extend_from_slice(&[0u8; 32]);
    content.extend_from_slice(&declared.to_le_bytes());
    content.extend((0..actual).map(|i| 0xc0 + i as u8));
    let sum = sha256(&content);
    content.extend_from_slice(&sum);
    let mut out = valid_header(content.len() as i32);
    out.extend_from_slice(&content);
    out
}

#[test]
fn round_trips_every_record_field() {
    let record = record(1);
    let encoded = encode_record(&record).unwrap();
    let decoded = decode_record(&encoded);
    assert_eq!(decoded.status, Status::Ok);
    assert_eq!(decoded.message, "");
    assert_eq!(decoded.consumed, encoded.len());
    assert_eq!(decoded.record, Some(record));
}

#[test]
fn rejects_oversized_lengths_before_allocating() {
    let mut outer = valid_header(i32::MAX);
    outer.extend_from_slice(&[0; 10]);
    let decoded = decode_record(&outer);
    assert_eq!((decoded.status, decoded.consumed), (Status::Invalid, 0));
    assert!(decoded.record.is_none());
    assert!(
        decoded.message.contains("body length"),
        "{}",
        decoded.message
    );

    let inner = decode_record(&record_with_lying_update_length(1_000_000, 3));
    assert_eq!((inner.status, inner.consumed), (Status::Invalid, 0));
    assert!(inner.record.is_none());
    assert!(inner.message.contains("update length"), "{}", inner.message);
}

#[test]
fn rejects_invalid_ids_and_sequences() {
    let mut short = record(1);
    short.operation_id = "too-short-to-be-an-id".into();
    assert!(matches!(encode_record(&short), Err(Error::Argument { .. })));
    let mut upper = record(1);
    upper.operation_id = "A".repeat(32);
    assert!(matches!(encode_record(&upper), Err(Error::Argument { .. })));
    assert!(matches!(
        encode_record(&record(0)),
        Err(Error::Argument { .. })
    ));
}

#[test]
fn detects_payload_digest_mismatch() {
    let digest = sha256(&[0xaa, 0xbb, 0xcc]).to_vec();
    let record = make_record(
        1,
        Some("actor-1"),
        Source::CLIENT_V2,
        &[0xaa, 0xbb, 0xcc],
        Some(digest.clone()),
    );
    let mut encoded = encode_record(&record).unwrap();
    let at = encoded.windows(32).position(|w| w == digest).unwrap();
    encoded[at] ^= 0xff;
    let decoded = decode_record(&encoded);
    assert_eq!(decoded.status, Status::Invalid);
    assert!(decoded.record.is_none());
    assert_ne!(decoded.message, "");
}

#[test]
fn http_edit_digest_covers_the_canonical_body_not_the_update() {
    let update = b"yjs-update-with-random-client-id";
    let canonical = sha256(b"{\"blockId\":\"b1\",\"data\":{\"text\":\"hi\"}}").to_vec();
    let record = make_record(
        1,
        Some("actor-1"),
        Source::HTTP_EDIT,
        update,
        Some(canonical.clone()),
    );
    let decoded = decode_record(&encode_record(&record).unwrap());
    assert_eq!(decoded.status, Status::Ok);
    let digest = decoded.record.unwrap().digest;
    assert_eq!(digest, canonical);
    assert_ne!(digest, sha256(update));
}

#[test]
fn recognizes_only_an_incomplete_final_record_as_torn() {
    let first = encode_record(&record(1)).unwrap();
    let second = encode_record(&record(2)).unwrap();
    let third = encode_record(&record(3)).unwrap();
    let journal = [&first[..], &second[..], &third[..third.len() / 2]].concat();
    let one = decode_record(&journal);
    let two = decode_record(&journal[one.consumed..]);
    let three = decode_record(&journal[one.consumed + two.consumed..]);
    assert_eq!((one.status, one.record.unwrap().sequence), (Status::Ok, 1));
    assert_eq!((two.status, two.record.unwrap().sequence), (Status::Ok, 2));
    assert_eq!((three.status, three.consumed), (Status::Incomplete, 0));
    assert!(three.record.is_none());
}

#[test]
fn fails_closed_on_middle_corruption() {
    let first = encode_record(&record(1)).unwrap();
    let second = encode_record(&record(2)).unwrap();
    let journal = [&first[..], &second[..]].concat();

    let mut body = journal.clone();
    body[HEADER_SIZE + 2] ^= 0xff;
    let decoded = decode_record(&body);
    assert_eq!(decoded.status, Status::Invalid);
    assert!(decoded.record.is_none());
    assert_ne!(decoded.message, "");

    let mut length = journal.clone();
    length[2] ^= 0xff;
    let decoded = decode_record(&length);
    assert_eq!(decoded.status, Status::Invalid);
    assert!(decoded.record.is_none());
    assert!(
        decoded.message.contains("header checksum"),
        "{}",
        decoded.message
    );

    for corrupted in [&body, &length] {
        let after = decode_record(&corrupted[first.len()..]);
        assert_eq!(
            (after.status, after.record.unwrap().sequence),
            (Status::Ok, 2)
        );
    }
}

#[test]
fn preserves_unknown_actor_as_null() {
    let record = make_record(1, None, Source::CLIENT_V2, &[1, 2, 3], None);
    let decoded = decode_record(&encode_record(&record).unwrap());
    assert_eq!(decoded.status, Status::Ok);
    assert_eq!(decoded.record.unwrap().actor_id, None);
}

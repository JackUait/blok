use crate::*;

const LINEAGE: &str = "0123456789abcdef0123456789abcdef";

fn tag() -> Tag {
    Tag {
        format: CURRENT_FORMAT,
        epoch: 7,
        lineage: LINEAGE.to_owned(),
    }
}

fn empty_document() -> Vec<u8> {
    encode_document(&tag(), &[]).unwrap()
}

#[test]
fn round_trips_an_empty_log() {
    let document = empty_document();
    assert_eq!(document.len(), HEADER_LENGTH);
    let (decoded, section) = decode_document(&document).unwrap();
    assert_eq!(decoded, tag());
    assert!(section.is_empty());
}

#[test]
fn round_trips_update_frames() {
    let updates: Vec<Vec<u8>> = vec![
        vec![0x01],
        vec![0x00, 0xff, 0x10],
        b"an update with text bytes".to_vec(),
    ];
    let document = encode_document(&tag(), &encode_frames(&updates).unwrap()).unwrap();
    let (decoded, section) = decode_document(&document).unwrap();
    assert_eq!(decoded, tag());
    assert_eq!(decode_frames(&section).unwrap(), updates);
}

#[test]
fn encodes_the_documented_byte_layout() {
    let tag = Tag {
        format: 1,
        epoch: 0x0102030405060708,
        lineage: "00112233445566778899aabbccddeeff".to_owned(),
    };
    let document = encode_document(&tag, &encode_frames(&[[0xaa, 0xbb]]).unwrap()).unwrap();
    assert_eq!(
        document,
        [
            0x42, 0x4b, 0x57, 0x32, 0x01, 0x00, 0x00, 0x00, 0x08, 0x07, 0x06, 0x05, 0x04, 0x03,
            0x02, 0x01, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb,
            0xcc, 0xdd, 0xee, 0xff, 0x02, 0x00, 0x00, 0x00, 0xaa, 0xbb,
        ]
    );
}

#[test]
fn preserves_extreme_tag_values() {
    let tag = Tag {
        format: i32::MAX,
        epoch: i64::MAX,
        lineage: "f".repeat(LINEAGE_LENGTH),
    };
    let (decoded, _) = decode_document(&encode_document(&tag, &[]).unwrap()).unwrap();
    assert_eq!(decoded, tag);
}

#[test]
fn rejects_a_truncated_header() {
    for length in [0, 4, 16, 31] {
        let error = decode_document(&empty_document()[..length]).unwrap_err();
        assert_ne!(error, "", "{length}");
    }
}

#[test]
fn rejects_the_header_of_the_pre_lineage_container() {
    let old = [
        0x42, 0x4b, 0x57, 0x53, 0x01, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00,
    ];
    assert_ne!(decode_document(&old).unwrap_err(), "");
}

#[test]
fn round_trips_the_lineage() {
    let tag = Tag {
        format: CURRENT_FORMAT,
        epoch: 2,
        lineage: new_lineage(),
    };
    let (decoded, _) = decode_document(&encode_document(&tag, &[]).unwrap()).unwrap();
    assert_eq!(decoded, tag);
    assert!(is_lineage(&decoded.lineage));
}

#[test]
fn mints_a_distinct_lineage_every_time() {
    let lineages: Vec<String> = (0..64).map(|_| new_lineage()).collect();
    let distinct: std::collections::HashSet<&String> = lineages.iter().collect();
    assert_eq!(distinct.len(), 64);
    assert!(lineages.iter().all(|lineage| {
        lineage.len() == 32
            && lineage
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    }));
}

#[test]
fn refuses_to_encode_a_tag_without_a_well_formed_lineage() {
    for lineage in [
        "",
        "0123456789abcdef0123456789abcde",
        "0123456789abcdef0123456789abcdef0",
        "0123456789ABCDEF0123456789ABCDEF",
        "0123456789abcdef0123456789abcdeg",
    ] {
        let tag = Tag {
            format: CURRENT_FORMAT,
            epoch: 0,
            lineage: lineage.to_owned(),
        };
        assert!(
            matches!(encode_document(&tag, &[]), Err(Error::Refused(_))),
            "{lineage:?}"
        );
    }
}

#[test]
fn rejects_a_wrong_magic() {
    let mut document = empty_document();
    document[0] = b'X';
    assert!(decode_document(&document).is_err());
}

#[test]
fn rejects_a_non_positive_format() {
    let mut document = empty_document();
    document[4] = 0;
    assert!(decode_document(&document).is_err());
}

#[test]
fn rejects_a_negative_epoch() {
    let mut document = empty_document();
    document[15] = 0x80;
    assert!(decode_document(&document).is_err());
}

#[test]
fn rejects_a_truncated_frame() {
    let section = encode_frames(&[[0x01, 0x02, 0x03, 0x04]]).unwrap();
    let document = encode_document(&tag(), &section).unwrap();
    assert!(decode_document(&document[..document.len() - 2]).is_err());
}

#[test]
fn rejects_trailing_bytes_that_cannot_form_a_frame() {
    for extra in 1..=3 {
        let mut padded = empty_document();
        padded.resize(HEADER_LENGTH + extra, 0);
        assert!(decode_document(&padded).is_err(), "{extra}");
    }
}

#[test]
fn rejects_a_non_positive_frame_length() {
    let mut document = empty_document();
    document.resize(HEADER_LENGTH + 4, 0);
    assert!(decode_document(&document).is_err());
}

#[test]
fn rejects_a_frame_length_beyond_the_remaining_bytes() {
    let mut document = empty_document();
    document.resize(HEADER_LENGTH + 5, 0);
    document[HEADER_LENGTH] = 0x7f;
    document[HEADER_LENGTH + 3] = 0x7f;
    assert!(decode_document(&document).is_err());
}

#[test]
fn refuses_to_encode_an_empty_update_frame() {
    let empty: [&[u8]; 1] = [&[]];
    assert!(matches!(encode_frames(&empty), Err(Error::Refused(_))));
}

#[test]
fn refuses_to_encode_an_invalid_tag() {
    for (format, epoch) in [(0, 0), (-1, 0), (1, -1)] {
        let tag = Tag {
            format,
            epoch,
            lineage: LINEAGE.to_owned(),
        };
        assert!(
            matches!(encode_document(&tag, &[]), Err(Error::Refused(_))),
            "{format} {epoch}"
        );
    }
}

#[test]
fn refuses_to_encode_an_invalid_frame_section() {
    assert!(matches!(
        encode_document(&tag(), &[0x01, 0x02]),
        Err(Error::Refused(_))
    ));
}

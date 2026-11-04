use blok_collab_operation::{Record, Source};
use blok_dotnet::{ticks, time_from_ticks};

use crate::fixture::*;
use crate::*;

#[test]
fn encodes_every_record_to_the_bytes_c_sharp_writes() {
    let fixture = load("collab-disk/codecs.json");
    let cases = items(at(&fixture, "journal"), "encode");
    assert!(!cases.is_empty(), "no encode cases");
    for c in cases {
        let record = Record {
            operation_id: text(c, "operationId"),
            sequence: u64_text(c, "sequence"),
            committed_at: time_from_ticks(i64_text(c, "ticks")),
            actor_id: opt_text(c, "actor"),
            source: Source(number(c, "source") as u8),
            update: unhex(&text(c, "update")),
            digest: unhex(&text(c, "digest")),
        };
        let seq = text(c, "sequence");
        let encoded = encode_record(&record).unwrap_or_else(|e| panic!("seq {seq}: {e}"));
        assert_eq!(hex(&encoded), text(c, "hex"), "seq {seq}");
        let decoded = decode_record(&encoded);
        assert_eq!(
            (decoded.status, decoded.consumed, decoded.message.as_str()),
            (Status::Ok, encoded.len(), ""),
            "seq {seq}"
        );
        let got = decoded.record.unwrap();
        assert_eq!(ticks(got.committed_at), i64_text(c, "ticks"), "seq {seq}");
        assert_eq!(got, record, "seq {seq}");
    }
}

#[test]
fn decodes_every_broken_record_like_c_sharp() {
    let fixture = load("collab-disk/codecs.json");
    for c in items(at(&fixture, "journal"), "decode") {
        let name = text(c, "name");
        let decoded = decode_record(&unhex(&text(c, "hex")));
        assert_eq!(decoded.status.to_string(), text(c, "status"), "{name}");
        assert_eq!(decoded.consumed as i64, number(c, "consumed"), "{name}");
        assert_eq!(decoded.message, text(c, "error"), "{name}");
        assert_eq!(
            decoded.record.map(|r| r.sequence.to_string()),
            opt_text(c, "sequence"),
            "{name}"
        );
    }
}

#[test]
fn refuses_to_encode_what_c_sharp_refuses() {
    let good = Record {
        operation_id: "0123456789abcdef0123456789abcdef".into(),
        sequence: 1,
        committed_at: time_from_ticks(0),
        actor_id: None,
        source: Source::CLIENT_V2,
        update: vec![1],
        digest: vec![0; 32],
    };
    type Change = Box<dyn Fn(&mut Record)>;
    let cases: Vec<(&str, Change)> = vec![
        (
            "upper-case id",
            Box::new(|r| r.operation_id = "0123456789ABCDEF0123456789abcdef".into()),
        ),
        ("short id", Box::new(|r| r.operation_id = "0123".into())),
        ("sequence 0", Box::new(|r| r.sequence = 0)),
        ("source 3", Box::new(|r| r.source = Source(3))),
        ("digest 31", Box::new(|r| r.digest = vec![0; 31])),
        ("empty update", Box::new(|r| r.update = vec![])),
        (
            "actor past 4096",
            Box::new(|r| r.actor_id = Some("a".repeat(4097))),
        ),
        (
            "update past cap",
            Box::new(|r| r.update = vec![0; MAX_UPDATE_LENGTH + 1]),
        ),
    ];
    for (name, change) in cases {
        let mut record = good.clone();
        change(&mut record);
        assert!(encode_record(&record).is_err(), "{name}: encoded");
    }
    let mut record = good;
    record.actor_id = Some("a".repeat(4096));
    record.update = vec![0; MAX_UPDATE_LENGTH];
    encode_record(&record).expect("4096-byte actor, 32 MiB update");
}

#[test]
fn names_an_undefined_source_by_its_number_like_c_sharp() {
    let record = Record {
        operation_id: "0123456789abcdef0123456789abcdef".into(),
        sequence: 1,
        committed_at: time_from_ticks(0),
        actor_id: None,
        source: Source(3),
        update: vec![1],
        digest: vec![0; 32],
    };
    let error = encode_record(&record).unwrap_err();
    assert_eq!(
        error.to_string(),
        "collab: 3 is not a known operation source."
    );
}

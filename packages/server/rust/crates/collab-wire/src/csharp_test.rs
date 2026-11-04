//! C# SyncWireTests and SyncWireFramingTests cases with no Go twin.

use blok_jsjson::Kind;

use crate::wire_test::{fixture, get, items, text, unhex};
use crate::*;

const LINEAGE: &str = "0123456789abcdef0123456789abcdef";
const OPERATION_ID: &str = "fedcba9876543210fedcba9876543210";

fn control(epoch: i64, format: i32, lineage: &str) -> String {
    format!("{{\"epoch\":{epoch},\"format\":{format},\"lineage\":\"{lineage}\"}}")
}

fn framed(message_type: u64, json: &[u8]) -> Vec<u8> {
    assert!(json.len() < 128);
    let mut frame = vec![message_type as u8, json.len() as u8];
    frame.extend_from_slice(json);
    frame
}

fn control_frame(json: &str) -> Vec<u8> {
    framed(MESSAGE_BLOK_CONTROL, json.as_bytes())
}

fn limits_frame(json: &str) -> Vec<u8> {
    framed(MESSAGE_BLOK_LIMITS, json.as_bytes())
}

#[test]
fn encodes_the_documented_byte_layout() {
    let message = Message::PermissionDenied {
        reason: String::new(),
    };
    assert_eq!(encode(&message).unwrap(), [0x02, 0x00, 0x00]);
}

#[test]
fn decodes_the_documented_byte_layout() {
    assert_eq!(
        decode(&[0x02, 0x00, 0x00]),
        Ok(Message::PermissionDenied {
            reason: String::new()
        })
    );
}

#[test]
fn round_trips_a_multi_byte_payload_length() {
    let payload: Vec<u8> = (0..300u32).map(|i| (i * 7 + 3) as u8).collect();
    let frame = encode(&Message::SyncUpdate {
        update: payload.clone(),
    })
    .unwrap();
    assert_eq!(frame[..4], [0x00, 0x02, 0xac, 0x02]);
    assert_eq!(decode(&frame), Ok(Message::SyncUpdate { update: payload }));
}

#[test]
fn round_trips_a_control_frame_with_large_values() {
    let tag = Tag {
        format: i32::MAX,
        epoch: i64::MAX,
        lineage: "a1b2c3d4e5f60718293a4b5c6d7e8f90".into(),
    };
    let frame = encode(&Message::BlokControl { tag: tag.clone() }).unwrap();
    assert_eq!(decode(&frame), Ok(Message::BlokControl { tag }));
}

#[test]
fn round_trips_a_limits_frame_with_a_large_value() {
    let message = Message::BlokLimits {
        max_message_bytes: i64::MAX,
    };
    assert_eq!(decode(&encode(&message).unwrap()), Ok(message));
}

#[test]
fn refuses_to_encode_a_non_positive_limit() {
    for max_message_bytes in [0, -1] {
        assert!(encode(&Message::BlokLimits { max_message_bytes }).is_err());
    }
}

#[test]
fn round_trips_a_non_ascii_reason() {
    let reason = "доступ запрещён — read-only";
    let frame = encode(&Message::PermissionDenied {
        reason: reason.into(),
    })
    .unwrap();
    assert_eq!(usize::from(frame[2]), reason.len());
    assert_eq!(
        decode(&frame),
        Ok(Message::PermissionDenied {
            reason: reason.into()
        })
    );
}

#[test]
fn decodes_an_unknown_message_type_without_reading_its_payload() {
    assert_eq!(
        decode(&[0x04, 0xde, 0xad]),
        Ok(Message::Unknown { message_type: 4 })
    );
}

#[test]
fn refuses_to_encode_an_unknown_frame() {
    assert!(encode(&Message::Unknown { message_type: 4 }).is_err());
}

fn operation(lineage: &str, operation_id: &str, update: &[u8]) -> Message {
    Message::Operation {
        lineage: lineage.into(),
        operation_id: operation_id.into(),
        update: update.to_vec(),
    }
}

#[test]
fn refuses_to_encode_an_operation_with_an_empty_update() {
    assert!(encode(&operation(LINEAGE, OPERATION_ID, &[])).is_err());
}

#[test]
fn refuses_to_encode_an_operation_with_an_invalid_lineage() {
    for lineage in [
        "",
        "0123456789abcdef0123456789abcde",
        "0123456789ABCDEF0123456789ABCDEF",
    ] {
        assert!(
            encode(&operation(lineage, OPERATION_ID, &[1])).is_err(),
            "{lineage}"
        );
    }
}

#[test]
fn refuses_to_encode_an_operation_with_an_invalid_operation_id() {
    assert!(encode(&operation(LINEAGE, "not-hex", &[1])).is_err());
}

#[test]
fn refuses_to_encode_an_acknowledgement_with_server_sequence_zero() {
    let message = Message::Acknowledgement {
        lineage: LINEAGE.into(),
        operation_id: OPERATION_ID.into(),
        server_sequence: 0,
    };
    assert!(encode(&message).is_err());
}

#[test]
fn refuses_to_encode_a_rejection_with_an_invalid_code() {
    for code in ["", "Read-Only", "read_only", "1nvalid"] {
        let message = Message::Rejection {
            lineage: LINEAGE.into(),
            operation_id: OPERATION_ID.into(),
            code: code.into(),
        };
        assert!(encode(&message).is_err(), "{code}");
    }
}

#[test]
fn refuses_to_encode_an_invalid_control_tag() {
    for (format, epoch, lineage) in [
        (0, 0, LINEAGE),
        (-1, 0, LINEAGE),
        (1, -1, LINEAGE),
        (1, 0, ""),
        (1, 0, "0123456789abcdef0123456789abcde"),
        (1, 0, "0123456789ABCDEF0123456789ABCDEF"),
    ] {
        let tag = Tag {
            format,
            epoch,
            lineage: lineage.into(),
        };
        assert!(
            encode(&Message::BlokControl { tag }).is_err(),
            "{format} {epoch} {lineage}"
        );
    }
}

#[test]
fn reads_the_awareness_client_count_from_the_head_of_the_payload() {
    for (update, clients) in [
        (&[0x00][..], 0),
        (&[0x01, 0xe8, 0x07, 0x01, 0x02, 0x7b, 0x7d][..], 1),
        (&[0xa0, 0x8d, 0x06][..], 100_000),
    ] {
        assert_eq!(read_var_uint(update).map(|(v, _)| v), Some(clients));
    }
}

#[test]
fn refuses_an_awareness_payload_without_a_readable_client_count() {
    assert_eq!(read_var_uint(&[0x80]), None);
}

#[test]
fn refuses_to_encode_an_empty_payload() {
    for message in [
        Message::SyncStep1 {
            state_vector: vec![],
        },
        Message::SyncStep2 { update: vec![] },
        Message::SyncUpdate { update: vec![] },
        Message::Awareness { update: vec![] },
    ] {
        assert!(encode(&message).is_err(), "{message:?}");
    }
}

#[test]
fn rejects_a_malformed_frame() {
    let l = LINEAGE;
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("empty frame", vec![]),
        ("sync without sub-type", vec![0x00]),
        ("sync without length", vec![0x00, 0x00]),
        (
            "length beyond remaining bytes",
            vec![0x00, 0x00, 0x05, 0x01, 0x02],
        ),
        ("trailing bytes", vec![0x00, 0x00, 0x01, 0x00, 0xff]),
        ("empty sync payload", vec![0x00, 0x02, 0x00]),
        ("empty awareness payload", vec![0x01, 0x00]),
        ("unknown sync sub-type", vec![0x00, 0x03, 0x01, 0x00]),
        ("unknown auth sub-type", vec![0x02, 0x01, 0x00]),
        ("auth without reason", vec![0x02, 0x00]),
        ("invalid utf-8 reason", vec![0x02, 0x00, 0x01, 0xff]),
        ("query awareness with payload", vec![0x03, 0x00]),
        ("unterminated varuint", vec![0x80, 0x80]),
        (
            "varuint longer than 64 bits",
            [vec![0x80; 10], vec![0x01]].concat(),
        ),
        (
            "varuint overflowing 64 bits",
            [vec![0x80; 9], vec![0x02]].concat(),
        ),
        ("control without payload", vec![0x64]),
        ("control with malformed json", vec![0x64, 0x01, b'{']),
        ("control that is not an object", vec![0x64, 0x01, b'7']),
        (
            "control missing format",
            control_frame(&format!("{{\"epoch\":7,\"lineage\":\"{l}\"}}")),
        ),
        (
            "control missing epoch",
            control_frame(&format!("{{\"format\":1,\"lineage\":\"{l}\"}}")),
        ),
        (
            "control missing lineage",
            control_frame("{\"epoch\":7,\"format\":1}"),
        ),
        (
            "control with negative epoch",
            control_frame(&control(-1, 1, l)),
        ),
        ("control with zero format", control_frame(&control(7, 0, l))),
        (
            "control with fractional epoch",
            control_frame(&format!(
                "{{\"epoch\":7.5,\"format\":1,\"lineage\":\"{l}\"}}"
            )),
        ),
        (
            "control with string epoch",
            control_frame(&format!(
                "{{\"epoch\":\"7\",\"format\":1,\"lineage\":\"{l}\"}}"
            )),
        ),
        (
            "control with numeric lineage",
            control_frame("{\"epoch\":7,\"format\":1,\"lineage\":7}"),
        ),
        (
            "control with a short lineage",
            control_frame(&control(7, 1, "0123456789abcdef0123456789abcde")),
        ),
        (
            "control with a long lineage",
            control_frame(&control(7, 1, &format!("{l}0"))),
        ),
        (
            "control with an upper-case lineage",
            control_frame(&control(7, 1, "0123456789ABCDEF0123456789ABCDEF")),
        ),
        (
            "control with a non-hex lineage",
            control_frame(&control(7, 1, "0123456789abcdef0123456789abcdeg")),
        ),
        (
            "control with extra property",
            control_frame(&format!(
                "{{\"epoch\":7,\"format\":1,\"lineage\":\"{l}\",\"x\":1}}"
            )),
        ),
        (
            "control with duplicate epoch",
            control_frame(&format!(
                "{{\"epoch\":7,\"format\":1,\"lineage\":\"{l}\",\"epoch\":8}}"
            )),
        ),
        (
            "control with duplicate lineage",
            control_frame(&format!(
                "{{\"epoch\":7,\"format\":1,\"lineage\":\"{l}\",\"lineage\":\"{l}\"}}"
            )),
        ),
        (
            "control with trailing json",
            control_frame(&format!("{}1", control(7, 1, l))),
        ),
        ("limits without payload", vec![0x65]),
        ("limits with a truncated payload", vec![0x65, 0xff]),
        ("limits with malformed json", vec![0x65, 0x01, b'{']),
        ("limits that is not an object", vec![0x65, 0x01, b'7']),
        ("limits missing its key", limits_frame("{}")),
        (
            "limits with unknown key",
            limits_frame("{\"maxMessageBytes\":1,\"x\":2}"),
        ),
        (
            "limits with string value",
            limits_frame("{\"maxMessageBytes\":\"1\"}"),
        ),
        (
            "limits with negative value",
            limits_frame("{\"maxMessageBytes\":-1}"),
        ),
        (
            "limits with zero value",
            limits_frame("{\"maxMessageBytes\":0}"),
        ),
        (
            "limits with fractional value",
            limits_frame("{\"maxMessageBytes\":1.5}"),
        ),
        (
            "limits past a 64-bit long",
            limits_frame("{\"maxMessageBytes\":9223372036854775808}"),
        ),
        (
            "limits with duplicate key",
            limits_frame("{\"maxMessageBytes\":1,\"maxMessageBytes\":2}"),
        ),
        (
            "limits with trailing json",
            limits_frame("{\"maxMessageBytes\":1}1"),
        ),
    ];
    for (description, frame) in cases {
        let error = decode(&frame).expect_err(description);
        assert_ne!(error.reason, "", "{description}");
    }
}

#[test]
fn reads_a_ten_byte_var_uint() {
    let maximum = [
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01, 0x42,
    ];
    let (value, rest) = read_var_uint(&maximum).unwrap();
    assert_eq!(value, u64::MAX);
    assert_eq!(rest.len(), 1);

    let tag = Tag {
        format: 2,
        epoch: 7,
        lineage: LINEAGE.into(),
    };
    let frame = encode(&Message::BlokControl { tag }).unwrap();
    let (message_type, rest) = read_var_uint(&frame).unwrap();
    assert_eq!(message_type, MESSAGE_BLOK_CONTROL);
    let (payload, rest) = read_var_bytes(rest).unwrap();
    assert_eq!(payload, control(7, 2, LINEAGE).as_bytes());
    assert!(rest.is_empty());
}

fn frames_fixture(name: &str) -> blok_jsjson::Node {
    let f = fixture("sync-frames.json");
    items(&f, "frames")
        .iter()
        .find(|frame| text(frame, "name") == name)
        .unwrap_or_else(|| panic!("no frame {name}"))
        .clone()
}

#[test]
fn validates_the_stock_awareness_fixture_as_one_client() {
    let payload = unhex(&text(&frames_fixture("awareness"), "payloadHex"));
    assert_eq!(validate_awareness_update(&payload, 256, None), (1, true));
}

#[test]
fn validates_a_well_formed_awareness_payload() {
    for (payload, expected) in [
        (&[0x00][..], 0),
        (&[0x01, 0xe8, 0x07, 0x01, 0x02, 0x7b, 0x7d][..], 1),
        (
            &[0x01, 0xe8, 0x07, 0x01, 0x04, 0x6e, 0x75, 0x6c, 0x6c][..],
            1,
        ),
        (
            &[
                0x02, 0x01, 0x01, 0x02, 0x7b, 0x7d, 0x02, 0x01, 0x02, 0x7b, 0x7d,
            ][..],
            2,
        ),
    ] {
        assert_eq!(
            validate_awareness_update(payload, 256, None),
            (expected, true)
        );
    }
}

#[test]
fn refuses_a_malformed_awareness_payload() {
    for (description, payload) in [
        ("empty payload", &[][..]),
        ("unterminated count", &[0x80][..]),
        ("truncated after the clock", &[0x01, 0x02, 0x03][..]),
        (
            "truncated inside the state",
            &[0x01, 0x02, 0x03, 0x05, 0x7b, 0x7d][..],
        ),
        (
            "state that is not JSON",
            &[0x01, 0x02, 0x03, 0x01, 0x7b][..],
        ),
        ("empty state", &[0x01, 0x02, 0x03, 0x00][..]),
        (
            "state with trailing JSON",
            &[0x01, 0x02, 0x03, 0x03, 0x7b, 0x7d, 0x31][..],
        ),
        (
            "fewer entries than the count",
            &[0x02, 0x02, 0x03, 0x02, 0x7b, 0x7d][..],
        ),
        (
            "bytes after the last entry",
            &[0x01, 0x02, 0x03, 0x02, 0x7b, 0x7d, 0xff][..],
        ),
    ] {
        assert!(
            !validate_awareness_update(payload, 256, None).1,
            "{description}"
        );
    }
}

#[test]
fn refuses_an_awareness_payload_over_the_client_cap_but_still_reports_the_claimed_count() {
    let payload = [0xa0, 0x8d, 0x06, 0xe8, 0x07, 0x01, 0x02, 0x7b, 0x7d];
    assert_eq!(
        validate_awareness_update(&payload, 256, None),
        (100_000, false)
    );
}

#[test]
fn refuses_a_string_that_is_not_unicode_instead_of_throwing() {
    for (message_type, json) in [
        (
            100,
            "{\"epoch\":0,\"format\":1,\"lineage\":\"\\ud800123456789abcdef0123456789abcdef\"}",
        ),
        (
            107,
            "{\"identities\":[{\"clientId\":1,\"actorId\":\"\\ud800\"}]}",
        ),
    ] {
        let error = decode(&framed(message_type, json.as_bytes())).unwrap_err();
        assert!(
            error.reason.contains("ill-typed property"),
            "{}",
            error.reason
        );
    }
}

#[test]
fn refuses_invalid_utf8_in_a_string_instead_of_throwing() {
    for (message_type, before, after) in [
        (
            100,
            "{\"epoch\":0,\"format\":1,\"lineage\":\"",
            "123456789abcdef0123456789abcdef\"}",
        ),
        (
            107,
            "{\"identities\":[{\"clientId\":1,\"actorId\":\"",
            "\"}]}",
        ),
    ] {
        let payload = [before.as_bytes(), &[0xff], after.as_bytes()].concat();
        let error = decode(&framed(message_type, &payload)).unwrap_err();
        assert!(
            error.reason.contains("ill-typed property"),
            "{}",
            error.reason
        );
    }
}

#[test]
fn decodes_then_re_encodes_every_fixture_byte_for_byte() {
    let f = fixture("sync-frames.json");
    for frame in items(&f, "frames") {
        let bytes = unhex(&text(frame, "frameHex"));
        assert_eq!(encode(&decode(&bytes).unwrap()).unwrap(), bytes);
    }
}

#[test]
#[ignore = "needs a Yjs engine to apply the state vector; no Rust yjs crate is on main yet"]
fn sync_step1_carries_the_seed_state_vector() {}

#[test]
#[ignore = "needs a Yjs engine to replay the update; no Rust yjs crate is on main yet"]
fn sync_step2_replays_the_seeded_document() {}

#[test]
#[ignore = "needs a Yjs engine to apply the update; no Rust yjs crate is on main yet"]
fn update_appends_to_the_seeded_document() {}

fn number(node: &blok_jsjson::Node, key: &str) -> u64 {
    let value = get(node, key).unwrap_or_else(|| panic!("no {key}"));
    assert_eq!(value.kind, Kind::Number);
    std::str::from_utf8(value.raw()).unwrap().parse().unwrap()
}

#[test]
fn awareness_carries_the_recorded_client_state() {
    let f = fixture("sync-frames.json");
    let frame = frames_fixture("awareness");
    let expected = get(&frame, "awareness").unwrap();
    let Ok(Message::Awareness { update }) = decode(&unhex(&text(&frame, "frameHex"))) else {
        panic!("not an awareness frame");
    };
    assert_eq!(update, unhex(&text(&frame, "payloadHex")));
    let (count, rest) = read_var_uint(&update).unwrap();
    assert_eq!(count, 1);
    let (client_id, rest) = read_var_uint(rest).unwrap();
    assert_eq!(client_id, number(expected, "clientId"));
    assert_eq!(client_id, number(&f, "clientId"));
    let (clock, rest) = read_var_uint(rest).unwrap();
    assert_eq!(clock, number(expected, "clock"));
    let (state, rest) = read_var_bytes(rest).unwrap();
    assert_eq!(state, text(expected, "stateJson").as_bytes());
    assert!(rest.is_empty());
}

#[test]
fn permission_denied_carries_the_reason() {
    let frame = frames_fixture("permissionDenied");
    let Ok(Message::PermissionDenied { reason }) = decode(&unhex(&text(&frame, "frameHex"))) else {
        panic!("not a permission-denied frame");
    };
    assert_eq!(reason, text(&frame, "reason"));
    assert_eq!(reason.as_bytes(), unhex(&text(&frame, "payloadHex")));
}

#[test]
fn query_awareness_is_the_bare_type_byte() {
    let frame = frames_fixture("queryAwareness");
    let bytes = unhex(&text(&frame, "frameHex"));
    assert_eq!(decode(&bytes), Ok(Message::QueryAwareness));
    assert_eq!(bytes, [0x03]);
    assert_eq!(number(&frame, "messageType"), MESSAGE_QUERY_AWARENESS);
}

#[test]
fn blok_control_carries_the_epoch_format_and_lineage() {
    let frame = frames_fixture("blokControl");
    let expected = get(&frame, "control").unwrap();
    assert_eq!(number(&frame, "messageType"), MESSAGE_BLOK_CONTROL);
    let Ok(Message::BlokControl { tag }) = decode(&unhex(&text(&frame, "frameHex"))) else {
        panic!("not a control frame");
    };
    assert_eq!(
        tag,
        Tag {
            format: number(expected, "format") as i32,
            epoch: number(expected, "epoch") as i64,
            lineage: text(expected, "lineage"),
        }
    );
    assert_eq!(tag.format, 2);
    assert!(is_lineage(&tag.lineage));
}

#[test]
fn blok_limits_carries_the_max_message_bytes() {
    let frame = frames_fixture("blokLimits");
    assert_eq!(number(&frame, "messageType"), MESSAGE_BLOK_LIMITS);
    let Ok(Message::BlokLimits { max_message_bytes }) = decode(&unhex(&text(&frame, "frameHex")))
    else {
        panic!("not a limits frame");
    };
    let expected = get(&frame, "limits").unwrap();
    assert_eq!(
        max_message_bytes as u64,
        number(expected, "maxMessageBytes")
    );
    assert!(max_message_bytes > 0);
}

#[test]
fn fixture_message_types_match_the_decoded_kinds() {
    let check = |name: &str, message_type: u64, key: Option<(&str, u64)>| {
        let frame = frames_fixture(name);
        assert_eq!(number(&frame, "messageType"), message_type, "{name}");
        if let Some((key, value)) = key {
            assert_eq!(number(&frame, key), value, "{name}");
        }
    };
    check("syncStep1", MESSAGE_SYNC, Some(("syncType", 0)));
    check("syncStep2", MESSAGE_SYNC, Some(("syncType", 1)));
    check("update", MESSAGE_SYNC, Some(("syncType", 2)));
    check("awareness", MESSAGE_AWARENESS, None);
    check("permissionDenied", MESSAGE_AUTH, Some(("authType", 0)));
}

fn v2_frame(name: &str) -> blok_jsjson::Node {
    let f = fixture("sync-frames.json");
    items(get(&f, "v2").unwrap(), "frames")
        .iter()
        .find(|frame| text(frame, "name") == name)
        .unwrap_or_else(|| panic!("no v2 frame {name}"))
        .clone()
}

fn is_rejection_code_pattern(code: &str) -> bool {
    crate::encode::is_rejection_code(code)
}

#[test]
fn decodes_every_v2_fixture_into_its_fields() {
    let f = fixture("sync-frames.json");
    let v2 = get(&f, "v2").unwrap();
    assert_eq!(text(v2, "rejectionCodePattern"), "^[a-z][a-z0-9-]{0,63}$");
    for frame in items(v2, "frames") {
        let name = text(frame, "name");
        let metadata = get(frame, "metadata").unwrap();
        match decode(&unhex(&text(frame, "frameHex"))) {
            Ok(Message::Operation {
                lineage,
                operation_id,
                update,
            }) => {
                assert_eq!(lineage, text(metadata, "lineage"), "{name}");
                assert_eq!(operation_id, text(metadata, "operationId"), "{name}");
                assert_eq!(update, unhex(&text(frame, "updateHex")), "{name}");
            }
            Ok(Message::Acknowledgement {
                lineage,
                operation_id,
                server_sequence,
            }) => {
                assert_eq!(lineage, text(metadata, "lineage"), "{name}");
                assert_eq!(operation_id, text(metadata, "operationId"), "{name}");
                assert_eq!(
                    server_sequence,
                    text(metadata, "serverSequence").parse::<u64>().unwrap(),
                    "{name}"
                );
            }
            Ok(Message::Rejection {
                lineage,
                operation_id,
                code,
            }) => {
                assert_eq!(lineage, text(metadata, "lineage"), "{name}");
                assert_eq!(operation_id, text(metadata, "operationId"), "{name}");
                assert_eq!(code, text(metadata, "code"), "{name}");
                assert!(is_rejection_code_pattern(&code), "{name}");
            }
            other => panic!("{name} decoded to {other:?}"),
        }
    }
}

#[test]
fn re_encodes_canonical_v2_fixtures_byte_for_byte() {
    let f = fixture("sync-frames.json");
    for frame in items(get(&f, "v2").unwrap(), "frames") {
        if get(frame, "canonical").unwrap().kind != Kind::True {
            continue;
        }
        let bytes = unhex(&text(frame, "frameHex"));
        assert_eq!(
            encode(&decode(&bytes).unwrap()).unwrap(),
            bytes,
            "{}",
            text(frame, "name")
        );
    }
}

#[test]
fn acknowledgement_keys_out_of_order_decodes_but_is_not_re_encode_asserted() {
    let frame = v2_frame("acknowledgementKeysOutOfOrder");
    assert_eq!(get(&frame, "canonical").unwrap().kind, Kind::False);
    let metadata = get(&frame, "metadata").unwrap();
    let decoded = decode(&unhex(&text(&frame, "frameHex"))).unwrap();
    assert_eq!(
        decoded,
        Message::Acknowledgement {
            lineage: text(metadata, "lineage"),
            operation_id: text(metadata, "operationId"),
            server_sequence: text(metadata, "serverSequence").parse().unwrap(),
        }
    );
    assert_eq!(
        encode(&decoded).unwrap(),
        unhex(&text(&v2_frame("acknowledgement"), "frameHex"))
    );
}

#[test]
fn rejection_accepts_a_code_outside_the_stable_six() {
    let f = fixture("sync-frames.json");
    let stable: Vec<String> = items(get(&f, "v2").unwrap(), "rejectionCodes")
        .iter()
        .map(|code| code.text().unwrap().to_string())
        .collect();
    let frame = v2_frame("rejectionUnrecognisedCode");
    let code = text(get(&frame, "metadata").unwrap(), "code");
    assert!(!stable.contains(&code));
    let Ok(Message::Rejection { code: decoded, .. }) = decode(&unhex(&text(&frame, "frameHex")))
    else {
        panic!("not a rejection");
    };
    assert_eq!(decoded, code);
}

#[test]
fn rejects_or_ignores_every_v2_negative_fixture_for_the_documented_reason() {
    let f = fixture("sync-frames.json");
    for negative in items(get(&f, "v2").unwrap(), "negative") {
        let name = text(negative, "name");
        let rule = get(negative, "rule").filter(|r| r.kind == Kind::Number);
        let result = decode(&unhex(&text(negative, "frameHex")));
        if text(negative, "expect") == "unknown" {
            assert!(matches!(result, Ok(Message::Unknown { .. })), "{name}");
            assert!(rule.is_none(), "{name}");
            continue;
        }
        assert_eq!(text(negative, "expect"), "malformed", "{name}");
        let error = result.expect_err(&name);
        assert_ne!(error.reason, "", "{name}");
        let want: u8 = rule.map_or(0, |r| {
            std::str::from_utf8(r.raw()).unwrap().parse().unwrap()
        });
        assert_eq!(error.rule, want, "{name}");
    }
}

#[test]
fn v2_frame_fixture_requires_an_explicit_canonical_value() {
    let f = fixture("sync-frames.json");
    for frame in items(get(&f, "v2").unwrap(), "frames") {
        let canonical = get(frame, "canonical");
        assert!(
            canonical.is_some_and(|c| matches!(c.kind, Kind::True | Kind::False)),
            "{} has no canonical boolean",
            text(frame, "name")
        );
    }
}

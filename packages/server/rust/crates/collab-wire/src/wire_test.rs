use blok_jsjson::{
    Kind, Node, NodeMember, Options, new_array, new_bool, new_member, new_null, new_number,
    new_object, new_string, parse_node,
};

use crate::*;

pub(crate) fn fixture(name: &str) -> Node {
    let path = format!(
        "{}/../../../../../test/unit/server-conformance/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    );
    parse_node(&std::fs::read(path).unwrap(), Options::default()).unwrap()
}

pub(crate) fn get<'a>(node: &'a Node, key: &str) -> Option<&'a Node> {
    node.members
        .iter()
        .find(|m| m.key().unwrap().to_string() == key)
        .map(|m| &m.value)
}

fn at<'a>(node: &'a Node, key: &str) -> &'a Node {
    get(node, key).unwrap_or_else(|| panic!("no {key}"))
}

pub(crate) fn text(node: &Node, key: &str) -> String {
    let value = at(node, key);
    assert_eq!(value.kind, Kind::String, "{key}");
    value.text().unwrap().to_string()
}

fn number_text(node: &Node, key: &str) -> String {
    String::from_utf8(at(node, key).raw().to_vec()).unwrap()
}

pub(crate) fn items<'a>(node: &'a Node, key: &str) -> &'a [Node] {
    &at(node, key).items
}

pub(crate) fn unhex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect()
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|c| format!("{c:02x}")).collect()
}

fn s(value: &str) -> Node {
    new_string(&value.encode_utf16().collect::<Vec<_>>())
}

fn object(members: Vec<(&str, Node)>) -> Node {
    new_object(
        members
            .into_iter()
            .map(|(k, v)| new_member(k, v))
            .collect::<Vec<NodeMember>>(),
    )
}

fn canonical(node: &Node) -> String {
    let mut out = Vec::new();
    node.append_canonical(&mut out).unwrap();
    String::from_utf8(out).unwrap()
}

fn same(name: &str, want: &Node, got: &Node) {
    assert_eq!(canonical(want), canonical(got), "{name}");
}

// Renders a message the way SyncWireDecodeFixtureTests does.
fn fields(m: &Message) -> (&'static str, Node) {
    match m {
        Message::SyncStep1 { state_vector } => (
            "SyncStep1Frame",
            object(vec![("stateVectorHex", s(&hex(state_vector)))]),
        ),
        Message::SyncStep2 { update } => (
            "SyncStep2Frame",
            object(vec![("updateHex", s(&hex(update)))]),
        ),
        Message::SyncUpdate { update } => (
            "SyncUpdateFrame",
            object(vec![("updateHex", s(&hex(update)))]),
        ),
        Message::Awareness { update } => (
            "AwarenessFrame",
            object(vec![("updateHex", s(&hex(update)))]),
        ),
        Message::QueryAwareness => ("QueryAwarenessFrame", object(vec![])),
        Message::PermissionDenied { reason } => {
            ("PermissionDeniedFrame", object(vec![("reason", s(reason))]))
        }
        Message::BlokControl { tag } => (
            "BlokControlFrame",
            object(vec![
                ("epoch", s(&tag.epoch.to_string())),
                ("format", new_number(&tag.format.to_string())),
                ("lineage", s(&tag.lineage)),
            ]),
        ),
        Message::BlokLimits { max_message_bytes } => (
            "BlokLimitsFrame",
            object(vec![("maxMessageBytes", s(&max_message_bytes.to_string()))]),
        ),
        Message::Operation {
            lineage,
            operation_id,
            update,
        } => (
            "OperationFrame",
            object(vec![
                ("lineage", s(lineage)),
                ("operationId", s(operation_id)),
                ("updateHex", s(&hex(update))),
            ]),
        ),
        Message::Acknowledgement {
            lineage,
            operation_id,
            server_sequence,
        } => (
            "AcknowledgementFrame",
            object(vec![
                ("lineage", s(lineage)),
                ("operationId", s(operation_id)),
                ("serverSequence", s(&server_sequence.to_string())),
            ]),
        ),
        Message::Rejection {
            lineage,
            operation_id,
            code,
        } => (
            "RejectionFrame",
            object(vec![
                ("lineage", s(lineage)),
                ("operationId", s(operation_id)),
                ("code", s(code)),
            ]),
        ),
        Message::Activity => ("ActivityFrame", object(vec![])),
        Message::Identities { identities } => (
            "IdentitiesFrame",
            object(vec![(
                "identities",
                new_array(
                    identities
                        .iter()
                        .map(|i| {
                            object(vec![
                                ("clientId", s(&i.client_id.to_string())),
                                ("actorId", s(&i.actor_id)),
                            ])
                        })
                        .collect(),
                ),
            )]),
        ),
        Message::Unknown { message_type } => (
            "UnknownFrame",
            object(vec![("messageType", s(&message_type.to_string()))]),
        ),
    }
}

fn encode_answer(m: &Message) -> Node {
    match encode(m) {
        Ok(frame) => s(&hex(&frame)),
        Err(_) => object(vec![("throws", s("ArgumentException"))]),
    }
}

fn decode_answer(frame: &[u8]) -> Node {
    match decode(frame) {
        Err(error) => object(vec![
            ("ok", new_bool(false)),
            ("error", s(&error.reason)),
            (
                "rule",
                if error.rule == 0 {
                    new_null()
                } else {
                    new_number(&error.rule.to_string())
                },
            ),
        ]),
        Ok(m) => {
            let (kind, f) = fields(&m);
            object(vec![
                ("ok", new_bool(true)),
                ("kind", s(kind)),
                ("fields", f),
                ("reencoded", encode_answer(&m)),
            ])
        }
    }
}

#[test]
fn decode_matches_the_c_sharp_answers() {
    let f = fixture("sync-wire-decode.json");
    let cases = items(&f, "decode");
    assert!(cases.len() >= 179, "only {} decode cases", cases.len());
    for c in cases {
        same(
            &text(c, "name"),
            at(c, "answer"),
            &decode_answer(&unhex(&text(c, "frameHex"))),
        );
    }
}

#[test]
fn awareness_walk_matches_the_c_sharp_answers() {
    let f = fixture("sync-wire-decode.json");
    for c in items(&f, "awareness") {
        let mut entries = Vec::new();
        let max: usize = number_text(c, "maxClients").parse().unwrap();
        let (count, valid) =
            validate_awareness_update(&unhex(&text(c, "payloadHex")), max, Some(&mut entries));
        let list = entries
            .iter()
            .map(|e| {
                object(vec![
                    ("clientId", s(&e.client_id.to_string())),
                    ("clock", s(&e.clock.to_string())),
                    ("removed", new_bool(e.removed)),
                ])
            })
            .collect();
        let got = object(vec![
            ("valid", new_bool(valid)),
            ("clientCount", new_number(&count.to_string())),
            ("entries", new_array(list)),
        ]);
        same(&text(c, "name"), at(c, "answer"), &got);
    }
}

#[test]
fn awareness_removal_matches_the_c_sharp_bytes() {
    let f = fixture("sync-wire-decode.json");
    for c in items(&f, "removal") {
        let entries: Vec<AwarenessEntry> = items(c, "entries")
            .iter()
            .map(|e| AwarenessEntry {
                client_id: text(e, "clientId").parse().unwrap(),
                clock: text(e, "clock").parse().unwrap(),
                removed: true,
            })
            .collect();
        assert_eq!(
            hex(&encode_awareness_removal(&entries)),
            text(c, "answer"),
            "{}",
            text(c, "name")
        );
    }
}

fn message(spec: &Node) -> Message {
    let bytes_of = |key: &str| unhex(&text(spec, key));
    match text(spec, "kind").as_str() {
        "SyncStep1Frame" => Message::SyncStep1 {
            state_vector: bytes_of("stateVectorHex"),
        },
        "SyncStep2Frame" => Message::SyncStep2 {
            update: bytes_of("updateHex"),
        },
        "SyncUpdateFrame" => Message::SyncUpdate {
            update: bytes_of("updateHex"),
        },
        "AwarenessFrame" => Message::Awareness {
            update: bytes_of("updateHex"),
        },
        "QueryAwarenessFrame" => Message::QueryAwareness,
        "ActivityFrame" => Message::Activity,
        "PermissionDeniedFrame" => Message::PermissionDenied {
            reason: text(spec, "reason"),
        },
        "BlokControlFrame" => Message::BlokControl {
            tag: Tag {
                format: number_text(spec, "format").parse::<i64>().unwrap() as i32,
                epoch: text(spec, "epoch").parse().unwrap(),
                lineage: text(spec, "lineage"),
            },
        },
        "BlokLimitsFrame" => Message::BlokLimits {
            max_message_bytes: text(spec, "maxMessageBytes").parse().unwrap(),
        },
        "OperationFrame" => Message::Operation {
            lineage: text(spec, "lineage"),
            operation_id: text(spec, "operationId"),
            update: bytes_of("updateHex"),
        },
        "AcknowledgementFrame" => Message::Acknowledgement {
            lineage: text(spec, "lineage"),
            operation_id: text(spec, "operationId"),
            server_sequence: text(spec, "serverSequence").parse().unwrap(),
        },
        "RejectionFrame" => Message::Rejection {
            lineage: text(spec, "lineage"),
            operation_id: text(spec, "operationId"),
            code: text(spec, "code"),
        },
        "IdentitiesFrame" => Message::Identities {
            identities: items(spec, "identities")
                .iter()
                .map(|e| Identity {
                    client_id: text(e, "clientId").parse().unwrap(),
                    actor_id: text(e, "actorId"),
                })
                .collect(),
        },
        other => panic!("unknown kind {other}"),
    }
}

#[test]
fn encode_matches_the_c_sharp_answers() {
    let f = fixture("sync-wire-decode.json");
    for c in items(&f, "encode") {
        same(
            &text(c, "name"),
            at(c, "answer"),
            &encode_answer(&message(at(c, "message"))),
        );
    }
}

#[test]
fn every_sync_frame_fixture_round_trips() {
    let f = fixture("sync-frames.json");
    let frames = items(&f, "frames");
    let v2 = at(&f, "v2");
    let v2_frames = items(v2, "frames");
    let negative = items(v2, "negative");
    assert!(
        frames.len() == 10 && v2_frames.len() == 12 && negative.len() >= 40,
        "fixture shrank: {} {} {}",
        frames.len(),
        v2_frames.len(),
        negative.len()
    );
    for frame in frames {
        let bytes = unhex(&text(frame, "frameHex"));
        let m = decode(&bytes).unwrap_or_else(|e| panic!("{}: {e}", text(frame, "name")));
        assert_eq!(encode(&m).unwrap(), bytes, "{}", text(frame, "name"));
    }
    for frame in v2_frames {
        let bytes = unhex(&text(frame, "frameHex"));
        let m = decode(&bytes).unwrap_or_else(|e| panic!("{}: {e}", text(frame, "name")));
        if at(frame, "canonical").kind != Kind::True {
            continue;
        }
        assert_eq!(encode(&m).unwrap(), bytes, "{}", text(frame, "name"));
    }
    for n in negative {
        let name = text(n, "name");
        let result = decode(&unhex(&text(n, "frameHex")));
        if text(n, "expect") == "unknown" {
            assert!(
                matches!(result, Ok(Message::Unknown { .. })),
                "{name}: {result:?}"
            );
            continue;
        }
        let want: u8 = match get(n, "rule") {
            Some(rule) if rule.kind == Kind::Number => number_text(n, "rule").parse().unwrap(),
            _ => 0,
        };
        assert_eq!(result.map_err(|e| e.rule), Err(want), "{name}");
    }
}

//! Ports of HostileUpdateTests, PendingRetentionTests and
//! ParkedCoverageTests: behaviour a fixture cannot spell, driven through
//! hand-built structs.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use blok_jsjson::Value;
use blok_yjs_yjstest as yjstest;

use crate::content::Content;
use crate::store::StateVector;
use crate::test_support::*;
use crate::{
    ApplyResult, ClientStructs, DEFAULT_INSPECT_DEPTH, DecodedStruct, DecodedUpdate, DeleteSet,
    Doc, Id, Options, Outcome, StructKind, Verdict, inspect,
};

pub fn apply_structs(
    doc: &Doc,
    structs: Vec<DecodedStruct>,
    deletions: Option<DeleteSet>,
) -> ApplyResult {
    let update = DecodedUpdate {
        groups: vec![ClientStructs {
            client: PEER,
            structs,
        }],
        delete_set: deletions.unwrap_or_default(),
        max_nesting_depth: 0,
    };
    doc.apply_decoded(&update)
        .unwrap_or_else(|err| panic!("{err}"))
}

pub fn decoded_item(id: Id, content: Content, info: u8) -> DecodedStruct {
    DecodedStruct {
        id,
        length: content.len(),
        kind: StructKind::Item,
        origin: None,
        right_origin: None,
        parent_root: None,
        parent_id: None,
        parent_sub: None,
        content: Some(content),
        info,
    }
}

fn run_struct(clock: u64, text: &str) -> DecodedStruct {
    let mut d = decoded_item(Id::new(PEER, clock), Content::String(s(text)), 0x04);
    d.parent_root = Some(s("t"));
    d
}

fn after_struct(clock: u64, origin: u64, text: &str) -> DecodedStruct {
    let mut d = decoded_item(Id::new(PEER, clock), Content::String(s(text)), 0x84);
    d.origin = Some(Id::new(PEER, origin));
    d
}

fn skip_struct(clock: u64, length: usize) -> DecodedStruct {
    DecodedStruct {
        id: Id::new(PEER, clock),
        length,
        kind: StructKind::Skip,
        origin: None,
        right_origin: None,
        parent_root: None,
        parent_id: None,
        parent_sub: None,
        content: None,
        info: 10,
    }
}

#[test]
fn an_unreachable_same_client_dependency_parks_instead_of_throwing() {
    for (what, update) in [
        ("a parent that is the item itself", "AQEBACgAAQABawF+AA=="),
        (
            "a parent at a clock this client has not reached",
            "AQEBACgAAQkBawF+AA==",
        ),
        (
            "an origin at a clock this client has not reached",
            "AQEBAIgBCQF+AA==",
        ),
        (
            "a right origin at a clock this client has not reached",
            "AQEBAEgBCQF+AA==",
        ),
    ] {
        let bytes = b64(update);
        assert_eq!(
            inspect(&bytes, DEFAULT_INSPECT_DEPTH).verdict,
            Verdict::Ok,
            "{what}"
        );
        let result = apply_bytes(&pinned_doc(), &bytes);
        assert!(
            result.outcome == Outcome::Applied && result.pending_remains,
            "{what}: {result:?}"
        );
    }
}

#[test]
fn a_map_key_with_no_value_reads_as_undefined() {
    for (what, update) in [
        ("a formatting mark", "AQHoBwAmAQFtAWsEYm9sZAR0cnVlAA=="),
        ("an empty string", "AQHoBwAkAQFtAWsAAA=="),
        ("an empty value run", "AQHoBwAoAQFtAWsAAA=="),
        ("an empty JSON run", "AQHoBwAiAQFtAWsAAA=="),
    ] {
        let doc = pinned_doc();
        assert_eq!(
            apply_bytes(&doc, &b64(update)).outcome,
            Outcome::Applied,
            "{what}"
        );
        let value = doc.get_map("m").unwrap().get("k");
        assert_eq!(value, Some(crate::Out::Any(Value::Undefined)), "{what}");
        // An empty run put {1000: 0} in the state vector; the sync answer
        // must still encode.
        assert!(
            !must_encode(&doc, &[]).is_empty(),
            "{what}: empty full state"
        );
    }
}

// Twin of C# HostileUpdateTests.TheFuzzCrashInputEncodes: the input that
// found the length-0 crash. Its full bytes hit the open parentSub-bit
// difference with yjs, so only the vector and a clean encode are pinned.
#[test]
fn the_fuzz_crash_input_encodes() {
    let update = blok_collab_hex("0102e80700220101300130002100e8303001303000");
    let doc = doc_with_id(4242);
    assert_eq!(apply_bytes(&doc, &update).outcome, Outcome::Applied);
    must_encode(&doc, &[]);
    assert_eq!(b64_encode(&doc.encode_state_vector()), "AegHAA==");
}

fn blok_collab_hex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect()
}

// Shared oracle with C# HostileUpdateTests.ALengthZeroStructEncodesAsYjsDoes:
// yjs accepts a length-0 struct and still encodes the document.
#[test]
fn a_length_zero_struct_encodes_as_yjs_does() {
    let cases = fixture_cases("empty-structs.json");
    assert!(!cases.is_empty(), "empty-structs.json has no cases");
    for c in cases {
        let name = yjstest::string(&c, "name");
        let doc = doc_with_id(4242);
        for update in yjstest::items(&c, "updates") {
            let Value::String(text) = update else {
                panic!("an update")
            };
            apply_bytes(&doc, &b64(&text.to_string()));
        }
        assert_eq!(
            b64_encode(&doc.encode_state_vector()),
            yjstest::string(&c, "sv"),
            "{name}: sv"
        );
        assert_eq!(
            b64_encode(&must_encode(&doc, &[])),
            yjstest::string(&c, "full"),
            "{name}: full"
        );
        let behind = fixture_bytes(&c, "behind");
        assert_eq!(
            b64_encode(&must_encode(&doc, &behind)),
            yjstest::string(&c, "diff"),
            "{name}: diff"
        );
    }
}

#[test]
fn a_partly_impossible_update_still_emits_what_it_integrated() {
    let doc = pinned_doc();
    let emitted: Arc<Mutex<Vec<Vec<u8>>>> = Arc::default();
    let sink = emitted.clone();
    let _subscription = doc.on_update(move |event| sink.lock().unwrap().push(event.update.clone()));
    let result = apply_bytes(&doc, &b64("AgECACgBAW0EZ29vZAF4AQEAKAABAANiYWQBfgA="));
    assert!(
        result.outcome == Outcome::Applied && emitted.lock().unwrap().len() == 1,
        "{result:?}"
    );
    assert_eq!(
        doc.get_map("m").unwrap().get("good"),
        Some(crate::Out::Any(Value::Bool(true)))
    );
    assert!(doc.has_pending(), "nothing parked");
}

#[test]
fn a_parked_skip_does_not_swallow_content_that_arrives_later() {
    let doc = pinned_doc();
    apply_structs(
        &doc,
        vec![
            run_struct(0, "aaaaa"),
            skip_struct(5, 10),
            after_struct(15, 14, "ccc"),
            skip_struct(18, 7),
            after_struct(25, 24, "eeeee"),
        ],
        None,
    );
    assert!(
        !doc.lock().store.pending_structs.iter().any(|p| p.is_skip()),
        "a Skip was parked"
    );
    apply_structs(&doc, vec![after_struct(19, 18, "bbbbbb")], None);
    let found = doc.lock().store.pending_structs.iter().any(|p| {
        let h = p.header();
        h.id.clock == 19 && h.length == 6
    });
    assert!(found, "the content for the second hole was dropped");
}

#[test]
fn a_gap_wider_than_an_int_is_written_as_several_skips() {
    let doc = pinned_doc();
    apply_structs(&doc, vec![run_struct(0, "a")], None);
    apply_structs(&doc, vec![run_struct(4294967295, "b")], None);
    let decoded = must_decode(&encode_state(&doc, &[]));
    let (mut skips, mut total) = (0u64, 0u64);
    for group in decoded.groups.iter().filter(|g| g.client == PEER) {
        for d in group.structs.iter().filter(|d| d.kind == StructKind::Skip) {
            skips += 1;
            total += d.length as u64;
        }
    }
    assert_eq!((skips, total), (2, 4294967294));
}

#[test]
fn a_diff_starting_inside_an_astral_character_still_encodes() {
    let doc = pinned_doc();
    let text = doc.get_text("t").unwrap();
    doc.transact(|txn| text.insert(Some(txn), 0, "😀", None))
        .unwrap();
    let mut target = StateVector::new();
    target.set(PINNED_CLIENT, 1);
    let diff = encode_state(&doc, &target.encode());
    assert_eq!(must_decode(&diff).groups.len(), 1);
}

/// The parked measure recomputed on its own, as C# ParkedCoverageTests
/// does: the union of parked struct clocks plus the union of parked delete
/// clocks.
fn parked_union(doc: &Doc) -> u64 {
    let st = doc.lock();
    let mut spans: HashMap<u64, Vec<(u64, u64)>> = HashMap::new();
    for waiting in &st.store.pending_structs {
        let h = waiting.header();
        spans
            .entry(h.id.client)
            .or_default()
            .push((h.id.clock, h.end()));
    }
    let mut deletions: HashMap<u64, Vec<(u64, u64)>> = HashMap::new();
    if let Some(pending) = &st.store.pending_ds {
        for client in pending.clients() {
            for r in pending.ranges(client) {
                deletions
                    .entry(client)
                    .or_default()
                    .push((r.clock, r.clock + r.length));
            }
        }
    }
    union(spans) + union(deletions)
}

fn union(per_client: HashMap<u64, Vec<(u64, u64)>>) -> u64 {
    let mut total = 0;
    for (_, mut spans) in per_client {
        spans.sort();
        let mut covered_to = 0;
        for (start, end) in spans {
            let start = start.max(covered_to);
            if end > start {
                total += end - start;
                covered_to = end;
            }
        }
    }
    total
}

fn raw_parked_length(doc: &Doc) -> u64 {
    doc.lock()
        .store
        .pending_structs
        .iter()
        .map(|w| w.header().length as u64)
        .sum()
}

#[test]
fn an_arrival_that_widens_overlapping_parked_runs_is_a_change() {
    let doc = pinned_doc();
    apply_structs(
        &doc,
        vec![run_struct(5, "aaaaa"), run_struct(6, "bbb")],
        None,
    );
    assert_eq!(
        (raw_parked_length(&doc), parked_union(&doc)),
        (8, 5),
        "premise"
    );
    assert_eq!(doc.lock().parked_coverage(), 5);
    let arrival = apply_structs(&doc, vec![run_struct(10, "ccc")], None);
    assert_eq!((raw_parked_length(&doc), parked_union(&doc)), (8, 8));
    assert!(
        arrival.changed,
        "three newly parked clocks were reported as no change"
    );
}

#[test]
fn a_parked_deletion_of_already_parked_clocks_is_a_change() {
    let doc = pinned_doc();
    apply_structs(&doc, vec![run_struct(1, "aaaa")], None);
    assert_eq!(parked_union(&doc), 4);
    let mut deletions = DeleteSet::new();
    deletions.add(PEER, 1, 4);
    let arrival = apply_structs(&doc, Vec::new(), Some(deletions));
    assert!(parked_union(&doc) == 8 && arrival.changed, "{arrival:?}");
    assert_eq!(doc.lock().parked_coverage(), 8);
}

#[test]
fn no_apply_that_grows_parked_content_reports_no_change() {
    let stray = Doc::new(Options {
        client_id: Some(PEER as u32),
        no_gc: false,
    });
    let text = stray.get_text("content").unwrap();
    let insert = |chunk: &str| {
        stray
            .transact(|txn| text.insert(Some(txn), text.units().len() as i64, chunk, None))
            .unwrap();
    };
    insert("a");
    insert("bcdefgh");
    stray.transact(|txn| text.delete(Some(txn), 3, 2)).unwrap();
    insert("ijkl");
    insert("mnop");
    let cuts = [1u64, 2, 3, 4, 5, 6, 8, 9, 10];
    let mut updates = HashMap::new();
    for cut in cuts {
        let mut vector = StateVector::new();
        vector.set(PEER, cut);
        updates.insert(cut, encode_state(&stray, &vector.encode()));
    }
    let mut swept = 0;
    for first in cuts {
        for second in cuts {
            for third in cuts {
                let doc = pinned_doc();
                apply_bytes(&doc, &updates[&first]);
                apply_bytes(&doc, &updates[&second]);
                let before = parked_union(&doc);
                let result = apply_bytes(&doc, &updates[&third]);
                swept += 1;
                assert!(
                    parked_union(&doc) <= before || result.changed,
                    "{first},{second} -> {third} parked more and reported no change"
                );
            }
        }
    }
    assert_eq!(swept, 729);
}

// Twin of C# PendingRetentionTests.EqualClockParkedStructsKeepTheirParkedOrder.
// 16 one-char items of client 7 park at clocks 10..25, then a 5-char item
// parks at clock 13. With 17 structs an unstable sort reorders the two at
// clock 13, and the covered filter then keeps different structs.
#[test]
fn equal_clock_parked_structs_keep_their_parked_order() {
    const ITEMS: &str = "ARAHCgQBAXQBYQQBAXQBYgQBAXQBYwQBAXQBZAQBAXQBZQQBAXQBZgQBAXQBZwQBAXQBaAQBAXQBaQQBAXQBagQBAXQBawQBAXQBbAQBAXQBbQQBAXQBbgQBAXQBbwQBAXQBcAA=";
    const GAP_FILL: &str =
        "AQoHAAQBAXQBMAQBAXQBMAQBAXQBMAQBAXQBMAQBAXQBMAQBAXQBMAQBAXQBMAQBAXQBMAQBAXQBMAQBAXQBMAA=";
    let cases = [
        (
            "conflicting content",
            "AQEHDQQBAXQFQUJDREUA",
            "AQ0HCgQBAXQBYQQBAXQBYgQBAXQBYwQBAXQBZIQHDQRCQ0RFBAEBdAFpBAEBdAFqBAEBdAFrBAEBdAFsBAEBdAFtBAEBdAFuBAEBdAFvBAEBdAFwAA==",
            "ponmlkjidBCDEcba0000000000",
        ),
        (
            "same content",
            "AQEHDQQBAXQFZGVmZ2gA",
            "AQ0HCgQBAXQBYQQBAXQBYgQBAXQBYwQBAXQBZIQHDQRlZmdoBAEBdAFpBAEBdAFqBAEBdAFrBAEBdAFsBAEBdAFtBAEBdAFuBAEBdAFvBAEBdAFwAA==",
            "ponmlkjidefghcba0000000000",
        ),
    ];
    for (name, run, pending, text) in cases {
        let doc = pinned_doc();
        doc.get_text("t").unwrap();
        apply_bytes(&doc, &b64(ITEMS));
        apply_bytes(&doc, &b64(run));
        assert_eq!(
            b64_encode(&encode_state(&doc, &[])),
            pending,
            "{name}: pending state"
        );
        apply_bytes(&doc, &b64(GAP_FILL));
        assert_eq!(doc.get_text("t").unwrap().to_string(), text, "{name}: text");
    }
}

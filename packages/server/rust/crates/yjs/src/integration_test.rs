//! Ports of the IntegrationTests that are not scenario replays.

use std::sync::{Arc, Mutex};

use blok_yjs_yjstest as yjstest;

use crate::content::Content;
use crate::deleteset::DeleteRange;
use crate::item::Struct;
use crate::scenario_test::{ScenarioRunner, render, roots_of, scenario_named, step_update};
use crate::test_support::*;
use crate::{ApplyResult, Doc, Options, Outcome};

#[test]
fn duplicate_delivery_of_one_decoded_update_is_idempotent() {
    let c = scenario_named("duplicate-delivery");
    let doc = doc_with_id(4242);
    let decoded = must_decode(&step_update(&c, "s1"));
    assert_eq!(
        doc.apply_decoded(&decoded).unwrap().outcome,
        Outcome::Applied
    );
    let (once, vector) = (
        canonical(&render(&doc, &c.roots)),
        doc.encode_state_vector(),
    );
    let second = doc.apply_decoded(&decoded).unwrap();
    assert!(
        second.outcome == Outcome::Applied && !second.changed,
        "second apply: {second:?}"
    );
    assert_eq!(canonical(&render(&doc, &c.roots)), once);
    assert_eq!(doc.encode_state_vector(), vector);
    assert!(!doc.has_pending(), "the second apply changed the document");
}

#[test]
fn deleting_a_block_cascades_into_nested_types_and_matches_yjs_delete_set() {
    let mut runner = ScenarioRunner::new(scenario_named("cascade-delete-grid"));
    let seen: Arc<Mutex<Vec<crate::DeleteSet>>> = Arc::default();
    let sink = seen.clone();
    runner.doc.set_encoder(Some(Box::new(move |txn| {
        sink.lock().unwrap().push(txn.delete_set.clone());
        None
    })));
    for mut step in runner.c.steps.clone() {
        // The hook swallows the engine's bytes, so only deliveries run.
        if step.kind != "engineWrites" {
            step.expect = None;
            runner.run(&step);
        }
    }
    let seen = seen.lock().unwrap();
    let last = seen.last().unwrap();
    assert_eq!(last.clients(), vec![1000]);
    assert_eq!(last.ranges(1000), &[DeleteRange::new(0, 11)]);
    let st = runner.doc.lock();
    for &s in &st.store.clients[&1000] {
        assert!(st.store.is_deleted(s), "a struct survived the cascade");
    }
}

#[test]
fn content_gc_replaces_deleted_content_and_subtrees() {
    let mut collected = ScenarioRunner::new(scenario_named("cascade-delete-grid"));
    collected.run_all();
    let st = collected.doc.lock();
    let structs = &st.store.clients[&1000];
    let Struct::Item(head) = structs[0] else {
        panic!("the head is a GC")
    };
    assert!(
        matches!(st.store.items[head].content, Content::Deleted(_)),
        "the head kept its content"
    );
    let mut total = 0;
    for (i, &s) in structs.iter().enumerate() {
        total += st.store.head(s).length;
        assert!(i == 0 || matches!(s, Struct::Gc(_)), "struct {i} is {s:?}");
    }
    let mut kept = ScenarioRunner::new(scenario_named("cascade-delete-grid-no-gc"));
    kept.run_all();
    let kst = kept.doc.lock();
    let mut kept_total = 0;
    for &s in &kst.store.clients[&1000] {
        kept_total += kst.store.head(s).length;
        let Struct::Item(at) = s else {
            panic!("a struct was collected with gc off")
        };
        assert!(
            kst.store.items[at].deleted,
            "a struct was collected with gc off"
        );
    }
    assert_eq!(kept_total, total);
    let Struct::Item(head) = kst.store.clients[&1000][0] else {
        panic!("a GC head")
    };
    assert!(
        matches!(kst.store.items[head].content, Content::Type(_)),
        "the head lost its type with gc off"
    );
}

#[test]
fn every_structs_golden_applies_to_its_json() {
    let mut failures = Vec::new();
    for c in fixture_cases("structs.json") {
        let name = yjstest::string(&c, "name");
        let doc = Doc::new(Options {
            client_id: Some(7),
            no_gc: !yjstest::bool(&c, "gc"),
        });
        if apply_bytes(&doc, &fixture_bytes(&c, "update")).outcome != Outcome::Applied {
            failures.push(format!("{name}: not applied"));
            continue;
        }
        if doc.has_pending() != yjstest::bool(&c, "hasPending") {
            failures.push(format!("{name}: hasPending {}", doc.has_pending()));
        }
        let got = canonical(&render(
            &doc,
            &roots_of(yjstest::field(&c, "roots").unwrap()),
        ));
        let want = canonical(yjstest::field(&c, "json").unwrap());
        if got != want {
            failures.push(format!("{name}:\n got {got}\nwant {want}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn replays_every_yrs_encoded_fixture() {
    let roots = vec![("blocks".to_string(), "map".to_string())];
    let mut failures = Vec::new();
    for c in fixture_cases("yrs-compat.json") {
        let name = yjstest::string(&c, "name");
        let update = fixture_bytes(&c, "update");
        let doc = doc_with_id(7);
        if apply_bytes(&doc, &update).outcome != Outcome::Applied || doc.has_pending() {
            failures.push(format!("{name}: not applied cleanly"));
            continue;
        }
        let (rendered, vector) = (canonical(&render(&doc, &roots)), doc.encode_state_vector());
        apply_bytes(&doc, &update);
        if doc.encode_state_vector() != vector || canonical(&render(&doc, &roots)) != rendered {
            failures.push(format!("{name}: a second apply changed the document"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn remote_advance_of_the_local_clock_regenerates_the_client_id() {
    let update = step_update(&scenario_named("concurrent-map-set-two-clients"), "s1");
    let impostor = doc_with_id(1000);
    apply_bytes(&impostor, &update);
    assert_ne!(
        impostor.client_id(),
        1000,
        "kept a client id another writer uses"
    );
    let bystander = doc_with_id(4242);
    apply_bytes(&bystander, &update);
    assert_eq!(bystander.client_id(), 4242, "re-minted without cause");
}

#[test]
fn malformed_bytes_report_malformed_and_leave_the_doc_untouched() {
    let c = scenario_named("concurrent-map-set-two-clients");
    let doc = doc_with_id(4242);
    apply_bytes(&doc, &step_update(&c, "s1"));
    let (vector, rendered) = (
        doc.encode_state_vector(),
        canonical(&render(&doc, &c.roots)),
    );
    let result = apply_bytes(&doc, &[1, 1, 0xe8, 0x07]);
    assert!(
        result.outcome == Outcome::Malformed && !result.reason.is_empty() && !result.changed,
        "{result:?}"
    );
    assert_eq!(doc.encode_state_vector(), vector);
    assert_eq!(
        canonical(&render(&doc, &c.roots)),
        rendered,
        "a refused update changed the document"
    );
}

#[test]
fn empty_v1_update_applies_and_changes_nothing() {
    let result = apply_bytes(&pinned_doc(), &[0, 0]);
    assert!(
        result.outcome == Outcome::Applied && !result.changed && !result.pending_remains,
        "{result:?}"
    );
}

#[test]
fn adopt_client_id_writes_under_the_adopted_id() {
    let author = doc_with_id(1000);
    let blocks = author.get_map("blocks").unwrap();
    author
        .transact(|txn| blocks.set(txn, "a", num(1.0)))
        .unwrap();
    let state = encode_state(&author, &[]);
    let restored = doc_with_id(5);
    apply_bytes(&restored, &state);
    // The load advanced 1000, not 5, so 5 is kept; adopting 1000 continues
    // its clock line instead of opening a new one.
    restored.adopt_client_id(1000);
    let blocks = restored.get_map("blocks").unwrap();
    let update = restored
        .transact(|txn| blocks.set(txn, "b", num(2.0)))
        .unwrap()
        .unwrap();
    let group = &must_decode(&update).groups[0];
    assert_eq!((group.client, group.structs[0].id.clock), (1000, 1));
}

#[test]
fn a_remote_apply_inside_a_local_transaction_makes_it_remote() {
    let peer = doc_with_id(1001);
    let pm = peer.get_map("m").unwrap();
    peer.transact(|txn| pm.set(txn, "k", num(1.0))).unwrap();
    let update = encode_state(&peer, &[]);
    let doc = pinned_doc();
    let events: Arc<Mutex<Vec<crate::UpdateEvent>>> = Arc::default();
    let sink = events.clone();
    let _subscription = doc.on_update(move |event| sink.lock().unwrap().push(event.clone()));
    let mut nested: Option<ApplyResult> = None;
    let m = doc.get_map("m").unwrap();
    let emitted = doc
        .transact(|txn| {
            m.set(txn, "own", num(2.0))?;
            nested = Some(apply_bytes(&doc, &update));
            Ok(())
        })
        .unwrap();
    // The nested apply joins the open transaction, reports no move of its
    // own, and turns the whole transaction remote. A remote transaction
    // that advanced our own clock re-mints the id, so the local write does
    // too.
    let events = events.lock().unwrap();
    assert!(!nested.unwrap().changed && events.len() == 1 && !events[0].local && emitted.is_some());
    assert_ne!(doc.client_id(), PINNED_CLIENT, "kept the client id");
}

#[test]
fn same_client_gap_parks_the_tail() {
    let c = scenario_named("out-of-order-delivery");
    let doc = Doc::new(Options {
        client_id: Some(c.client_id),
        no_gc: !c.gc,
    });
    // Only the third op of a three-op run: nothing can be placed, and the
    // gap is recorded as "waiting for the clock before this one".
    doc.apply_update(&step_update(&c, "s3")).unwrap();
    let st = doc.lock();
    assert!(st.has_pending() && st.store.clients.is_empty() && st.store.pending_structs.len() == 1);
    assert_eq!(
        st.store.pending_structs[0].header().id,
        crate::Id::new(PINNED_CLIENT, 2)
    );
    assert_eq!(
        st.store
            .pending_missing
            .as_ref()
            .map(|m| m.get(PINNED_CLIENT)),
        Some(1)
    );
}

#[test]
fn pending_retries_when_the_dependency_arrives() {
    let c = scenario_named("out-of-order-delivery");
    let doc = Doc::new(Options {
        client_id: Some(c.client_id),
        no_gc: !c.gc,
    });
    for id in ["s3", "s1"] {
        doc.apply_update(&step_update(&c, id)).unwrap();
    }
    // Clock 1 is still missing, so the parked clock 2 stays parked.
    assert!(doc.has_pending() && doc.lock().store.get_state(PINNED_CLIENT) == 1);
    doc.apply_update(&step_update(&c, "s2")).unwrap();
    // The retry ran inside the same transaction: all three clocks are in.
    let st = doc.lock();
    assert!(!st.has_pending() && st.store.get_state(PINNED_CLIENT) == 3);
    assert!(st.store.pending_structs.is_empty() && st.store.pending_missing.is_none());
}

use std::collections::HashSet;

use blok_lib0::{Reader, Writer};
use blok_yjs_yjstest as yjstest;

use crate::deleteset::{DeleteRange, DeleteSet, read_delete_set};
use crate::doc::{DocState, TxnState};
use crate::item::{Parent, Struct};
use crate::store::StateVector;
use crate::test_support::*;
use crate::{
    Array, DEFAULT_INSPECT_DEPTH, Doc, Map, Options, Verdict, decode_state_vector, inspect,
};

const AUTHOR: u64 = 9;

#[derive(Debug, PartialEq)]
pub struct Shape(pub u64, pub usize, pub bool);

pub fn shape_of(st: &DocState, client: u64) -> Vec<Shape> {
    st.store.clients[&client]
        .iter()
        .map(|&s| {
            let h = st.store.head(s);
            Shape(h.id.clock, h.length, st.store.is_deleted(s))
        })
        .collect()
}

fn author_run(st: &mut DocState, parent: &Array, values: Vec<blok_jsjson::Value>) -> usize {
    let tid = parent.as_type().attached_id().unwrap();
    let length = values.len();
    let mut item = any_item(AUTHOR, 0, values);
    item.parent = Parent::Type(tid);
    let id = add_item(&mut st.store, item);
    st.store.types[tid].start = Some(id);
    st.store.types[tid].length = length as i64;
    id
}

fn remote_transaction(st: &mut DocState) {
    st.current = Some(TxnState {
        local: false,
        before_state: st.store.get_state_vector(),
        after_state: None,
        delete_set: DeleteSet::new(),
    });
}

fn letters(values: &[&str]) -> Vec<blok_jsjson::Value> {
    values.iter().map(|v| sv(v)).collect()
}

#[test]
fn delete_range_splits_both_edges_and_parks_the_unappliable_tail() {
    let doc = doc_with_id(1);
    let parent = doc.get_array("list").unwrap();
    let mut st = doc.lock();
    let run = author_run(&mut st, &parent, letters(&["a", "b", "c", "d", "e"]));
    remote_transaction(&mut st);
    let mut inside = DeleteSet::new();
    inside.add(AUTHOR, 1, 2);
    assert!(
        st.apply_delete_set(&inside).unwrap().is_none(),
        "parked a range the store holds"
    );
    assert_eq!(
        shape_of(&st, AUTHOR),
        vec![Shape(0, 1, false), Shape(1, 2, true), Shape(3, 2, false)]
    );
    let structs = st.store.clients[&AUTHOR].clone();
    let ids: Vec<usize> = structs
        .iter()
        .map(|s| match s {
            Struct::Item(id) => *id,
            Struct::Gc(_) => panic!("a GC"),
        })
        .collect();
    assert_eq!(ids[0], run);
    assert_eq!(st.store.items[run].right, Some(ids[1]));
    assert_eq!(st.store.items[ids[1]].right, Some(ids[2]));
    let tid = parent.as_type().attached_id().unwrap();
    assert_eq!(st.list_values(tid).len(), 3);
    let mut past = DeleteSet::new();
    past.add(AUTHOR, 3, 5);
    let parked = st.apply_delete_set(&past).unwrap().expect("parked");
    assert_eq!(
        shape_of(&st, AUTHOR),
        vec![Shape(0, 1, false), Shape(1, 2, true), Shape(3, 2, true)]
    );
    assert_eq!(parked.clients(), vec![AUTHOR]);
    assert_eq!(parked.ranges(AUTHOR), &[DeleteRange::new(5, 3)]);
    assert_eq!(st.list_values(tid).len(), 1);
}

#[test]
fn a_whole_range_past_the_state_is_parked() {
    let doc = doc_with_id(1);
    let parent = doc.get_array("list").unwrap();
    let mut st = doc.lock();
    author_run(&mut st, &parent, letters(&["a", "b"]));
    remote_transaction(&mut st);
    let mut unknown = DeleteSet::new();
    unknown.add(AUTHOR, 2, 4);
    unknown.add(AUTHOR + 1, 0, 1);
    let parked = st.apply_delete_set(&unknown).unwrap().expect("parked");
    assert_eq!(parked.len(), 2);
    assert_eq!(parked.ranges(AUTHOR), &[DeleteRange::new(2, 4)]);
    assert_eq!(shape_of(&st, AUTHOR), vec![Shape(0, 2, false)]);
    assert!(
        st.current.as_ref().unwrap().delete_set.is_empty(),
        "something was deleted"
    );
}

#[test]
fn add_then_sort_and_merge_folds_touching_ranges() {
    let mut set = DeleteSet::new();
    set.add(AUTHOR, 6, 2);
    set.add(AUTHOR, 0, 2);
    set.add(AUTHOR, 2, 1);
    set.add(AUTHOR, 1, 4);
    set.add(AUTHOR + 1, 3, 1);
    set.sort_and_merge();
    assert_eq!(
        set.ranges(AUTHOR),
        &[DeleteRange::new(0, 5), DeleteRange::new(6, 2)]
    );
    assert_eq!(set.ranges(AUTHOR + 1), &[DeleteRange::new(3, 1)]);
}

/// Writes clients in the order given.
fn delete_set_bytes(clients: &[(u64, &[(u64, u64)])]) -> Vec<u8> {
    let mut w = Writer::new();
    w.write_var_uint(clients.len() as u64);
    for (client, ranges) in clients {
        w.write_var_uint(*client);
        w.write_var_uint(ranges.len() as u64);
        for r in *ranges {
            w.write_var_uint(r.0);
            w.write_var_uint(r.1);
        }
    }
    w.into_bytes()
}

#[test]
fn delete_set_sorts_merges_and_writes_clients_descending() {
    let bytes = delete_set_bytes(&[
        (7, &[(10, 2), (0, 3), (3, 1), (20, 1)]),
        (9, &[(0, 5), (2, 1)]),
    ]);
    let mut set = read_delete_set(&mut Reader::new(&bytes)).unwrap();
    set.sort_and_merge();
    assert_eq!(
        set.ranges(7),
        &[
            DeleteRange::new(0, 4),
            DeleteRange::new(10, 2),
            DeleteRange::new(20, 1)
        ]
    );
    assert_eq!(set.ranges(9), &[DeleteRange::new(0, 5)]);
    let mut w = Writer::new();
    set.write(&mut w);
    assert_eq!(
        w.into_bytes(),
        delete_set_bytes(&[(9, &[(0, 5)]), (7, &[(0, 4), (10, 2), (20, 1)])])
    );
    assert!(
        read_delete_set(&mut Reader::new(&delete_set_bytes(&[])))
            .unwrap()
            .is_empty(),
        "empty set is not empty"
    );
}

#[test]
fn delete_set_read_drops_empty_clients_and_appends_repeats() {
    let bytes = delete_set_bytes(&[(7, &[(0, 1)]), (8, &[]), (7, &[(5, 1)])]);
    let set = read_delete_set(&mut Reader::new(&bytes)).unwrap();
    assert_eq!(set.clients(), vec![7]);
    assert_eq!(
        set.ranges(7),
        &[DeleteRange::new(0, 1), DeleteRange::new(5, 1)]
    );
}

pub fn scenario_state_vectors(minimum_clients: u64) -> Vec<Vec<u8>> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for c in fixture_cases("scenarios.json") {
        for step in yjstest::items(&c, "steps") {
            let Some(expect) = yjstest::field(step, "expect") else {
                continue;
            };
            let text = yjstest::string(expect, "sv");
            if !yjstest::has(expect, "sv") || !seen.insert(text) {
                continue;
            }
            let sv = fixture_bytes(expect, "sv");
            if Reader::new(&sv).read_var_uint().unwrap() >= minimum_clients {
                out.push(sv);
            }
        }
    }
    assert!(!out.is_empty(), "no state vectors");
    out
}

#[test]
fn state_vector_encodes_clients_descending() {
    for golden in scenario_state_vectors(2) {
        let decoded = decode_state_vector(&golden).unwrap();
        let mut ascending = decoded.clients();
        ascending.sort();
        let mut rebuilt = StateVector::new();
        for client in ascending {
            rebuilt.set(client, decoded.get(client));
        }
        assert_eq!(rebuilt.encode(), golden);
    }
}

#[test]
fn state_vector_decode_round_trips() {
    for golden in scenario_state_vectors(1) {
        let decoded = decode_state_vector(&golden).unwrap();
        assert_eq!(decoded.encode(), golden);
        assert_eq!(decoded.get(u64::MAX), 0);
    }
}

#[test]
fn state_vector_edges() {
    assert_eq!(
        StateVector::new().encode(),
        vec![0],
        "empty vector is not 00"
    );
    let mut vector = StateVector::new();
    vector.set(7, 3);
    vector.set(7, 9);
    assert!(
        vector.get(7) == 9 && vector.len() == 1,
        "set does not overwrite"
    );
    assert!(decode_state_vector(&[0, 0]).is_err(), "trailing bytes");
    assert!(
        decode_state_vector(&[2, 7, 1, 7, 2]).is_err(),
        "a client listed twice"
    );
}

const DEEP_LEVELS: usize = 10_000;

fn nest(doc: &Doc, root: &Map, levels: usize) -> Vec<Vec<u8>> {
    let mut updates = Vec::new();
    let mut cursor = root.clone();
    for _ in 0..levels {
        let child = Map::new(Vec::new());
        let owner = cursor.clone();
        if let Some(update) = doc.transact(|txn| owner.set(txn, "c", &child)).unwrap() {
            updates.push(update);
        }
        cursor = child;
    }
    updates
}

#[test]
fn deleting_a_deeply_nested_chain_does_not_recurse_per_level() {
    let doc = pinned_doc();
    let blocks = doc.get_map("blocks").unwrap();
    nest(&doc, &blocks, DEEP_LEVELS);
    doc.transact(|txn| blocks.delete(txn, "c")).unwrap();
    assert!(
        blocks.get("c").is_none() && blocks.is_empty() && !doc.has_pending(),
        "the chain survived"
    );
}

#[test]
fn collecting_a_deeply_nested_chain_does_not_recurse_per_level() {
    let doc = pinned_doc();
    let blocks = doc.get_map("blocks").unwrap();
    nest(&doc, &blocks, DEEP_LEVELS);
    doc.transact(|txn| blocks.clear(txn)).unwrap();
    assert!(blocks.is_empty(), "the chain survived");
}

#[test]
fn a_chain_built_one_level_per_update_is_accepted_and_then_deletable() {
    let author = pinned_doc();
    let updates = nest(&author, &author.get_map("blocks").unwrap(), DEEP_LEVELS);
    let peer = Doc::new(Options {
        client_id: Some(1001),
        no_gc: false,
    });
    for update in &updates {
        assert_eq!(
            inspect(update, DEFAULT_INSPECT_DEPTH).verdict,
            Verdict::Ok,
            "an update was refused"
        );
        assert_eq!(
            apply_bytes(&peer, update).outcome,
            crate::Outcome::Applied,
            "an update did not apply"
        );
    }
    let blocks = peer.get_map("blocks").unwrap();
    peer.transact(|txn| blocks.delete(txn, "c")).unwrap();
    assert!(blocks.is_empty(), "the chain survived");
}

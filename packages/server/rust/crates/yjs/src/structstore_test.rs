use blok_lib0::{Reader, Writer};

use crate::content::{Content, FormatContent};
use crate::decode::read_content_type;
use crate::item::{ItemId, Parent, Struct};
use crate::store::{StateVector, Store};
use crate::test_support::*;
use crate::types::{MAX_TYPE_REF, Map, TypeCore, TypeKind, TypeRef};
use crate::{Error, Header, Id, Out};

fn sa(values: &[&str]) -> Vec<blok_jsjson::Value> {
    values.iter().map(|v| sv(v)).collect()
}

#[test]
fn add_struct_rejects_a_gap_and_never_leaves_an_empty_run() {
    let mut store = Store::new();
    add_item(&mut store, any_item(STORE_CLIENT, 0, sa(&["a", "b"])));
    let gap = store.alloc(any_item(STORE_CLIENT, 3, sa(&["c"])));
    assert!(store.add_struct(Struct::Item(gap)).is_err(), "a clock gap");
    // A first struct may start at any clock.
    add_item(&mut store, any_item(STORE_CLIENT + 1, 5, sa(&["c"])));
    assert_eq!(store.clients[&STORE_CLIENT].len(), 1);
    assert_eq!(store.clients[&(STORE_CLIENT + 1)].len(), 1);
    assert_eq!(store.get_state(STORE_CLIENT + 2), 0);
}

#[test]
fn find_locates_a_struct_by_any_clock_inside_it() {
    let mut store = Store::new();
    let first = add_item(&mut store, any_item(STORE_CLIENT, 0, sa(&["a", "b", "c"])));
    let second = Struct::Gc(Header {
        id: Id::new(STORE_CLIENT, 3),
        length: 1,
    });
    store.add_struct(second).unwrap();
    let third = add_item(
        &mut store,
        any_item(STORE_CLIENT, 4, sa(&["d", "e", "f", "g", "h"])),
    );
    for (clock, want) in [
        (0, Struct::Item(first)),
        (2, Struct::Item(first)),
        (3, second),
        (4, Struct::Item(third)),
        (8, Struct::Item(third)),
    ] {
        assert_eq!(
            store.find(Id::new(STORE_CLIENT, clock)).unwrap(),
            want,
            "clock {clock}"
        );
    }
    assert!(
        store.find(Id::new(STORE_CLIENT, 9)).is_err(),
        "a clock past the run"
    );
    assert!(
        store.find(Id::new(STORE_CLIENT + 1, 0)).is_err(),
        "an unknown client"
    );
}

#[test]
fn clean_start_splits_an_item_and_keeps_last_id_arithmetic() {
    let mut store = Store::new();
    let left = add_item(
        &mut store,
        any_item(STORE_CLIENT, 0, sa(&["a", "b", "c", "d"])),
    );
    let last_id = store.items[left].last_id();
    let right = store
        .get_item_clean_start(Id::new(STORE_CLIENT, 3))
        .unwrap();
    let l = &store.items[left];
    assert!(
        right != left
            && l.last_id() == Id::new(STORE_CLIENT, 2)
            && l.length == 3
            && l.content.len() == 3
    );
    let r = &store.items[right];
    assert_eq!(r.id, Id::new(STORE_CLIENT, 3));
    assert_eq!(r.origin, Some(l.last_id()));
    assert_eq!(r.last_id(), last_id);
    assert!(l.right == Some(right) && r.left == Some(left));
    assert_eq!(store.get_state(STORE_CLIENT), 4);
    assert_eq!(
        store
            .get_item_clean_start(Id::new(STORE_CLIENT, 3))
            .unwrap(),
        right
    );
    assert_eq!(store.clients[&STORE_CLIENT].len(), 2);
}

#[test]
fn clean_end_never_splits_a_gc() {
    let mut store = Store::new();
    let collected = Struct::Gc(Header {
        id: Id::new(STORE_CLIENT, 0),
        length: 5,
    });
    store.add_struct(collected).unwrap();
    assert_eq!(
        store.get_item_clean_end(Id::new(STORE_CLIENT, 2)).unwrap(),
        collected
    );
    assert_eq!(store.clients[&STORE_CLIENT], vec![collected]);
    let mut items = Store::new();
    let item = add_item(
        &mut items,
        any_item(STORE_CLIENT, 0, sa(&["a", "b", "c", "d", "e"])),
    );
    assert_eq!(
        items.get_item_clean_end(Id::new(STORE_CLIENT, 2)).unwrap(),
        Struct::Item(item)
    );
    assert_eq!(items.items[item].length, 3);
    assert_eq!(items.head(items.clients[&STORE_CLIENT][1]).id.clock, 3);
}

fn map_core(store: &mut Store) -> usize {
    store.types.push(TypeCore::new(TypeKind::Map));
    store.types.len() - 1
}

#[test]
fn split_repoints_the_map_head_when_splitting_the_last_value() {
    let mut store = Store::new();
    let m = map_core(&mut store);
    let key = s("k");
    let mut head = any_item(STORE_CLIENT, 0, sa(&["a", "b"]));
    head.parent = Parent::Type(m);
    head.parent_sub = Some(key.clone());
    head.deleted = true;
    head.keep = true;
    let head = store.alloc(head);
    store.types[m].map_set_head(key.clone(), head);
    let right = store.split_at(head, 1).unwrap();
    let r = &store.items[right];
    assert!(
        store.types[m].map_get(&key) == Some(right)
            && r.parent == Parent::Type(m)
            && r.deleted
            && r.keep
    );

    let other = map_core(&mut store);
    let tail = store.alloc(any_item(STORE_CLIENT + 1, 0, sa(&["z"])));
    let mut with_tail = any_item(STORE_CLIENT, 0, sa(&["a", "b", "c"]));
    with_tail.parent = Parent::Type(other);
    with_tail.parent_sub = Some(key.clone());
    with_tail.right = Some(tail);
    let with_tail = store.alloc(with_tail);
    store.items[tail].left = Some(with_tail);
    store.types[other].map_set_head(key.clone(), with_tail);
    let middle = store.split_at(with_tail, 1).unwrap();
    assert_eq!(store.types[other].map_get(&key), Some(with_tail));
    assert_eq!(store.items[with_tail].right, Some(middle));
    assert_eq!(store.items[middle].right, Some(tail));
    assert_eq!(store.items[tail].left, Some(middle));

    let mut unresolved = any_item(STORE_CLIENT, 0, sa(&["a", "b"]));
    unresolved.parent = Parent::Root(s("root"));
    unresolved.parent_sub = Some(key);
    let unresolved = store.alloc(unresolved);
    assert!(
        store.split_at(unresolved, 1).is_err(),
        "an unresolved parent owning a map head"
    );
}

pub fn create_type(type_ref: u8, name: &blok_jsjson::Str) -> Option<TypeRef> {
    let kind = TypeKind::from_ref(type_ref)?;
    let name = matches!(kind, TypeKind::XmlElement | TypeKind::XmlHook).then(|| name.clone());
    Some(TypeRef::new_detached(kind, name))
}

#[test]
fn create_type_covers_every_type_ref() {
    let name = s("p");
    for type_ref in 0..=MAX_TYPE_REF {
        let mut w = Writer::new();
        Content::Type(create_type(type_ref, &name).unwrap()).write(&mut w, 0);
        let got = read_content_type(&mut Reader::new(w.bytes())).unwrap();
        assert_eq!(got.kind().ref_number(), type_ref, "ref {type_ref}");
    }
    assert!(create_type(7, &name).is_none(), "ref 7");
}

// EncodeStateAsUpdate promises an error, so an engine invariant failing
// inside it must come back as one, never as a panic.
#[test]
fn encode_returns_an_engine_failure_as_an_error() {
    let doc = pinned_doc();
    {
        let mut st = doc.lock();
        // A gap the store never allows: clocks 2..4 are missing.
        let a = st.store.alloc(any_item(STORE_CLIENT, 0, sa(&["a", "b"])));
        let c = st.store.alloc(any_item(STORE_CLIENT, 5, sa(&["c"])));
        st.store
            .clients
            .insert(STORE_CLIENT, vec![Struct::Item(a), Struct::Item(c)]);
        st.store.order.push(STORE_CLIENT);
    }
    let mut target = StateVector::new();
    target.set(STORE_CLIENT, 3);
    match doc.encode_state_as_update(&target.encode()) {
        Err(Error::Engine(_)) => {}
        other => panic!("got {other:?}; want an engine error"),
    }
}

/// Go's chain: parents and links a run of items under one type.
pub fn chain(store: &mut Store, parent: usize, items: &[ItemId]) {
    for (index, &item) in items.iter().enumerate() {
        store.items[item].parent = Parent::Type(parent);
        if index == 0 {
            store.types[parent].start = Some(item);
            continue;
        }
        store.items[item].left = Some(items[index - 1]);
        store.items[items[index - 1]].right = Some(item);
    }
}

#[test]
fn array_enumerate_skips_deleted_and_non_countable() {
    let doc = pinned_doc();
    let mut st = doc.lock();
    st.store.types.push(TypeCore::new(TypeKind::Array));
    let array = st.store.types.len() - 1;
    let nested = Map::new(Vec::new());
    let a = st.store.alloc(item_with(
        STORE_CLIENT,
        0,
        Content::Any(vec![num(1.0), num(2.0)]),
    ));
    let mut gone = item_with(STORE_CLIENT, 2, Content::Any(sa(&["skipped"])));
    gone.deleted = true;
    let gone = st.store.alloc(gone);
    let format = st.store.alloc(item_with(
        STORE_CLIENT,
        3,
        Content::Format(std::sync::Arc::new(FormatContent::new(
            s("bold"),
            s("true"),
        ))),
    ));
    let typed = st.store.alloc(item_with(
        STORE_CLIENT,
        4,
        Content::Type(nested.as_type().clone()),
    ));
    let text = st
        .store
        .alloc(item_with(STORE_CLIENT, 5, Content::String(s("hi"))));
    chain(&mut st.store, array, &[a, gone, format, typed, text]);

    let values = st.list_values(array);
    assert_eq!(values.len(), 5);
    assert_eq!(values[0], Out::Any(num(1.0)));
    assert_eq!(values[1], Out::Any(num(2.0)));
    assert_eq!(values[2], Out::Type(nested.as_type().clone()));
    assert!(is_str(&values[3], "h") && is_str(&values[4], "i"));
    assert_eq!(st.list_get(array, 0), Some(Out::Any(num(1.0))));
    assert_eq!(
        st.list_get(array, 2),
        Some(Out::Type(nested.as_type().clone()))
    );
    assert!(is_str(&st.list_get(array, 4).unwrap(), "i"));
    assert!(
        st.list_get(array, 5).is_none() && st.list_get(array, -1).is_none(),
        "out of range"
    );
}

#[test]
fn map_try_get_reads_the_last_value_of_the_head_and_skips_deleted() {
    let doc = pinned_doc();
    let mut st = doc.lock();
    let m = map_core(&mut st.store);
    let single = st
        .store
        .alloc(item_with(STORE_CLIENT, 0, Content::Any(sa(&["x"]))));
    st.store.types[m].map_set_head(s("single"), single);
    let run = st
        .store
        .alloc(item_with(STORE_CLIENT, 1, Content::Any(sa(&["p", "q"]))));
    st.store.types[m].map_set_head(s("run"), run);
    let mut gone = item_with(STORE_CLIENT, 3, Content::Any(sa(&["dead"])));
    gone.deleted = true;
    let gone = st.store.alloc(gone);
    st.store.types[m].map_set_head(s("gone"), gone);

    assert!(is_str(&st.map_value(m, &s("single")).unwrap(), "x"));
    // A map head's value is the LAST element of its content, never the first.
    assert!(is_str(&st.map_value(m, &s("run")).unwrap(), "q"));
    assert!(st.map_value(m, &s("gone")).is_none());
    assert!(st.map_value(m, &s("absent")).is_none());
    let mut keys = st.map_keys(m);
    keys.sort();
    assert_eq!(keys, vec![s("run"), s("single")]);
}

#[test]
fn get_state_is_zero_for_an_unknown_client() {
    let mut store = Store::new();
    assert!(store.get_state(STORE_CLIENT) == 0 && store.get_state_vector().clients().is_empty());
    add_item(&mut store, any_item(STORE_CLIENT, 0, sa(&["a", "b"])));
    assert_eq!(store.get_state(STORE_CLIENT), 2);
    assert_eq!(store.get_state(STORE_CLIENT + 1), 0);
    assert_eq!(store.get_state_vector().get(STORE_CLIENT), 2);
}

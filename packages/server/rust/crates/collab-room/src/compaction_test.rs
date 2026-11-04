use std::collections::HashMap;

use blok_collab_workingset::{CURRENT_FORMAT, Tag};
use blok_jsjson::{Str, Value};
use blok_yjs::{Doc, Out};

use crate::test_support::*;
use crate::*;

// Twins of the C# CollabRoomTests compaction-on-load cases (M31).

fn compaction_tag() -> Tag {
    Tag {
        format: CURRENT_FORMAT,
        epoch: 2,
        lineage: "0123456789abcdef0123456789abcdef".to_owned(),
    }
}

fn seed_frames(store: &MemoryStore, updates: &[Vec<u8>]) {
    store.seed("doc", updates, compaction_tag());
}

/// One client doc whose updates each set one more key.
fn appending(values: &[&str]) -> Vec<Vec<u8>> {
    let doc = Doc::new(blok_yjs::Options {
        client_id: Some(77),
        no_gc: false,
    });
    let notes = doc.get_map("notes").expect("a map root");
    values
        .iter()
        .enumerate()
        .map(|(i, value)| {
            let key = char::from(b'a' + i as u8).to_string();
            doc.transact(|txn| notes.set(txn, key.as_str(), Value::String(Str::from(*value))))
                .expect("a write")
                .unwrap_or_default()
        })
        .collect()
}

fn notes(frames: &[Vec<u8>]) -> HashMap<String, String> {
    let doc = Doc::new(blok_yjs::Options::default());
    for frame in frames {
        doc.apply_update(frame).expect("a frame applies");
    }
    let m = doc.get_map("notes").expect("a map root");
    m.keys()
        .into_iter()
        .map(|key| {
            let Some(Out::Any(Value::String(value))) = m.get(key.clone()) else {
                panic!("a note is not a string");
            };
            (key.to_string(), value.to_string())
        })
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn compacts_an_oversized_working_set_on_load_by_frame_count() {
    let (manager, store, endpoint) = test_manager(
        Options {
            compaction_frame_threshold: 4,
            ..Options::default()
        },
        None,
    );
    seed_frames(&store, &appending(&["a", "b", "c", "d", "e"]));

    join(&manager, "doc", &FakeMember::v1(false)).await;

    let set = store.stored("doc");
    let frames = store.frames("doc");
    assert_eq!(
        (frames.len(), &set.tag, endpoint.loaded()),
        (1, &compaction_tag(), 0)
    );
    let got = notes(&frames);
    assert_eq!(
        (got.len(), got["e"].as_str()),
        (5, "e"),
        "the compacted frame holds {got:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn compacts_an_oversized_working_set_on_load_by_byte_size() {
    let (manager, store, _) = test_manager(
        Options {
            compaction_byte_threshold: 256,
            ..Options::default()
        },
        None,
    );
    seed_frames(&store, &appending(&[&"a".repeat(200), &"b".repeat(200)]));

    join(&manager, "doc", &FakeMember::v1(false)).await;

    assert_eq!(store.frames("doc").len(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn leaves_a_small_working_set_alone_on_load() {
    let (manager, store, _) = test_manager(Options::default(), None);
    seed_frames(&store, &appending(&["a", "b"]));

    join(&manager, "doc", &FakeMember::v1(false)).await;

    assert_eq!(store.frames("doc").len(), 2);
}

// C# compacts once frameCount reaches the threshold (CollabRoom.cs:2530).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn compacts_at_exactly_the_frame_threshold_and_not_one_below() {
    for (count, want) in [(4, 1), (3, 3)] {
        let (manager, store, _) = test_manager(
            Options {
                compaction_frame_threshold: 4,
                ..Options::default()
            },
            None,
        );
        seed_frames(&store, &appending(&["a", "b", "c", "d"][..count]));

        join(&manager, "doc", &FakeMember::v1(false)).await;

        assert_eq!(store.frames("doc").len(), want, "{count} seeded frames");
    }
}

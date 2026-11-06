use blok_jsjson::{Str, Value};

use crate::doc::{Doc, Options};
use crate::types::{In, Map};
use crate::undo::Direction;

fn doc(client: u32) -> Doc {
    Doc::new(Options {
        client_id: Some(client),
        no_gc: false,
    })
}

fn sync(from: &Doc, to: &Doc) {
    let update = from
        .encode_state_as_update(&to.encode_state_vector())
        .unwrap();
    to.apply_update(&update).unwrap();
}

fn text_of(doc: &Doc) -> String {
    doc.get_text("t").unwrap().to_string()
}

fn number(value: f64) -> In {
    In::Any(Value::Number(value))
}

fn map_number(map: &Map, key: &str) -> Option<f64> {
    match map.get(key)?.as_value()? {
        Value::Number(n) => Some(*n),
        _ => None,
    }
}

/// The agent writes captured steps; the peer writes plain transactions.
fn captured(doc: &Doc, body: impl FnOnce(&crate::doc::Transaction<'_>)) {
    doc.set_capturing(true);
    doc.transact(|txn| {
        body(txn);
        Ok(())
    })
    .unwrap();
    doc.set_capturing(false);
}

#[test]
fn undo_keeps_text_a_peer_typed_and_redo_brings_the_step_back() {
    let (agent, peer) = (doc(1), doc(2));
    agent.enable_undo();
    captured(&agent, |txn| {
        agent
            .get_text("t")
            .unwrap()
            .insert(Some(txn), 0, "Hello", None)
            .unwrap();
    });
    sync(&agent, &peer);
    captured(&agent, |txn| {
        agent
            .get_text("t")
            .unwrap()
            .insert(Some(txn), 0, ">> ", None)
            .unwrap();
    });
    sync(&agent, &peer);
    peer.transact(|txn| {
        peer.get_text("t")
            .unwrap()
            .insert(Some(txn), 8, " world", None)
    })
    .unwrap();
    sync(&peer, &agent);

    let (applied, update) = agent.replay(Direction::Undo).unwrap();
    assert!(applied.is_some() && update.is_some());
    assert_eq!(text_of(&agent), "Hello world");
    agent.replay(Direction::Redo).unwrap();
    assert_eq!(text_of(&agent), ">> Hello world");
    sync(&agent, &peer);
    assert_eq!(text_of(&peer), ">> Hello world");
}

#[test]
fn undo_restores_a_key_and_keeps_a_peers_other_key() {
    let (agent, peer) = (doc(1), doc(2));
    agent.enable_undo();
    let map = agent.get_map("m").unwrap();
    captured(&agent, |txn| {
        map.set(txn, "text", In::Any(Value::String(Str::from("Title"))))
            .unwrap();
        map.set(txn, "level", number(2.0)).unwrap();
    });
    captured(&agent, |txn| {
        map.set(txn, "text", In::Any(Value::String(Str::from("New title"))))
            .unwrap();
    });
    sync(&agent, &peer);
    let theirs = peer.get_map("m").unwrap();
    peer.transact(|txn| theirs.set(txn, "level", number(3.0)))
        .unwrap();
    sync(&peer, &agent);

    agent.replay(Direction::Undo).unwrap();
    assert_eq!(
        map.get("text").unwrap().as_value(),
        Some(&Value::String(Str::from("Title")))
    );
    assert_eq!(map_number(&map, "level"), Some(3.0));
    agent.replay(Direction::Redo).unwrap();
    assert_eq!(
        map.get("text").unwrap().as_value(),
        Some(&Value::String(Str::from("New title")))
    );
    assert_eq!(map_number(&map, "level"), Some(3.0));
}

#[test]
fn a_redo_never_overwrites_a_newer_value_from_a_peer() {
    let (agent, peer) = (doc(1), doc(2));
    agent.enable_undo();
    let map = agent.get_map("m").unwrap();
    captured(&agent, |txn| map.set(txn, "k", number(1.0)).unwrap());
    captured(&agent, |txn| map.set(txn, "k", number(2.0)).unwrap());
    agent.replay(Direction::Undo).unwrap();
    assert_eq!(map_number(&map, "k"), Some(1.0));
    sync(&agent, &peer);
    let theirs = peer.get_map("m").unwrap();
    peer.transact(|txn| theirs.set(txn, "k", number(9.0)))
        .unwrap();
    sync(&peer, &agent);
    let (applied, _) = agent.replay(Direction::Redo).unwrap();
    assert_eq!(applied, None);
    assert_eq!(map_number(&map, "k"), Some(9.0));
}

#[test]
fn only_captured_transactions_become_steps() {
    let agent = doc(1);
    agent.enable_undo();
    agent
        .transact(|txn| {
            agent
                .get_text("t")
                .unwrap()
                .insert(Some(txn), 0, "plain", None)
        })
        .unwrap();
    assert_eq!(agent.stack_top(Direction::Undo), None);
    captured(&agent, |txn| {
        agent
            .get_text("t")
            .unwrap()
            .insert(Some(txn), 0, "x", None)
            .unwrap();
    });
    let top = agent.stack_top(Direction::Undo);
    assert!(top.is_some());
    let (applied, _) = agent.replay(Direction::Undo).unwrap();
    assert_eq!(applied, top);
    assert_eq!(text_of(&agent), "plain");
    assert!(agent.stack_top(Direction::Redo).is_some());
    assert_eq!(agent.stack_top(Direction::Undo), None);
}

#[test]
fn undo_removes_an_inserted_nested_map_and_redo_restores_its_entries() {
    let agent = doc(1);
    agent.enable_undo();
    let blocks = agent.get_map("blocks").unwrap();
    captured(&agent, |txn| {
        let block = Map::new(vec![crate::types::MapEntry::new(
            "text",
            In::Any(Value::String(Str::from("one"))),
        )]);
        blocks.set(txn, "p1", block).unwrap();
    });
    agent.replay(Direction::Undo).unwrap();
    assert!(blocks.get("p1").is_none());
    agent.replay(Direction::Redo).unwrap();
    let block = blocks.get("p1").unwrap().as_map().unwrap();
    assert_eq!(
        block.get("text").unwrap().as_value(),
        Some(&Value::String(Str::from("one")))
    );
}

#[test]
fn a_preview_shows_the_undone_state_on_a_copy_and_leaves_the_doc_alone() {
    let agent = doc(1);
    agent.enable_undo();
    let map = agent.get_map("m").unwrap();
    captured(&agent, |txn| {
        map.set(txn, "locked", In::Any(Value::Bool(false))).unwrap();
    });
    captured(&agent, |txn| {
        map.set(txn, "locked", In::Any(Value::Bool(true))).unwrap();
    });
    let top = agent.stack_top(Direction::Undo);

    let preview = agent.preview(Direction::Undo).unwrap();
    assert_eq!(
        preview
            .get_map("m")
            .unwrap()
            .get("locked")
            .unwrap()
            .as_value(),
        Some(&Value::Bool(false))
    );
    assert_eq!(
        map.get("locked").unwrap().as_value(),
        Some(&Value::Bool(true))
    );
    assert_eq!(agent.stack_top(Direction::Undo), top);
    assert_eq!(agent.stack_top(Direction::Redo), None);

    agent.replay(Direction::Undo).unwrap();
    let redone = agent.preview(Direction::Redo).unwrap();
    assert_eq!(
        redone
            .get_map("m")
            .unwrap()
            .get("locked")
            .unwrap()
            .as_value(),
        Some(&Value::Bool(true))
    );
    assert_eq!(
        map.get("locked").unwrap().as_value(),
        Some(&Value::Bool(false))
    );
}

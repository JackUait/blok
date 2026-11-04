use std::cell::Cell;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use blok_collab_operation::{Record, Source};
use blok_jsjson::{Str, Value};
use blok_lib0::Writer;
use blok_yjs::{DEFAULT_INSPECT_DEPTH, Doc, Map, MapEntry, Options, Text, inspect};

use crate::agentops_test::{ag_apply, ag_seeded};
use crate::csharp_apply_test::ops;
use crate::error::Error;
use crate::export::{MAX_VALUE_DEPTH, export};
use crate::export_test::canonical;
use crate::fields::RichTextFields;
use crate::replay::{ReplayError, build_replay, step_replay};

// Twins of CollabHistoryReplayTests.

/// What a replay's caller returns: the replay's own refusal, or Go's
/// context.Canceled.
#[derive(Debug)]
pub(crate) enum Stop {
    Replay(ReplayError),
    Canceled,
}

impl From<ReplayError> for Stop {
    fn from(err: ReplayError) -> Stop {
        Stop::Replay(err)
    }
}

pub(crate) fn background() -> Result<(), Stop> {
    Ok(())
}

pub(crate) fn records(updates: &[Vec<u8>]) -> impl Iterator<Item = Result<Record, Stop>> + use<> {
    let updates = updates.to_vec();
    updates.into_iter().enumerate().map(|(i, update)| {
        let sequence = i as u64 + 1;
        Ok(Record {
            operation_id: format!("{sequence:032x}"),
            sequence,
            committed_at: SystemTime::UNIX_EPOCH + Duration::from_secs(sequence * 60),
            actor_id: None,
            source: Source::HTTP_EDIT,
            update,
            digest: vec![0; 32],
        })
    })
}

fn export_json(doc: &Doc) -> String {
    let (blocks, _) =
        export(doc, &RichTextFields::built_in(), None).unwrap_or_else(|err| panic!("{err}"));
    canonical(&Value::Array(blocks))
}

fn local_updates(doc: &Doc) -> Arc<Mutex<Vec<Vec<u8>>>> {
    let emitted = Arc::new(Mutex::new(Vec::new()));
    let sink = emitted.clone();
    // Dropping the subscription does not unsubscribe.
    let _ = doc.on_update(move |e| {
        if e.local {
            sink.lock().unwrap().push(e.update.clone());
        }
    });
    emitted
}

fn seeded(blocks: &[&str]) -> Doc {
    ag_seeded(&format!("[{}]", blocks.join(",")))
}

fn must_state(doc: &Doc) -> Vec<u8> {
    doc.encode_state_as_update(&[])
        .unwrap_or_else(|err| panic!("{err}"))
}

fn replay_error(result: Result<Doc, Stop>) -> ReplayError {
    match result {
        Err(Stop::Replay(err)) => err,
        other => panic!("{other:?}"),
    }
}

#[test]
fn every_prefix_exports_what_the_live_document_held_at_that_point() {
    let live = seeded(&[
        r#"{"id":"root","type":"paragraph","data":{"text":[{"text":"r"}]}}"#,
        r#"{"id":"second","type":"header","data":{"text":[{"text":"s"}],"level":2}}"#,
    ]);
    let baseline = must_state(&live);
    let emitted = local_updates(&live);
    let mut snapshots = vec![export_json(&live)];
    for edit in [
        r#"{"op":"insert","id":"a","after":"root","block":{"type":"paragraph","data":{"text":[{"text":"x "},{"text":"y","marks":{"bold":true}}]}}}"#,
        r#"{"op":"update","id":"root","data":{"text":[{"text":"changed"}]}}"#,
        r#"{"op":"remove","id":"second"}"#,
        r#"{"op":"insert","id":"b","parent":"a","block":{"type":"paragraph","data":{"text":[{"text":"kid"}]}}}"#,
    ] {
        ag_apply(&live, &ops(&[edit])).unwrap_or_else(|err| panic!("{err}"));
        snapshots.push(export_json(&live));
    }
    let emitted = emitted.lock().unwrap().clone();
    assert_eq!(emitted.len(), 4, "{} updates", emitted.len());
    for (n, snapshot) in snapshots.iter().enumerate() {
        let replayed = build_replay(
            background,
            std::slice::from_ref(&baseline),
            records(&emitted[..n]),
        )
        .unwrap_or_else(|err| panic!("{err:?}"));
        assert_eq!(&export_json(&replayed), snapshot, "{n}");
    }
}

fn text_updates(chunks: &[&str]) -> Vec<Vec<u8>> {
    let source = Doc::new(Options {
        client_id: Some(1),
        ..Options::default()
    });
    let text = source.get_text("t").unwrap_or_else(|err| panic!("{err}"));
    let mut updates = Vec::new();
    let mut at = 0;
    for chunk in chunks {
        let update = source
            .transact(|txn| text.insert(Some(txn), at, Str::from(*chunk), None))
            .unwrap_or_else(|err| panic!("{err}"))
            .unwrap_or_else(|| panic!("no update"));
        updates.push(update);
        at += chunk.len() as i64;
    }
    updates
}

fn text_of(doc: &Doc) -> String {
    doc.get_text("t")
        .unwrap_or_else(|err| panic!("{err}"))
        .units()
        .to_string()
}

#[test]
fn stepping_yields_the_baseline_then_the_document_after_each_record() {
    let u = text_updates(&["a", "b", "c"]);
    let mut seen = Vec::new();
    step_replay(
        background,
        &[u[0].clone()],
        records(&u[1..]),
        |record, doc| {
            let sequence = record.map_or("nil".to_owned(), |r| r.sequence.to_string());
            seen.push(format!("{sequence}:{}", text_of(doc)));
            Ok(())
        },
    )
    .unwrap_or_else(|err| panic!("{err:?}"));
    assert_eq!(seen.join(" "), "nil:a 1:ab 2:abc");
}

// Journal order is commit order, not causal order: a record whose
// dependency comes later is parked, then lands with it.
#[test]
fn a_record_ahead_of_its_dependency_is_parked_not_refused() {
    let u = text_updates(&["a", "b"]);
    let to_one =
        build_replay(background, &[], records(&u[1..2])).unwrap_or_else(|err| panic!("{err:?}"));
    assert!(!text_of(&to_one).contains('b'));
    let to_two = build_replay(background, &[], records(&[u[1].clone(), u[0].clone()]))
        .unwrap_or_else(|err| panic!("{err:?}"));
    assert_eq!(text_of(&to_two), "ab");
}

#[test]
fn a_format_one_baseline_exports_its_legacy_slot() {
    let replayed = build_replay(background, &[must_state(&legacy_html_doc())], records(&[]))
        .unwrap_or_else(|err| panic!("{err:?}"));
    // The slot is what DocConverter.export reads to segments.
    let (_, slots) =
        export(&replayed, &RichTextFields::built_in(), None).unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(slots.len(), 1);
    assert_eq!(slots[0].html.html.to_string(), "<b>x</b>");
}

pub(crate) fn new_block(id: &str, kind: &str, data: Map) -> Map {
    Map::new(vec![
        MapEntry {
            key: Str::from("id"),
            value: Value::String(Str::from(id)).into(),
        },
        MapEntry {
            key: Str::from("type"),
            value: Value::String(Str::from(kind)).into(),
        },
        MapEntry {
            key: Str::from("data"),
            value: data.into(),
        },
    ])
}

pub(crate) fn legacy_html_doc() -> Doc {
    let doc = Doc::new(Options::default());
    let data = Map::new(vec![MapEntry {
        key: Str::from("text"),
        value: Text::new(Some(Str::from("<b>x</b>"))).into(),
    }]);
    let blocks = doc.get_map("blocks").unwrap_or_else(|err| panic!("{err}"));
    let root = doc.get_array("root").unwrap_or_else(|err| panic!("{err}"));
    doc.transact(|txn| {
        blocks.set(txn, "a", new_block("a", "paragraph", data.clone()))?;
        root.insert(txn, 0, vec![Value::String(Str::from("a")).into()])
    })
    .unwrap_or_else(|err| panic!("{err}"));
    doc
}

/// One map key holding depth nested Any arrays.
fn nested_array_update(depth: usize) -> Vec<u8> {
    let mut w = Writer::new();
    w.write_var_uint(1);
    w.write_var_uint(1);
    w.write_var_uint(1000);
    w.write_var_uint(0);
    // ContentAny with the parentSub bit; the parent is a root name.
    w.write_uint8(0x28);
    w.write_var_uint(1);
    w.write_var_string(&Str::from("m"));
    w.write_var_string(&Str::from("k"));
    w.write_var_uint(1);
    for _ in 0..depth {
        w.write_uint8(117);
        w.write_var_uint(1);
    }
    w.write_uint8(126);
    w.write_var_uint(0);
    w.into_bytes()
}

#[test]
fn a_record_the_inspector_refuses_fails_naming_its_sequence() {
    let u = text_updates(&["a"]);
    let refused = replay_error(build_replay(
        background,
        &[],
        records(&[u[0].clone(), nested_array_update(257)]),
    ));
    assert_eq!(refused.sequence, Some(2));
    assert!(refused.message.contains("record 2"), "{}", refused.message);
    assert_eq!(
        refused.message,
        "collab: history replay could not read record 2: yjs: a value nests 257 levels, past the 256 allowed."
    );
}

#[test]
fn a_baseline_frame_the_inspector_refuses_has_no_sequence() {
    let refused = replay_error(build_replay(
        background,
        &[nested_array_update(257)],
        records(&[]),
    ));
    assert_eq!(refused.sequence, None);
    assert!(
        refused
            .message
            .starts_with("collab: history replay could not read baseline frame 0: "),
        "{}",
        refused.message
    );
}

#[test]
fn cancelling_between_records_stops_the_replay() {
    let u = text_updates(&["a", "b"]);
    let cancelled = Cell::new(false);
    let mut pulled = 0;
    // Go cancels once the first record's yield returns, before the second.
    let cancel_after_first = records(&u).inspect(|_| {
        pulled += 1;
        if pulled == 2 {
            cancelled.set(true);
        }
    });
    let ctx_err = || {
        if cancelled.get() {
            Err(Stop::Canceled)
        } else {
            Ok(())
        }
    };
    match build_replay(ctx_err, &[], cancel_after_first) {
        Err(Stop::Canceled) => {}
        other => panic!("{other:?}"),
    }
}

// The edit endpoint journals its update without the inspector, so replay
// must take the deepest data an edit can write: nested objects become
// Y.Maps (shallow Any); an array holding a scalar stays one Any value, kept
// at 256 levels by the converter's own cap.
#[test]
fn an_edit_at_the_deepest_data_the_converter_takes_replays() {
    for (open, close, any_depth) in [(r#"{"k":"#, "}", 0), ("[1,", "]", 256)] {
        let deep = |containers: usize| {
            format!(
                r#"{{"op":"update","id":"root","data":{{"deep":{}1{}}}}}"#,
                open.repeat(containers),
                close.repeat(containers)
            )
        };
        let live = seeded(&[r#"{"id":"root","type":"paragraph","data":{"text":[{"text":"r"}]}}"#]);
        let baseline = must_state(&live);
        let emitted = local_updates(&live);
        ag_apply(&live, &ops(&[&deep(MAX_VALUE_DEPTH)])).unwrap_or_else(|err| panic!("{err}"));
        let update = {
            let emitted = emitted.lock().unwrap();
            assert_eq!(emitted.len(), 1, "{} updates", emitted.len());
            emitted[0].clone()
        };
        let got = inspect(&update, DEFAULT_INSPECT_DEPTH);
        match &got.decoded {
            Some(decoded) if decoded.max_nesting_depth == any_depth => {}
            _ => panic!("depth {:?} {}", got.verdict, got.reason),
        }
        let replayed = build_replay(background, &[baseline], records(&[update]))
            .unwrap_or_else(|err| panic!("{err:?}"));
        assert_eq!(export_json(&replayed), export_json(&live));
        // One more level and the edit is refused, so it never reaches the journal.
        match ag_apply(&live, &ops(&[&deep(MAX_VALUE_DEPTH + 1)])) {
            Err(Error::Edit(_)) => {}
            other => panic!("{other:?}"),
        }
        assert_eq!(emitted.lock().unwrap().len(), 1);
    }
}

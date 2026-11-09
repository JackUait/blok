use blok_collab_convert::{describe_structure, read_page_maps, restore_digest_keeping};
use blok_jsjson::Value;

use crate::changes_test::{array, member, object};
use crate::history_fixture_test::{doc_of, exported_blocks, history_fixture, op_text, stringified};
use crate::historytime_fixture_test::{fixture, text};
use crate::{keep_databases, plan_restore_pinned};

// The twin of C# CollabHistoryCaptureTests.TheRestoreScopeMatchesThePlanner.
#[test]
fn keep_databases_matches_the_restore_scope_fixture() {
    let cases = history_fixture("restore-scope.json");
    assert!(cases.len() >= 8, "only {} cases", cases.len());
    let mut failures = Vec::new();
    for c in cases {
        let name = text(&c, "name");
        let (current, target) = (doc_of(&text(&c, "current")), doc_of(&text(&c, "target")));
        let current_blocks = exported_blocks(&current);
        let mut target_blocks = exported_blocks(&target);
        let kept = (text(&c, "databases") == "keep")
            .then(|| keep_databases(&current_blocks, &target_blocks));
        let mut pinned: Vec<String> = kept
            .iter()
            .flat_map(|kept| kept.pinned.iter().map(ToString::to_string))
            .collect();
        pinned.sort();
        let want_kept: Vec<String> = array(member(&c, "kept"))
            .iter()
            .map(|id| match id {
                Value::String(s) => s.to_string(),
                other => panic!("{other:?}"),
            })
            .collect();
        if pinned != want_kept {
            failures.push(format!("{name}: kept {pinned:?}, want {want_kept:?}"));
        }
        let orphaned: Vec<String> = kept
            .iter()
            .flat_map(|kept| kept.orphaned.iter().map(|guard| stringified(&guard.json())))
            .collect();
        let want_orphaned: Vec<String> = array(member(&c, "orphaned"))
            .iter()
            .map(stringified)
            .collect();
        if orphaned != want_orphaned {
            failures.push(format!(
                "{name}: orphaned {orphaned:?}, want {want_orphaned:?}"
            ));
        }
        if let Some(kept) = &kept {
            target_blocks = kept.target.clone();
        }
        let ops = plan_restore_pinned(
            &current_blocks,
            &describe_structure(&current).unwrap_or_else(|err| panic!("{err}")),
            &target_blocks,
            &read_page_maps(&current).unwrap_or_else(|err| panic!("{err}")),
            &read_page_maps(&target).unwrap_or_else(|err| panic!("{err}")),
            None,
            kept.as_ref().map(|kept| &kept.pinned),
        );
        let want = array(member(&c, "ops"));
        if ops.len() != want.len() {
            failures.push(format!("{name}: {} ops, want {}", ops.len(), want.len()));
            continue;
        }
        for (i, op) in ops.iter().enumerate() {
            let (got, expected) = (op_text(op), stringified(&want[i]));
            if got != expected {
                failures.push(format!("{name}: op {i} is {got}, want {expected}"));
            }
        }
    }
    for d in array(member(&fixture("restore-scope.json"), "digests")) {
        let d = object(d);
        let sequence: u64 = text(d, "sequence").parse().unwrap();
        let got: String = restore_digest_keeping(
            &text(d, "lineage"),
            sequence,
            text(d, "databases") == "keep",
        )
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
        if got != text(d, "digestHex") {
            failures.push(format!("digest {}: {got}", text(d, "databases")));
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

// A wide document with many kept databases stays fast: every lookup is by
// id, and each kept root is placed in one pass.
#[test]
fn keep_databases_is_linear_in_the_blocks() {
    const N: usize = 50_000;
    let block = |id: String, kind: &str| {
        let mut object = blok_jsjson::Object::new();
        object.set(
            blok_jsjson::Str::from("id"),
            Value::String(blok_jsjson::Str::from(id.as_str())),
        );
        object.set(
            blok_jsjson::Str::from("type"),
            Value::String(blok_jsjson::Str::from(kind)),
        );
        Value::Object(object)
    };
    let mut current = Vec::new();
    let mut target = Vec::new();
    for i in 0..N {
        current.push(block(format!("p{i}"), "paragraph"));
        current.push(block(format!("d{i}"), "database"));
        target.push(block(format!("p{i}"), "paragraph"));
    }
    let started = std::time::Instant::now();
    let kept = keep_databases(&current, &target);
    assert_eq!(kept.target.len(), 2 * N);
    assert_eq!(kept.pinned.len(), N);
    assert!(
        started.elapsed() < std::time::Duration::from_secs(60),
        "{:?}",
        started.elapsed()
    );
}

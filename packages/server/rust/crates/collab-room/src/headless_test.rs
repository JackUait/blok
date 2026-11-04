use std::sync::Arc;

use crate::test_support::*;
use crate::*;

// Twins of the C# CollabRoomTests headless-journal cases: a journal with no
// head adopts the working set (load.rs try_adopt_working_set_locked), and a
// working set beside a head is dropped (drop_working_set_locked).

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_headless_journal_adopts_the_working_set_and_then_drops_it() {
    let r = TextRoom::new();
    r.endpoint.holds(TEST_DOC, "from-endpoint", None);
    r.store
        .seed(TEST_DOC, &[full_state(&doc_with("from-ws"))], tag_at(3));
    let manager = r.manager(Options::default(), true);

    assert_eq!(
        state_text(&manager, TEST_DOC).await.1,
        r#"{"text":"from-ws"}"#
    );
    let head = r.operations.head(TEST_DOC).expect("a head");
    assert_eq!(
        (head.lineage.as_str(), head.epoch),
        (TAG_LINEAGE, 3),
        "the working set's lineage at epoch 3"
    );
    assert!(!r.store.holds(TEST_DOC), "the adopted working set was kept");

    // The adopted content is owed to the endpoint, and the journal serves it
    // after a reload.
    manager.drain().await.expect("drain");
    let saves = r.endpoint.saves();
    assert_eq!(
        saves.last().map(|s| s.data.as_str()),
        Some(r#"{"text":"from-ws"}"#),
        "saves = {saves:?}"
    );
    let reloaded = r.manager(Options::default(), true);
    assert_eq!(
        state_text(&reloaded, TEST_DOC).await.1,
        r#"{"text":"from-ws"}"#
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_headless_journal_with_an_empty_working_set_seeds_from_the_endpoint() {
    let r = TextRoom::new();
    r.endpoint.holds(TEST_DOC, "from-endpoint", None);
    r.store.seed(TEST_DOC, &[], tag_at(3));
    let manager = r.manager(Options::default(), true);

    assert_eq!(
        state_text(&manager, TEST_DOC).await.1,
        r#"{"text":"from-endpoint"}"#
    );
    let head = r.operations.head(TEST_DOC).expect("a head");
    assert_ne!(head.lineage, TAG_LINEAGE, "want a fresh lineage");
}

// A working set beside a journal head is stale by definition: a lost
// journal or a swapped store would adopt it and bring old content back.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_stale_working_set_beside_a_journal_head_is_ignored_and_dropped() {
    let r = TextRoom::new();
    r.endpoint.holds(TEST_DOC, "hello", None);
    let first = r.manager(Options::default(), true);
    let result = http_edit(&first, TEST_DOC, "0123456789abcdef0123456789abcdef", "!").await;
    assert_eq!(result.status, EditStatus::Applied, "{:?}", result.err);
    first.drain().await.expect("drain");
    r.store
        .seed(TEST_DOC, &[full_state(&doc_with("stale"))], tag_at(0));

    let second = r.manager(Options::default(), true);
    assert_eq!(
        state_text(&second, TEST_DOC).await.1,
        r#"{"text":"hello!"}"#
    );
    assert!(!r.store.holds(TEST_DOC), "the stale working set was kept");
}

// A damaged working copy is moved aside by the store and the room seeds
// from the endpoint. Retiring a working copy later must not take the
// quarantined bytes with it: only a purge may.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_quarantined_working_copy_survives_the_journal_taking_over() {
    let r = TextRoom::new();
    let directory = TempDir::new();
    let log = r.logs.log();
    let local = Arc::new(blok_collab_workingset::LocalStore::new(
        directory.path(),
        Some(Arc::new(move |line: &str| log(line))),
    ));
    let damaged = directory
        .path()
        .join(blok_collab_workingset::doc_key(TEST_DOC));
    std::fs::write(&damaged, [9, 9, 9]).expect("write the damaged copy");
    r.endpoint.holds(TEST_DOC, "from-endpoint", None);
    let open = || async {
        let manager = Manager::new(ManagerOptions {
            store: local.clone(),
            endpoint: r.endpoint.clone(),
            converter: r.converter.clone(),
            room: Options {
                now: Some(r.clock.clock()),
                ..Options::default()
            },
            log: Some(r.logs.log()),
            operations: Some(Arc::new(r.operations.clone())),
            activity: None,
        });
        let state = manager.state(TEST_DOC).await.expect("state");
        manager.drain().await.expect("drain");
        state
    };

    let opened = open().await;
    open().await;

    assert_eq!(
        String::from_utf8_lossy(&opened.json),
        r#"{"text":"from-endpoint"}"#
    );
    let prefix = format!("{}.unreadable-", blok_collab_workingset::doc_key(TEST_DOC));
    let aside: Vec<_> = std::fs::read_dir(directory.path())
        .expect("list")
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().starts_with(&prefix))
        .collect();
    assert_eq!(aside.len(), 1, "quarantined copies");
    assert_eq!(std::fs::read(aside[0].path()).expect("read"), [9, 9, 9]);
}

// A reset rebaselines from the endpoint, so whatever only the working copy
// held must reach the endpoint first.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_reset_of_a_headless_document_adopts_and_flushes_the_working_set_first() {
    let r = TextRoom::new();
    r.endpoint.holds(TEST_DOC, "from-endpoint", None);
    r.store
        .seed(TEST_DOC, &[full_state(&doc_with("from-ws"))], tag_at(3));
    let manager = r.manager(Options::default(), true);

    let result = manager.reset(TEST_DOC).await.expect("reset");
    assert_eq!(result.status, ResetStatus::Done, "{:?}", result.err);
    assert!(
        r.endpoint
            .saves()
            .iter()
            .any(|s| s.data == r#"{"text":"from-ws"}"#),
        "the adopted content never reached the endpoint: {:?}",
        r.endpoint.saves()
    );
    // The reset raised the ADOPTED epoch, so it ran on the adopted history.
    assert_eq!(r.operations.head(TEST_DOC).map(|h| h.epoch), Some(4));
    assert!(!r.store.holds(TEST_DOC), "the working set was kept");
}

// A working copy left beside a reset journal holds content the reset threw
// away, so a reset that cannot retire it is refused and a retry finishes it.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_reset_that_cannot_retire_the_working_copy_is_refused() {
    let r = TextRoom::new();
    r.endpoint.holds(TEST_DOC, "from-endpoint", None);
    r.store
        .seed(TEST_DOC, &[full_state(&doc_with("from-ws"))], tag_at(3));
    r.store
        .set_fail_retires(Some(Box::new(|_| Some("the disk is busy".to_owned()))));
    let manager = r.manager(Options::default(), true);

    let refused = manager.reset(TEST_DOC).await.expect("reset");
    assert_eq!(refused.status, ResetStatus::Unavailable);
    assert_eq!(r.operations.head(TEST_DOC).map(|h| h.epoch), Some(3));
    assert!(
        r.store.holds(TEST_DOC),
        "the working set is gone after a refused reset"
    );

    r.store.set_fail_retires(None);
    let retried = manager.reset(TEST_DOC).await.expect("reset");
    assert_eq!(retried.status, ResetStatus::Done, "{:?}", retried.err);
    assert_eq!(r.operations.head(TEST_DOC).map(|h| h.epoch), Some(4));
    assert!(!r.store.holds(TEST_DOC), "the working set was kept");
    assert!(
        r.logged("could not retire its working set, so the reset is refused"),
        "log = {:?}",
        r.logs.lines()
    );
}

use std::sync::Arc;
use std::sync::atomic::Ordering;

use blok_collab::{CloseReason, JoinStatus};
use blok_collab_convert::EditOp;
use blok_collab_journal::PurgeOutcome;
use blok_collab_workingset::{CURRENT_FORMAT, Tag};
use blok_jsjson::Str;

use crate::test_support::*;
use crate::*;

// Twins of the C# CollabRoomManagerTests join outcomes (M3): SeedFailed,
// Forbidden and Purged.

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_seed_failure_reports_seed_failed_writes_nothing_and_retries_on_the_next_join() {
    let (manager, store, endpoint) = test_manager(Options::default(), None);
    endpoint.fail(Some(Error::message(
        "collab: the doc endpoint GET returned 503.",
    )));
    let member = FakeMember::v1(false);

    let failed = manager.join("doc", member.clone()).await.expect("join");
    assert_eq!(failed.status, JoinStatus::SeedFailed);
    assert!(failed.membership.is_none());
    assert!(
        store.peek("doc").is_none(),
        "a failed seed wrote a working set"
    );
    assert!(member.closed().is_empty());

    endpoint.fail(None);
    join(&manager, "doc", &FakeMember::v1(false)).await;
    assert_eq!(endpoint.loaded(), 2, "the next join must seed again");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn forbidden_first_join_does_not_load_or_retain_a_room() {
    let (manager, store, endpoint) = test_manager(Options::default(), None);
    let denied_member = FakeMember::v1(false);
    denied_member.revoke(None);

    let denied = manager.join("doc", denied_member).await.expect("join");
    assert_eq!(denied.status, JoinStatus::Forbidden);
    assert!(denied.membership.is_none());
    assert_eq!((endpoint.loaded(), manager.live_room_count()), (0, 0));
    assert!(
        store.peek("doc").is_none(),
        "a forbidden join wrote a working set"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_stored_update_that_cannot_be_applied_fails_the_join_closed() {
    let (manager, store, endpoint) = test_manager(Options::default(), None);
    let tag = Tag {
        format: CURRENT_FORMAT,
        epoch: 1,
        lineage: "0123456789abcdef0123456789abcdef".to_owned(),
    };
    lock(&store.sets).insert(
        "doc".to_owned(),
        blok_collab_workingset::Set {
            updates: vec![2, 0, 0, 0, 0xde, 0xad],
            tag,
        },
    );

    let result = manager
        .join("doc", FakeMember::v1(false))
        .await
        .expect("join");
    assert_eq!(result.status, JoinStatus::SeedFailed);
    assert_eq!((endpoint.loaded(), manager.live_room_count()), (0, 0));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_purged_document_refuses_every_door_for_the_life_of_the_process() {
    let (manager, store, endpoint) = test_manager(Options::default(), None);
    let member = FakeMember::v1(true);
    join(&manager, "doc", &member).await;

    let outcome = manager
        .purge("doc", async { Ok(true) })
        .await
        .expect("purge");
    assert_eq!(outcome, PurgeOutcome::Purged);
    assert_eq!(member.closed(), [CloseReason::Forbidden]);
    assert!(store.peek("doc").is_none(), "the purge left a working set");
    assert_eq!((endpoint.saved(), manager.live_room_count()), (0, 0));
    let joined = manager
        .join("doc", FakeMember::v1(false))
        .await
        .expect("join");
    assert_eq!(joined.status, JoinStatus::Purged);
    let insert = EditOp::Insert {
        id: Str::from("late"),
        block: blok_jsjson::new_null(),
        after: None,
        parent: None,
    };
    let edit = manager
        .edit("doc", vec![insert], "op", &[0; 32], "", None)
        .await
        .expect("edit");
    assert_eq!(edit.status, EditStatus::Purged);
    let reset = manager.reset("doc").await.expect("reset");
    assert_eq!(reset.status, ResetStatus::Purged);
    assert!(!manager.checkpoint("doc").await.expect("checkpoint"));
    let _ = store.reads.load(Ordering::SeqCst);
    let _: Arc<MemoryStore> = store;
}

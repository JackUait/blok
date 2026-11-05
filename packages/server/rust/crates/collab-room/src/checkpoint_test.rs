use std::sync::Arc;
use std::sync::atomic::{AtomicI32, Ordering};

use blok_collab::{CloseReason, OperationSource};
use blok_collab_wire::Message;
use blok_yjs::Doc;

use crate::test_support::*;
use crate::*;

// Twins of the C# CollabRoomTests checkpoint-policy cases (ops.rs
// checkpoint_locked and the threshold in sync.rs).

const OP_FOUR: &str = "11111111222222223333333344444444";
const OP_FIVE: &str = "5555555566666666777777778888888a";
const OP_SIX: &str = "99999999aaaaaaaabbbbbbbbcccccccd";

async fn checkpoint(manager: &Manager) -> bool {
    manager.checkpoint(TEST_DOC).await.expect("checkpoint")
}

/// A journal room on "hello" with one synced v2 writer.
async fn checkpoint_room(o: Options) -> (TextRoom, Manager, Arc<FakeMember>, Joined, Doc) {
    let r = TextRoom::new();
    r.endpoint.holds(TEST_DOC, "hello", None);
    let manager = r.manager(o, true);
    let writer = FakeMember::v2();
    let membership = join_synced(&manager, TEST_DOC, &writer).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    (r, manager, writer, membership, client)
}

// A failure that is not one of the fatal kinds is retried, but a run of
// them stops the room: the session may never succeed again.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_run_of_checkpoint_failures_stops_the_room() {
    let (r, manager, writer, membership, client) = checkpoint_room(Options::default()).await;
    send_operation(&membership, &writer, OP_ONE, update_appending(&client, "!")).await;
    r.operations.set_fail_checkpoints(Some(Box::new(|_| {
        Some(
            "collab: this session can no longer say what is durable; reopen the document"
                .to_owned(),
        )
    })));

    for _ in 0..2 {
        assert!(
            !checkpoint(&manager).await,
            "a failed checkpoint was reported published"
        );
        assert!(
            writer.closed().is_empty(),
            "closed after a retryable failure"
        );
    }
    assert!(
        !checkpoint(&manager).await,
        "a failed checkpoint was reported published"
    );

    assert_eq!(writer.closed(), [CloseReason::CommitUnavailable]);
    assert_eq!(
        manager.live_room_count(),
        0,
        "the stopped room is still loaded"
    );
}

// A checkpoint published while a PUT is in flight still earns its own
// projection, through the owed mark.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_checkpoint_published_during_an_in_flight_projection_still_earns_one() {
    let gate = Gate::new();
    let r = TextRoom::new();
    r.endpoint.holds(TEST_DOC, "hello", None);
    r.endpoint.set_save_gate(Some(gate.clone()));
    let manager = r.manager(version_options(ms(5000)), true);
    let writer = FakeMember::v2();
    let membership = join_synced(&manager, TEST_DOC, &writer).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    send_operation(&membership, &writer, OP_ONE, update_appending(&client, "!")).await;

    assert!(
        checkpoint(&manager).await,
        "the first checkpoint was not published"
    );
    wait_until("the projection the first checkpoint earned", || {
        r.endpoint.saves().len() == 1
    })
    .await;

    send_operation(&membership, &writer, OP_TWO, update_appending(&client, "?")).await;
    assert!(
        checkpoint(&manager).await,
        "the second checkpoint was not published"
    );
    r.endpoint.set_save_gate(None);
    gate.open();
    wait_until("the projection the second checkpoint earned", || {
        r.endpoint.saves().len() >= 2
    })
    .await;
    tokio::time::sleep(ms(50)).await;

    assert_eq!(
        r.operations.checkpoint(TEST_DOC).map(|c| c.through),
        Some(2)
    );
    let saves = r.endpoint.saves();
    assert_eq!(saves.len(), 2, "saves = {saves:?}");
    assert_eq!(saves[1].data, r#"{"text":"hello!?"}"#);
}

// A checkpoint replaces the operations it covers on replay, so it never
// names a sequence past the journal's, nor carries bytes past it.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn checkpoint_through_never_exceeds_durable_through() {
    let (r, manager, writer, membership, client) = checkpoint_room(Options {
        checkpoint_operation_threshold: 3,
        ..Options::default()
    })
    .await;
    for (op, text) in [(OP_ONE, "a"), (OP_TWO, "b"), (OP_THREE, "c")] {
        send_operation(&membership, &writer, op, update_appending(&client, text)).await;
    }
    manager.settle().await;

    let published = r
        .operations
        .checkpoint(TEST_DOC)
        .expect("three operations crossed the threshold");
    let head = r.operations.head(TEST_DOC).expect("a head");
    assert!(
        published.through <= head.durable_through,
        "the checkpoint is past the journal"
    );
    let replica = new_client();
    replica
        .apply_update(&published.state)
        .expect("the checkpoint applies");
    assert_eq!(
        (
            doc_text(&replica).as_str(),
            published.through,
            head.durable_through
        ),
        ("helloabc", 3, 3)
    );

    // The cursor moves only where a checkpoint was written.
    send_operation(
        &membership,
        &writer,
        OP_FOUR,
        update_appending(&client, "d"),
    )
    .await;
    manager.settle().await;
    assert_eq!(
        r.operations.checkpoint(TEST_DOC).map(|c| c.through),
        Some(3)
    );
    assert_eq!(
        r.operations.head(TEST_DOC).map(|h| h.durable_through),
        Some(4)
    );
}

// A parked update holds the cursor back: the threshold may fire, the
// checkpoint may not.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pending_yjs_state_prevents_checkpoint_advancement() {
    let (r, manager, writer, membership, _) = checkpoint_room(Options {
        checkpoint_operation_threshold: 2,
        ..Options::default()
    })
    .await;
    let author = synced_client(&manager, TEST_DOC, "hello").await;
    let other = synced_client(&manager, TEST_DOC, "hello").await;
    let first = update_appending(&author, "a");
    let second = update_appending(&author, "b");

    send_operation(&membership, &writer, OP_ONE, update_appending(&other, "z")).await;
    send_operation(&membership, &writer, OP_TWO, second).await;
    manager.settle().await;

    assert!(
        r.operations.checkpoint(TEST_DOC).is_none(),
        "a checkpoint over parked state was published"
    );
    // The gate refuses the accelerator, never the journal.
    assert_eq!(r.operations.committed(TEST_DOC).len(), 2);

    send_operation(&membership, &writer, OP_THREE, first).await;
    manager.settle().await;
    let published = r.operations.checkpoint(TEST_DOC);
    assert_eq!(
        published.as_ref().map(|c| c.through),
        Some(3),
        "once the dependency landed"
    );
    let replica = new_client();
    replica
        .apply_update(&published.expect("published").state)
        .expect("applies");
    assert_eq!(doc_text(&replica), exported_text(&manager, TEST_DOC).await);
}

// Three consecutive failures close the room, so a failed checkpoint costs
// another whole threshold before it retries.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_failed_checkpoint_costs_another_threshold_before_it_retries() {
    let (r, manager, writer, membership, client) = checkpoint_room(Options {
        checkpoint_operation_threshold: 2,
        ..Options::default()
    })
    .await;
    let attempts = Arc::new(AtomicI32::new(0));
    let counted = attempts.clone();
    r.operations.set_fail_checkpoints(Some(Box::new(move |_| {
        counted.fetch_add(1, Ordering::SeqCst);
        Some("the journal disk is busy".to_owned())
    })));

    for op in [OP_ONE, OP_TWO, OP_THREE, OP_FOUR] {
        send_operation(&membership, &writer, op, update_appending(&client, "!")).await;
    }
    manager.settle().await;

    assert_eq!(
        attempts.load(Ordering::SeqCst),
        2,
        "attempts over four operations"
    );
    assert!(writer.closed().is_empty());
    assert_eq!(manager.live_room_count(), 1);
    assert!(r.operations.checkpoint(TEST_DOC).is_none());
    let runs: Vec<String> = r
        .logs
        .matching("could not publish a checkpoint")
        .iter()
        .map(|line| line[line.find('(').expect("(") + 1..line.find(')').expect(")")].to_owned())
        .collect();
    assert_eq!(runs.join(","), "1 of 3,2 of 3");

    r.operations.set_fail_checkpoints(None);
    for op in [OP_FIVE, OP_SIX] {
        send_operation(&membership, &writer, op, update_appending(&client, "?")).await;
    }
    manager.settle().await;
    assert_eq!(
        r.operations.checkpoint(TEST_DOC).map(|c| c.through),
        Some(6),
        "after the disk recovered"
    );
}

// Bytes accumulate across operations toward the byte threshold.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_byte_threshold_publishes_where_the_operation_count_would_not() {
    const BYTE_THRESHOLD: usize = 300;
    let (r, manager, writer, membership, client) = checkpoint_room(Options {
        checkpoint_operation_threshold: 1000,
        checkpoint_byte_threshold: BYTE_THRESHOLD as i64,
        ..Options::default()
    })
    .await;

    send_operation(
        &membership,
        &writer,
        OP_ONE,
        update_appending(&client, &"y".repeat(200)),
    )
    .await;
    manager.settle().await;
    let first = r.operations.committed(TEST_DOC)[0].update.len();
    assert!(
        first < BYTE_THRESHOLD,
        "the premise is gone: the first operation crosses on its own at {first} bytes"
    );
    assert!(
        r.operations.checkpoint(TEST_DOC).is_none(),
        "checkpoint after one operation"
    );

    send_operation(
        &membership,
        &writer,
        OP_TWO,
        update_appending(&client, &"x".repeat(200)),
    )
    .await;
    manager.settle().await;
    let second = r.operations.committed(TEST_DOC)[1].update.len();
    assert!(
        second < BYTE_THRESHOLD && first + second >= BYTE_THRESHOLD,
        "the premise is gone: {first} and {second}"
    );
    assert_eq!(
        r.operations.checkpoint(TEST_DOC).map(|c| c.through),
        Some(2)
    );
}

// The trigger is in the durable step every write path shares: a v1 write
// and an HTTP edit count too.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_threshold_counts_every_journalled_write_not_just_v2_operations() {
    let r = TextRoom::new();
    r.endpoint.holds(TEST_DOC, "hello", None);
    let manager = r.manager(
        Options {
            checkpoint_operation_threshold: 2,
            ..Options::default()
        },
        true,
    );
    let stock = join(&manager, TEST_DOC, &FakeMember::v1(true)).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;

    receive(
        &stock,
        Message::SyncUpdate {
            update: update_appending(&client, "a"),
        },
    )
    .await;
    let result = http_edit(&manager, TEST_DOC, OP_ONE, "x").await;
    assert_eq!(result.status, EditStatus::Applied, "{:?}", result.err);
    manager.settle().await;

    assert_eq!(
        r.operations.checkpoint(TEST_DOC).map(|c| c.through),
        Some(2)
    );
    let sources: Vec<u8> = r
        .operations
        .committed(TEST_DOC)
        .iter()
        .map(|c| c.source.0)
        .collect();
    assert_eq!(
        sources,
        [
            OperationSource::ClientV1 as u8,
            OperationSource::HttpEdit as u8
        ]
    );
}

// A deletion of text this room never received is parked, and the
// checkpoint is refused while it is.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_checkpoint_is_refused_while_the_engine_holds_pending_state() {
    let r = TextRoom::new();
    r.endpoint.holds(TEST_DOC, "hello", None);
    let manager = r.manager(Options::default(), true);
    let membership = join(&manager, TEST_DOC, &FakeMember::v1(true)).await;

    let stray = new_client();
    update_appending(&stray, "zz");
    receive(
        &membership,
        Message::SyncUpdate {
            update: update_deleting(&stray, 0, 2),
        },
    )
    .await;

    assert_eq!(r.operations.committed(TEST_DOC).len(), 1);
    assert!(
        !checkpoint(&manager).await,
        "a checkpoint was published over pending state"
    );
    assert!(r.operations.checkpoint(TEST_DOC).is_none());
}

// C# TheCheckpointLinesPrintTheStoresOwnTextForAWrappedCancel: a cancel the
// store returns as is reads as .NET's cancel text; one the store wraps in
// its own error keeps the store's own text.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_checkpoint_lines_print_the_stores_own_text_for_a_wrapped_cancel() {
    type MakeError = fn() -> Error;
    let cases: [(MakeError, &str); 2] = [
        (|| Error::DeadlineExceeded, "The operation was canceled."),
        (
            || Error::Wrapped {
                message: "s3 put: context canceled".to_owned(),
                err: Box::new(Error::Canceled),
            },
            "s3 put: context canceled",
        ),
    ];
    for (err, text) in cases {
        let (r, manager, writer, membership, client) = checkpoint_room(Options {
            checkpoint_operation_threshold: 1,
            ..Options::default()
        })
        .await;
        *lock(&r.operations.0.checkpoint_error) = Some(Box::new(err));

        for op in [OP_ONE, OP_TWO, OP_THREE] {
            send_operation(&membership, &writer, op, update_appending(&client, "!")).await;
        }
        manager.settle().await;

        assert_eq!(
            r.logs.matching("checkpoint"),
            [
                format!(
                    "collab: room \"{TEST_DOC}\" could not publish a checkpoint (1 of 3), retrying later: {text}"
                ),
                format!(
                    "collab: room \"{TEST_DOC}\" could not publish a checkpoint (2 of 3), retrying later: {text}"
                ),
                format!(
                    "collab: room \"{TEST_DOC}\" could not publish a checkpoint, closing: {text}"
                ),
            ]
        );
    }
}

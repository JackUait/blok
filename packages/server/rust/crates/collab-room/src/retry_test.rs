use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use blok_collab::{BoxFuture, JoinStatus};
use blok_collab_journal::Context;
use blok_collab_operation::{AppendResult, Candidate, Checkpoint, Head, Lookup, OpenResult, Reset};
use blok_collab_wire::Message;
use blok_jsjson::Str;

use crate::test_support::*;
use crate::*;

pub(crate) fn custom_insert(id: &str) -> Vec<blok_collab_convert::EditOp> {
    vec![blok_collab_convert::EditOp::Insert {
        id: Str::from(id),
        block: node(r#"{"type":"custom","data":{"n":1}}"#),
        after: None,
        parent: None,
    }]
}

#[derive(Clone, Copy, Debug)]
enum Call {
    Join,
    Edit,
    State,
    Reset,
}

async fn call(manager: &Manager, which: Call) -> &'static str {
    match which {
        Call::Join => match manager
            .join("doc", FakeMember::v1(false))
            .await
            .expect("join")
            .status
        {
            JoinStatus::Joined => "Joined",
            JoinStatus::Purged => "Purged",
            JoinStatus::Draining => "Draining",
            JoinStatus::Unavailable => "Unavailable",
            _ => "other",
        },
        Call::Edit => match manager
            .edit("doc", custom_insert("c"), "op", &[0; 32], "", None)
            .await
            .expect("edit")
            .status
        {
            EditStatus::Applied => "Applied",
            EditStatus::Purged => "Purged",
            EditStatus::Draining => "Draining",
            EditStatus::Unavailable => "Unavailable",
            _ => "other",
        },
        Call::State => match manager.state("doc").await.expect("state").status {
            StateStatus::Ready => "Ready",
            StateStatus::Purged => "Purged",
            StateStatus::Draining => "Draining",
            StateStatus::Unavailable => "Unavailable",
            _ => "other",
        },
        Call::Reset => match manager.reset("doc").await.expect("reset").status {
            ResetStatus::Done => "Reset",
            _ => "other",
        },
    }
}

// G1: twins of AnEditQueuedBehindAClosingRoomIsRetriedOnAFreshOne and
// ACallQueuedBehindAClosingRoomIsRetriedOnAFreshOne. Each entry point has
// its own retry loop, so each is driven through one.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_call_queued_behind_a_closing_room_is_retried_on_a_fresh_one() {
    // A reset closes the room it ran on.
    for (which, want, rooms) in [
        (Call::Join, "Joined", 1),
        (Call::Edit, "Applied", 1),
        (Call::State, "Ready", 1),
        (Call::Reset, "Reset", 0),
    ] {
        let (manager, store, endpoint) = test_manager(
            Options {
                eviction_linger: ms(10),
                export_debounce: HOUR,
                export_max_delay: HOUR,
                ..Options::default()
            },
            None,
        );
        let gate = Gate::new();
        endpoint.set_save_gate(Some(gate.clone()));

        let membership = join(&manager, "doc", &FakeMember::v1(true)).await;
        receive(
            &membership,
            Message::SyncUpdate {
                update: client_update(9, "k"),
            },
        )
        .await;
        membership.leave();
        wait_until("the eviction's export to start", || endpoint.saved() == 1).await;

        let caller = manager.clone();
        let done = tokio::spawn(async move { call(&caller, which).await });
        // The call must be queued behind the flush, not run after it.
        wait_for_lane_waiters(&manager, 1, "the call to queue").await;
        endpoint.set_save_gate(None);
        gate.open();

        let got = tokio::time::timeout(Duration::from_secs(5), done)
            .await
            .expect("the queued call never answered")
            .expect("the call task");
        assert_eq!(got, want, "{which:?}");
        // The fresh room hydrates from the blob.
        assert_eq!(
            (endpoint.loaded(), store.reads.load(Ordering::SeqCst)),
            (1, 2),
            "{which:?}: loads and reads"
        );
        assert_eq!(manager.live_room_count(), rooms, "{which:?}: live rooms");
        if matches!(which, Call::Edit) {
            // The edit lands on what the eviction flushed, not beside it.
            let doc = blok_yjs::Doc::new(blok_yjs::Options::default());
            for frame in store.frames("doc") {
                doc.apply_update(&frame).expect("a frame applies");
            }
            let notes = doc.get_map("notes").expect("a map root");
            let blocks = doc.get_map("blocks").expect("a blocks root");
            assert_eq!(
                (notes.keys(), blocks.keys()),
                (vec![Str::from("k")], vec![Str::from("c")]),
                "the working set after the edit"
            );
        }
    }
}

/// Opens real journal sessions whose appends fail, so a write closes the
/// room as CommitUnavailable and starts the cooldown.
struct FailingAppends(Arc<dyn OperationStore>);

struct FailingSession(Arc<dyn OperationSession>);

impl OperationStore for FailingAppends {
    fn open<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
    ) -> BoxFuture<'a, Result<Opened, Error>> {
        Box::pin(async move {
            let (outcome, session) = self.0.open(ctx, doc_id).await?;
            Ok((
                outcome,
                session.map(|s| Arc::new(FailingSession(s)) as Arc<dyn OperationSession>),
            ))
        })
    }
    fn type_name(&self) -> &'static str {
        "room.failingAppends"
    }
}

impl OperationSession for FailingSession {
    fn open_result(&self) -> &OpenResult {
        self.0.open_result()
    }
    fn find_committed<'a>(
        &'a self,
        ctx: &'a Context,
        operation_id: &'a str,
        digest: &'a [u8],
    ) -> BoxFuture<'a, Result<Lookup, Error>> {
        self.0.find_committed(ctx, operation_id, digest)
    }
    fn append<'a>(
        &'a self,
        _ctx: &'a Context,
        _candidate: Candidate,
    ) -> BoxFuture<'a, Result<AppendResult, Error>> {
        Box::pin(async { Err(Error::message("the disk is gone")) })
    }
    fn write_checkpoint<'a>(
        &'a self,
        ctx: &'a Context,
        checkpoint: Checkpoint,
    ) -> BoxFuture<'a, Result<(), Error>> {
        self.0.write_checkpoint(ctx, checkpoint)
    }
    fn reset<'a>(&'a self, ctx: &'a Context, reset: Reset) -> BoxFuture<'a, Result<Head, Error>> {
        self.0.reset(ctx, reset)
    }
    fn close(&self) -> BoxFuture<'_, Result<(), Error>> {
        self.0.close()
    }
}

// G1 check order (CollabRoomManager.cs:264-283): purging, then draining,
// then the cooldown. Join, edit and state each carry their own copy.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn every_door_checks_purging_then_draining_then_the_cooldown() {
    for door in [Call::Join, Call::Edit, Call::State] {
        // Draining beats the cooldown.
        let (journal, _dir) = open_journal();
        let (manager, _, _) =
            test_manager(Options::default(), Some(Arc::new(FailingAppends(journal))));
        let membership = join(&manager, "doc", &FakeMember::v1(true)).await;
        let _ = membership
            .receive(sync_frame(Message::SyncUpdate {
                update: client_update(9, "k"),
            }))
            .await;
        wait_until("the room to close on the failed append", || {
            manager.live_room_count() == 0
        })
        .await;
        assert_eq!(
            call(&manager, door).await,
            "Unavailable",
            "{door:?} in the cooldown"
        );
        manager.drain().await.expect("drain");
        assert_eq!(
            call(&manager, door).await,
            "Draining",
            "{door:?} draining in the cooldown"
        );

        // Purging beats draining.
        let (manager, _, _) = test_manager(Options::default(), None);
        manager
            .purge("doc", async { Ok(true) })
            .await
            .expect("purge");
        manager.drain().await.expect("drain");
        assert_eq!(
            call(&manager, door).await,
            "Purged",
            "{door:?} purged and draining"
        );
    }
}

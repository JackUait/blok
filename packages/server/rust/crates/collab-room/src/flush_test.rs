use std::sync::Arc;
use std::sync::atomic::Ordering;

use blok_collab::CloseReason;
use blok_collab_wire::Message;

use crate::test_support::*;
use crate::*;

struct FlushRoom {
    manager: Manager,
    store: Arc<MemoryStore>,
    logs: Logs,
}

fn flush_room() -> FlushRoom {
    let store = MemoryStore::new();
    let logs = Logs::default();
    let manager = Manager::new(ManagerOptions {
        store: store.clone(),
        endpoint: FakeEndpoint::null(),
        converter: Arc::new(real_converter()),
        room: Options {
            export_debounce: HOUR,
            export_max_delay: HOUR,
            retry_backoff: ms(5),
            retry_backoff_cap: ms(5),
            eviction_linger: ms(5),
            ..Options::default()
        },
        log: Some(logs.log()),
        operations: None,
        activity: None,
    });
    FlushRoom {
        manager,
        store,
        logs,
    }
}

impl FlushRoom {
    async fn edit(&self, member: &Arc<FakeMember>) -> Joined {
        let membership = join(&self.manager, "doc", member).await;
        // Two frames, so the flush compacts and owes the store a write.
        for (i, key) in ["k", "l"].iter().enumerate() {
            receive(
                &membership,
                Message::SyncUpdate {
                    update: client_update(9 + i as u32, key),
                },
            )
            .await;
        }
        self.manager.settle().await;
        membership
    }
}

// The room's own flush failures never reach the caller: in C# only a
// cancelled room lifetime escapes FlushLocked, and a closed room never
// flushes. So a failing store logs "could not flush the working set", and
// never the callers' "could not flush before eviction/while draining".
// Twin of C# AStoreTimeoutDuringTheEvictionFlushIsAFailureNotAShutdown.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_store_timeout_during_the_eviction_flush_is_a_failure_not_a_shutdown() {
    let f = flush_room();
    let membership = f.edit(&FakeMember::v1(true)).await;
    f.store.timing_out.store(true, Ordering::SeqCst);
    membership.leave();

    wait_until("the eviction flush to fail", || {
        f.logs.logged("could not flush the working set")
    })
    .await;
    assert_eq!(
        f.manager.live_room_count(),
        1,
        "a room whose flush failed was unloaded"
    );
    assert!(
        !f.logs.logged("could not flush before eviction"),
        "a store failure escaped the flush"
    );

    f.store.timing_out.store(false, Ordering::SeqCst);
    wait_until("the room to unload once the store heals", || {
        f.manager.live_room_count() == 0
    })
    .await;
    assert!(
        f.store
            .peek("doc")
            .is_some_and(|set| !set.updates.is_empty()),
        "the healed eviction wrote no working set"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_store_failure_while_draining_still_closes_every_member() {
    let f = flush_room();
    let member = FakeMember::v1(true);
    f.edit(&member).await;
    f.store.timing_out.store(true, Ordering::SeqCst);

    f.manager.drain().await.expect("drain");
    assert!(
        f.logs.logged(&format!(
            "could not flush the working set: {}",
            Error::DeadlineExceeded
        )),
        "log = {:?}",
        f.logs.lines()
    );
    assert!(
        !f.logs.logged("could not flush while draining"),
        "a store failure escaped the flush"
    );
    assert_eq!(member.closed(), [CloseReason::Draining]);
    assert_eq!(
        f.manager.live_room_count(),
        0,
        "the drained room stayed loaded"
    );
}

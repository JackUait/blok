use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use blok_collab::{BoxFuture, CloseReason, JoinStatus, OperationSource};
use blok_collab_wire::Message;

use crate::test_support::*;
use crate::*;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_joiner_gets_control_limits_and_identities_and_the_others_are_asked() {
    let (manager, _, _) = test_manager(
        Options {
            announced_max_message_bytes: 1 << 20,
            ..Options::default()
        },
        None,
    );
    let first = FakeMember::v1(true);
    join(&manager, "doc", &first).await;
    let second = FakeMember::v1(true);
    join(&manager, "doc", &second).await;
    manager.settle().await;

    let got = second.messages();
    assert_eq!(got.len(), 3, "the joiner's frames: {got:?}");
    assert!(
        matches!(got[0], Message::BlokControl { .. }),
        "first frame {:?}",
        got[0]
    );
    assert!(
        matches!(got[1], Message::BlokLimits { max_message_bytes } if max_message_bytes == 1 << 20),
        "second frame {:?}",
        got[1]
    );
    assert!(
        matches!(&got[2], Message::Identities { identities } if identities.is_empty()),
        "third frame {:?}",
        got[2]
    );
    let others = first.messages();
    assert!(
        matches!(others.last(), Some(Message::QueryAwareness)),
        "the member already in the room got {:?} last",
        others.last()
    );
}

// Many members write and leave at once; the lane is the only door to the
// doc, and every write reaches every member still in the room.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_writers_all_converge_through_the_lane() {
    let (manager, _, _) = test_manager(Options::default(), None);
    const WRITERS: usize = 8;
    let mut members = Vec::new();
    let mut memberships = Vec::new();
    for _ in 0..WRITERS {
        let member = FakeMember::v1(true);
        memberships.push(Arc::new(join(&manager, "doc", &member).await));
        members.push(member);
    }
    let mut writes = Vec::new();
    for (i, membership) in memberships.iter().enumerate() {
        let membership = membership.clone();
        writes.push(tokio::spawn(async move {
            let key = char::from(b'a' + i as u8).to_string();
            let update = client_update(100 + i as u32, &key);
            membership
                .receive(sync_frame(Message::SyncUpdate { update }))
                .await
                .expect("receive");
        }));
    }
    for write in writes {
        write.await.expect("a writer");
    }
    manager.settle().await;
    for (i, member) in members.iter().enumerate() {
        let updates = member
            .messages()
            .iter()
            .filter(|m| matches!(m, Message::SyncUpdate { .. }))
            .count();
        // v1 relays to the others only.
        assert_eq!(updates, WRITERS - 1, "member {i}");
    }
    let state = manager.state("doc").await.expect("state");
    assert_eq!(state.status, StateStatus::Ready);
    for membership in memberships {
        membership.leave();
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn drain_flushes_then_closes_every_member1001_and_refuses_new_joins() {
    let (manager, store, endpoint) = test_manager(
        Options {
            export_debounce: HOUR,
            export_max_delay: HOUR,
            ..Options::default()
        },
        None,
    );
    let member = FakeMember::v1(true);
    let membership = join(&manager, "doc", &member).await;
    receive(
        &membership,
        Message::SyncUpdate {
            update: client_update(9, "k"),
        },
    )
    .await;
    manager.drain().await.expect("drain");
    assert_eq!(member.closed(), [CloseReason::Draining]);
    assert_eq!(endpoint.saved(), 1, "the drain's PUTs");
    assert!(
        store.peek("doc").is_some_and(|set| !set.updates.is_empty()),
        "the drain left no working set"
    );
    let result = manager
        .join("doc", FakeMember::v1(false))
        .await
        .expect("join");
    assert_eq!(result.status, JoinStatus::Draining);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_empty_room_flushes_and_unloads_after_its_linger() {
    let (manager, _, endpoint) = test_manager(
        Options {
            eviction_linger: ms(20),
            export_debounce: HOUR,
            export_max_delay: HOUR,
            ..Options::default()
        },
        None,
    );
    let membership = join(&manager, "doc", &FakeMember::v1(true)).await;
    receive(
        &membership,
        Message::SyncUpdate {
            update: client_update(9, "k"),
        },
    )
    .await;
    membership.leave();
    wait_until("the empty room to unload after its linger", || {
        manager.live_room_count() == 0
    })
    .await;
    assert_eq!(endpoint.saved(), 1, "the eviction's PUTs");
}

// T11/T12: a v2 write is broadcast to everyone, the sender included, then
// acknowledged; an old lineage is refused before the id lookup.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_v2_operation_is_relayed_to_all_then_acknowledged() {
    let (journal, _dir) = open_journal();
    let (manager, _, _) = test_manager(Options::default(), Some(journal));
    let writer = FakeMember::new("alice", OperationSource::ClientV2, true);
    let membership = join(&manager, "doc", &writer).await;
    let other = FakeMember::v2();
    join(&manager, "doc", &other).await;
    receive(
        &membership,
        Message::SyncStep1 {
            state_vector: vec![0],
        },
    )
    .await;
    let lineage = control_tag(&writer).lineage;
    let update = client_update(9, "k");
    let operation_id = "0123456789abcdef0123456789abcdef";
    receive(
        &membership,
        Message::Operation {
            lineage: lineage.clone(),
            operation_id: operation_id.to_owned(),
            update: update.clone(),
        },
    )
    .await;
    let stale = "ffffffffffffffffffffffffffffffff";
    receive(
        &membership,
        Message::Operation {
            lineage: stale.to_owned(),
            operation_id: operation_id.to_owned(),
            update: update.clone(),
        },
    )
    .await;
    let got = writer.messages();
    let tail = &got[got.len() - 3..];
    assert_eq!(
        tail[0],
        Message::SyncUpdate {
            update: update.clone()
        },
        "the writer's frame after its commit"
    );
    assert_eq!(
        tail[1],
        Message::Acknowledgement {
            lineage: lineage.clone(),
            operation_id: operation_id.to_owned(),
            server_sequence: 1
        }
    );
    assert!(
        matches!(&tail[2], Message::Rejection { code, lineage, .. } if code == "lineage-mismatch" && lineage == stale),
        "then {:?}",
        tail[2]
    );
    assert!(
        other.messages().contains(&Message::SyncUpdate { update }),
        "the other member never got the committed update"
    );
}

#[derive(Default)]
struct RecordingObserver {
    kinds: Mutex<Vec<ActivityKind>>,
}

impl ActivityObserver for RecordingObserver {
    fn record<'a>(
        &'a self,
        _doc: &'a str,
        _actor: &'a str,
        _at: SystemTime,
        kind: ActivityKind,
    ) -> BoxFuture<'a, Result<(), Error>> {
        lock(&self.kinds).push(kind);
        Box::pin(async {
            Err(Error::message(
                "an observer that fails must not close the room",
            ))
        })
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn activity_reports_joined_active_once_in_the_window_and_left() {
    let observer = Arc::new(RecordingObserver::default());
    let manager = Manager::new(ManagerOptions {
        store: MemoryStore::new(),
        endpoint: FakeEndpoint::null(),
        converter: Arc::new(real_converter()),
        room: Options::default(),
        log: None,
        operations: None,
        activity: Some(observer.clone()),
        notes: None,
    });
    let membership = join(
        &manager,
        "doc",
        &FakeMember::new("alice", OperationSource::ClientV1, false),
    )
    .await;
    join(&manager, "doc", &FakeMember::v1(false)).await;
    for _ in 0..3 {
        receive(&membership, Message::Activity).await;
    }
    membership.leave();
    manager.settle().await;
    let got = lock(&observer.kinds).clone();
    // The anonymous member reports nothing.
    assert_eq!(
        got,
        [
            ActivityKind::Joined,
            ActivityKind::Active,
            ActivityKind::Left
        ]
    );
    manager.drain().await.expect("drain");
}

// Twins of RecheckExpelsOnlyRevokedMembersWithoutResettingTheRoom and
// ARecheckThatThrowsExpelsTheMember (M32, G12): a revoked or failing check
// closes 4403, the others stay, the room keeps its tag, and the expelled
// member's queued write never lands.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn recheck_expels_only_revoked_members_without_resetting_the_room() {
    let (manager, store, _) = test_manager(
        Options {
            export_debounce: HOUR,
            export_max_delay: HOUR,
            ..Options::default()
        },
        None,
    );
    let revoked = FakeMember::v1(true);
    let failing = FakeMember::v1(true);
    let allowed = FakeMember::v1(true);
    let revoked_membership = join(&manager, "doc", &revoked).await;
    join(&manager, "doc", &failing).await;
    join(&manager, "doc", &allowed).await;
    let set = store.peek("doc").expect("a seeded working set");
    revoked.revoke(None);
    failing.revoke(Some("policy failed"));

    assert_eq!(manager.recheck_access("doc").await.expect("recheck"), 2);
    for member in [&revoked, &failing] {
        assert_eq!(member.closed(), [CloseReason::Forbidden]);
    }
    assert!(allowed.closed().is_empty(), "the allowed member was closed");
    assert_eq!(
        store.peek("doc").expect("the working set").tag,
        set.tag,
        "the recheck changed the room's tag"
    );
    assert_eq!(
        manager.recheck_access("doc-absent").await.expect("recheck"),
        0
    );
    let _ = revoked_membership
        .receive(sync_frame(Message::SyncUpdate {
            update: client_update(9, "stolen"),
        }))
        .await;
    manager.settle().await;
    assert!(
        !allowed
            .messages()
            .iter()
            .any(|m| matches!(m, Message::SyncUpdate { .. })),
        "the expelled member's write was relayed"
    );
}

use crate::test_support::*;
use crate::*;

// Twins of the C# CollabRoomTests version-handle cases (load.rs
// start_version_read_locked / apply_version_locked /
// settle_version_locked). Room timers run on wall time here, so the C#
// defaults are shortened.

/// A journal with a head, and an endpoint whose next GET hangs until the
/// gate opens (C# AReloadedRoomWhoseVersionReadIsStuck).
async fn reloaded_room_whose_version_read_is_stuck(r: &TextRoom, o: Options) -> (Manager, Gate) {
    r.endpoint.holds(TEST_DOC, "hello", Some("v1"));
    let first = r.manager(o.clone(), true);
    let member = FakeMember::v2();
    let membership = join_synced(&first, TEST_DOC, &member).await;
    let client = synced_client(&first, TEST_DOC, "hello").await;
    send_operation(
        &membership,
        &member,
        OP_ONE,
        update_appending(&client, " world"),
    )
    .await;
    first.drain().await.expect("drain");
    r.endpoint.holds(TEST_DOC, "hello world", Some("v2"));
    let gate = Gate::new();
    r.endpoint.set_load_gate(Some(gate.clone()));
    (r.manager(o, true), gate)
}

fn last_version(r: &TextRoom) -> String {
    let saves = r.endpoint.saves();
    version_of(saves.last().expect("a save")).to_owned()
}

// A PUT built while the load-time read is in flight would carry no
// version, so the checkpoint's projection waits it out.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_checkpoint_projection_waits_for_a_version_read_still_in_flight() {
    let r = TextRoom::new();
    let (manager, gate) =
        reloaded_room_whose_version_read_is_stuck(&r, version_options(ms(5000))).await;
    let member = FakeMember::v2();
    let membership = join_synced(&manager, TEST_DOC, &member).await;
    let client = synced_client(&manager, TEST_DOC, "hello world").await;
    send_operation(&membership, &member, OP_TWO, update_appending(&client, "!")).await;
    let before = r.endpoint.saves().len();

    assert!(manager.checkpoint(TEST_DOC).await.expect("checkpoint"));
    tokio::time::sleep(ms(50)).await;
    gate.open();
    wait_until("the checkpoint's projection", || {
        r.endpoint.saves().len() > before
    })
    .await;

    assert_eq!(last_version(&r), "v2");
}

// A read the settle gave up on must never land over a newer handle the
// consumer answered the bare PUT with.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_version_read_the_settle_gave_up_on_cannot_land_over_a_newer_handle() {
    let r = TextRoom::new();
    let (manager, gate) =
        reloaded_room_whose_version_read_is_stuck(&r, version_options(ms(50))).await;
    let member = FakeMember::v2();
    let membership = join_synced(&manager, TEST_DOC, &member).await;
    let client = synced_client(&manager, TEST_DOC, "hello world").await;
    send_operation(&membership, &member, OP_TWO, update_appending(&client, "!")).await;
    let before = r.endpoint.saves().len();

    r.endpoint.set_next_save_version(Some("v5"));
    assert!(manager.checkpoint(TEST_DOC).await.expect("checkpoint"));
    wait_until("the projection the settle gave up waiting for", || {
        r.endpoint.saves().len() > before
    })
    .await;
    // The premise: the settle gave up, so that PUT went bare.
    assert_eq!(
        last_version(&r),
        "<nil>",
        "the abandoned PUT carried a version"
    );

    gate.open();
    for _ in 0..5 {
        tokio::time::sleep(ms(10)).await;
        manager.settle().await;
    }
    send_operation(
        &membership,
        &member,
        OP_THREE,
        update_appending(&client, "?"),
    )
    .await;
    assert!(
        manager
            .checkpoint(TEST_DOC)
            .await
            .expect("second checkpoint")
    );
    let second = r.endpoint.saves().len();
    wait_until("the next projection", || r.endpoint.saves().len() > second).await;

    assert_eq!(last_version(&r), "v5");
}

// The same race on the drain's PUT.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_drain_projection_waits_for_a_version_read_still_in_flight() {
    let r = TextRoom::new();
    let (manager, gate) =
        reloaded_room_whose_version_read_is_stuck(&r, version_options(ms(5000))).await;
    let member = FakeMember::v2();
    let membership = join_synced(&manager, TEST_DOC, &member).await;
    let client = synced_client(&manager, TEST_DOC, "hello world").await;
    send_operation(&membership, &member, OP_TWO, update_appending(&client, "!")).await;

    let draining = manager.clone();
    let drained = tokio::spawn(async move { draining.drain().await });
    tokio::time::sleep(ms(50)).await;
    gate.open();
    drained.await.expect("the drain task").expect("drain");

    assert_eq!(last_version(&r), "v2");
}

/// Leaves and waits for the idle room to be evicted.
async fn leave_and_evict(manager: &Manager, membership: Joined, what: &str) {
    membership.leave();
    wait_until(what, || manager.live_room_count() == 0).await;
}

// The version is captured when the room starts diverging from the record,
// not when it builds a PUT: read then, it would be the host's own save's
// version, and the write-back would land over that save.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_version_is_captured_at_load_so_a_host_save_afterwards_still_refuses_the_write_back() {
    let r = TextRoom::new();
    r.endpoint.holds(TEST_DOC, "hello", Some("v1"));
    let manager = r.manager(version_options(ms(5000)), true);
    let member = FakeMember::v2();
    let first = join_synced(&manager, TEST_DOC, &member).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    send_operation(&first, &member, OP_ONE, update_appending(&client, " world")).await;
    leave_and_evict(&manager, first, "the seeded room to be evicted").await;

    // The room reloads while the consumer's record is at v2 ...
    r.endpoint.holds(TEST_DOC, "hello world", Some("v2"));
    let loads = r.endpoint.loaded();
    let next_member = FakeMember::v2();
    let second = join_synced(&manager, TEST_DOC, &next_member).await;
    // The version GET runs beside the load: wait for it, or the host's save
    // below can land first.
    wait_until("the reloaded room's version read", || {
        r.endpoint.loaded() > loads
    })
    .await;
    let next = synced_client(&manager, TEST_DOC, "hello world").await;
    send_operation(&second, &next_member, OP_TWO, update_appending(&next, "!")).await;

    // ... and the host saves after that, moving its record on to v3.
    r.endpoint.holds(TEST_DOC, "host wins", Some("v3"));
    leave_and_evict(&manager, second, "the reloaded room to be evicted").await;

    assert_eq!(last_version(&r), "v2");
}

// A room loaded from the journal never seeded, so only the version read
// gives its write-back a version.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_reloaded_journal_room_still_carries_the_document_version() {
    let r = TextRoom::new();
    r.endpoint.holds(TEST_DOC, "hello", Some("v1"));
    let manager = r.manager(version_options(ms(5000)), true);
    let member = FakeMember::v2();
    let first = join_synced(&manager, TEST_DOC, &member).await;
    let client = synced_client(&manager, TEST_DOC, "hello").await;
    send_operation(&first, &member, OP_ONE, update_appending(&client, " world")).await;
    leave_and_evict(&manager, first, "the seeded room to be evicted").await;

    // The host saved meanwhile, so its record moved to v2.
    r.endpoint.holds(TEST_DOC, "hello world", Some("v2"));
    let next_member = FakeMember::v2();
    let second = join_synced(&manager, TEST_DOC, &next_member).await;
    let next = synced_client(&manager, TEST_DOC, "hello world").await;
    send_operation(&second, &next_member, OP_TWO, update_appending(&next, "!")).await;
    leave_and_evict(&manager, second, "the reloaded room to be evicted").await;

    let saves = r.endpoint.saves();
    assert_eq!(
        version_of(saves.last().expect("a save")),
        "v2",
        "the reloaded write-back"
    );
    assert_eq!(version_of(&saves[0]), "v1", "the first write-back");
}

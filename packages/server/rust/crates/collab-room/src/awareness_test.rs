use std::sync::Arc;

use blok_collab::OperationSource;
use blok_collab_wire::{Identity, Message};
use blok_lib0::Writer;

use crate::test_support::*;
use crate::*;

// Twins of the C# CollabRoomTests awareness ownership and identities cases
// (M12, M13): who owns a presence client id, what a leave withdraws, and
// which frame 107 every member sees. A leave runs beside its caller here,
// so each one is followed by a settle.

struct AwarenessRoom {
    manager: Manager,
    logs: Logs,
}

impl AwarenessRoom {
    fn new(mut o: Options) -> AwarenessRoom {
        let logs = Logs::default();
        o.export_debounce = HOUR;
        o.export_max_delay = HOUR;
        let manager = Manager::new(ManagerOptions {
            store: MemoryStore::new(),
            endpoint: FakeEndpoint::null(),
            converter: Arc::new(real_converter()),
            room: o,
            log: Some(logs.log()),
            operations: None,
            activity: None,
            notes: None,
        });
        AwarenessRoom { manager, logs }
    }

    async fn join(&self, actor: &str) -> (Arc<FakeMember>, Joined) {
        let member = FakeMember::new(actor, OperationSource::ClientV1, true);
        let membership = join(&self.manager, "doc", &member).await;
        (member, membership)
    }

    async fn send(&self, membership: &Joined, payload: Vec<u8>) {
        receive(membership, Message::Awareness { update: payload }).await;
    }

    async fn leave(&self, membership: Joined) {
        membership.leave();
        self.manager.settle().await;
    }
}

fn awareness_for(client: u64, clock: u64, state: &str) -> Vec<u8> {
    let mut w = Writer::new();
    w.write_var_uint(1);
    w.write_var_uint(client);
    w.write_var_uint(clock);
    w.write_var_uint(state.len() as u64);
    let mut out = w.into_bytes();
    out.extend_from_slice(state.as_bytes());
    out
}

fn awareness_for_both(first: [u64; 2], second: [u64; 2]) -> Vec<u8> {
    let mut w = Writer::new();
    w.write_var_uint(2);
    for entry in [first, second] {
        w.write_var_uint(entry[0]);
        w.write_var_uint(entry[1]);
        w.write_uint8(2);
        w.write_uint8(b'{');
        w.write_uint8(b'}');
    }
    w.into_bytes()
}

fn identities_frames(m: &FakeMember) -> Vec<Vec<Identity>> {
    m.messages()
        .into_iter()
        .filter_map(|m| match m {
            Message::Identities { identities } => Some(identities),
            _ => None,
        })
        .collect()
}

fn awareness_frames(m: &FakeMember) -> Vec<Vec<u8>> {
    m.messages()
        .into_iter()
        .filter_map(|m| match m {
            Message::Awareness { update } => Some(update),
            _ => None,
        })
        .collect()
}

fn only_identities(m: &FakeMember) -> Vec<Identity> {
    let mut frames = identities_frames(m);
    assert_eq!(frames.len(), 1, "identities frames: {frames:?}");
    frames.remove(0)
}

fn id(client: u64, actor: &str) -> Identity {
    Identity {
        client_id: client,
        actor_id: actor.to_owned(),
    }
}

fn expect_withdrawal(m: &FakeMember, want: Vec<u8>) {
    assert_eq!(awareness_frames(m), [want], "awareness frames");
}

fn expect_nothing(m: &FakeMember) {
    let messages = m.messages();
    assert!(messages.is_empty(), "got frames, want none: {messages:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn withdraws_the_clients_of_a_member_that_left_without_saying_goodbye() {
    let a = AwarenessRoom::new(Options::default());
    let (_, leaver) = a.join("").await;
    let (other, _keep) = a.join("").await;
    a.send(&leaver, awareness_for(42, 3, "{}")).await;
    other.clear();

    a.leave(leaver).await;

    expect_withdrawal(&other, awareness_for(42, 3, "null"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn withdraws_nothing_for_a_member_that_never_published_presence() {
    let a = AwarenessRoom::new(Options::default());
    let (_, leaver) = a.join("").await;
    let (other, _keep) = a.join("").await;
    other.clear();

    a.leave(leaver).await;

    expect_nothing(&other);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn does_not_withdraw_a_client_a_member_only_relayed() {
    let a = AwarenessRoom::new(Options::default());
    let (_, owner) = a.join("").await;
    let (_, relay) = a.join("").await;
    let (other, _keep) = a.join("").await;
    a.send(&owner, awareness_for(42, 3, "{}")).await;
    a.send(&relay, awareness_for(42, 3, "{}")).await;
    other.clear();

    a.leave(relay).await;

    expect_nothing(&other);
    drop(owner);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn does_not_claim_a_client_first_seen_inside_a_replay_of_the_room() {
    let a = AwarenessRoom::new(Options::default());
    let (_, owner) = a.join("").await;
    let (_, replay) = a.join("").await;
    let (other, _keep) = a.join("").await;
    a.send(&replay, awareness_for_both([7, 1], [42, 3])).await;
    a.send(&owner, awareness_for(42, 3, "{}")).await;
    other.clear();

    a.leave(replay).await;
    expect_nothing(&other);

    a.leave(owner).await;
    expect_withdrawal(&other, awareness_for(42, 3, "null"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn withdraws_nothing_twice_when_the_client_said_goodbye_itself() {
    let a = AwarenessRoom::new(Options::default());
    let (_, leaver) = a.join("").await;
    let (other, _keep) = a.join("").await;
    a.send(&leaver, awareness_for(42, 3, "{}")).await;
    a.send(&leaver, awareness_for(42, 3, "null")).await;
    other.clear();

    a.leave(leaver).await;

    expect_nothing(&other);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_joining_member_receives_the_full_verified_identities_map() {
    let a = AwarenessRoom::new(Options::default());
    let (_, named) = a.join("user-1").await;
    a.send(&named, awareness_for(42, 3, "{}")).await;

    let (joiner, _) = a.join("user-2").await;

    assert_eq!(only_identities(&joiner), [id(42, "user-1")]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_with_no_verified_identity_appears_in_no_identities_entry() {
    let a = AwarenessRoom::new(Options::default());
    let (anonymous, anonymous_membership) = a.join("").await;
    a.send(&anonymous_membership, awareness_for(42, 3, "{}"))
        .await;
    let (_, named) = a.join("user-1").await;
    a.send(&named, awareness_for(43, 3, "{}")).await;

    let (joiner, _) = a.join("user-2").await;

    assert_eq!(only_identities(&joiner), [id(43, "user-1")]);
    assert!(
        anonymous.closed().is_empty(),
        "the anonymous member was closed"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn binding_a_new_client_id_broadcasts_the_whole_map_to_everyone_including_the_sender() {
    let a = AwarenessRoom::new(Options::default());
    let (named, membership) = a.join("user-1").await;
    let (other, _) = a.join("").await;
    named.clear();
    other.clear();

    a.send(&membership, awareness_for(42, 3, "{}")).await;

    let want = [id(42, "user-1")];
    assert_eq!(only_identities(&named), want, "the sender saw");
    assert_eq!(only_identities(&other), want, "the other saw");
    assert_eq!(
        named.messages().len(),
        1,
        "the sender got its own awareness back"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_anonymous_bind_broadcasts_no_identities_frame() {
    let a = AwarenessRoom::new(Options::default());
    let (_, membership) = a.join("").await;
    let (observer, _) = a.join("").await;
    observer.clear();

    a.send(&membership, awareness_for(42, 3, "{}")).await;

    assert!(identities_frames(&observer).is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_ownership_transfer_from_anonymous_to_verified_broadcasts_the_change() {
    let a = AwarenessRoom::new(Options::default());
    let (_, anonymous) = a.join("").await;
    a.send(&anonymous, awareness_for(42, 1, "{}")).await;
    let (_, verified) = a.join("user-1").await;
    let (observer, _) = a.join("").await;
    observer.clear();

    a.send(&verified, awareness_for(42, 2, "{}")).await;

    assert_eq!(only_identities(&observer), [id(42, "user-1")]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn leaving_broadcasts_the_remaining_map_without_the_client_ids_it_owned() {
    let a = AwarenessRoom::new(Options::default());
    let (_, staying) = a.join("user-1").await;
    let (_, leaving) = a.join("user-2").await;
    let (observer, _) = a.join("").await;
    a.send(&staying, awareness_for(10, 1, "{}")).await;
    a.send(&leaving, awareness_for(20, 1, "{}")).await;
    observer.clear();

    a.leave(leaving).await;

    assert_eq!(only_identities(&observer), [id(10, "user-1")]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_anonymous_member_leaving_broadcasts_no_identities_frame() {
    let a = AwarenessRoom::new(Options::default());
    let (_, leaving) = a.join("").await;
    let (observer, _) = a.join("").await;
    a.send(&leaving, awareness_for(42, 3, "{}")).await;
    observer.clear();

    a.leave(leaving).await;

    assert!(identities_frames(&observer).is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_awareness_client_id_past_the_safe_integer_ceiling_is_never_mapped() {
    let a = AwarenessRoom::new(Options::default());
    let (_, membership) = a.join("user-1").await;
    let (observer, _) = a.join("").await;
    observer.clear();

    a.send(&membership, awareness_for(1 << 53, 1, "{}")).await;

    assert!(identities_frames(&observer).is_empty());
    assert_eq!(
        awareness_frames(&observer).len(),
        1,
        "the frame was not relayed"
    );
    assert!(
        a.logs.logged("past the safe-integer ceiling"),
        "nothing was logged"
    );
    let (joiner, _) = a.join("").await;
    assert!(only_identities(&joiner).is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_frame_of_fabricated_client_ids_is_logged_once_per_frame_with_its_count() {
    let a = AwarenessRoom::new(Options::default());
    let (_, membership) = a.join("user-1").await;

    a.send(
        &membership,
        awareness_for_both([1 << 53, 1], [(1 << 53) + 1, 1]),
    )
    .await;

    let lines = a.logs.matching("safe-integer ceiling");
    assert_eq!(lines.len(), 1, "logged {lines:?}");
    assert!(
        lines[0].contains("ignored 2 awareness client id"),
        "logged {lines:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_largest_safe_awareness_client_id_still_binds() {
    let a = AwarenessRoom::new(Options::default());
    let (_, membership) = a.join("user-1").await;

    a.send(&membership, awareness_for((1 << 53) - 1, 1, "{}"))
        .await;

    let (joiner, _) = a.join("").await;
    assert_eq!(only_identities(&joiner), [id((1 << 53) - 1, "user-1")]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_relayed_frame_transferring_two_client_ids_broadcasts_identities_once() {
    let a = AwarenessRoom::new(Options::default());
    let (_, first) = a.join("user-1").await;
    a.send(&first, awareness_for(1, 1, "{}")).await;
    a.send(&first, awareness_for(2, 1, "{}")).await;
    let (_, second) = a.join("user-2").await;
    let (observer, _) = a.join("").await;
    observer.clear();

    a.send(&second, awareness_for_both([1, 2], [2, 2])).await;

    let mut got = only_identities(&observer);
    got.sort_by_key(|i| i.client_id);
    assert_eq!(got, [id(1, "user-2"), id(2, "user-2")]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_identities_frame_never_exceeds_the_awareness_client_cap() {
    let a = AwarenessRoom::new(Options {
        max_awareness_clients: 2,
        ..Options::default()
    });
    let (_, first) = a.join("user-1").await;
    let (_, second) = a.join("user-2").await;
    let (_, third) = a.join("user-3").await;
    a.send(&first, awareness_for(1, 1, "{}")).await;
    a.send(&second, awareness_for(2, 1, "{}")).await;
    a.send(&third, awareness_for(3, 1, "{}")).await;

    let (joiner, _) = a.join("").await;

    assert_eq!(only_identities(&joiner).len(), 2);
}

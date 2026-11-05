use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use blok_collab::{BoxFuture, CloseReason, Member};
use blok_ws::MessageType;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::*;
use crate::test_support::*;

fn new_test_member(max_queued_bytes: i64) -> SocketMember {
    SocketMember::new(MemberOptions {
        can_write: true,
        accepts_control_frames: true,
        max_queued_bytes,
        ..MemberOptions::default()
    })
}

#[test]
fn send_never_blocks_and_a_frame_fits_when_the_backlog_is_within_budget() {
    let member = new_test_member(10);
    member.send(vec![0; 8]);
    member.send(vec![0; 8]);
    assert_eq!(member.requested_close(), None);
}

#[test]
fn a_backlog_over_budget_closes_the_slow_consumer() {
    let member = new_test_member(10);
    member.send(vec![0; 8]);
    member.send(vec![0; 8]);
    member.send(vec![0; 1]);
    assert_eq!(member.requested_close(), Some(CLOSE_SLOW_CONSUMER));
}

#[test]
fn a_backlog_exactly_at_the_budget_still_admits_the_next_frame() {
    let member = new_test_member(10);
    member.send(vec![0; 10]);
    member.send(vec![0; 1]);
    assert_eq!(
        member.requested_close(),
        None,
        "closed with the backlog at the budget"
    );
    member.send(vec![0; 1]);
    assert_eq!(member.requested_close(), Some(CLOSE_SLOW_CONSUMER));
}

#[test]
fn the_first_non_forbidden_close_wins() {
    let reset = new_test_member(10);
    reset.close(CloseReason::Reset);
    reset.close(CloseReason::Draining);
    assert_eq!(
        reset.requested_close(),
        Some(CloseFrame::new(4409, "document reset"))
    );
    let forbidden = new_test_member(10);
    forbidden.close(CloseReason::Draining);
    forbidden.close(CloseReason::Forbidden);
    forbidden.close(CloseReason::Reset);
    assert_eq!(
        forbidden.requested_close(),
        Some(CLOSE_FORBIDDEN),
        "forbidden must overtake"
    );
}

/// Records what the pump sends; receive answers the peer's close.
#[derive(Default)]
struct FakeSocket {
    sent: Mutex<Vec<Vec<u8>>>,
    closes: Mutex<Vec<CloseFrame>>,
}

impl Socket for FakeSocket {
    fn receive<'a>(&'a self, _buf: &'a mut [u8]) -> BoxFuture<'a, SocketResult<Receipt>> {
        Box::pin(async { Ok((0, MessageType::Close, true)) })
    }

    fn send_binary<'a>(&'a self, payload: &'a [u8]) -> BoxFuture<'a, SocketResult<()>> {
        self.sent.lock().unwrap().push(payload.to_vec());
        Box::pin(async { Ok(()) })
    }

    fn close_output<'a>(&'a self, status: u16, reason: &'a str) -> BoxFuture<'a, SocketResult<()>> {
        let frame = [CLOSE_NORMAL, CLOSE_FORBIDDEN, CLOSE_RESET]
            .into_iter()
            .find(|frame| frame.status == status && frame.reason == reason)
            .unwrap_or(CLOSE_INTERNAL);
        self.closes.lock().unwrap().push(frame);
        Box::pin(async { Ok(()) })
    }

    fn abort(&self) {}
}

#[tokio::test]
async fn revocation_overrides_a_queued_slow_consumer_close() {
    let member = SocketMember::new(MemberOptions {
        accepts_control_frames: true,
        max_queued_bytes: 1,
        ..MemberOptions::default()
    });
    member.send(vec![1]);
    member.send(vec![2]);
    member.send(vec![3]);
    let queued = member.requested_close();
    member.close(CloseReason::Forbidden);
    let socket = FakeSocket::default();
    member.run(&socket, None, 1024, None).await;
    assert!(
        socket.sent.lock().unwrap().is_empty(),
        "sent frames after a revocation"
    );
    assert_eq!(*socket.closes.lock().unwrap(), [CLOSE_FORBIDDEN]);
    assert_eq!(queued, Some(CLOSE_SLOW_CONSUMER));
}

#[tokio::test]
async fn queued_frames_go_out_before_a_non_forbidden_close() {
    let member = new_test_member(100);
    member.send(vec![1]);
    member.close(CloseReason::Reset);
    member.send(vec![2]);
    let socket = FakeSocket::default();
    member.run(&socket, None, 1024, None).await;
    assert_eq!(*socket.sent.lock().unwrap(), [vec![1u8]]);
    assert_eq!(*socket.closes.lock().unwrap(), [CLOSE_RESET]);
}

fn run_member(
    member: Arc<SocketMember>,
    server: blok_ws::Conn,
    membership: Option<Arc<RecordingMembership>>,
    lease: Option<Lease>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let shared = membership.map(SharedMembership);
        let handle = shared.as_ref().map(|m| m as &dyn blok_collab::Membership);
        member.run(&server, handle, 1 << 20, lease.as_ref()).await;
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_room_is_left_and_the_lease_freed_before_the_peer_close_is_answered() {
    let (server, mut client) = ws_pair().await;
    let table = Arc::new(ConnectionTable::new(0, 1));
    let lease = table.try_reserve("doc", "user:a");
    let membership = Arc::new(RecordingMembership::default());
    let member = Arc::new(new_test_member(1 << 20));
    let done = run_member(member, server, Some(Arc::clone(&membership)), lease);

    client
        .write_all(&client_frame(0x88, &[3, 232]))
        .await
        .unwrap();
    assert_eq!(read_close(&mut client).await, CLOSE_NORMAL);
    assert!(
        membership.has_left(),
        "the close was answered before the room was left"
    );
    assert!(
        table.try_reserve("doc", "user:a").is_some(),
        "the close was answered before the lease was freed"
    );
    done.await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_whole_binary_message_reaches_the_room_once() {
    let (server, mut client) = ws_pair().await;
    let membership = Arc::new(RecordingMembership::default());
    let done = run_member(
        Arc::new(new_test_member(1 << 20)),
        server,
        Some(Arc::clone(&membership)),
        None,
    );
    let mut message = client_frame(0x02, &[105]);
    message.extend(client_frame(0x00, &[]));
    message.extend(client_frame(0x80, &[1, 2]));
    message.extend(client_frame(0x88, &[3, 232]));
    client.write_all(&message).await.unwrap();
    read_close(&mut client).await;
    done.await.unwrap();
    assert_eq!(*membership.frames.lock().unwrap(), [vec![105u8, 1, 2]]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_peer_that_never_answers_our_close_is_aborted_after_the_grace() {
    let (server, mut client) = ws_pair().await;
    let member = Arc::new(SocketMember::new(MemberOptions {
        max_queued_bytes: 1,
        close_grace: Duration::from_millis(100),
        ..MemberOptions::default()
    }));
    member.request_close(CLOSE_MISSING_PASS);
    let started = Instant::now();
    let done = run_member(member, server, None, None);
    assert_eq!(read_close(&mut client).await, CLOSE_MISSING_PASS);
    let mut rest = [0u8; 1];
    let n = tokio::time::timeout(Duration::from_secs(5), client.read(&mut rest))
        .await
        .expect("never ended")
        .expect("after the close");
    assert_eq!(n, 0, "after the close: not EOF");
    done.await.unwrap();
    let elapsed = started.elapsed();
    assert!(
        elapsed >= Duration::from_millis(90) && elapsed <= Duration::from_secs(2),
        "ended after {elapsed:?}"
    );
}

#[tokio::test]
async fn recheck_with_no_hook_allows() {
    let answer = new_test_member(1).recheck_access().await;
    assert!(matches!(answer, Ok(true)), "got {answer:?}");
}

// A peer that vanishes with no close frame (a crash, a killed tab) must
// still leave the room, or its presence stays drawn on everyone else.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn withdraws_the_presence_of_a_connection_that_just_disappears() {
    let (server, client) = ws_pair().await;
    let membership = Arc::new(RecordingMembership::default());
    let done = run_member(
        Arc::new(new_test_member(1 << 20)),
        server,
        Some(Arc::clone(&membership)),
        None,
    );
    drop(client);
    tokio::time::timeout(Duration::from_secs(5), done)
        .await
        .expect("the member never ended")
        .unwrap();
    assert!(membership.has_left());
}

/// Holds each frame as a busy room lane would. Dropping the receive is how
/// a Rust caller cancels it.
#[derive(Default)]
struct WaitingMembership {
    entered: tokio::sync::Notify,
    cancelled: AtomicBool,
    applied: AtomicBool,
}

struct OnDrop<'a>(&'a WaitingMembership);

impl Drop for OnDrop<'_> {
    fn drop(&mut self) {
        if !self.0.applied.load(Ordering::SeqCst) {
            self.0.cancelled.store(true, Ordering::SeqCst);
        }
    }
}

impl blok_collab::Membership for WaitingMembership {
    fn receive(
        &self,
        _frame: Vec<u8>,
    ) -> blok_collab::BoxFuture<'_, Result<(), blok_collab::Error>> {
        Box::pin(async move {
            let _gone = OnDrop(self);
            self.entered.notify_one();
            tokio::time::sleep(Duration::from_secs(5)).await;
            self.applied.store(true, Ordering::SeqCst);
            Ok(())
        })
    }

    fn leave(&self) {}
}

// C# SyncSocketMember hands its receive token to the room: when the close
// grace runs out, a frame still waiting for the room lane is dropped.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_frame_waiting_on_the_room_is_cancelled_when_the_close_grace_ends() {
    let (server, mut client) = ws_pair().await;
    let membership = Arc::new(WaitingMembership::default());
    let member = Arc::new(SocketMember::new(MemberOptions {
        max_queued_bytes: 1 << 20,
        close_grace: Duration::from_millis(50),
        ..MemberOptions::default()
    }));
    let running = Arc::clone(&member);
    let held = Arc::clone(&membership);
    let done = tokio::spawn(async move {
        running
            .run(
                &server,
                Some(held.as_ref() as &dyn blok_collab::Membership),
                1 << 20,
                None,
            )
            .await;
    });
    let entered = membership.entered.notified();
    client.write_all(&client_frame(0x82, &[1])).await.unwrap();
    entered.await;

    member.close(CloseReason::Reset);

    tokio::time::timeout(Duration::from_secs(3), done)
        .await
        .expect("the member to end after the close grace")
        .unwrap();
    assert!(membership.cancelled.load(Ordering::SeqCst));
    assert!(!membership.applied.load(Ordering::SeqCst));
}

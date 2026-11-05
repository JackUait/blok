use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_auth::User;
use blok_collab::{CloseReason, JoinStatus, OperationSource};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::*;
use crate::test_support::*;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_ticket_user_is_the_principal_and_the_journal_actor() {
    let h = start_endpoint(ticket_mode, None).await;
    let offer = ticket_offer(&["blok-sync.v1", &write_ticket()]);
    let client = h.dial("/sync/doc-42", &pairs(&offer)).await;
    assert_eq!(client.status, 101);
    assert_eq!(client.header("Sec-WebSocket-Protocol"), "blok-sync.v1");
    let member = h.rooms.last_member();
    assert_eq!(member.actor_id(), "u1");
    assert!(member.can_write() && member.accepts_control_frames());
    assert_eq!(member.protocol_source(), OperationSource::ClientV1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_read_only_ticket_joins_as_a_read_only_member() {
    let h = start_endpoint(ticket_mode, None).await;
    let offer = ticket_offer(&["blok-sync.v1", &read_ticket()]);
    h.dial("/sync/doc-42", &pairs(&offer)).await;
    assert!(
        !h.rooms.last_member().can_write(),
        "a read-only pass joined as a writer"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn v2_is_selected_only_with_an_operation_store() {
    let ticket = write_ticket();
    let without = start_endpoint(ticket_mode, None).await;
    let offer = ticket_offer(&["blok-sync.v2", "blok-sync.v1", &ticket]);
    let got = without.dial("/sync/doc-42", &pairs(&offer)).await;
    assert_eq!(
        got.header("Sec-WebSocket-Protocol"),
        "blok-sync.v1",
        "without a store"
    );
    let offer = ticket_offer(&["blok-sync.v2", &ticket]);
    let got = without.dial("/sync/doc-42", &pairs(&offer)).await;
    assert_eq!(got.status, 400, "a v2-only offer with no store");

    let with = start_endpoint(
        |c| {
            c.auth = "ticket".into();
            c.has_operation_store = true;
        },
        None,
    )
    .await;
    let offer = ticket_offer(&["blok-sync.v1", "blok-sync.v2", &ticket]);
    let got = with.dial("/sync/doc-42", &pairs(&offer)).await;
    assert_eq!(
        got.header("Sec-WebSocket-Protocol"),
        "blok-sync.v2",
        "with a store"
    );
    assert_eq!(
        with.rooms.last_member().protocol_source(),
        OperationSource::ClientV2,
        "a v2 selection must carry the ClientV2 source"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_no_auth_connection_has_no_actor_and_no_principal() {
    let h = start_endpoint(
        |c| c.connections = Arc::new(ConnectionTable::new(0, 1)),
        None,
    )
    .await;
    let _first = h.dial("/sync/doc", &[]).await;
    let _second = h.dial("/sync/doc", &[]).await;
    assert_eq!(h.rooms.joins(), 2, "an anonymous connection was capped");
    let member = h.rooms.last_member();
    assert!(
        member.actor_id().is_empty() && !member.accepts_control_frames(),
        "an anonymous stock client got an actor or control frames"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_signed_in_user_is_capped_by_name_and_journalled_by_id() {
    let h = start_endpoint(
        |c| c.connections = Arc::new(ConnectionTable::new(0, 1)),
        Some(signed_in(User {
            id: "id-7".into(),
            name: "Ada".into(),
            authenticated: true,
            ..User::default()
        })),
    )
    .await;
    let _first = h.dial("/sync/doc", &[]).await;
    assert_eq!(
        h.rooms.last_member().actor_id(),
        "id-7",
        "want the stable id"
    );
    let second = h.dial("/sync/doc", &[]).await;
    assert_eq!(
        (second.status, second.body.as_str()),
        (429, "too many connections\n")
    );
}

#[tokio::test]
async fn a_signed_in_user_with_an_empty_name_is_capped_by_id() {
    let h = start_endpoint(
        |c| c.connections = Arc::new(ConnectionTable::new(0, 1)),
        Some(signed_in(User {
            id: "id-7".into(),
            authenticated: true,
            ..User::default()
        })),
    )
    .await;
    let _first = h.dial("/sync/doc", &[]).await;
    let second = h.dial("/sync/doc", &[]).await;
    assert_eq!(
        (second.status, second.body.as_str()),
        (429, "too many connections\n")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_hook_is_asked_with_the_tickets_claims() {
    let hook = FakeAuthorization::new(true, true, false);
    let shared = Arc::clone(&hook);
    let h = start_endpoint(
        move |c| {
            c.auth = "ticket".into();
            c.authorization = Some(shared);
        },
        None,
    )
    .await;
    let offer = ticket_offer(&["blok-sync.v1", &read_ticket()]);
    let _client = h.dial("/sync/doc-42", &pairs(&offer)).await;
    let want = User {
        id: "u1".into(),
        name: "u1".into(),
        doc: "doc-42".into(),
        write: false,
        authenticated: true,
    };
    assert_eq!(hook.calls(), [want]);
}

fn with_hook(hook: &Arc<FakeAuthorization>) -> impl FnOnce(&mut Config) + use<> {
    let shared = Arc::clone(hook);
    move |c: &mut Config| {
        c.auth = "ticket".into();
        c.authorization = Some(shared);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_denied_read_is_accepted_then_closed4403() {
    let hook = FakeAuthorization::new(false, false, false);
    let h = start_endpoint(with_hook(&hook), None).await;
    let offer = ticket_offer(&["blok-sync.v1", &write_ticket()]);
    let mut client = h.dial("/sync/doc-42", &pairs(&offer)).await;
    assert_eq!(client.close_frame().await, CLOSE_FORBIDDEN);
    assert_eq!(h.rooms.joins(), 0, "a denied reader joined the room");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_denied_write_makes_a_write_ticket_read_only() {
    let hook = FakeAuthorization::new(true, false, false);
    let h = start_endpoint(with_hook(&hook), None).await;
    let offer = ticket_offer(&["blok-sync.v1", &write_ticket()]);
    let _client = h.dial("/sync/doc-42", &pairs(&offer)).await;
    assert!(!h.rooms.last_member().can_write(), "joined as a writer");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_spent_window_is_refused_before_the_hook_runs() {
    let hook = FakeAuthorization::new(true, true, false);
    let shared = Arc::clone(&hook);
    let h = start_endpoint(
        move |c| {
            c.auth = "ticket".into();
            c.authorization = Some(shared);
            c.rate_limit = Arc::new(|_| false);
        },
        None,
    )
    .await;
    let offer = ticket_offer(&["blok-sync.v1", &write_ticket()]);
    let client = h.dial("/sync/doc-42", &pairs(&offer)).await;
    assert_eq!(
        (client.status, client.body.as_str()),
        (429, "rate limit exceeded\n")
    );
    assert!(hook.calls().is_empty());
}

// The window is billed to the address until a pass verifies, then to its user.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_rate_limit_key_follows_the_verified_pass() {
    let keys = Arc::new(Mutex::new(Vec::<String>::new()));
    let recorded = Arc::clone(&keys);
    let h = start_endpoint(
        move |c| {
            c.auth = "ticket".into();
            c.rate_limit = Arc::new(move |key| {
                recorded.lock().unwrap().push(key.to_owned());
                true
            });
        },
        None,
    )
    .await;
    let offer = ticket_offer(&["blok-sync.v1"]);
    h.dial("/sync/doc-42", &pairs(&offer))
        .await
        .close_frame()
        .await;
    let offer = ticket_offer(&["blok-sync.v1", &write_ticket()]);
    let _accepted = h.dial("/sync/doc-42", &pairs(&offer)).await;
    h.dial("/sync/doc-42", &[("Origin", "https://evil.example")])
        .await;
    assert_eq!(keys.lock().unwrap().join(" "), "addr:127.0.0.1 user:u1");
    assert_eq!(
        h.rooms.last_member().actor_id(),
        "u1",
        "the actor is not the ticket's user"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_userless_pass_is_closed4401() {
    let h = start_endpoint(ticket_mode, None).await;
    let offer = ticket_offer(&["blok-sync.v1", &userless_ticket()]);
    let mut client = h.dial("/sync/doc-42", &pairs(&offer)).await;
    assert_eq!(client.close_frame().await, CLOSE_USERLESS_PASS);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn join_statuses_answer_before_or_after_the_upgrade() {
    let cases = [
        (JoinStatus::Draining, 503, "shutting down\n", None),
        (JoinStatus::Forbidden, 403, "forbidden\n", None),
        (JoinStatus::Purged, 403, "forbidden\n", None),
        (JoinStatus::SeedFailed, 101, "", Some(CLOSE_SEED_FAILED)),
        (JoinStatus::Unavailable, 101, "", Some(CLOSE_SEED_FAILED)),
    ];
    for (status, code, body, close) in cases {
        let h = start_endpoint(|_| {}, None).await;
        h.rooms.answer(status, false);
        let mut client = h.dial("/sync/doc", &[]).await;
        assert_eq!(
            (client.status, client.body.as_str()),
            (code, body),
            "{status:?}"
        );
        match close {
            Some(close) => assert_eq!(client.close_frame().await, close, "{status:?}"),
            None => assert_eq!(
                client.header("Content-Type"),
                "text/plain; charset=utf-8",
                "{status:?}"
            ),
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn at_the_process_ceiling_an_upgrade_is503_before_the_room_is_joined() {
    let h = start_endpoint(
        |c| c.connections = Arc::new(ConnectionTable::new(1, 8)),
        None,
    )
    .await;
    let _held = h.dial("/sync/doc", &[]).await;
    let client = h.dial("/sync/doc", &[]).await;
    assert_eq!(
        (client.status, client.body.as_str()),
        (503, "too many connections on this server\n")
    );
    assert_eq!(h.rooms.joins(), 1);
}

// HostCollabTests.cs. The C# test floods awareness at the stalled peer; here
// that trips the slow-consumer 1008 first, so the peer only stops answering
// pings, which leaves the keep-alive as the one thing that can free its slot.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_peer_that_stops_reading_and_answering_pings_leaves_the_room() {
    let h = start_endpoint(
        |c| {
            c.connections = Arc::new(ConnectionTable::new(2, 8));
            c.keep_alive_interval = Duration::from_secs(1);
        },
        None,
    )
    .await;
    let mut writer = h.dial("/sync/doc", &[]).await;
    assert_eq!(writer.status, 101);
    let answering = tokio::spawn(async move {
        loop {
            let frame = read_server_frame(&mut writer.reader).await;
            if frame.opcode == 0x9 {
                writer.write(&client_frame(0x8a, &frame.payload)).await;
            }
        }
    });
    let stalled = h.dial("/sync/doc", &[]).await;
    assert_eq!(stalled.status, 101);

    let refused = h.dial("/sync/doc", &[]).await;
    assert_eq!(
        (refused.status, refused.body.as_str()),
        (503, "too many connections on this server\n")
    );

    // The ping goes out after one interval and times out two later; the rest
    // is slack for a loaded machine.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(8);
    let admitted = loop {
        let client = h.dial("/sync/doc", &[]).await;
        if client.status == 101 {
            break client;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "the stalled peer still held its slot after 8 s"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    };
    // The writer answered its pings, so it still holds the other slot.
    let full = h.dial("/sync/doc", &[]).await;
    assert_eq!(full.status, 503, "the writer was evicted too");
    answering.abort();
    drop((stalled, admitted));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_join_error_leaves_no_socket() {
    let h = start_endpoint(|_| {}, None).await;
    h.rooms.answer(JoinStatus::Joined, true);
    assert_eq!(h.dial("/sync/doc", &[]).await.status, 500);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn recheck_asks_the_hook_for_read_and_for_write_only_for_a_writer() {
    let hook = FakeAuthorization::new(true, true, false);
    let h = start_endpoint(with_hook(&hook), None).await;
    let offer = ticket_offer(&["blok-sync.v1", &write_ticket()]);
    let _w = h.dial("/sync/doc-42", &pairs(&offer)).await;
    let writer = h.rooms.last_member();
    let offer = ticket_offer(&["blok-sync.v1", &read_ticket()]);
    let _r = h.dial("/sync/doc-42", &pairs(&offer)).await;
    let reader = h.rooms.last_member();

    hook.set(|a| a.write = false);
    assert!(
        !writer.recheck_access().await.unwrap(),
        "a writer that lost write kept access"
    );
    assert!(
        reader.recheck_access().await.unwrap(),
        "a reader lost access over write"
    );
    hook.set(|a| a.read = false);
    assert!(
        !reader.recheck_access().await.unwrap(),
        "a revoked reader kept access"
    );
    hook.set(|a| a.fail = true);
    assert!(
        reader.recheck_access().await.is_err(),
        "a hook error was swallowed"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn frames_reach_the_room_and_room_frames_reach_the_peer() {
    let h = start_endpoint(|_| {}, None).await;
    let mut client = h.dial("/sync/doc", &[]).await;
    let member = h.rooms.last_member();
    member.send(vec![100, 1]);
    let frame = read_server_frame(&mut client.reader).await;
    assert_eq!((frame.opcode, frame.payload), (0x2, vec![100, 1]));
    client.write(&client_frame(0x82, &[105, 7])).await;
    let membership = h.rooms.membership(0);
    assert!(
        eventually(|| membership.count() == 1).await,
        "the frame never reached the room"
    );
    member.close(CloseReason::Reset);
    assert_eq!(client.close_frame().await, CLOSE_RESET);
}

// A peer that stops reading is closed 1008 while the others keep receiving,
// over a real socket: the stalled peer gets every admitted frame, then 1008.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_peer_that_stops_reading_is_closed1008_while_the_others_keep_receiving() {
    const FRAMES: usize = 96;
    let h = start_endpoint(|c| c.max_message_bytes = 256 * 1024, None).await;
    let mut stalled = h.dial("/sync/doc", &[]).await;
    let stalled_member = h.socket_member(0);
    let mut healthy = h.dial("/sync/doc", &[]).await;
    let healthy_member = h.socket_member(1);

    let mut presence = vec![0u8; 200 * 1024];
    presence[0] = 1;
    let mut admitted = 0;
    for _ in 0..FRAMES {
        if stalled_member.requested_close().is_none() {
            admitted += 1;
        }
        blok_collab::Member::send(&*stalled_member, presence.clone());
        blok_collab::Member::send(&*healthy_member, presence.clone());
        let frame = read_server_frame(&mut healthy.reader).await;
        assert_eq!(
            (frame.opcode, frame.payload.len()),
            (0x2, presence.len()),
            "the healthy peer"
        );
    }
    assert_eq!(
        stalled_member.requested_close(),
        Some(CLOSE_SLOW_CONSUMER),
        "19 MiB at a stalled peer"
    );
    let (received, close) = drain(&mut stalled).await;
    assert_eq!(close, CLOSE_SLOW_CONSUMER);
    // The frame that tripped the cap was not admitted; every other one was sent.
    assert_eq!(received, admitted - 1, "frames before the close");
    assert_eq!(
        healthy_member.requested_close(),
        None,
        "the healthy peer was closed"
    );
}

// A revoked reader drops queued frames before the forbidden close, over a
// real socket.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_revoked_reader_drops_queued_frames_before_the_forbidden_close() {
    const FRAMES: usize = 64;
    let h = start_endpoint(|c| c.max_message_bytes = 4 * 1024 * 1024, None).await;
    let mut revoked = h.dial("/sync/doc", &[]).await;
    let member = h.rooms.last_member();
    let mut update = vec![0u8; 400 * 1024];
    update[1] = 2;
    for _ in 0..FRAMES {
        member.send(update.clone());
    }
    member.close(CloseReason::Forbidden);
    let (received, close) = drain(&mut revoked).await;
    assert_eq!(close, CLOSE_FORBIDDEN);
    assert!(
        received < FRAMES,
        "received all {received} queued frames after revocation"
    );
}

// Measured on Kestrel: "500", Content-Length: 0, no body, and the connection
// stays open.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_hook_error_before_the_upgrade_is_an_empty500_that_keeps_the_connection() {
    let hook = FakeAuthorization::new(false, false, true);
    let h = start_endpoint(with_hook(&hook), None).await;
    let mut conn = tokio::net::TcpStream::connect(h.address).await.unwrap();
    let request = format!(
        "GET /sync/doc-42 HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\
         Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\
         Origin: https://app.example.com\r\nSec-WebSocket-Protocol: blok-sync.v1, {}\r\n\r\n",
        write_ticket()
    );
    conn.write_all(request.as_bytes()).await.unwrap();
    let mut got = Vec::new();
    let mut buffer = [0u8; 4096];
    loop {
        match tokio::time::timeout(Duration::from_secs(1), conn.read(&mut buffer)).await {
            Err(_) => break,
            Ok(Ok(0)) => panic!("connection ended after {:?}", String::from_utf8_lossy(&got)),
            Ok(Ok(n)) => got.extend_from_slice(&buffer[..n]),
            Ok(Err(error)) => panic!("connection ended: {error}"),
        }
    }
    let text = String::from_utf8(got).unwrap();
    let (head, body) = text.split_once("\r\n\r\n").unwrap();
    let lines: Vec<&str> = head.split("\r\n").collect();
    let names: Vec<&str> = lines[1..]
        .iter()
        .map(|line| line.split(':').next().unwrap())
        .collect();
    assert_eq!(lines[0], "HTTP/1.1 500 Internal Server Error", "{text:?}");
    assert_eq!(body, "", "{text:?}");
    assert_eq!(names.join(","), "Content-Length,Date,Server", "{text:?}");
    assert_eq!(lines[1], "Content-Length: 0", "{text:?}");
}

/// Never answers; records when its future is dropped.
struct StuckHook(Arc<std::sync::atomic::AtomicBool>);

struct DropFlag(Arc<std::sync::atomic::AtomicBool>);

impl Drop for DropFlag {
    fn drop(&mut self) {
        self.0.store(true, std::sync::atomic::Ordering::Release);
    }
}

impl blok_auth::Authorization for StuckHook {
    fn can_read_document<'a>(
        &'a self,
        _user: &'a User,
        _document_id: &'a str,
    ) -> blok_auth::BoxFuture<'a, Result<bool, blok_auth::Error>> {
        let flag = DropFlag(Arc::clone(&self.0));
        Box::pin(async move {
            let _flag = flag;
            std::future::pending::<()>().await;
            Ok(true)
        })
    }

    fn can_write_document<'a>(
        &'a self,
        _user: &'a User,
        _document_id: &'a str,
    ) -> blok_auth::BoxFuture<'a, Result<bool, blok_auth::Error>> {
        Box::pin(async { Ok(true) })
    }
}

// C# hands the hook RequestAborted and Go the request context: a client that
// leaves mid-hook cancels it.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_hook_still_running_when_the_client_leaves_is_cancelled() {
    let dropped = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let hook: Arc<dyn blok_auth::Authorization> = Arc::new(StuckHook(Arc::clone(&dropped)));
    let h = start_endpoint(
        move |c| {
            c.auth = "ticket".into();
            c.authorization = Some(hook);
        },
        None,
    )
    .await;
    let mut conn = tokio::net::TcpStream::connect(h.address).await.unwrap();
    let request = format!(
        "GET /sync/doc-42 HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\
         Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\
         Origin: https://app.example.com\r\nSec-WebSocket-Protocol: blok-sync.v1, {}\r\n\r\n",
        write_ticket()
    );
    conn.write_all(request.as_bytes()).await.unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(!dropped.load(std::sync::atomic::Ordering::Acquire));
    conn.shutdown().await.unwrap();
    assert!(
        eventually(|| dropped.load(std::sync::atomic::Ordering::Acquire)).await,
        "the hook outlived its request"
    );
}

/// Signs in the user named by the X-User header, as a host's own
/// authentication would.
fn signed_in_by_header() -> Wrap {
    Box::new(|next: Arc<dyn blok_http::Handler>| {
        Arc::new(move |mut request: blok_http::Request, response| {
            if let Some(name) = request.headers().get("X-User").map(str::to_owned) {
                request.extensions.insert(User {
                    id: name.clone(),
                    name,
                    authenticated: true,
                    ..User::default()
                });
            }
            next.serve(request, response)
        }) as Arc<dyn blok_http::Handler>
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn require_authorization_on_the_group_protects_the_sync_route_and_the_signed_in_user_is_the_principal()
 {
    let hook = FakeAuthorization::new(true, true, false);
    let authorization = Arc::clone(&hook);
    let h = start_endpoint(
        move |c| {
            c.connections = Arc::new(ConnectionTable::new(0, 1));
            c.authorization = Some(authorization);
        },
        Some(signed_in_by_header()),
    )
    .await;

    let alice = h.dial("/sync/doc", &[("X-User", "alice")]).await;
    assert_eq!(alice.status, 101, "{}", alice.body);
    assert!(hook.calls().iter().any(|user| user.id == "alice"));
    assert!(hook.write_calls().iter().any(|user| user.id == "alice"));

    let again = h.dial("/sync/doc", &[("X-User", "alice")]).await;
    assert_eq!(
        (again.status, again.body.as_str()),
        (429, "too many connections\n")
    );
    let bob = h.dial("/sync/doc", &[("X-User", "bob")]).await;
    assert_eq!(bob.status, 101, "{}", bob.body);
}

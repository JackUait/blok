//! C# SyncHandshakeTests, SyncEndpointTests and SyncSocketMemberTests cases
//! with no Go twin. Where C# reads the room's answer (a control frame, a
//! synced text), these read what the endpoint handed the fake room.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_auth::User;
use blok_collab::{CloseReason, Member, OperationSource};
use blok_jsjson::{Node, Options, parse_node};

use super::*;
use crate::budget_test::FakeClock;
use crate::test_support::*;

const DISALLOWED_ORIGIN: &str = "https://evil.example.net";

/// tickets.json: the same passes C#'s TicketFixture reads.
fn ticket(name: &str) -> String {
    let path = format!(
        "{}/../../../../../test/unit/server-conformance/fixtures/tickets.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let root: Node = parse_node(&std::fs::read(path).unwrap(), Options::default()).unwrap();
    let member = root
        .members
        .iter()
        .find(|m| m.key().unwrap().to_string() == name)
        .unwrap_or_else(|| panic!("no ticket {name}"));
    member.value.text().unwrap().to_string()
}

#[test]
fn the_ticket_fixture_shares_the_test_secret() {
    assert_eq!(ticket("secret"), TEST_SECRET);
}

async fn connect_with_ticket(h: &Harness, pass: &str) -> ClientConn {
    let offer = ticket_offer(&[PROTOCOL_V1, pass]);
    h.dial("/sync/doc-42", &pairs(&offer)).await
}

async fn ticket_app() -> Harness {
    start_endpoint(ticket_mode, None).await
}

/// FixedWindowRateLimiter at RateLimitPerMinute = 1 with a clock that never
/// moves: one hit per key.
fn window_of_one(config: &mut Config) {
    let seen = Mutex::new(HashSet::new());
    config.rate_limit = Arc::new(move |key| seen.lock().unwrap().insert(key.to_owned()));
}

fn varuint(mut n: usize, out: &mut Vec<u8>) {
    while n >= 0x80 {
        out.push((n as u8 & 0x7f) | 0x80);
        n >>= 7;
    }
    out.push(n as u8);
}

fn framed(prefix: &[u8], payload: &[u8]) -> Vec<u8> {
    let mut frame = prefix.to_vec();
    varuint(payload.len(), &mut frame);
    frame.extend_from_slice(payload);
    frame
}

fn awareness(payload: &[u8]) -> Vec<u8> {
    framed(&[1], payload)
}

fn update(payload: &[u8]) -> Vec<u8> {
    framed(&[0, 2], payload)
}

/// SyncStep1 with an empty client's state vector.
const RESYNC: [u8; 4] = [0, 0, 1, 0];

async fn send_binary(client: &mut ClientConn, frame: &[u8]) {
    client.write(&client_frame(0x82, frame)).await;
}

// --- SyncHandshakeTests ---------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn accepts_the_offer_as_one_comma_joined_header_value() {
    let h = ticket_app().await;
    let offer = format!("{PROTOCOL_V1}, {}", ticket("compatible"));
    let client = h
        .dial(
            "/sync/doc-42",
            &[
                ("Origin", "https://app.example.com"),
                ("Sec-WebSocket-Protocol", &offer),
            ],
        )
        .await;
    assert_eq!(client.header("Sec-WebSocket-Protocol"), PROTOCOL_V1);
    assert!(h.rooms.last_member().accepts_control_frames());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn accepts_the_ticket_before_the_protocol_in_the_offer() {
    let h = ticket_app().await;
    let offer = ticket_offer(&[&ticket("compatible"), PROTOCOL_V1]);
    let client = h.dial("/sync/doc-42", &pairs(&offer)).await;
    assert_eq!(client.header("Sec-WebSocket-Protocol"), PROTOCOL_V1);
    assert_eq!(h.rooms.joins(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_invalid_ticket_is_accepted_then_closed4401() {
    for name in [
        "expired",
        "tampered",
        "noncanonicalHeaderTicket",
        "malformed",
    ] {
        let h = ticket_app().await;
        let mut client = connect_with_ticket(&h, &ticket(name)).await;
        // Refusing the subprotocol would leave the browser with no readable code.
        assert_eq!(
            client.header("Sec-WebSocket-Protocol"),
            PROTOCOL_V1,
            "{name}"
        );
        assert_eq!(client.close_frame().await, CLOSE_INVALID_PASS, "{name}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_missing_ticket_is_accepted_then_closed4401() {
    let h = ticket_app().await;
    let offer = ticket_offer(&[PROTOCOL_V1]);
    let mut client = h.dial("/sync/doc-42", &pairs(&offer)).await;
    assert_eq!(client.header("Sec-WebSocket-Protocol"), PROTOCOL_V1);
    assert_eq!(client.close_frame().await, CLOSE_MISSING_PASS);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_ticket_for_another_document_is_closed4401() {
    let h = ticket_app().await;
    let mut client = connect_with_ticket(&h, &ticket("docMismatch")).await;
    assert_eq!(client.header("Sec-WebSocket-Protocol"), PROTOCOL_V1);
    assert_eq!(client.close_frame().await, CLOSE_OTHER_DOCUMENT);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ticket_mode_requires_the_sync_protocol_in_the_offer() {
    let h = ticket_app().await;
    let offer = ticket_offer(&[&ticket("compatible")]);
    let client = h.dial("/sync/doc-42", &pairs(&offer)).await;
    assert_eq!(client.status, 400);
    assert_eq!(
        client.body,
        "blok-sync.v1 must be offered in Sec-WebSocket-Protocol\n"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn offers_v2_then_v1_then_ticket_join_at_v1_when_no_operation_store_is_registered() {
    let h = ticket_app().await;
    let offer = ticket_offer(&[PROTOCOL_V2, PROTOCOL_V1, &ticket("compatible")]);
    let client = h.dial("/sync/doc-42", &pairs(&offer)).await;
    assert_eq!(client.header("Sec-WebSocket-Protocol"), PROTOCOL_V1);
    assert_eq!(
        h.rooms.last_member().protocol_source(),
        OperationSource::ClientV1
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn offers_v2_then_v1_then_ticket_join_at_v2_with_an_operation_store_registered() {
    let h = start_endpoint(
        |c| {
            c.auth = "ticket".into();
            c.has_operation_store = true;
        },
        None,
    )
    .await;
    let offer = ticket_offer(&[PROTOCOL_V2, PROTOCOL_V1, &ticket("compatible")]);
    let client = h.dial("/sync/doc-42", &pairs(&offer)).await;
    assert_eq!(client.header("Sec-WebSocket-Protocol"), PROTOCOL_V2);
    assert!(h.rooms.last_member().accepts_control_frames());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_v2_only_offer_with_no_operation_store_selects_nothing_and_is_refused() {
    let h = ticket_app().await;
    let offer = ticket_offer(&[PROTOCOL_V2, &ticket("compatible")]);
    assert_eq!(h.dial("/sync/doc-42", &pairs(&offer)).await.status, 400);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ticket_search_excludes_both_protocol_tokens_so_two_protocols_with_no_ticket_is_a_missing_pass_not_an_invalid_one()
 {
    let h = ticket_app().await;
    let offer = ticket_offer(&[PROTOCOL_V1, PROTOCOL_V2]);
    let mut client = h.dial("/sync/doc-42", &pairs(&offer)).await;
    assert_eq!(client.header("Sec-WebSocket-Protocol"), PROTOCOL_V1);
    assert_eq!(client.close_frame().await, CLOSE_MISSING_PASS);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_invalid_ticket_between_the_two_protocol_tokens_is_still_found_and_rejected() {
    let h = ticket_app().await;
    let offer = ticket_offer(&[PROTOCOL_V1, &ticket("expired"), PROTOCOL_V2]);
    let mut client = h.dial("/sync/doc-42", &pairs(&offer)).await;
    assert_eq!(client.header("Sec-WebSocket-Protocol"), PROTOCOL_V1);
    assert_eq!(client.close_frame().await, CLOSE_INVALID_PASS);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_document_id_with_an_encoded_slash_is_closed4400_instead_of_looking_like_a_pass_mismatch()
{
    let pass = mint(r#"{"user":"u1","doc":"a/b","write":true,"exp":4102444800}"#);
    let h = ticket_app().await;
    let offer = ticket_offer(&[PROTOCOL_V1, &pass]);
    let mut client = h.dial("/sync/a%2Fb", &pairs(&offer)).await;
    assert_eq!(client.header("Sec-WebSocket-Protocol"), PROTOCOL_V1);
    assert_eq!(client.close_frame().await, CLOSE_BAD_DOCUMENT);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ticket_mode_requires_an_allowed_origin_on_the_upgrade() {
    for origin in [Some(DISALLOWED_ORIGIN), None] {
        let h = ticket_app().await;
        let offer = format!("{PROTOCOL_V1}, {}", ticket("compatible"));
        let mut headers = vec![("Sec-WebSocket-Protocol", offer.as_str())];
        if let Some(origin) = origin {
            headers.push(("Origin", origin));
        }
        let client = h.dial("/sync/doc-42", &headers).await;
        assert_eq!(
            (client.status, client.body.as_str()),
            (403, "origin not allowed\n"),
            "{origin:?}"
        );
        assert_eq!(h.rooms.joins(), 0);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stock_clients_join_without_a_subprotocol_and_never_see_the_control_frame() {
    for auth in ["none", "proxy"] {
        let h = start_endpoint(|c| c.auth = auth.into(), None).await;
        let client = h.dial("/sync/doc-42", &[]).await;
        assert_eq!(client.status, 101, "{auth}");
        assert_eq!(client.header("Sec-WebSocket-Protocol"), "", "{auth}");
        assert!(!h.rooms.last_member().accepts_control_frames(), "{auth}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn no_auth_mode_echoes_the_protocol_when_offered_and_sends_the_control_frame() {
    let h = start_endpoint(|_| {}, None).await;
    let offer = ticket_offer(&[PROTOCOL_V1]);
    let client = h.dial("/sync/doc-42", &pairs(&offer)).await;
    assert_eq!(client.header("Sec-WebSocket-Protocol"), PROTOCOL_V1);
    assert!(h.rooms.last_member().accepts_control_frames());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn no_auth_mode_rejects_a_present_disallowed_origin() {
    let h = start_endpoint(|_| {}, None).await;
    let refused = h
        .dial("/sync/doc-42", &[("Origin", DISALLOWED_ORIGIN)])
        .await;
    assert_eq!(
        (refused.status, refused.body.as_str()),
        (403, "origin not allowed\n")
    );
    let allowed = h
        .dial("/sync/doc-42", &[("Origin", "https://app.example.com")])
        .await;
    assert_eq!(allowed.status, 101);
    assert_eq!(allowed.header("Sec-WebSocket-Protocol"), "");
}

// SyncHandshake.Admit asks for an allowed origin when Sec-Fetch-Site is
// cross-site, even with no Origin header.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn no_auth_mode_rejects_a_cross_site_upgrade_with_no_origin() {
    let h = start_endpoint(|_| {}, None).await;
    for site in ["cross-site", "Cross-Site"] {
        let client = h.dial("/sync/doc-42", &[("Sec-Fetch-Site", site)]).await;
        assert_eq!(
            (client.status, client.body.as_str()),
            (403, "origin not allowed\n"),
            "{site}"
        );
    }
    let same = h
        .dial("/sync/doc-42", &[("Sec-Fetch-Site", "same-site")])
        .await;
    assert_eq!(same.status, 101);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_rejected_handshake_spends_the_rate_limit_on_its_address_so_auth_failures_cannot_flood() {
    let h = start_endpoint(
        |c| {
            ticket_mode(c);
            window_of_one(c);
        },
        None,
    )
    .await;
    let mut rejected = connect_with_ticket(&h, &ticket("expired")).await;
    assert_eq!(rejected.close_frame().await, CLOSE_INVALID_PASS);
    // The address has spent its window on the rejection: the next one never
    // gets a socket at all.
    let refused = connect_with_ticket(&h, &ticket("expired")).await;
    assert_eq!(
        (refused.status, refused.body.as_str()),
        (429, "rate limit exceeded\n")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rejections_do_not_spend_the_window_of_a_valid_pass_holder() {
    let h = start_endpoint(
        |c| {
            ticket_mode(c);
            window_of_one(c);
        },
        None,
    )
    .await;
    let mut rejected = connect_with_ticket(&h, &ticket("expired")).await;
    assert_eq!(rejected.close_frame().await, CLOSE_INVALID_PASS);
    // Rejections key on the address, an accepted handshake on its user.
    let accepted = connect_with_ticket(&h, &ticket("compatible")).await;
    assert_eq!(accepted.status, 101);
    let refused = connect_with_ticket(&h, &ticket("compatible")).await;
    assert_eq!(refused.status, 429);
    let other_user = connect_with_ticket(&h, &ticket("userTwo")).await;
    assert_eq!(other_user.status, 101);
    assert_eq!(h.rooms.joins(), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_spent_window_is_refused_before_the_application_authorization_hook_runs() {
    let hook = FakeAuthorization::new(true, true, false);
    let shared = Arc::clone(&hook);
    let h = start_endpoint(
        move |c| {
            ticket_mode(c);
            window_of_one(c);
            c.authorization = Some(shared);
        },
        None,
    )
    .await;
    let accepted = connect_with_ticket(&h, &ticket("compatible")).await;
    assert_eq!(accepted.status, 101);
    let calls_after_the_first_join = hook.calls().len();
    // The limiter exists to bound the hook's cost, so a spent window must
    // never reach it.
    let refused = connect_with_ticket(&h, &ticket("compatible")).await;
    assert_eq!(refused.status, 429);
    assert_eq!(hook.calls().len(), calls_after_the_first_join);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_rejected_handshake_is_torn_down_without_waiting_out_a_peer_that_never_answers() {
    let (served, mut ended) = tokio::sync::mpsc::unbounded_channel::<()>();
    let wrap: Wrap = Box::new(move |next: Arc<dyn blok_http::Handler>| {
        Arc::new(
            move |request: blok_http::Request, response: blok_http::ResponseWriter| {
                let (next, served) = (Arc::clone(&next), served.clone());
                async move {
                    next.serve(request, response).await;
                    let _ = served.send(());
                }
            },
        ) as Arc<dyn blok_http::Handler>
    });
    let h = start_endpoint(ticket_mode, Some(wrap)).await;
    let mut client = connect_with_ticket(&h, &ticket("expired")).await;
    // The browser still reads the code, and the socket is not held open for
    // the answer a rejected client has no reason to send.
    assert_eq!(client.close_frame().await, CLOSE_INVALID_PASS);
    tokio::time::timeout(Duration::from_secs(3), ended.recv())
        .await
        .expect("the rejected socket was held")
        .unwrap();
}

fn hooked(hook: &Arc<FakeAuthorization>) -> impl FnOnce(&mut Config) + use<> {
    let shared = Arc::clone(hook);
    move |c: &mut Config| {
        ticket_mode(c);
        c.authorization = Some(shared);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn application_authorization_denied_read_is_closed4403() {
    let hook = FakeAuthorization::new(false, true, false);
    let h = start_endpoint(hooked(&hook), None).await;
    let mut client = connect_with_ticket(&h, &ticket("compatible")).await;
    assert_eq!(client.header("Sec-WebSocket-Protocol"), PROTOCOL_V1);
    assert_eq!(client.close_frame().await, CLOSE_FORBIDDEN);
    assert!(
        hook.calls()
            .iter()
            .any(|u| u.id == "u1" && u.doc == "doc-42")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn application_authorization_denied_write_makes_a_write_ticket_read_only() {
    let hook = FakeAuthorization::new(true, false, false);
    let h = start_endpoint(hooked(&hook), None).await;
    let _client = connect_with_ticket(&h, &ticket("compatible")).await;
    assert!(!h.rooms.last_member().can_write());
    assert!(
        hook.write_calls()
            .iter()
            .any(|u| u.id == "u1" && u.doc == "doc-42")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_authorization_hook_sees_the_tickets_user_document_and_write_claims() {
    let hook = FakeAuthorization::new(true, true, false);
    let h = start_endpoint(hooked(&hook), None).await;
    let _writer = connect_with_ticket(&h, &ticket("compatible")).await;
    let principal = hook.calls()[0].clone();
    assert!(principal.authenticated);
    assert_eq!(principal.id, "u1");
    assert_eq!(principal.doc, "doc-42");
    assert!(principal.write);
    let _reader = connect_with_ticket(&h, &ticket("readOnly")).await;
    assert!(!hook.calls().last().unwrap().write);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ticket_user_becomes_journal_actor() {
    let h = ticket_app().await;
    let _client = connect_with_ticket(&h, &ticket("compatible")).await;
    let member = h.rooms.last_member();
    assert_eq!(member.actor_id(), "u1");
    assert_eq!(member.protocol_source(), OperationSource::ClientV1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_v2_selection_carries_the_client_v2_journal_source() {
    let h = start_endpoint(
        |c| {
            ticket_mode(c);
            c.has_operation_store = true;
        },
        None,
    )
    .await;
    let offer = ticket_offer(&[PROTOCOL_V2, PROTOCOL_V1, &ticket("compatible")]);
    let client = h.dial("/sync/doc-42", &pairs(&offer)).await;
    assert_eq!(client.header("Sec-WebSocket-Protocol"), PROTOCOL_V2);
    assert_eq!(
        h.rooms.last_member().protocol_source(),
        OperationSource::ClientV2
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn application_name_identifier_becomes_journal_actor() {
    let h = start_endpoint(
        |_| {},
        Some(signed_in(User {
            id: "alice".into(),
            authenticated: true,
            ..User::default()
        })),
    )
    .await;
    let _client = h.dial("/sync/doc-42", &[]).await;
    assert_eq!(h.rooms.last_member().actor_id(), "alice");
}

#[test]
fn ticket_without_a_user_claim_has_null_journal_actor() {
    let user = User {
        doc: "doc-42".into(),
        write: true,
        authenticated: true,
        ..User::default()
    };
    assert_eq!(derive_actor("", &user, true), "");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn no_auth_connection_has_null_journal_actor() {
    let h = start_endpoint(
        |c| c.connections = Arc::new(ConnectionTable::new(0, 1)),
        None,
    )
    .await;
    let _first = h.dial("/sync/doc-42", &[]).await;
    let _second = h.dial("/sync/doc-42", &[]).await;
    assert_eq!(h.rooms.last_member().actor_id(), "");
    // No principal: a cap of one never refused the second.
    assert_eq!(h.rooms.joins(), 2);
}

// In ticket mode the principal is also the rate-limit key, so the key the
// limiter saw is the principal.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_rate_limit_key_is_never_the_journal_actor() {
    let keys = Arc::new(Mutex::new(Vec::<String>::new()));
    let recorded = Arc::clone(&keys);
    let h = start_endpoint(
        move |c| {
            ticket_mode(c);
            c.rate_limit = Arc::new(move |key| {
                recorded.lock().unwrap().push(key.to_owned());
                true
            });
        },
        None,
    )
    .await;
    let _client = connect_with_ticket(&h, &ticket("compatible")).await;
    let principal = keys.lock().unwrap()[0].clone();
    let actor = h.rooms.last_member().actor_id();
    assert_eq!(principal, "user:u1");
    assert_eq!(actor, "u1");
    assert_ne!(principal, actor);
}

#[test]
fn name_identifier_wins_over_name_when_a_principal_carries_both() {
    let user = User {
        id: "stable-id".into(),
        name: "Display Name".into(),
        authenticated: true,
        ..User::default()
    };
    assert_eq!(derive_actor("", &user, true), "stable-id");
}

// --- SyncEndpointTests ----------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_ninth_connection_for_one_user_and_doc_is_refused_while_another_user_still_joins() {
    let h = ticket_app().await;
    let mut clients = Vec::new();
    for _ in 0..8 {
        let client = connect_with_ticket(&h, &ticket("compatible")).await;
        assert_eq!(client.status, 101);
        clients.push(client);
    }
    let refused = connect_with_ticket(&h, &ticket("compatible")).await;
    assert_eq!(
        (refused.status, refused.body.as_str()),
        (429, "too many connections\n")
    );
    let other_user = connect_with_ticket(&h, &ticket("userTwo")).await;
    assert_eq!(other_user.status, 101);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn closing_a_connection_frees_its_slot() {
    let h = start_endpoint(
        |c| {
            ticket_mode(c);
            c.connections = Arc::new(ConnectionTable::new(0, 1));
        },
        None,
    )
    .await;
    let mut first = connect_with_ticket(&h, &ticket("compatible")).await;
    assert_eq!(first.status, 101);
    assert_eq!(
        connect_with_ticket(&h, &ticket("compatible")).await.status,
        429
    );

    first.write(&client_frame(0x88, &[3, 232])).await;
    assert_eq!(first.close_frame().await, CLOSE_NORMAL);

    let second = connect_with_ticket(&h, &ticket("compatible")).await;
    assert_eq!(second.status, 101);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_ticket_without_a_user_is_closed4401() {
    for payload in [
        r#"{"user":"","doc":"doc-42","write":true,"exp":4102444800}"#,
        r#"{"doc":"doc-42","write":true,"exp":4102444800}"#,
    ] {
        let h = ticket_app().await;
        let mut client = connect_with_ticket(&h, &mint(payload)).await;
        assert_eq!(client.header("Sec-WebSocket-Protocol"), PROTOCOL_V1);
        assert_eq!(client.close_frame().await, CLOSE_USERLESS_PASS, "{payload}");
        let named = connect_with_ticket(&h, &ticket("compatible")).await;
        assert_eq!(named.status, 101);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn connections_without_a_user_identity_are_not_capped() {
    for auth in ["none", "proxy"] {
        let h = start_endpoint(
            |c| {
                c.auth = auth.into();
                c.connections = Arc::new(ConnectionTable::new(0, 1));
            },
            None,
        )
        .await;
        let first = h.dial("/sync/doc-42", &[]).await;
        let second = h.dial("/sync/doc-42", &[]).await;
        assert_eq!((first.status, second.status), (101, 101), "{auth}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_oversized_frame_closes1009() {
    let h = start_endpoint(|c| c.max_message_bytes = 1024, None).await;
    let mut client = h.dial("/sync/doc-42", &[]).await;
    send_binary(&mut client, &[0u8; 1025]).await;
    assert_eq!(client.close_frame().await, CLOSE_TOO_BIG);
    assert_eq!(h.rooms.membership(0).count(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_frame_at_the_limit_still_reaches_the_room() {
    let h = start_endpoint(|c| c.max_message_bytes = 1024, None).await;
    let mut client = h.dial("/sync/doc-42", &[]).await;
    // [1][varuint 1021][payload] = 1 + 2 + 1021 bytes.
    let frame = awareness(&[7u8; 1021]);
    assert_eq!(frame.len(), 1024);
    send_binary(&mut client, &frame).await;
    let membership = h.rooms.membership(0);
    assert!(eventually(|| membership.count() == 1).await);
    assert_eq!(membership.frames.lock().unwrap()[0], frame);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_text_frame_is_closed1003_before_it_is_parsed() {
    let h = start_endpoint(|_| {}, None).await;
    let mut client = h.dial("/sync/doc-42", &[]).await;
    client.write(&client_frame(0x81, b"hello")).await;
    assert_eq!(client.close_frame().await, CLOSE_TEXT_FRAME);
    assert_eq!(h.rooms.membership(0).count(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_flood_of_empty_continuation_frames_closes1008() {
    let h = start_endpoint(|_| {}, None).await;
    let mut client = h.dial("/sync/doc-42", &[]).await;
    let mut flood = client_frame(0x02, &[1]);
    for _ in 0..10_000 {
        flood.extend(client_frame(0x00, &[]));
    }
    flood.extend(client_frame(0x80, &[0]));
    client.write(&flood).await;
    assert_eq!(client.close_frame().await, CLOSE_INBOUND_RATE_EXCEEDED);
    assert_eq!(h.rooms.membership(0).count(), 0);
}

async fn budget_app(clock: &FakeClock, edit: impl FnOnce(&mut BudgetOptions)) -> Harness {
    let clock = clock.clock();
    start_endpoint(
        move |c| {
            c.budget_clock = Some(clock);
            edit(&mut c.budget);
        },
        None,
    )
    .await
}

fn ten_a_second(budget: &mut BudgetOptions) {
    budget.frames_per_second = 10;
    budget.burst_frames = 10;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_inbound_burst_over_the_budget_closes1008() {
    let clock = FakeClock::new();
    let h = budget_app(&clock, ten_a_second).await;
    let mut client = h.dial("/sync/doc-42", &[]).await;
    // The clock never moves, so nothing refills: the eleventh frame is over.
    for index in 0..12u8 {
        send_binary(&mut client, &awareness(&[index])).await;
    }
    assert_eq!(client.close_frame().await, CLOSE_INBOUND_RATE_EXCEEDED);
    assert_eq!(h.rooms.membership(0).count(), 10);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_sustained_legitimate_cadence_refills_the_budget_and_stays_open() {
    let clock = FakeClock::new();
    let h = budget_app(&clock, ten_a_second).await;
    let mut client = h.dial("/sync/doc-42", &[]).await;
    let membership = h.rooms.membership(0);
    // Ten frames a second for three seconds: three times the burst, never
    // over the rate.
    for index in 0..30u8 {
        send_binary(&mut client, &awareness(&[index])).await;
        let want = usize::from(index) + 1;
        assert!(
            eventually(|| membership.count() == want).await,
            "frame {want}"
        );
        clock.advance(Duration::from_millis(100));
    }
    send_binary(&mut client, &awareness(&[0x7f])).await;
    assert!(eventually(|| membership.count() == 31).await);
    assert_eq!(h.socket_member(0).requested_close(), None);
}

async fn storm_closes(frame: &[u8]) {
    let clock = FakeClock::new();
    let h = budget_app(&clock, |_| {}).await;
    let mut client = h.dial("/sync/doc-42", &[]).await;
    for _ in 0..12 {
        send_binary(&mut client, frame).await;
    }
    assert_eq!(client.close_frame().await, CLOSE_INBOUND_RATE_EXCEEDED);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_resync_storm_closes1008_while_the_frame_budget_still_has_room() {
    storm_closes(&RESYNC).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_query_awareness_storm_closes1008_like_a_resync_storm() {
    storm_closes(&[3]).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_resync_storm_encoded_with_overlong_var_uints_is_still_a_resync_storm() {
    storm_closes(&[0x80, 0x00, 0x80, 0x00, 0x01, 0x00]).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_presence_flood_over_the_awareness_byte_budget_closes1008() {
    let clock = FakeClock::new();
    let h = budget_app(&clock, |_| {}).await;
    let mut client = h.dial("/sync/doc-42", &[]).await;
    // Six frames is nothing to the 100-frame burst; together they are 600 KB
    // of presence in one instant.
    for _ in 0..6 {
        send_binary(&mut client, &awareness(&vec![0u8; 100_000])).await;
    }
    assert_eq!(client.close_frame().await, CLOSE_INBOUND_RATE_EXCEEDED);
}

async fn not_metered(frame: &[u8], count: usize) {
    let clock = FakeClock::new();
    let h = budget_app(&clock, |_| {}).await;
    let mut client = h.dial("/sync/doc-42", &[]).await;
    for _ in 0..count {
        send_binary(&mut client, frame).await;
    }
    let membership = h.rooms.membership(0);
    assert!(eventually(|| membership.count() == count).await);
    assert_eq!(h.socket_member(0).requested_close(), None);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_document_paste_of_the_same_size_is_not_metered_as_presence() {
    not_metered(&update(&vec![b'x'; 100_000]), 6).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_update_storm_of_the_same_size_is_not_a_resync_storm() {
    not_metered(&update(b" once"), 12).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn draining_refuses_new_upgrades_with503_and_closes1001() {
    let h = start_endpoint(|_| {}, None).await;
    let mut live = h.dial("/sync/doc-42", &[]).await;
    h.rooms.last_member().close(CloseReason::Draining);
    assert_eq!(live.close_frame().await, CLOSE_DRAINING);
    h.rooms.answer(blok_collab::JoinStatus::Draining, false);
    let refused = h.dial("/sync/doc-42", &[]).await;
    assert_eq!(
        (refused.status, refused.body.as_str()),
        (503, "shutting down\n")
    );
}

// --- SyncSocketMemberTests ------------------------------------------------

fn bare_member() -> SocketMember {
    SocketMember::new(MemberOptions {
        max_queued_bytes: 10,
        ..MemberOptions::default()
    })
}

#[test]
fn the_first_non_forbidden_close_wins_and_maps_the_room_reasons() {
    let (reset, draining) = (bare_member(), bare_member());
    reset.close(CloseReason::Reset);
    reset.close(CloseReason::Draining);
    draining.close(CloseReason::Draining);
    draining.send(vec![1]);
    assert_eq!(
        reset.requested_close(),
        Some(CloseFrame::new(4409, "document reset"))
    );
    assert_eq!(
        draining.requested_close(),
        Some(CloseFrame::new(1001, "server shutting down"))
    );
}

#[test]
fn repeated_bad_awareness_closes_as_a_policy_violation() {
    let member = bare_member();
    member.close(CloseReason::BadAwareness);
    assert_eq!(
        member.requested_close(),
        Some(CloseFrame::new(1008, "malformed awareness"))
    );
}

#[test]
fn commit_unavailable_maps_to_the_retryable_commit_status_with_its_own_text() {
    let member = bare_member();
    member.close(CloseReason::CommitUnavailable);
    assert_eq!(
        member.requested_close(),
        Some(CloseFrame::new(4503, "commit unavailable, retry"))
    );
}

#[test]
fn commit_unavailable_shares_seed_faileds_status_but_not_its_text() {
    let member = bare_member();
    member.close(CloseReason::CommitUnavailable);
    let frame = member.requested_close().unwrap();
    assert_eq!(frame.status, CLOSE_SEED_FAILED.status);
    assert_ne!(frame.reason, CLOSE_SEED_FAILED.reason);
}

#[test]
fn commit_unavailable_does_not_fall_through_to_the_internal_error_frame() {
    let member = bare_member();
    member.close(CloseReason::CommitUnavailable);
    assert_ne!(member.requested_close(), Some(CLOSE_INTERNAL));
}

#[test]
fn reset_keeps_its_own_status_and_text() {
    let member = bare_member();
    member.close(CloseReason::Reset);
    assert_eq!(
        member.requested_close(),
        Some(CloseFrame::new(4409, "document reset"))
    );
}

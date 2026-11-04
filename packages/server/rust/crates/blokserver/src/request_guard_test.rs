use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, UNIX_EPOCH};

use crate::testutil::{Answer, Running, fixture_ticket, send, start, start_dual_stack, temp_dir};
use crate::{Options, Server};

// Twins of C#'s BlokServerRequestGuardTests.

const ALLOWED_ORIGIN: &str = "https://app.example.com";
const DISALLOWED_ORIGIN: &str = "https://evil.example.net";

/// StartApplication: unfurl on, storage only when asked.
fn options(auth: &str, rate_limit: i64, storage: bool) -> Options {
    Options {
        auth: auth.into(),
        secret: if auth == "ticket" {
            fixture_ticket("secret")
        } else {
            String::new()
        },
        allowed_origins: vec![ALLOWED_ORIGIN.into()],
        rate_limit_per_minute: rate_limit,
        storage_directory: if storage {
            temp_dir().display().to_string()
        } else {
            String::new()
        },
        public_url: if storage {
            "http://127.0.0.1:4000/files".into()
        } else {
            String::new()
        },
        unfurl_enabled: true,
        ..Options::default()
    }
}

async fn app(options: Options) -> Running {
    start(Server::new(options).unwrap().handler("")).await
}

/// SignPayload with a never-expiring exp, as the C# passes are.
fn signed(user: &str, write: bool) -> String {
    let claims = blok_blokserver_ticket::Claims {
        user: Some(user.into()),
        doc: Some("doc-42".into()),
        write,
        ttl_seconds: None,
    };
    let now = UNIX_EPOCH + Duration::from_secs(4_102_444_800 - 300);
    blok_blokserver_ticket::mint(&fixture_ticket("secret"), &claims, now).unwrap()
}

async fn unfurl_at(
    address: SocketAddr,
    origin: Option<&str>,
    authorization: Option<&str>,
) -> Answer {
    let mut head = "GET /unfurl HTTP/1.1".to_owned();
    if let Some(origin) = origin {
        head.push_str(&format!("\r\nOrigin: {origin}"));
    }
    if let Some(authorization) = authorization {
        head.push_str(&format!("\r\nAuthorization: {authorization}"));
    }
    send(address, &head, b"").await
}

async fn unfurl(running: &Running, origin: Option<&str>, authorization: Option<&str>) -> Answer {
    unfurl_at(running.address, origin, authorization).await
}

async fn preflight(
    running: &Running,
    path: &str,
    origin: Option<&str>,
    requested: Option<&str>,
) -> Answer {
    let method = if path == "/unfurl" { "GET" } else { "POST" };
    let mut head = format!("OPTIONS {path} HTTP/1.1\r\nAccess-Control-Request-Method: {method}");
    if let Some(origin) = origin {
        head.push_str(&format!("\r\nOrigin: {origin}"));
    }
    if let Some(requested) = requested {
        head.push_str(&format!("\r\nAccess-Control-Request-Headers: {requested}"));
    }
    send(running.address, &head, b"").await
}

fn bearer(pass: &str) -> String {
    format!("Bearer {pass}")
}

#[track_caller]
fn assert_shell(got: &Answer) {
    assert_eq!(
        (got.status, got.header("Content-Type"), got.text().as_str()),
        (400, "application/json", "{\"success\":0}\n")
    );
}

#[track_caller]
fn assert_rate_limited(got: &Answer) {
    assert_eq!(
        (got.status, got.header("Content-Type"), got.text().as_str()),
        (429, "text/plain; charset=utf-8", "rate limit exceeded\n")
    );
}

#[track_caller]
fn assert_allowed_cors(got: &Answer) {
    assert_eq!(
        (
            got.headers_all("Access-Control-Allow-Origin"),
            got.headers_all("Vary")
        ),
        (vec![ALLOWED_ORIGIN], vec!["Origin"])
    );
}

#[track_caller]
fn assert_no_cors(got: &Answer) {
    assert!(
        got.headers_all("Access-Control-Allow-Origin").is_empty()
            && got.headers_all("Vary").is_empty(),
        "{:?}",
        got.headers
    );
}

#[tokio::test]
async fn preserves_the_ticket_authorization_grammar() {
    let running = app(options("ticket", 0, false)).await;
    let compatible = fixture_ticket("compatible");
    for authorization in [bearer(&compatible), compatible.clone()] {
        let got = unfurl(&running, Some(ALLOWED_ORIGIN), Some(&authorization)).await;
        assert_shell(&got);
        assert_allowed_cors(&got);
    }
    for (authorization, body) in [
        (None, "missing pass\n"),
        (Some(bearer(&fixture_ticket("malformed"))), "invalid pass\n"),
        (Some(bearer(&fixture_ticket("expired"))), "invalid pass\n"),
        (Some(bearer(&fixture_ticket("tampered"))), "invalid pass\n"),
        (
            Some(bearer(&fixture_ticket("noncanonicalHeaderTicket"))),
            "invalid pass\n",
        ),
        (Some(format!("bearer {compatible}")), "invalid pass\n"),
    ] {
        let got = unfurl(&running, Some(ALLOWED_ORIGIN), authorization.as_deref()).await;
        assert_eq!(
            (got.status, got.header("Content-Type"), got.text().as_str()),
            (401, "text/plain; charset=utf-8", body),
            "{authorization:?}"
        );
        assert_allowed_cors(&got);
    }
}

#[tokio::test]
async fn answers_anonymous_preflights_and_rejects_other_origins() {
    for auth in ["none", "proxy", "ticket"] {
        let running = app(options(auth, 1, true)).await;
        for (path, methods) in [
            ("/unfurl", "GET, OPTIONS"),
            ("/upload", "POST, OPTIONS"),
            ("/upload-by-url", "POST, OPTIONS"),
        ] {
            let got = preflight(
                &running,
                path,
                Some(ALLOWED_ORIGIN),
                Some("authorization, x-tenant-id"),
            )
            .await;
            assert_eq!(
                (
                    got.status,
                    got.text().as_str(),
                    got.headers_all("Content-Type").is_empty(),
                    got.headers_all("Access-Control-Allow-Origin"),
                    got.headers_all("Access-Control-Allow-Methods"),
                    got.headers_all("Access-Control-Allow-Headers"),
                    got.headers_all("Access-Control-Max-Age"),
                    got.headers_all("Vary"),
                ),
                (
                    204,
                    "",
                    true,
                    vec![ALLOWED_ORIGIN],
                    vec![methods],
                    vec!["authorization, x-tenant-id"],
                    vec!["600"],
                    vec!["Access-Control-Request-Headers", "Origin"],
                ),
                "{auth} {path}"
            );
        }
        for origin in [Some(DISALLOWED_ORIGIN), None] {
            let got = preflight(&running, "/unfurl", origin, None).await;
            assert_eq!(
                (got.status, got.header("Content-Type"), got.text().as_str()),
                (403, "text/plain; charset=utf-8", "origin not allowed\n"),
                "{auth} {origin:?}"
            );
            assert_no_cors(&got);
        }
    }
}

#[tokio::test]
async fn rejects_read_only_tickets_on_write_routes() {
    for path in ["/upload", "/upload-by-url"] {
        let running = app(options("ticket", 0, true)).await;
        let got = send(
            running.address,
            &format!(
                "POST {path} HTTP/1.1\r\nOrigin: {ALLOWED_ORIGIN}\r\nAuthorization: Bearer {}",
                signed("reader", false)
            ),
            b"",
        )
        .await;
        assert_eq!(
            (got.status, got.text().as_str()),
            (403, "write access required\n"),
            "{path}"
        );
        assert_allowed_cors(&got);
    }
}

#[tokio::test]
async fn allows_read_only_tickets_to_unfurl() {
    let running = app(options("ticket", 0, false)).await;
    let got = unfurl(
        &running,
        Some(ALLOWED_ORIGIN),
        Some(&bearer(&signed("reader", false))),
    )
    .await;
    assert_shell(&got);
}

#[tokio::test]
async fn rejected_origins_do_not_spend_the_rate_limit() {
    let running = app(options("ticket", 1, false)).await;
    for _ in 0..3 {
        let got = unfurl(&running, Some(DISALLOWED_ORIGIN), None).await;
        assert_eq!(got.status, 403);
    }
    let compatible = bearer(&fixture_ticket("compatible"));
    assert_shell(&unfurl(&running, Some(ALLOWED_ORIGIN), Some(&compatible)).await);
    assert_rate_limited(&unfurl(&running, Some(ALLOWED_ORIGIN), Some(&compatible)).await);
}

#[tokio::test]
async fn rejected_tickets_do_not_spend_the_rate_limit() {
    let running = app(options("ticket", 1, false)).await;
    let malformed = bearer(&fixture_ticket("malformed"));
    for _ in 0..3 {
        let got = unfurl(&running, Some(ALLOWED_ORIGIN), Some(&malformed)).await;
        assert_eq!(got.status, 401);
    }
    let compatible = bearer(&fixture_ticket("compatible"));
    assert_shell(&unfurl(&running, Some(ALLOWED_ORIGIN), Some(&compatible)).await);
    assert_rate_limited(&unfurl(&running, Some(ALLOWED_ORIGIN), Some(&compatible)).await);
}

#[tokio::test]
async fn preflights_do_not_spend_the_rate_limit() {
    let running = app(options("ticket", 1, false)).await;
    for _ in 0..3 {
        let got = preflight(
            &running,
            "/unfurl",
            Some(ALLOWED_ORIGIN),
            Some("authorization"),
        )
        .await;
        assert_eq!(got.status, 204);
    }
    let compatible = bearer(&fixture_ticket("compatible"));
    assert_shell(&unfurl(&running, Some(ALLOWED_ORIGIN), Some(&compatible)).await);
    assert_rate_limited(&unfurl(&running, Some(ALLOWED_ORIGIN), Some(&compatible)).await);
}

#[tokio::test]
async fn uses_independent_ticket_user_buckets() {
    let running = app(options("ticket", 1, false)).await;
    let compatible = bearer(&fixture_ticket("compatible"));
    assert_shell(&unfurl(&running, Some(ALLOWED_ORIGIN), Some(&compatible)).await);
    assert_rate_limited(&unfurl(&running, Some(ALLOWED_ORIGIN), Some(&compatible)).await);
    let user_two = bearer(&fixture_ticket("userTwo"));
    assert_shell(&unfurl(&running, Some(ALLOWED_ORIGIN), Some(&user_two)).await);
}

#[tokio::test]
async fn resets_at_sixty_seconds_from_the_first_accepted_request() {
    let now = Arc::new(Mutex::new(UNIX_EPOCH + Duration::from_secs(1_700_000_000)));
    let clock = Arc::clone(&now);
    let running = app(Options {
        clock: Some(Arc::new(move || *clock.lock().unwrap())),
        ..options("ticket", 1, false)
    })
    .await;
    let advance = |seconds| *now.lock().unwrap() += Duration::from_secs(seconds);
    let compatible = bearer(&fixture_ticket("compatible"));
    assert_shell(&unfurl(&running, Some(ALLOWED_ORIGIN), Some(&compatible)).await);
    advance(59);
    assert_rate_limited(&unfurl(&running, Some(ALLOWED_ORIGIN), Some(&compatible)).await);
    advance(1);
    assert_shell(&unfurl(&running, Some(ALLOWED_ORIGIN), Some(&compatible)).await);
}

/// C# sets RemoteIpAddress from a test header; here the two client
/// addresses are the IPv4 and IPv6 loopbacks. None on a machine with no
/// IPv6 loopback, as host-cli-contract skips its IPv6 rows there.
async fn two_client_addresses(options: Options) -> Option<(Running, SocketAddr, SocketAddr)> {
    if tokio::net::TcpListener::bind("[::1]:0").await.is_err() {
        eprintln!("no IPv6 loopback: skipped");
        return None;
    }
    let running = start_dual_stack(Server::new(options).unwrap().handler("")).await;
    let port = running.address.port();
    let v4 = SocketAddr::from(([127, 0, 0, 1], port));
    let v6 = SocketAddr::from((std::net::Ipv6Addr::LOCALHOST, port));
    Some((running, v4, v6))
}

#[tokio::test]
async fn uses_client_address_buckets_outside_ticket_mode() {
    for auth in ["none", "proxy"] {
        let Some((_running, a, b)) = two_client_addresses(options(auth, 1, false)).await else {
            return;
        };
        assert_shell(&unfurl_at(a, None, None).await);
        assert_rate_limited(&unfurl_at(a, None, None).await);
        assert_shell(&unfurl_at(b, None, None).await);
    }
}

#[tokio::test]
async fn uses_client_address_when_a_ticket_has_no_user() {
    let Some((_running, a, b)) = two_client_addresses(options("ticket", 1, false)).await else {
        return;
    };
    let ticket = bearer(&signed("", true));
    assert_shell(&unfurl_at(a, Some(ALLOWED_ORIGIN), Some(&ticket)).await);
    assert_rate_limited(&unfurl_at(a, Some(ALLOWED_ORIGIN), Some(&ticket)).await);
    assert_shell(&unfurl_at(b, Some(ALLOWED_ORIGIN), Some(&ticket)).await);
}

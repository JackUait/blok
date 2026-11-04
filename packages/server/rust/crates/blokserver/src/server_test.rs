use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use blok_auth::{Authorization, BoxFuture, Error, User};
use blok_http::{Request, ResponseWriter};

use super::*;
use crate::testutil::{send, start, temp_dir};

const GUARD_SECRET: &str = "s3cret-value-at-least-32-chars-long!";

fn pass(write: bool, doc: Option<&str>) -> String {
    pass_at(write, doc, SystemTime::now())
}

fn pass_at(write: bool, doc: Option<&str>, now: SystemTime) -> String {
    let claims = blok_blokserver_ticket::Claims {
        user: "u1".into(),
        doc: doc.map(str::to_owned),
        write,
        ttl_seconds: None,
    };
    blok_blokserver_ticket::mint(GUARD_SECRET, &claims, now).unwrap()
}

fn ticket_server() -> Server {
    Server::new(Options {
        auth: "ticket".into(),
        secret: GUARD_SECRET.into(),
        allowed_origins: vec!["https://app.example.com".into()],
        storage_directory: temp_dir().display().to_string(),
        public_url: "/files".into(),
        ..Options::default()
    })
    .unwrap()
}

// BlokServerRequestGuardTests: every guarded route that is not GET needs a
// write pass.
#[tokio::test]
async fn guard_refuses_a_read_only_pass_on_a_write_route() {
    let running = start(ticket_server().handler("")).await;
    let body = br#"{"url":"x"}"#;
    let got = send(
        running.address,
        &format!(
            "POST /delete HTTP/1.1\r\nOrigin: https://app.example.com\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}",
            pass(false, None),
            body.len()
        ),
        body,
    )
    .await;
    assert_eq!(
        (
            got.status,
            got.text().as_str(),
            got.header("Access-Control-Allow-Origin")
        ),
        (403, "write access required\n", "https://app.example.com")
    );
}

/// Runs the guard on a loopback request and answers with what it decided.
async fn guarded(server: &Server, head: &str) -> String {
    let inner = Arc::clone(&server.inner);
    let running = start(move |mut request: Request, mut response: ResponseWriter| {
        let inner = Arc::clone(&inner);
        async move {
            if guard(&inner, &mut request, &mut response, true).await {
                let text = format!("{:?}", user_from(&request));
                write_text(&mut response, 200, &text).await;
            }
        }
    })
    .await;
    let got = send(running.address, head, b"").await;
    format!("{} {}", got.status, got.text())
}

// The doc claim is not checked on the HTTP routes, and the verified pass is
// on the request for the handlers.
#[tokio::test]
async fn guard_ignores_the_doc_claim_and_sets_the_user() {
    let got = guarded(
        &ticket_server(),
        &format!(
            "GET /health HTTP/1.1\r\nOrigin: https://app.example.com\r\nAuthorization: Bearer {}",
            pass(true, Some("other-doc"))
        ),
    )
    .await;
    let want = User {
        id: "u1".into(),
        name: "u1".into(),
        doc: "other-doc".into(),
        write: true,
        authenticated: true,
    };
    assert_eq!(got, format!("200 {:?}", Some(&want)));
}

// MapBlokServer(pattern) maps the routes in a group under pattern, with a
// "/{**path}" 404 inside it, and maps local files BEFORE the group, at the
// public URL path from the app root.
#[tokio::test]
async fn handler_mounts_under_a_prefix_and_serves_files_from_the_root() {
    let directory = temp_dir();
    let server = Server::new(Options {
        storage_directory: directory.display().to_string(),
        public_url: "https://uploads.example.com/files/".into(),
        ..Options::default()
    })
    .unwrap();
    let key = format!("{}.txt", "a".repeat(32));
    std::fs::write(directory.join(&key), "stored").unwrap();
    let running = start(server.handler("/blok/")).await;
    for (path, status, body) in [
        ("/blok/health".to_owned(), 200, ""),
        ("/health".to_owned(), 404, "404 page not found\n"),
        ("/blok/nothing-here".to_owned(), 404, "404 page not found\n"),
        (format!("/files/{key}"), 200, "stored"),
        (format!("/blok/files/{key}"), 404, "404 page not found\n"),
    ] {
        let got = send(running.address, &format!("GET {path} HTTP/1.1"), b"").await;
        assert!(
            got.status == status && (body.is_empty() || got.text() == body),
            "GET {path}: got {} {:?}, want {status} {body:?}",
            got.status,
            got.text()
        );
    }
}

struct DenyAll(AtomicUsize);

impl Authorization for DenyAll {
    fn can_read_document<'a>(
        &'a self,
        _: &'a User,
        _: &'a str,
    ) -> BoxFuture<'a, Result<bool, Error>> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(false) })
    }
    fn can_write_document<'a>(
        &'a self,
        _: &'a User,
        _: &'a str,
    ) -> BoxFuture<'a, Result<bool, Error>> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(false) })
    }
}

// IBlokAuthorization.cs:20-54 narrows document access only; the upload and
// delete routes never consult it.
#[tokio::test]
async fn authorization_is_not_consulted_off_the_document_routes() {
    let deny = Arc::new(DenyAll(AtomicUsize::new(0)));
    let server = Server::new(Options {
        storage_directory: temp_dir().display().to_string(),
        public_url: "https://uploads.example.com/files/".into(),
        unfurl_enabled: true,
        authorization: Some(Arc::clone(&deny) as Arc<dyn Authorization>),
        ..Options::default()
    })
    .unwrap();
    let running = start(server.handler("")).await;
    let body = "--b\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.txt\"\r\n\r\nx\r\n--b--\r\n";
    let got = send(
        running.address,
        &format!("POST /upload HTTP/1.1\r\nContent-Type: multipart/form-data; boundary=b\r\nContent-Length: {}", body.len()),
        body.as_bytes(),
    )
    .await;
    assert_eq!(got.status, 200, "upload: {}", got.text());
    let missing = format!(
        r#"{{"url":"https://uploads.example.com/files/{}.txt"}}"#,
        "b".repeat(32)
    );
    let got = send(
        running.address,
        &format!(
            "POST /delete HTTP/1.1\r\nContent-Type: application/json\r\nContent-Length: {}",
            missing.len()
        ),
        missing.as_bytes(),
    )
    .await;
    assert_eq!(got.status, 200, "delete: {}", got.text());
    assert_eq!(deny.0.load(Ordering::SeqCst), 0);
}

#[tokio::test]
#[ignore = "GET /unfurl needs the outbound crate; until it is plugged in the route is not mapped"]
async fn authorization_is_not_consulted_on_unfurl() {}

// AddBlokServer TryAdds TimeProvider.System, so a host's own clock drives the
// guard's ticket check.
#[tokio::test]
async fn options_clock_drives_the_ticket_check() {
    let then = UNIX_EPOCH + Duration::from_secs(1_577_934_245);
    for (name, clock, ok) in [
        (
            "host clock at mint time",
            Some(then + Duration::from_secs(60)),
            true,
        ),
        ("system clock", None, false),
    ] {
        let server = Server::new(Options {
            auth: "ticket".into(),
            secret: GUARD_SECRET.into(),
            allowed_origins: vec!["https://app.example.com".into()],
            clock: clock.map(|at| Arc::new(move || at) as crate::Clock),
            ..Options::default()
        })
        .unwrap();
        let got = guarded(
            &server,
            &format!(
                "GET /health HTTP/1.1\r\nOrigin: https://app.example.com\r\nAuthorization: Bearer {}",
                pass_at(true, None, then)
            ),
        )
        .await;
        assert_eq!(got.starts_with("200 "), ok, "{name}: {got}");
    }
}

// C# validates the registered options again whenever it builds a service.
// The server validates once, so it must keep a copy a caller cannot change.
#[tokio::test]
async fn new_keeps_its_own_copy_of_the_options() {
    let mut options = Options {
        allowed_origins: vec!["https://app.example.com".into()],
        rich_text_fields: [("card".to_owned(), vec!["body".to_owned()])].into(),
        ..Options::default()
    };
    let server = Server::new(options.clone()).unwrap();
    options.allowed_origins[0] = "https://evil.example".into();
    options
        .rich_text_fields
        .insert("other".into(), vec!["x".into()]);
    let got = guarded(
        &server,
        "GET /health HTTP/1.1\r\nOrigin: https://app.example.com",
    )
    .await;
    assert!(got.starts_with("200 "), "{got}");
    assert_eq!(server.options().rich_text_fields.len(), 1);
}

#[test]
#[ignore = "the S3 blob store is not ported yet (blob lane)"]
fn s3_store_spools_to_the_temp_dir_up_to_the_upload_cap() {}

#[test]
#[ignore = "PurgeDocument needs the collab rooms and collabstore, not ported yet"]
fn a_host_can_tell_every_purge_refusal_apart() {}

#[test]
fn rate_limit_windows_reset_after_a_minute() {
    let now = Arc::new(std::sync::Mutex::new(UNIX_EPOCH));
    let clock = Arc::clone(&now);
    let limiter = RateLimiter::new(2, Arc::new(move || *clock.lock().unwrap()));
    assert!(limiter.allow("a") && limiter.allow("a") && !limiter.allow("a"));
    assert!(limiter.allow("b"));
    *now.lock().unwrap() += Duration::from_secs(60);
    assert!(limiter.allow("a"));
}

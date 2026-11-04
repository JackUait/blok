use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, UNIX_EPOCH};

use blok_blob::{Body, BoxFuture, Cancelled, Error as BlobError, Store};

use crate::testutil::{Answer, Running, send, start, temp_dir};
use crate::{Options, Server};

// Twins of C#'s DeleteEndpointTests.

const ALLOWED_ORIGIN: &str = "https://app.example.com";
const PUBLIC_URL: &str = "https://uploads.example.test/files";
const STORED_KEY: &str = "0123456789abcdef0123456789abcdef.png";
const TICKET_SECRET: &str = "delete-endpoint-secret-value-at-least-32-chars";

/// RecordingBlobStore: the URL of every delete.
#[derive(Default)]
struct Recording(Mutex<Vec<String>>);

impl Store for Recording {
    fn put<'a>(
        &'a self,
        _: &'a str,
        _: &'a str,
        _: Body<'a>,
        _: Cancelled<'a>,
    ) -> BoxFuture<'a, Result<String, BlobError>> {
        unreachable!("the delete tests never upload")
    }

    fn delete<'a>(
        &'a self,
        url: &'a str,
        _: Cancelled<'a>,
    ) -> BoxFuture<'a, Result<(), BlobError>> {
        self.0.lock().unwrap().push(url.to_owned());
        Box::pin(async { Ok(()) })
    }
}

impl Recording {
    fn deletes(&self) -> Vec<String> {
        self.0.lock().unwrap().clone()
    }
}

fn options(directory: &Path, auth: &str) -> Options {
    Options {
        auth: auth.into(),
        secret: if auth == "ticket" {
            TICKET_SECRET.into()
        } else {
            String::new()
        },
        allowed_origins: vec![ALLOWED_ORIGIN.into()],
        storage_directory: directory.display().to_string(),
        public_url: PUBLIC_URL.into(),
        unfurl_enabled: true,
        ..Options::default()
    }
}

/// StartApplication: the server on a recording store.
async fn recorded_app(auth: &str) -> (Running, Arc<Recording>) {
    let server = Server::new(options(&temp_dir(), auth)).unwrap();
    let store = Arc::new(Recording::default());
    assert!(
        server
            .inner
            .store
            .set(Ok(Arc::clone(&store) as Arc<dyn Store>))
            .is_ok()
    );
    (start(server.handler("")).await, store)
}

/// SeedStoredBlobAsync + StartLocalApplication.
async fn local_app() -> (Running, PathBuf) {
    let directory = temp_dir();
    let path = directory.join(STORED_KEY);
    std::fs::write(&path, [1, 2, 3]).unwrap();
    let server = Server::new(options(&directory, "none")).unwrap();
    (start(server.handler("")).await, path)
}

/// C#'s Delete sends Origin; its bare PostAsync rows do not.
async fn post(
    running: &Running,
    origin: bool,
    content_type: Option<&str>,
    ticket: Option<&str>,
    body: &str,
) -> Answer {
    let origin = if origin {
        format!("\r\nOrigin: {ALLOWED_ORIGIN}")
    } else {
        String::new()
    };
    let mut head = format!(
        "POST /delete HTTP/1.1{origin}\r\nContent-Length: {}",
        body.len()
    );
    if let Some(content_type) = content_type {
        head.push_str(&format!("\r\nContent-Type: {content_type}"));
    }
    if let Some(ticket) = ticket {
        head.push_str(&format!("\r\nAuthorization: Bearer {ticket}"));
    }
    send(running.address, &head, body.as_bytes()).await
}

async fn delete(running: &Running, url: &str, ticket: Option<&str>) -> Answer {
    let body = format!(r#"{{"url":"{url}"}}"#);
    post(
        running,
        true,
        Some("application/json; charset=utf-8"),
        ticket,
        &body,
    )
    .await
}

fn signed(user: &str, write: bool) -> String {
    let claims = blok_blokserver_ticket::Claims {
        user: Some(user.into()),
        doc: None,
        write,
        ttl_seconds: None,
    };
    let now = UNIX_EPOCH + Duration::from_secs(4_102_444_800 - 300);
    blok_blokserver_ticket::mint(TICKET_SECRET, &claims, now).unwrap()
}

#[track_caller]
fn assert_error(got: &Answer, status: u16, body: &str) {
    assert_eq!(
        (got.status, got.header("Content-Type"), got.text().as_str()),
        (status, "text/plain; charset=utf-8", body)
    );
}

#[tokio::test]
async fn answers_not_found_for_a_key_this_store_could_not_have_generated() {
    for url in [
        format!("{PUBLIC_URL}/notes.txt"),
        format!("{PUBLIC_URL}/0123456789abcdef.png"),
        format!("{PUBLIC_URL}/0123456789ABCDEF0123456789ABCDEF.png"),
        format!("{PUBLIC_URL}/../0123456789abcdef0123456789abcdef.png"),
        format!("{PUBLIC_URL}/0123456789abcdef0123456789abcdef/../../etc/passwd"),
        format!("{PUBLIC_URL}/"),
    ] {
        let (running, path) = local_app().await;
        let got = delete(&running, &url, None).await;
        assert_eq!(
            (got.status, got.header("Content-Type"), got.text().as_str()),
            (404, "text/plain; charset=utf-8", "not found\n"),
            "{url}"
        );
        assert!(path.exists(), "{url}");
    }
}

#[tokio::test]
async fn rejects_an_anonymous_caller_in_ticket_mode_before_storage() {
    let (running, store) = recorded_app("ticket").await;
    let got = delete(&running, &format!("{PUBLIC_URL}/{STORED_KEY}"), None).await;
    assert_error(&got, 401, "missing pass\n");
    assert!(store.deletes().is_empty());
}

#[tokio::test]
async fn rejects_a_read_only_pass_before_storage() {
    let (running, store) = recorded_app("ticket").await;
    let got = delete(
        &running,
        &format!("{PUBLIC_URL}/{STORED_KEY}"),
        Some(&signed("reader", false)),
    )
    .await;
    assert_error(&got, 403, "write access required\n");
    assert!(store.deletes().is_empty());
}

#[tokio::test]
async fn accepts_a_write_pass_in_ticket_mode() {
    let (running, store) = recorded_app("ticket").await;
    let url = format!("{PUBLIC_URL}/{STORED_KEY}");
    let got = delete(&running, &url, Some(&signed("writer", true))).await;
    assert_eq!(got.status, 200, "{}", got.text());
    assert_eq!(store.deletes(), [url]);
}

#[tokio::test]
async fn rejects_unsupported_media_types_before_storage() {
    for content_type in [
        None,
        Some("text/plain"),
        Some("application/x-www-form-urlencoded"),
        Some("application/problem+json"),
        Some("application/json; charset=utf-8; charset=iso-8859-1"),
    ] {
        let (running, store) = recorded_app("none").await;
        let body = format!(r#"{{"url":"{PUBLIC_URL}/{STORED_KEY}"}}"#);
        let got = post(&running, false, content_type, None, &body).await;
        assert_eq!(
            (got.status, got.header("Content-Type"), got.text().as_str()),
            (
                415,
                "text/plain; charset=utf-8",
                "expected application/json\n"
            ),
            "{content_type:?}"
        );
        assert!(store.deletes().is_empty(), "{content_type:?}");
    }
}

#[tokio::test]
async fn rejects_malformed_envelopes_before_storage() {
    for body in [
        "",
        "not json",
        "{}",
        r#"{"url":""}"#,
        r#"{"url":1}"#,
        "null",
        "[]",
    ] {
        let (running, store) = recorded_app("none").await;
        let got = post(
            &running,
            false,
            Some("application/json; charset=utf-8"),
            None,
            body,
        )
        .await;
        assert_eq!(
            (got.status, got.header("Content-Type"), got.text().as_str()),
            (
                400,
                "text/plain; charset=utf-8",
                "expected {\"url\": \"...\"}\n"
            ),
            "{body:?}"
        );
        assert!(store.deletes().is_empty(), "{body:?}");
    }
}

#[tokio::test]
async fn rejects_an_oversized_envelope_before_storage() {
    let (prefix, suffix) = (r#"{"url":""#, r#""}"#);
    let body = format!(
        "{prefix}{}{suffix}",
        "x".repeat((8 << 10) + 1 - prefix.len() - suffix.len())
    );
    assert_eq!(body.len(), 8193);
    let (running, store) = recorded_app("none").await;
    let got = post(
        &running,
        false,
        Some("application/json; charset=utf-8"),
        None,
        &body,
    )
    .await;
    assert_error(&got, 400, "expected {\"url\": \"...\"}\n");
    assert!(store.deletes().is_empty());
}

#[tokio::test]
async fn answers_the_shared_write_route_wire_for_other_methods() {
    let (running, store) = recorded_app("none").await;
    let wrong = send(running.address, "GET /delete HTTP/1.1", b"").await;
    let preflight = send(
        running.address,
        &format!(
            "OPTIONS /delete HTTP/1.1\r\nOrigin: {ALLOWED_ORIGIN}\r\nAccess-Control-Request-Method: POST"
        ),
        b"",
    )
    .await;
    assert_eq!(
        (wrong.status, wrong.header("Allow")),
        (405, "OPTIONS, POST")
    );
    assert_eq!(
        (
            preflight.status,
            preflight.headers_all("Access-Control-Allow-Methods")
        ),
        (204, vec!["POST, OPTIONS"])
    );
    assert!(store.deletes().is_empty());
}

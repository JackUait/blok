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
        user: Some("u1".into()),
        doc: doc.map(Into::into),
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
        _request: &'a blok_auth::Extensions,
    ) -> BoxFuture<'a, Result<bool, Error>> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(false) })
    }
    fn can_write_document<'a>(
        &'a self,
        _: &'a User,
        _: &'a str,
        _request: &'a blok_auth::Extensions,
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
    let got = send(running.address, "GET /unfurl HTTP/1.1", b"").await;
    assert_eq!(got.status, 400, "unfurl without a url: {}", got.text());
    assert_eq!(deny.0.load(Ordering::SeqCst), 0);
}

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

// L6: the S3 store spools to Path.GetTempPath() and caps the spool at
// MaxUploadBytes (BlokServerServiceCollectionExtensions.cs:210-226).
#[test]
fn s3_store_spools_to_the_temp_dir_up_to_the_upload_cap() {
    let options = Options {
        s3_endpoint: "https://s3.example.com".into(),
        s3_region: "us-east-1".into(),
        s3_bucket: "media".into(),
        s3_access_key: "a".into(),
        s3_secret_key: "b".into(),
        max_upload_bytes: 12345,
        ..Options::default()
    };
    let s3 = s3_options(&options);
    assert_eq!((s3.max_spool_bytes, s3.temp_dir.clone()), (12345, None));
    assert!(blok_blob::S3::new(s3).is_ok());
}

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

// Options.clock is the TimeProvider override, and S3 signing reads it as
// Go's blob.S3 Now does.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_options_clock_signs_s3_requests() {
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let record = Arc::clone(&seen);
    let s3 = start(move |mut request: Request, mut response: ResponseWriter| {
        let record = Arc::clone(&record);
        async move {
            let date = request.headers().get("x-amz-date").unwrap_or("").to_owned();
            record.lock().unwrap().push(date);
            if let Some(body) = request.body_mut() {
                let mut sink = Vec::new();
                let _ = body.read_to_end(&mut sink).await;
            }
            response.set_status(200);
        }
    })
    .await;
    let then = UNIX_EPOCH + Duration::from_secs(1_577_934_245);
    let server = Server::new(Options {
        s3_endpoint: format!("http://127.0.0.1:{}", s3.address.port()),
        s3_region: "us-east-1".into(),
        s3_bucket: "media".into(),
        s3_bucket_url: "https://cdn.example.com/media".into(),
        s3_addressing: "path".into(),
        s3_access_key: "a".into(),
        s3_secret_key: "b".into(),
        clock: Some(Arc::new(move || then)),
        ..Options::default()
    })
    .unwrap();
    let store = server.inner.blob_store().unwrap();
    let never = || false;
    store
        .put(
            ".txt",
            "text/plain",
            blok_blob::Body::bytes(b"hi".to_vec()),
            &never,
        )
        .await
        .unwrap();
    assert_eq!(seen.lock().unwrap().as_slice(), ["20200102T030405Z"]);
}

// A browser writes a non-ASCII host in punycode, and Kestrel cannot echo
// one: such an origin is never allowed, even when listed (3d9ee2e9).
#[tokio::test]
async fn a_non_ascii_origin_is_never_allowed() {
    let server = Server::new(Options {
        allowed_origins: vec!["http://\u{e9}.example".into()],
        unfurl_enabled: true,
        ..Options::default()
    })
    .unwrap();
    let running = start(server.handler("")).await;
    let got = send(
        running.address,
        "OPTIONS /unfurl HTTP/1.1\r\nOrigin: http://\u{e9}.example\r\nAccess-Control-Request-Method: GET",
        b"",
    )
    .await;
    assert_eq!(
        (got.status, got.text().as_str()),
        (403, "origin not allowed\n")
    );
}

// S3 wins over a set StorageDirectory, and no local file route is mapped.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn registers_the_shared_s3_store_when_a_bucket_is_configured() {
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let record = Arc::clone(&seen);
    let s3 = start(move |mut request: Request, mut response: ResponseWriter| {
        let record = Arc::clone(&record);
        async move {
            record.lock().unwrap().push(request.path().to_owned());
            if let Some(body) = request.body_mut() {
                let mut sink = Vec::new();
                let _ = body.read_to_end(&mut sink).await;
            }
            response.set_status(200);
        }
    })
    .await;
    let options = Options {
        storage_directory: "/unused/local/storage".into(),
        s3_endpoint: format!("http://127.0.0.1:{}", s3.address.port()),
        s3_region: "eu-central-1".into(),
        s3_bucket: "media".into(),
        s3_bucket_url: "https://cdn.example.com/media".into(),
        s3_addressing: "path".into(),
        s3_access_key: "access-key".into(),
        s3_secret_key: "secret-key".into(),
        ..Options::default()
    };
    let server = Server::new(options.clone()).unwrap();
    let never = || false;
    server
        .inner
        .blob_store()
        .unwrap()
        .put(
            ".txt",
            "text/plain",
            blok_blob::Body::bytes(b"hi".to_vec()),
            &never,
        )
        .await
        .unwrap();
    let paths = seen.lock().unwrap().clone();
    assert!(
        paths.len() == 1 && paths[0].starts_with("/media/"),
        "{paths:?}"
    );

    let server = Server::new(Options {
        public_url: "/files".into(),
        ..options
    })
    .unwrap();
    let running = start(server.handler("")).await;
    let got = send(
        running.address,
        &format!("GET /files/{}.txt HTTP/1.1", "a".repeat(32)),
        b"",
    )
    .await;
    assert_eq!(
        (got.status, got.text().as_str()),
        (404, "404 page not found\n")
    );
}

#[tokio::test]
async fn active_routes_keep_their_rejected_preflight_wire() {
    let server = Server::new(Options {
        storage_directory: temp_dir().display().to_string(),
        public_url: "http://127.0.0.1:4000/files".into(),
        unfurl_enabled: true,
        ..Options::default()
    })
    .unwrap();
    let running = start(server.handler("")).await;
    for path in ["/unfurl", "/upload", "/upload-by-url"] {
        let got = send(running.address, &format!("OPTIONS {path} HTTP/1.1"), b"").await;
        assert_eq!(
            (got.status, got.header("Content-Type"), got.text().as_str()),
            (403, "text/plain; charset=utf-8", "origin not allowed\n"),
            "{path}"
        );
    }
}

#[tokio::test]
async fn preserves_the_go_method_and_unknown_route_responses() {
    let server = Server::new(Options {
        storage_directory: String::new(),
        unfurl_enabled: false,
        ..Options::default()
    })
    .unwrap();
    let running = start(server.handler("")).await;
    let got = send(running.address, "POST /health HTTP/1.1", b"").await;
    assert_eq!(
        (
            got.status,
            got.header("Allow"),
            got.header("Content-Type"),
            got.text().as_str()
        ),
        (
            405,
            "GET, HEAD",
            "text/plain; charset=utf-8",
            "Method Not Allowed\n"
        )
    );
    for path in ["/missing", "/upload"] {
        let got = send(running.address, &format!("GET {path} HTTP/1.1"), b"").await;
        assert_eq!(
            (got.status, got.header("Content-Type"), got.text().as_str()),
            (404, "text/plain; charset=utf-8", "404 page not found\n"),
            "{path}"
        );
    }
}

/// A host's own authentication: 401 unless X-Test-User is set.
fn require_test_user(next: Arc<dyn blok_http::Handler>) -> Arc<dyn blok_http::Handler> {
    Arc::new(move |request: Request, mut response: ResponseWriter| {
        let next = Arc::clone(&next);
        async move {
            if request.headers().get("X-Test-User").is_none() {
                response.set_status(401);
                return;
            }
            next.serve(request, response).await;
        }
    })
}

async fn authorized() -> crate::testutil::Running {
    let server = Server::new(Options {
        allowed_origins: vec!["https://app.example.test".into()],
        unfurl_enabled: true,
        ..Options::default()
    })
    .unwrap();
    start(server.handler_with_auth("/blok", require_test_user)).await
}

// BlokServerRegistrationTests 'ApplicationAuthorizationProtectsGuardedRoutesOnly':
// MapBlokServer(...).RequireAuthorization() keeps /health and CORS
// preflights anonymous (AllowAnonymous).
#[tokio::test]
async fn application_authorization_protects_guarded_routes_only() {
    let running = authorized().await;
    for (head, status) in [
        ("GET /blok/unfurl HTTP/1.1", 401),
        ("GET /blok/unfurl HTTP/1.1\r\nX-Test-User: signed-in", 400),
        ("GET /blok/health HTTP/1.1", 200),
        (
            "OPTIONS /blok/unfurl HTTP/1.1\r\nOrigin: https://app.example.test\r\nAccess-Control-Request-Method: GET",
            204,
        ),
    ] {
        let got = send(running.address, head, b"").await;
        assert_eq!(got.status, status, "{head}");
    }
}

// BlokServerRegistrationTests 'ApplicationAuthorizationCoversTheFallbacksButNotHealth':
// the group's 405 fallbacks and its catch-all 404 need the host's auth;
// /health's 405 and a path outside the group do not.
#[tokio::test]
async fn application_authorization_covers_the_fallbacks_but_not_health() {
    let running = authorized().await;
    for (head, status) in [
        ("PUT /blok/unfurl HTTP/1.1", 401),
        ("GET /blok/missing HTTP/1.1", 401),
        ("PUT /blok/health HTTP/1.1", 405),
        ("GET /elsewhere HTTP/1.1", 404),
    ] {
        let got = send(running.address, head, b"").await;
        assert_eq!(got.status, status, "{head}");
    }
}

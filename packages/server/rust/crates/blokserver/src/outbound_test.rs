use std::sync::Arc;
use std::time::Duration;

use blok_blob::{Body as BlobBody, BoxFuture, Cancelled, Error as BlobError, Store};
use blok_http::{Request, ResponseWriter};
use blok_outbound::{ExactOriginPolicy, Failure, Limits, is_failure};
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::io::AsyncReadExt;

use tokio::sync::Notify;

use crate::Options;
use crate::server::Server;
use crate::testutil::{Answer, Recording, Running, open, send, start, temp_dir};

use super::*;

fn outbound_server() -> Server {
    outbound_server_with(32 << 20)
}

fn outbound_server_with(max_upload_bytes: i64) -> Server {
    Server::new(Options {
        storage_directory: temp_dir().display().to_string(),
        public_url: "https://uploads.example.com/files/".into(),
        unfurl_enabled: true,
        max_upload_bytes,
        ..Options::default()
    })
    .unwrap()
}

/// Lets the server reach only the origin at address.
fn reach(server: &Server, address: std::net::SocketAddr) -> String {
    let origin = format!("http://127.0.0.1:{}", address.port());
    server.inner.set_policy(Arc::new(ExactOriginPolicy {
        origin: origin.clone(),
        port: address.port(),
    }));
    origin
}

/// Holds put until released.
struct BlockingStore {
    entered: Arc<Notify>,
    release: Arc<Notify>,
}

impl Store for BlockingStore {
    fn put<'a>(
        &'a self,
        extension: &'a str,
        _mime_type: &'a str,
        content: BlobBody<'a>,
        _cancelled: Cancelled<'a>,
    ) -> BoxFuture<'a, Result<String, BlobError>> {
        Box::pin(async move {
            if let BlobBody::Stream(mut stream) = content {
                let mut sink = Vec::new();
                let _ = stream.read_to_end(&mut sink).await;
            }
            self.entered.notify_one();
            self.release.notified().await;
            Ok(format!(
                "https://uploads.example.com/files/{}{extension}",
                "a".repeat(32)
            ))
        })
    }

    fn delete<'a>(
        &'a self,
        _url: &'a str,
        _cancelled: Cancelled<'a>,
    ) -> BoxFuture<'a, Result<(), BlobError>> {
        Box::pin(async { Ok(()) })
    }
}

// UploadByUrlEndpoint.cs:90 holds the response (and its fetch slot) with
// `await using` until PutAsync returns, so a slow store still counts
// against the four outbound fetches.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn upload_by_url_holds_its_fetch_slot_until_the_store_returns() {
    let origin_server = start(
        |_request: Request, mut response: ResponseWriter| async move {
            response.headers_mut().set("Content-Type", "image/png");
            let _ = response.write(b"png").await;
        },
    )
    .await;
    let server = outbound_server();
    let origin = reach(&server, origin_server.address);
    let store = Arc::new(BlockingStore {
        entered: Arc::new(Notify::new()),
        release: Arc::new(Notify::new()),
    });
    let (entered, release) = (Arc::clone(&store.entered), Arc::clone(&store.release));
    assert!(server.inner.store.set(Ok(store as Arc<dyn Store>)).is_ok());
    let running = start(server.handler("")).await;
    let body = format!(r#"{{"url":"{origin}/photo.png"}}"#);
    let address = running.address;
    let upload = tokio::spawn(async move {
        send(
            address,
            &format!(
                "POST /upload-by-url HTTP/1.1\r\nContent-Type: application/json\r\nContent-Length: {}",
                body.len()
            ),
            body.as_bytes(),
        )
        .await
    });
    tokio::time::timeout(Duration::from_secs(5), entered.notified())
        .await
        .expect("upload-by-url never reached the store");

    let fetcher = server.inner.fetcher();
    let limits = Limits {
        timeout: Duration::from_millis(200),
        max_bytes: 1 << 20,
        max_redirects: 0,
        hop: None,
        truncate: false,
    };
    let mut held = Vec::new();
    for i in 0..3 {
        let fetched = fetcher.get(&format!("{origin}/"), &limits).await;
        held.push(
            fetched.unwrap_or_else(|e| panic!("fetch {} of the three free slots: {e:?}", i + 1)),
        );
    }
    let fourth = fetcher.get(&format!("{origin}/"), &limits).await;
    assert!(
        is_failure(&fourth, Failure::TimedOut),
        "a fourth fetch during put got {:?}",
        fourth.err()
    );
    release.notify_one();
    let answer = upload.await.unwrap();
    assert_eq!(answer.status, 200, "{}", answer.text());
    drop(held);
}

// /unfurl echoes the asked URL and the page's metadata. The JSON encoder
// must keep < > & ' as \uXXXX so the body never holds markup, even if a
// browser opens it as a page. C# gets this from the default JsonSerializer.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unfurl_never_echoes_markup() {
    let origin_server = start(|_request: Request, mut response: ResponseWriter| async move {
        response.headers_mut().set("Content-Type", "text/html");
        let page = "<html><head><title>&lt;/title&gt;&lt;script&gt;alert('t')&lt;/script&gt;</title>\
            <meta property=\"og:description\" content=\"&lt;img src=x onerror=alert(&quot;d&quot;)&gt;\"></head></html>";
        let _ = response.write(page.as_bytes()).await;
    })
    .await;
    let server = outbound_server();
    let origin = reach(&server, origin_server.address);
    let running = start(server.handler("")).await;
    let target = format!("{origin}/?q=<script>alert('q')</script>&r=\"'&amp;");
    let got = send(
        running.address,
        &format!("GET /unfurl?url={} HTTP/1.1", query_escape(&target)),
        b"",
    )
    .await;
    let body = got.text();
    assert!(body.contains("\"success\":1"), "{body}");
    assert!(
        !body.contains(['<', '>', '&', '\'']),
        "the body holds raw markup: {body}"
    );
    assert_eq!(got.header("Content-Type"), "application/json");
}

/// url.QueryEscape: unreserved bytes kept, space as '+', the rest %XX.
fn query_escape(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            b' ' => "+".to_owned(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

const STORED_URL: &str = "https://uploads.example.test/files/blob";

/// What a test origin answers.
#[derive(Clone, Default)]
struct Reply {
    status: u16,
    content_type: Option<String>,
    location: Option<String>,
    body: Vec<u8>,
}

fn ok(content_type: &str, body: &[u8]) -> Reply {
    Reply {
        status: 200,
        content_type: Some(content_type.to_owned()),
        body: body.to_vec(),
        ..Reply::default()
    }
}

fn redirect(location: &str) -> Reply {
    Reply {
        status: 302,
        location: Some(location.to_owned()),
        ..Reply::default()
    }
}

/// An origin that answers each request target with reply(target), and
/// counts its requests.
async fn origin(
    reply: impl Fn(&str) -> Reply + Send + Sync + 'static,
) -> (Running, Arc<AtomicUsize>) {
    let hits = Arc::new(AtomicUsize::new(0));
    let (reply, counted) = (Arc::new(reply), Arc::clone(&hits));
    let running = start(move |request: Request, mut response: ResponseWriter| {
        let reply = reply(request.target());
        counted.fetch_add(1, Ordering::SeqCst);
        async move {
            response.set_status(reply.status);
            if let Some(content_type) = reply.content_type {
                response.headers_mut().set("Content-Type", &content_type);
            }
            if let Some(location) = reply.location {
                response.headers_mut().set("Location", &location);
            }
            let _ = response.write(&reply.body).await;
        }
    })
    .await;
    (running, hits)
}

struct UrlUpload {
    _origin: Running,
    running: Running,
    origin: String,
    hits: Arc<AtomicUsize>,
    store: Arc<Recording>,
}

async fn url_upload(
    max_upload_bytes: i64,
    reply: impl Fn(&str) -> Reply + Send + Sync + 'static,
) -> UrlUpload {
    url_upload_into(Recording::new(STORED_URL), max_upload_bytes, reply).await
}

async fn url_upload_into(
    store: Recording,
    max_upload_bytes: i64,
    reply: impl Fn(&str) -> Reply + Send + Sync + 'static,
) -> UrlUpload {
    let (origin_server, hits) = origin(reply).await;
    let server = outbound_server_with(max_upload_bytes);
    let origin = reach(&server, origin_server.address);
    let store = store.install(&server);
    let running = start(server.handler("")).await;
    UrlUpload {
        _origin: origin_server,
        running,
        origin,
        hits,
        store,
    }
}

impl UrlUpload {
    async fn post(&self, content_type: Option<&str>, body: &str) -> Answer {
        let mut head = format!(
            "POST /upload-by-url HTTP/1.1\r\nContent-Length: {}",
            body.len()
        );
        if let Some(content_type) = content_type {
            head.push_str(&format!("\r\nContent-Type: {content_type}"));
        }
        send(self.running.address, &head, body.as_bytes()).await
    }

    /// Posts {"url": url} as C#'s StringContent does.
    async fn post_url(&self, url: &str) -> Answer {
        self.post(JSON, &format!(r#"{{"url":"{url}"}}"#)).await
    }

    fn fetches(&self) -> usize {
        self.hits.load(Ordering::SeqCst)
    }
}

const JSON: Option<&str> = Some("application/json; charset=utf-8");

fn assert_error(got: &Answer, status: u16, text: &str) {
    assert_eq!(
        (got.status, got.header("Content-Type"), got.text().as_str()),
        (status, "text/plain; charset=utf-8", text)
    );
}

fn any_hop() -> Arc<dyn Fn() -> bool + Send + Sync> {
    Arc::new(|| true)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rejects_unsupported_or_conflicting_media_types_before_fetching() {
    let upload = url_upload(32 << 20, |_| ok("image/png", b"imagebytes")).await;
    let body = format!(r#"{{"url":"{}/file"}}"#, upload.origin);
    for content_type in [
        None,
        Some("text/plain"),
        Some("application/problem+json"),
        Some("application/json-patch+json"),
        Some("application/json; charset=utf-8; charset=iso-8859-1"),
    ] {
        let got = upload.post(content_type, &body).await;
        assert_error(&got, 415, "expected application/json\n");
    }
    assert_eq!((upload.fetches(), upload.store.calls()), (0, 0));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rejects_malformed_or_oversized_envelopes_before_fetching() {
    let upload = url_upload(32 << 20, |_| ok("image/png", b"imagebytes")).await;
    let oversized = format!(r#"{{"url":"{}"}}"#, "x".repeat(8 << 10));
    for body in [
        "",
        "not json",
        "{}",
        r#"{"url":""}"#,
        r#"{"url":1}"#,
        "null",
        "[]",
        oversized.as_str(),
    ] {
        let got = upload.post(JSON, body).await;
        assert_error(&got, 400, "expected {\"url\": \"...\"}\n");
    }
    assert_eq!((upload.fetches(), upload.store.calls()), (0, 0));
}

/// EnvelopeWithClosingByteAt: {"url":"..."} with its last byte at
/// position, the url being base then x padding.
fn envelope_ending_at(base: &str, position: usize) -> String {
    let url = format!("{base}{}", "x".repeat(position - 10 - base.len()));
    format!(r#"{{"url":"{url}"}}"#)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn accepts_a_valid_envelope_ending_at_eight_ki_b() {
    let upload = url_upload(32 << 20, |_| ok("image/png", b"imagebytes")).await;
    let body = envelope_ending_at(&format!("{}/", upload.origin), 8 << 10);
    assert_eq!(body.len(), 8 << 10);
    let got = upload.post(JSON, &body).await;
    assert_eq!(got.status, 200, "{}", got.text());
    assert_eq!((upload.fetches(), upload.store.puts().len()), (1, 1));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rejects_an_envelope_whose_closing_byte_is_at_eight_ki_b_plus_one() {
    let upload = url_upload(32 << 20, |_| ok("image/png", b"imagebytes")).await;
    let body = envelope_ending_at(&format!("{}/", upload.origin), (8 << 10) + 1);
    assert_eq!(body.len(), (8 << 10) + 1);
    let got = upload.post(JSON, &body).await;
    assert_error(&got, 400, "expected {\"url\": \"...\"}\n");
    assert_eq!((upload.fetches(), upload.store.calls()), (0, 0));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rejects_an_oversized_envelope_whose_first_eight_ki_b_are_valid_json() {
    let upload = url_upload(32 << 20, |_| ok("image/png", b"imagebytes")).await;
    let envelope = format!(r#"{{"url":"{}/file"}}"#, upload.origin);
    let body = format!("{envelope:<width$}x", width = 8 << 10);
    assert_eq!(body.len(), (8 << 10) + 1);
    let got = upload.post(JSON, &body).await;
    assert_error(&got, 400, "expected {\"url\": \"...\"}\n");
    assert_eq!((upload.fetches(), upload.store.calls()), (0, 0));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rejects_a_trailing_json_value_before_fetching() {
    let upload = url_upload(32 << 20, |_| ok("image/png", b"imagebytes")).await;
    let body = format!(r#"{{"url":"{}/file"}} {{}}"#, upload.origin);
    let got = upload.post(JSON, &body).await;
    assert_error(&got, 400, "expected {\"url\": \"...\"}\n");
    assert_eq!((upload.fetches(), upload.store.calls()), (0, 0));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn every_guard_failure_returns_the_exact_bad_request_and_media_limits() {
    let upload = url_upload(12345, |target| match target {
        "/fits" => ok("image/png", &[7; 12345]),
        "/too-large" => ok("image/png", &[7; 12346]),
        _ => match target
            .strip_prefix("/hop/")
            .and_then(|n| n.parse::<u8>().ok())
        {
            Some(0) => ok("image/png", b"imagebytes"),
            Some(n) => redirect(&format!("/hop/{}", n - 1)),
            None => Reply {
                status: 404,
                ..Reply::default()
            },
        },
    })
    .await;
    let origin = upload.origin.clone();
    let fits = upload.post_url(&format!("{origin}/fits")).await;
    assert_eq!(fits.status, 200, "{}", fits.text());
    let five = upload.post_url(&format!("{origin}/hop/5")).await;
    assert_eq!(five.status, 200, "{}", five.text());
    for url in [
        "file:///etc/passwd".to_owned(),
        format!("{origin}/too-large"),
        format!("{origin}/hop/6"),
    ] {
        let got = upload.post_url(&url).await;
        assert_error(&got, 400, "the URL could not be fetched\n");
    }
    assert_eq!(upload.store.calls(), 2);

    // TimedOut cannot be waited out in a test: the limits show it.
    let limits = upload_by_url_limits(12345, any_hop());
    assert_eq!(
        (limits.timeout, limits.max_bytes, limits.max_redirects),
        (Duration::from_secs(120), 12345, 5)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn propagates_request_cancellation_to_the_fetcher() {
    let entered = Arc::new(Notify::new());
    let cancelled = Arc::new(Notify::new());
    let (seen_entered, seen_cancelled) = (Arc::clone(&entered), Arc::clone(&cancelled));
    let origin_server = start(move |request: Request, _response: ResponseWriter| {
        let (entered, cancelled) = (Arc::clone(&seen_entered), Arc::clone(&seen_cancelled));
        async move {
            entered.notify_one();
            let token = request.cancel_token();
            if tokio::time::timeout(Duration::from_secs(6), token.cancelled())
                .await
                .is_ok()
            {
                cancelled.notify_one();
            }
        }
    })
    .await;
    let server = outbound_server();
    let origin = reach(&server, origin_server.address);
    let store = Recording::new(STORED_URL).install(&server);
    let running = start(server.handler("")).await;
    let body = format!(r#"{{"url":"{origin}/file"}}"#);
    let conn = open(
        running.address,
        &format!(
            "POST /upload-by-url HTTP/1.1\r\nContent-Type: application/json\r\nContent-Length: {}",
            body.len()
        ),
        body.as_bytes(),
    )
    .await;
    tokio::time::timeout(Duration::from_secs(5), entered.notified())
        .await
        .expect("the fetch never reached the origin");
    drop(conn);
    tokio::time::timeout(Duration::from_secs(5), cancelled.notified())
        .await
        .expect("the fetch was not cancelled");
    assert_eq!(store.calls(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rejects_every_representative_non_two_hundred_status_before_storage() {
    let upload = url_upload(32 << 20, |target| Reply {
        status: target[1..].parse().unwrap(),
        content_type: Some("image/png".into()),
        body: b"imagebytes".to_vec(),
        ..Reply::default()
    })
    .await;
    for status in [301, 404, 502, 300] {
        let got = upload
            .post_url(&format!("{}/{status}", upload.origin))
            .await;
        assert_error(&got, 400, "the URL could not be fetched\n");
    }
    assert_eq!(upload.store.calls(), 0);
    // The fetcher reads a 1xx as interim and waits for the final status.
    assert!(!is_success(199));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn accepts_every_representative_two_hundred_status() {
    for status in [200, 203, 226, 299] {
        let upload = url_upload(32 << 20, move |_| Reply {
            status,
            ..Reply::default()
        })
        .await;
        let got = upload.post_url(&format!("{}/", upload.origin)).await;
        assert_eq!(
            (got.status, got.text().as_str()),
            (200, format!("{{\"url\":\"{STORED_URL}\"}}\n").as_str()),
            "status {status}"
        );
        let puts = upload.store.puts();
        assert_eq!(puts.len(), 1, "status {status}");
        assert_eq!(
            (puts[0].extension.as_str(), puts[0].mime_type.as_str()),
            ("", "")
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stores_exact_bytes_with_final_name_mime_and_response_size() {
    let bytes = [0u8, 1, 2, 127, 128, 255];
    let upload = url_upload(32 << 20, move |target| match target {
        "/redirect" => redirect("/final/photo.JPEG?download=1#ignored"),
        _ => Reply {
            status: 206,
            content_type: Some(" image/jpeg; profile=web ".into()),
            body: bytes.to_vec(),
            ..Reply::default()
        },
    })
    .await;
    let got = upload
        .post_url(&format!("{}/redirect", upload.origin))
        .await;
    assert_eq!(got.status, 200, "{}", got.text());
    assert_eq!(got.header("Content-Type"), "application/json");
    assert_eq!(
        got.text(),
        format!(
            "{{\"url\":\"{STORED_URL}\",\"fileName\":\"photo.JPEG\",\"size\":6,\"mimeType\":\"image/jpeg; profile=web\"}}\n"
        )
    );
    let puts = upload.store.puts();
    assert_eq!(puts.len(), 1);
    assert_eq!(
        (
            puts[0].extension.as_str(),
            puts[0].mime_type.as_str(),
            puts[0].bytes.as_slice()
        ),
        (".jpeg", "image/jpeg; profile=web", bytes.as_slice())
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn percent_decodes_the_final_url_file_name() {
    let upload = url_upload(32 << 20, |target| match target {
        "/file" => redirect("/final/photo%20one.PNG?download=1"),
        _ => ok("image/png", &[1]),
    })
    .await;
    let got = upload.post_url(&format!("{}/file", upload.origin)).await;
    assert_eq!(
        got.text(),
        format!(
            "{{\"url\":\"{STORED_URL}\",\"fileName\":\"photo one.PNG\",\"size\":1,\"mimeType\":\"image/png\"}}\n"
        )
    );
    let puts = upload.store.puts();
    assert_eq!(puts.len(), 1);
    assert_eq!(puts[0].extension, ".png");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn omits_a_name_for_a_pathless_or_trailing_slash_final_url() {
    for path in ["", "/", "/folder/", "/a/../"] {
        let upload = url_upload(32 << 20, |_| ok("image/png", &[1])).await;
        let got = upload.post_url(&format!("{}{path}", upload.origin)).await;
        assert_eq!(
            got.text(),
            format!("{{\"url\":\"{STORED_URL}\",\"size\":1,\"mimeType\":\"image/png\"}}\n"),
            "path {path:?}"
        );
        let puts = upload.store.puts();
        assert_eq!(puts.len(), 1, "path {path:?}");
        assert_eq!(puts[0].extension, "", "path {path:?}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn drops_invalid_conflicting_or_overlong_media_types() {
    let maximum = format!("text/plain; x={}", "a".repeat(241));
    assert_eq!(maximum.len(), 255);
    for content_type in [
        String::new(),
        "   ".to_owned(),
        "not a media type".to_owned(),
        "text/plain; charset=utf-8; charset=iso-8859-1".to_owned(),
        format!("{maximum}a"),
    ] {
        let served = content_type.clone();
        let upload = url_upload(32 << 20, move |_| ok(&served, &[1])).await;
        let got = upload
            .post_url(&format!("{}/file.bin", upload.origin))
            .await;
        assert_eq!(
            (got.status, got.text()),
            (
                200,
                format!("{{\"url\":\"{STORED_URL}\",\"fileName\":\"file.bin\",\"size\":1}}\n")
            ),
            "{content_type:?}"
        );
        let puts = upload.store.puts();
        assert_eq!(puts.len(), 1);
        assert_eq!(puts[0].mime_type, "", "{content_type:?}");
    }
}

// C#'s ObjectDisposedException check has no Rust twin: the fetched body is
// moved into the store's input and dropped with it.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn propagates_request_cancellation_to_storage_and_disposes_its_input() {
    let mut store = Recording::new(STORED_URL);
    store.wait_for_cancel = true;
    let upload = url_upload_into(store, 32 << 20, |_| ok("image/png", b"imagebytes")).await;
    let body = format!(r#"{{"url":"{}/file.png"}}"#, upload.origin);
    let conn = open(
        upload.running.address,
        &format!(
            "POST /upload-by-url HTTP/1.1\r\nContent-Type: application/json\r\nContent-Length: {}",
            body.len()
        ),
        body.as_bytes(),
    )
    .await;
    tokio::time::timeout(Duration::from_secs(5), upload.store.entered.notified())
        .await
        .expect("upload-by-url never reached the store");
    drop(conn);
    let started = std::time::Instant::now();
    while !upload.store.saw_cancel.load(Ordering::SeqCst) {
        assert!(
            started.elapsed() < Duration::from_secs(7),
            "the store never saw the cancellation"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// Holds four fetches at once: all four slots must be free.
async fn assert_all_fetch_slots_free(server: &Server, origin: &str) {
    let fetcher = server.inner.fetcher();
    let limits = Limits {
        timeout: Duration::from_millis(500),
        max_bytes: 1 << 20,
        max_redirects: 0,
        hop: None,
        truncate: false,
    };
    let mut held = Vec::new();
    for i in 0..4 {
        let fetched = fetcher.get(&format!("{origin}/"), &limits).await;
        held.push(fetched.unwrap_or_else(|e| panic!("fetch {} of four: {e:?}", i + 1)));
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn disposes_fetched_response_after_storage_finishes() {
    let (origin_server, _) = origin(|_| ok("image/png", b"imagebytes")).await;
    let server = outbound_server();
    let origin = reach(&server, origin_server.address);
    Recording::new(STORED_URL).install(&server);
    let running = start(server.handler("")).await;
    let body = format!(r#"{{"url":"{origin}/file.png"}}"#);
    let got = send(
        running.address,
        &format!(
            "POST /upload-by-url HTTP/1.1\r\nContent-Type: application/json\r\nContent-Length: {}",
            body.len()
        ),
        body.as_bytes(),
    )
    .await;
    assert_eq!(got.status, 200, "{}", got.text());
    assert_all_fetch_slots_free(&server, &origin).await;
}

/// GETs /unfurl?url=target.
async fn unfurl_get(address: std::net::SocketAddr, target: &str) -> Answer {
    send(
        address,
        &format!("GET /unfurl?url={} HTTP/1.1", query_escape(target)),
        b"",
    )
    .await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fetches_through_the_registered_guard_with_frozen_limits() {
    let head = "<title>Plain title</title>\n\
        <meta name=\"description\" content=\"Plain description\">\n\
        <meta name=\"twitter:title\" content=\"Twitter title\">\n\
        <meta name=\"twitter:description\" content=\"Twitter description\">\n\
        <meta name=\"twitter:image\" content=\"/twitter.png\">\n\
        <meta property=\"og:title\" content=\"OpenGraph title\">\n\
        <meta property=\"og:description\" content=\"OpenGraph description\">\n\
        <meta property=\"og:image\" content=\"https://cdn.example.com/images/cover.png?size=2\">\n\
        <link rel=\"icon\" href=\"https://cdn.example.com/final/favicon.svg\">\n";
    let (origin_server, hits) = origin(move |target| match target {
        "/redirect" => redirect("/final/page.html?from=redirect"),
        "/fits" => ok("text/html", &vec![b' '; 2 << 20]),
        "/too-large" => ok("text/html", &vec![b' '; (2 << 20) + 1]),
        _ => ok("application/json", head.as_bytes()),
    })
    .await;
    let server = outbound_server();
    let origin = reach(&server, origin_server.address);
    let running = start(server.handler("")).await;
    let got = unfurl_get(running.address, &format!("{origin}/redirect")).await;
    assert_eq!(got.status, 200);
    assert_eq!(got.header("Content-Type"), "application/json");
    assert_eq!(
        got.text(),
        format!(
            "{{\"success\":1,\"link\":\"{origin}/final/page.html?from=redirect\",\"meta\":{{\"title\":\"OpenGraph title\",\"description\":\"OpenGraph description\",\"image\":{{\"url\":\"https://cdn.example.com/images/cover.png?size=2\"}},\"favicon\":\"https://cdn.example.com/final/favicon.svg\",\"domain\":\"127.0.0.1\"}}}}\n"
        )
    );
    assert_eq!(hits.load(Ordering::SeqCst), 2);

    let fits = unfurl_get(running.address, &format!("{origin}/fits")).await;
    assert!(
        fits.text().starts_with("{\"success\":1,"),
        "{}",
        fits.text()
    );
    let too_large = unfurl_get(running.address, &format!("{origin}/too-large")).await;
    assert_eq!(too_large.text(), "{\"success\":0}\n");
    // The 10 s timeout cannot be waited out in a test: the limits show it.
    let limits = unfurl_limits(any_hop());
    assert_eq!(
        (limits.timeout, limits.max_bytes, limits.max_redirects),
        (Duration::from_secs(10), 2 << 20, 5)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn non_two_hundred_status_is_not_parsed() {
    let (origin_server, _) = origin(|target| Reply {
        status: target[1..].parse().unwrap(),
        content_type: Some("text/html".into()),
        body: b"<title>Error page</title>".to_vec(),
        ..Reply::default()
    })
    .await;
    let server = outbound_server();
    let origin = reach(&server, origin_server.address);
    let running = start(server.handler("")).await;
    for status in [301, 401, 404, 429, 502] {
        let got = unfurl_get(running.address, &format!("{origin}/{status}")).await;
        assert_eq!(
            (got.status, got.text().as_str()),
            (200, "{\"success\":0}\n"),
            "status {status}"
        );
    }
}

// A loopback page gets no /favicon.ico fallback (browser_url drops a
// non-public URL), so the page names a public icon to show the field.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn every_two_hundred_status_is_parsed() {
    let (origin_server, _) = origin(|target| Reply {
        status: target[1..].parse().unwrap(),
        body: b"<title>T</title><link rel=\"icon\" href=\"https://cdn.example.com/favicon.ico\">"
            .to_vec(),
        ..Reply::default()
    })
    .await;
    let server = outbound_server();
    let origin = reach(&server, origin_server.address);
    let running = start(server.handler("")).await;
    for status in [200, 203, 226] {
        let got = unfurl_get(running.address, &format!("{origin}/{status}")).await;
        assert_eq!(
            (got.status, got.text()),
            (
                200,
                format!(
                    "{{\"success\":1,\"link\":\"{origin}/{status}\",\"meta\":{{\"title\":\"T\",\"image\":{{}},\"favicon\":\"https://cdn.example.com/favicon.ico\",\"domain\":\"127.0.0.1\"}}}}\n"
                )
            ),
            "status {status}"
        );
    }
}

// A guarded fetch's final URL always has a host, so the empty-domain
// answer is reached only through the body builder.
#[test]
fn empty_metadata_scalars_are_omitted_but_image_remains_an_object() {
    let body = unfurl_body(":", &blok_unfurl::parse(b"", ":"));
    assert_eq!(
        String::from_utf8(body).unwrap(),
        "{\"success\":1,\"link\":\":\",\"meta\":{\"image\":{}}}\n"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn disposes_fetched_response_after_parsing() {
    let (origin_server, _) = origin(|_| ok("text/html", b"<title>T</title>")).await;
    let server = outbound_server();
    let origin = reach(&server, origin_server.address);
    let running = start(server.handler("")).await;
    let got = unfurl_get(running.address, &format!("{origin}/a")).await;
    assert!(got.text().starts_with("{\"success\":1,"), "{}", got.text());
    assert_all_fetch_slots_free(&server, &origin).await;
}

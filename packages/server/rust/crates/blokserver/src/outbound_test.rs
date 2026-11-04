use std::sync::Arc;
use std::time::Duration;

use blok_blob::{Body as BlobBody, BoxFuture, Cancelled, Error as BlobError, Store};
use blok_http::{Request, ResponseWriter};
use blok_outbound::{ExactOriginPolicy, Failure, Limits, is_failure};
use tokio::io::AsyncReadExt;
use tokio::sync::Notify;

use crate::Options;
use crate::server::Server;
use crate::testutil::{send, start, temp_dir};

fn outbound_server() -> Server {
    Server::new(Options {
        storage_directory: temp_dir().display().to_string(),
        public_url: "https://uploads.example.com/files/".into(),
        unfurl_enabled: true,
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

// The shared fixture (file-bytes-responses.json) runs the server as a
// process; these cover what a process run cannot: the clock, the cache size,
// a body with no length and a client that stops reading.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use blok_http::{Request, ResponseWriter};
use blok_outbound::{ExactOriginPolicy, Limits};
use tokio::io::AsyncWriteExt;

use crate::Options;
use crate::server::Server;
use crate::testutil::{Running, send, start};

use super::*;

fn test_pdf(size: usize) -> Vec<u8> {
    let mut body = b"%PDF-1.7".to_vec();
    body.resize(size.max(8), b'x');
    body.truncate(size);
    body
}

struct PdfOrigin {
    running: Running,
    ranges: Arc<Mutex<Vec<String>>>,
}

impl PdfOrigin {
    fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.running.address.port())
    }

    fn seen(&self) -> Vec<String> {
        self.ranges.lock().unwrap().clone()
    }
}

/// Serves body for every path, with one-range support unless chunked, which
/// sends it with no length.
async fn start_pdf_origin(body: Vec<u8>, chunked: bool) -> PdfOrigin {
    let ranges = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&ranges);
    let body = Arc::new(body);
    let running = start(move |request: Request, mut response: ResponseWriter| {
        let range = request.headers().get("Range").unwrap_or("").to_owned();
        seen.lock().unwrap().push(range.clone());
        let body = Arc::clone(&body);
        async move {
            if chunked {
                let _ = response.start(200).await;
                for chunk in body.chunks(512) {
                    let _ = response.write(chunk).await;
                    let _ = response.flush().await;
                }
                return;
            }
            let span = range
                .strip_prefix("bytes=")
                .and_then(|spec| spec.split_once('-'))
                .and_then(|(start, end)| {
                    Some((start.parse::<usize>().ok()?, end.parse::<usize>().ok()?))
                });
            if let Some((start, end)) = span {
                let headers = response.headers_mut();
                headers.set(
                    "Content-Range",
                    format!("bytes {start}-{end}/{}", body.len()),
                );
                headers.set("Content-Length", (end - start + 1).to_string());
                let _ = response.start(206).await;
                let _ = response.write(&body[start..=end]).await;
                return;
            }
            response
                .headers_mut()
                .set("Content-Length", body.len().to_string());
            let _ = response.start(200).await;
            let _ = response.write(&body).await;
        }
    })
    .await;
    PdfOrigin { running, ranges }
}

fn file_bytes_server(origin: &PdfOrigin, mut options: Options) -> Server {
    options.file_bytes_enabled = true;
    let server = Server::new(options).unwrap();
    let port = origin.running.address.port();
    server.inner.set_policy(Arc::new(ExactOriginPolicy {
        origin: origin.url(),
        port,
    }));
    server
}

async fn front(server: &Server) -> Running {
    start(server.handler("")).await
}

async fn get_file_bytes(front: SocketAddr, target: &str, range: &str) -> (u16, Vec<u8>) {
    let mut head = format!("GET /file-bytes?url={} HTTP/1.1", query_escape(target));
    if !range.is_empty() {
        head.push_str(&format!("\r\nRange: {range}"));
    }
    let answer = send(front, &head, b"").await;
    (answer.status, answer.body)
}

/// url.QueryEscape: unreserved bytes kept, the rest %XX.
fn query_escape(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[test]
fn file_bytes_and_files_cors_are_off_by_default() {
    let o = Options::default();
    assert!(!o.file_bytes_enabled && !o.files_cors);
    assert_eq!(o.file_bytes_max_bytes, 100 << 20);
}

#[test]
fn file_bytes_refuses_a_cap_below_one_byte() {
    let o = Options {
        file_bytes_enabled: true,
        file_bytes_max_bytes: 0,
        ..Options::default()
    };
    assert_eq!(
        o.validate().unwrap_err().to_string(),
        "FileBytesMaxBytes must be a positive number of bytes (got 0)"
    );
    // Only checked when the route is on.
    let off = Options {
        file_bytes_max_bytes: 0,
        ..Options::default()
    };
    assert!(off.validate().is_ok());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn file_bytes_checks_a_url_again_after_ten_minutes() {
    let origin = start_pdf_origin(test_pdf(1500), false).await;
    let now = Arc::new(Mutex::new(
        SystemTime::UNIX_EPOCH + Duration::from_secs(1_767_225_600),
    ));
    let clock = Arc::clone(&now);
    let server = file_bytes_server(
        &origin,
        Options {
            clock: Some(Arc::new(move || *clock.lock().unwrap())),
            ..Options::default()
        },
    );
    let running = front(&server).await;
    let target = format!("{}/doc.pdf", origin.url());
    let middle = || async {
        let (status, _) = get_file_bytes(running.address, &target, "bytes=1000-1099").await;
        assert_eq!(status, 206);
    };

    middle().await;
    middle().await;
    *now.lock().unwrap() += Duration::from_secs(10 * 60 - 1);
    middle().await;
    *now.lock().unwrap() += Duration::from_secs(1);
    middle().await;

    assert_eq!(
        origin.seen(),
        [
            "bytes=1000-1099",
            "bytes=0-1023",
            "bytes=1000-1099",
            "bytes=1000-1099",
            "bytes=1000-1099",
            "bytes=0-1023",
        ]
    );
}

#[test]
fn pdf_check_cache_forgets_the_least_recently_used() {
    let now = SystemTime::now();
    let cache = PdfCheckCache::new(Arc::new(move || now));
    for i in 0..256 {
        cache.add(&i.to_string());
    }
    assert!(cache.has("0"), "0 is gone before the cache is full");
    cache.add("256");
    assert!(
        !cache.has("1"),
        "1, the least recently used, is still there"
    );
    assert!(
        cache.has("0") && cache.has("2") && cache.has("256"),
        "dropped a recent entry"
    );
}

// A body sent with no length is measured after it is read.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn file_bytes_refuses_a_body_of_unknown_length_over_the_cap() {
    let origin = start_pdf_origin(test_pdf(3000), true).await;
    let server = file_bytes_server(
        &origin,
        Options {
            file_bytes_max_bytes: 2048,
            ..Options::default()
        },
    );
    let running = front(&server).await;

    let (status, body) =
        get_file_bytes(running.address, &format!("{}/doc.pdf", origin.url()), "").await;
    assert_eq!((status, body.as_slice()), (413, &b"file too large\n"[..]));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn file_bytes_answers_at_most_one_mebibyte() {
    let origin = start_pdf_origin(test_pdf((1 << 20) + 1), false).await;
    let server = file_bytes_server(&origin, Options::default());
    let running = front(&server).await;
    let target = format!("{}/doc.pdf", origin.url());

    let (status, body) = get_file_bytes(running.address, &target, "bytes=0-1048575").await;
    assert_eq!((status, body.len()), (206, 1 << 20), "a 1 MiB range");
    let (status, body) = get_file_bytes(running.address, &target, "").await;
    assert_eq!(
        (status, body.as_slice()),
        (413, &b"range too large\n"[..]),
        "the whole file"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn file_bytes_serves_a_body_of_unknown_length_under_the_cap() {
    let origin = start_pdf_origin(test_pdf(1500), true).await;
    let server = file_bytes_server(
        &origin,
        Options {
            file_bytes_max_bytes: 2048,
            ..Options::default()
        },
    );
    let running = front(&server).await;

    let (status, body) =
        get_file_bytes(running.address, &format!("{}/doc.pdf", origin.url()), "").await;
    assert_eq!(status, 200);
    assert_eq!(body, test_pdf(1500));
}

// A client that stops reading must not keep an outbound slot: the answer is
// read whole from the origin, the slot freed, and only then written.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn file_bytes_frees_its_fetch_slot_before_writing_to_the_client() {
    let origin = start_pdf_origin(test_pdf(1_000_000), false).await;
    let server = file_bytes_server(&origin, Options::default());
    let running = front(&server).await;

    let socket = tokio::net::TcpSocket::new_v4().unwrap();
    socket.set_recv_buffer_size(1024).unwrap();
    let mut client = socket.connect(running.address).await.unwrap();
    let target = query_escape(&format!("{}/doc.pdf", origin.url()));
    client
        .write_all(
            format!(
                "GET /file-bytes?url={target} HTTP/1.1\r\nHost: x\r\nRange: bytes=0-999999\r\n\r\n"
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while origin.seen().is_empty() {
        assert!(
            std::time::Instant::now() < deadline,
            "the origin never saw the request"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    tokio::time::sleep(Duration::from_millis(200)).await;

    let limits = Limits {
        timeout: Duration::from_millis(200),
        max_bytes: 1 << 20,
        max_redirects: 0,
        hop: None,
        truncate: false,
        upload: true,
        caller: String::new(),
        range: None,
    };
    let fetcher = server.inner.fetcher();
    let mut held = Vec::new();
    for i in 0..4 {
        let fetched = fetcher
            .get(&format!("{}/doc.pdf", origin.url()), &limits)
            .await;
        held.push(fetched.unwrap_or_else(|e| {
            panic!(
                "upload slot {} of 4 is taken while the client stalls: {e:?}",
                i + 1
            )
        }));
    }
    drop(client);
}

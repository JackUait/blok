use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use flate2::Compression;
use flate2::write::GzEncoder;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

use crate::blob::{Body, Store};
use crate::s3::{S3, Settings};
use crate::s3_test::{FakeBucket, bucket_store, deadline, first, no_proxy, test_options};

/// What a raw server saw of one request.
#[derive(Debug, Clone)]
pub struct Seen {
    pub method: String,
    pub target: String,
    pub headers: Vec<(String, String)>,
}

impl Seen {
    pub fn names(&self) -> String {
        let mut names: Vec<String> = self
            .headers
            .iter()
            .map(|(n, _)| n.to_ascii_lowercase())
            .collect();
        names.sort();
        names.join(" ")
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

pub async fn read_request(reader: &mut BufReader<TcpStream>, read_body: bool) -> Option<Seen> {
    let mut line = String::new();
    if reader.read_line(&mut line).await.ok()? == 0 {
        return None;
    }
    let mut parts = line.trim_end().splitn(3, ' ');
    let mut seen = Seen {
        method: parts.next()?.to_owned(),
        target: parts.next()?.to_owned(),
        headers: Vec::new(),
    };
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).await.ok()? == 0 {
            return None;
        }
        let line = line.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            break;
        }
        let (name, value) = line.split_once(':')?;
        seen.headers
            .push((name.to_owned(), value.trim().to_owned()));
    }
    if read_body {
        let length: u64 = seen
            .header("Content-Length")
            .and_then(|l| l.parse().ok())
            .unwrap_or(0);
        tokio::io::copy(&mut (&mut *reader).take(length), &mut tokio::io::sink())
            .await
            .ok()?;
    }
    Some(seen)
}

/// A raw server: each connection's request is read (with its body when
/// `read_body`), recorded, then handed to `handle`.
pub async fn raw_server<F, Fut>(
    read_body: bool,
    handle: F,
) -> (String, Arc<Mutex<Vec<Seen>>>, tokio::task::JoinHandle<()>)
where
    F: Fn(Seen, BufReader<TcpStream>) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = ()> + Send + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let seen2 = seen.clone();
    let handle = Arc::new(handle);
    let task = tokio::spawn(async move {
        while let Ok((tcp, _)) = listener.accept().await {
            let (seen, handle) = (seen2.clone(), handle.clone());
            tokio::spawn(async move {
                let mut reader = BufReader::new(tcp);
                if let Some(request) = read_request(&mut reader, read_body).await {
                    seen.lock().unwrap().push(request.clone());
                    handle(request, reader).await;
                }
            });
        }
    });
    (endpoint, seen, task)
}

fn gzip(data: &[u8]) -> Vec<u8> {
    let mut e = GzEncoder::new(Vec::new(), Compression::default());
    e.write_all(data).unwrap();
    e.finish().unwrap()
}

// Measured from C#'s S3BlobStore over a raw listener: no User-Agent, no
// Accept-Encoding, Content-Length on every request (0 on GET), and a
// gzip-encoded GET body comes back as stored.
#[tokio::test]
async fn sends_only_the_c_sharp_headers_and_reads_raw_bytes() {
    let zipped = gzip(b"hello");
    let answer = zipped.clone();
    let (endpoint, seen, _task) = raw_server(true, move |request, mut conn| {
        let answer = answer.clone();
        async move {
            let response = if request.method == "GET" {
                [
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: {}\r\n\r\n",
                        answer.len()
                    )
                    .into_bytes(),
                    answer,
                ]
                .concat()
            } else {
                b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n".to_vec()
            };
            let _ = conn.get_mut().write_all(&response).await;
        }
    })
    .await;
    let s = S3::build(test_options(&endpoint, "bucket", "path"), no_proxy()).unwrap();
    s.put_object("p/k", b"x").await.unwrap();
    let got = s.get_object("p/k").await.unwrap();
    assert_eq!(got.as_deref(), Some(zipped.as_slice()));
    let seen = seen.lock().unwrap().clone();
    assert_eq!(
        seen[0].names(),
        "authorization content-disposition content-length content-type host x-amz-content-sha256 x-amz-date"
    );
    assert_eq!(
        seen[1].names(),
        "authorization content-length host x-amz-content-sha256 x-amz-date"
    );
    assert_eq!(seen[1].header("Content-Length"), Some("0"));
}

// C# sends Content-Length: 0 for an empty PUT; a chunked PUT is refused by
// S3 and some gateways.
#[tokio::test]
async fn an_empty_put_sends_content_length_zero() {
    let (endpoint, seen, _task) = raw_server(true, |_, mut conn| async move {
        let _ = conn
            .get_mut()
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
            .await;
    })
    .await;
    let dir = crate::local_test::TempDir::new();
    let mut s = S3::build(test_options(&endpoint, "bucket", "path"), no_proxy()).unwrap();
    s.options.temp_dir = Some(dir.0.clone());
    s.put_object("p/k", &[]).await.unwrap();
    s.put(".bin", "", Body::bytes(Vec::new())).await.unwrap();
    s.put(".bin", "", Body::Stream(Box::new(&b""[..])))
        .await
        .unwrap();
    let seen = seen.lock().unwrap().clone();
    assert_eq!(seen.len(), 3);
    for (i, request) in seen.iter().enumerate() {
        assert_eq!(request.header("Content-Length"), Some("0"), "PUT {i}");
        assert_eq!(request.header("Transfer-Encoding"), None, "PUT {i}");
    }
}

#[tokio::test]
async fn puts_a_seekable_body_without_a_temp_file() {
    let bucket = Arc::new(FakeBucket::default());
    let mut s = bucket_store(&bucket);
    let dir = crate::local_test::TempDir::new();
    let not_a_directory = dir.0.join("file-not-a-directory");
    std::fs::write(&not_a_directory, b"").unwrap();
    s.options.temp_dir = Some(not_a_directory);
    let body = "x".repeat(s.options.max_spool_bytes as usize + 1);
    s.put(".bin", "", Body::bytes(body.clone().into_bytes()))
        .await
        .unwrap();
    let r = first(&bucket);
    let hash: String = <sha2::Sha256 as sha2::Digest>::digest(body.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    assert_eq!(bucket.requests.lock().unwrap().len(), 1);
    assert_eq!(r.header("X-Amz-Content-Sha256"), Some(hash.as_str()));
    assert_eq!(
        r.header("Content-Length"),
        Some(body.len().to_string().as_str())
    );
    assert!(
        bucket
            .objects
            .lock()
            .unwrap()
            .values()
            .all(|c| c == body.as_bytes())
    );
}

#[tokio::test]
async fn spool_creates_the_temp_directory() {
    let bucket = Arc::new(FakeBucket::default());
    let mut s = bucket_store(&bucket);
    let dir = crate::local_test::TempDir::new();
    let spool = dir.0.join("missing").join("spool");
    s.options.temp_dir = Some(spool.clone());
    s.put(".bin", "", Body::Stream(Box::new(&b"hello"[..])))
        .await
        .unwrap();
    assert!(crate::local_test::entries(&spool).is_empty());
}

const HEADER_TIMEOUT: Duration = Duration::from_millis(300);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(3);

fn timeout_store(endpoint: &str, request_timeout: Duration) -> S3 {
    S3::build(
        test_options(endpoint, "media", "path"),
        Settings {
            request_timeout,
            header_timeout: HEADER_TIMEOUT,
            ..no_proxy()
        },
    )
    .unwrap()
}

#[tokio::test]
async fn a_bodiless_get_still_waits_for_headers_only_until_the_header_timeout() {
    let (endpoint, _seen, _task) = raw_server(true, |_, conn| async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        drop(conn);
    })
    .await;
    let s = timeout_store(&endpoint, REQUEST_TIMEOUT);
    let start = Instant::now();
    assert!(s.get_object("collab/key").await.is_err());
    let elapsed = start.elapsed();
    assert!(
        elapsed >= HEADER_TIMEOUT && elapsed <= REQUEST_TIMEOUT / 2,
        "failed after {elapsed:?}"
    );
}

#[tokio::test]
async fn the_header_timeout_counts_from_the_end_of_the_body() {
    // Far larger than the socket buffers, so the client is still writing
    // while the server waits; only then is it answered.
    let body = vec![0u8; 64 << 20];
    let length = body.len() as u64;
    let (endpoint, _seen, _task) = raw_server(false, move |_, mut conn| async move {
        tokio::time::sleep(HEADER_TIMEOUT * 3).await;
        let _ = tokio::io::copy(&mut (&mut conn).take(length), &mut tokio::io::sink()).await;
        let _ = conn
            .get_mut()
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
            .await;
    })
    .await;
    // A long request timeout: only the header clock is under test here.
    let s = timeout_store(&endpoint, Duration::from_secs(30));
    s.put_object("collab/key", &body).await.unwrap();
}

#[tokio::test]
async fn a_stalled_response_body_dies_at_the_request_timeout() {
    let (endpoint, _seen, _task) = raw_server(true, |_, mut conn| async move {
        let _ = conn
            .get_mut()
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nab")
            .await;
        tokio::time::sleep(Duration::from_secs(30)).await;
    })
    .await;
    let s = timeout_store(&endpoint, REQUEST_TIMEOUT);
    let start = Instant::now();
    let err = s.get_object("collab/key").await.unwrap_err();
    let elapsed = start.elapsed();
    assert!(deadline(&err), "{err}");
    assert!(
        elapsed >= REQUEST_TIMEOUT && elapsed <= REQUEST_TIMEOUT * 2,
        "failed after {elapsed:?}"
    );
}

// The request timeout reaches the room as a deadline, which the working-set
// guard turns into a store failure.
#[tokio::test]
async fn a_request_timeout_is_the_working_sets_deadline() {
    let (endpoint, _seen, _task) = raw_server(true, |_, mut conn| async move {
        let _ = conn
            .get_mut()
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nab")
            .await;
        tokio::time::sleep(Duration::from_secs(30)).await;
    })
    .await;
    let s = timeout_store(&endpoint, Duration::from_millis(200));
    let err = blok_collab_workingset::ObjectStore::get_object(&s, "collab/key")
        .await
        .unwrap_err();
    assert!(
        matches!(err, blok_collab_workingset::Error::DeadlineExceeded),
        "{err}"
    );
}

// S3BlobStore.CreateHandler: a 10 s connect timeout, no redirects.
#[tokio::test]
async fn the_client_connects_within_ten_seconds_and_follows_no_redirect() {
    let settings = Settings::default();
    assert_eq!(settings.connect_timeout, Duration::from_secs(10));
    assert_eq!(settings.header_timeout, Duration::from_secs(60));
    assert_eq!(settings.request_timeout, Duration::from_secs(300));
    let (endpoint, seen, _task) = raw_server(true, |_, mut conn| async move {
        let _ = conn
            .get_mut()
            .write_all(b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:9/elsewhere\r\nContent-Length: 0\r\n\r\n")
            .await;
    })
    .await;
    let s = S3::build(test_options(&endpoint, "media", "path"), no_proxy()).unwrap();
    let err = s.get_object("k").await.unwrap_err();
    assert!(err.to_string().contains("returned 302"), "{err}");
    assert_eq!(seen.lock().unwrap().len(), 1);
}

// SocketsHttpHandler.ConnectTimeout also bounds the TLS handshake: against
// a listener that never answers the ClientHello, C# failed at its 10 s
// connect cap, not at the request timeout.
#[tokio::test]
async fn a_stalled_tls_handshake_dies_at_the_connect_timeout() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let _task = tokio::spawn(async move {
        let mut held = Vec::new();
        while let Ok((conn, _)) = listener.accept().await {
            held.push(conn);
        }
    });
    let s = S3::build(
        test_options(&format!("https://{address}"), "media", "path"),
        Settings {
            request_timeout: REQUEST_TIMEOUT,
            connect_timeout: HEADER_TIMEOUT,
            ..no_proxy()
        },
    )
    .unwrap();
    let start = Instant::now();
    let err = s.get_object("collab/key").await.unwrap_err();
    let elapsed = start.elapsed();
    assert!(
        elapsed <= REQUEST_TIMEOUT / 2,
        "failed after {elapsed:?} with {err}"
    );
    assert!(err.to_string().contains("handshake"), "{err}");
}

// `var _ ObjectStore = (*blob.S3)(nil)`.
#[test]
fn s3_is_an_object_store() {
    fn store<T: blok_collab_workingset::ObjectStore>() {}
    store::<S3>();
}

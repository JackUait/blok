use std::sync::{Arc, Mutex};
use std::time::Duration;

fn never() -> bool {
    false
}

use tokio::io::AsyncRead;

use crate::blob::{Body, Error, Store};
use crate::local_test::{TempDir, entries};
use crate::s3::{Recorded, S3, Settings};
use crate::s3_test::{deadline, frozen_time, no_proxy, test_options};
use crate::s3_wire_test::raw_server;

// Twins of the S3BlobStoreTests cases with no Go twin.

fn store(
    dir: &TempDir,
    respond: impl Fn(&Recorded) -> (u16, Vec<u8>) + Send + Sync + 'static,
) -> (S3, Arc<Mutex<Vec<Recorded>>>) {
    let mut options = test_options("https://s3.example.com", "media", "");
    options.temp_dir = Some(dir.0.clone());
    let mut s = S3::build(options, no_proxy()).unwrap();
    s.now = std::sync::Arc::new(frozen_time);
    let seen = Arc::new(Mutex::new(Vec::new()));
    let seen2 = seen.clone();
    let s = s.with_fake(Arc::new(move |request: Recorded| {
        let answer = respond(&request);
        seen2.lock().unwrap().push(request);
        answer
    }));
    (s, seen)
}

fn stream(content: &'static [u8]) -> Body<'static> {
    Body::Stream(Box::new(content))
}

#[tokio::test]
async fn deletes_an_owned_url_with_a_signed_empty_payload() {
    let dir = TempDir::new();
    let (s, seen) = store(&dir, |_| (204, Vec::new()));
    let key = format!("{}.png", "a".repeat(32));
    s.delete(
        &format!("https://cdn.example.com/media/{key}?download=1#file"),
        &never,
    )
    .await
    .unwrap();
    let r = seen.lock().unwrap()[0].clone();
    assert_eq!(r.method, "DELETE");
    assert_eq!(
        format!("https://{}{}", r.host, r.path),
        format!("https://s3.example.com/media/{key}")
    );
    assert_eq!(r.header("Content-Length"), Some("0"));
    assert!(r.body.is_empty());
    assert_eq!(
        r.header("X-Amz-Content-Sha256"),
        Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    );
    assert!(
        r.header("Authorization")
            .unwrap()
            .contains("SignedHeaders=host;x-amz-content-sha256;x-amz-date")
    );
}

#[tokio::test]
async fn refuses_a_foreign_delete_without_sending_a_request() {
    let dir = TempDir::new();
    let (s, seen) = store(&dir, |_| (204, Vec::new()));
    let err = s
        .delete(
            &format!("https://evil.example.com/media/{}.png", "a".repeat(32)),
            &never,
        )
        .await
        .unwrap_err();
    assert!(matches!(err, Error::Foreign));
    assert!(seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn truncates_the_upstream_error_body() {
    let dir = TempDir::new();
    let mut body = b"<Error><Code>FixtureFailure</Code></Error>".to_vec();
    body.resize(2048, b' ');
    body[2047] = b'!';
    let (s, _) = store(&dir, move |_| (403, body.clone()));
    let err = s
        .put(
            ".bin",
            "application/octet-stream",
            Body::bytes(b"bytes".to_vec()),
            &never,
        )
        .await
        .unwrap_err();
    let message = err.to_string();
    assert!(message.contains("FixtureFailure"), "{message}");
    assert!(message.len() < 600);
    assert!(!message.contains('!'));
}

#[tokio::test]
async fn spools_a_non_seekable_body_only_for_the_request_lifetime() {
    let dir = TempDir::new();
    let path = dir.0.clone();
    let (s, _) = store(&dir, move |request| {
        let spools = entries(&path);
        assert_eq!(spools.len(), 1, "no spool while sending");
        assert!(spools[0].starts_with("blok-s3-") && spools[0].ends_with(".tmp"));
        assert_eq!(request.body, b"hello");
        (200, Vec::new())
    });
    s.put(".bin", "", stream(b"hello"), &never).await.unwrap();
    assert!(entries(&dir.0).is_empty());
}

#[tokio::test]
async fn removes_the_spool_when_s3_rejects_the_request() {
    let dir = TempDir::new();
    let (s, _) = store(&dir, |_| (500, b"nope".to_vec()));
    assert!(s.put(".bin", "", stream(b"hello"), &never).await.is_err());
    assert!(entries(&dir.0).is_empty());
}

struct Failing;

impl AsyncRead for Failing {
    fn poll_read(
        self: std::pin::Pin<&mut Self>,
        _: &mut std::task::Context<'_>,
        _: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::task::Poll::Ready(Err(std::io::Error::other("connection reset")))
    }
}

#[tokio::test]
async fn removes_the_spool_when_the_input_fails() {
    let dir = TempDir::new();
    let (s, seen) = store(&dir, |_| (200, Vec::new()));
    let err = s
        .put(".bin", "", Body::Stream(Box::new(Failing)), &never)
        .await
        .unwrap_err();
    assert_eq!(err.to_string(), "connection reset");
    assert!(entries(&dir.0).is_empty());
    assert!(seen.lock().unwrap().is_empty());
}

async fn silent_store(
    dir: &TempDir,
    request_timeout: Duration,
) -> (S3, tokio::task::JoinHandle<()>) {
    let (endpoint, _seen, task) = raw_server(true, |_, conn| async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        drop(conn);
    })
    .await;
    let mut options = test_options(&endpoint, "media", "path");
    options.temp_dir = Some(dir.0.clone());
    let s = S3::build(
        options,
        Settings {
            request_timeout,
            ..no_proxy()
        },
    )
    .unwrap();
    (s, task)
}

#[tokio::test]
async fn bounds_the_configured_s3_request_and_removes_the_spool() {
    let dir = TempDir::new();
    let (s, _task) = silent_store(&dir, Duration::from_millis(200)).await;
    let err = s
        .put(".bin", "", stream(b"hello"), &never)
        .await
        .unwrap_err();
    assert!(deadline(&err), "{err}");
    assert!(entries(&dir.0).is_empty());
}

// Cancelling is dropping the put.
#[tokio::test]
async fn removes_the_spool_when_the_s3_request_is_cancelled() {
    let dir = TempDir::new();
    let (s, _task) = silent_store(&dir, Duration::from_secs(30)).await;
    let put = s.put(".bin", "", stream(b"hello"), &never);
    assert!(
        tokio::time::timeout(Duration::from_millis(200), put)
            .await
            .is_err()
    );
    assert!(entries(&dir.0).is_empty());
}

/// Signs what reached the wire and compares it with what was sent.
fn assert_wire_signature(
    seen: &crate::s3_wire_test::Seen,
    options: &crate::s3::S3Options,
    content_type: &str,
) {
    let hash = seen.header("X-Amz-Content-Sha256").unwrap();
    let want = crate::s3::sign(
        &seen.method,
        &seen.target,
        seen.header("Host").unwrap(),
        options,
        content_type,
        hash,
        frozen_time(),
    );
    let authorization = want.iter().find(|(n, _)| n == "Authorization").unwrap();
    assert_eq!(seen.header("Authorization"), Some(authorization.1.as_str()));
    assert_eq!(seen.header("X-Amz-Date"), Some("20250102T030405Z"));
}

async fn wire_store() -> (
    S3,
    Arc<Mutex<Vec<crate::s3_wire_test::Seen>>>,
    tokio::task::JoinHandle<()>,
) {
    use tokio::io::AsyncWriteExt;
    let (endpoint, seen, task) = raw_server(true, |_, mut conn| async move {
        let _ = conn
            .get_mut()
            .write_all(b"HTTP/1.1 204 No Content\r\n\r\n")
            .await;
    })
    .await;
    let mut s = S3::build(test_options(&endpoint, "media", "path"), no_proxy()).unwrap();
    s.now = std::sync::Arc::new(frozen_time);
    (s, seen, task)
}

#[tokio::test]
async fn puts_with_the_exact_on_wire_signature_for_its_generated_target() {
    let (s, seen, _task) = wire_store().await;
    let url = s
        .put(".png", "image/png", Body::bytes(b"bytes".to_vec()), &never)
        .await
        .unwrap();
    let request = seen.lock().unwrap()[0].clone();
    let key = url.rsplit('/').next().unwrap();
    assert_eq!(request.target, format!("/media/{key}"));
    assert_wire_signature(&request, &s.options, "image/png");
}

#[tokio::test]
async fn deletes_with_the_exact_on_wire_signature_for_its_dynamic_target() {
    let (s, seen, _task) = wire_store().await;
    let key = format!("{}.png", "b".repeat(32));
    s.delete(&format!("https://cdn.example.com/media/{key}"), &never)
        .await
        .unwrap();
    let request = seen.lock().unwrap()[0].clone();
    assert_eq!(request.method, "DELETE");
    assert_eq!(request.target, format!("/media/{key}"));
    assert_wire_signature(&request, &s.options, "");
}

// The host's cancel signal stops an S3 put mid-request and removes the spool.
#[tokio::test]
async fn a_cancel_signal_stops_an_s3_put_and_removes_the_spool() {
    let dir = TempDir::new();
    let (s, _task) = silent_store(&dir, Duration::from_secs(30)).await;
    let flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let setter = flag.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(100)).await;
        setter.store(true, std::sync::atomic::Ordering::SeqCst);
    });
    let cancelled = move || flag.load(std::sync::atomic::Ordering::SeqCst);
    let started = std::time::Instant::now();
    let err = s
        .put(".bin", "", stream(b"hello"), &cancelled)
        .await
        .unwrap_err();
    assert!(matches!(err, Error::Cancelled), "{err}");
    assert!(started.elapsed() < Duration::from_secs(2));
    assert!(entries(&dir.0).is_empty());
}

fn flagged() -> (Arc<std::sync::atomic::AtomicBool>, impl Fn() -> bool) {
    let flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let read = flag.clone();
    (flag, move || read.load(std::sync::atomic::Ordering::SeqCst))
}

/// A wire store whose server answers each request with `answer`, then
/// holds or closes the connection as `hold` says.
async fn answering_store(
    dir: &TempDir,
    answer: &'static [u8],
    hold: Option<Duration>,
    settings: Settings,
) -> (S3, tokio::task::JoinHandle<()>) {
    use tokio::io::AsyncWriteExt;
    let (endpoint, _seen, task) = raw_server(true, move |_, mut conn| async move {
        let _ = conn.get_mut().write_all(answer).await;
        if let Some(hold) = hold {
            tokio::time::sleep(hold).await;
        }
        drop(conn);
    })
    .await;
    let mut options = test_options(&endpoint, "media", "path");
    options.temp_dir = Some(dir.0.clone());
    (S3::build(options, settings).unwrap(), task)
}

#[tokio::test]
async fn puts_a_seekable_body_with_known_length_and_returns_the_public_url() {
    let dir = TempDir::new();
    let (s, seen) = store(&dir, |_| (200, Vec::new()));
    let url = s
        .put(".PNG", "image/png", Body::bytes(b"bytes".to_vec()), &never)
        .await
        .unwrap();
    let key = url
        .strip_prefix("https://cdn.example.com/media/")
        .unwrap_or_else(|| panic!("{url}"));
    let hex = key.strip_suffix(".png").unwrap_or_else(|| panic!("{url}"));
    assert!(
        hex.len() == 32
            && hex
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()),
        "{url}"
    );
    let r = seen.lock().unwrap()[0].clone();
    assert_eq!(r.method, "PUT");
    assert_eq!(
        (r.host.as_str(), r.path.clone()),
        ("s3.example.com", format!("/media/{key}"))
    );
    assert_eq!(
        r.header("X-Amz-Content-Sha256"),
        Some("277089d91c0bdf4f2e6862ba7e4a07605119431f5d13f726dd352b06f1b206a9")
    );
    assert_eq!(r.body, b"bytes");
    assert!(
        r.header("Authorization")
            .unwrap()
            .contains("SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date"),
    );
    assert!(entries(&dir.0).is_empty());
}

struct FailingSeekable(std::io::Cursor<Vec<u8>>);

impl AsyncRead for FailingSeekable {
    fn poll_read(
        self: std::pin::Pin<&mut Self>,
        _: &mut std::task::Context<'_>,
        _: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::task::Poll::Ready(Err(std::io::Error::other("hashing failed")))
    }
}

impl tokio::io::AsyncSeek for FailingSeekable {
    fn start_seek(
        mut self: std::pin::Pin<&mut Self>,
        position: std::io::SeekFrom,
    ) -> std::io::Result<()> {
        std::pin::Pin::new(&mut self.0).start_seek(position)
    }

    fn poll_complete(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<u64>> {
        std::pin::Pin::new(&mut self.0).poll_complete(cx)
    }
}

#[tokio::test]
async fn does_not_retry_a_seekable_body_after_hashing_fails() {
    let dir = TempDir::new();
    let (s, seen) = store(&dir, |_| (200, Vec::new()));
    let body = FailingSeekable(std::io::Cursor::new(b"bytes".to_vec()));
    let err = s
        .put(".bin", "", Body::Seekable(Box::new(body)), &never)
        .await
        .unwrap_err();
    assert_eq!(err.to_string(), "hashing failed");
    assert!(seen.lock().unwrap().is_empty());
    assert!(entries(&dir.0).is_empty());
}

/// Yields some bytes, raises the cancel flag, then never ends.
struct CancellingInput {
    flag: Arc<std::sync::atomic::AtomicBool>,
    sent: bool,
}

impl AsyncRead for CancellingInput {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        _: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        if self.sent {
            return std::task::Poll::Pending;
        }
        self.sent = true;
        buf.put_slice(b"partial");
        self.flag.store(true, std::sync::atomic::Ordering::SeqCst);
        std::task::Poll::Ready(Ok(()))
    }
}

#[tokio::test]
async fn removes_the_spool_when_input_copy_is_cancelled() {
    let dir = TempDir::new();
    let (s, seen) = store(&dir, |_| (200, Vec::new()));
    let (flag, cancelled) = flagged();
    let input = CancellingInput { flag, sent: false };
    let put = s.put(".bin", "", Body::Stream(Box::new(input)), &cancelled);
    let err = tokio::time::timeout(Duration::from_secs(2), put)
        .await
        .expect("the cancel was not seen")
        .unwrap_err();
    assert!(matches!(err, Error::Cancelled), "{err}");
    assert!(seen.lock().unwrap().is_empty());
    assert!(entries(&dir.0).is_empty());
}

// A PUT whose body is all sent and then gets no headers dies at the header
// timeout, long before the request timeout.
#[tokio::test]
async fn stops_a_put_stalled_before_its_response_headers() {
    let dir = TempDir::new();
    let (endpoint, seen, _task) = raw_server(true, |_, conn| async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        drop(conn);
    })
    .await;
    let mut options = test_options(&endpoint, "media", "path");
    options.temp_dir = Some(dir.0.clone());
    let s = S3::build(
        options,
        Settings {
            request_timeout: Duration::from_secs(5),
            header_timeout: Duration::from_millis(30),
            ..no_proxy()
        },
    )
    .unwrap();
    let put = s.put(".bin", "", Body::bytes(b"bytes".to_vec()), &never);
    let result = tokio::time::timeout(Duration::from_secs(2), put)
        .await
        .expect("the header timeout did not stop the put");
    assert!(result.is_err());
    // The raw server records a request only after reading its whole body.
    let request = seen.lock().unwrap()[0].clone();
    assert_eq!(request.header("Content-Length"), Some("5"));
}

#[tokio::test]
async fn ignores_a_response_read_failure_after_success() {
    let dir = TempDir::new();
    let (s, _task) = answering_store(
        &dir,
        b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\naccepted",
        None,
        no_proxy(),
    )
    .await;
    let url = s
        .put(".bin", "", Body::bytes(b"bytes".to_vec()), &never)
        .await
        .unwrap();
    assert!(url.starts_with("https://cdn.example.com/media/"), "{url}");
}

#[tokio::test]
async fn does_not_read_a_successful_response_body() {
    let dir = TempDir::new();
    let (s, _task) = answering_store(
        &dir,
        b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\n\r\n",
        Some(Duration::from_secs(30)),
        Settings {
            request_timeout: Duration::from_secs(5),
            ..no_proxy()
        },
    )
    .await;
    let put = s.put(".bin", "", Body::bytes(b"bytes".to_vec()), &never);
    tokio::time::timeout(Duration::from_secs(2), put)
        .await
        .expect("the put waited for the body")
        .unwrap();
}

#[tokio::test]
async fn retains_an_error_prefix_when_its_response_read_fails() {
    let dir = TempDir::new();
    let (s, _task) = answering_store(
        &dir,
        b"HTTP/1.1 403 Forbidden\r\nContent-Length: 1000\r\n\r\n<Error><Code>FixtureFailure</Code>",
        None,
        no_proxy(),
    )
    .await;
    let err = s
        .put(".bin", "", Body::bytes(b"bytes".to_vec()), &never)
        .await
        .unwrap_err();
    let message = err.to_string();
    assert!(message.contains("returned 403"), "{message}");
    assert!(message.contains("FixtureFailure"), "{message}");
}

#[tokio::test]
async fn propagates_caller_cancellation_while_reading_the_response_prefix() {
    let dir = TempDir::new();
    let (s, _task) = answering_store(
        &dir,
        b"HTTP/1.1 403 Forbidden\r\nContent-Length: 100\r\n\r\n<Error>",
        Some(Duration::from_secs(30)),
        no_proxy(),
    )
    .await;
    let (flag, cancelled) = flagged();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(100)).await;
        flag.store(true, std::sync::atomic::Ordering::SeqCst);
    });
    let put = s.put(".bin", "", Body::bytes(b"bytes".to_vec()), &cancelled);
    let err = tokio::time::timeout(Duration::from_secs(2), put)
        .await
        .expect("the cancel was not seen")
        .unwrap_err();
    assert!(matches!(err, Error::Cancelled), "{err}");
}

// The read fails because the caller cancelled: the cancel is the answer,
// not the 403.
#[tokio::test]
async fn preserves_cancellation_when_a_response_read_reports_an_io_failure() {
    use tokio::io::AsyncWriteExt;
    let dir = TempDir::new();
    let (flag, cancelled) = flagged();
    let raised = flag.clone();
    let (endpoint, _seen, _task) = raw_server(true, move |_, mut conn| {
        let raised = raised.clone();
        async move {
            let _ = conn
                .get_mut()
                .write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 100\r\n\r\n<Error>")
                .await;
            raised.store(true, std::sync::atomic::Ordering::SeqCst);
            drop(conn);
        }
    })
    .await;
    let mut options = test_options(&endpoint, "media", "path");
    options.temp_dir = Some(dir.0.clone());
    let s = S3::build(options, no_proxy()).unwrap();
    let err = s
        .put(".bin", "", Body::bytes(b"bytes".to_vec()), &cancelled)
        .await
        .unwrap_err();
    assert!(matches!(err, Error::Cancelled), "{err}");
}

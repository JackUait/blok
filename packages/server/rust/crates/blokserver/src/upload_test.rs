use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use blok_http::{BodyError, Request, ResponseWriter};

use crate::handlers::BoxFuture;

use super::*;
use crate::Options;
use crate::server::Server;
use crate::testutil::{send, start, temp_dir};

const TEST_BOUNDARY: &str = "blok-server-conformance-boundary";

fn multipart_body(file_name: &str, content: &str) -> String {
    format!(
        "--{TEST_BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: application/octet-stream\r\n\r\n{content}\r\n--{TEST_BOUNDARY}--\r\n"
    )
}

fn upload_server(max_upload: i64) -> Server {
    Server::new(Options {
        storage_directory: temp_dir().display().to_string(),
        public_url: "/files".into(),
        max_upload_bytes: max_upload,
        ..Options::default()
    })
    .unwrap()
}

/// Reads a preamble, then cancels the request and fails as too slow.
struct SlowAfter {
    sent: bool,
    cancelled: Arc<AtomicBool>,
}

impl Source for SlowAfter {
    fn read<'a>(&'a mut self, buf: &'a mut [u8]) -> BoxFuture<'a, Result<usize, BodyError>> {
        Box::pin(async move {
            if !self.sent {
                self.sent = true;
                let start = format!("--{TEST_BOUNDARY}\r\n");
                buf[..start.len()].copy_from_slice(start.as_bytes());
                return Ok(start.len());
            }
            self.cancelled.store(true, Ordering::SeqCst);
            Err(BodyError::TooSlow)
        })
    }
}

// Measured on the C# host: a body under Kestrel's minimum data rate on
// /upload gets 400 "malformed upload" (UploadEndpoint catches it as an
// IOException). blok-http has cancelled the request by then, and the answer
// must still go out.
#[tokio::test]
async fn upload_answers_a_slow_body_after_the_host_cancelled() {
    let server = upload_server(32 << 20);
    let inner = Arc::clone(&server.inner);
    let running = start(move |_request: Request, response: ResponseWriter| {
        let inner = Arc::clone(&inner);
        async move {
            let flag = Arc::new(AtomicBool::new(false));
            let source = SlowAfter {
                sent: false,
                cancelled: Arc::clone(&flag),
            };
            let cancelled: Cancelled = Arc::new(move || flag.load(Ordering::SeqCst));
            let content_type = format!("multipart/form-data; boundary={TEST_BOUNDARY}");
            upload_from(
                &inner,
                Box::new(source),
                None,
                &content_type,
                cancelled,
                response,
            )
            .await;
        }
    })
    .await;
    let got = send(running.address, "POST /upload HTTP/1.1", b"").await;
    assert_eq!(
        (got.status, got.text().as_str()),
        (400, "malformed upload\n")
    );
}

// The cap counts the whole body, framing included, even when it arrives
// chunked with no Content-Length.
#[tokio::test]
async fn upload_cap_counts_the_whole_chunked_body() {
    let body = multipart_body("small.txt", "small file");
    let server = upload_server(body.len() as i64 - 1);
    let running = start(server.handler("")).await;
    let chunked = format!("{:x}\r\n{body}\r\n0\r\n\r\n", body.len());
    let got = send(
        running.address,
        &format!(
            "POST /upload HTTP/1.1\r\nTransfer-Encoding: chunked\r\nContent-Type: multipart/form-data; boundary={TEST_BOUNDARY}"
        ),
        chunked.as_bytes(),
    )
    .await;
    assert_eq!(
        (got.status, got.text().as_str()),
        (413, "file too large\n"),
        "body {} bytes",
        body.len()
    );
}

// UploadEndpoint.cs sets IHttpMaxRequestBodySizeFeature to MaxUploadBytes
// before it reads, so Kestrel's 30,000,000-byte cap does not apply to it.
#[tokio::test]
async fn upload_raises_the_hosts_body_cap_before_it_reads() {
    let server = upload_server(40_000_000);
    let running = start(server.handler("")).await;
    let body = multipart_body("a.txt", &"x".repeat(30_000_001));
    let got = send(
        running.address,
        &format!(
            "POST /upload HTTP/1.1\r\nContent-Length: {}\r\nContent-Type: multipart/form-data; boundary={TEST_BOUNDARY}",
            body.len()
        ),
        body.as_bytes(),
    )
    .await;
    assert_eq!(got.status, 200, "{:?}", got.text());
    assert!(got.text().contains("\"size\":30000001"), "{:?}", got.text());
}

#[tokio::test]
async fn upload_stores_the_file_part_and_answers_its_metadata() {
    let server = upload_server(32 << 20);
    let directory = server.options().storage_directory.clone();
    let running = start(server.handler("")).await;
    let body = format!(
        "preamble\r\n--{TEST_BOUNDARY}\r\nContent-Disposition: form-data; name=\"other\"\r\n\r\nignored\r\n--{TEST_BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"photo.PNG\"\r\nContent-Type: image/png\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\na=3Db=\r\nc\r\n--{TEST_BOUNDARY}--\r\n"
    );
    let got = send(
        running.address,
        &format!(
            "POST /upload HTTP/1.1\r\nContent-Length: {}\r\nContent-Type: multipart/form-data; boundary={TEST_BOUNDARY}",
            body.len()
        ),
        body.as_bytes(),
    )
    .await;
    let text = got.text();
    assert_eq!(got.status, 200, "{text}");
    assert!(
        text.starts_with("{\"url\":\"/files/")
            && text.ends_with(
                ".png\",\"fileName\":\"photo.PNG\",\"size\":4,\"mimeType\":\"image/png\"}\n"
            ),
        "{text}"
    );
    let stored: Vec<_> = std::fs::read_dir(&directory).unwrap().collect();
    assert_eq!(stored.len(), 1);
    let path = stored[0].as_ref().unwrap().path();
    assert_eq!(std::fs::read_to_string(path).unwrap(), "a=bc");
}

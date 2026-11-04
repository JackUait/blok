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

/// chunkedUpload in http-host-contract.test.ts.
fn chunked_upload(size: usize, chunks: usize, extension: &str, trailer: &str) -> Vec<u8> {
    let head = "--b\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.txt\"\r\n\r\n";
    let tail = "\r\n--b--\r\n";
    let body = format!("{head}{}{tail}", "x".repeat(size - head.len() - tail.len()));
    let step = body.len().div_ceil(chunks);
    let mut framed = String::new();
    let mut at = 0;
    while at < body.len() {
        let part = &body[at..(at + step).min(body.len())];
        let ext = if at == 0 { extension } else { "" };
        framed.push_str(&format!("{:x}{ext}\r\n{part}\r\n", part.len()));
        at += step;
    }
    format!("{framed}0\r\n{trailer}\r\n").into_bytes()
}

// chunked-body-cap.json, captured from C# at a 1000-byte /upload cap:
// Kestrel counts every raw byte of a chunked body against the cap (size
// lines, extensions and CRLFs, and the last CRLF unless a trailer comes
// first), and /upload answers 413 when the cap trips between parts.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_chunked_bodys_framing_counts_against_the_body_cap() {
    let raw = std::fs::read(crate::testutil::fixture_path("chunked-body-cap.json")).unwrap();
    let golden = blok_jsjson::parse_node(&raw, blok_jsjson::Options::default()).unwrap();
    let want = |name: &str| {
        let case = golden
            .items
            .iter()
            .find(|c| {
                c.members.iter().any(|m| {
                    blok_jsjson::to_string_lossy(m.value.text().unwrap_or_default().units()) == name
                })
            })
            .unwrap_or_else(|| panic!("no golden {name}"));
        let response = &case
            .members
            .iter()
            .find(|m| m.key().unwrap().to_string() == "response")
            .unwrap()
            .value;
        blok_jsjson::to_string_lossy(response.text().unwrap().units())
    };
    let server = upload_server(1000);
    let running = start(server.handler("")).await;
    let cases: [(&str, usize, usize, String, &str); 5] = [
        ("one chunk", 988, 1, String::new(), ""),
        ("a one-byte extension", 987, 1, ";".into(), ""),
        (
            "a 101-byte extension",
            887,
            1,
            format!(";{}", "e".repeat(100)),
            "",
        ),
        ("ten chunks", 935, 10, String::new(), ""),
        ("a trailer", 990, 1, String::new(), "X-T: 1\r\n"),
    ];
    let mut failures = Vec::new();
    for (name, size, chunks, extension, trailer) in cases {
        for (label, data) in [("at the cap", size), ("one byte over", size + 1)] {
            let name = format!("{name}, {label}");
            let golden = want(&name);
            let got = send(
                running.address,
                "POST /upload HTTP/1.1\r\nContent-Type: multipart/form-data; boundary=b\r\nTransfer-Encoding: chunked",
                &chunked_upload(data, chunks, &extension, trailer),
            )
            .await;
            let status = golden[9..12].parse::<u16>().unwrap();
            let body = golden.split("\n\n").nth(1).unwrap_or("");
            let ok = got.status == status
                && if status == 413 {
                    body.contains(&got.text())
                } else {
                    let size_field = &body[body.find("\"size\"").unwrap()..];
                    got.text()
                        .contains(&size_field[..size_field.find('}').unwrap()])
                };
            if !ok {
                failures.push(format!("{name}: got {} {:?}", got.status, got.text()));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// Sends data, then the host's over-cap error.
struct TooLargeAfter(Vec<u8>, bool);

impl Source for TooLargeAfter {
    fn read<'a>(&'a mut self, buf: &'a mut [u8]) -> BoxFuture<'a, Result<usize, BodyError>> {
        Box::pin(async move {
            if self.1 {
                return Err(BodyError::TooLarge);
            }
            self.1 = true;
            buf[..self.0.len()].copy_from_slice(&self.0);
            Ok(self.0.len())
        })
    }
}

// A host that counts a chunked body's framing can refuse it after the
// file's bytes, while the multipart reader looks for the next part. C#
// still answers 413 "file too large" (UploadEndpoint catches the
// BadHttpRequestException from any read).
#[tokio::test]
async fn upload_answers413_when_the_host_refuses_between_parts() {
    let server = upload_server(32 << 20);
    let inner = Arc::clone(&server.inner);
    let running = start(move |_request: Request, response: ResponseWriter| {
        let inner = Arc::clone(&inner);
        async move {
            let full = multipart_body("a.txt", "one");
            let source = TooLargeAfter(full.as_bytes()[..full.len() - 4].to_vec(), false);
            let content_type = format!("multipart/form-data; boundary={TEST_BOUNDARY}");
            let never: Cancelled = Arc::new(|| false);
            upload_from(
                &inner,
                Box::new(source),
                None,
                &content_type,
                never,
                response,
            )
            .await;
        }
    })
    .await;
    let got = send(running.address, "POST /upload HTTP/1.1", b"").await;
    assert_eq!((got.status, got.text().as_str()), (413, "file too large\n"));
}

// UploadEndpoint.cs hands S3 a CountingReadStream that keeps CanSeek, so
// PreparedPayload hashes the upload's own temp file in place: one spool,
// not two. The size it reports is the furthest position read.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_upload_to_s3_hashes_its_spool_in_place_and_reports_the_file_size() {
    let content = "blok".repeat(5000);
    let spooled = Arc::new(std::sync::Mutex::new(Vec::new()));
    let put = Arc::new(std::sync::Mutex::new(Vec::new()));
    let (seen_spools, seen_put) = (Arc::clone(&spooled), Arc::clone(&put));
    let bucket = start(move |mut request: Request, mut response: ResponseWriter| {
        let (seen_spools, seen_put) = (Arc::clone(&seen_spools), Arc::clone(&seen_put));
        async move {
            let spools: Vec<String> = std::fs::read_dir(std::env::temp_dir())
                .unwrap()
                .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
                .filter(|name| name.starts_with("blok-s3-"))
                .collect();
            *seen_spools.lock().unwrap() = spools;
            let mut body = Vec::new();
            if let Some(reader) = request.body_mut() {
                let _ = reader.read_to_end(&mut body).await;
            }
            *seen_put.lock().unwrap() = body;
            response.set_status(200);
        }
    })
    .await;
    let server = Server::new(Options {
        s3_endpoint: format!("http://127.0.0.1:{}", bucket.address.port()),
        s3_region: "us-east-1".into(),
        s3_bucket: "media".into(),
        s3_addressing: "path".into(),
        s3_access_key: "a".into(),
        s3_secret_key: "b".into(),
        s3_bucket_url: "https://cdn.example.com".into(),
        ..Options::default()
    })
    .unwrap();
    let running = start(server.handler("")).await;
    let body = multipart_body("a.txt", &content);
    let got = send(
        running.address,
        &format!(
            "POST /upload HTTP/1.1\r\nContent-Length: {}\r\nContent-Type: multipart/form-data; boundary={TEST_BOUNDARY}",
            body.len()
        ),
        body.as_bytes(),
    )
    .await;
    assert!(
        got.status == 200 && got.text().contains("\"size\":20000,"),
        "{} {}",
        got.status,
        got.text()
    );
    assert_eq!(put.lock().unwrap().as_slice(), content.as_bytes());
    assert!(
        spooled.lock().unwrap().is_empty(),
        "S3 spools {:?}",
        spooled.lock().unwrap()
    );
}

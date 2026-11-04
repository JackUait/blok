use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use blok_http::{BodyError, Request, ResponseWriter};

use crate::handlers::BoxFuture;

use super::*;
use crate::Options;
use crate::server::Server;
use crate::testutil::{
    Answer, Recording, open, send, start, temp_dir, upload_spools, wait_for_no_new_spools,
};

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

const BOUNDARY: &str = "blok-upload-test-boundary";
const UPLOAD_URL: &str = "https://uploads.example.test/files/blob";

/// A part as UploadEndpointTests.cs's MultipartPart.
#[derive(Clone)]
struct Part<'a> {
    name: &'a str,
    file_name: Option<&'a str>,
    content_type: Option<&'a str>,
    bytes: Vec<u8>,
    transfer_encoding: Option<&'a str>,
}

fn part<'a>(
    name: &'a str,
    file_name: Option<&'a str>,
    content_type: Option<&'a str>,
    bytes: &[u8],
) -> Part<'a> {
    Part {
        name,
        file_name,
        content_type,
        bytes: bytes.to_vec(),
        transfer_encoding: None,
    }
}

/// BuildMultipart in UploadEndpointTests.cs.
fn build_multipart(boundary: &str, close: bool, parts: &[Part]) -> Vec<u8> {
    let escape = |value: &str| value.replace('\\', "\\\\").replace('"', "\\\"");
    let mut body = Vec::new();
    for part in parts {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        let mut disposition = format!(
            "Content-Disposition: form-data; name=\"{}\"",
            escape(part.name)
        );
        if let Some(file_name) = part.file_name {
            disposition.push_str(&format!("; filename=\"{}\"", escape(file_name)));
        }
        body.extend_from_slice(format!("{disposition}\r\n").as_bytes());
        if let Some(content_type) = part.content_type {
            body.extend_from_slice(format!("Content-Type: {content_type}\r\n").as_bytes());
        }
        if let Some(encoding) = part.transfer_encoding {
            body.extend_from_slice(format!("Content-Transfer-Encoding: {encoding}\r\n").as_bytes());
        }
        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(&part.bytes);
        body.extend_from_slice(b"\r\n");
    }
    if close {
        body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    }
    body
}

fn multipart(parts: &[Part]) -> Vec<u8> {
    build_multipart(BOUNDARY, true, parts)
}

fn multipart_type() -> String {
    format!("multipart/form-data; boundary={BOUNDARY}")
}

async fn post_upload(
    address: std::net::SocketAddr,
    content_type: Option<&str>,
    body: &[u8],
) -> Answer {
    let mut head = format!("POST /upload HTTP/1.1\r\nContent-Length: {}", body.len());
    if let Some(content_type) = content_type {
        head.push_str(&format!("\r\nContent-Type: {content_type}"));
    }
    send(address, &head, body).await
}

struct Uploads {
    running: crate::testutil::Running,
    store: Arc<Recording>,
}

impl Uploads {
    async fn post(&self, body: &[u8]) -> Answer {
        post_upload(self.running.address, Some(&multipart_type()), body).await
    }
}

async fn uploads_into(store: Recording, max_upload: i64) -> Uploads {
    let server = upload_server(max_upload);
    let store = store.install(&server);
    let running = start(server.handler("")).await;
    Uploads { running, store }
}

async fn uploads() -> Uploads {
    uploads_into(Recording::new(UPLOAD_URL), 32 << 20).await
}

fn assert_error(got: &Answer, status: u16, text: &str) {
    assert_eq!(
        (got.status, got.header("Content-Type"), got.text().as_str()),
        (status, "text/plain; charset=utf-8", text)
    );
}

/// The fileName in an upload answer, if any.
fn file_name_of(got: &Answer) -> Option<String> {
    let root = blok_jsjson::parse_node(&got.body, blok_jsjson::Options::default()).unwrap();
    let value = root.lookup("fileName").unwrap()?;
    Some(blok_jsjson::to_string_lossy(value.text().unwrap().units()))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn streams_the_exact_file_to_storage_and_returns_its_metadata() {
    let uploads = uploads().await;
    let bytes = [0u8, 1, 2, 127, 128, 255];
    let got = uploads
        .post(&multipart(&[part(
            "file",
            Some("archive.TAR"),
            Some(" application/octet-stream "),
            &bytes,
        )]))
        .await;
    assert_eq!(got.status, 200, "{}", got.text());
    assert_eq!(got.header("Content-Type"), "application/json");
    assert_eq!(
        got.text(),
        format!(
            "{{\"url\":\"{UPLOAD_URL}\",\"fileName\":\"archive.TAR\",\"size\":6,\"mimeType\":\"application/octet-stream\"}}\n"
        )
    );
    let puts = uploads.store.puts();
    assert_eq!(puts.len(), 1);
    assert_eq!(
        (
            puts[0].extension.as_str(),
            puts[0].mime_type.as_str(),
            puts[0].bytes.as_slice()
        ),
        (".tar", "application/octet-stream", bytes.as_slice())
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reduces_browser_paths_before_passing_only_the_extension_to_storage() {
    for (file_name, expected_name, expected_extension) in [
        (r"C:\Users\me\PHOTO.PNG", "PHOTO.PNG", ".png"),
        ("../../notes/report.txt", "report.txt", ".txt"),
        ("report.💥", "report.💥", ""),
        ("report.abcdefghijklmnop", "report.abcdefghijklmnop", ""),
    ] {
        let uploads = uploads().await;
        let got = uploads
            .post(&multipart(&[part(
                "file",
                Some(file_name),
                Some("text/plain"),
                b"bytes",
            )]))
            .await;
        assert_eq!(got.status, 200, "{file_name}: {}", got.text());
        assert_eq!(
            file_name_of(&got).as_deref(),
            Some(expected_name),
            "{file_name}"
        );
        let puts = uploads.store.puts();
        assert_eq!(puts.len(), 1);
        assert_eq!(puts[0].extension, expected_extension, "{file_name}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn drops_unsafe_or_overlong_display_names() {
    for file_name in [
        ".".to_owned(),
        "..".to_owned(),
        "a".repeat(256),
        "é".repeat(128),
    ] {
        let uploads = uploads().await;
        let got = uploads
            .post(&multipart(&[part(
                "file",
                Some(&file_name),
                Some("text/plain"),
                b"x",
            )]))
            .await;
        assert_eq!(
            (got.status, got.text()),
            (
                200,
                format!("{{\"url\":\"{UPLOAD_URL}\",\"size\":1,\"mimeType\":\"text/plain\"}}\n")
            ),
            "{file_name:.20}"
        );
        let puts = uploads.store.puts();
        assert_eq!(puts.len(), 1);
        assert_eq!(puts[0].extension, "", "{file_name:.20}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn keeps_only_trimmed_valid_bounded_media_types() {
    let maximum = format!("text/plain; x={}", "a".repeat(241));
    let too_long = format!("{maximum}a");
    assert_eq!((maximum.len(), too_long.len()), (255, 256));
    for (media_type, expected) in [
        (" text/plain; charset=utf-8 ", "text/plain; charset=utf-8"),
        (maximum.as_str(), maximum.as_str()),
        (too_long.as_str(), ""),
        ("not a media type", ""),
        ("   ", ""),
    ] {
        let uploads = uploads().await;
        let got = uploads
            .post(&multipart(&[part(
                "file",
                Some("file.bin"),
                Some(media_type),
                b"x",
            )]))
            .await;
        let mime = if expected.is_empty() {
            String::new()
        } else {
            format!(",\"mimeType\":\"{expected}\"")
        };
        assert_eq!(
            (got.status, got.text()),
            (
                200,
                format!(
                    "{{\"url\":\"{UPLOAD_URL}\",\"fileName\":\"file.bin\",\"size\":1{mime}}}\n"
                )
            ),
            "{media_type:.30}"
        );
        let puts = uploads.store.puts();
        assert_eq!(puts.len(), 1);
        assert_eq!(puts[0].mime_type, expected, "{media_type:.30}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn falls_back_to_the_file_name_when_the_file_name_star_charset_is_utf7() {
    let uploads = uploads().await;
    for (parameters, status, file_name) in [
        (
            "filename*=utf-7''a.txt; filename=\"b.txt\"",
            200,
            Some("b.txt"),
        ),
        ("filename*=UTF-7''a.txt", 400, None),
        (
            "filename*=x-unicode-2-0-utf-7''a.txt; filename=\"b.txt\"",
            200,
            Some("b.txt"),
        ),
    ] {
        let body = format!(
            "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; {parameters}\r\nContent-Type: text/plain\r\n\r\nbytes\r\n--{BOUNDARY}--\r\n"
        );
        let got = uploads.post(body.as_bytes()).await;
        assert_eq!(got.status, status, "{parameters}: {}", got.text());
        match file_name {
            None => assert_error(&got, 400, "missing file field\n"),
            Some(name) => assert_eq!(file_name_of(&got).as_deref(), Some(name), "{parameters}"),
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rejects_missing_or_wrong_file_fields_before_storage() {
    let uploads = uploads().await;
    for body in [
        multipart(&[]),
        multipart(&[part("asset", Some("photo.png"), Some("image/png"), &[1])]),
        multipart(&[part("file", None, None, b"value")]),
    ] {
        let got = uploads.post(&body).await;
        assert_error(&got, 400, "missing file field\n");
    }
    assert_eq!(uploads.store.calls(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rejects_malformed_multipart_before_storage() {
    let uploads = uploads().await;
    let photo = part("file", Some("photo.png"), Some("image/png"), &[1, 2, 3]);
    let valid = multipart(std::slice::from_ref(&photo));
    let multipart_type = multipart_type();
    for (body, content_type) in [
        (valid.clone(), None),
        (valid, Some("multipart/form-data")),
        (b"not multipart".to_vec(), Some(multipart_type.as_str())),
        (
            build_multipart(BOUNDARY, false, &[photo]),
            Some(multipart_type.as_str()),
        ),
    ] {
        let got = post_upload(uploads.running.address, content_type, &body).await;
        assert_error(&got, 400, "malformed upload\n");
    }
    assert_eq!(uploads.store.calls(), 0);
}

fn file_then_fields(name: &str, fields: usize) -> Vec<u8> {
    let mut parts = vec![part(
        "file",
        Some(name),
        Some("text/plain"),
        name.as_bytes(),
    )];
    let names: Vec<String> = (1..=fields).map(|i| format!("field-{i}")).collect();
    parts.extend(names.iter().map(|name| part(name, None, None, b"")));
    multipart(&parts)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn accepts_one_thousand_multipart_sections_and_rejects_the_next() {
    let accepted = uploads().await;
    let got = accepted.post(&file_then_fields("accepted.txt", 999)).await;
    assert_eq!(got.status, 200, "{}", got.text());
    assert_eq!(accepted.store.puts().len(), 1);

    let existing = upload_spools();
    let rejected = uploads().await;
    let got = rejected.post(&file_then_fields("rejected.txt", 1000)).await;
    assert_error(&got, 400, "malformed upload\n");
    assert_eq!(rejected.store.calls(), 0);
    assert_eq!(
        wait_for_no_new_spools(&existing).await,
        Vec::<std::path::PathBuf>::new()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rejects_malformed_quoted_printable_in_discarded_parts_before_storage() {
    let uploads = uploads().await;
    for (later_file, encoded) in [
        (false, "="),
        (true, "="),
        (false, "=GG"),
        (false, "=A"),
        (false, "a="),
    ] {
        let mut discarded = if later_file {
            part("file", Some("later.txt"), None, encoded.as_bytes())
        } else {
            part("note", None, None, encoded.as_bytes())
        };
        discarded.transfer_encoding = Some("quoted-printable");
        let got = uploads
            .post(&multipart(&[
                part("file", Some("first.txt"), Some("text/plain"), b"valid file"),
                discarded,
            ]))
            .await;
        assert_error(&got, 400, "malformed upload\n");
    }
    assert_eq!(uploads.store.calls(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn applies_the_complete_body_cap_at_the_exact_unknown_length_boundary() {
    let body = multipart(&[
        part("file", Some("small.txt"), Some("text/plain"), b"small"),
        part("note", None, None, b"other field"),
    ]);
    // blok-http counts a chunked body's framing too, as Kestrel does: the
    // cap is the framed length.
    let mut chunked = format!("{:x}\r\n", body.len()).into_bytes();
    chunked.extend_from_slice(&body);
    chunked.extend_from_slice(b"\r\n0\r\n\r\n");
    let head = format!(
        "POST /upload HTTP/1.1\r\nTransfer-Encoding: chunked\r\nContent-Type: {}",
        multipart_type()
    );

    let accepted = uploads_into(Recording::new(UPLOAD_URL), chunked.len() as i64).await;
    let got = send(accepted.running.address, &head, &chunked).await;
    assert_eq!(got.status, 200, "{}", got.text());
    assert_eq!(accepted.store.puts().len(), 1);

    let rejected = uploads_into(Recording::new(UPLOAD_URL), chunked.len() as i64 - 1).await;
    let got = send(rejected.running.address, &head, &chunked).await;
    assert_error(&got, 413, "file too large\n");
    assert_eq!(rejected.store.calls(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reports_only_the_bytes_the_store_actually_consumes() {
    let mut store = Recording::new(UPLOAD_URL);
    store.max_read = Some(3);
    let uploads = uploads_into(store, 32 << 20).await;
    let got = uploads
        .post(&multipart(&[part(
            "file",
            Some("partial.bin"),
            None,
            &[1, 2, 3, 4, 5],
        )]))
        .await;
    assert_eq!(got.status, 200, "{}", got.text());
    assert!(got.text().contains("\"size\":3"), "{}", got.text());
    assert_eq!(uploads.store.puts()[0].bytes, [1, 2, 3]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn omits_size_when_the_store_consumes_no_bytes() {
    let mut store = Recording::new(UPLOAD_URL);
    store.max_read = Some(0);
    let uploads = uploads_into(store, 32 << 20).await;
    let got = uploads
        .post(&multipart(&[part(
            "file",
            Some("unread.bin"),
            None,
            &[1, 2, 3],
        )]))
        .await;
    assert_eq!(got.status, 200, "{}", got.text());
    assert!(!got.text().contains("\"size\""), "{}", got.text());
    assert!(uploads.store.puts()[0].bytes.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn passes_the_existing_spool_as_a_seekable_stream_to_storage() {
    let uploads = uploads().await;
    let got = uploads
        .post(&multipart(&[part(
            "file",
            Some("photo.png"),
            Some("image/png"),
            &[1, 2, 3],
        )]))
        .await;
    assert_eq!(got.status, 200, "{}", got.text());
    assert!(uploads.store.puts()[0].seekable);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn maps_a_storage_exception_to_the_exact_bad_gateway_wire() {
    let mut store = Recording::new(UPLOAD_URL);
    store.failure = Some("store unavailable".into());
    let uploads = uploads_into(store, 32 << 20).await;
    let got = uploads
        .post(&multipart(&[part(
            "file",
            Some("photo.png"),
            Some("image/png"),
            b"preserved bytes",
        )]))
        .await;
    assert_error(&got, 502, "upload failed\n");
    let puts = uploads.store.puts();
    assert_eq!(puts.len(), 1);
    assert_eq!(puts[0].bytes, b"preserved bytes");
}

// C#'s ObjectDisposedException check has no Rust twin; the spool going
// away is what shows the input was let go.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn propagates_request_cancellation_to_storage_and_disposes_its_input() {
    let mut store = Recording::new(UPLOAD_URL);
    store.wait_for_cancel = true;
    let uploads = uploads_into(store, 32 << 20).await;
    let before = upload_spools();
    let body = multipart(&[part(
        "file",
        Some("photo.png"),
        Some("image/png"),
        &[1, 2, 3],
    )]);
    let conn = open(
        uploads.running.address,
        &format!(
            "POST /upload HTTP/1.1\r\nContent-Length: {}\r\nContent-Type: {}",
            body.len(),
            multipart_type()
        ),
        &body,
    )
    .await;
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        uploads.store.entered.notified(),
    )
    .await
    .expect("the upload never reached the store");
    let ours: std::collections::HashSet<_> = upload_spools().difference(&before).cloned().collect();
    assert!(!ours.is_empty(), "no spool while the store runs");
    drop(conn);
    let started = std::time::Instant::now();
    while !uploads.store.saw_cancel.load(Ordering::SeqCst) {
        assert!(
            started.elapsed() < std::time::Duration::from_secs(7),
            "the store never saw the cancellation"
        );
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let started = std::time::Instant::now();
    while ours.iter().any(|path| path.exists()) {
        assert!(
            started.elapsed() < std::time::Duration::from_secs(10),
            "the spool outlived the cancelled upload"
        );
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn runs_the_shared_guard_before_parsing_or_storage() {
    let server = Server::new(Options {
        auth: "ticket".into(),
        secret: "a-secret-value-with-at-least-32-characters".into(),
        allowed_origins: vec!["https://app.example.com".into()],
        storage_directory: temp_dir().display().to_string(),
        public_url: "/files".into(),
        ..Options::default()
    })
    .unwrap();
    let store = Recording::new(UPLOAD_URL).install(&server);
    let running = start(server.handler("")).await;
    let body = multipart(&[part("file", Some("photo.png"), Some("image/png"), &[1])]);
    let got = send(
        running.address,
        &format!(
            "POST /upload HTTP/1.1\r\nOrigin: https://app.example.com\r\nContent-Length: {}\r\nContent-Type: {}",
            body.len(),
            multipart_type()
        ),
        &body,
    )
    .await;
    assert_error(&got, 401, "missing pass\n");
    assert_eq!(store.calls(), 0);
}

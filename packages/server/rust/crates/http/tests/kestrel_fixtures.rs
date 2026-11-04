//! The HTTP layer against the goldens captured from the C# host: the cases
//! of http-host-contract.test.ts that only Kestrel answers, with stand-ins
//! for the routes around them.

mod common;
#[allow(dead_code)]
mod request_heads_cases;

use blok_http::{Config, Request, ResponseWriter};
use common::*;
use request_heads_cases::{REQUEST_HEADS, request_bytes};

/// Just enough of blokserver's routes for these goldens: /health, the 404
/// catch-all, and routes that read their body the way the real ones do.
async fn routes(mut request: Request, mut response: ResponseWriter) {
    let content_type = request
        .headers()
        .get("content-type")
        .unwrap_or("")
        .to_owned();
    match (request.method(), request.path()) {
        ("GET" | "HEAD", "/health") => health(&mut response).await,
        ("POST", "/delete" | "/upload-by-url" | "/sync/d/edit") => {
            if content_type != "application/json" {
                return plain(&mut response, 415, "expected application/json\n").await;
            }
            let mut body = Vec::new();
            if request
                .body_mut()
                .unwrap()
                .read_to_end(&mut body)
                .await
                .is_err()
            {
                return;
            }
            // A url the empty store never issued is DeleteEndpoint's 404.
            if body.starts_with(b"{\"url\":\"") {
                return plain(&mut response, 404, "not found\n").await;
            }
            plain(&mut response, 400, "expected {\"url\": \"...\"}\n").await;
        }
        ("POST", "/sync/d/reset") => response.set_status(204),
        // UploadEndpoint: its own cap, checked on the length, then the type.
        ("POST", "/upload") => {
            request.set_body_limit(33_554_432);
            if request.content_length().is_some_and(|n| n > 33_554_432) {
                return plain(&mut response, 413, "file too large\n").await;
            }
            plain(&mut response, 400, "malformed upload\n").await;
        }
        // LocalFileEndpoint's answer to a range past the end of a 5-byte file.
        ("GET", "/files/a") => {
            let body = "invalid range: failed to overlap\n";
            let headers = response.headers_mut();
            headers.set("Content-Disposition", "attachment");
            headers.set("X-Content-Type-Options", "nosniff");
            headers.set("Content-Type", "text/plain; charset=utf-8");
            headers.set("Content-Length", body.len().to_string());
            headers.set("Content-Range", "bytes */5");
            let _ = response.start(416).await;
            let _ = response.write(body.as_bytes()).await;
        }
        _ => plain(&mut response, 404, "404 page not found\n").await,
    }
}

const CLOSE: &str = "Connection: close\r\n";

/// REQUEST_HEADS in http-host-contract.test.ts, in its order, then the
/// range case that test sends after an upload.
fn request_heads() -> Vec<(&'static str, Vec<u8>)> {
    let mut cases: Vec<(&'static str, Vec<u8>)> = REQUEST_HEADS
        .iter()
        .map(|(name, pieces)| (*name, request_bytes(pieces)))
        .collect();
    cases.push((
        "range past the end of a file",
        format!("GET /files/a HTTP/1.1\r\nHost: x\r\nRange: bytes=99-\r\n{CLOSE}\r\n").into_bytes(),
    ));
    cases
}

/// rawExchange keeps Date and Server lines inside a second answer; this
/// test drops them, as the TS test does.
fn drop_inner_date(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(line_end) = rest.find('\n') {
        let line = &rest[..=line_end];
        let lower = line.to_ascii_lowercase();
        if !(lower.starts_with("date: ") || lower.starts_with("server: ")) {
            out.push_str(line);
        }
        rest = &rest[line_end + 1..];
    }
    out.push_str(rest);
    out
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn request_heads_match_the_csharp_golden() {
    let server = start(routes, Config::default()).await;
    let golden = golden_pairs(&fixture("request-heads.json"));
    let cases = request_heads();
    assert_eq!(
        cases.iter().map(|(name, _)| *name).collect::<Vec<_>>(),
        golden
            .iter()
            .map(|(name, _)| name.as_str())
            .collect::<Vec<_>>()
    );
    let mut failures = Vec::new();
    for ((name, request), (_, want)) in cases.iter().zip(&golden) {
        let got = drop_inner_date(&raw_exchange(server.address, request).await);
        if &got != want {
            failures.push(format!("{name}:\n  got  {got:?}\n  want {want:?}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn request_body_cap_matches_the_csharp_golden() {
    let server = start(routes, Config::default()).await;
    let over = "Content-Length: 30000001\r\n";
    let json = "Content-Type: application/json\r\n";
    let some_body = format!("{{\"url\":\"x\"}}{}", " ".repeat(9_000));
    let cases = [
        (
            "POST /delete",
            format!("POST /delete HTTP/1.1\r\nHost: x\r\n{json}{over}{CLOSE}\r\n"),
        ),
        (
            "POST /delete with Expect: 100-continue",
            format!(
                "POST /delete HTTP/1.1\r\nHost: x\r\n{json}Expect: 100-continue\r\n{over}{CLOSE}\r\n"
            ),
        ),
        (
            "POST /delete with some of the body",
            format!("POST /delete HTTP/1.1\r\nHost: x\r\n{json}{over}{CLOSE}\r\n{some_body}"),
        ),
        (
            "POST /delete with the wrong type",
            format!(
                "POST /delete HTTP/1.1\r\nHost: x\r\nContent-Type: text/plain\r\n{over}{CLOSE}\r\n"
            ),
        ),
        (
            "POST /upload-by-url",
            format!("POST /upload-by-url HTTP/1.1\r\nHost: x\r\n{json}{over}{CLOSE}\r\n"),
        ),
        (
            "GET /health never reads the body",
            format!("GET /health HTTP/1.1\r\nHost: x\r\n{over}{CLOSE}\r\n"),
        ),
        (
            "POST to no route",
            format!("POST /nope HTTP/1.1\r\nHost: x\r\n{over}{CLOSE}\r\n"),
        ),
        (
            "POST /sync/{doc}/edit",
            format!(
                "POST /sync/d/edit HTTP/1.1\r\nHost: x\r\n{json}Blok-Idempotency-Key: k\r\n{over}{CLOSE}\r\n"
            ),
        ),
        (
            "POST /sync/{doc}/reset",
            format!("POST /sync/d/reset HTTP/1.1\r\nHost: x\r\n{json}{over}{CLOSE}\r\n"),
        ),
        (
            "POST /upload over its cap",
            format!(
                "POST /upload HTTP/1.1\r\nHost: x\r\nContent-Type: multipart/form-data; boundary=b\r\nContent-Length: 33554433\r\n{CLOSE}\r\n"
            ),
        ),
    ];
    let golden = golden_pairs(&fixture("request-body-cap.json"));
    assert_eq!(cases.len(), golden.len());
    for ((name, request), (golden_name, want)) in cases.iter().zip(&golden) {
        assert_eq!(name, golden_name);
        let got = raw_exchange(server.address, request.as_bytes()).await;
        assert_eq!(&got, want, "{name}");
    }
}

//! The HTTP layer against the goldens captured from the C# host: the cases
//! of http-host-contract.test.ts that only Kestrel answers, with stand-ins
//! for the routes around them.

mod common;

use blok_http::{Config, Request, ResponseWriter};
use common::*;

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
            plain(&mut response, 400, "expected {\"url\": \"...\"}\n").await;
        }
        ("POST", "/sync/d/reset") => response.set_status(204),
        _ => plain(&mut response, 404, "404 page not found\n").await,
    }
}

fn bytes(parts: &[&[u8]]) -> Vec<u8> {
    parts.concat()
}

const CLOSE: &str = "Connection: close\r\n";

fn head_with(headers: &str) -> Vec<u8> {
    format!("GET /health HTTP/1.1\r\nHost: x\r\n{headers}{CLOSE}\r\n").into_bytes()
}

fn numbered(count: usize) -> String {
    (0..count).map(|i| format!("X{i}: v\r\n")).collect()
}

/// REQUEST_HEADS in http-host-contract.test.ts, in its order.
fn request_heads() -> Vec<(&'static str, Vec<u8>)> {
    let a = |n: usize| "a".repeat(n);
    vec![
        ("header block at the limit", head_with(&format!("X: {}\r\n", a(32_735)))),
        ("header block one byte over", head_with(&format!("X: {}\r\n", a(32_736)))),
        ("header block over with bare LF", format!("GET /health HTTP/1.1\nHost: x\nX: {}\n{CLOSE}\n", a(32_740)).into_bytes()),
        ("header block over before its line end", format!("GET /health HTTP/1.1\r\nHost: x\r\nX: {}", a(33_000)).into_bytes()),
        ("request line at the limit", format!("GET /health?{} HTTP/1.1\r\nHost: x\r\n{CLOSE}\r\n", a(8_169)).into_bytes()),
        ("request line one byte over", format!("GET /health?{} HTTP/1.1\r\nHost: x\r\n{CLOSE}\r\n", a(8_170)).into_bytes()),
        ("request line at the limit with bare LF", format!("GET /health?{} HTTP/1.1\nHost: x\n{CLOSE}\n", a(8_170)).into_bytes()),
        ("request line over before its line end", format!("GET /health?{}", a(8_300)).into_bytes()),
        ("long method", format!("{} / HTTP/1.1\r\nHost: x\r\n{CLOSE}\r\n", "G".repeat(8_300)).into_bytes()),
        ("100 headers", head_with(&numbered(98))),
        ("101 headers", head_with(&numbered(99))),
        ("101 headers after a kept-alive request", bytes(&[b"GET /health HTTP/1.1\r\nHost: x\r\n\r\n", &head_with(&numbered(99))])),
        ("invalid UTF-8 in a value", bytes(&[b"GET /health HTTP/1.1\r\nHost: x\r\nX-A: ", &[0xe9], format!("\r\n{CLOSE}\r\n").as_bytes()])),
        ("valid UTF-8 in a value", bytes(&[b"GET /health HTTP/1.1\r\nHost: x\r\nX-A: ", &[0xc3, 0xa9], format!("\r\n{CLOSE}\r\n").as_bytes()])),
        ("DEL in a value", head_with("X-A: a\x7fb\r\n")),
        ("control byte in a value", head_with("X-A: a\x01b\r\n")),
        ("tab in a value", head_with("X-A: a\tb\r\n")),
        ("NUL in a value", head_with("X-A: a\x00b\r\n")),
        ("CR in a value", head_with("X-A: a\rb\r\n")),
        ("folded line", head_with("X-A: a\r\n b\r\n")),
        ("first header line folded", format!("GET /health HTTP/1.1\r\n Host: x\r\n{CLOSE}\r\n").into_bytes()),
        ("quote in a name", head_with("X\"A: a\r\n")),
        ("control byte in a name", head_with("X\x01A: a\r\n")),
        ("space before the colon", head_with("X-A : a\r\n")),
        ("no colon", head_with("NoColon\r\n")),
        ("empty name", head_with(": v\r\n")),
        ("no Host", format!("GET /health HTTP/1.1\r\n{CLOSE}\r\n").into_bytes()),
        ("two Host headers", format!("GET /health HTTP/1.1\r\nHost: a\r\nHost: b\r\n{CLOSE}\r\n").into_bytes()),
        ("malformed Host", format!("GET /health HTTP/1.1\r\nHost: a b\r\n{CLOSE}\r\n").into_bytes()),
        ("empty Host", format!("GET /health HTTP/1.1\r\nHost:\r\n{CLOSE}\r\n").into_bytes()),
        ("bare LF line ends", format!("GET /health HTTP/1.1\nHost: x\n{CLOSE}\n").into_bytes()),
        ("blank lines before the request line", bytes(&[b"\r\n\r\n\n\r", &head_with("")])),
        ("HTTP/0.9 request line", b"GET /health\r\n\r\n".to_vec()),
        ("HTTP/3 version", format!("GET /health HTTP/3\r\nHost: x\r\n{CLOSE}\r\n").into_bytes()),
        ("bad method byte", format!("G@T /health HTTP/1.1\r\nHost: x\r\n{CLOSE}\r\n").into_bytes()),
        ("two spaces after the method", format!("GET  /health HTTP/1.1\r\nHost: x\r\n{CLOSE}\r\n").into_bytes()),
        (
            "two Content-Length values",
            format!("POST /delete HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\nContent-Length: 2\r\n{CLOSE}\r\nxx").into_bytes(),
        ),
        ("HTTP/2 prior-knowledge preface", b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n".to_vec()),
    ]
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
    for ((name, request), (_, want)) in cases.iter().zip(&golden) {
        let got = drop_inner_date(&raw_exchange(server.address, request).await);
        assert_eq!(&got, want, "{name}");
    }
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
    ];
    let golden = golden_pairs(&fixture("request-body-cap.json"));
    assert_eq!(cases.len(), golden.len());
    for ((name, request), (golden_name, want)) in cases.iter().zip(&golden) {
        assert_eq!(name, golden_name);
        let got = raw_exchange(server.address, request.as_bytes()).await;
        assert_eq!(&got, want, "{name}");
    }
}

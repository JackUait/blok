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
    let mut cases = vec![
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
    ];
    let line =
        |version: &str| format!("GET /health {version}\r\nHost: x\r\n{CLOSE}\r\n").into_bytes();
    cases.extend([
        ("HTTP/1.2 version", line("HTTP/1.2")),
        ("HTTP/2.0 version", line("HTTP/2.0")),
        ("HTTP/0.9 version", line("HTTP/0.9")),
        ("lower-case version", line("http/1.1")),
        ("seven-byte version", line("HTTP/1.")),
        ("HTTP/1.10 version", line("HTTP/1.10")),
        ("HTTP/1.2 with bare LF", format!("GET /health HTTP/1.2\nHost: x\n{CLOSE}\n").into_bytes()),
        ("HTTP/1.2 line alone", b"GET /health HTTP/1.2\r\n".to_vec()),
        ("HTTP/1.2 with a bad method", format!("G@T /health HTTP/1.2\r\nHost: x\r\n{CLOSE}\r\n").into_bytes()),
        ("HTTP/1.2 after a kept-alive request", b"GET /health HTTP/1.1\r\nHost: x\r\n\r\nGET /health HTTP/1.2\r\n".to_vec()),
        (
            "two equal Content-Length values",
            format!("POST /delete HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 2\r\nContent-Length: 2\r\n{CLOSE}\r\n{{}}").into_bytes(),
        ),
        (
            "two Content-Length values beside chunked",
            format!("POST /delete HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nContent-Length: 1\r\nContent-Length: 1\r\n{CLOSE}\r\n0\r\n\r\n").into_bytes(),
        ),
    ]);
    let codings: [(&'static str, &[u8]); 29] = [
        (
            "Transfer-Encoding identity",
            b"Transfer-Encoding: identity\r\n",
        ),
        ("Transfer-Encoding gzip", b"Transfer-Encoding: gzip\r\n"),
        (
            "Transfer-Encoding gzip, chunked",
            b"Transfer-Encoding: gzip, chunked\r\n",
        ),
        (
            "Transfer-Encoding chunked, gzip",
            b"Transfer-Encoding: chunked, gzip\r\n",
        ),
        (
            "Transfer-Encoding upper-case chunked",
            b"Transfer-Encoding: CHUNKED\r\n",
        ),
        (
            "Transfer-Encoding spaces and commas around chunked",
            b"Transfer-Encoding:  , chunked , \r\n",
        ),
        (
            "Transfer-Encoding two lines, chunked last",
            b"Transfer-Encoding: gzip\r\ntransfer-encoding: chunked\r\n",
        ),
        (
            "Transfer-Encoding two lines, chunked first",
            b"Transfer-Encoding: chunked\r\nTransfer-Encoding: gzip\r\n",
        ),
        (
            "Transfer-Encoding an empty line after chunked",
            b"Transfer-Encoding: chunked\r\nTransfer-Encoding:\r\n",
        ),
        (
            "Transfer-Encoding a tab before chunked",
            b"Transfer-Encoding: gzip,\tchunked\r\n",
        ),
        (
            "Transfer-Encoding chunked with a parameter",
            b"Transfer-Encoding: chunked;x\r\n",
        ),
        (
            "Transfer-Encoding an empty value",
            b"Transfer-Encoding:\r\n",
        ),
        (
            "Transfer-Encoding a control byte in an earlier coding",
            b"Transfer-Encoding: g\x01zip, chunked\r\n",
        ),
        (
            "Transfer-Encoding NUL in an earlier coding",
            b"Transfer-Encoding: g\x00zip, chunked\r\n",
        ),
        (
            "Transfer-Encoding NUL in an earlier line",
            b"Transfer-Encoding: \x00\r\nTransfer-Encoding: chunked\r\n",
        ),
        (
            "Transfer-Encoding CR in an earlier coding",
            b"Transfer-Encoding: g\rzip, chunked\r\n",
        ),
        (
            "Transfer-Encoding CR in an earlier line",
            b"Transfer-Encoding: a\rb\r\nTransfer-Encoding: chunked\r\n",
        ),
        (
            "Transfer-Encoding invalid UTF-8 in an earlier coding",
            b"Transfer-Encoding: g\xe9zip, chunked\r\n",
        ),
        (
            "Transfer-Encoding valid UTF-8 in an earlier coding",
            b"Transfer-Encoding: g\xc3\xa9zip, chunked\r\n",
        ),
        (
            "Transfer-Encoding DEL in an earlier coding",
            b"Transfer-Encoding: g\x7fzip, chunked\r\n",
        ),
        (
            "Transfer-Encoding a control byte in an earlier line",
            b"Transfer-Encoding: \x01\r\nTransfer-Encoding: chunked\r\n",
        ),
        (
            "Transfer-Encoding non-token bytes in an earlier coding",
            b"Transfer-Encoding: g\"z(i)p, chunked\r\n",
        ),
        (
            "Transfer-Encoding empty items",
            b"Transfer-Encoding: ,,gzip,,chunked,,\r\n",
        ),
        (
            "Transfer-Encoding chunked, chunked",
            b"Transfer-Encoding: chunked, chunked\r\n",
        ),
        (
            "Transfer-Encoding chunked;x=1",
            b"Transfer-Encoding: chunked;x=1\r\n",
        ),
        (
            "Transfer-Encoding gzip;x=1, chunked",
            b"Transfer-Encoding: gzip;x=1, chunked\r\n",
        ),
        (
            "Transfer-Encoding gzip, and chunked on the next line",
            b"Transfer-Encoding: gzip,\r\nTransfer-Encoding: chunked\r\n",
        ),
        (
            "Transfer-Encoding folded onto a second line",
            b"Transfer-Encoding: gzip,\r\n chunked\r\n",
        ),
        (
            "Transfer-Encoding with a space before the colon",
            b"Transfer-Encoding : chunked\r\n",
        ),
    ];
    for (name, te) in codings {
        cases.push((
            name,
            bytes(&[
                b"POST /delete HTTP/1.1\r\nHost: x\r\nContent-Type: text/plain\r\n",
                te,
                CLOSE.as_bytes(),
                b"\r\n0\r\n\r\n",
            ]),
        ));
    }
    cases.push((
        "Transfer-Encoding gzip on HTTP/1.0",
        b"POST /delete HTTP/1.0\r\nTransfer-Encoding: gzip\r\n\r\n".to_vec(),
    ));
    let absolute = [
        ("absolute target for another host", "http://y/health", "x"),
        ("absolute target for the Host", "http://x/health", "x"),
        ("absolute target in upper case", "http://X/health", "x"),
        (
            "absolute target with the default port",
            "http://x:80/health",
            "x",
        ),
        (
            "absolute target and a Host with the default port",
            "http://x/health",
            "x:80",
        ),
        (
            "absolute target with another port",
            "http://x:81/health",
            "x",
        ),
        (
            "absolute target with a leading-zero port",
            "http://x:080/health",
            "x:080",
        ),
        (
            "absolute target with an empty port",
            "http://x:/health",
            "x",
        ),
        (
            "absolute target over https with a Host on 443",
            "https://x/health",
            "x:443",
        ),
        (
            "absolute target over https with a Host on 80",
            "https://x/health",
            "x:80",
        ),
        (
            "absolute target and a Host in upper case",
            "http://x/health",
            "X",
        ),
        ("absolute target with userinfo", "http://u:p@x/health", "x"),
        (
            "absolute target and a Host with userinfo",
            "http://u@x/health",
            "u@x",
        ),
        (
            "absolute target with IPv6 in upper case",
            "http://[::A]/health",
            "[::A]",
        ),
        (
            "absolute target with IPv6 and a port",
            "http://[::1]:8080/health",
            "[::1]:8080",
        ),
        (
            "absolute target with an upper-case scheme",
            "Http://x/health",
            "x",
        ),
    ];
    for (name, target, host) in absolute {
        cases.push((
            name,
            format!("GET {target} HTTP/1.1\r\nHost: {host}\r\n{CLOSE}\r\n").into_bytes(),
        ));
    }
    let raw: [(&'static str, &[u8]); 22] = [
        ("absolute target for another host on HTTP/1.0", b"GET http://y/health HTTP/1.0\r\nHost: x\r\n\r\n"),
        ("absolute target with a port over 65535", b"GET http://x:65536/health HTTP/1.1\r\n"),
        ("absolute target with no host", b"GET http:///health HTTP/1.1\r\n"),
        ("absolute target with a percent in the host", b"GET http://%78/health HTTP/1.1\r\n"),
        ("authority target", b"GET x:80 HTTP/1.1\r\n"),
        ("authority target with a slash", b"GET a/b HTTP/1.1\r\n"),
        ("authority target with an underscore", b"GET a_b HTTP/1.1\r\n"),
        ("asterisk target with GET", b"GET * HTTP/1.1\r\n"),
        ("asterisk and more", b"GET *x HTTP/1.1\r\n"),
        ("HTTP/1.0 request", b"GET /health HTTP/1.0\r\n\r\n"),
        ("HTTP/1.0 request with no route", b"GET /nope HTTP/1.0\r\n\r\n"),
        ("HTTP/1.0 keep-alive with an answer of unknown length", b"GET /health HTTP/1.0\r\nConnection: keep-alive\r\n\r\n"),
        ("HTTP/1.0 keep-alive HEAD, then a refused head", b"HEAD /health HTTP/1.0\r\nConnection: keep-alive\r\n\r\nGET /health HTTP/1.2\r\n"),
        ("HTTP/1.0 POST", b"POST /delete HTTP/1.0\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}"),
        ("absolute target on HTTP/1.0 with no Host", b"GET http://y/health HTTP/1.0\r\n\r\n"),
        ("unread body, then a refused head", b"POST /delete HTTP/1.1\r\nHost: x\r\nContent-Type: text/plain\r\nContent-Length: 10\r\n\r\n0123456789GET /health HTTP/1.2\r\n"),
        ("unread body over the cap, kept alive", b"POST /delete HTTP/1.1\r\nHost: x\r\nContent-Type: text/plain\r\nContent-Length: 30000001\r\n\r\n"),
        ("POST /upload with an unread body, then a refused head", b"POST /upload HTTP/1.1\r\nHost: x\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\nxxGET /health HTTP/1.2\r\n"),
        ("POST /upload over its cap, kept alive", b"POST /upload HTTP/1.1\r\nHost: x\r\nContent-Type: multipart/form-data; boundary=b\r\nContent-Length: 33554433\r\n\r\n"),
        ("chunked body, then 101 headers", b""),
        ("chunked body with data and an extension, then a refused head", b"POST /delete HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n2;e=1\r\n{}\r\n0\r\n\r\nGET /health HTTP/1.2\r\n"),
        ("gzip, chunked body, then a refused head", b"POST /delete HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nTransfer-Encoding: gzip, chunked\r\n\r\n0\r\n\r\nGET /health HTTP/1.2\r\n"),
    ];
    for (name, request) in raw {
        let request = if name == "chunked body, then 101 headers" {
            bytes(&[
                b"POST /delete HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
                &head_with(&numbered(99)),
            ])
        } else {
            request.to_vec()
        };
        cases.push((name, request));
    }
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

//! Twins of Go's head_test.go: request heads, measured on the C# host.

mod common;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_http::{Config, Request, ResponseWriter};
use common::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const KESTREL400: &str =
    "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const KESTREL414: &str =
    "HTTP/1.1 414 URI Too Long\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const KESTREL431: &str = "HTTP/1.1 431 Request Header Fields Too Large\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const KESTREL505: &str =
    "HTTP/1.1 505 HTTP Version Not Supported\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const OK: &str = "HTTP/1.1 200 OK";

fn answer_status(answer: &str) -> &str {
    answer.split("\r\n").next().unwrap_or("")
}

/// The body of the first answer, chunks joined.
fn answer_body(answer: &str) -> String {
    responses(answer.as_bytes())
        .first()
        .map(|parsed| String::from_utf8_lossy(&parsed.body).into_owned())
        .unwrap_or_default()
}

/// Go's %q of a string: printable runes over ASCII stay as they are.
fn quote(text: &str) -> String {
    let mut out = String::new();
    for c in text.chars() {
        if c.is_ascii() {
            let quoted = go_quote(&[c as u8]);
            out.push_str(&quoted[1..quoted.len() - 1]);
        } else {
            out.push(c);
        }
    }
    format!("\"{out}\"")
}

/// Go's %q of a []string.
fn quote_all<'a>(values: impl Iterator<Item = &'a str>) -> String {
    let quoted: Vec<String> = values.map(quote).collect();
    format!("[{}]", quoted.join(" "))
}

async fn read_body(request: &mut Request) -> Vec<u8> {
    let mut body = Vec::new();
    if let Some(reader) = request.body_mut() {
        let _ = reader.read_to_end(&mut body).await;
    }
    body
}

fn head_with(headers: &str) -> String {
    format!("GET /h HTTP/1.1\r\nHost: x\r\n{headers}Connection: close\r\n\r\n")
}

fn numbered_headers(count: usize) -> String {
    (0..count).map(|i| format!("X{i}: v\r\n")).collect()
}

fn check(failures: &mut Vec<String>, name: &str, got: &str, want: &str) {
    if got != want {
        failures.push(format!("{name}: got {got:.160?}, want {want:?}"));
    }
}

fn report(failures: Vec<String>) {
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

// Measured on the C# host: Kestrel takes any codings whose last non-empty
// one, split on commas and trimmed of spaces only, is chunked, and reads the
// body as chunked. Anything else gets an empty 400, on HTTP/1.0 too.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn transfer_codings_follow_kestrel() {
    let server = start(
        |mut request: Request, mut response: ResponseWriter| async move {
            let body = read_body(&mut request).await;
            let text = format!("{} chunked={}", go_quote(&body), request.is_chunked());
            write_text(&mut response, &text).await;
        },
        Config::default(),
    )
    .await;
    let post = |te: &[u8]| {
        [
            b"POST /h HTTP/1.1\r\nHost: x\r\n".as_slice(),
            te,
            b"Connection: close\r\n\r\n2\r\nab\r\n0\r\n\r\n",
        ]
        .concat()
    };
    let read = "\"ab\" chunked=true";
    let cases: Vec<(&str, Vec<u8>, &str)> = vec![
        (
            "identity",
            post(b"Transfer-Encoding: identity\r\n"),
            KESTREL400,
        ),
        ("gzip", post(b"Transfer-Encoding: gzip\r\n"), KESTREL400),
        (
            "gzip, chunked",
            post(b"Transfer-Encoding: gzip, chunked\r\n"),
            read,
        ),
        (
            "chunked, gzip",
            post(b"Transfer-Encoding: chunked, gzip\r\n"),
            KESTREL400,
        ),
        ("upper case", post(b"Transfer-Encoding: CHUNKED\r\n"), read),
        (
            "spaces and commas",
            post(b"Transfer-Encoding:  , chunked , \r\n"),
            read,
        ),
        (
            "two lines, chunked last",
            post(b"Transfer-Encoding: gzip\r\ntransfer-encoding: chunked\r\n"),
            read,
        ),
        (
            "two lines, chunked first",
            post(b"Transfer-Encoding: chunked\r\nTransfer-Encoding: gzip\r\n"),
            KESTREL400,
        ),
        (
            "an empty line after",
            post(b"Transfer-Encoding: chunked\r\nTransfer-Encoding:\r\n"),
            read,
        ),
        (
            "a comma line after",
            post(b"Transfer-Encoding: chunked\r\nTransfer-Encoding: ,\r\n"),
            read,
        ),
        (
            "tabs at the ends",
            post(b"Transfer-Encoding:\tchunked\t\r\n"),
            read,
        ),
        (
            "a tab inside",
            post(b"Transfer-Encoding: gzip,\tchunked\r\n"),
            KESTREL400,
        ),
        (
            "a parameter",
            post(b"Transfer-Encoding: chunked;x\r\n"),
            KESTREL400,
        ),
        (
            "quoted",
            post(b"Transfer-Encoding: \"chunked\"\r\n"),
            KESTREL400,
        ),
        ("empty", post(b"Transfer-Encoding:\r\n"), KESTREL400),
        ("only commas", post(b"Transfer-Encoding: ,\r\n"), KESTREL400),
        (
            "a control byte in an earlier coding",
            post(b"Transfer-Encoding: g\x01zip, chunked\r\n"),
            read,
        ),
        (
            "a control byte in a dropped line",
            post(b"Transfer-Encoding: g\x01zip\r\nTransfer-Encoding: chunked\r\n"),
            read,
        ),
        (
            "NUL in an earlier coding",
            post(b"Transfer-Encoding: g\x00zip, chunked\r\n"),
            KESTREL400,
        ),
        (
            "NUL in a dropped line",
            post(b"Transfer-Encoding: \x00\r\nTransfer-Encoding: chunked\r\n"),
            KESTREL400,
        ),
        (
            "CR in an earlier coding",
            post(b"Transfer-Encoding: g\rzip, chunked\r\n"),
            KESTREL400,
        ),
        (
            "CR in a dropped line",
            post(b"Transfer-Encoding: a\rb\r\nTransfer-Encoding: chunked\r\n"),
            KESTREL400,
        ),
        (
            "invalid UTF-8 in an earlier coding",
            post(b"Transfer-Encoding: g\xe9zip, chunked\r\n"),
            KESTREL400,
        ),
        (
            "gzip on HTTP/1.0",
            b"POST /h HTTP/1.0\r\nTransfer-Encoding: gzip\r\n\r\n".to_vec(),
            KESTREL400,
        ),
    ];
    let mut failures = Vec::new();
    for (name, request, want) in cases {
        let mut got = raw_answer(server.address, &request).await;
        if !want.starts_with("HTTP/") {
            got = answer_body(&got);
        }
        check(&mut failures, name, &got, want);
    }
    report(failures);
}

// Measured on the C# host. An absolute target's authority, as System.Uri
// prints it, must be the Host; Kestrel checks that after the headers. The
// rest it answers from the request line alone: a target that is not
// origin-form, http(s)://, or "*" is authority-form, 405 unless CONNECT
// and 400 for any byte but letters, digits and "-.:@[]".
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn target_forms_follow_kestrel() {
    let server = start(echo_target, Config::default()).await;
    let get = |target: &str, host: &str| -> Vec<u8> {
        format!("GET {target} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n").into_bytes()
    };
    let need_connect = "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\nAllow: CONNECT\r\n\r\n";
    let need_options = "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\nAllow: OPTIONS\r\n\r\n";
    let cases: Vec<(&str, Vec<u8>, &str)> = vec![
        ("for another host", get("http://y/h", "x"), KESTREL400),
        ("for the Host", get("http://x/h", "x"), OK),
        ("in upper case", get("http://X/h", "x"), OK),
        ("with the default port", get("http://x:80/h", "x"), OK),
        (
            "a Host with the default port",
            get("http://x/h", "x:80"),
            OK,
        ),
        (
            "both with the default port",
            get("http://x:80/h", "x:80"),
            OK,
        ),
        ("with another port", get("http://x:81/h", "x"), KESTREL400),
        ("the same other port", get("http://x:81/h", "x:81"), OK),
        (
            "a leading-zero port",
            get("http://x:080/h", "x:080"),
            KESTREL400,
        ),
        (
            "a leading-zero port and no port",
            get("http://x:080/h", "x"),
            OK,
        ),
        ("an empty port", get("http://x:/h", "x"), OK),
        ("port 0", get("http://x:0/h", "x:0"), OK),
        ("https on 443", get("https://x/h", "x:443"), OK),
        ("https with 443", get("https://x:443/h", "x"), OK),
        ("https on 80", get("https://x/h", "x:80"), KESTREL400),
        ("a Host in upper case", get("http://x/h", "X"), KESTREL400),
        ("userinfo", get("http://u:p@x/h", "x"), OK),
        (
            "a Host with userinfo",
            get("http://u@x/h", "u@x"),
            KESTREL400,
        ),
        ("IPv6", get("http://[::1]/h", "[::1]"), OK),
        (
            "IPv6 in upper case",
            get("http://[::A]/h", "[::A]"),
            KESTREL400,
        ),
        (
            "IPv6 and a port",
            get("http://[::1]:8080/h", "[::1]:8080"),
            OK,
        ),
        ("an underscore host", get("http://X_Y/h", "x_y"), OK),
        ("a trailing dot", get("http://x./h", "x."), OK),
        ("a Host with spaces around", get("http://x/h", "  x  "), OK),
        ("an upper-case scheme", get("Http://x/h", "x"), KESTREL400),
        (
            "on HTTP/1.0 with no Host",
            b"GET http://y/h HTTP/1.0\r\n\r\n".to_vec(),
            OK,
        ),
        (
            "on HTTP/1.0 for another host",
            b"GET http://y/h HTTP/1.0\r\nHost: x\r\n\r\n".to_vec(),
            KESTREL400,
        ),
        (
            "a port over 65535",
            b"GET http://x:65536/h HTTP/1.1\r\n".to_vec(),
            KESTREL400,
        ),
        (
            "a port with a letter",
            b"GET http://x:8a/h HTTP/1.1\r\n".to_vec(),
            KESTREL400,
        ),
        (
            "no host",
            b"GET http:///h HTTP/1.1\r\n".to_vec(),
            KESTREL400,
        ),
        (
            "only the scheme",
            b"GET http:// HTTP/1.1\r\n".to_vec(),
            KESTREL400,
        ),
        (
            "a percent in the host",
            b"GET http://%78/h HTTP/1.1\r\n".to_vec(),
            KESTREL400,
        ),
        ("authority", b"GET x:80 HTTP/1.1\r\n".to_vec(), need_connect),
        (
            "authority with every byte it takes",
            b"POST aZ09-.:@[] HTTP/1.1\r\n".to_vec(),
            need_connect,
        ),
        (
            "authority with a slash",
            b"GET a/b HTTP/1.1\r\n".to_vec(),
            KESTREL400,
        ),
        (
            "authority with an underscore",
            b"GET a_b HTTP/1.1\r\n".to_vec(),
            KESTREL400,
        ),
        (
            "authority with a high byte",
            b"GET a\xe9b HTTP/1.1\r\n".to_vec(),
            KESTREL400,
        ),
        (
            "asterisk with GET",
            b"GET * HTTP/1.1\r\n".to_vec(),
            need_options,
        ),
        (
            "asterisk and more",
            b"GET *x HTTP/1.1\r\n".to_vec(),
            KESTREL400,
        ),
        (
            "asterisk with OPTIONS",
            b"OPTIONS * HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n".to_vec(),
            OK,
        ),
    ];
    let mut failures = Vec::new();
    for (name, request, want) in cases {
        let mut got = raw_answer(server.address, &request).await;
        if want == OK {
            got = answer_status(&got).to_owned();
        }
        check(&mut failures, name, &got, want);
    }
    report(failures);
}

// Measured on the C# host: the version is the rest of the request line. It
// must be 9 bytes ending in CR (the host turns on Kestrel's
// DisableHttp1LineFeedTerminators), else 400; any 8 bytes but HTTP/1.0 and
// HTTP/1.1 before the CR get 505. Kestrel answers from the line alone.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_version_follows_kestrel() {
    let server = start(echo_target, Config::default()).await;
    let line = |version: &str| format!("GET /h {version}\r\nHost: x\r\nConnection: close\r\n\r\n");
    let cases: Vec<(&str, String, &str)> = vec![
        ("HTTP/1.2", line("HTTP/1.2"), KESTREL505),
        ("HTTP/2.0", line("HTTP/2.0"), KESTREL505),
        ("HTTP/0.9", line("HTTP/0.9"), KESTREL505),
        ("lower case", line("http/1.1"), KESTREL505),
        ("seven bytes and CR", line("HTTP/1."), KESTREL400),
        (
            "eight bytes and no CR",
            "GET /h HTTP/1.2\nHost: x\n\n".into(),
            KESTREL400,
        ),
        ("nine bytes and CR", line("HTTP/1.10"), KESTREL400),
        (
            "nine bytes and no CR",
            "GET /h HTTP/1.10\nHost: x\n\n".into(),
            KESTREL400,
        ),
        ("a space after", line("HTTP/1.1 "), KESTREL400),
        ("none", line(""), KESTREL400),
        ("the line alone", "GET /h HTTP/1.2\r\n".into(), KESTREL505),
        (
            "before 101 headers",
            format!("GET /h HTTP/1.2\r\n{}\r\n", numbered_headers(101)),
            KESTREL505,
        ),
        (
            "a bad method first",
            "G@T /h HTTP/1.2\r\nHost: x\r\n\r\n".into(),
            KESTREL400,
        ),
        ("HTTP/1.1", line("HTTP/1.1"), OK),
    ];
    let mut failures = Vec::new();
    for (name, request, want) in cases {
        let mut got = raw_answer(server.address, request.as_bytes()).await;
        if want == OK {
            got = answer_status(&got).to_owned();
        }
        check(&mut failures, name, &got, want);
    }
    report(failures);
}

// Measured on the C# host (Kestrel defaults): the request line may be 8192
// bytes with its line end, the header block 32770 bytes with the blank
// line, and a head may carry 100 header lines, Host included.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn request_heads_stop_at_kestrels_limits() {
    let server = start(echo_target, Config::default()).await;
    // "GET /h?" + n + " HTTP/1.1\r\n" is n + 18 bytes.
    let line = |target: &str, n: usize| {
        format!(
            "GET {target}?{} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
            "a".repeat(n)
        )
    };
    // Host: x, X: <n>, Connection: close and the blank line are n + 35 bytes.
    let block = |n: usize| head_with(&format!("X: {}\r\n", "a".repeat(n)));
    let cases: Vec<(&str, String, &str)> = vec![
        ("line at the limit", line("/h", 8192 - 18), OK),
        ("line over the limit", line("/h", 8193 - 18), KESTREL414),
        ("swapped target at the limit", line("/%zz", 8192 - 20), OK),
        (
            "swapped target over the limit",
            line("/%zz", 8193 - 20),
            KESTREL414,
        ),
        (
            "line with no end yet",
            format!("GET /h?{}", "a".repeat(8192)),
            KESTREL414,
        ),
        ("block at the limit", block(32770 - 35), OK),
        ("block over the limit", block(32771 - 35), KESTREL431),
        (
            "block with no end yet",
            format!("GET /h HTTP/1.1\r\nHost: x\r\nX: {}", "a".repeat(32770)),
            KESTREL431,
        ),
        ("100 headers", head_with(&numbered_headers(98)), OK),
        ("101 headers", head_with(&numbered_headers(99)), KESTREL431),
    ];
    let mut failures = Vec::new();
    for (name, request, want) in cases {
        let mut got = raw_answer(server.address, request.as_bytes()).await;
        if want == OK {
            got = answer_status(&got).to_owned();
        }
        check(&mut failures, name, &got, want);
    }
    report(failures);
}

// Kestrel answers a kept-alive request before it refuses the next head.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_head_over_the_limit_after_a_kept_alive_request() {
    let server = start(echo_target, Config::default()).await;
    let request = format!(
        "GET /a HTTP/1.1\r\nHost: x\r\n\r\n{}",
        head_with(&numbered_headers(99))
    );
    let got = raw_answer(server.address, request.as_bytes()).await;
    assert!(
        got.starts_with("HTTP/1.1 200 OK\r\n") && got.ends_with(KESTREL431),
        "{got:?}"
    );
}

// Measured on the C# host with a byte sweep over a header name and value.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn request_heads_follow_kestrels_grammar() {
    let server = start(
        |request: Request, mut response: ResponseWriter| async move {
            let mut text = quote_all(request.headers().get_all("X-A"));
            for (name, value) in request.headers().iter() {
                if name.starts_with('X') && name != "X-A" {
                    text.push_str(&format!(" {}=[{}]", quote(name), quote(value)));
                }
            }
            write_text(&mut response, &text).await;
        },
        Config::default(),
    )
    .await;
    let cases: Vec<(&str, Vec<u8>, &str)> = vec![
        (
            "invalid UTF-8 in a value",
            b"X-A: \xe9\r\n".to_vec(),
            KESTREL400,
        ),
        (
            "valid UTF-8 in a value",
            b"X-A: \xc3\xa9\r\n".to_vec(),
            "[\"\u{e9}\"]",
        ),
        (
            "DEL in a value",
            b"X-A: a\x7fb\r\n".to_vec(),
            r#"["a\x7fb"]"#,
        ),
        (
            "control byte in a value",
            b"X-A: \x01\r\n".to_vec(),
            r#"["\x01"]"#,
        ),
        (
            "swapped and plain values keep their order",
            b"X-A: a_b\r\nX-A: a\x01b\r\nX-A: a_b\r\n".to_vec(),
            r#"["a_b" "a\x01b" "a_b"]"#,
        ),
        ("NUL in a value", b"X-A: a\x00b\r\n".to_vec(), KESTREL400),
        ("CR in a value", b"X-A: a\rb\r\n".to_vec(), KESTREL400),
        ("folded line", b"X-A: a\r\n b\r\n".to_vec(), KESTREL400),
        (
            "quote in a name",
            b"X\"b: v\r\n".to_vec(),
            r#"[] "X\"b"=["v"]"#,
        ),
        (
            "control byte in a name",
            b"X\x01b: v\r\n".to_vec(),
            r#"[] "X\x01b"=["v"]"#,
        ),
        (
            "space before the colon",
            b"X-A : a\r\n".to_vec(),
            KESTREL400,
        ),
        ("no colon", b"NoColon\r\n".to_vec(), KESTREL400),
    ];
    let mut requests: Vec<(&str, Vec<u8>, &str)> = cases
        .into_iter()
        .map(|(name, headers, want)| {
            let request = [
                b"GET /h HTTP/1.1\r\nHost: x\r\n".as_slice(),
                &headers,
                b"Connection: close\r\n\r\n",
            ]
            .concat();
            (name, request, want)
        })
        .collect();
    let whole: Vec<(&str, &str, &str)> = vec![
        (
            "first line folded",
            "GET /h HTTP/1.1\r\n Host: x\r\nConnection: close\r\n\r\n",
            KESTREL400,
        ),
        (
            "no Host",
            "GET /h HTTP/1.1\r\nConnection: close\r\n\r\n",
            KESTREL400,
        ),
        (
            "two Host headers",
            "GET /h HTTP/1.1\r\nHost: a\r\nHost: b\r\nConnection: close\r\n\r\n",
            KESTREL400,
        ),
        (
            "malformed Host",
            "GET /h HTTP/1.1\r\nHost: a b\r\nConnection: close\r\n\r\n",
            KESTREL400,
        ),
        ("HTTP/0.9", "GET /h\r\n\r\n", KESTREL400),
        (
            "two Content-Length values",
            "POST /h HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\nxx",
            KESTREL400,
        ),
        (
            "two equal Content-Length values",
            "POST /h HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\ncontent-length: 2\r\n\r\nxx",
            KESTREL400,
        ),
        (
            "two Content-Length values beside chunked",
            "POST /h HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nContent-Length: 1\r\nContent-Length: 1\r\n\r\n0\r\n\r\n",
            KESTREL400,
        ),
    ];
    for (name, request, want) in whole {
        requests.push((name, request.as_bytes().to_vec(), want));
    }
    requests.push((
        "blank lines before the request line",
        format!("\r\n\n\r{}", head_with("X-A: v\r\n")).into_bytes(),
        r#"["v"]"#,
    ));
    let mut failures = Vec::new();
    for (name, request, want) in requests {
        let mut got = raw_answer(server.address, &request).await;
        if !want.starts_with("HTTP/") {
            if answer_status(&got) != OK {
                failures.push(format!("{name}: got {got:.120?}"));
                continue;
            }
            got = answer_body(&got);
        }
        check(&mut failures, name, &got, want);
    }
    report(failures);
}

// Kestrel's HTTP/1 endpoint answers the HTTP/2 preface with a GOAWAY frame,
// HTTP_1_1_REQUIRED (0x0d), and closes.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_http2_preface_gets_kestrels_go_away() {
    let server = start(echo_target, Config::default()).await;
    let got = raw_answer(server.address, b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n").await;
    assert_eq!(
        got,
        "\x00\x00\x08\x07\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x0d"
    );
}

// Measured on the C# host: Kestrel reads a chunked body on HTTP/1.0 too,
// before Content-Length, and closes after the answer.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_chunked_body_on_http10_is_read_as_chunked() {
    let seen: Arc<Mutex<Vec<String>>> = Arc::default();
    let record = Arc::clone(&seen);
    let server = start(
        move |mut request: Request, mut response: ResponseWriter| {
            let record = Arc::clone(&record);
            async move {
                let body = read_body(&mut request).await;
                record.lock().unwrap().push(request.target().to_owned());
                let host = request.headers().get("Host").unwrap_or("");
                let text = format!(
                    "{:?} {} {}",
                    request.version(),
                    go_quote(&body),
                    go_quote(host.as_bytes())
                );
                write_text(&mut response, &text).await;
            }
        },
        Config::default(),
    )
    .await;
    let inner = "GET /smuggled HTTP/1.1\r\nHost: x\r\n\r\n";
    let chunks = format!("{:x}\r\n{inner}\r\n0\r\n\r\n", inner.len());
    let cases = [
        ("keep-alive", "Connection: keep-alive\r\n", ""),
        ("no keep-alive", "", ""),
        (
            "and Content-Length",
            "Content-Length: 2\r\nConnection: keep-alive\r\n",
            "",
        ),
        ("and a Host", "Host: h\r\nConnection: keep-alive\r\n", "h"),
        (
            "gzip, chunked",
            "Connection: keep-alive\r\nTransfer-Encoding: gzip\r\n",
            "",
        ),
    ];
    let bare_lf = format!(
        "POST /h HTTP/1.0\r\nConnection: keep-alive\nTransfer-Encoding: chunked\r\n\r\n{chunks}"
    );
    let mut failures = Vec::new();
    check(
        &mut failures,
        "bare LF",
        &raw_answer(server.address, bare_lf.as_bytes()).await,
        KESTREL400,
    );
    for (name, head, host) in cases {
        seen.lock().unwrap().clear();
        let request = format!(
            "POST /h HTTP/1.0\r\n{head}Transfer-Encoding: chunked\r\n\r\n{chunks}GET /next HTTP/1.0\r\n\r\n"
        );
        let got = raw_answer(server.address, request.as_bytes()).await;
        let answers = responses(got.as_bytes());
        let want = format!(
            "Http10 {} {}",
            go_quote(inner.as_bytes()),
            go_quote(host.as_bytes())
        );
        let ok = answers.len() == 1
            && answers[0].status == 200
            && answers[0].header("Connection") == Some("close")
            && answers[0].body == want.as_bytes();
        let seen = seen.lock().unwrap().clone();
        if !ok || seen != ["/h"] {
            failures.push(format!("{name}: got {got:?} after {seen:?}, want {want:?}"));
        }
    }
    report(failures);
}

// Measured on the C# host: Kestrel reads a Content-Length with one sign in
// front, "+" before any digits and "-" only before zeros. Anything else
// that is not digits gets its empty 400.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn content_length_signs_follow_kestrel() {
    let server = start(
        |mut request: Request, mut response: ResponseWriter| async move {
            let body = read_body(&mut request).await;
            let length = request
                .content_length()
                .map_or("none".to_owned(), |n| n.to_string());
            let text = format!(
                "{length} {} {}",
                go_quote(&body),
                quote_all(request.headers().get_all("Content-Length"))
            );
            write_text(&mut response, &text).await;
        },
        Config::default(),
    )
    .await;
    let cases = [
        ("+2", r#"2 "ab" ["+2"]"#),
        ("+02", r#"2 "ab" ["+02"]"#),
        ("+0", r#"0 "" ["+0"]"#),
        ("-0", r#"0 "" ["-0"]"#),
        ("-00", r#"0 "" ["-00"]"#),
        (" +2\t", r#"2 "ab" ["+2"]"#),
        (
            "+00000000000000000002",
            r#"2 "ab" ["+00000000000000000002"]"#,
        ),
        ("-0000000000000000000", r#"0 "" ["-0000000000000000000"]"#),
        ("02", r#"2 "ab" ["02"]"#),
        ("-2", KESTREL400),
        ("-1", KESTREL400),
        ("+", KESTREL400),
        ("-", KESTREL400),
        ("++2", KESTREL400),
        ("+-2", KESTREL400),
        ("+ 2", KESTREL400),
        ("+\t2", KESTREL400),
        ("2+", KESTREL400),
        ("1-0", KESTREL400),
        ("9223372036854775808", KESTREL400),
        ("+9223372036854775808", KESTREL400),
        ("+99999999999999999999", KESTREL400),
        ("-99999999999999999999", KESTREL400),
        ("+0x2", KESTREL400),
        ("+2,2", KESTREL400),
    ];
    let mut failures = Vec::new();
    for (value, want) in cases {
        let request = format!(
            "POST /h HTTP/1.1\r\nHost: x\r\nContent-Length: {value}\r\nConnection: close\r\n\r\nab"
        );
        let mut got = raw_answer(server.address, request.as_bytes()).await;
        if want != KESTREL400 {
            got = answer_body(&got);
        }
        check(&mut failures, &format!("{value:?}"), &got, want);
    }
    report(failures);
}

// Measured on the C# host: System.Uri drops an absolute target's fragment,
// and Kestrel routes a control byte or a bad escape in its path (to a 404),
// a control byte in its query, and anything in its fragment but NUL and
// bytes over 0x7F.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_absolute_target_routes_its_path_and_query() {
    let server = start(
        |request: Request, mut response: ResponseWriter| async move {
            if request.path() != "/health" {
                return plain(&mut response, 404, "404 page not found\n").await;
            }
            let query = request.query().strip_prefix('?').unwrap_or("");
            let text = format!(
                "{} {} {}",
                go_quote(request.path().as_bytes()),
                go_quote(query.as_bytes()),
                go_quote(request.target().as_bytes())
            );
            write_text(&mut response, &text).await;
        },
        Config::default(),
    )
    .await;
    let cases: [(&[u8], &str); 24] = [
        (b"http://x/health#f", r#""/health" "" "http://x/health#f""#),
        (b"http://x/health#", r#""/health" "" "http://x/health#""#),
        (
            b"http://x/health?a=1#f",
            r#""/health" "a=1" "http://x/health?a=1#f""#,
        ),
        (
            b"http://x/health#/nope",
            r#""/health" "" "http://x/health#/nope""#,
        ),
        (
            b"http://x/health#?a",
            r#""/health" "" "http://x/health#?a""#,
        ),
        (
            b"http://x/health#a#b",
            r#""/health" "" "http://x/health#a#b""#,
        ),
        (
            b"http://x/health#%zz",
            r#""/health" "" "http://x/health#%zz""#,
        ),
        (
            b"http://x/health#\x01",
            r#""/health" "" "http://x/health#\x01""#,
        ),
        (
            b"http://x/health?a\x01",
            r#""/health" "a\x01" "http://x/health?a\x01""#,
        ),
        (
            b"http://x/health?\x7f",
            r#""/health" "\x7f" "http://x/health?\x7f""#,
        ),
        (
            b"http://x/health?%zz#f",
            r#""/health" "%zz" "http://x/health?%zz#f""#,
        ),
        (b"http://x/hea\x01lth", "404"),
        (b"http://x/hea\tlth", "404"),
        (b"http://x/hea\rlth", "404"),
        (b"http://x/health\x7f", "404"),
        (b"http://x/health%zz", "404"),
        (b"http://x#f", "404"),
        (b"http://x:80#f", "404"),
        (b"http://x/hea\x00lth", KESTREL400),
        (b"http://x/health?a\x00", KESTREL400),
        (b"http://x/health#a\x00", KESTREL400),
        (b"http://x/health#\xe9", KESTREL400),
        (b"http://x\x01/health", KESTREL400),
        (b"http://u#@x/health", KESTREL400),
    ];
    let mut failures = Vec::new();
    for (target, want) in cases {
        let request = [
            b"GET ".as_slice(),
            target,
            b" HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
        ]
        .concat();
        let got = raw_answer(server.address, &request).await;
        let (got, want) = match want {
            KESTREL400 => (answer_status(&got).to_owned(), answer_status(want)),
            "404" => (
                answer_status(&got)
                    .trim_start_matches("HTTP/1.1 ")
                    .chars()
                    .take(3)
                    .collect(),
                "404",
            ),
            _ => (answer_body(&got), want),
        };
        check(&mut failures, &go_quote(target), &got, want);
    }
    report(failures);
}

// Measured on the C# host: Kestrel reads a chunked body's trailer lines
// under the head's limits (lines and bytes count with the head's) and its
// grammar, except that NUL or invalid UTF-8 in a value gets a bare 500
// with no Connection line. A refusal answers the read that met it. After
// the trailer, the next head is read as any other.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn trailers_follow_kestrel() {
    let server = start(echo_target, Config::default()).await;
    // The head's header block is 39 bytes and 2 lines.
    let post: &[u8] =
        b"POST /h HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nab\r\n0\r\n";
    const READ: &str = "read";
    const KESTREL500: &str = "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n";
    let cases: Vec<(&str, Vec<u8>, &str)> = vec![
        ("one line", b"X-T: 1\r\n\r\n".to_vec(), READ),
        // Kestrel took these until the host turned on
        // DisableHttp1LineFeedTerminators: a proxy that reads a trailer
        // otherwise could be desynced from the host.
        ("a bare LF blank line", b"X-T: 1\r\n\n".to_vec(), KESTREL400),
        ("bare LF lines", b"X-T: 1\nY: 2\n\n".to_vec(), KESTREL400),
        ("none, ended by a bare LF", b"\n".to_vec(), KESTREL400),
        ("a quote in a name", b"X\"T: 1\r\n\r\n".to_vec(), READ),
        (
            "control bytes in a value",
            b"X: a\x01\x7f\tb\r\n\r\n".to_vec(),
            READ,
        ),
        (
            "valid UTF-8 in a value",
            b"X: \xc3\xa9\r\n\r\n".to_vec(),
            READ,
        ),
        ("an empty value", b"X:\r\n\r\n".to_vec(), READ),
        (
            "head fields",
            b"Content-Length: 5\r\nTransfer-Encoding: gzip\r\nHost: a b\r\n\r\n".to_vec(),
            READ,
        ),
        (
            "100 lines with the head's",
            format!("{}\r\n", numbered_headers(98)).into_bytes(),
            READ,
        ),
        (
            "101 lines with the head's",
            format!("{}\r\n", numbered_headers(99)).into_bytes(),
            KESTREL431,
        ),
        (
            "bytes at the limit with the head's",
            format!("X: {}\r\n\r\n", "a".repeat(32_724)).into_bytes(),
            READ,
        ),
        (
            "bytes one over",
            format!("X: {}\r\n\r\n", "a".repeat(32_725)).into_bytes(),
            KESTREL431,
        ),
        (
            "over before its line end",
            format!("X: {}", "a".repeat(33_000)).into_bytes(),
            KESTREL431,
        ),
        ("no colon", b"XT\r\n\r\n".to_vec(), KESTREL400),
        ("folded", b"X: a\r\n b\r\n\r\n".to_vec(), KESTREL400),
        ("a space first", b" X: 1\r\n\r\n".to_vec(), KESTREL400),
        ("an empty name", b": 1\r\n\r\n".to_vec(), KESTREL400),
        (
            "a space before the colon",
            b"X : 1\r\n\r\n".to_vec(),
            KESTREL400,
        ),
        ("a tab in a name", b"X\tY: 1\r\n\r\n".to_vec(), KESTREL400),
        (
            "a high byte in a name",
            b"X\xe9: 1\r\n\r\n".to_vec(),
            KESTREL400,
        ),
        ("NUL in a name", b"X\x00: 1\r\n\r\n".to_vec(), KESTREL400),
        ("CR in a name", b"X\rY: 1\r\n\r\n".to_vec(), KESTREL400),
        ("CR in a value", b"X: a\rb\r\n\r\n".to_vec(), KESTREL400),
        ("NUL in a value", b"X: a\x00b\r\n\r\n".to_vec(), KESTREL500),
        (
            "invalid UTF-8 in a value",
            b"X: a\xe9b\r\n\r\n".to_vec(),
            KESTREL500,
        ),
        (
            "NUL before CR",
            b"X: \x00\r\nY: a\rb\r\n\r\n".to_vec(),
            KESTREL500,
        ),
        (
            "CR before NUL",
            b"Y: a\rb\r\nX: \x00\r\n\r\n".to_vec(),
            KESTREL400,
        ),
    ];
    let mut failures = Vec::new();
    for (name, trailer, want) in cases {
        let request = [post, &trailer, b"GET /h HTTP/1.2\r\n"].concat();
        let got = raw_answer(server.address, &request).await;
        if want == READ {
            if answer_status(&got) != OK
                || answer_body(&got) != r#""/h" "" "ab""#
                || !got.ends_with(KESTREL505)
            {
                failures.push(format!("{name}: got {got:.200?}"));
            }
            continue;
        }
        check(&mut failures, name, &got, want);
    }
    // A body the route left is read after the answer; a refused trailer
    // then closes the connection.
    let unread = start(
        |_request: Request, mut response: ResponseWriter| async move {
            response.headers_mut().set("Content-Length", "0");
            let _ = response.start(415).await;
        },
        Config::default(),
    )
    .await;
    let request = [post, b"XT\r\n\r\nGET /h HTTP/1.2\r\n"].concat();
    check(
        &mut failures,
        "an unread body",
        &raw_answer(unread.address, &request).await,
        "HTTP/1.1 415 Unsupported Media Type\r\nContent-Length: 0\r\n\r\n",
    );
    report(failures);
}

// Measured on the C# host: after an upgrade the route did not take, the
// next head is read with Kestrel's limits and grammar. A route that takes
// it gets every byte after the head as sent.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn heads_after_an_upgrade_follow_kestrel() {
    let server = start(
        |request: Request, response: ResponseWriter| async move {
            if request.path() != "/take" {
                return echo_target(request, response).await;
            }
            let Ok(upgraded) = response.hijack().await else {
                return;
            };
            let mut got = upgraded.buffered;
            let mut stream = upgraded.stream;
            let _ = stream
                .write_all(b"HTTP/1.1 101 Switching Protocols\r\n\r\n")
                .await;
            let _ = tokio::time::timeout(Duration::from_secs(1), async {
                let mut chunk = [0u8; 8192];
                loop {
                    match stream.read(&mut chunk).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => got.extend_from_slice(&chunk[..n]),
                    }
                }
            })
            .await;
            let _ = stream.write_all(go_quote(&got).as_bytes()).await;
        },
        Config::default(),
    )
    .await;
    let upgrade =
        |path: &str, headers: &str| format!("GET {path} HTTP/1.1\r\nHost: x\r\n{headers}\r\n");
    let refused = "GET /h HTTP/1.2\r\n";
    let cases = [
        (
            "Upgrade and Connection: upgrade",
            upgrade("/h", "Upgrade: foo\r\nConnection: upgrade\r\n"),
        ),
        ("Upgrade alone", upgrade("/h", "Upgrade: foo\r\n")),
        ("Connection: upgrade alone", upgrade("/h", "Connection: upgrade\r\n")),
        (
            "with a body",
            "POST /h HTTP/1.1\r\nHost: x\r\nUpgrade: foo\r\nConnection: upgrade\r\nContent-Length: 2\r\n\r\nab".to_owned(),
        ),
        (
            "with a chunked body",
            "POST /h HTTP/1.1\r\nHost: x\r\nUpgrade: foo\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nab\r\n0\r\n\r\n".to_owned(),
        ),
    ];
    let mut failures = Vec::new();
    for (name, request) in cases {
        let got = raw_answer(server.address, format!("{request}{refused}").as_bytes()).await;
        if !got.starts_with("HTTP/1.1 200 OK\r\n") || !got.ends_with(KESTREL505) {
            failures.push(format!("{name}: got {got:.200?}"));
        }
    }
    // Bytes that would be a refused head, and some that are no HTTP at all.
    let frames = [
        refused.as_bytes(),
        b"\x00\x81\xff\r\n\r\n",
        numbered_headers(120).as_bytes(),
        b"\r\n",
    ]
    .concat();
    let request = [
        upgrade("/take", "Upgrade: websocket\r\nConnection: Upgrade\r\n").as_bytes(),
        &frames,
    ]
    .concat();
    check(
        &mut failures,
        "a taken upgrade",
        &raw_answer(server.address, &request).await,
        &format!(
            "HTTP/1.1 101 Switching Protocols\r\n\r\n{}",
            go_quote(&frames)
        ),
    );
    report(failures);
}

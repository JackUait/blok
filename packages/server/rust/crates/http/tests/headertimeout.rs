mod common;

use std::time::{Duration, Instant};

use blok_http::{Config, Request, ResponseWriter};
use common::*;

async fn not_found(_: Request, mut response: ResponseWriter) {
    response.set_status(404);
}

const MINUTE: Duration = Duration::from_secs(60);

// Kestrel answers a request whose headers miss RequestHeadersTimeout with
// this 408 and closes (header-timeout.json, captured from the C# host).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stalled_headers_get_kestrels408() {
    let server = start(not_found, timeouts(Duration::from_millis(200), MINUTE)).await;
    let mut conn = connect(server.address).await;
    write(&mut conn, b"GET / HTTP/1.1\r\nHost: x\r\n").await;
    let answer = String::from_utf8(read_all(&mut conn, Duration::from_secs(5)).await).unwrap();
    assert!(
        answer.starts_with(
            "HTTP/1.1 408 Request Timeout\r\nContent-Length: 0\r\nConnection: close\r\nDate: "
        ) && answer.ends_with(" GMT\r\n\r\n"),
        "got {answer:?}"
    );
    let fixture = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../../test/unit/server-conformance/fixtures/header-timeout.json"
    ))
    .unwrap();
    let date = answer
        .split("Date: ")
        .nth(1)
        .unwrap()
        .split("\r\n")
        .next()
        .unwrap();
    let golden = answer.replace(date, "<date>");
    let escaped = golden.replace('\r', "\\r").replace('\n', "\\n");
    assert!(
        fixture.contains(&format!("\"response\": \"{escaped}\"")),
        "{escaped}"
    );
}

// The clock runs per request: an idle keep-alive connection, and a handler
// that takes longer than the limit, are not cut.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_header_clock_stops_once_the_handler_runs() {
    let slow = |_: Request, mut response: ResponseWriter| async move {
        tokio::time::sleep(Duration::from_millis(400)).await;
        write_text(&mut response, "ok").await;
    };
    let server = start(slow, timeouts(Duration::from_millis(200), MINUTE)).await;
    let mut conn = connect(server.address).await;
    for i in 1..=2 {
        write(&mut conn, b"GET / HTTP/1.1\r\nHost: x\r\n\r\n").await;
        let mut buffer = [0u8; 4096];
        let n = tokio::time::timeout(
            Duration::from_secs(5),
            tokio::io::AsyncReadExt::read(&mut conn, &mut buffer),
        )
        .await
        .unwrap()
        .unwrap();
        let text = String::from_utf8_lossy(&buffer[..n]);
        assert!(text.starts_with("HTTP/1.1 200 OK"), "request {i}: {text:?}");
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
}

// Program.cs:123,137: Kestrel keeps an idle connection 2 min. A black-box
// case would wait 2 min, so this pins the field.
#[test]
fn keep_alive_idle_timeout_is_two_minutes() {
    assert_eq!(
        Config::default().keep_alive_timeout,
        Duration::from_secs(120)
    );
    assert_eq!(Config::default().header_timeout, Duration::from_secs(10));
}

// Http1Connection.BeginRequestProcessing (Kestrel 10.0.11) starts every
// request, the first too, on KeepAliveTimeout; it ends the connection with
// no bytes.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_silent_connection_closes_at_the_keep_alive_timeout() {
    let server = start(not_found, timeouts(MINUTE, Duration::from_millis(200))).await;
    let mut conn = connect(server.address).await;
    let started = Instant::now();
    let answer = read_all(&mut conn, Duration::from_secs(5)).await;
    let elapsed = started.elapsed();
    assert!(
        answer.is_empty() && elapsed < Duration::from_secs(3),
        "got {answer:?} after {elapsed:?}, want a silent close near 200ms"
    );
}

#[test]
#[ignore = "net/http ConnState and ConnContext hooks chained by limitRequestHeaders; blok-http has no such hooks"]
fn earlier_conn_hooks_still_run() {}

// Bytes of the next head can arrive before the connection goes idle: during
// a handler, in the same packet as the last request, or after a chunked
// body. The clock must start anyway.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_head_read_before_idle_still_gets408() {
    let cases: [(&str, &str, &str); 4] = [
        (
            "split after a handler",
            "GET /slow HTTP/1.1\r\nHost: x\r\n\r\n",
            "GET /b HTTP/1.1\r\nHost: x\r\n",
        ),
        (
            "half a line after a handler",
            "GET /slow HTTP/1.1\r\nHost: x\r\n\r\n",
            "GET /b",
        ),
        (
            "same packet",
            "GET /slow HTTP/1.1\r\nHost: x\r\n\r\nGET /b HTTP/1.1\r\nHost: x\r\n",
            "",
        ),
        (
            "after a chunked body",
            "POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\nGET /b HTTP/1.1\r\nHost: x\r\n",
            "",
        ),
    ];
    for (name, first, later) in cases {
        let handler = |request: Request, mut response: ResponseWriter| async move {
            if request.path() == "/slow" {
                tokio::time::sleep(Duration::from_millis(150)).await;
            }
            write_text(&mut response, "ok").await;
        };
        let server = start(handler, timeouts(Duration::from_millis(100), MINUTE)).await;
        let mut conn = connect(server.address).await;
        write(&mut conn, first.as_bytes()).await;
        if !later.is_empty() {
            tokio::time::sleep(Duration::from_millis(50)).await;
            write(&mut conn, later.as_bytes()).await;
        }
        let answer = String::from_utf8_lossy(&read_all(&mut conn, Duration::from_secs(2)).await)
            .into_owned();
        assert!(
            answer.contains("HTTP/1.1 408 Request Timeout\r\n"),
            "{name}: no 408 within 2s: {answer:?}"
        );
    }
}

// The idle checks above must not cut a keep-alive connection that holds
// nothing of a next request.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_idle_keep_alive_is_not_cut_by_the_header_clock() {
    let cases = [
        ("after a GET", "GET /a HTTP/1.1\r\nHost: x\r\n\r\n"),
        (
            "after a POST",
            "POST /a HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\n\r\nhi",
        ),
        (
            "after a POST and its CRLF",
            "POST /a HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\n\r\nhi\r\n",
        ),
        (
            "after an unread chunked body",
            "POST /a HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nhi\r\n0\r\n\r\n",
        ),
    ];
    for (name, first) in cases {
        let server = start(echo_target, timeouts(Duration::from_millis(100), MINUTE)).await;
        let mut conn = connect(server.address).await;
        write(&mut conn, first.as_bytes()).await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        write(
            &mut conn,
            b"GET /b HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
        )
        .await;
        let answer = String::from_utf8_lossy(&read_all(&mut conn, Duration::from_secs(2)).await)
            .into_owned();
        assert_eq!(
            answer.matches("HTTP/1.1 200 OK\r\n").count(),
            2,
            "{name}: got {answer:?}"
        );
    }
}

//! Wire safety: no handler header reaches the socket unchecked, a head's
//! framing never desyncs the connection, and a request with both
//! Transfer-Encoding and Content-Length ends it, as Kestrel does.

mod common;

use std::time::Duration;

use blok_http::{Config, Request, ResponseWriter};
use common::*;

const NEXT: &[u8] = b"GET /next HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n";

async fn exchange_two(handler: impl blok_http::Handler, first: &[u8]) -> String {
    let server = start(handler, Config::default()).await;
    let mut conn = connect(server.address).await;
    write(&mut conn, &[first, NEXT].concat()).await;
    String::from_utf8_lossy(&read_all(&mut conn, Duration::from_secs(3)).await).into_owned()
}

// Kestrel throws when a response header is set to a byte it refuses, and
// the request ends with an empty 500 (origin-case-fold.json). A handler
// that never writes gets the same check as one that does.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_refused_header_value_is_an_empty_500_on_every_path() {
    let never_writes = |_: Request, mut response: ResponseWriter| async move {
        response
            .headers_mut()
            .set("X-Echo", "a\x01b\r\nInjected: yes");
    };
    let writes = |_: Request, mut response: ResponseWriter| async move {
        response.headers_mut().set("X-Echo", "\u{e9}");
        let _ = response.write(b"body").await;
    };
    let bad_name = |_: Request, mut response: ResponseWriter| async move {
        response.headers_mut().set("X Echo", "v");
    };
    let bad_length = |_: Request, mut response: ResponseWriter| async move {
        response.headers_mut().set("Content-Length", "abc");
        let _ = response.write(b"body").await;
    };
    let starts = |_: Request, mut response: ResponseWriter| async move {
        response.headers_mut().set("X-Echo", "a\x7f");
        let _ = response.start(204).await;
    };
    for answer in [
        exchange_two(never_writes, b"GET / HTTP/1.1\r\nHost: x\r\n\r\n").await,
        exchange_two(writes, b"GET / HTTP/1.1\r\nHost: x\r\n\r\n").await,
        exchange_two(bad_name, b"GET / HTTP/1.1\r\nHost: x\r\n\r\n").await,
        exchange_two(bad_length, b"GET / HTTP/1.1\r\nHost: x\r\n\r\n").await,
        exchange_two(starts, b"GET / HTTP/1.1\r\nHost: x\r\n\r\n").await,
    ] {
        let first = answer.split("\r\n\r\n").next().unwrap_or("");
        assert!(
            first.starts_with("HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n"),
            "{answer:?}"
        );
        assert!(
            !answer.contains("Injected")
                && !answer.contains("X-Echo")
                && !answer.contains("X Echo"),
            "{answer:?}"
        );
        assert!(!answer.contains("abc"), "{answer:?}");
        assert!(!answer.contains("body"), "{answer:?}");
    }
}

// A handler that sets Content-Length and returns without the bytes leaves
// a head the peer will wait on: the connection must not carry another
// request.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_short_body_after_a_set_length_ends_the_connection() {
    let short = |request: Request, mut response: ResponseWriter| async move {
        if request.path() == "/next" {
            return write_text(&mut response, "next").await;
        }
        response.headers_mut().set("Content-Length", "5");
    };
    let answer = exchange_two(short, b"GET / HTTP/1.1\r\nHost: x\r\n\r\n").await;
    assert!(
        answer.starts_with("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n"),
        "{answer:?}"
    );
    assert!(
        !answer.contains("next"),
        "the next request was read as this body's tail: {answer:?}"
    );

    let written_short = |request: Request, mut response: ResponseWriter| async move {
        if request.path() == "/next" {
            return write_text(&mut response, "next").await;
        }
        response.headers_mut().set("Content-Length", "5");
        let _ = response.write(b"ab").await;
    };
    let answer = exchange_two(written_short, b"GET / HTTP/1.1\r\nHost: x\r\n\r\n").await;
    assert!(!answer.contains("next"), "{answer:?}");
}

// Measured on the C# host: a request with Transfer-Encoding and
// Content-Length is read as chunked, answered with Connection: close, and
// the connection ends. (The Go host keeps it open and serves the next.)
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_request_with_both_framings_ends_the_connection() {
    for first in [
        b"POST /a HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nContent-Length: 5\r\n\r\n2\r\nhi\r\n0\r\n\r\n".as_slice(),
        b"POST /a HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nhi\r\n0\r\n\r\n",
        b"GET /a HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nContent-Length: 5\r\n\r\n0\r\n\r\n",
    ] {
        let answer = exchange_two(echo_target, first).await;
        let parsed = responses(answer.as_bytes());
        assert_eq!(parsed.len(), 1, "{answer:?}");
        assert_eq!(parsed[0].header("connection"), Some("close"), "{answer:?}");
        if first.starts_with(b"POST") {
            assert!(String::from_utf8_lossy(&parsed[0].body).ends_with(r#" "hi""#), "{answer:?}");
        }
    }
}

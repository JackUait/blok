//! Response framing, keep-alive, 100-continue and chunked request bodies as
//! measured on the C# host (Kestrel 10) with raw requests.

mod common;

use std::time::Duration;

use blok_http::{Config, Request, ResponseWriter, Server};
use common::*;
use tokio::io::AsyncReadExt;

/// /stream writes once with no length, /sized sets one, /empty writes
/// nothing, /no-content answers 204, /read reads the body and answers its
/// length.
async fn routes(mut request: Request, mut response: ResponseWriter) {
    match request.path() {
        "/stream" => {
            response.headers_mut().set("Content-Type", "text/plain");
            write_text(&mut response, "hello").await;
        }
        "/sized" => {
            response.headers_mut().set("Content-Length", "5");
            write_text(&mut response, "hello").await;
        }
        "/empty" => {}
        "/no-content" => response.set_status(204),
        "/read" => {
            let mut body = Vec::new();
            if request
                .body_mut()
                .unwrap()
                .read_to_end(&mut body)
                .await
                .is_ok()
            {
                let text = format!("read {}", String::from_utf8_lossy(&body));
                write_text(&mut response, &text).await;
            }
        }
        _ => response.set_status(404),
    }
}

async fn answer(request: &[u8]) -> String {
    let server = start(routes, Config::default()).await;
    let mut conn = connect(server.address).await;
    write(&mut conn, request).await;
    let bytes = read_all(&mut conn, Duration::from_millis(1500)).await;
    String::from_utf8_lossy(&bytes)
        .split("\r\n")
        .filter(|line| !line.starts_with("Date: "))
        .collect::<Vec<_>>()
        .join("\r\n")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn answers_are_framed_like_kestrel() {
    let cases: [(&[u8], &str); 9] = [
        (
            b"GET /stream HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
            "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n",
        ),
        // HTTP/1.0 is answered as 1.1, close-delimited, and closes even when
        // it asked for keep-alive.
        (
            b"GET /stream HTTP/1.0\r\n\r\n",
            "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\nhello",
        ),
        (
            b"GET /stream HTTP/1.0\r\nConnection: keep-alive\r\n\r\n",
            "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\nhello",
        ),
        // With a length it keeps the connection and says so.
        (
            b"GET /sized HTTP/1.0\r\nConnection: keep-alive\r\n\r\nGET /stream HTTP/1.0\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: keep-alive\r\n\r\nhello\
             HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\nhello",
        ),
        (
            b"HEAD /stream HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
            "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n",
        ),
        (
            b"HEAD /sized HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\n",
        ),
        (
            b"GET /empty HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        ),
        (
            b"POST /no-content HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
            "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n",
        ),
        // A kept-alive answer names no Connection.
        (
            b"GET /empty HTTP/1.1\r\nHost: x\r\n\r\nGET /empty HTTP/1.1\r\nHost: x\r\nConnection: CLOSE\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\nHTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        ),
    ];
    for (request, want) in cases {
        assert_eq!(answer(request).await, want, "{}", go_quote(request));
    }
}

// Measured: 100 Continue goes out on the first read only when no body byte
// came yet, only on HTTP/1.1, and the value compares ignoring case.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn expect_continue_goes_out_only_for_a_body_not_yet_sent() {
    let server = start(routes, Config::default()).await;
    let head = |version: &str, expect: &str| {
        format!(
            "POST /read HTTP/{version}\r\nHost: x\r\nExpect: {expect}\r\nContent-Length: 2\r\nConnection: close\r\n\r\n"
        )
    };
    for (version, expect, continues) in [
        ("1.1", "100-continue", true),
        ("1.1", "100-CONTINUE", true),
        ("1.0", "100-continue", false),
        ("1.1", "foo", false),
    ] {
        let mut conn = connect(server.address).await;
        write(&mut conn, head(version, expect).as_bytes()).await;
        let mut first = vec![0u8; 64];
        let got = tokio::time::timeout(Duration::from_millis(300), conn.read(&mut first)).await;
        let got = match got {
            Ok(Ok(n)) => String::from_utf8_lossy(&first[..n]).into_owned(),
            _ => String::new(),
        };
        assert_eq!(
            got == "HTTP/1.1 100 Continue\r\n\r\n",
            continues,
            "{version} {expect}: {got:?}"
        );
        write(&mut conn, b"ok").await;
        let rest = String::from_utf8_lossy(&read_all(&mut conn, Duration::from_secs(2)).await)
            .into_owned();
        assert!(rest.contains("read ok"), "{version} {expect}: {rest:?}");
    }
    let sent_with_body = [head("1.1", "100-continue").as_bytes(), b"ok"].concat();
    let got = raw_answer(server.address, &sent_with_body).await;
    assert!(
        got.starts_with("HTTP/1.1 200 OK\r\n") && got.contains("read ok"),
        "{got:?}"
    );
}

// Measured: chunk sizes are hex digits with an optional extension, chunk
// framing needs CRLF, and trailers are read and dropped. A bad chunk gets
// Kestrel's bare 400.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn chunked_bodies_follow_kestrels_grammar() {
    let body = "{\"url\":\"x\"}";
    let cases = [
        (format!("B\r\n{body}\r\n0\r\n\r\n"), true),
        (format!("0b\r\n{body}\r\n0\r\n\r\n"), true),
        (format!("b;x\r\n{body}\r\n0\r\n\r\n"), true),
        (format!("b\r\n{body}\r\n0\r\nX: y\r\n\r\n"), true),
        (format!("b\r\n{body}\r\n00\r\n\r\n"), true),
        (format!("b \r\n{body}\r\n0\r\n\r\n"), false),
        (format!("+b\r\n{body}\r\n0\r\n\r\n"), false),
        (format!("b\r\n{body}xx0\r\n\r\n"), false),
        (format!("b\n{body}\n0\n\n"), false),
        (format!("b\r\n{body}\r\n0\n\r\n"), false),
        (format!("\r\nb\r\n{body}\r\n0\r\n\r\n"), false),
        ("zz\r\n".to_owned(), false),
    ];
    let server = start(routes, Config::default()).await;
    for (chunks, ok) in cases {
        let request = format!(
            "POST /read HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{chunks}"
        );
        let got = raw_answer(server.address, request.as_bytes()).await;
        if ok {
            assert!(got.contains(&format!("read {body}")), "{chunks:?}: {got:?}");
        } else {
            assert_eq!(
                got, "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                "{chunks:?}"
            );
        }
    }
}

// Measured: Kestrel answers nothing to a request whose peer half-closed,
// even a whole one it already read. The Go host answers it.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_half_closed_request_gets_no_answer() {
    let slow = |_: Request, mut response: ResponseWriter| async move {
        tokio::time::sleep(Duration::from_millis(100)).await;
        write_text(&mut response, "late").await;
    };
    let server = start(slow, Config::default()).await;
    let mut conn = connect(server.address).await;
    write(&mut conn, b"GET / HTTP/1.1\r\nHost: x\r\n\r\n").await;
    tokio::io::AsyncWriteExt::shutdown(&mut conn).await.unwrap();
    assert!(read_all(&mut conn, Duration::from_secs(2)).await.is_empty());
}

// Shutdown stops accepting, closes idle connections at once, lets a
// request in flight finish, and does not wait for a hijacked socket.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shutdown_drains_requests_in_flight() {
    let handler = |request: Request, mut response: ResponseWriter| async move {
        if request.path() == "/upgrade" {
            let mut upgraded = response.hijack().await.unwrap();
            let _ = tokio::io::AsyncWriteExt::write_all(&mut upgraded.stream, b"upgraded").await;
            tokio::time::sleep(Duration::from_secs(30)).await;
            return;
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
        write_text(&mut response, "finished").await;
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = Server::new(handler, Config::default());
    let serving = tokio::spawn({
        let server = server.clone();
        async move { server.serve(listener).await }
    });
    let mut idle = connect(address).await;
    let mut upgraded = connect(address).await;
    write(&mut upgraded, b"GET /upgrade HTTP/1.1\r\nHost: x\r\n\r\n").await;
    let mut word = [0u8; 8];
    upgraded.read_exact(&mut word).await.unwrap();
    let mut busy = connect(address).await;
    write(&mut busy, b"GET /slow HTTP/1.1\r\nHost: x\r\n\r\n").await;
    tokio::time::sleep(Duration::from_millis(50)).await;

    let started = std::time::Instant::now();
    let drained = server.shutdown(Duration::from_secs(5)).await;
    assert!(
        drained && started.elapsed() < Duration::from_secs(2),
        "{drained} after {:?}",
        started.elapsed()
    );
    serving.await.unwrap().unwrap();
    assert!(read_all(&mut idle, Duration::from_secs(1)).await.is_empty());
    let answer =
        String::from_utf8_lossy(&read_all(&mut busy, Duration::from_secs(1)).await).into_owned();
    assert!(
        answer.starts_with("HTTP/1.1 200 OK\r\nConnection: close\r\n")
            && answer.contains("finished"),
        "{answer:?}"
    );
    assert!(
        tokio::net::TcpStream::connect(address).await.is_err(),
        "still accepting"
    );
}

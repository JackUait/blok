//! Twins of cmd/blok-server/bodylimit_test.go: Kestrel's MaxRequestBodySize.

mod common;

use blok_http::{BodyError, Config, Request, ResponseWriter};
use common::*;

const KESTREL413: &str =
    "HTTP/1.1 413 Payload Too Large\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

/// Reads up to five body bytes, then answers with what came and, if the
/// body ended first, Go's io.ReadFull error.
async fn read_then_answer(mut request: Request, mut response: ResponseWriter) {
    let body = request.body_mut().unwrap();
    let mut buffer = [0u8; 5];
    let mut n = 0;
    let mut failure = None;
    while n < buffer.len() {
        match body.read(&mut buffer[n..]).await {
            Ok(0) => {
                failure = Some(if n == 0 {
                    "EOF".to_owned()
                } else {
                    "unexpected EOF".to_owned()
                });
                break;
            }
            Ok(read) => n += read,
            Err(error) => {
                failure = Some(error.to_string());
                break;
            }
        }
    }
    let mut text = String::from_utf8_lossy(&buffer[..n]).into_owned();
    if let Some(failure) = failure {
        text.push(' ');
        text.push_str(&failure);
    }
    write_text(&mut response, &text).await;
}

fn post(headers: &str, body: &str) -> String {
    format!("POST /p HTTP/1.1\r\nHost: x\r\n{headers}Connection: close\r\n\r\n{body}")
}

fn body_of(answer: &str) -> String {
    responses(answer.as_bytes())
        .first()
        .map(|r| String::from_utf8_lossy(&r.body).into_owned())
        .unwrap_or_default()
}

// Kestrel's MaxRequestBodySize: 30,000,000 bytes, checked when the handler
// first reads. The handler's own answer after that is dropped.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_body_over_kestrels_cap_gets413() {
    let server = start(read_then_answer, Config::default()).await;
    let cases = [
        (
            "Content-Length over the cap",
            post("Content-Length: 30000001\r\n", "hello"),
            KESTREL413,
        ),
        (
            "over the cap with Expect",
            post("Expect: 100-continue\r\nContent-Length: 30000001\r\n", ""),
            KESTREL413,
        ),
        (
            "Content-Length at the cap",
            post("Content-Length: 30000000\r\n", "hello"),
            "hello",
        ),
    ];
    for (name, request, want) in cases {
        let got = raw_answer(server.address, request.as_bytes()).await;
        let got = if want == KESTREL413 {
            got
        } else {
            body_of(&got)
        };
        assert_eq!(got, want, "{name}");
    }
}

// Kestrel counts the bytes read too, for a body with no Content-Length.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_chunked_body_over_the_cap_gets413() {
    let config = Config {
        max_request_body: 4,
        ..Config::default()
    };
    let server = start(read_then_answer, config).await;
    let over = raw_answer(
        server.address,
        post("Transfer-Encoding: chunked\r\n", "5\r\nhello\r\n0\r\n\r\n").as_bytes(),
    )
    .await;
    assert_eq!(over, KESTREL413);
    // All 14 bytes of "4\r\nhell\r\n0\r\n\r\n" count, not only the data.
    for (cap, at_cap) in [(14, true), (13, false)] {
        let config = Config {
            max_request_body: cap,
            ..Config::default()
        };
        let server = start(read_then_answer, config).await;
        let got = raw_answer(
            server.address,
            post("Transfer-Encoding: chunked\r\n", "4\r\nhell\r\n0\r\n\r\n").as_bytes(),
        )
        .await;
        if at_cap {
            assert!(
                body_of(&got).ends_with("hell unexpected EOF"),
                "at the cap: {got:?}"
            );
        } else {
            assert_eq!(got, KESTREL413, "one byte over");
        }
    }
}

// POST /upload raises the cap to MaxUploadBytes before it reads, as
// UploadEndpoint sets IHttpMaxRequestBodySizeFeature.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_route_can_raise_the_cap_before_it_reads() {
    let raise = |request: Request, response: ResponseWriter| async move {
        request.set_body_limit(40_000_000);
        read_then_answer(request, response).await;
    };
    let server = start(raise, Config::default()).await;
    let got = raw_answer(
        server.address,
        post("Content-Length: 30000001\r\n", "hello").as_bytes(),
    )
    .await;
    assert_eq!(body_of(&got), "hello", "{got:?}");
}

// UploadEndpoint catches Kestrel's 413 and writes its own. So a route that
// set the cap gets the error and answers; the host writes nothing.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_route_that_set_the_cap_answers_an_over_cap_read() {
    let own = |mut request: Request, mut response: ResponseWriter| async move {
        request.set_body_limit(4);
        let mut sink = Vec::new();
        let result = request.body_mut().unwrap().read_to_end(&mut sink).await;
        assert_eq!(result, Err(BodyError::TooLarge));
        let _ = response.start(413).await;
        write_text(&mut response, "file too large\n").await;
    };
    let server = start(own, Config::default()).await;
    let got = raw_answer(
        server.address,
        post("Content-Length: 5\r\n", "hello").as_bytes(),
    )
    .await;
    // The Go host's status line says "Request Entity Too Large", net/http's
    // phrase; Kestrel's is "Payload Too Large".
    assert!(
        got.starts_with("HTTP/1.1 413 Payload Too Large\r\n"),
        "{got:?}"
    );
    assert_eq!(body_of(&got), "file too large\n");
}

// After a refusal the socket is drained only briefly: a client that keeps
// writing finds it closed within two seconds.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_refused_body_closes_after_rst_avoidance() {
    use std::time::{Duration, Instant};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let reads = |mut request: Request, _: ResponseWriter| async move {
        let mut sink = Vec::new();
        let _ = request.body_mut().unwrap().read_to_end(&mut sink).await;
        tokio::time::sleep(Duration::from_millis(100)).await;
    };
    let server = start(reads, Config::default()).await;
    let mut conn = connect(server.address).await;
    write(
        &mut conn,
        post("Content-Length: 30000001\r\n", "hello").as_bytes(),
    )
    .await;
    let mut answer = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(5), conn.read_to_end(&mut answer)).await;
    assert!(
        answer.starts_with(b"HTTP/1.1 413 "),
        "{:?}",
        String::from_utf8_lossy(&answer)
    );
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(4) {
        if conn.write_all(&[b'x'; 1024]).await.is_err() {
            let elapsed = started.elapsed();
            assert!(
                elapsed <= Duration::from_secs(2),
                "closed after {elapsed:?}"
            );
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("still open after 4 s");
}

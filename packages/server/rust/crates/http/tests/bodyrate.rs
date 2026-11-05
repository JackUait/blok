//! Twins of cmd/blok-server/bodyrate_test.go: Kestrel's
//! MinRequestBodyDataRate.

mod common;

use std::time::{Duration, Instant};

use blok_http::{BodyError, BodyRate, Config, Request, ResponseWriter};
use common::*;
use tokio::io::AsyncWriteExt;

const KESTREL408: &str =
    "HTTP/1.1 408 Request Timeout\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

fn with_body_rate(grace: Duration) -> Config {
    Config {
        min_body_rate: Some(BodyRate {
            bytes_per_second: 240.0,
            grace,
        }),
        ..Config::default()
    }
}

fn post(headers: &str) -> String {
    format!("POST /p HTTP/1.1\r\nHost: x\r\n{headers}Connection: close\r\n\r\n")
}

/// Writes head, then body in pieces of size, one per gap, and returns what
/// comes back without the Date line.
async fn trickle(server: &Running, head: &str, body: &str, size: usize, gap: Duration) -> String {
    let conn = connect(server.address).await;
    let (mut read, mut write) = conn.into_split();
    write.write_all(head.as_bytes()).await.unwrap();
    let body = body.as_bytes().to_vec();
    tokio::spawn(async move {
        for piece in body.chunks(size) {
            if write.write_all(piece).await.is_err() {
                return;
            }
            tokio::time::sleep(gap).await;
        }
        // Keep the write side open until the server ends the exchange.
        tokio::time::sleep(Duration::from_secs(5)).await;
    });
    let mut out = Vec::new();
    let _ = tokio::time::timeout(
        Duration::from_secs(5),
        tokio::io::AsyncReadExt::read_to_end(&mut read, &mut out),
    )
    .await;
    String::from_utf8_lossy(&out)
        .split("\r\n")
        .filter(|line| !line.starts_with("Date: ") && *line != "Server: Kestrel")
        .collect::<Vec<_>>()
        .join("\r\n")
}

async fn read_all_body(mut request: Request, mut response: ResponseWriter) {
    let mut body = Vec::new();
    let result = request.body_mut().unwrap().read_to_end(&mut body).await;
    let mut text = String::from_utf8_lossy(&body).into_owned();
    if let Err(error) = result {
        text.push(' ');
        text.push_str(&error.to_string());
    }
    write_text(&mut response, &text).await;
}

// 240 bytes a second after a 5 s grace, else a bare 408 and the connection
// closes. Measured on the C# host: one byte a second got the 408 at about
// 6 s.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_slow_body_gets_kestrels408() {
    let server = start(read_all_body, with_body_rate(Duration::from_millis(300))).await;
    let started = Instant::now();
    let got = trickle(
        &server,
        &post("Content-Length: 200\r\n"),
        &"a".repeat(200),
        1,
        Duration::from_millis(50),
    )
    .await;
    assert_eq!(got, KESTREL408);
    let elapsed = started.elapsed();
    assert!(
        elapsed >= Duration::from_millis(300) && elapsed <= Duration::from_secs(2),
        "answered after {elapsed:?}"
    );
}

// Measured on the C# host: /upload, which sets the cap, catches Kestrel's
// rate failure and answers 400 "malformed upload" itself.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_route_that_set_the_cap_answers_a_slow_body() {
    let handler = |mut request: Request, mut response: ResponseWriter| async move {
        request.set_body_limit(1000);
        let mut sink = Vec::new();
        if let Err(error) = request.body_mut().unwrap().read_to_end(&mut sink).await {
            // The rate failure cancels the request too.
            assert_eq!(error, BodyError::TooSlow);
            assert!(request.is_cancelled());
            let _ = response.start(400).await;
            write_text(&mut response, "malformed upload\n").await;
        }
    };
    let server = start(handler, with_body_rate(Duration::from_millis(300))).await;
    let got = trickle(
        &server,
        &post("Content-Length: 200\r\n"),
        &"a".repeat(200),
        1,
        Duration::from_millis(50),
    )
    .await;
    let parsed = responses(got.as_bytes());
    assert!(got.starts_with("HTTP/1.1 400 Bad Request\r\n"), "{got:?}");
    assert_eq!(parsed[0].body, b"malformed upload\n");
}

// A slow body must not take the handler out of the request deadline or a
// client disconnect: its request still ends.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_slow_body_still_ends_the_handlers_context() {
    let (ended, outcome) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let ended = std::sync::Mutex::new(Some(ended));
    let handler = move |mut request: Request, _: ResponseWriter| {
        let ended = ended.lock().unwrap().take();
        async move {
            request.set_body_limit(1000);
            let mut sink = Vec::new();
            let result = if request
                .body_mut()
                .unwrap()
                .read_to_end(&mut sink)
                .await
                .is_ok()
            {
                Err("the slow body read without an error".to_owned())
            } else {
                tokio::time::timeout(Duration::from_secs(2), request.cancel_token().cancelled())
                    .await
                    .map_err(|_| "the request did not end".to_owned())
            };
            if let Some(ended) = ended {
                let _ = ended.send(result);
            }
        }
    };
    let config = Config {
        request_timeout: Some(Duration::from_secs(1)),
        ..with_body_rate(Duration::from_millis(200))
    };
    let server = start(handler, config).await;
    trickle(
        &server,
        &post("Content-Length: 200\r\n"),
        &"a".repeat(200),
        1,
        Duration::from_millis(50),
    )
    .await;
    outcome.await.unwrap().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_body_at_the_rate_is_read() {
    let server = start(read_all_body, with_body_rate(Duration::from_millis(200))).await;
    let body = "a".repeat(500);
    let got = trickle(
        &server,
        &post("Content-Length: 500\r\n"),
        &body,
        50,
        Duration::from_millis(100),
    )
    .await;
    let parsed = responses(got.as_bytes());
    assert_eq!(
        parsed.first().map(|r| r.body.clone()),
        Some(body.into_bytes()),
        "{got:.80}"
    );
}

// Kestrel times only the reads: a handler busy between reads is not a slow
// body.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn time_between_reads_does_not_count() {
    let handler = |mut request: Request, mut response: ResponseWriter| async move {
        let body = request.body_mut().unwrap();
        let mut buffer = [0u8; 2];
        loop {
            match body.read(&mut buffer).await {
                Ok(0) | Err(_) => return,
                Ok(n) => {
                    let _ = response.write(&buffer[..n]).await;
                }
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    };
    let server = start(handler, with_body_rate(Duration::from_millis(100))).await;
    let got = raw_answer(
        server.address,
        format!("{}abcdef", post("Content-Length: 6\r\n")).as_bytes(),
    )
    .await;
    let parsed = responses(got.as_bytes());
    assert!(got.starts_with("HTTP/1.1 200 OK\r\n"), "{got:?}");
    assert_eq!(parsed[0].body, b"abcdef");
}

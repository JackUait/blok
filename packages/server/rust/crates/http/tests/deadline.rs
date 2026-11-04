mod common;

use std::time::Duration;

use blok_http::{Config, Request, ResponseWriter};
use common::*;
use tokio::sync::oneshot;

fn with_deadline(timeout: Duration) -> Config {
    Config {
        request_timeout: Some(timeout),
        ..Config::default()
    }
}

// HostProcessTests 'CancelsBlockedStorageWorkAtTheHostDeadline': the answer
// is 504 and the work below sees its request cancelled.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deadline_answers504_and_cancels_the_work() {
    let (cancelled, was_cancelled) = oneshot::channel::<()>();
    let cancelled = std::sync::Mutex::new(Some(cancelled));
    let handler = move |request: Request, _: ResponseWriter| {
        let sender = cancelled.lock().unwrap().take();
        async move {
            request.cancel_token().cancelled().await;
            if let Some(sender) = sender {
                let _ = sender.send(());
            }
        }
    };
    let server = start(handler, with_deadline(Duration::from_millis(200))).await;
    let answer = raw_answer(
        server.address,
        b"GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
    )
    .await;
    assert!(
        answer.starts_with("HTTP/1.1 504 Gateway Timeout\r\n"),
        "{answer:?}"
    );
    tokio::time::timeout(Duration::from_secs(2), was_cancelled)
        .await
        .expect("the work was not cancelled")
        .unwrap();
}

// HostProcessTests 'CancelsAStalledRequestBodyAtTheHostDeadline': a body
// that stops arriving still ends in 504, not a hung request.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deadline_ends_a_stalled_body() {
    let handler = |mut request: Request, _: ResponseWriter| async move {
        let mut sink = Vec::new();
        let _ = request.body_mut().unwrap().read_to_end(&mut sink).await;
    };
    let server = start(handler, with_deadline(Duration::from_millis(300))).await;
    let mut conn = connect(server.address).await;
    write(
        &mut conn,
        b"POST /upload HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\npartial",
    )
    .await;
    let answer =
        String::from_utf8_lossy(&read_all(&mut conn, Duration::from_secs(3)).await).into_owned();
    assert!(answer.starts_with("HTTP/1.1 504"), "{answer:?}");
}

// An answer already started is left alone.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deadline_keeps_a_started_answer() {
    let handler = |request: Request, mut response: ResponseWriter| async move {
        let _ = response.start(200).await;
        request.cancel_token().cancelled().await;
    };
    let server = start(handler, with_deadline(Duration::from_millis(200))).await;
    let answer = raw_answer(
        server.address,
        b"GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
    )
    .await;
    assert!(answer.starts_with("HTTP/1.1 200 OK\r\n"), "{answer:?}");
}

// A route that lifts the deadline (GET /sync/{doc}) runs past it: no 504,
// and its request is not cancelled.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_lifted_request_outlives_the_deadline() {
    let handler = |request: Request, mut response: ResponseWriter| async move {
        assert!(request.lift_timeout());
        tokio::time::sleep(Duration::from_millis(400)).await;
        let status = if request.is_cancelled() { 500 } else { 204 };
        response.set_status(status);
    };
    let server = start(handler, with_deadline(Duration::from_millis(150))).await;
    let answer = raw_answer(
        server.address,
        b"GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
    )
    .await;
    assert!(
        answer.starts_with("HTTP/1.1 204 No Content\r\n"),
        "{answer:?}"
    );
}

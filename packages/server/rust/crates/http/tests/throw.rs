//! Twin of Go's throw_test.go (KestrelThrowAnswerTests on the C# side).

mod common;

use std::time::Duration;

use blok_http::{Config, Request, ResponseWriter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn strip_date(text: &str) -> String {
    text.split("\r\n")
        .map(|line| {
            if line.starts_with("Date: ") {
                "Date: D"
            } else {
                line
            }
        })
        .collect::<Vec<_>>()
        .join("\r\n")
}

async fn read_head(conn: &mut tokio::net::TcpStream) -> String {
    let mut head = Vec::new();
    let mut one = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        match tokio::time::timeout(Duration::from_secs(5), conn.read(&mut one)).await {
            Ok(Ok(1)) => head.push(one[0]),
            _ => break,
        }
    }
    String::from_utf8_lossy(&head).into_owned()
}

// A panic before the head is an empty 500 on a connection that stays open;
// after it, the connection is cut.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_handler_panic_answers_as_kestrel_does() {
    let running = common::start(
        |request: Request, mut response: ResponseWriter| async move {
            match request.path() {
                "/throw" => {
                    response.headers_mut().set("X-Before", "1");
                    panic!("boom");
                }
                "/throw-late" => {
                    response.headers_mut().set("Content-Length", "10");
                    let _ = response.write(b"half").await;
                    let _ = response.flush().await;
                    panic!("boom");
                }
                _ => {
                    let _ = response.write(b"ok").await;
                }
            }
        },
        Config::default(),
    )
    .await;

    let mut conn = common::connect(running.address).await;
    conn.write_all(b"GET /throw HTTP/1.1\r\nHost: x\r\n\r\n")
        .await
        .unwrap();
    assert_eq!(
        strip_date(&read_head(&mut conn).await),
        "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nDate: D\r\nServer: Kestrel\r\n\r\n"
    );
    conn.write_all(b"GET /ok HTTP/1.1\r\nHost: x\r\n\r\n")
        .await
        .unwrap();
    let second = read_head(&mut conn).await;
    assert!(second.starts_with("HTTP/1.1 200 OK\r\n"), "{second:?}");

    let mut late = common::connect(running.address).await;
    late.write_all(b"GET /throw-late HTTP/1.1\r\nHost: x\r\n\r\n")
        .await
        .unwrap();
    let all = common::read_all(&mut late, Duration::from_secs(5)).await;
    assert_eq!(
        strip_date(&String::from_utf8_lossy(&all)),
        "HTTP/1.1 200 OK\r\nContent-Length: 10\r\nDate: D\r\nServer: Kestrel\r\n\r\nhalf"
    );
}

// KestrelHeldStatusTests: a status a handler sets is not an answer until
// the head is sent. A panic then is an empty 500, and the deadline is a 504.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_status_set_without_a_write_is_held_until_the_head_goes_out() {
    let running = common::start(
        |request: Request, mut response: ResponseWriter| async move {
            match request.path() {
                "/status-throw" => {
                    response.set_status(404);
                    panic!("boom");
                }
                "/status-timeout" => {
                    response.set_status(202);
                    request.cancel_token().cancelled().await;
                }
                "/status-returns" => response.set_status(202),
                "/hdr-timeout" => {
                    response.headers_mut().set("X-Probe", "kept");
                    response
                        .headers_mut()
                        .set("Content-Type", "application/json");
                    request.cancel_token().cancelled().await;
                }
                "/hdr-status-timeout" => {
                    response.headers_mut().set("X-Probe", "kept");
                    response
                        .headers_mut()
                        .set("Content-Type", "application/json");
                    response.set_status(202);
                    request.cancel_token().cancelled().await;
                }
                "/hdr-status-throw" => {
                    response.headers_mut().set("X-Probe", "kept");
                    response
                        .headers_mut()
                        .set("Content-Type", "application/json");
                    response.set_status(404);
                    panic!("boom");
                }
                _ => {
                    response.set_status(202);
                    let _ = response.flush().await;
                    request.cancel_token().cancelled().await;
                }
            }
        },
        Config {
            request_timeout: Some(Duration::from_millis(200)),
            ..Config::default()
        },
    )
    .await;
    for (path, head) in [
        (
            "/status-throw",
            "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nDate: D\r\nServer: Kestrel\r\n\r\n",
        ),
        (
            "/status-timeout",
            "HTTP/1.1 504 Gateway Timeout\r\nContent-Length: 0\r\nDate: D\r\nServer: Kestrel\r\n\r\n",
        ),
        (
            "/status-returns",
            "HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\nDate: D\r\nServer: Kestrel\r\n\r\n",
        ),
        (
            "/flushed-timeout",
            "HTTP/1.1 202 Accepted\r\nDate: D\r\nServer: Kestrel\r\nTransfer-Encoding: chunked\r\n\r\n",
        ),
        (
            "/hdr-timeout",
            "HTTP/1.1 504 Gateway Timeout\r\nContent-Length: 0\r\nDate: D\r\nServer: Kestrel\r\n\r\n",
        ),
        (
            "/hdr-status-timeout",
            "HTTP/1.1 504 Gateway Timeout\r\nContent-Length: 0\r\nDate: D\r\nServer: Kestrel\r\n\r\n",
        ),
        (
            "/hdr-status-throw",
            "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nDate: D\r\nServer: Kestrel\r\n\r\n",
        ),
    ] {
        let mut conn = common::connect(running.address).await;
        conn.write_all(format!("GET {path} HTTP/1.1\r\nHost: x\r\n\r\n").as_bytes())
            .await
            .unwrap();
        assert_eq!(strip_date(&read_head(&mut conn).await), head, "{path}");
    }
}

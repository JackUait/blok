mod common;

use std::time::Duration;

use blok_http::{Config, Request, ResponseWriter};
use common::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const UPGRADE: &str = "GET /sync/doc HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\
                       Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n";

// A sync socket opts out of the request deadline, as GET /sync/{doc} does
// with DisableRequestTimeout: it outlives the deadline, the header clock and
// the idle timeout, and no 504 lands on the upgraded stream.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_upgraded_socket_outlives_the_request_deadline() {
    const SHORT: Duration = Duration::from_millis(150);
    let handler = |request: Request, response: ResponseWriter| async move {
        let conn = match blok_ws::upgrade(response, &request, blok_ws::Options::default()).await {
            Ok(conn) => conn,
            Err(error) => panic!("upgrade: {error}"),
        };
        let mut buf = [0u8; 64];
        loop {
            match conn.receive(&mut buf).await {
                Ok((n, kind, _)) if kind != blok_ws::MessageType::Close => {
                    if conn.send_binary(&buf[..n]).await.is_err() {
                        break;
                    }
                }
                _ => break,
            }
        }
        conn.abort();
    };
    let config = Config {
        request_timeout: Some(SHORT),
        header_timeout: SHORT,
        keep_alive_timeout: SHORT,
        ..Config::default()
    };
    let server = start(handler, config).await;
    let mut client = connect(server.address).await;
    write(&mut client, format!("{UPGRADE}\r\n").as_bytes()).await;
    let mut head = Vec::new();
    while find(&head, b"\r\n\r\n").is_none() {
        let mut byte = [0u8; 1];
        let n = tokio::time::timeout(Duration::from_secs(5), client.read(&mut byte))
            .await
            .unwrap()
            .unwrap();
        assert!(
            n == 1,
            "closed before the 101: {:?}",
            String::from_utf8_lossy(&head)
        );
        head.push(byte[0]);
    }
    let head = String::from_utf8_lossy(&head).into_owned();
    assert!(
        head.starts_with("HTTP/1.1 101 Switching Protocols\r\n"),
        "upgrade: {head:?}"
    );

    tokio::time::sleep(SHORT * 4).await;
    client
        .write_all(&[0x82, 0x83, 0, 0, 0, 0, b'a', b'b', b'c'])
        .await
        .expect("the socket died at the deadline");
    let mut got = [0u8; 5];
    tokio::time::timeout(Duration::from_secs(5), client.read_exact(&mut got))
        .await
        .expect("no echo after the deadline")
        .unwrap();
    assert!(
        !String::from_utf8_lossy(&got).contains("HTTP"),
        "an HTTP answer landed on the socket: {got:?}"
    );
    assert_eq!(got, [0x82, 3, b'a', b'b', b'c']);
    // The deadline must know the writer was hijacked, not try a 504 on it.
    tokio::time::sleep(SHORT).await;
    let mut more = [0u8; 16];
    let extra = tokio::time::timeout(Duration::from_millis(50), client.read(&mut more)).await;
    assert!(extra.is_err(), "more bytes on the socket: {extra:?}");
}

// A sync request the door refuses never upgrades, so its lifted deadline
// must not leave the body unbounded: the host drains an unread body after
// the handler, and a trickled one would pin the connection forever.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_refused_sync_request_still_ends_a_trickled_body_at_the_deadline() {
    const SHORT: Duration = Duration::from_millis(150);
    // What the sync door does for a request with a body: lift, then refuse.
    let handler = |request: Request, mut response: ResponseWriter| async move {
        request.lift_timeout();
        response.set_status(426);
    };
    let server = start(
        handler,
        Config {
            request_timeout: Some(SHORT),
            ..Config::default()
        },
    )
    .await;
    let client = connect(server.address).await;
    let (mut read, mut write) = client.into_split();
    write
        .write_all(format!("{UPGRADE}Content-Length: 1000\r\n\r\nx").as_bytes())
        .await
        .unwrap();
    let closed = tokio::spawn(async move {
        let mut sink = [0u8; 1024];
        while matches!(read.read(&mut sink).await, Ok(n) if n > 0) {}
    });
    let started = std::time::Instant::now();
    while started.elapsed() < Duration::from_secs(2) {
        if closed.is_finished() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
        if write.write_all(b"x").await.is_err() {
            return;
        }
    }
    panic!(
        "the connection was still open {:?} after a {SHORT:?} deadline",
        started.elapsed()
    );
}

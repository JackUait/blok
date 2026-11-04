mod common;

use std::time::Duration;

use blok_http::{Config, Request, ResponseWriter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// Sends request, ends the client's side after pause, and returns all that
/// came back.
async fn half_closed(address: std::net::SocketAddr, request: &[u8], pause: Duration) -> String {
    let mut conn = TcpStream::connect(address).await.unwrap();
    conn.write_all(request).await.unwrap();
    tokio::time::sleep(pause).await;
    conn.shutdown().await.unwrap();
    let mut answer = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(5), conn.read_to_end(&mut answer)).await;
    String::from_utf8_lossy(&answer).into_owned()
}

// Measured on the C# host: once the client has ended its side, Kestrel
// writes nothing more, for a complete request, a refused head, a pipelined
// pair or a partial head, however fast the answer. An answer written
// before the end still goes out.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn nothing_is_answered_once_the_client_ends_its_side() {
    let running = common::start(
        |_request: Request, mut response: ResponseWriter| async move {
            // Past the client's end, which a peer this close sends at once.
            tokio::time::sleep(Duration::from_millis(20)).await;
            let _ = response.write(b"answer").await;
        },
        Config::default(),
    )
    .await;
    let cases: [(&str, &[u8]); 4] = [
        ("a complete request", b"GET /a HTTP/1.1\r\nHost: x\r\n\r\n"),
        ("a refused head", b"GET /a HTTP/1.2\r\nHost: x\r\n\r\n"),
        (
            "a pipelined pair",
            b"GET /a HTTP/1.1\r\nHost: x\r\n\r\nGET /b HTTP/1.1\r\nHost: x\r\n\r\n",
        ),
        ("a head with no end", b"GET /a HTTP/1.1\r\nHost: x\r\n"),
    ];
    let mut answered = Vec::new();
    for (name, request) in cases {
        for _ in 0..30 {
            let got = half_closed(running.address, request, Duration::ZERO).await;
            if !got.is_empty() {
                answered.push(format!("{name}: {got:?}"));
            }
        }
    }
    assert!(
        answered.is_empty(),
        "{} answered:\n{}",
        answered.len(),
        answered.join("\n")
    );
    let got = half_closed(
        running.address,
        b"GET /a HTTP/1.1\r\nHost: x\r\n\r\n",
        Duration::from_millis(300),
    )
    .await;
    assert!(
        got.ends_with("answer\r\n0\r\n\r\n"),
        "an end after the answer: {got:?}"
    );
}

mod common;

use std::time::{Duration, Instant};

use blok_http::{Config, Request, ResponseWriter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

// Measured on the C# host: a download whose reader stalls from its first
// byte is reset at the request deadline (600 s by default), not before: the
// minimum response rate counts bytes the kernel took, so it never tripped.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_stalled_reader_is_reset_at_the_request_deadline() {
    let config = Config {
        request_timeout: Some(Duration::from_secs(1)),
        ..Config::default()
    };
    let running = common::start(
        |_request: Request, mut response: ResponseWriter| async move {
            let size: usize = 64 << 20;
            response
                .headers_mut()
                .set("Content-Length", size.to_string());
            let chunk = vec![b'y'; 1 << 16];
            for _ in 0..size / chunk.len() {
                if response.write(&chunk).await.is_err() {
                    return;
                }
            }
        },
        config,
    )
    .await;
    let socket = tokio::net::TcpSocket::new_v4().unwrap();
    socket.set_recv_buffer_size(1024).unwrap();
    let mut conn = socket.connect(running.address).await.unwrap();
    conn.write_all(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n")
        .await
        .unwrap();
    let started = Instant::now();
    tokio::time::sleep(Duration::from_secs(3)).await;
    let mut read = 0usize;
    let mut chunk = vec![0u8; 1 << 16];
    let ended = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match conn.read(&mut chunk).await {
                Ok(0) | Err(_) => return,
                Ok(n) => read += n,
            }
        }
    })
    .await;
    assert!(
        ended.is_ok(),
        "the connection was still open after {:?}",
        started.elapsed()
    );
    assert!(read < 64 << 20, "the whole body went out ({read} bytes)");
}

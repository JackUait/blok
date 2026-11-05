//! a compressed bomb on the frame-check limits (truncate,
//! 256 KiB) and on the unfurl limits (no truncate, 2 MiB). Rust decodes by
//! pushing raw chunks into a capped output, Go by pulling through a
//! LimitReader, so the stop has to come from the decoder loop itself.

use std::io::Write;
use std::sync::Arc;
use std::time::{Duration, Instant};

use blok_outbound::{ExactOriginPolicy, Failure, Fetcher, Limits};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const DECODED: usize = 1 << 30;

fn zeros_brotli() -> Vec<u8> {
    let mut out = Vec::new();
    {
        let mut w = brotli::CompressorWriter::new(&mut out, 1 << 16, 5, 22);
        let block = vec![0u8; 1 << 20];
        for _ in 0..DECODED / block.len() {
            w.write_all(&block).unwrap();
        }
    }
    out
}

fn zeros_gzip() -> Vec<u8> {
    let mut e = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
    let block = vec![0u8; 1 << 20];
    for _ in 0..DECODED / block.len() {
        e.write_all(&block).unwrap();
    }
    e.finish().unwrap()
}

async fn serve(encoding: &'static str, body: Vec<u8>) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let body = Arc::new(body);
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let body = Arc::clone(&body);
            tokio::spawn(async move {
                let mut buf = [0u8; 4096];
                let _ = socket.read(&mut buf).await;
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Encoding: {encoding}\r\nContent-Length: {}\r\n\r\n",
                    body.len()
                );
                let _ = socket.write_all(head.as_bytes()).await;
                let _ = socket.write_all(&body).await;
            });
        }
    });
    port
}

fn fetcher(port: u16) -> Fetcher {
    Fetcher::new(Arc::new(ExactOriginPolicy {
        origin: format!("http://127.0.0.1:{port}"),
        port,
    }))
}

fn limits(max_bytes: u64, truncate: bool) -> Limits {
    Limits {
        timeout: Duration::from_secs(10),
        max_bytes,
        max_redirects: 5,
        hop: None,
        truncate,
        upload: false,
        caller: String::new(),
    }
}

async fn check(encoding: &'static str, body: Vec<u8>) {
    let raw = body.len();
    let port = serve(encoding, body).await;
    let url = format!("http://127.0.0.1:{port}/bomb");

    let started = Instant::now();
    let page = fetcher(port)
        .get(&url, &limits(256 << 10, true))
        .await
        .expect("frame-check keeps a truncated page");
    let took = started.elapsed();
    eprintln!(
        "{encoding}: raw {raw} B, frame-check kept {} B in {took:?}",
        page.body.len()
    );
    assert!(page.body.len() <= 256 << 10);
    assert!(
        took < Duration::from_secs(2),
        "{encoding} bomb took {took:?}"
    );

    let started = Instant::now();
    let failed = fetcher(port).get(&url, &limits(2 << 20, false)).await;
    let took = started.elapsed();
    eprintln!(
        "{encoding}: unfurl limits answered {:?} in {took:?}",
        failed.as_ref().err()
    );
    assert!(matches!(failed, Err(e) if e.failure == Failure::TooLarge));
    assert!(
        took < Duration::from_secs(2),
        "{encoding} bomb took {took:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn brotli_bomb_stops_at_the_cap() {
    check("br", zeros_brotli()).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn gzip_bomb_stops_at_the_cap() {
    check("gzip", zeros_gzip()).await;
}

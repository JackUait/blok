use tokio::io::BufReader;

use crate::wire::{Body, Framing, Source, WireError, framing, read_head};

#[tokio::test]
async fn skips_interim_answers_up_to_go_transports_cap() {
    let five = format!(
        "{}HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n",
        "HTTP/1.1 100 Continue\r\n\r\n".repeat(5)
    );
    let head = read_head(&mut BufReader::new(five.as_bytes()), 1 << 10)
        .await
        .unwrap();
    assert_eq!(head.status, 200);
    let six = format!(
        "{}HTTP/1.1 200 OK\r\n\r\n",
        "HTTP/1.1 103 Early Hints\r\n\r\n".repeat(6)
    );
    let got = read_head(&mut BufReader::new(six.as_bytes()), 1 << 10).await;
    assert!(matches!(got, Err(WireError::Malformed(_))));
}

#[tokio::test]
async fn refuses_a_head_over_its_cap_and_conflicting_lengths() {
    let big = format!("HTTP/1.1 200 OK\r\nX: {}\r\n\r\n", "a".repeat(2048));
    let got = read_head(&mut BufReader::new(big.as_bytes()), 1 << 10).await;
    assert!(matches!(got, Err(WireError::HeadTooLarge)));
    let two = b"HTTP/1.1 200 OK\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\n";
    let head = read_head(&mut BufReader::new(&two[..]), 1 << 10)
        .await
        .unwrap();
    assert!(framing(&head).is_err());
    let chunked = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Length: 9\r\n\r\n";
    let head = read_head(&mut BufReader::new(&chunked[..]), 1 << 10)
        .await
        .unwrap();
    assert_eq!(framing(&head).unwrap(), Framing::Chunked);
}

async fn read_chunked(bytes: &[u8]) -> std::io::Result<Vec<u8>> {
    let mut body = Body::new(BufReader::new(bytes), Framing::Chunked);
    let mut out = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        let n = body.read(&mut chunk).await?;
        if n == 0 {
            return Ok(out);
        }
        out.extend_from_slice(&chunk[..n]);
    }
}

// A chunk-size line or a trailer section that never ends must not grow
// without bound before the deadline fires.
#[tokio::test]
async fn caps_a_chunk_size_line_and_the_trailers() {
    assert_eq!(
        read_chunked(b"2;x=y\r\nok\r\n0\r\nA: b\r\n\r\n")
            .await
            .unwrap(),
        b"ok"
    );
    let long_line = format!("2;{}\r\nok\r\n0\r\n\r\n", "x".repeat(10 << 10));
    assert!(read_chunked(long_line.as_bytes()).await.is_err());
    let trailers = format!("2\r\nok\r\n0\r\n{}\r\n", "A: b\r\n".repeat(20 << 10));
    assert!(read_chunked(trailers.as_bytes()).await.is_err());
}

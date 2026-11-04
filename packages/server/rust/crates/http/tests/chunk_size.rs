mod common;

use blok_http::{BodyError, Config, Request, ResponseWriter};
use common::*;

/// Reads the body as /delete does, and says how the read ended.
async fn read_body(mut request: Request, mut response: ResponseWriter) {
    let route_set = request.path() == "/own-cap";
    if route_set {
        request.set_body_limit(1 << 20);
    }
    let mut body = Vec::new();
    let result = request.body_mut().unwrap().read_to_end(&mut body).await;
    if let Err(error) = result
        && route_set
    {
        let overflow = error == BodyError::Overflow;
        let _ = response
            .write(format!("route saw overflow={overflow}").as_bytes())
            .await;
    }
}

fn chunked(path: &str, size: &str) -> Vec<u8> {
    format!("POST {path} HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n{size}\r\n")
        .into_bytes()
}

const UNHANDLED_500: &str = "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n";
const BARE_400: &str = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

// Measured on the C# host: Kestrel adds each hex digit to an int, checked,
// so a size past 0x7FFFFFFF throws OverflowException, which the app sees as
// an unhandled error: an empty 500 with no Connection header, then the
// close. A ninth digit that does not overflow is Kestrel's own 400.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_chunk_size_past_int_max_is_the_apps_500() {
    let server = start(read_body, Config::default()).await;
    let cases = [
        ("80000000", UNHANDLED_500),
        ("080000000", UNHANDLED_500),
        ("800000000", UNHANDLED_500),
        ("FFFFFFFFF", UNHANDLED_500),
        ("1000000000", UNHANDLED_500),
        ("10000000000000000", UNHANDLED_500),
        ("7FFFFFFFFFFFFFFF", UNHANDLED_500),
        ("FFFFFFFFFFFFFFFF", UNHANDLED_500),
        ("80000000;ext", UNHANDLED_500),
        ("0080000000", BARE_400),
        ("00080000000", BARE_400),
        ("000000001", BARE_400),
        ("0000000001", BARE_400),
    ];
    let mut failures = Vec::new();
    for (size, want) in cases {
        let got = raw_answer(server.address, &chunked("/delete", size)).await;
        if got != want {
            failures.push(format!("{size}: {got:?}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

// A route that set the cap answers the overflow itself, as UploadEndpoint
// does (measured: 400 "malformed upload").
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_route_that_set_the_cap_sees_the_overflow() {
    let server = start(read_body, Config::default()).await;
    let got = raw_answer(server.address, &chunked("/own-cap", "80000000")).await;
    assert!(got.contains("route saw overflow=true"), "{got:?}");
}

// Measured on the C# host: after the last chunk Kestrel reads a trailer line
// only once it holds two bytes, so a lone LF waits (408 at the body rate)
// and the byte after it gets the 400 for the bare LF.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_lone_lf_after_the_last_chunk_waits_for_one_more_byte() {
    use tokio::io::AsyncReadExt;
    let server = start(read_body, Config::default()).await;
    let mut conn = connect(server.address).await;
    write(&mut conn, &chunked("/delete", "0")[..]).await;
    write(&mut conn, b"\n").await;
    let mut first = [0u8; 64];
    let early =
        tokio::time::timeout(std::time::Duration::from_millis(500), conn.read(&mut first)).await;
    assert!(
        early.is_err(),
        "answered at once: {:?}",
        early.map(|r| r.map(|n| String::from_utf8_lossy(&first[..n]).into_owned()))
    );
    write(&mut conn, b"G").await;
    let got =
        String::from_utf8_lossy(&read_all(&mut conn, std::time::Duration::from_secs(3)).await)
            .into_owned();
    assert!(
        got.starts_with("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n"),
        "{got:?}"
    );
}

// Kestrel's ParseChunkedPrefix decides on the bytes so far: a bare LF after
// the size waits for one more byte, and a size line that cannot be hex is
// refused once two bytes are in, before any line end.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn kestrel_chunk_prefix_waits_on_a_partial_line() {
    use std::time::Duration;
    use tokio::io::AsyncReadExt;
    let server = start(read_body, Config::default()).await;
    let answer = |bytes: Vec<u8>| {
        String::from_utf8_lossy(&bytes)
            .split("\r\n")
            .filter(|line| !line.starts_with("Date: "))
            .collect::<Vec<_>>()
            .join("\r\n")
    };
    let head = b"POST /delete HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n";

    let mut conn = connect(server.address).await;
    write(&mut conn, &[&head[..], b"2\n"].concat()).await;
    let mut first = [0u8; 64];
    let early = tokio::time::timeout(Duration::from_millis(500), conn.read(&mut first)).await;
    assert!(
        early.is_err(),
        "answered at once: {:?}",
        early.map(|r| r.map(|n| String::from_utf8_lossy(&first[..n]).into_owned()))
    );
    write(&mut conn, b"{").await;
    assert_eq!(
        answer(read_all(&mut conn, Duration::from_secs(3)).await),
        BARE_400
    );

    let mut conn = connect(server.address).await;
    write(&mut conn, &[&head[..], b"zz"].concat()).await;
    assert_eq!(
        answer(read_all(&mut conn, Duration::from_secs(2)).await),
        BARE_400
    );
}

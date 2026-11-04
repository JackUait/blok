//! Twin of cmd/blok-server/chunkcap_test.go.

mod common;

use std::time::Duration;

use blok_http::{Config, Request, ResponseWriter};
use common::*;

/// Splits data into k chunks; ext goes on the first size line.
fn chunked_body(data: usize, k: usize, ext: &str, trailer: &str) -> String {
    let size = data.div_ceil(k);
    let mut out = String::new();
    let mut i = 0;
    while i < data {
        let part = size.min(data - i);
        out.push_str(&format!("{part:x}"));
        if i == 0 {
            out.push_str(ext);
        }
        out.push_str(&format!("\r\n{}\r\n", "x".repeat(part)));
        i += size;
    }
    format!("{out}0\r\n{trailer}\r\n")
}

fn head(path: &str) -> String {
    format!(
        "POST {path} HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
    )
}

async fn read(mut request: Request, mut response: ResponseWriter) {
    if request.path() == "/route" {
        request.set_body_limit(1000);
    }
    let mut sink = Vec::new();
    if request
        .body_mut()
        .unwrap()
        .read_to_end(&mut sink)
        .await
        .is_err()
    {
        return;
    }
    write_text(&mut response, "read").await;
}

fn read_it(answer: &str) -> bool {
    responses(answer.as_bytes())
        .first()
        .is_some_and(|r| r.status == 200 && r.body == b"read")
}

/// Writes first, waits, then writes rest in pieces of size, and reads until
/// the close.
async fn trickle(
    server: &Running,
    first: &str,
    pause: Duration,
    rest: &str,
    size: usize,
) -> String {
    let mut conn = connect(server.address).await;
    write(&mut conn, first.as_bytes()).await;
    tokio::time::sleep(pause).await;
    for piece in rest.as_bytes().chunks(size) {
        if tokio::io::AsyncWriteExt::write_all(&mut conn, piece)
            .await
            .is_err()
        {
            break;
        }
    }
    String::from_utf8_lossy(&read_all(&mut conn, Duration::from_secs(5)).await).into_owned()
}

// Measured on the C# host (/upload, cap 1000): Kestrel counts every byte of
// a chunked body against the cap, its size lines, extensions and CRLFs
// included, and the last CRLF too unless a trailer comes before it. The
// trailer's own lines are not counted.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn kestrel_counts_a_chunked_bodys_framing_against_the_cap() {
    let e100 = format!(";{}", "e".repeat(100));
    let e500 = format!(";{}", "e".repeat(500));
    let cases: [(&str, usize, &str, &str, usize); 8] = [
        ("one chunk", 1, "", "", 988),
        ("a one-byte extension", 1, ";", "", 987),
        ("a two-byte extension", 1, ";e", "", 986),
        ("a 101-byte extension", 1, &e100, "", 887),
        ("a 501-byte extension", 1, &e500, "", 487),
        ("ten chunks", 10, "", "", 935),
        ("fifty chunks", 50, "", "", 745),
        ("a trailer", 1, "", "X-T: 1\r\n", 990),
    ];
    let capped = start(
        read,
        Config {
            max_request_body: 1000,
            ..Config::default()
        },
    )
    .await;
    let default = start(read, Config::default()).await;
    let mut failures = Vec::new();
    for (server, path) in [(&capped, "/default"), (&default, "/route")] {
        for (name, k, ext, trailer, max) in cases {
            for data in [max, max + 1] {
                let body = chunked_body(data, k, ext, trailer);
                let got = trickle(server, &head(path), Duration::ZERO, &body, 1).await;
                if read_it(&got) != (data == max) {
                    failures.push(format!("{path} {name}, {data} bytes of data: got {got:?}"));
                }
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    // The bytes may come after the route set its cap, or with the head.
    let got = trickle(
        &default,
        &head("/route"),
        Duration::from_millis(100),
        &chunked_body(989, 1, "", ""),
        4096,
    )
    .await;
    assert!(
        !read_it(&got),
        "a late body over the route's cap: got {got:?}"
    );
}

//! Loopback helpers for the crate's tests: a real blok-http server, raw
//! requests, parsed answers.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use blok_http::{Config, Handler, Server};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

pub struct Running {
    pub address: SocketAddr,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Running {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub async fn start(handler: impl Handler) -> Running {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = Server::new(handler, Config::default());
    let task = tokio::spawn(async move {
        let _ = server.serve(listener).await;
    });
    Running { address, task }
}

#[derive(Debug)]
pub struct Answer {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Answer {
    pub fn header(&self, name: &str) -> &str {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map_or("", |(_, v)| v.as_str())
    }

    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Sends head lines (no request line's CRLF, no blank line) and body on a
/// fresh connection, with Connection: close.
pub async fn send(address: SocketAddr, head: &str, body: &[u8]) -> Answer {
    let conn = TcpStream::connect(address).await.unwrap();
    let mut request = format!("{head}\r\nHost: x\r\nConnection: close\r\n\r\n").into_bytes();
    request.extend_from_slice(body);
    // Written beside the read: a server that answers early stops reading.
    let (mut read, mut write) = conn.into_split();
    let writer = tokio::spawn(async move {
        let _ = write.write_all(&request).await;
        write
    });
    let answer = read_answer(&mut read, head.starts_with("HEAD ")).await;
    writer.abort();
    answer
}

pub async fn read_answer(conn: &mut (impl AsyncReadExt + Unpin), head_request: bool) -> Answer {
    let mut bytes = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(10), conn.read_to_end(&mut bytes)).await;
    let end = find(&bytes, b"\r\n\r\n").expect("a response head");
    let head = String::from_utf8_lossy(&bytes[..end]).into_owned();
    let mut lines = head.split("\r\n");
    let status = lines.next().unwrap()[9..12].parse().unwrap();
    let headers: Vec<(String, String)> = lines
        .filter_map(|line| line.split_once(": "))
        .map(|(n, v)| (n.to_owned(), v.to_owned()))
        .collect();
    let mut rest = &bytes[end + 4..];
    let mut body = Vec::new();
    let chunked = headers
        .iter()
        .any(|(n, v)| n.eq_ignore_ascii_case("transfer-encoding") && v == "chunked");
    if chunked {
        while let Some(line_end) = find(rest, b"\r\n") {
            let size =
                usize::from_str_radix(&String::from_utf8_lossy(&rest[..line_end]), 16).unwrap();
            rest = &rest[line_end + 2..];
            if size == 0 {
                break;
            }
            body.extend_from_slice(&rest[..size]);
            rest = &rest[size + 2..];
        }
    } else if !head_request {
        body.extend_from_slice(rest);
    }
    Answer {
        status,
        headers,
        body,
    }
}

/// A fresh directory under the system temp dir.
pub fn temp_dir() -> PathBuf {
    let mut random = [0u8; 8];
    getrandom::fill(&mut random).unwrap();
    let hex: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let dir = std::env::temp_dir().join(format!("blok-server-test-{hex}"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

pub fn fixture_path(name: &str) -> String {
    format!(
        "{}/../../../../../test/unit/server-conformance/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    )
}

#![allow(dead_code)]

use std::net::SocketAddr;
use std::time::Duration;

use blok_http::{Config, Handler, Request, ResponseWriter, Server};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// A server on a loopback port, stopped when dropped.
pub struct Running {
    pub address: SocketAddr,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Running {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub async fn start(handler: impl Handler, config: Config) -> Running {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = Server::new(handler, config);
    let task = tokio::spawn(async move {
        let _ = server.serve(listener).await;
    });
    Running { address, task }
}

/// The host's config with these header and idle limits.
pub fn timeouts(header: Duration, idle: Duration) -> Config {
    Config {
        header_timeout: header,
        keep_alive_timeout: idle,
        ..Config::default()
    }
}

pub async fn connect(address: SocketAddr) -> TcpStream {
    TcpStream::connect(address).await.unwrap()
}

/// Reads until the server closes or the wait runs out.
pub async fn read_all(conn: &mut TcpStream, wait: Duration) -> Vec<u8> {
    let mut out = Vec::new();
    let _ = tokio::time::timeout(wait, async {
        let mut chunk = [0u8; 8192];
        loop {
            match conn.read(&mut chunk).await {
                Ok(0) | Err(_) => break,
                Ok(n) => out.extend_from_slice(&chunk[..n]),
            }
        }
    })
    .await;
    out
}

/// Sends request on a fresh connection and returns what comes back before
/// the close, with the Date line dropped.
pub async fn raw_answer(address: SocketAddr, request: &[u8]) -> String {
    let mut conn = connect(address).await;
    conn.write_all(request).await.unwrap();
    let answer = read_all(&mut conn, Duration::from_secs(5)).await;
    let text = String::from_utf8_lossy(&answer).into_owned();
    text.split("\r\n")
        .filter(|line| !line.starts_with("Date: "))
        .collect::<Vec<_>>()
        .join("\r\n")
}

pub async fn write(conn: &mut TcpStream, bytes: &[u8]) {
    conn.write_all(bytes).await.unwrap();
}

/// One parsed response: status, headers, body (chunked bodies joined).
#[derive(Debug)]
pub struct Parsed {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Parsed {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

/// Every whole response in bytes, in order.
pub fn responses(mut bytes: &[u8]) -> Vec<Parsed> {
    let mut out = Vec::new();
    while let Some(end) = find(bytes, b"\r\n\r\n") {
        let head = String::from_utf8_lossy(&bytes[..end]).into_owned();
        let mut lines = head.split("\r\n");
        let Some(status) = lines
            .next()
            .and_then(|line| line.get(9..12))
            .and_then(|code| code.parse().ok())
        else {
            break;
        };
        let headers: Vec<(String, String)> = lines
            .filter_map(|line| line.split_once(": "))
            .map(|(n, v)| (n.to_owned(), v.to_owned()))
            .collect();
        let mut rest = &bytes[end + 4..];
        let get = |name: &str| {
            headers
                .iter()
                .find(|(n, _)| n.eq_ignore_ascii_case(name))
                .map(|(_, v)| v.clone())
        };
        let mut body = Vec::new();
        if get("transfer-encoding").is_some() {
            loop {
                let Some(line_end) = find(rest, b"\r\n") else {
                    return out;
                };
                let size = usize::from_str_radix(&String::from_utf8_lossy(&rest[..line_end]), 16)
                    .unwrap_or(0);
                rest = &rest[line_end + 2..];
                if size == 0 {
                    rest = rest.get(2..).unwrap_or(&[]);
                    break;
                }
                if rest.len() < size + 2 {
                    return out;
                }
                body.extend_from_slice(&rest[..size]);
                rest = &rest[size + 2..];
            }
        } else if let Some(length) = get("content-length").and_then(|v| v.parse::<usize>().ok()) {
            if rest.len() < length {
                return out;
            }
            body.extend_from_slice(&rest[..length]);
            rest = &rest[length..];
        } else if status != 204
            && status != 304
            && status >= 200
            && get("connection").as_deref() == Some("close")
        {
            body.extend_from_slice(rest);
            rest = &[];
        }
        out.push(Parsed {
            status,
            headers,
            body,
        });
        bytes = rest;
    }
    out
}

pub fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Go's %q for the strings these tests echo.
pub fn go_quote(bytes: &[u8]) -> String {
    let mut out = String::from("\"");
    for &b in bytes {
        match b {
            b'"' => out.push_str("\\\""),
            b'\\' => out.push_str("\\\\"),
            b'\n' => out.push_str("\\n"),
            b'\r' => out.push_str("\\r"),
            b'\t' => out.push_str("\\t"),
            0x07 => out.push_str("\\a"),
            0x08 => out.push_str("\\b"),
            0x0c => out.push_str("\\f"),
            0x0b => out.push_str("\\v"),
            0x20..=0x7e => out.push(b as char),
            _ => out.push_str(&format!("\\x{b:02x}")),
        }
    }
    out.push('"');
    out
}

/// Answers with what the router reads: the target, the query (without its
/// '?', as Go's RawQuery) and the body.
pub async fn echo_target(mut request: Request, mut response: ResponseWriter) {
    let mut body = Vec::new();
    if let Some(reader) = request.body_mut() {
        let _ = reader.read_to_end(&mut body).await;
    }
    let query = request.query().strip_prefix('?').unwrap_or("");
    let text = format!(
        "{} {} {}",
        go_quote(request.target().as_bytes()),
        go_quote(query.as_bytes()),
        go_quote(&body)
    );
    let _ = response.write(text.as_bytes()).await;
}

pub async fn write_text(response: &mut ResponseWriter, text: &str) {
    let _ = response.write(text.as_bytes()).await;
}

pub fn fixture(name: &str) -> String {
    let path = format!(
        "{}/../../../../../test/unit/server-conformance/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{path}: {error}"))
}

/// The (name, response) pairs of a golden that holds only strings there.
/// A small reader for these fixtures alone; wire JSON goes through
/// blok-jsjson.
pub fn golden_pairs(text: &str) -> Vec<(String, String)> {
    let mut strings = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '"' {
            continue;
        }
        let mut value = String::new();
        while let Some(c) = chars.next() {
            match c {
                '"' => break,
                '\\' => match chars.next() {
                    Some('n') => value.push('\n'),
                    Some('r') => value.push('\r'),
                    Some('t') => value.push('\t'),
                    Some('b') => value.push('\u{8}'),
                    Some('f') => value.push('\u{c}'),
                    Some('u') => {
                        let hex: String = (0..4).filter_map(|_| chars.next()).collect();
                        value.push(char::from_u32(u32::from_str_radix(&hex, 16).unwrap()).unwrap());
                    }
                    Some(other) => value.push(other),
                    None => {}
                },
                other => value.push(other),
            }
        }
        strings.push(value);
    }
    strings
        .chunks(4)
        .map(|chunk| {
            assert_eq!((chunk[0].as_str(), chunk[2].as_str()), ("name", "response"));
            (chunk[1].clone(), chunk[3].clone())
        })
        .collect()
}

/// rawExchange in http-host-contract.test.ts: the status line, then the
/// header lines with lower-cased names, Date and Server dropped, sorted,
/// then a blank line and the body. Bytes read as latin1.
pub fn normalize_exchange(answer: &[u8]) -> String {
    let text: String = answer.iter().map(|&b| b as char).collect();
    let (head, body) = match text.split_once("\r\n\r\n") {
        Some((head, body)) => (head.to_owned(), body.to_owned()),
        None => (text.clone(), String::new()),
    };
    let mut lines = head.split("\r\n");
    let status = lines.next().unwrap_or("").to_owned();
    let mut headers: Vec<String> = lines
        .map(|line| match line.split_once(':') {
            Some((name, rest)) => format!("{}:{rest}", name.to_lowercase()),
            None => line.to_owned(),
        })
        .filter(|line| !line.starts_with("date:") && !line.starts_with("server:"))
        .collect();
    headers.sort();
    let mut parts = vec![status];
    parts.extend(headers);
    parts.push(String::new());
    parts.push(body);
    parts.join("\n")
}

/// Sends request, reads until the close (5 s at most), normalized.
pub async fn raw_exchange(address: SocketAddr, request: &[u8]) -> String {
    let mut conn = connect(address).await;
    conn.write_all(request).await.unwrap();
    normalize_exchange(&read_all(&mut conn, Duration::from_secs(5)).await)
}

/// GET /health as blokserver answers it with version "dev".
pub async fn health(response: &mut ResponseWriter) {
    response
        .headers_mut()
        .set("Content-Type", "application/json");
    let _ = response.start(200).await;
    let _ = response
        .write(b"{\"status\":\"ok\",\"version\":\"dev\"}\n")
        .await;
}

pub async fn plain(response: &mut ResponseWriter, status: u16, text: &str) {
    response
        .headers_mut()
        .set("Content-Type", "text/plain; charset=utf-8");
    let _ = response.start(status).await;
    let _ = response.write(text.as_bytes()).await;
}

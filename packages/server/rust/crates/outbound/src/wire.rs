//! An HTTP/1.1 client codec over any byte stream. It opens no connection:
//! the guarded fetcher and the operator client own that.

use std::future::Future;
use std::io;

use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt};

/// A response head's header lines, in the order received. Values are raw
/// bytes: a server may send any octet but CR, LF and NUL.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Headers(pub Vec<(String, Vec<u8>)>);

impl Headers {
    /// The first value for `name`, matched without case.
    pub fn get(&self, name: &str) -> Option<&[u8]> {
        self.0
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_slice())
    }

    /// Every value for `name`, in order.
    pub fn values<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a [u8]> + 'a {
        self.0
            .iter()
            .filter(move |(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_slice())
    }
}

/// A header value as .NET reads it: UTF-8 when the bytes are valid UTF-8,
/// else one byte per character (Latin-1). So a raw 0xE9 is "é" and a raw
/// 0x85 is a C1 control.
pub fn header_text(value: &[u8]) -> String {
    match std::str::from_utf8(value) {
        Ok(text) => text.to_owned(),
        Err(_) => value.iter().map(|&b| char::from(b)).collect(),
    }
}

/// A response status line and headers.
#[derive(Debug, Clone)]
pub struct Head {
    pub status: u16,
    pub headers: Headers,
    /// Whether the server spoke HTTP/1.0.
    pub http10: bool,
}

#[derive(Debug)]
pub enum WireError {
    /// The head passed the size cap.
    HeadTooLarge,
    Malformed(&'static str),
    Io(io::Error),
}

impl std::fmt::Display for WireError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WireError::HeadTooLarge => f.write_str("server response headers exceeded the limit"),
            WireError::Malformed(what) => write!(f, "malformed HTTP response: {what}"),
            WireError::Io(err) => err.fmt(f),
        }
    }
}

impl std::error::Error for WireError {}

impl From<io::Error> for WireError {
    fn from(err: io::Error) -> Self {
        WireError::Io(err)
    }
}

impl From<WireError> for io::Error {
    fn from(err: WireError) -> Self {
        match err {
            WireError::Io(err) => err,
            other => io::Error::new(io::ErrorKind::InvalidData, other.to_string()),
        }
    }
}

/// The request head: the request line, then `headers` in order.
pub fn request_head(method: &str, target: &str, headers: &[(&str, &str)]) -> Vec<u8> {
    let mut head = format!("{method} {target} HTTP/1.1\r\n");
    for (name, value) in headers {
        head.push_str(name);
        head.push_str(": ");
        head.push_str(value);
        head.push_str("\r\n");
    }
    head.push_str("\r\n");
    head.into_bytes()
}

/// Reads one line, CRLF or LF ended, counting it against `budget`.
async fn read_line<R: AsyncBufRead + Unpin>(
    r: &mut R,
    budget: &mut usize,
) -> Result<Vec<u8>, WireError> {
    let mut line = Vec::new();
    loop {
        let available = r.fill_buf().await?;
        if available.is_empty() {
            return Err(WireError::Io(io::ErrorKind::UnexpectedEof.into()));
        }
        let (take, done) = match available.iter().position(|&c| c == b'\n') {
            Some(at) => (at + 1, true),
            None => (available.len(), false),
        };
        if take > *budget {
            return Err(WireError::HeadTooLarge);
        }
        *budget -= take;
        line.extend_from_slice(&available[..take]);
        r.consume(take);
        if done {
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            return Ok(line);
        }
    }
}

/// Reads a response head, skipping interim 1xx answers. The whole head,
/// status line included, must fit in `max_head` bytes.
pub async fn read_head<R: AsyncBufRead + Unpin>(
    r: &mut R,
    max_head: usize,
) -> Result<Head, WireError> {
    loop {
        let mut budget = max_head;
        let line = read_line(r, &mut budget).await?;
        let (http10, status) = parse_status_line(&line)?;
        let mut headers: Vec<(String, Vec<u8>)> = Vec::new();
        loop {
            let line = read_line(r, &mut budget).await?;
            if line.is_empty() {
                break;
            }
            if line[0] == b' ' || line[0] == b'\t' {
                // An obsolete folded line continues the previous value.
                let Some((_, value)) = headers.last_mut() else {
                    return Err(WireError::Malformed("a folded first header"));
                };
                value.push(b' ');
                value.extend_from_slice(line.trim_ascii());
                continue;
            }
            let Some(colon) = line.iter().position(|&c| c == b':') else {
                return Err(WireError::Malformed("a header line without a colon"));
            };
            let name = &line[..colon];
            if name.is_empty() || !name.iter().all(|&c| is_token_char(c)) {
                return Err(WireError::Malformed("a bad header name"));
            }
            let value = trim_space_tab(&line[colon + 1..]);
            if value.contains(&0) {
                return Err(WireError::Malformed("a NUL in a header value"));
            }
            headers.push((
                String::from_utf8(name.to_vec()).expect("a token is ASCII"),
                value.to_vec(),
            ));
        }
        if (100..200).contains(&status) && status != 101 {
            continue;
        }
        return Ok(Head {
            status,
            headers: Headers(headers),
            http10,
        });
    }
}

fn parse_status_line(line: &[u8]) -> Result<(bool, u16), WireError> {
    let malformed = WireError::Malformed("a bad status line");
    let rest = line.strip_prefix(b"HTTP/1.").ok_or(malformed)?;
    let http10 = match rest.first() {
        Some(b'0') => true,
        Some(b'1') => false,
        _ => return Err(WireError::Malformed("a bad status line")),
    };
    let rest = rest[1..]
        .strip_prefix(b" ")
        .ok_or(WireError::Malformed("a bad status line"))?;
    if rest.len() < 3
        || !rest[..3].iter().all(u8::is_ascii_digit)
        || rest.len() > 3 && rest[3] != b' '
    {
        return Err(WireError::Malformed("a bad status line"));
    }
    let status = std::str::from_utf8(&rest[..3]).unwrap().parse().unwrap();
    Ok((http10, status))
}

pub(crate) fn trim_space_tab(mut s: &[u8]) -> &[u8] {
    while let [b' ' | b'\t', rest @ ..] = s {
        s = rest;
    }
    while let [rest @ .., b' ' | b'\t'] = s {
        s = rest;
    }
    s
}

pub(crate) fn is_token_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&c)
}

/// How a response body is framed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Framing {
    None,
    Length(u64),
    Chunked,
    Close,
}

/// RFC 9112 §6.3 for a response to a request that was not HEAD.
pub fn framing(head: &Head) -> Result<Framing, WireError> {
    if (100..200).contains(&head.status) || head.status == 204 || head.status == 304 {
        return Ok(Framing::None);
    }
    let codings: Vec<&[u8]> = head
        .headers
        .values("Transfer-Encoding")
        .flat_map(|v| v.split(|&c| c == b','))
        .map(trim_space_tab)
        .filter(|c| !c.is_empty())
        .collect();
    if !codings.is_empty() && !head.http10 {
        if codings.len() == 1 && codings[0].eq_ignore_ascii_case(b"chunked") {
            return Ok(Framing::Chunked);
        }
        return Err(WireError::Malformed("an unsupported transfer coding"));
    }
    let mut length = None;
    for value in head.headers.values("Content-Length") {
        for part in value.split(|&c| c == b',') {
            let part = trim_space_tab(part);
            if part.is_empty() || !part.iter().all(u8::is_ascii_digit) {
                return Err(WireError::Malformed("a bad Content-Length"));
            }
            let n: u64 = std::str::from_utf8(part)
                .unwrap()
                .parse()
                .map_err(|_| WireError::Malformed("a bad Content-Length"))?;
            if length.is_some_and(|l| l != n) {
                return Err(WireError::Malformed("conflicting Content-Length values"));
            }
            length = Some(n);
        }
    }
    Ok(length.map_or(Framing::Close, Framing::Length))
}

/// The longest chunk-size line or trailer line read; nothing honest is close.
const MAX_CHUNK_LINE: usize = 4096;
const MAX_TRAILERS: usize = 64 << 10;

/// Something a body reader can pull bytes from.
pub trait Source {
    /// Fills `buf` from the start; 0 means the body ended.
    fn read(&mut self, buf: &mut [u8]) -> impl Future<Output = io::Result<usize>> + Send;
}

impl Source for &[u8] {
    async fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = buf.len().min(self.len());
        buf[..n].copy_from_slice(&self[..n]);
        *self = &self[n..];
        Ok(n)
    }
}

/// A response body under its framing. A body cut short is an error, not an
/// end, for Length and Chunked.
pub struct Body<R> {
    reader: R,
    state: BodyState,
}

enum BodyState {
    Length(u64),
    ChunkData(u64),
    ChunkStart,
    Close,
    Done,
}

impl<R: AsyncBufRead + Unpin + Send> Body<R> {
    pub fn new(reader: R, framing: Framing) -> Body<R> {
        let state = match framing {
            Framing::None | Framing::Length(0) => BodyState::Done,
            Framing::Length(n) => BodyState::Length(n),
            Framing::Chunked => BodyState::ChunkStart,
            Framing::Close => BodyState::Close,
        };
        Body { reader, state }
    }

    pub fn into_inner(self) -> R {
        self.reader
    }

    async fn read_some(&mut self, buf: &mut [u8], limit: u64) -> io::Result<usize> {
        let want = buf.len().min(usize::try_from(limit).unwrap_or(usize::MAX));
        let n = self.reader.read(&mut buf[..want]).await?;
        if n == 0 {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        Ok(n)
    }
}

impl<R: AsyncBufRead + Unpin + Send> Source for Body<R> {
    async fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        loop {
            match self.state {
                BodyState::Done => return Ok(0),
                BodyState::Close => return self.reader.read(buf).await,
                BodyState::Length(remaining) => {
                    let n = self.read_some(buf, remaining).await?;
                    let left = remaining - n as u64;
                    self.state = if left == 0 {
                        BodyState::Done
                    } else {
                        BodyState::Length(left)
                    };
                    return Ok(n);
                }
                BodyState::ChunkData(remaining) => {
                    let n = self.read_some(buf, remaining).await?;
                    let left = remaining - n as u64;
                    if left == 0 {
                        let mut budget = 2;
                        if !read_line(&mut self.reader, &mut budget).await?.is_empty() {
                            return Err(WireError::Malformed("chunk data overran its size").into());
                        }
                        self.state = BodyState::ChunkStart;
                    } else {
                        self.state = BodyState::ChunkData(left);
                    }
                    return Ok(n);
                }
                BodyState::ChunkStart => {
                    let mut budget = MAX_CHUNK_LINE;
                    let line = read_line(&mut self.reader, &mut budget).await?;
                    let size = match line.iter().position(|&c| c == b';') {
                        Some(at) => &line[..at],
                        None => &line[..],
                    };
                    let size = trim_space_tab(size);
                    if size.is_empty() || size.len() > 16 || !size.iter().all(u8::is_ascii_hexdigit)
                    {
                        return Err(WireError::Malformed("a bad chunk size").into());
                    }
                    let size = u64::from_str_radix(std::str::from_utf8(size).unwrap(), 16)
                        .map_err(|_| io::Error::from(WireError::Malformed("a bad chunk size")))?;
                    if size == 0 {
                        let mut budget = MAX_TRAILERS;
                        while !read_line(&mut self.reader, &mut budget).await?.is_empty() {}
                        self.state = BodyState::Done;
                        return Ok(0);
                    }
                    self.state = BodyState::ChunkData(size);
                }
            }
        }
    }
}

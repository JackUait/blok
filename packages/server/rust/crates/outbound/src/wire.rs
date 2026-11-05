//! An HTTP/1.1 client codec over any byte stream. It opens no connection:
//! the guarded fetcher and the operator client own that.

use std::future::Future;
use std::io;

use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt};

/// A response head's header lines, in the order received. Values are bytes
/// as .NET stores them (see `response_header`).
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
    /// What is left of the head budget: the trailers' budget.
    pub budget: usize,
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

/// Reads through the next LF and returns the line without it, CR kept.
/// The bytes count against `budget`.
async fn read_raw_line<R: AsyncBufRead + Unpin>(
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
            return Ok(line);
        }
    }
}

fn trim_cr(line: &[u8]) -> &[u8] {
    line.strip_suffix(b"\r").unwrap_or(line)
}

/// Reads one line, CRLF or LF ended, counting it against `budget`.
async fn read_line<R: AsyncBufRead + Unpin>(
    r: &mut R,
    budget: &mut usize,
) -> Result<Vec<u8>, WireError> {
    let mut line = read_raw_line(r, budget).await?;
    if line.last() == Some(&b'\r') {
        line.pop();
    }
    Ok(line)
}

/// Reads a response head as .NET's HttpConnection does (System.Net.Http
/// 10.0.11), skipping interim 1xx answers but 101. One `max_head` budget
/// covers every status line and header block, interim heads included, and
/// what is left of it is the trailers' budget.
pub async fn read_head<R: AsyncBufRead + Unpin>(
    r: &mut R,
    max_head: usize,
) -> Result<Head, WireError> {
    let mut budget = max_head;
    loop {
        let line = read_line(r, &mut budget).await?;
        let (http10, status) = parse_status_line(&line)?;
        let interim = (100..200).contains(&status) && status != 101;
        let headers = read_header_block(r, &mut budget, !interim).await?;
        if interim {
            continue;
        }
        return Ok(Head {
            status,
            headers,
            http10,
            budget,
        });
    }
}

/// ParseHeadersCore up to the blank line. A field runs to the first ':' of
/// its first line; a line that starts with SP or HT continues it, its line
/// end becoming spaces (CR too, when it precedes the LF). `keep` is false
/// for an interim head, whose names .NET never checks.
async fn read_header_block<R: AsyncBufRead + Unpin>(
    r: &mut R,
    budget: &mut usize,
    keep: bool,
) -> Result<Headers, WireError> {
    let mut headers: Vec<(String, Vec<u8>)> = Vec::new();
    loop {
        let line = read_raw_line(r, budget).await?;
        if trim_cr(&line).is_empty() {
            return Ok(Headers(headers));
        }
        let Some(colon) = line.iter().position(|&c| c == b':') else {
            return Err(WireError::Malformed("a header line without a colon"));
        };
        let mut value = line[colon + 1..].to_vec();
        loop {
            let next = r.fill_buf().await?;
            match next.first() {
                None => return Err(WireError::Io(io::ErrorKind::UnexpectedEof.into())),
                Some(b' ' | b'\t') => {}
                Some(_) => break,
            }
            if let Some(last) = value.last_mut().filter(|c| **c == b'\r') {
                *last = b' ';
            }
            value.push(b' ');
            value.extend_from_slice(&read_raw_line(r, budget).await?);
        }
        if keep {
            headers.push(response_header(&line[..colon], trim_cr(&value))?);
        }
    }
}

/// AddResponseHeader: the name loses trailing spaces and must be a token;
/// the value loses SP and HT at both ends. The value is
/// HeaderDescriptor.GetHeaderValue kept as bytes: a Location that is valid
/// UTF-8 stays as it is, anything else turns NUL, CR and LF into spaces.
fn response_header(mut name: &[u8], value: &[u8]) -> Result<(String, Vec<u8>), WireError> {
    while let [rest @ .., b' '] = name {
        name = rest;
    }
    if name.is_empty() || !name.iter().all(|&c| is_token_char(c)) {
        return Err(WireError::Malformed("a bad header name"));
    }
    let mut value = trim_space_tab(value).to_vec();
    if !name.eq_ignore_ascii_case(b"Location") || std::str::from_utf8(&value).is_err() {
        for c in &mut value {
            if matches!(*c, 0 | b'\r' | b'\n') {
                *c = b' ';
            }
        }
    }
    let name = String::from_utf8(name.to_vec()).expect("a token is ASCII");
    Ok((name, value))
}

/// ParseStatusLineCore.
fn parse_status_line(line: &[u8]) -> Result<(bool, u16), WireError> {
    let malformed = WireError::Malformed("a bad status line");
    if line.len() < 12
        || line[8] != b' '
        || !line.starts_with(b"HTTP/1.")
        || !line[7].is_ascii_digit()
    {
        return Err(malformed);
    }
    if !line[9..12].iter().all(u8::is_ascii_digit) {
        return Err(malformed);
    }
    // The reason phrase setter refuses CR, LF and NUL.
    if line.len() > 12 && (line[12] != b' ' || line[13..].iter().any(|&c| matches!(c, b'\r' | 0))) {
        return Err(malformed);
    }
    let status = line[9..12]
        .iter()
        .fold(0u16, |n, &d| n * 10 + u16::from(d - b'0'));
    Ok((line[7] == b'0', status))
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

/// The body stream HttpConnection.SendAsync picks for a response to a
/// request that was not HEAD. It never refuses a head.
pub fn framing(head: &Head) -> Result<Framing, WireError> {
    if (100..200).contains(&head.status) && head.status != 101
        || head.status == 204
        || head.status == 304
    {
        return Ok(Framing::None);
    }
    if head.status == 101 {
        return Ok(Framing::Close);
    }
    if transfer_encoding_chunked(&head.headers) {
        return Ok(Framing::Chunked);
    }
    Ok(match content_length(&head.headers) {
        Some(0) => Framing::None,
        Some(n) => Framing::Length(n),
        None => Framing::Close,
    })
}

/// HttpContentHeaders.ContentLength: only the first Content-Length line
/// counts, and it must hold one number.
pub fn content_length(headers: &Headers) -> Option<u64> {
    let digits = trim_space_tab(headers.get("Content-Length")?);
    if digits.is_empty() || !digits.iter().all(u8::is_ascii_digit) {
        return None;
    }
    let n: u64 = std::str::from_utf8(digits).ok()?.parse().ok()?;
    (n <= i64::MAX as u64).then_some(n)
}

/// HttpGeneralHeaders.GetTransferEncodingChunked: one line that is
/// "chunked", or any line that parses as a coding list holding a bare
/// "chunked". A line that does not parse counts for nothing.
fn transfer_encoding_chunked(headers: &Headers) -> bool {
    let values: Vec<&[u8]> = headers.values("Transfer-Encoding").collect();
    if let [only] = values[..]
        && only.eq_ignore_ascii_case(b"chunked")
    {
        return true;
    }
    values.iter().any(|value| {
        bare_transfer_codings(value).is_some_and(|bare| bare.contains(&"chunked".to_owned()))
    })
}

/// A TransferCodingHeaderParser list: items split by commas, each a token
/// and ";name[=value]" parameters, empty items allowed. The lowered names
/// of the items with no parameters, or None when the line does not parse.
fn bare_transfer_codings(s: &[u8]) -> Option<Vec<String>> {
    let mut bare = Vec::new();
    let mut i = 0;
    let skip = |i: &mut usize| {
        while *i < s.len() && matches!(s[*i], b' ' | b'\t') {
            *i += 1;
        }
    };
    let token = |i: &mut usize| {
        let start = *i;
        while *i < s.len() && is_token_char(s[*i]) {
            *i += 1;
        }
        &s[start..*i]
    };
    loop {
        skip(&mut i);
        while i < s.len() && s[i] == b',' {
            i += 1;
            skip(&mut i);
        }
        if i == s.len() {
            return Some(bare);
        }
        let name = token(&mut i);
        if name.is_empty() {
            return None;
        }
        skip(&mut i);
        let mut params = false;
        while i < s.len() && s[i] == b';' {
            params = true;
            i += 1;
            skip(&mut i);
            if token(&mut i).is_empty() {
                return None;
            }
            skip(&mut i);
            if i < s.len() && s[i] == b'=' {
                i += 1;
                skip(&mut i);
                if i < s.len() && s[i] == b'"' {
                    i = quoted_string_end(s, i)?;
                } else if token(&mut i).is_empty() {
                    return None;
                }
                skip(&mut i);
            }
        }
        if !params {
            bare.push(String::from_utf8_lossy(name).to_ascii_lowercase());
        }
        if i < s.len() && s[i] != b',' {
            return None;
        }
    }
}

/// The index after the quoted string at `s[start]`, backslash escapes
/// included.
fn quoted_string_end(s: &[u8], start: usize) -> Option<usize> {
    let mut j = start + 1;
    while j < s.len() {
        match s[j] {
            b'\\' => j += 1,
            b'"' => return Some(j + 1),
            _ => {}
        }
        j += 1;
    }
    None
}

/// TryReadNextChunkedLine's cap on a chunk-size or chunk-end line, LF
/// included. These lines are outside the head budget.
const MAX_CHUNK_LINE: usize = 16384;

/// The trailers' budget for a body read with `Body::new`.
const MAX_TRAILERS: usize = 64 << 10;

/// Utf8Parser's hex parse of a chunk-size line, then
/// ValidateChunkExtension: after the digits only SP and HT, up to a ';'.
fn chunk_size(line: &[u8]) -> Result<u64, WireError> {
    let malformed = WireError::Malformed("a bad chunk size");
    let end = line
        .iter()
        .position(|c| !c.is_ascii_hexdigit())
        .unwrap_or(line.len());
    if end == 0 {
        return Err(malformed);
    }
    let size = u64::from_str_radix(std::str::from_utf8(&line[..end]).unwrap(), 16)
        .map_err(|_| WireError::Malformed("a bad chunk size"))?;
    for &c in &line[end..] {
        match c {
            b';' => break,
            b' ' | b'\t' => {}
            _ => return Err(WireError::Malformed("a bad chunk extension")),
        }
    }
    Ok(size)
}

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
    trailer_budget: usize,
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
        Body::after_head(reader, framing, MAX_TRAILERS)
    }

    /// A body whose trailers get what is left of the head's budget, as
    /// .NET counts them.
    pub fn after_head(reader: R, framing: Framing, trailer_budget: usize) -> Body<R> {
        let state = match framing {
            Framing::None | Framing::Length(0) => BodyState::Done,
            Framing::Length(n) => BodyState::Length(n),
            Framing::Chunked => BodyState::ChunkStart,
            Framing::Close => BodyState::Close,
        };
        Body {
            reader,
            state,
            trailer_budget,
        }
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
                        let mut budget = MAX_CHUNK_LINE;
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
                    let size = chunk_size(&line)?;
                    if size == 0 {
                        read_header_block(&mut self.reader, &mut self.trailer_budget, true).await?;
                        self.state = BodyState::Done;
                        return Ok(0);
                    }
                    self.state = BodyState::ChunkData(size);
                }
            }
        }
    }
}

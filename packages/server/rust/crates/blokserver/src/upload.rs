//! UploadEndpoint: the first file part named "file" is spooled to a 0600
//! temporary file, every other part is read and dropped, and the cap counts
//! the whole request body, framing included.

use std::io::SeekFrom;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use blok_blob::{extension, normalize_extension};
use blok_http::{BodyError, Request, ResponseWriter};
use blok_mediatype::{Param, boundary, parse as parse_media_type, sanitize_wire};
use tokio::io::{AsyncRead, AsyncSeekExt, AsyncWriteExt, ReadBuf};

use crate::disposition::decode_extended_value;
use crate::handlers::{Source, body_of};
use crate::server::{Inner, first_value, upload_response, write_text};

const MAX_MULTIPART_SECTIONS: usize = 1000;
// MultipartReader's defaults in ASP.NET.
const MAX_SECTION_HEADERS: usize = 16;
const MAX_SECTION_HEADER_BYTES: i64 = 16 << 10;
const MAX_SECTION_BODY_BYTES: u64 = 128 << 20;
const MAX_QUOTED_PRINTABLE_LINE: usize = 4096;

pub(crate) type Cancelled = Arc<dyn Fn() -> bool + Send + Sync>;

#[derive(Debug)]
enum ReadErr {
    Eof,
    TooLarge,
    Malformed,
    Cancelled,
    Body,
    Io,
}

pub(crate) async fn upload(inner: Arc<Inner>, mut request: Request, response: ResponseWriter) {
    let max = inner.options.max_upload_bytes;
    request.set_body_limit(u64::try_from(max).unwrap_or(0));
    let content_type = first_value(&request, "Content-Type").to_owned();
    let length = request.content_length();
    let body = body_of(&mut request);
    let cancel = request.cancel_token();
    let cancelled: Cancelled = Arc::new(move || cancel.is_cancelled());
    upload_from(&inner, body, length, &content_type, cancelled, response).await;
}

pub(crate) async fn upload_from(
    inner: &Inner,
    body: Box<dyn Source>,
    content_length: Option<u64>,
    content_type: &str,
    cancelled: Cancelled,
    mut response: ResponseWriter,
) {
    let max = u64::try_from(inner.options.max_upload_bytes).unwrap_or(0);
    if content_length.is_some_and(|length| length > max) {
        write_text(&mut response, 413, "file too large\n").await;
        return;
    }
    let Some(boundary) = boundary(content_type) else {
        write_text(&mut response, 400, "malformed upload\n").await;
        return;
    };
    let capped = Capped {
        source: body,
        remaining: max,
        too_large: false,
        too_slow: false,
    };
    let mut upload = Upload {
        spool: None,
        file_name: String::new(),
        mime_type: String::new(),
    };
    let size = (boundary.len() + 8).max(4096);
    let mut reader = MultipartReader::new(capped, &boundary, size);
    let result = read_upload(&mut reader, &mut upload, &cancelled).await;
    let too_slow = reader.r.source.too_slow;
    let answer = async {
        match result {
            Err(ReadErr::TooLarge) => {
                write_text(&mut response, 413, "file too large\n").await;
                return;
            }
            // Before the cancel check: a body under the minimum rate
            // cancels the request too.
            _ if too_slow => {
                write_text(&mut response, 400, "malformed upload\n").await;
                return;
            }
            _ if cancelled() => return,
            Err(_) => {
                write_text(&mut response, 400, "malformed upload\n").await;
                return;
            }
            Ok(()) => {}
        }
        let Some((file, _)) = upload.spool.as_mut() else {
            write_text(&mut response, 400, "missing file field\n").await;
            return;
        };
        if file.seek(SeekFrom::Start(0)).await.is_err() {
            write_text(&mut response, 502, "upload failed\n").await;
            return;
        }
        let mut counted = Counting { inner: file, n: 0 };
        let stored = match inner.blob_store() {
            Ok(store) => {
                let extension = normalize_extension(extension(&upload.file_name));
                store
                    .put(
                        &extension,
                        &upload.mime_type,
                        blok_blob::Body::Stream(Box::new(&mut counted)),
                        &*cancelled,
                    )
                    .await
                    .map_err(|_| ())
            }
            Err(_) => Err(()),
        };
        let size = counted.n;
        match stored {
            Ok(url) => {
                upload_response(
                    &mut response,
                    &url,
                    &upload.file_name,
                    size,
                    &upload.mime_type,
                )
                .await;
            }
            Err(()) if !cancelled() => write_text(&mut response, 502, "upload failed\n").await,
            Err(()) => {}
        }
    };
    answer.await;
    if let Some((file, path)) = upload.spool.take() {
        drop(file);
        let _ = tokio::fs::remove_file(path).await;
    }
}

struct Upload {
    spool: Option<(tokio::fs::File, std::path::PathBuf)>,
    file_name: String,
    mime_type: String,
}

async fn read_upload(
    reader: &mut MultipartReader,
    upload: &mut Upload,
    cancelled: &Cancelled,
) -> Result<(), ReadErr> {
    let mut sections = 0;
    let mut chunk = vec![0u8; 32 << 10];
    while let Some(headers) = reader.next().await? {
        sections += 1;
        if sections > MAX_MULTIPART_SECTIONS {
            return Err(ReadErr::Malformed);
        }
        let quoted_printable = header(&headers, "Content-Transfer-Encoding")
            .trim()
            .eq_ignore_ascii_case("quoted-printable");
        let mut content = Content {
            qp: quoted_printable.then(QuotedPrintable::default),
        };
        let metadata = file_metadata(&headers);
        let keep = upload.spool.is_none() && metadata.is_some();
        if keep {
            let (name, mime) = metadata.unwrap_or_default();
            let mut random = [0u8; 16];
            getrandom::fill(&mut random).map_err(|_| ReadErr::Io)?;
            let hex: String = random.iter().map(|b| format!("{b:02x}")).collect();
            let path = std::env::temp_dir().join(format!(".blok-upload-{hex}"));
            let file = tokio::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&path)
                .await
                .map_err(|_| ReadErr::Io)?;
            upload.spool = Some((file, path));
            upload.file_name = name;
            upload.mime_type = mime;
        }
        loop {
            if cancelled() {
                return Err(ReadErr::Cancelled);
            }
            let n = content.read(reader, &mut chunk).await?;
            if n == 0 {
                break;
            }
            if keep && let Some((file, _)) = upload.spool.as_mut() {
                file.write_all(&chunk[..n]).await.map_err(|_| ReadErr::Io)?;
            }
        }
    }
    loop {
        if cancelled() {
            return Err(ReadErr::Cancelled);
        }
        if reader.r.source.read(&mut chunk).await? == 0 {
            return Ok(());
        }
    }
}

/// A part's content, decoded from quoted-printable when it says so.
struct Content {
    qp: Option<QuotedPrintable>,
}

impl Content {
    async fn read(
        &mut self,
        reader: &mut MultipartReader,
        buf: &mut [u8],
    ) -> Result<usize, ReadErr> {
        match &mut self.qp {
            None => reader.read_part(buf).await,
            Some(qp) => qp.read(reader, buf).await,
        }
    }
}

/// Counts how far the store read, as CountingReadStream.
struct Counting<'a> {
    inner: &'a mut tokio::fs::File,
    n: i64,
}

impl AsyncRead for Counting<'_> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let before = buf.filled().len();
        let polled = Pin::new(&mut *self.inner).poll_read(cx, buf);
        let read = buf.filled().len() - before;
        self.n += i64::try_from(read).unwrap_or(0);
        polled
    }
}

/// BoundedReadStream: once the cap is reached it reads one more byte, and
/// that byte existing is too large. The error sticks: a peek can swallow
/// it when the bytes already buffered are enough.
struct Capped {
    source: Box<dyn Source>,
    remaining: u64,
    too_large: bool,
    // The host ended a read under its minimum data rate.
    too_slow: bool,
}

impl Capped {
    /// Ok(0) is the end of the body.
    async fn read(&mut self, buf: &mut [u8]) -> Result<usize, ReadErr> {
        if self.too_large {
            return Err(ReadErr::TooLarge);
        }
        if buf.is_empty() {
            return Ok(0);
        }
        if self.remaining == 0 {
            let mut probe = [0u8; 1];
            return match self.source.read(&mut probe).await {
                Ok(0) => Ok(0),
                Ok(_) => {
                    self.too_large = true;
                    Err(ReadErr::TooLarge)
                }
                Err(error) => Err(self.host_error(error)),
            };
        }
        let take = buf
            .len()
            .min(usize::try_from(self.remaining).unwrap_or(usize::MAX));
        match self.source.read(&mut buf[..take]).await {
            Ok(n) => {
                self.remaining -= n as u64;
                Ok(n)
            }
            Err(error) => Err(self.host_error(error)),
        }
    }

    /// The host's cap is MaxUploadBytes too, so its refusal is this one.
    fn host_error(&mut self, error: BodyError) -> ReadErr {
        match error {
            BodyError::TooLarge => {
                self.too_large = true;
                ReadErr::TooLarge
            }
            BodyError::TooSlow => {
                self.too_slow = true;
                ReadErr::Body
            }
            _ => ReadErr::Body,
        }
    }
}

/// bufio.Reader over the capped body, with the Peek semantics the
/// multipart reader is written against. Errors do not stick here (bufio
/// clears them once returned); the capped body re-reports its own.
struct Buffered {
    source: Capped,
    buf: Vec<u8>,
    r: usize,
    w: usize,
    err: Option<ReadErr>,
}

impl Buffered {
    fn size(&self) -> usize {
        self.buf.len()
    }

    fn buffered(&self) -> usize {
        self.w - self.r
    }

    fn bytes(&self, n: usize) -> &[u8] {
        &self.buf[self.r..self.r + n]
    }

    async fn fill(&mut self) {
        if self.r > 0 {
            self.buf.copy_within(self.r..self.w, 0);
            self.w -= self.r;
            self.r = 0;
        }
        let w = self.w;
        match self.source.read(&mut self.buf[w..]).await {
            Ok(0) => self.err = Some(ReadErr::Eof),
            Ok(n) => self.w += n,
            Err(error) => self.err = Some(error),
        }
    }

    /// How many bytes are ready (at most n), and the error when fewer than
    /// n are.
    async fn peek(&mut self, n: usize) -> (usize, Option<ReadErr>) {
        while self.buffered() < n && self.buffered() < self.size() && self.err.is_none() {
            self.fill().await;
        }
        let available = self.buffered();
        if available < n {
            // None here is bufio's ErrBufferFull, which no caller tells apart
            // from another error.
            return (
                available,
                Some(self.err.take().unwrap_or(ReadErr::Malformed)),
            );
        }
        (n, None)
    }

    fn discard(&mut self, n: usize) {
        self.r += n.min(self.buffered());
    }

    async fn read_byte(&mut self) -> Result<u8, ReadErr> {
        while self.r == self.w {
            if let Some(error) = self.err.take() {
                return Err(error);
            }
            self.fill().await;
        }
        let c = self.buf[self.r];
        self.r += 1;
        Ok(c)
    }
}

/// ASP.NET's MultipartReader: an optional preamble, then parts split on
/// "--boundary", each with up to 16 header lines.
struct MultipartReader {
    r: Buffered,
    dashed: Vec<u8>,
    delimiter: Vec<u8>,
    started: bool,
    done: bool,
    current: Option<Part>,
}

struct Part {
    ended: bool,
    read: u64,
}

type PartHeaders = Vec<(String, String)>;

impl MultipartReader {
    fn new(source: Capped, boundary: &str, size: usize) -> Self {
        Self {
            r: Buffered {
                source,
                buf: vec![0; size],
                r: 0,
                w: 0,
                err: None,
            },
            dashed: format!("--{boundary}").into_bytes(),
            delimiter: format!("\r\n--{boundary}").into_bytes(),
            started: false,
            done: false,
            current: None,
        }
    }

    async fn next(&mut self) -> Result<Option<PartHeaders>, ReadErr> {
        if self.done {
            return Ok(None);
        }
        if self.current.is_some() {
            let mut sink = vec![0u8; 32 << 10];
            while self.read_part(&mut sink).await? > 0 {}
        } else if !self.started {
            self.skip_preamble().await?;
        }
        self.started = true;
        // After a boundary: "--" ends the body, else optional space then CRLF.
        let (n, _) = self.r.peek(2).await;
        if self.r.bytes(n) == b"--" {
            self.r.discard(2);
            self.done = true;
            return Ok(None);
        }
        let line = self.read_line(MAX_SECTION_HEADER_BYTES).await?;
        if !line.trim_matches([' ', '\t']).is_empty() {
            return Err(ReadErr::Malformed);
        }
        let mut headers = Vec::new();
        let mut total: i64 = 0;
        let mut count = 0;
        loop {
            let line = self.read_line(MAX_SECTION_HEADER_BYTES - total).await?;
            total += line.len() as i64 + 2;
            if line.is_empty() {
                break;
            }
            if count >= MAX_SECTION_HEADERS {
                return Err(ReadErr::Malformed);
            }
            count += 1;
            let Some((name, value)) = line.split_once(':') else {
                return Err(ReadErr::Malformed);
            };
            headers.push((name.trim().to_owned(), value.trim().to_owned()));
        }
        self.current = Some(Part {
            ended: false,
            read: 0,
        });
        Ok(Some(headers))
    }

    /// Reads to the first "--boundary"; it needs no CRLF before it.
    async fn skip_preamble(&mut self) -> Result<(), ReadErr> {
        loop {
            let (n, err) = self.r.peek(self.dashed.len()).await;
            if self.r.bytes(n) == self.dashed.as_slice() {
                self.r.discard(self.dashed.len());
                return Ok(());
            }
            let buffered = self.r.bytes(self.r.buffered());
            if let Some(i) = find(buffered, &self.delimiter) {
                self.r.discard(i + self.delimiter.len());
                return Ok(());
            }
            if err.is_some() {
                return Err(ReadErr::Malformed);
            }
            let keep = self.delimiter.len() - 1;
            let length = buffered.len();
            if length > keep {
                self.r.discard(length - keep);
            } else if self.r.peek(length + 1).await.1.is_some() {
                return Err(ReadErr::Malformed);
            }
        }
    }

    /// A line without its CRLF. Bytes that are not UTF-8 are kept as
    /// replacement chars; no header the reader looks at can hold them.
    async fn read_line(&mut self, limit: i64) -> Result<String, ReadErr> {
        let mut line: Vec<u8> = Vec::new();
        loop {
            let c = match self.r.read_byte().await {
                Ok(c) => c,
                Err(ReadErr::TooLarge) => return Err(ReadErr::TooLarge),
                Err(_) => return Err(ReadErr::Malformed),
            };
            if c == b'\n' && line.last() == Some(&b'\r') {
                line.pop();
                return Ok(String::from_utf8_lossy(&line).into_owned());
            }
            line.push(c);
            if line.len() as i64 > limit {
                return Err(ReadErr::Malformed);
            }
        }
    }

    /// Body bytes up to the next "\r\n--boundary"; Ok(0) ends the part.
    async fn read_part(&mut self, b: &mut [u8]) -> Result<usize, ReadErr> {
        match &self.current {
            Some(part) if !part.ended => {}
            _ => return Ok(0),
        }
        let size = self.r.size();
        let (n, err) = self.r.peek(size).await;
        if let Some(i) = find(self.r.bytes(n), &self.delimiter) {
            if i == 0 {
                self.r.discard(self.delimiter.len());
                if let Some(part) = self.current.as_mut() {
                    part.ended = true;
                }
                return Ok(0);
            }
            return self.take(b, i);
        }
        let safe = n.saturating_sub(self.delimiter.len() - 1);
        if let Some(error) = err
            && n < size
        {
            if matches!(error, ReadErr::TooLarge) {
                return Err(ReadErr::TooLarge);
            }
            // The body ended without a closing boundary.
            if n == 0 || !matches!(error, ReadErr::Eof) || safe == 0 {
                return Err(ReadErr::Malformed);
            }
        }
        self.take(b, safe)
    }

    fn take(&mut self, b: &mut [u8], available: usize) -> Result<usize, ReadErr> {
        let n = available.min(b.len());
        b[..n].copy_from_slice(self.r.bytes(n));
        self.r.discard(n);
        let part = self.current.as_mut().ok_or(ReadErr::Malformed)?;
        part.read += n as u64;
        if part.read > MAX_SECTION_BODY_BYTES {
            return Err(ReadErr::Malformed);
        }
        Ok(n)
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.len() > haystack.len() {
        return None;
    }
    // Scan for the first byte, then compare: a sliding window compare is
    // too slow for 30 MB parts.
    let (&first, rest) = needle.split_first()?;
    let last_start = haystack.len() - needle.len();
    let mut at = 0;
    while at <= last_start {
        let offset = haystack[at..=last_start].iter().position(|&c| c == first)?;
        at += offset;
        if &haystack[at + 1..at + needle.len()] == rest {
            return Some(at);
        }
        at += 1;
    }
    None
}

/// The C# strict decoder: lines of at most 4096 bytes, "=XX" in either
/// case, soft breaks only before a line end, and no unescaped control
/// bytes. Reads the part through its own 4096-byte buffer, as bufio does.
#[derive(Default)]
struct QuotedPrintable {
    raw: Vec<u8>,
    raw_at: usize,
    raw_err: Option<ReadErr>,
    decoded: Vec<u8>,
    decoded_at: usize,
    err: Option<ReadErr>,
    eof: bool,
}

impl QuotedPrintable {
    async fn read(&mut self, reader: &mut MultipartReader, p: &mut [u8]) -> Result<usize, ReadErr> {
        while self.decoded_at == self.decoded.len() {
            if let Some(error) = self.err.take() {
                return Err(error);
            }
            if self.eof {
                return Ok(0);
            }
            self.decoded.clear();
            self.decoded_at = 0;
            self.fill(reader).await;
        }
        let n = p.len().min(self.decoded.len() - self.decoded_at);
        p[..n].copy_from_slice(&self.decoded[self.decoded_at..self.decoded_at + n]);
        self.decoded_at += n;
        Ok(n)
    }

    async fn read_byte(&mut self, reader: &mut MultipartReader) -> Result<u8, ReadErr> {
        while self.raw_at == self.raw.len() {
            if let Some(error) = self.raw_err.take() {
                return Err(error);
            }
            self.raw.resize(MAX_QUOTED_PRINTABLE_LINE, 0);
            self.raw_at = 0;
            match reader.read_part(&mut self.raw).await {
                Ok(0) => {
                    self.raw.clear();
                    self.raw_err = Some(ReadErr::Eof);
                }
                Ok(n) => self.raw.truncate(n),
                Err(error) => {
                    self.raw.clear();
                    self.raw_err = Some(error);
                }
            }
        }
        let c = self.raw[self.raw_at];
        self.raw_at += 1;
        Ok(c)
    }

    async fn fill(&mut self, reader: &mut MultipartReader) {
        let mut line: Vec<u8> = Vec::new();
        loop {
            match self.read_byte(reader).await {
                Err(ReadErr::Eof) => {
                    self.eof = true;
                    break;
                }
                Err(error) => {
                    self.err = Some(error);
                    return;
                }
                Ok(c) => {
                    line.push(c);
                    if c == b'\n' {
                        break;
                    }
                    if line.len() == MAX_QUOTED_PRINTABLE_LINE {
                        self.err = Some(ReadErr::Malformed);
                        break;
                    }
                }
            }
        }
        if line.is_empty() {
            return;
        }
        let has_line_feed = line.last() == Some(&b'\n');
        let has_carriage_return = has_line_feed && line.len() >= 2 && line[line.len() - 2] == b'\r';
        let mut content = line.len();
        while content > 0 && b"\n\r \t".contains(&line[content - 1]) {
            content -= 1;
        }
        let mut append_line_ending = has_line_feed;
        if content > 0 && line[content - 1] == b'=' {
            let mut suffix = content;
            while suffix < line.len() && (line[suffix] == b' ' || line[suffix] == b'\t') {
                suffix += 1;
            }
            content -= 1;
            append_line_ending = false;
            let starts_line_ending = suffix < line.len()
                && (line[suffix] == b'\n'
                    || line[suffix] == b'\r'
                        && suffix + 1 < line.len()
                        && line[suffix + 1] == b'\n');
            if !starts_line_ending && self.err.is_none() {
                self.err = Some(ReadErr::Malformed);
            }
        }
        let mut i = 0;
        while i < content {
            let c = line[i];
            if c == b'='
                && i + 2 < content
                && let (Some(hi), Some(lo)) = (hex_digit(line[i + 1]), hex_digit(line[i + 2]))
            {
                self.decoded.push(hi << 4 | lo);
                i += 3;
                continue;
            }
            if c == b'='
                || (c != b'\t'
                    && c != b'\r'
                    && c != b'\n'
                    && c < 0x80
                    && !(b' '..=b'~').contains(&c))
            {
                if self.err.is_none() {
                    self.err = Some(ReadErr::Malformed);
                }
                break;
            }
            self.decoded.push(c);
            i += 1;
        }
        if append_line_ending {
            if has_carriage_return {
                self.decoded.push(b'\r');
            }
            self.decoded.push(b'\n');
        }
    }
}

fn hex_digit(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

/// The first value of a part header. Names match as Go's canonical keys do:
/// a name that is not a token is kept as written, so it matches nothing.
fn header<'a>(headers: &'a PartHeaders, name: &str) -> &'a str {
    headers
        .iter()
        .find(|(n, _)| is_token(n) && n.eq_ignore_ascii_case(name))
        .map_or("", |(_, v)| v.as_str())
}

fn is_token(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&c))
}

/// TryGetFileMetadata: a form-data part named "file" with a filename
/// (filename* first).
fn file_metadata(headers: &PartHeaders) -> Option<(String, String)> {
    let file_name = file_name_from_disposition(header(headers, "Content-Disposition"))?;
    Some((file_name, sanitize_wire(header(headers, "Content-Type"))))
}

/// UploadEndpoint.TryReadFileName.
pub(crate) fn file_name_from_disposition(disposition: &str) -> Option<String> {
    let (disposition_type, params) = media_type_like_disposition(disposition)?;
    if !disposition_type.eq_ignore_ascii_case("form-data") {
        return None;
    }
    let (mut name, mut plain, mut star) = (None, None, None);
    for Param { name: key, value } in &params {
        match key.to_lowercase().as_str() {
            "name" if name.is_none() => name = Some(value.as_str()),
            "filename" if plain.is_none() => plain = Some(value.as_str()),
            "filename*" if star.is_none() => star = Some(value.as_str()),
            _ => {}
        }
    }
    if name.map(remove_quotes) != Some("file") {
        return None;
    }
    let raw = match star.and_then(decode_extended_value) {
        Some(decoded) => decoded,
        None => plain?.to_owned(),
    };
    Some(sanitize_file_name(&unquote_file_name(&raw)))
}

/// "type; name=value" with the media-type parameter grammar, which
/// ContentDispositionHeaderValue shares.
fn media_type_like_disposition(value: &str) -> Option<(String, Vec<Param>)> {
    let value = value.trim();
    let (disposition_type, rest) = match value.find(';') {
        Some(end) => (value[..end].trim(), &value[end..]),
        None => (value, ""),
    };
    if disposition_type.is_empty() || disposition_type.contains([' ', '\t', '/']) {
        return None;
    }
    let (_, params) = parse_media_type(&format!("x/y{rest}"))?;
    Some((disposition_type.to_owned(), params))
}

fn remove_quotes(value: &str) -> &str {
    if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') {
        return &value[1..value.len() - 1];
    }
    value
}

/// Drops the quotes and every backslash escape.
fn unquote_file_name(value: &str) -> String {
    let quoted = value.len() >= 2 && value.starts_with('"') && value.ends_with('"');
    let unquoted = remove_quotes(value);
    if !quoted || !unquoted.contains('\\') {
        return unquoted.to_owned();
    }
    let mut out = String::new();
    let mut chars = unquoted.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\'
            && let Some(next) = chars.next()
        {
            out.push(next);
            continue;
        }
        out.push(c);
    }
    out
}

/// UploadWire.SanitizeFileName.
pub(crate) fn sanitize_file_name(name: &str) -> String {
    let name = match name.rfind(['/', '\\']) {
        Some(separator) => &name[separator + 1..],
        None => name,
    };
    if name == "." || name == ".." || name.len() > 255 {
        return String::new();
    }
    name.to_owned()
}

#[cfg(test)]
#[path = "upload_test.rs"]
mod tests;

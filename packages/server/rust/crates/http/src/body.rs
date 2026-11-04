//! A request body read as Kestrel reads it: Content-Length or chunked, a
//! size cap, a minimum data rate, and Expect: 100-continue.

use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use tokio::time::Instant;

use crate::exchange::{Exchange, lock};
use crate::head::{MAX_HEADER_BLOCK, MAX_HEADER_COUNT};

/// Kestrel's MinRequestBodyDataRate.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BodyRate {
    pub bytes_per_second: f64,
    pub grace: Duration,
}

/// Why a body read failed. Every one ends the body: later reads return it
/// again.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BodyError {
    /// Over the cap (Kestrel's MaxRequestBodySize). Unless the route set the
    /// cap with [`Body::set_limit`], the host has answered 413 and closes.
    TooLarge,
    /// Under the minimum data rate. Unless the route set the cap, the host
    /// has answered 408 and closes. The request is cancelled too.
    TooSlow,
    /// Bad chunked framing. Unless the route set the cap, the host has
    /// answered 400 and closes.
    Malformed,
    /// A trailer over the head's limits: Kestrel's 431, then the close.
    HeadersTooLarge,
    /// NUL or invalid UTF-8 in a trailer value. Unless the route set the cap,
    /// the host has answered Kestrel's unhandled-error 500 and closes.
    BadTrailer,
    /// A chunk size past 0x7FFFFFFF. Unless the route set the cap, the host
    /// has answered Kestrel's unhandled-error 500 and closes.
    Overflow,
    /// The peer closed before the body ended.
    UnexpectedEof,
    /// The request deadline passed.
    Deadline,
    /// The socket failed.
    Io(std::io::ErrorKind),
}

impl fmt::Display for BodyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooLarge => f.write_str("request body over the host's cap"),
            Self::TooSlow => f.write_str("request body under the host's minimum data rate"),
            Self::Malformed => f.write_str("malformed chunked request body"),
            Self::Overflow => f.write_str("chunk size over 0x7FFFFFFF"),
            Self::HeadersTooLarge => f.write_str("request trailer over the header limits"),
            Self::BadTrailer => f.write_str("request trailer value is not valid UTF-8"),
            Self::UnexpectedEof => f.write_str("unexpected EOF"),
            Self::Deadline => f.write_str("request deadline passed"),
            Self::Io(kind) => write!(f, "request body read failed: {kind}"),
        }
    }
}

impl std::error::Error for BodyError {}

#[derive(Debug)]
pub(crate) enum Framing {
    Empty,
    Length(u64),
    Chunked(Chunk),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Chunk {
    Size,
    /// Inside a size line's extension, with the size it gave.
    Extension(u64),
    Data(u64),
    DataEnd,
    Trailers,
    Done,
}

pub(crate) struct BodyState {
    pub framing: Framing,
    /// Raw bytes read, chunked framing included: Kestrel counts them all
    /// against the cap.
    pub read: u64,
    pub waited: Duration,
    pub failed: Option<BodyError>,
    /// The head's header bytes and lines, then the trailer's on top.
    pub trailer_bytes: usize,
    pub trailer_lines: usize,
    pub trailer_seen: bool,
    /// 100 Continue went out, or may no longer.
    pub continued: bool,
}

impl BodyState {
    pub fn new(framing: Framing, head_bytes: usize, head_lines: usize) -> Self {
        Self {
            framing,
            read: 0,
            waited: Duration::ZERO,
            failed: None,
            trailer_bytes: head_bytes,
            trailer_lines: head_lines,
            trailer_seen: false,
            continued: false,
        }
    }

    pub fn done(&self) -> bool {
        matches!(
            self.framing,
            Framing::Empty | Framing::Length(0) | Framing::Chunked(Chunk::Done)
        )
    }
}

/// IHttpMaxRequestBodySizeFeature: read-only once reading starts.
pub(crate) struct Limits {
    pub limit: u64,
    pub route_set: bool,
    pub started: bool,
    pub length: Option<u64>,
}

/// The request body. Reads stream from the socket; nothing is buffered
/// beyond what the connection holds.
pub struct Body {
    pub(crate) exchange: Arc<Exchange>,
}

impl fmt::Debug for Body {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Body")
    }
}

impl Body {
    /// Raises or lowers the cap for this request, as POST /upload does
    /// before it reads. A cap set after the first read is ignored, as
    /// Kestrel's feature is read-only by then. A route that set the cap
    /// answers an over-cap or slow body itself.
    pub fn set_limit(&self, limit: u64) {
        let mut limits = lock(&self.exchange.limits);
        if !limits.started {
            limits.limit = limit;
            limits.route_set = true;
        }
    }

    /// Reads up to buf.len() bytes; 0 is the end of the body.
    pub async fn read(&mut self, buf: &mut [u8]) -> Result<usize, BodyError> {
        read(&self.exchange, buf, true).await
    }

    /// Reads the rest of the body onto out.
    pub async fn read_to_end(&mut self, out: &mut Vec<u8>) -> Result<(), BodyError> {
        let mut chunk = vec![0u8; 16 << 10];
        loop {
            match self.read(&mut chunk).await? {
                0 => return Ok(()),
                n => out.extend_from_slice(&chunk[..n]),
            }
        }
    }
}

/// One read. answer is false for the host's drain after the handler: no
/// 100-continue, and no answers.
pub(crate) async fn read(
    exchange: &Exchange,
    buf: &mut [u8],
    answer: bool,
) -> Result<usize, BodyError> {
    let mut state = exchange.body.lock().await;
    if let Some(error) = state.failed {
        return Err(error);
    }
    if state.done() {
        return Ok(0);
    }
    let (limit, route_set, first) = {
        let mut limits = lock(&exchange.limits);
        let first = !limits.started;
        limits.started = true;
        (limits.limit, limits.route_set, first)
    };
    if first
        && let Framing::Length(length) = state.framing
        && length > limit
    {
        return Err(fail(exchange, &mut state, BodyError::TooLarge, route_set, answer).await);
    }
    if buf.is_empty() {
        return Ok(0);
    }
    loop {
        let stepped = step(exchange, &mut state, buf);
        exchange.inbound.wake_reader();
        match stepped {
            Step::Read(n) => {
                state.read += n as u64;
                if state.read > limit {
                    return Err(
                        fail(exchange, &mut state, BodyError::TooLarge, route_set, answer).await,
                    );
                }
                return Ok(n);
            }
            Step::End => return Ok(0),
            Step::Fail(error) => {
                return Err(fail(exchange, &mut state, error, route_set, answer).await);
            }
            Step::Progress => {
                if state.read > limit {
                    return Err(
                        fail(exchange, &mut state, BodyError::TooLarge, route_set, answer).await,
                    );
                }
            }
            Step::Wait(have) => {
                // Measured: Kestrel sends 100 Continue once, when a read of
                // the route must wait for the socket and nothing of the
                // answer is out.
                if answer && exchange.expects_continue && !state.continued {
                    state.continued = true;
                    let mut wire = exchange.wire.lock().await;
                    if !wire.started && !wire.hijacked {
                        let _ = wire.send(b"HTTP/1.1 100 Continue\r\n\r\n").await;
                    }
                }
                if let Err(error) = wait(exchange, &mut state, have, answer).await {
                    return Err(fail(exchange, &mut state, error, route_set, answer).await);
                }
            }
        }
    }
}

enum Step {
    Read(usize),
    End,
    Fail(BodyError),
    /// Framing moved on with no data yet.
    Progress,
    /// More than this many buffered bytes are needed.
    Wait(usize),
}

fn step(exchange: &Exchange, state: &mut BodyState, buf: &mut [u8]) -> Step {
    let mut inbound = exchange.inbound.lock();
    let available = inbound.buf.len();
    let ended = inbound.ended();
    let ended_step = |have| {
        if ended {
            Step::Fail(BodyError::UnexpectedEof)
        } else {
            Step::Wait(have)
        }
    };
    match &mut state.framing {
        Framing::Empty | Framing::Length(0) | Framing::Chunked(Chunk::Done) => Step::End,
        Framing::Length(remaining) => {
            if available == 0 {
                return ended_step(0);
            }
            let n = (*remaining).min(available as u64).min(buf.len() as u64) as usize;
            buf[..n].copy_from_slice(&inbound.buf[..n]);
            inbound.consume(n);
            *remaining -= n as u64;
            Step::Read(n)
        }
        Framing::Chunked(chunk) => match *chunk {
            Chunk::Data(remaining) => {
                if available == 0 {
                    return ended_step(0);
                }
                let n = remaining.min(available as u64).min(buf.len() as u64) as usize;
                buf[..n].copy_from_slice(&inbound.buf[..n]);
                inbound.consume(n);
                *chunk = if remaining == n as u64 {
                    Chunk::DataEnd
                } else {
                    Chunk::Data(remaining - n as u64)
                };
                Step::Read(n)
            }
            Chunk::DataEnd => {
                if available < 2 {
                    return ended_step(available);
                }
                if &inbound.buf[..2] != b"\r\n" {
                    return Step::Fail(BodyError::Malformed);
                }
                inbound.consume(2);
                state.read += 2;
                *chunk = Chunk::Size;
                Step::Progress
            }
            // Measured: trailer lines count with the head's lines and bytes
            // and follow the head's grammar. Kestrel also takes a bare LF
            // here; this refuses it, as every other chunk line, so a proxy
            // that reads the trailer otherwise cannot desync the host.
            Chunk::Trailers => {
                // Measured: Kestrel reads a trailer line only once it holds
                // two bytes, so a lone LF waits for the next one.
                if available < 2 {
                    return ended_step(available);
                }
                let Some(lf) = inbound.buf.iter().position(|&b| b == b'\n') else {
                    if state.trailer_bytes + available >= MAX_HEADER_BLOCK {
                        return Step::Fail(BodyError::HeadersTooLarge);
                    }
                    return ended_step(available);
                };
                state.trailer_bytes += lf + 1;
                if state.trailer_bytes > MAX_HEADER_BLOCK {
                    return Step::Fail(BodyError::HeadersTooLarge);
                }
                if lf == 0 || inbound.buf[lf - 1] != b'\r' {
                    return Step::Fail(BodyError::Malformed);
                }
                let line = &inbound.buf[..lf - 1];
                if line.is_empty() {
                    // Measured: the last CRLF counts against the cap only
                    // when no trailer line came first.
                    if !state.trailer_seen {
                        state.read += (lf + 1) as u64;
                    }
                    inbound.consume(lf + 1);
                    *chunk = Chunk::Done;
                    return Step::Progress;
                }
                if state.trailer_lines >= MAX_HEADER_COUNT {
                    return Step::Fail(BodyError::HeadersTooLarge);
                }
                if let Err(error) = check_trailer_line(line) {
                    return Step::Fail(error);
                }
                state.trailer_lines += 1;
                state.trailer_seen = true;
                inbound.consume(lf + 1);
                Step::Progress
            }
            Chunk::Size => match chunk_prefix(&inbound.buf) {
                Err(error) => Step::Fail(error),
                Ok(Prefix::More) => ended_step(available),
                // Measured: Kestrel reads an extension as it comes and counts
                // it against the body cap, so it is not held here.
                Ok(Prefix::Extension { size, at }) => {
                    inbound.consume(at + 1);
                    state.read += (at + 1) as u64;
                    *chunk = Chunk::Extension(size);
                    Step::Progress
                }
                Ok(Prefix::Line { size, len }) => {
                    inbound.consume(len);
                    state.read += len as u64;
                    *chunk = if size == 0 {
                        Chunk::Trailers
                    } else {
                        Chunk::Data(size)
                    };
                    Step::Progress
                }
            },
            Chunk::Extension(size) => {
                let Some(lf) = inbound.buf.iter().position(|&b| b == b'\n') else {
                    // Keeps the last byte: it may be the CR of the CRLF.
                    if available < 2 {
                        return ended_step(available);
                    }
                    inbound.consume(available - 1);
                    state.read += (available - 1) as u64;
                    return Step::Progress;
                };
                if lf == 0 || inbound.buf[lf - 1] != b'\r' {
                    return Step::Fail(BodyError::Malformed);
                }
                inbound.consume(lf + 1);
                state.read += (lf + 1) as u64;
                *chunk = if size == 0 {
                    Chunk::Trailers
                } else {
                    Chunk::Data(size)
                };
                Step::Progress
            }
            Chunk::Done => Step::End,
        },
    }
}

/// Measured on the C# host: a line with no colon, an empty or folded name,
/// a name byte that is NUL, tab, CR, space or above 0x7F, or a CR in the
/// value is a 400; NUL or invalid UTF-8 in the value is the app's 500.
fn check_trailer_line(line: &[u8]) -> Result<(), BodyError> {
    let colon = line
        .iter()
        .position(|&b| b == b':')
        .ok_or(BodyError::Malformed)?;
    let (name, value) = (&line[..colon], &line[colon + 1..]);
    if name.is_empty()
        || name
            .iter()
            .any(|&b| b == 0 || b == b'\t' || b == b'\r' || b == b' ' || b >= 0x80)
    {
        return Err(BodyError::Malformed);
    }
    if value.contains(&b'\r') {
        return Err(BodyError::Malformed);
    }
    if value.contains(&0) || std::str::from_utf8(value).is_err() {
        return Err(BodyError::BadTrailer);
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
enum Prefix {
    More,
    /// The size line, CRLF included, is len bytes.
    Line {
        size: u64,
        len: usize,
    },
    /// The ';' that starts an extension is at index at.
    Extension {
        size: u64,
        at: usize,
    },
}

/// Kestrel's MaxChunkPrefixBytes: enough for "7FFFFFFF\r\n".
const MAX_CHUNK_PREFIX: usize = 10;

/// Kestrel's ParseChunkedPrefix on the bytes so far, so a line is refused
/// or waits at the same byte as on the C# host. It starts only with two
/// bytes in, takes each byte before the next as a hex digit unless the pair
/// is CRLF or the byte is ';', and refuses a line not done in ten bytes.
/// Each digit is added to an int, checked: past 0x7FFFFFFF is an
/// OverflowException (the app's 500), so an overflow wins over a bad byte
/// after it.
fn chunk_prefix(b: &[u8]) -> Result<Prefix, BodyError> {
    if b.len() < 2 {
        return Ok(Prefix::More);
    }
    let mut size = chunk_digit(b[0], 0)?;
    let mut first = b[1];
    let mut consumed = 2;
    while consumed < MAX_CHUNK_PREFIX {
        if first == b';' {
            return Ok(Prefix::Extension {
                size,
                at: consumed - 1,
            });
        }
        let Some(&second) = b.get(consumed) else {
            return Ok(Prefix::More);
        };
        consumed += 1;
        if first == b'\r' && second == b'\n' {
            return Ok(Prefix::Line {
                size,
                len: consumed,
            });
        }
        size = chunk_digit(first, size)?;
        first = second;
    }
    Err(BodyError::Malformed)
}

fn chunk_digit(c: u8, size: u64) -> Result<u64, BodyError> {
    let digit = (c as char).to_digit(16).ok_or(BodyError::Malformed)?;
    let size = size * 16 + u64::from(digit);
    if size > i32::MAX as u64 {
        return Err(BodyError::Overflow);
    }
    Ok(size)
}

/// rated is false for the host's drain, which has its own cut-off.
async fn wait(
    exchange: &Exchange,
    state: &mut BodyState,
    have: usize,
    rated: bool,
) -> Result<(), BodyError> {
    let deadline = exchange.body_deadline();
    let rate = exchange.config.min_body_rate.filter(|_| rated);
    let started = Instant::now();
    // The moment the rate fails if no byte comes: past the grace, and past
    // the time the bytes so far are worth at the rate. Only time spent
    // waiting inside reads counts, as Kestrel times only reads the app is
    // waiting on.
    let slow_at = rate.map(|rate| {
        let worth = Duration::from_secs_f64(state.read as f64 / rate.bytes_per_second);
        started + rate.grace.max(worth).saturating_sub(state.waited) + Duration::from_millis(1)
    });
    let until = match (deadline, slow_at) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    };
    let waiting = exchange.inbound.wait_for_more(have);
    let result = match until {
        Some(until) => tokio::time::timeout_at(until, waiting).await.ok(),
        None => {
            waiting.await;
            Some(())
        }
    };
    state.waited += started.elapsed();
    if result.is_some() {
        return Ok(());
    }
    if slow_at.is_some_and(|slow| Instant::now() >= slow)
        && deadline.is_none_or(|d| Instant::now() < d)
    {
        exchange.cancel();
        return Err(BodyError::TooSlow);
    }
    Err(BodyError::Deadline)
}

async fn fail(
    exchange: &Exchange,
    state: &mut BodyState,
    error: BodyError,
    route_set: bool,
    answer: bool,
) -> BodyError {
    state.failed = Some(error);
    let status = match error {
        BodyError::TooLarge => Some(413),
        BodyError::TooSlow => Some(408),
        BodyError::Malformed => Some(400),
        BodyError::UnexpectedEof | BodyError::Io(_) => {
            exchange.cancel();
            None
        }
        BodyError::HeadersTooLarge => Some(431),
        BodyError::Deadline | BodyError::Overflow | BodyError::BadTrailer => None,
    };
    if matches!(error, BodyError::Overflow | BodyError::BadTrailer) {
        if answer && !route_set {
            exchange.refuse_unhandled().await;
        } else {
            exchange.wire.lock().await.close = true;
        }
    }
    if let Some(status) = status {
        if answer && !route_set {
            exchange.refuse(status).await;
        } else {
            exchange.wire.lock().await.close = true;
        }
    }
    error
}

#[cfg(test)]
mod tests {
    use super::*;

    // Kestrel's ParseChunkedPrefix on the bytes so far: More while it needs
    // another byte, the whole line once it is taken, or where an extension
    // starts.
    #[test]
    fn kestrel_chunk_prefix() {
        use Prefix::{Extension, Line, More};
        let line = |size, len| Ok(Line { size, len });
        let rows: [(&str, Result<Prefix, BodyError>); 22] = [
            ("2\r\n", line(2, 3)),
            ("7FFFFFFF\r\n", line(0x7FFF_FFFF, 10)),
            ("00000002\r\n", line(2, 10)),
            ("0\r\n", line(0, 3)),
            ("2;a=b\r\n", Ok(Extension { size: 2, at: 1 })),
            ("2;", Ok(Extension { size: 2, at: 1 })),
            (
                "7FFFFFF;\r\n",
                Ok(Extension {
                    size: 0x7FF_FFFF,
                    at: 7,
                }),
            ),
            ("5\r\nA;xyz", line(5, 3)),
            ("3\r\n;ab", line(3, 3)),
            ("2", Ok(More)),
            ("2\r", Ok(More)),
            ("2\n", Ok(More)),
            ("zz\r\n", Err(BodyError::Malformed)),
            ("2 \r\n", Err(BodyError::Malformed)),
            ("-2\r\n", Err(BodyError::Malformed)),
            ("2\n{", Err(BodyError::Malformed)),
            ("\r\n", Err(BodyError::Malformed)),
            ("0000000002\r\n", Err(BodyError::Malformed)),
            (";a\r\n", Err(BodyError::Malformed)),
            ("80000000\r\n", Err(BodyError::Overflow)),
            ("100000000\r\n", Err(BodyError::Overflow)),
            ("fffffffffffffffffff\r\n", Err(BodyError::Overflow)),
        ];
        for (bytes, want) in rows {
            assert_eq!(chunk_prefix(bytes.as_bytes()), want, "{bytes:?}");
        }
    }
}

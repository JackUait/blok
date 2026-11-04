//! A request body read as Kestrel reads it: Content-Length or chunked, a
//! size cap, a minimum data rate, and Expect: 100-continue.

use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use tokio::time::Instant;

use crate::exchange::{Exchange, lock};

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
    Data(u64),
    DataEnd,
    Trailers,
    Done,
}

pub(crate) struct BodyState {
    pub framing: Framing,
    pub read: u64,
    pub waited: Duration,
    pub failed: Option<BodyError>,
}

impl BodyState {
    pub fn new(framing: Framing) -> Self {
        Self {
            framing,
            read: 0,
            waited: Duration::ZERO,
            failed: None,
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

/// A chunk-size line longer than this is refused.
const MAX_CHUNK_LINE: usize = 8 << 10;

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
    if first {
        if let Framing::Length(length) = state.framing
            && length > limit
        {
            return Err(fail(exchange, &mut state, BodyError::TooLarge, route_set, answer).await);
        }
        // Measured: Kestrel sends 100 Continue only when no body byte has
        // come yet.
        if answer && exchange.expects_continue && exchange.inbound.lock().buf.is_empty() {
            let mut wire = exchange.wire.lock().await;
            if !wire.started && !wire.hijacked {
                let _ = wire.send(b"HTTP/1.1 100 Continue\r\n\r\n").await;
            }
        }
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
            Step::Progress => continue,
            Step::Wait(have) => {
                if let Err(error) = wait(exchange, &mut state, have).await {
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
                *chunk = Chunk::Size;
                Step::Progress
            }
            Chunk::Size | Chunk::Trailers => {
                let Some(lf) = inbound.buf.iter().position(|&b| b == b'\n') else {
                    if available > MAX_CHUNK_LINE {
                        return Step::Fail(BodyError::Malformed);
                    }
                    return ended_step(available);
                };
                // Chunk framing needs CRLF; a bare LF is refused.
                if lf == 0 || inbound.buf[lf - 1] != b'\r' {
                    return Step::Fail(BodyError::Malformed);
                }
                let line = &inbound.buf[..lf - 1];
                let next = if *chunk == Chunk::Trailers {
                    if line.is_empty() {
                        Chunk::Done
                    } else {
                        Chunk::Trailers
                    }
                } else {
                    match chunk_size(line) {
                        Ok(0) => Chunk::Trailers,
                        Ok(size) => Chunk::Data(size),
                        Err(error) => return Step::Fail(error),
                    }
                };
                inbound.consume(lf + 1);
                *chunk = next;
                Step::Progress
            }
            Chunk::Done => Step::End,
        },
    }
}

/// Hex digits, then an optional ";extension". Measured: no spaces, no sign.
/// Kestrel adds each digit to an int, checked: past 0x7FFFFFFF is an
/// OverflowException (the app's 500), and a ninth digit that fits is its
/// 400. The digits are taken in order, so an overflow wins over a bad byte
/// after it.
fn chunk_size(line: &[u8]) -> Result<u64, BodyError> {
    let mut size: u64 = 0;
    let mut digits = 0;
    for &b in line {
        let Some(digit) = (b as char).to_digit(16) else {
            break;
        };
        size = size * 16 + u64::from(digit);
        if size > i32::MAX as u64 {
            return Err(BodyError::Overflow);
        }
        digits += 1;
        if digits > 8 {
            return Err(BodyError::Malformed);
        }
    }
    let rest = &line[digits..];
    if digits == 0 || !(rest.is_empty() || rest[0] == b';') {
        return Err(BodyError::Malformed);
    }
    Ok(size)
}

async fn wait(exchange: &Exchange, state: &mut BodyState, have: usize) -> Result<(), BodyError> {
    let deadline = exchange.body_deadline();
    let rate = exchange.config.min_body_rate;
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
        BodyError::Deadline | BodyError::Overflow => None,
    };
    if error == BodyError::Overflow {
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

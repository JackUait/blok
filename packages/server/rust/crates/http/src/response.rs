//! The response writer: Kestrel's framing and head.

use std::fmt;
use std::sync::Arc;

use tokio::net::TcpStream;

use crate::exchange::{Exchange, Framing, Wire, lock};
use crate::head::Version;
use crate::headers::{Headers, is_field_value};
use crate::wire::{http_date, reason_phrase};

/// Why a write failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WriteError {
    /// The host owns this answer now (a passed deadline, a refused body),
    /// or the response already ended or was hijacked. Nothing went out.
    Closed,
    /// The status allows no body (1xx, 204, 304).
    BodyNotAllowed,
    /// More bytes than the Content-Length that was set.
    TooManyBytes,
    /// A header value Kestrel refuses (see [`is_field_value`]): an empty
    /// 500 went out in place of the answer.
    InvalidHeader,
    Io(std::io::ErrorKind),
}

impl fmt::Display for WriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Closed => f.write_str("the response is closed"),
            Self::BodyNotAllowed => f.write_str("this status allows no response body"),
            Self::TooManyBytes => {
                f.write_str("Response Content-Length mismatch: too many bytes written")
            }
            Self::InvalidHeader => f.write_str("invalid response header value"),
            Self::Io(kind) => write!(f, "response write failed: {kind}"),
        }
    }
}

impl std::error::Error for WriteError {}

/// Why a hijack failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HijackError {
    /// The response already started, or the host owns it.
    Started,
    /// The connection is gone.
    Gone,
}

impl fmt::Display for HijackError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Started => f.write_str("the response already started"),
            Self::Gone => f.write_str("the connection is gone"),
        }
    }
}

impl std::error::Error for HijackError {}

/// A connection taken over from HTTP. `buffered` holds bytes the peer sent
/// after the request head, which belong to the new protocol. No deadline,
/// header clock or idle timer applies to it, and server shutdown does not
/// wait for it.
#[derive(Debug)]
pub struct Upgraded {
    pub stream: TcpStream,
    pub buffered: Vec<u8>,
}

/// Writes one response, as Kestrel frames it:
///   - the head goes out on the first write, `flush` or `start`;
///   - with no Content-Length set, the body is chunked (close-delimited on
///     HTTP/1.0); with one, it is that long;
///   - a handler that returns before the head went out gets
///     `Content-Length: 0` (not on HEAD, 1xx, 204 or 304);
///   - HEAD bodies are dropped.
///
/// So a small body written once is still chunked; set Content-Length for
/// a sized answer. The status line always says HTTP/1.1, with Kestrel's
/// reason phrase.
pub struct ResponseWriter {
    exchange: Arc<Exchange>,
    status: u16,
    headers: Headers,
    committed: bool,
}

impl fmt::Debug for ResponseWriter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ResponseWriter")
            .field("status", &self.status)
            .field("headers", &self.headers)
            .field("committed", &self.committed)
            .finish()
    }
}

impl ResponseWriter {
    pub(crate) fn new(exchange: Arc<Exchange>) -> Self {
        Self {
            exchange,
            status: 200,
            headers: Headers::new(),
            committed: false,
        }
    }

    pub fn status(&self) -> u16 {
        self.status
    }

    /// The status for the head. Ignored once the head went out.
    pub fn set_status(&mut self, status: u16) {
        if !self.committed {
            self.status = status;
        }
    }

    pub fn headers(&self) -> &Headers {
        &self.headers
    }

    /// Changes after the head went out are ignored.
    pub fn headers_mut(&mut self) -> &mut Headers {
        &mut self.headers
    }

    /// Whether the head went out.
    pub fn started(&self) -> bool {
        self.committed
    }

    /// Sends the head now with this status, so the body streams after it:
    /// route.StartStream in the Go host.
    pub async fn start(&mut self, status: u16) -> Result<(), WriteError> {
        self.set_status(status);
        self.flush().await
    }

    /// Sends the head if it has not gone out.
    pub async fn flush(&mut self) -> Result<(), WriteError> {
        let exchange = Arc::clone(&self.exchange);
        let mut wire = exchange.wire.lock().await;
        self.commit(&mut wire).await
    }

    /// Writes body bytes, sending the head first if needed.
    pub async fn write(&mut self, bytes: &[u8]) -> Result<(), WriteError> {
        let exchange = Arc::clone(&self.exchange);
        let mut wire = exchange.wire.lock().await;
        self.commit(&mut wire).await?;
        match wire.framing {
            Framing::None if !self.exchange.method_head => Err(WriteError::BodyNotAllowed),
            Framing::None => Ok(()),
            _ if bytes.is_empty() => Ok(()),
            Framing::Length(remaining) => {
                if bytes.len() as u64 > remaining {
                    return Err(WriteError::TooManyBytes);
                }
                wire.framing = Framing::Length(remaining - bytes.len() as u64);
                send(&mut wire, bytes).await
            }
            Framing::Chunked => {
                let mut chunk = format!("{:x}\r\n", bytes.len()).into_bytes();
                chunk.extend_from_slice(bytes);
                chunk.extend_from_slice(b"\r\n");
                send(&mut wire, &chunk).await
            }
            Framing::Close => send(&mut wire, bytes).await,
        }
    }

    /// Takes the connection over, for an upgrade. The caller writes the
    /// 101 itself.
    pub async fn hijack(mut self) -> Result<Upgraded, HijackError> {
        let exchange = Arc::clone(&self.exchange);
        let mut wire = exchange.wire.lock().await;
        if wire.started || wire.host_owned || wire.finished || wire.hijacked {
            return Err(HijackError::Started);
        }
        let write = wire.write.take().ok_or(HijackError::Gone)?;
        wire.started = true;
        wire.hijacked = true;
        self.committed = true;
        drop(wire);
        lock(&exchange.active).take();
        exchange.hijacked.notify_one();
        let (read, buffered) = exchange.inbound.stop().await.ok_or(HijackError::Gone)?;
        let stream = read.reunite(write).map_err(|_| HijackError::Gone)?;
        Ok(Upgraded { stream, buffered })
    }

    async fn commit(&mut self, wire: &mut Wire) -> Result<(), WriteError> {
        if wire.host_owned || wire.finished || wire.hijacked {
            return Err(WriteError::Closed);
        }
        if self.committed {
            return Ok(());
        }
        // Measured: Kestrel answers nothing once the peer half-closed, even
        // a whole request it already read.
        if self.exchange.inbound.lock().ended() {
            wire.host_owned = true;
            wire.close = true;
            return Err(WriteError::Closed);
        }
        self.committed = true;
        wire.started = true;
        match response_head(&self.exchange, wire, self.status, &self.headers, false) {
            Ok(head) => send(wire, &head).await,
            Err(refused) => {
                let _ = wire.send(&refused).await;
                Err(WriteError::InvalidHeader)
            }
        }
    }
}

impl Drop for ResponseWriter {
    fn drop(&mut self) {
        if !self.committed {
            *lock(&self.exchange.left) = Some((self.status, std::mem::take(&mut self.headers)));
        }
    }
}

fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.bytes().all(crate::head::is_token_byte)
}

async fn send(wire: &mut Wire, bytes: &[u8]) -> Result<(), WriteError> {
    wire.send(bytes).await.map_err(|error| {
        wire.close = true;
        WriteError::Io(error.kind())
    })
}

fn body_allowed(status: u16) -> bool {
    !(100..200).contains(&status) && status != 204 && status != 304
}

/// The head for an answer, and the framing and keep-alive it sets on wire.
/// finished: the handler returned before any write, so an allowed body is
/// empty. Every head goes through here: a header name or value Kestrel
/// refuses turns the answer into its empty 500 (Err), and the host owns the
/// rest of the response.
pub(crate) fn response_head(
    exchange: &Exchange,
    wire: &mut Wire,
    status: u16,
    headers: &Headers,
    finished: bool,
) -> Result<Vec<u8>, Vec<u8>> {
    let lengths: Vec<&str> = headers.get_all("content-length").collect();
    let bad_length = lengths.len() > 1
        || lengths
            .iter()
            .any(|value| value.trim().parse::<u64>().is_err());
    if bad_length
        || headers
            .iter()
            .any(|(name, value)| !valid_name(name) || !is_field_value(value))
    {
        let mut refused = Headers::new();
        refused.add("Content-Length", "0");
        wire.host_owned = true;
        return Err(build_head(exchange, wire, 500, &refused, finished));
    }
    Ok(build_head(exchange, wire, status, headers, finished))
}

fn build_head(
    exchange: &Exchange,
    wire: &mut Wire,
    status: u16,
    headers: &Headers,
    finished: bool,
) -> Vec<u8> {
    let length = headers
        .get("content-length")
        .and_then(|value| value.trim().parse::<u64>().ok());
    let mut auto_length = None;
    let framing = if !body_allowed(status) {
        Framing::None
    } else if let Some(length) = length {
        if exchange.method_head {
            Framing::None
        } else {
            Framing::Length(length)
        }
    } else if exchange.method_head {
        Framing::None
    } else if finished {
        auto_length = Some(0);
        Framing::Length(0)
    } else if exchange.version == Version::Http11 {
        Framing::Chunked
    } else {
        Framing::Close
    };
    wire.framing = framing;

    let sized = matches!(framing, Framing::Length(_) | Framing::None);
    let close = wire.close
        || exchange.request_close
        || exchange.stopping()
        || framing == Framing::Close
        || headers.has_token("connection", "close")
        || (exchange.version == Version::Http10 && !(exchange.keep_alive_10 && sized));
    wire.close = close;

    let mut head = format!("HTTP/1.1 {status} {}\r\n", reason_phrase(status));
    let mut line = |name: &str, value: &str| {
        head.push_str(name);
        head.push_str(": ");
        head.push_str(value);
        head.push_str("\r\n");
    };
    // Kestrel's order for the headers it writes itself; the rest follow as
    // set. Order is not part of the contract.
    if let Some(value) = headers.get("content-length") {
        line("Content-Length", value);
    } else if let Some(length) = auto_length {
        line("Content-Length", &length.to_string());
    }
    if let Some(value) = headers.get("connection") {
        line("Connection", value);
    } else if close {
        line("Connection", "close");
    } else if exchange.version == Version::Http10 {
        line("Connection", "keep-alive");
    }
    for value in headers.get_all("content-type") {
        line("Content-Type", value);
    }
    match headers.get("date") {
        Some(value) => line("Date", value),
        None => line("Date", &http_date(std::time::SystemTime::now())),
    }
    if let Some(server) = &exchange.config.server_header
        && !headers.contains("server")
        && is_field_value(server)
    {
        line("Server", server);
    }
    if framing == Framing::Chunked {
        line("Transfer-Encoding", "chunked");
    }
    for (name, value) in headers.iter() {
        let own = [
            "content-length",
            "connection",
            "content-type",
            "date",
            "transfer-encoding",
        ];
        if own.iter().any(|own| name.eq_ignore_ascii_case(own)) {
            continue;
        }
        line(name, value);
    }
    head.push_str("\r\n");
    head.into_bytes()
}

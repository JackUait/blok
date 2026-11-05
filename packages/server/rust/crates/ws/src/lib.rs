//! The server side of RFC 6455 that the sync endpoint needs, shaped like
//! .NET's ManagedWebSocket (System.Net.WebSockets 10.0.11, decompiled) so
//! SyncSocketMember ports line for line: no extensions, one receive at a
//! time, every frame boundary visible (an empty fragment is one receive),
//! exact close codes and reasons.

mod keepalive;

use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use blok_http::{HijackError, Request, ResponseWriter};
use sha1::{Digest, Sha1};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::watch;

use keepalive::KeepAlive;

/// WebSocketMessageType.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MessageType {
    Text,
    Binary,
    Close,
}

pub const STATUS_NORMAL: u16 = 1000;
pub const STATUS_PROTOCOL_ERROR: u16 = 1002;
pub const STATUS_INVALID_PAYLOAD: u16 = 1007;

const OP_CONTINUATION: u8 = 0x0;
const OP_TEXT: u8 = 0x1;
const OP_BINARY: u8 = 0x2;
const OP_CLOSE: u8 = 0x8;
const OP_PING: u8 = 0x9;
const OP_PONG: u8 = 0xa;

/// Errors a receive or send returns. Every one means the socket is gone for
/// SyncSocketMember (IsSocketGone).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    /// A frame the peer had no right to send; a 1002 or 1007 close went out
    /// first.
    Protocol,
    /// The stream ended inside a frame.
    PrematureClose,
    /// A send after our close, or after an abort.
    InvalidState,
    /// The abort when a keep-alive ping went unanswered.
    KeepAliveTimeout,
    /// A valid key too long for CreateResponseKey's buffer.
    AcceptKey,
    /// The socket was disposed under a pending read or write.
    Aborted,
    Hijack(HijackError),
    Io(std::io::ErrorKind),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Protocol => f.write_str("ws: protocol violation"),
            Self::PrematureClose => f.write_str("ws: connection closed prematurely"),
            Self::InvalidState => f.write_str("ws: invalid state"),
            Self::KeepAliveTimeout => f.write_str("ws: keep-alive ping timed out"),
            Self::AcceptKey => f.write_str("ws: the Sec-WebSocket-Key does not fit"),
            Self::Aborted => f.write_str("ws: the socket was aborted"),
            Self::Hijack(error) => write!(f, "ws: {error}"),
            Self::Io(kind) => write!(f, "ws: {kind}"),
        }
    }
}

impl std::error::Error for Error {}

const ACCEPT_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/// WebSocketAcceptContext's fields the endpoint sets.
#[derive(Clone, Debug, Default)]
pub struct Options {
    pub sub_protocol: String,
    /// Above zero sends pings; with a keep_alive_timeout above zero an
    /// unanswered ping aborts the socket after the timeout.
    pub keep_alive_interval: Duration,
    pub keep_alive_timeout: Duration,
}

/// IsWebSocketRequest is Kestrel's IsUpgradableRequest (a Connection upgrade
/// token, no body, no Transfer-Encoding) and then ASP.NET's
/// CheckSupportedWebSocketRequest (GET, version 13, Upgrade websocket,
/// Connection Upgrade, a key that is 16 bytes of base64).
pub fn is_web_socket_request(request: &Request) -> bool {
    let has_body = request.content_length().unwrap_or(0) != 0;
    is_upgrade(
        request.method(),
        request.headers(),
        has_body,
        request.headers().contains("transfer-encoding"),
    )
}

pub(crate) fn is_upgrade(
    method: &str,
    headers: &blok_http::Headers,
    has_body: bool,
    has_coding: bool,
) -> bool {
    if !headers.has_token("Connection", "upgrade") || has_body || has_coding {
        return false;
    }
    method.eq_ignore_ascii_case("GET")
        && headers.has_token("Sec-WebSocket-Version", "13")
        && headers.has_token("Upgrade", "websocket")
        && key_valid(&joined_key(headers))
}

fn joined_key(headers: &blok_http::Headers) -> String {
    headers
        .get_all("Sec-WebSocket-Key")
        .collect::<Vec<_>>()
        .join(",")
}

/// IsRequestKeyValid: Convert.TryFromBase64String ignores whitespace and
/// must yield exactly 16 bytes.
fn key_valid(key: &str) -> bool {
    if key.trim().is_empty() {
        return false;
    }
    let compact: String = key
        .chars()
        .filter(|c| !matches!(c, ' ' | '\t' | '\r' | '\n'))
        .collect();
    STANDARD
        .decode(compact)
        .is_ok_and(|decoded| decoded.len() == 16)
}

/// CreateResponseKey: the key's UTF-8 bytes go into a 60-byte buffer and the
/// GUID is written over it from byte 24, so only the first 24 bytes of a
/// spaced-out key count. None when the key does not fit, where .NET throws.
pub fn accept_key(key: &str) -> Option<String> {
    let mut buffer = [0u8; 60];
    if key.len() > buffer.len() {
        return None;
    }
    buffer[..key.len()].copy_from_slice(key.as_bytes());
    buffer[24..].copy_from_slice(ACCEPT_GUID.as_bytes());
    Some(STANDARD.encode(Sha1::digest(buffer)))
}

/// Takes the connection over and writes the 101. The caller checked
/// is_web_socket_request. A hijacked connection is outside the host's
/// deadline, header clock and idle timer.
pub async fn upgrade(
    response: ResponseWriter,
    request: &Request,
    options: Options,
) -> Result<Conn, Error> {
    let accept = accept_key(&joined_key(request.headers())).ok_or(Error::AcceptKey)?;
    // Kestrel's order.
    let mut answer = format!(
        "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nDate: {}\r\n",
        blok_http::wire::http_date(std::time::SystemTime::now())
    );
    if let Some(server) = response.server_header() {
        answer.push_str(&format!("Server: {server}\r\n"));
    }
    answer.push_str(&format!(
        "Upgrade: websocket\r\nSec-WebSocket-Accept: {accept}\r\n"
    ));
    let upgraded = response.hijack().await.map_err(Error::Hijack)?;
    if !options.sub_protocol.trim().is_empty() {
        answer.push_str(&format!(
            "Sec-WebSocket-Protocol: {}\r\n",
            options.sub_protocol
        ));
    }
    answer.push_str("\r\n");
    let (read, mut write) = upgraded.stream.into_split();
    write
        .write_all(answer.as_bytes())
        .await
        .map_err(|error| Error::Io(error.kind()))?;
    Ok(Conn::new(read, write, upgraded.buffered, options))
}

type Reader = Box<dyn AsyncRead + Send + Unpin>;
type Writer = Box<dyn AsyncWrite + Send + Unpin>;

#[derive(Clone, Copy, Debug)]
struct FrameHeader {
    fin: bool,
    opcode: u8,
    remaining: u64,
    mask: [u8; 4],
    mask_pos: usize,
    processed: bool,
}

impl FrameHeader {
    fn unmask(&mut self, b: &mut [u8]) {
        for (i, byte) in b.iter_mut().enumerate() {
            *byte ^= self.mask[(self.mask_pos + i) & 3];
        }
        self.mask_pos = (self.mask_pos + b.len()) & 3;
    }
}

/// Receive state, owned by the one receiving task at a time.
struct ReceiveState {
    reader: Option<Reader>,
    buffer: Vec<u8>,
    start: usize,
    last: FrameHeader,
    utf8: Utf8State,
}

#[derive(Default)]
struct Flags {
    sent_close: bool,
    received_close: bool,
    aborted: bool,
    close_status: u16,
    close_description: String,
}

pub(crate) struct Inner {
    send: tokio::sync::Mutex<Option<Writer>>,
    receive: tokio::sync::Mutex<ReceiveState>,
    flags: Mutex<Flags>,
    pub(crate) keep_alive: Mutex<Option<KeepAlive>>,
    /// An unsolicited pong waiting on the send lock.
    pub(crate) keep_alive_sending: AtomicBool,
    done: watch::Sender<bool>,
    disposed: AtomicBool,
}

/// One accepted WebSocket. Clones share it. receive is for one task at a
/// time; sends may come from any task.
#[derive(Clone)]
pub struct Conn {
    pub(crate) inner: Arc<Inner>,
}

impl fmt::Debug for Conn {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Conn")
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}

impl Conn {
    /// Wraps a stream whose handshake is done. buffered holds bytes already
    /// read past the handshake.
    pub fn new(
        reader: impl AsyncRead + Send + Unpin + 'static,
        writer: impl AsyncWrite + Send + Unpin + 'static,
        buffered: Vec<u8>,
        options: Options,
    ) -> Self {
        let (done, _) = watch::channel(false);
        let conn = Self {
            inner: Arc::new(Inner {
                send: tokio::sync::Mutex::new(Some(Box::new(writer))),
                receive: tokio::sync::Mutex::new(ReceiveState {
                    reader: Some(Box::new(reader)),
                    buffer: buffered,
                    start: 0,
                    last: FrameHeader {
                        fin: true,
                        opcode: OP_TEXT,
                        remaining: 0,
                        mask: [0; 4],
                        mask_pos: 0,
                        processed: true,
                    },
                    utf8: Utf8State::default(),
                }),
                flags: Mutex::new(Flags::default()),
                keep_alive: Mutex::new(None),
                keep_alive_sending: AtomicBool::new(false),
                done,
                disposed: AtomicBool::new(false),
            }),
        };
        if !options.keep_alive_interval.is_zero() {
            conn.start_keep_alive(options.keep_alive_interval, options.keep_alive_timeout);
        }
        conn
    }

    /// The peer's close status, once a close came.
    pub fn close_status(&self) -> u16 {
        lock(&self.inner.flags).close_status
    }

    pub fn close_description(&self) -> String {
        lock(&self.inner.flags).close_description.clone()
    }

    pub fn is_done(&self) -> bool {
        *self.inner.done.borrow()
    }

    /// Resolves once the socket is disposed.
    pub async fn done(&self) {
        let mut receiver = self.inner.done.subscribe();
        let _ = receiver.wait_for(|done| *done).await;
    }

    /// Closes the stream once; every pending read and write ends.
    pub(crate) fn dispose(&self) {
        if self.inner.disposed.swap(true, Ordering::AcqRel) {
            return;
        }
        self.inner.done.send_replace(true);
        let inner = Arc::clone(&self.inner);
        // The halves go once the reads and writes holding them have seen the
        // dispose: the writer's drop sends the FIN.
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                if let Some(mut writer) = inner.send.lock().await.take() {
                    let _ = writer.shutdown().await;
                }
                inner.receive.lock().await.reader.take();
            });
        }
    }

    /// WebSocket.Abort: the stream closes with no close frame.
    pub fn abort(&self) {
        lock(&self.inner.flags).aborted = true;
        self.dispose();
    }

    async fn write_frame(
        &self,
        writer: &mut Option<Writer>,
        opcode: u8,
        payload: &[u8],
    ) -> Result<(), Error> {
        let Some(writer) = writer.as_mut() else {
            return Err(Error::Aborted);
        };
        let mut frame = Vec::with_capacity(10 + payload.len());
        frame.push(0x80 | opcode);
        match payload.len() {
            n if n <= 125 => frame.push(n as u8),
            n if n <= 0xffff => {
                frame.push(126);
                frame.extend_from_slice(&(n as u16).to_be_bytes());
            }
            n => {
                frame.push(127);
                frame.extend_from_slice(&(n as u64).to_be_bytes());
            }
        }
        frame.extend_from_slice(payload);
        let mut done = self.inner.done.subscribe();
        tokio::select! {
            result = writer.write_all(&frame) => result.map_err(|error| Error::Io(error.kind())),
            _ = done.wait_for(|done| *done) => Err(Error::Aborted),
        }
    }

    /// Open or CloseReceived, and not aborted.
    fn valid_send_state(&self) -> bool {
        let flags = lock(&self.inner.flags);
        !flags.sent_close && !flags.aborted
    }

    /// Sends one whole binary message.
    pub async fn send_binary(&self, payload: &[u8]) -> Result<(), Error> {
        let mut writer = self.inner.send.lock().await;
        if !self.valid_send_state() {
            return Err(Error::InvalidState);
        }
        self.write_frame(&mut writer, OP_BINARY, payload).await
    }

    /// CloseOutputAsync: send our close and, if the peer's close already
    /// came, dispose the stream.
    pub async fn close_output(&self, status: u16, reason: &str) -> Result<(), Error> {
        if !self.valid_send_state() {
            return Err(Error::InvalidState);
        }
        self.send_close(status, reason).await?;
        if lock(&self.inner.flags).received_close {
            self.dispose();
        }
        Ok(())
    }

    async fn send_close(&self, status: u16, reason: &str) -> Result<(), Error> {
        let mut payload = status.to_be_bytes().to_vec();
        payload.extend_from_slice(reason.as_bytes());
        {
            let mut writer = self.inner.send.lock().await;
            self.write_frame(&mut writer, OP_CLOSE, &payload).await?;
        }
        lock(&self.inner.flags).sent_close = true;
        Ok(())
    }

    /// CloseWithReceiveErrorAndThrowAsync.
    async fn fail_receive(&self, status: u16, error: Error) -> Error {
        if !lock(&self.inner.flags).sent_close {
            let _ = self.close_output(status, "").await;
        }
        error
    }

    /// Reads into state's buffer until it holds want bytes. Every read with
    /// bytes is where OnDataReceived runs, as EnsureBufferContainsAsync does.
    async fn fill(&self, state: &mut ReceiveState, want: usize) -> Result<(), Error> {
        let mut done = self.inner.done.subscribe();
        while state.buffer.len() - state.start < want {
            if state.start > 0 {
                state.buffer.drain(..state.start);
                state.start = 0;
            }
            let Some(reader) = state.reader.as_mut() else {
                return Err(Error::Aborted);
            };
            let mut chunk = [0u8; 4096];
            let n = tokio::select! {
                result = reader.read(&mut chunk) => result.map_err(|error| Error::Io(error.kind()))?,
                _ = done.wait_for(|done| *done) => return Err(Error::Aborted),
            };
            if n == 0 {
                return Err(Error::PrematureClose);
            }
            state.buffer.extend_from_slice(&chunk[..n]);
            self.on_data_received();
        }
        Ok(())
    }

    async fn read_full(&self, state: &mut ReceiveState, out: &mut [u8]) -> Result<(), Error> {
        self.fill(state, out.len()).await?;
        out.copy_from_slice(&state.buffer[state.start..state.start + out.len()]);
        state.start += out.len();
        Ok(())
    }

    /// Reads 2 bytes, then the mask and extended length a server always
    /// waits for (2 + 4 + 0/2/8, even when the mask bit is clear), then
    /// checks the frame like TryParseMessageHeaderFromReceiveBuffer.
    async fn read_header(&self, state: &mut ReceiveState) -> Result<FrameHeader, Error> {
        let mut buffer = [0u8; 14];
        self.read_full(state, &mut buffer[..2]).await?;
        let mut length = u64::from(buffer[1] & 0x7f);
        let extended = match length {
            126 => 2,
            127 => 8,
            _ => 0,
        };
        self.read_full(state, &mut buffer[2..2 + 4 + extended])
            .await?;
        let fin = buffer[0] & 0x80 != 0;
        let opcode = buffer[0] & 0x0f;
        let reserved = buffer[0] & 0x70 != 0;
        let masked = buffer[1] & 0x80 != 0;
        let mut rest = &buffer[2..];
        match extended {
            2 => {
                length = u64::from(u16::from_be_bytes([rest[0], rest[1]]));
                rest = &rest[2..];
            }
            8 => {
                length = u64::from_be_bytes(rest[..8].try_into().unwrap_or([0; 8]));
                rest = &rest[8..];
            }
            _ => {}
        }
        let mask = [rest[0], rest[1], rest[2], rest[3]];
        // .NET reads the length as an Int64: the top bit set is negative.
        if reserved || length > i64::MAX as u64 || !masked {
            return Err(Error::Protocol);
        }
        match opcode {
            OP_CONTINUATION if state.last.fin => return Err(Error::Protocol),
            OP_TEXT | OP_BINARY if !state.last.fin => return Err(Error::Protocol),
            OP_CLOSE | OP_PING | OP_PONG if length > 125 || !fin => return Err(Error::Protocol),
            OP_CONTINUATION | OP_TEXT | OP_BINARY | OP_CLOSE | OP_PING | OP_PONG => {}
            _ => return Err(Error::Protocol),
        }
        Ok(FrameHeader {
            fin,
            opcode,
            remaining: length,
            mask,
            mask_pos: 0,
            processed: length == 0,
        })
    }

    /// ReceiveAsync: at most buf.len() bytes of the current data frame, never
    /// across a frame. It waits until it has min(buf.len(), bytes left in the
    /// frame); an empty frame is one receive of 0. Pings, pongs and the
    /// peer's close are handled inside. Returns (n, type, end of message).
    pub async fn receive(&self, buf: &mut [u8]) -> Result<(usize, MessageType, bool), Error> {
        let mut guard = self.inner.receive.lock().await;
        let state = &mut *guard;
        loop {
            let mut header = state.last;
            if header.processed {
                header = match self.read_header(state).await {
                    Ok(header) => header,
                    Err(Error::Protocol) => {
                        return Err(self
                            .fail_receive(STATUS_PROTOCOL_ERROR, Error::Protocol)
                            .await);
                    }
                    Err(error) => return Err(self.gone(error)),
                };
                match header.opcode {
                    OP_PING | OP_PONG => {
                        if let Err(error) = self.handle_ping_pong(state, header).await {
                            return Err(self.gone(error));
                        }
                        continue;
                    }
                    OP_CLOSE => {
                        self.handle_close(state, header).await?;
                        return Ok((0, MessageType::Close, true));
                    }
                    OP_CONTINUATION => header.opcode = state.last.opcode,
                    _ => {}
                }
            }
            let message_type = if header.opcode == OP_TEXT {
                MessageType::Text
            } else {
                MessageType::Binary
            };
            let mut n = 0;
            if !header.processed && !buf.is_empty() {
                let want = (buf.len() as u64).min(header.remaining) as usize;
                if let Err(error) = self.read_full(state, &mut buf[..want]).await {
                    return Err(self.gone(error));
                }
                header.unmask(&mut buf[..want]);
                header.remaining -= want as u64;
                header.processed = header.remaining == 0;
                n = want;
            }
            let end_of_message = header.fin && header.processed;
            state.last = header;
            if message_type == MessageType::Text && !state.utf8.valid(&buf[..n], end_of_message) {
                return Err(self
                    .fail_receive(STATUS_INVALID_PAYLOAD, Error::Protocol)
                    .await);
            }
            return Ok((n, message_type, end_of_message));
        }
    }

    /// A read error after an abort or a keep-alive fault, as the error that
    /// names it.
    fn gone(&self, error: Error) -> Error {
        match lock(&self.inner.keep_alive).as_ref().and_then(|k| k.fault) {
            Some(fault) => fault,
            None => error,
        }
    }

    async fn handle_ping_pong(
        &self,
        state: &mut ReceiveState,
        mut header: FrameHeader,
    ) -> Result<(), Error> {
        let mut payload = vec![0u8; header.remaining as usize];
        self.read_full(state, &mut payload).await?;
        header.unmask(&mut payload);
        if header.opcode == OP_PING {
            let mut writer = self.inner.send.lock().await;
            return self.write_frame(&mut writer, OP_PONG, &payload).await;
        }
        if let Ok(counter) = <[u8; 8]>::try_from(payload.as_slice()) {
            self.on_pong(i64::from_be_bytes(counter));
        }
        Ok(())
    }

    async fn handle_close(
        &self,
        state: &mut ReceiveState,
        mut header: FrameHeader,
    ) -> Result<(), Error> {
        {
            let mut flags = lock(&self.inner.flags);
            flags.received_close = true;
            flags.close_status = STATUS_NORMAL;
            flags.close_description.clear();
        }
        match header.remaining {
            0 => Ok(()),
            1 => Err(self
                .fail_receive(STATUS_PROTOCOL_ERROR, Error::Protocol)
                .await),
            length => {
                let mut payload = vec![0u8; length as usize];
                if let Err(error) = self.read_full(state, &mut payload).await {
                    return Err(self.gone(error));
                }
                header.unmask(&mut payload);
                let status = u16::from_be_bytes([payload[0], payload[1]]);
                if !valid_close_status(status) {
                    return Err(self
                        .fail_receive(STATUS_PROTOCOL_ERROR, Error::Protocol)
                        .await);
                }
                let Ok(reason) = std::str::from_utf8(&payload[2..]) else {
                    return Err(self
                        .fail_receive(STATUS_PROTOCOL_ERROR, Error::Protocol)
                        .await);
                };
                let mut flags = lock(&self.inner.flags);
                flags.close_status = status;
                flags.close_description = reason.to_owned();
                Ok(())
            }
        }
    }
}

/// IsValidCloseStatus: 1000-1003, 1007-1014, 3000-4999.
fn valid_close_status(status: u16) -> bool {
    match status {
        ..1000 | 5000.. => false,
        3000.. => true,
        _ => status <= 1003 || (1007..=1014).contains(&status),
    }
}

/// Utf8MessageState: text is checked across receives.
#[derive(Default)]
struct Utf8State {
    in_progress: bool,
    expected: u32,
    bits: u32,
    minimum: u32,
}

impl Utf8State {
    /// TryValidateUtf8, ported as is.
    fn valid(&mut self, span: &[u8], end_of_message: bool) -> bool {
        if end_of_message && !self.in_progress {
            return std::str::from_utf8(span).is_ok();
        }
        let mut i = 0;
        while i < span.len() {
            if !self.in_progress {
                while i < span.len() && span[i] < 0x80 {
                    i += 1;
                }
                if i == span.len() {
                    break;
                }
                self.in_progress = true;
                let b = span[i];
                i += 1;
                if b & 0xc0 == 0x80 {
                    return false;
                } else if b & 0xe0 == 0xc0 {
                    (self.expected, self.bits, self.minimum) = (1, u32::from(b & 0x1f), 0x80);
                } else if b & 0xf0 == 0xe0 {
                    (self.expected, self.bits, self.minimum) = (2, u32::from(b & 0x0f), 0x800);
                } else if b & 0xf8 == 0xf0 {
                    (self.expected, self.bits, self.minimum) = (3, u32::from(b & 0x07), 0x10000);
                } else {
                    return false;
                }
            }
            while self.expected > 0 && i < span.len() {
                let b = span[i];
                if b & 0xc0 != 0x80 {
                    return false;
                }
                i += 1;
                self.expected -= 1;
                self.bits = self.bits << 6 | u32::from(b & 0x3f);
                if self.expected == 1 && (864..=895).contains(&self.bits) {
                    return false;
                }
                if self.expected == 2 && self.bits >= 272 {
                    return false;
                }
            }
            if self.expected == 0 {
                self.in_progress = false;
                if self.bits < self.minimum {
                    return false;
                }
            }
        }
        if end_of_message {
            return !self.in_progress;
        }
        true
    }
}

#[cfg(test)]
mod fuzz_test;
#[cfg(test)]
mod ws_test;

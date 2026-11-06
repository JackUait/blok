//! The client side of RFC 6455, for the sync room: crates/ws is the server
//! side only. The connection is dialled by the operator client (outbound.rs),
//! so proxy and TLS behave like every other operator call.

use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use blok_outbound::operator::Stream;
use ring::rand::{SecureRandom, SystemRandom};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader, ReadHalf, WriteHalf};
use tokio::sync::mpsc;

use crate::outbound::Outbound;

const ACCEPT_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
// The `ws` library's default maxPayload.
const MAX_PAYLOAD: u64 = 100 << 20;
// How long a client close waits for the server's answering close.
const CLOSE_WAIT: Duration = Duration::from_secs(2);
/// No close frame arrived: the connection dropped.
pub const CLOSE_ABNORMAL: u16 = 1006;

type Reader = ReadHalf<BufReader<Box<dyn Stream>>>;
type Writer = WriteHalf<BufReader<Box<dyn Stream>>>;

/// Why a connect did not give a socket.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refused {
    /// The server answered the upgrade with this status.
    Status(u16),
    /// No answer, a bad accept key, or a subprotocol nobody offered.
    Failed,
}

/// What the reader task reports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Binary(Vec<u8>),
    Ping(Vec<u8>),
    /// The server's close code, or 1006 when the connection just ended.
    Closed(u16),
}

pub struct Socket {
    pub protocol: String,
    // A Mutex makes the socket Sync, so the room's futures are Send.
    writer: tokio::sync::Mutex<Writer>,
    random: SystemRandom,
}

/// ws(s) URL to the http(s) URL the upgrade request goes to.
pub fn http_url(url: &str) -> String {
    match url.split_once("://") {
        Some((scheme, rest)) if scheme.eq_ignore_ascii_case("wss") => format!("https://{rest}"),
        Some((scheme, rest)) if scheme.eq_ignore_ascii_case("ws") => format!("http://{rest}"),
        _ => url.to_owned(),
    }
}

/// The Sec-WebSocket-Accept a server must answer `key` with.
pub fn accept_for(key: &str) -> String {
    let digest = ring::digest::digest(
        &ring::digest::SHA1_FOR_LEGACY_USE_ONLY,
        format!("{key}{ACCEPT_GUID}").as_bytes(),
    );
    STANDARD.encode(digest.as_ref())
}

fn header_text(headers: &blok_outbound::wire::Headers, name: &str) -> Option<String> {
    headers
        .get(name)
        .map(|v| String::from_utf8_lossy(v).trim().to_owned())
}

/// Opens the socket. `protocols` are offered in order; the server must pick
/// one of them, as Node's `ws` requires.
pub async fn connect(
    outbound: &Outbound,
    url: &str,
    protocols: &[String],
    origin: Option<&str>,
    timeout: Duration,
) -> Result<(Socket, mpsc::UnboundedReceiver<Event>), Refused> {
    let random = SystemRandom::new();
    let mut key = [0u8; 16];
    random.fill(&mut key).map_err(|_| Refused::Failed)?;
    let key = STANDARD.encode(key);
    let mut headers = vec![
        ("Connection".to_owned(), "Upgrade".to_owned()),
        ("Upgrade".to_owned(), "websocket".to_owned()),
        ("Sec-WebSocket-Version".to_owned(), "13".to_owned()),
        ("Sec-WebSocket-Key".to_owned(), key.clone()),
        ("Sec-WebSocket-Protocol".to_owned(), protocols.join(",")),
    ];
    if let Some(origin) = origin {
        headers.push(("Origin".to_owned(), origin.to_owned()));
    }
    let upgraded = outbound
        .upgrade(&http_url(url), headers, timeout)
        .await
        .map_err(|_| Refused::Failed)?;
    if upgraded.status != 101 {
        return Err(Refused::Status(upgraded.status));
    }
    if header_text(&upgraded.headers, "Sec-WebSocket-Accept").as_deref()
        != Some(accept_for(&key).as_str())
    {
        return Err(Refused::Failed);
    }
    let protocol = header_text(&upgraded.headers, "Sec-WebSocket-Protocol").unwrap_or_default();
    if !protocols.contains(&protocol) {
        return Err(Refused::Failed);
    }
    let (reader, writer) = tokio::io::split(upgraded.stream);
    let (events, received) = mpsc::unbounded_channel();
    tokio::spawn(read_frames(reader, events));
    Ok((
        Socket {
            protocol,
            writer: tokio::sync::Mutex::new(writer),
            random,
        },
        received,
    ))
}

async fn read_frames(mut reader: Reader, events: mpsc::UnboundedSender<Event>) {
    let code = read_loop(&mut reader, &events)
        .await
        .unwrap_or(CLOSE_ABNORMAL);
    let _ = events.send(Event::Closed(code));
}

/// Ok(code) on a close frame; Err on a dropped connection or a frame the
/// `ws` receiver refuses (RFC 6455 §5).
async fn read_loop<R: AsyncRead + Unpin>(
    reader: &mut R,
    events: &mpsc::UnboundedSender<Event>,
) -> Result<u16, ()> {
    let mut message: Vec<u8> = Vec::new();
    // The opcode of the fragmented message in progress.
    let mut fragmented: Option<u8> = None;
    loop {
        let mut head = [0u8; 2];
        reader.read_exact(&mut head).await.map_err(|_| ())?;
        let fin = head[0] & 0x80 != 0;
        let opcode = head[0] & 0x0f;
        // A server must not mask, and no extension was negotiated.
        if head[1] & 0x80 != 0 || head[0] & 0x70 != 0 {
            return Err(());
        }
        let length = match head[1] & 0x7f {
            126 => u64::from(reader.read_u16().await.map_err(|_| ())?),
            127 => reader.read_u64().await.map_err(|_| ())?,
            n => u64::from(n),
        };
        match opcode {
            0 if fragmented.is_none() => return Err(()),
            1 | 2 if fragmented.is_some() => return Err(()),
            0..=2 => {
                // The cap counts the whole message, as `ws` counts it.
                if message.len() as u64 + length > MAX_PAYLOAD {
                    return Err(());
                }
            }
            8..=10 => {
                if !fin || length > 125 || (opcode == 8 && length == 1) {
                    return Err(());
                }
            }
            _ => return Err(()),
        }
        let mut payload = vec![0u8; length as usize];
        reader.read_exact(&mut payload).await.map_err(|_| ())?;
        match opcode {
            0..=2 => {
                let kind = fragmented.unwrap_or(opcode);
                message.extend_from_slice(&payload);
                if !fin {
                    fragmented = Some(kind);
                    continue;
                }
                fragmented = None;
                let done = std::mem::take(&mut message);
                if kind == 2 && events.send(Event::Binary(done)).is_err() {
                    return Ok(1000);
                }
            }
            8 => {
                let code = if payload.len() >= 2 {
                    u16::from_be_bytes([payload[0], payload[1]])
                } else {
                    1005
                };
                return Ok(code);
            }
            9 => {
                let _ = events.send(Event::Ping(payload));
            }
            _ => {}
        }
    }
}

impl Socket {
    async fn frame(&mut self, opcode: u8, payload: &[u8]) -> std::io::Result<()> {
        let mut mask = [0u8; 4];
        let _ = self.random.fill(&mut mask);
        let mut out = Vec::with_capacity(payload.len() + 14);
        out.push(0x80 | opcode);
        match payload.len() {
            n if n < 126 => out.push(0x80 | n as u8),
            n if n <= 0xffff => {
                out.push(0x80 | 126);
                out.extend_from_slice(&(n as u16).to_be_bytes());
            }
            n => {
                out.push(0x80 | 127);
                out.extend_from_slice(&(n as u64).to_be_bytes());
            }
        }
        out.extend_from_slice(&mask);
        out.extend(payload.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]));
        let writer = self.writer.get_mut();
        writer.write_all(&out).await?;
        writer.flush().await
    }

    pub async fn send(&mut self, payload: &[u8]) -> std::io::Result<()> {
        self.frame(2, payload).await
    }

    pub async fn pong(&mut self, payload: &[u8]) -> std::io::Result<()> {
        self.frame(10, payload).await
    }

    /// Sends a close frame with `code`, waits briefly for the server's
    /// answering close (the closing handshake `ws` runs), then ends the
    /// connection. Pass None when the server already closed.
    pub async fn close(mut self, code: u16, events: Option<mpsc::UnboundedReceiver<Event>>) {
        let _ = self.frame(8, &code.to_be_bytes()).await;
        if let Some(mut events) = events {
            let _ = tokio::time::timeout(CLOSE_WAIT, async {
                while let Some(event) = events.recv().await {
                    if matches!(event, Event::Closed(_)) {
                        return;
                    }
                }
            })
            .await;
        }
        let _ = self.writer.get_mut().shutdown().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_the_rfc_6455_accept_key() {
        // RFC 6455 §1.3's worked example.
        assert_eq!(
            accept_for("dGhlIHNhbXBsZSBub25jZQ=="),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        );
    }

    fn frame(fin: bool, opcode: u8, payload: &[u8]) -> Vec<u8> {
        let mut out = vec![if fin { 0x80 } else { 0 } | opcode];
        match payload.len() {
            n if n < 126 => out.push(n as u8),
            n if n <= 0xffff => {
                out.push(126);
                out.extend_from_slice(&(n as u16).to_be_bytes());
            }
            n => {
                out.push(127);
                out.extend_from_slice(&(n as u64).to_be_bytes());
            }
        }
        out.extend_from_slice(payload);
        out
    }

    async fn read_all(bytes: Vec<u8>) -> (Result<u16, ()>, Vec<Event>) {
        let (events, mut received) = mpsc::unbounded_channel();
        let ended = read_loop(&mut std::io::Cursor::new(bytes), &events).await;
        drop(events);
        let mut seen = Vec::new();
        while let Some(event) = received.recv().await {
            seen.push(event);
        }
        (ended, seen)
    }

    #[tokio::test]
    async fn joins_fragments_and_hands_on_binary_only() {
        let mut bytes = frame(false, 2, b"ab");
        bytes.extend(frame(true, 9, b"p"));
        bytes.extend(frame(true, 0, b"cd"));
        bytes.extend(frame(false, 1, b"text"));
        bytes.extend(frame(true, 0, b"!"));
        bytes.extend(frame(true, 8, &1000u16.to_be_bytes()));
        let (ended, events) = read_all(bytes).await;
        assert_eq!(ended, Ok(1000));
        assert_eq!(
            events,
            vec![Event::Ping(b"p".to_vec()), Event::Binary(b"abcd".to_vec())]
        );
    }

    #[tokio::test]
    async fn refuses_frames_ws_refuses() {
        let cases: Vec<Vec<u8>> = vec![
            frame(true, 0, b"x"),
            [frame(false, 2, b"a"), frame(true, 2, b"b")].concat(),
            frame(false, 9, b"p"),
            frame(true, 9, &[0u8; 126]),
            frame(true, 8, &[3]),
            frame(true, 3, b""),
        ];
        for bytes in cases {
            assert_eq!(read_all(bytes.clone()).await.0, Err(()), "{bytes:?}");
        }
    }

    #[tokio::test]
    async fn caps_the_whole_message_not_each_fragment() {
        // Each frame is under the cap; together they pass it by one byte. The
        // second header is refused before its payload is read.
        let mut second = vec![0x80u8, 127];
        second.extend_from_slice(&(MAX_PAYLOAD - 9).to_be_bytes());
        let bytes = [frame(false, 2, &[0u8; 10]), second].concat();
        assert_eq!(read_all(bytes).await.0, Err(()));
    }

    #[test]
    fn maps_ws_urls_to_http() {
        assert_eq!(http_url("ws://h:1/sync/d"), "http://h:1/sync/d");
        assert_eq!(http_url("WSS://h/sync"), "https://h/sync");
    }
}

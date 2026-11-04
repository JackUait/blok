//! What the ported tests share (Go keeps it in member_test.go and
//! endpoint_test.go).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_collab::{BoxFuture, Error, Membership};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::net::{TcpListener, TcpStream};

use crate::CloseFrame;

/// Counts frames and records whether leave ran.
#[derive(Default)]
pub(crate) struct RecordingMembership {
    pub frames: Mutex<Vec<Vec<u8>>>,
    pub left: AtomicBool,
}

impl RecordingMembership {
    pub fn has_left(&self) -> bool {
        self.left.load(Ordering::Acquire)
    }
}

/// The handle a room hands out, onto a membership the test keeps.
pub(crate) struct SharedMembership(pub Arc<RecordingMembership>);

impl Membership for SharedMembership {
    fn receive(&self, frame: Vec<u8>) -> BoxFuture<'_, Result<(), Error>> {
        self.0.frames.lock().unwrap().push(frame);
        Box::pin(async { Ok(()) })
    }

    fn leave(&self) {
        self.0.left.store(true, Ordering::Release);
    }
}

/// A served ws Conn and the raw client end over loopback.
pub(crate) async fn ws_pair() -> (blok_ws::Conn, TcpStream) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (client, accepted) = tokio::join!(TcpStream::connect(address), listener.accept());
    let (read, write) = accepted.unwrap().0.into_split();
    let server = blok_ws::Conn::new(read, write, Vec::new(), blok_ws::Options::default());
    (server, client.unwrap())
}

/// A client frame with a zero mask; first is the byte with FIN and opcode.
pub(crate) fn client_frame(first: u8, payload: &[u8]) -> Vec<u8> {
    let mut b = vec![first];
    match payload.len() {
        n if n <= 125 => b.push(0x80 | n as u8),
        n if n <= 0xffff => {
            b.push(0x80 | 126);
            b.extend_from_slice(&(n as u16).to_be_bytes());
        }
        n => {
            b.push(0x80 | 127);
            b.extend_from_slice(&(n as u64).to_be_bytes());
        }
    }
    b.extend_from_slice(&[0, 0, 0, 0]);
    b.extend_from_slice(payload);
    b
}

#[derive(Debug)]
pub(crate) struct ServerFrame {
    pub opcode: u8,
    pub payload: Vec<u8>,
}

pub(crate) async fn read_server_frame(r: &mut (impl AsyncRead + Unpin)) -> ServerFrame {
    tokio::time::timeout(Duration::from_secs(30), async {
        let mut head = [0u8; 2];
        r.read_exact(&mut head).await.expect("reading a frame");
        let mut length = u64::from(head[1] & 0x7f);
        if length == 126 {
            let mut ext = [0u8; 2];
            r.read_exact(&mut ext).await.unwrap();
            length = u64::from(u16::from_be_bytes(ext));
        } else if length == 127 {
            let mut ext = [0u8; 8];
            r.read_exact(&mut ext).await.unwrap();
            length = u64::from_be_bytes(ext);
        }
        let mut payload = vec![0u8; length as usize];
        r.read_exact(&mut payload).await.unwrap();
        ServerFrame {
            opcode: head[0] & 0x0f,
            payload,
        }
    })
    .await
    .expect("no server frame in time")
}

/// A close as read off the wire.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WireClose {
    pub status: u16,
    pub reason: String,
}

impl PartialEq<CloseFrame> for WireClose {
    fn eq(&self, other: &CloseFrame) -> bool {
        self.status == other.status && self.reason == other.reason
    }
}

pub(crate) fn wire_close(payload: &[u8]) -> WireClose {
    WireClose {
        status: u16::from_be_bytes([payload[0], payload[1]]),
        reason: String::from_utf8(payload[2..].to_vec()).unwrap(),
    }
}

pub(crate) async fn read_close(r: &mut (impl AsyncRead + Unpin)) -> WireClose {
    loop {
        let frame = read_server_frame(r).await;
        if frame.opcode == 0x8 {
            return wire_close(&frame.payload);
        }
    }
}

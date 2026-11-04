//! What one request shares between its handler and its connection.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use tokio::io::AsyncWriteExt;
use tokio::net::tcp::OwnedWriteHalf;
use tokio::sync::{Notify, watch};
use tokio::time::Instant;

use crate::Config;
use crate::body::BodyState;
use crate::head::Version;
use crate::headers::Headers;
use crate::inbound::Inbound;
use crate::server::ActiveGuard;
use crate::wire::{http_date, reason_phrase};

/// How the response body is framed once its head went out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Framing {
    /// No body may follow: HEAD, 1xx, 204, 304.
    None,
    Length(u64),
    Chunked,
    /// HTTP/1.0 with no length: the close ends the body.
    Close,
}

/// The socket's write side and what has gone out on it.
pub(crate) struct Wire {
    pub write: Option<OwnedWriteHalf>,
    pub started: bool,
    pub framing: Framing,
    /// The host owns the answer (a deadline, or a refused body): handler
    /// writes are dropped.
    pub host_owned: bool,
    /// A deadline passed before the handler answered: 504 once it returns.
    pub pending_timeout: bool,
    pub finished: bool,
    pub close: bool,
    pub hijacked: bool,
}

impl Wire {
    pub async fn send(&mut self, bytes: &[u8]) -> std::io::Result<()> {
        match self.write.as_mut() {
            Some(write) => write.write_all(bytes).await,
            None => Err(std::io::ErrorKind::NotConnected.into()),
        }
    }
}

#[derive(Default)]
pub(crate) struct Deadline {
    pub lifted: bool,
    pub expired: bool,
    /// Body reads end here; a lifted request with a body keeps it.
    pub body: Option<Instant>,
}

pub(crate) struct Exchange {
    pub config: Arc<Config>,
    pub inbound: Arc<Inbound>,
    pub wire: tokio::sync::Mutex<Wire>,
    pub body: tokio::sync::Mutex<BodyState>,
    pub limits: Mutex<crate::body::Limits>,
    pub deadline: Mutex<Deadline>,
    pub deadline_changed: Notify,
    pub hijacked: Notify,
    pub cancel: watch::Sender<bool>,
    /// What a handler that never answered left in its writer.
    pub left: Mutex<Option<(u16, Headers)>>,
    pub active: Mutex<Option<ActiveGuard>>,
    pub method_head: bool,
    pub version: Version,
    /// The request asked for the connection to end after it.
    pub request_close: bool,
    /// HTTP/1.0 with "Connection: keep-alive".
    pub keep_alive_10: bool,
    pub expects_continue: bool,
    pub stopping: Arc<AtomicBool>,
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}

impl Exchange {
    pub fn cancel(&self) {
        self.cancel.send_replace(true);
    }

    pub fn stopping(&self) -> bool {
        self.stopping.load(Ordering::Relaxed)
    }

    /// The body deadline, if any.
    pub fn body_deadline(&self) -> Option<Instant> {
        lock(&self.deadline).body
    }

    /// Kestrel's bare answer straight onto the wire, unless an answer
    /// already started. The connection closes after it either way.
    pub async fn refuse(&self, status: u16) {
        let mut wire = self.wire.lock().await;
        wire.close = true;
        if wire.started || wire.hijacked || wire.finished {
            return;
        }
        wire.started = true;
        wire.host_owned = true;
        let answer = bare_answer(&self.config, Answer::Status(status));
        let _ = wire.send(&answer).await;
    }
}

impl Exchange {
    /// What an exception the app does not catch gets: an empty 500 with no
    /// Connection header, then the close.
    pub async fn refuse_unhandled(&self) {
        let mut wire = self.wire.lock().await;
        wire.close = true;
        if wire.started || wire.hijacked || wire.finished {
            return;
        }
        wire.started = true;
        wire.host_owned = true;
        let mut head = format!(
            "HTTP/1.1 500 {}\r\nContent-Length: 0\r\nDate: {}\r\n",
            reason_phrase(500),
            http_date(std::time::SystemTime::now())
        );
        if let Some(server) = &self.config.server_header {
            head.push_str(&format!("Server: {server}\r\n"));
        }
        head.push_str("\r\n");
        let _ = wire.send(head.as_bytes()).await;
    }
}

/// A refusal Kestrel answers itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Answer {
    Status(u16),
    GoAway,
    MethodNotAllowed(&'static str),
}

/// Kestrel's bare refusal: no body, and the connection closes.
pub(crate) fn bare_answer(config: &Config, answer: Answer) -> Vec<u8> {
    let (status, allow) = match answer {
        // An HTTP/2 GOAWAY frame: stream 0, last stream 0, HTTP_1_1_REQUIRED.
        Answer::GoAway => {
            return b"\x00\x00\x08\x07\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x0d"
                .to_vec();
        }
        Answer::Status(status) => (status, None),
        Answer::MethodNotAllowed(allow) => (405, Some(allow)),
    };
    let mut head = format!(
        "HTTP/1.1 {status} {}\r\nContent-Length: 0\r\nConnection: close\r\nDate: {}\r\n",
        reason_phrase(status),
        http_date(std::time::SystemTime::now())
    );
    if let Some(server) = &config.server_header {
        head.push_str(&format!("Server: {server}\r\n"));
    }
    if let Some(allow) = allow {
        head.push_str(&format!("Allow: {allow}\r\n"));
    }
    head.push_str("\r\n");
    head.into_bytes()
}

/// How long a closing connection keeps reading so the peer gets the answer
/// before a reset: closing with unread bytes sends RST. net/http waits the
/// same 500 ms.
pub(crate) const RST_AVOIDANCE: Duration = Duration::from_millis(500);

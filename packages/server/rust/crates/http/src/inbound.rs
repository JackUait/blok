//! The read side of one connection: a reader task fills a shared buffer, and
//! the head parser, the body and the hijacker take from it.
//!
//! The task keeps reading while a handler runs (up to a cap), as Kestrel
//! does, so a peer that goes away is seen at once and the request is
//! cancelled.

use std::io;
use std::sync::{Arc, Mutex, MutexGuard};

use tokio::io::AsyncReadExt;
use tokio::net::tcp::OwnedReadHalf;
use tokio::sync::{Notify, oneshot};

/// Unread bytes past this pause the reader. It holds a head at Kestrel's
/// limits (8 KiB line + 32 KiB block) with room to spare.
const CAP: usize = 64 << 10;
const READ_SIZE: usize = 16 << 10;

#[derive(Default)]
pub(crate) struct State {
    pub buf: Vec<u8>,
    pub eof: bool,
    pub error: Option<io::ErrorKind>,
    stop: bool,
}

impl State {
    /// The peer is gone or the socket failed: no more bytes will come.
    pub fn ended(&self) -> bool {
        self.eof || self.error.is_some()
    }

    pub fn consume(&mut self, n: usize) {
        self.buf.drain(..n);
        // A big head's buffer is not kept by an idle connection.
        if self.buf.is_empty() && self.buf.capacity() > READ_SIZE * 2 {
            self.buf = Vec::new();
        }
    }
}

pub(crate) struct Inbound {
    state: Mutex<State>,
    /// New bytes, the end, or an error.
    data: Notify,
    /// Room in the buffer, or a stop.
    room: Notify,
    returned: Mutex<Option<oneshot::Receiver<OwnedReadHalf>>>,
}

impl Inbound {
    /// Starts the reader task on read.
    pub fn start(read: OwnedReadHalf) -> Arc<Self> {
        let (give_back, returned) = oneshot::channel();
        let inbound = Arc::new(Self {
            state: Mutex::new(State::default()),
            data: Notify::new(),
            room: Notify::new(),
            returned: Mutex::new(Some(returned)),
        });
        tokio::spawn(run(Arc::clone(&inbound), read, give_back));
        inbound
    }

    pub fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    /// Takes bytes out: wakes the reader if it paused at the cap.
    pub fn consume(&self, n: usize) {
        self.lock().consume(n);
        self.room.notify_one();
    }

    /// Waits until check holds; it is called with the state locked.
    pub async fn wait_until(&self, mut check: impl FnMut(&mut State) -> bool) {
        loop {
            let notified = self.data.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if check(&mut self.lock()) {
                return;
            }
            notified.await;
        }
    }

    /// Waits for more bytes than `have`, or the end.
    pub async fn wait_for_more(&self, have: usize) {
        self.wait_until(|state| state.buf.len() > have || state.ended())
            .await;
    }

    /// Stops the reader and returns its half and every unread byte.
    pub async fn stop(&self) -> Option<(OwnedReadHalf, Vec<u8>)> {
        let returned = self
            .returned
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .take()?;
        self.lock().stop = true;
        self.room.notify_one();
        let read = returned.await.ok()?;
        let bytes = std::mem::take(&mut self.lock().buf);
        Some((read, bytes))
    }
}

async fn run(
    inbound: Arc<Inbound>,
    mut read: OwnedReadHalf,
    give_back: oneshot::Sender<OwnedReadHalf>,
) {
    let mut chunk = vec![0u8; READ_SIZE];
    loop {
        // Wait for room, or a stop.
        loop {
            let notified = inbound.room.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            {
                let state = inbound.lock();
                if state.stop {
                    let _ = give_back.send(read);
                    return;
                }
                if state.buf.len() < CAP && !state.ended() {
                    break;
                }
            }
            notified.await;
        }
        // A pending read is dropped at a stop; no bytes are lost by that.
        let result = tokio::select! {
            result = read.read(&mut chunk) => result,
            () = stopped(&inbound) => continue,
        };
        {
            let mut state = inbound.lock();
            match result {
                Ok(0) => state.eof = true,
                Ok(n) => state.buf.extend_from_slice(&chunk[..n]),
                Err(error) => state.error = Some(error.kind()),
            }
        }
        inbound.data.notify_waiters();
    }
}

async fn stopped(inbound: &Inbound) {
    loop {
        let notified = inbound.room.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        if inbound.lock().stop {
            return;
        }
        notified.await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // An idle keep-alive connection must not hold on to the buffer of a big
    // head it already handed on.
    #[test]
    fn an_idle_stream_drops_a_big_heads_buffers() {
        let mut state = State::default();
        state.buf.extend_from_slice(&vec![b'v'; 40 << 10]);
        state.consume(state.buf.len());
        assert_eq!(state.buf.capacity(), 0);
        state.buf.extend_from_slice(b"GET / HTTP/1.1\r\n");
        state.consume(6);
        assert_eq!(state.buf, b"HTTP/1.1\r\n");
    }
}

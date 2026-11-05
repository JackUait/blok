//! Reads the socket in the background, as Kestrel's transport does, so the
//! peer's FIN or RST is seen while nothing is being received.

use std::collections::VecDeque;
use std::io;
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard};
use std::task::{Context, Poll, Waker};

use tokio::io::{AsyncRead, AsyncReadExt, ReadBuf};
use tokio::sync::{Notify, watch};

/// Kestrel's SocketTransportOptions.MaxReadBufferSize default: the most
/// unconsumed bytes its transport buffers, upgraded or not (measured).
pub(crate) const LIMIT: usize = 1 << 20;
const CHUNK: usize = 16 * 1024;

#[derive(Default)]
struct State {
    buf: VecDeque<u8>,
    /// How the socket ended: Ok for a FIN, else the error's kind.
    ended: Option<Result<(), io::ErrorKind>>,
    reader: Option<Waker>,
}

#[derive(Default)]
pub(crate) struct Shared {
    state: Mutex<State>,
    space: Notify,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    pub(crate) fn buffered(&self) -> usize {
        self.lock().buf.len()
    }

    #[cfg(test)]
    pub(crate) fn capacity(&self) -> usize {
        self.lock().buf.capacity()
    }

    fn end(&self, how: Result<(), io::ErrorKind>) {
        let mut state = self.lock();
        state.ended = Some(how);
        if let Some(waker) = state.reader.take() {
            waker.wake();
        }
    }
}

pub(crate) struct ReadAhead(Arc<Shared>);

impl ReadAhead {
    /// Spawns the reader. gone turns true when the peer ended the socket;
    /// a dispose (done) stops the reader without setting it.
    pub(crate) fn spawn(
        mut source: impl AsyncRead + Send + Unpin + 'static,
        mut done: watch::Receiver<bool>,
        gone: watch::Sender<bool>,
    ) -> (Self, Arc<Shared>) {
        let shared = Arc::new(Shared::default());
        let task = Arc::clone(&shared);
        tokio::spawn(async move {
            let mut chunk = vec![0u8; CHUNK];
            loop {
                let room = loop {
                    let space = task.space.notified();
                    let room = LIMIT - task.buffered();
                    if room > 0 {
                        break room;
                    }
                    tokio::select! {
                        () = space => {}
                        _ = done.wait_for(|done| *done) => {
                            task.end(Err(io::ErrorKind::NotConnected));
                            return;
                        }
                    }
                };
                let read = tokio::select! {
                    read = source.read(&mut chunk[..room.min(CHUNK)]) => read,
                    _ = done.wait_for(|done| *done) => {
                        task.end(Err(io::ErrorKind::NotConnected));
                        return;
                    }
                };
                let how = match read {
                    Ok(0) => Ok(()),
                    Ok(n) => {
                        let mut state = task.lock();
                        // Grow by hand: extend's doubling would pass LIMIT.
                        let (len, capacity) = (state.buf.len(), state.buf.capacity());
                        if len + n > capacity {
                            let target = (len + n).max(LIMIT.min(capacity * 2));
                            state.buf.reserve_exact(target - len);
                        }
                        state.buf.extend(&chunk[..n]);
                        if let Some(waker) = state.reader.take() {
                            waker.wake();
                        }
                        continue;
                    }
                    Err(error) => Err(error.kind()),
                };
                if !*done.borrow() {
                    gone.send_replace(true);
                }
                task.end(how);
                return;
            }
        });
        (Self(Arc::clone(&shared)), shared)
    }
}

impl AsyncRead for ReadAhead {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let mut state = self.0.lock();
        if !state.buf.is_empty() {
            let n = buf.remaining().min(state.buf.len());
            let (front, back) = state.buf.as_slices();
            let first = n.min(front.len());
            buf.put_slice(&front[..first]);
            buf.put_slice(&back[..n - first]);
            state.buf.drain(..n);
            if state.buf.is_empty() && state.buf.capacity() > CHUNK {
                state.buf = VecDeque::new();
            }
            drop(state);
            self.0.space.notify_one();
            return Poll::Ready(Ok(()));
        }
        match state.ended {
            Some(Ok(())) => Poll::Ready(Ok(())),
            Some(Err(kind)) => Poll::Ready(Err(kind.into())),
            None => {
                state.reader = Some(cx.waker().clone());
                Poll::Pending
            }
        }
    }
}

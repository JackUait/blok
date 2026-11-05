//! Reads the socket in the background, as Kestrel's transport does, so the
//! peer's FIN or RST is seen while nothing is being received.

use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};

use tokio::io::{AsyncRead, AsyncReadExt, ReadBuf};
use tokio::sync::{mpsc, watch};

/// 64 chunks of 16 KiB: Kestrel's default MaxRequestBufferSize (1 MiB).
/// Unverified that Kestrel still applies it after the upgrade.
const CHUNK: usize = 16 * 1024;
const CHUNKS: usize = 64;

pub(crate) struct ReadAhead {
    chunks: mpsc::Receiver<io::Result<Vec<u8>>>,
    current: Vec<u8>,
    start: usize,
    /// The error that ended the socket, served again on every later read.
    failed: Option<io::ErrorKind>,
}

impl ReadAhead {
    /// Spawns the reader. gone turns true when the peer ended the socket;
    /// a dispose (done) stops the reader without setting it.
    pub(crate) fn spawn(
        mut source: impl AsyncRead + Send + Unpin + 'static,
        mut done: watch::Receiver<bool>,
        gone: watch::Sender<bool>,
    ) -> Self {
        let (sender, chunks) = mpsc::channel(CHUNKS);
        tokio::spawn(async move {
            loop {
                let mut chunk = vec![0u8; CHUNK];
                let read = tokio::select! {
                    read = source.read(&mut chunk) => read,
                    _ = done.wait_for(|done| *done) => return,
                };
                let ended = !matches!(read, Ok(n) if n > 0);
                if ended && !*done.borrow() {
                    gone.send_replace(true);
                }
                let item = read.map(|n| {
                    chunk.truncate(n);
                    chunk
                });
                if matches!(item, Ok(ref chunk) if chunk.is_empty()) {
                    return;
                }
                tokio::select! {
                    sent = sender.send(item) => if sent.is_err() || ended { return },
                    _ = done.wait_for(|done| *done) => return,
                }
            }
        });
        Self {
            chunks,
            current: Vec::new(),
            start: 0,
            failed: None,
        }
    }
}

impl AsyncRead for ReadAhead {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = &mut *self;
        loop {
            if this.start < this.current.len() {
                let n = buf.remaining().min(this.current.len() - this.start);
                buf.put_slice(&this.current[this.start..this.start + n]);
                this.start += n;
                return Poll::Ready(Ok(()));
            }
            if let Some(kind) = this.failed {
                return Poll::Ready(Err(kind.into()));
            }
            match this.chunks.poll_recv(cx) {
                Poll::Pending => return Poll::Pending,
                // End of stream: a read of 0.
                Poll::Ready(None) => return Poll::Ready(Ok(())),
                Poll::Ready(Some(Ok(chunk))) => {
                    this.current = chunk;
                    this.start = 0;
                }
                Poll::Ready(Some(Err(error))) => {
                    this.failed = Some(error.kind());
                    return Poll::Ready(Err(error));
                }
            }
        }
    }
}

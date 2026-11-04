use std::future::Future;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tokio::sync::Notify;

use crate::Error;

/// Go's context cancel, shared: the room's lifetime and a caller that went
/// away. It also cancels the journal's own context.
#[derive(Clone, Default)]
pub struct Token(Arc<Inner>);

#[derive(Default)]
struct Inner {
    cancelled: AtomicBool,
    notify: Notify,
    journal: blok_collab_journal::Context,
}

impl Token {
    pub fn new() -> Token {
        Token::default()
    }

    pub fn cancel(&self) {
        self.0.cancelled.store(true, Ordering::SeqCst);
        self.0.journal.cancel();
        self.0.notify.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.cancelled.load(Ordering::SeqCst)
    }

    /// ctx.Err().
    pub fn err(&self) -> Result<(), Error> {
        if self.is_cancelled() {
            Err(Error::Canceled)
        } else {
            Ok(())
        }
    }

    pub(crate) fn journal(&self) -> &blok_collab_journal::Context {
        &self.0.journal
    }

    pub async fn cancelled(&self) {
        loop {
            let notified = self.0.notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }

    /// Runs work until it ends or the token is cancelled, which drops it.
    pub async fn run<T>(&self, work: impl Future<Output = Result<T, Error>>) -> Result<T, Error> {
        self.err()?;
        tokio::select! {
            biased;
            () = self.cancelled() => Err(Error::Canceled),
            result = work => result,
        }
    }

    /// run, bounded: past timeout the work is dropped with DeadlineExceeded.
    pub(crate) async fn run_for<T>(
        &self,
        timeout: Duration,
        work: impl Future<Output = Result<T, Error>>,
    ) -> Result<T, Error> {
        match tokio::time::timeout(timeout, self.run(work)).await {
            Ok(result) => result,
            Err(_) => Err(Error::DeadlineExceeded),
        }
    }
}

/// Cancels its token when dropped: a caller's future that went away.
pub(crate) struct CancelOnDrop(pub Token);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

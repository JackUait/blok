use std::sync::{Arc, Mutex};

use tokio::sync::Notify;

/// Why a call was stopped by its caller. C# has one cancel exception, a
/// passed deadline included, and both answer the same everywhere.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CancelReason {
    Cancelled,
    DeadlineExceeded,
}

/// The caller's cancellation, as C#'s CancellationToken and Go's ctx. A
/// batch that already made host pages must still answer once cancelled (it
/// names the pages to clean up), so the executor reads this token at the
/// same points C# does instead of being dropped.
#[derive(Clone, Default)]
pub struct Cancel(Arc<Inner>);

#[derive(Default)]
struct Inner {
    reason: Mutex<Option<CancelReason>>,
    notify: Notify,
}

impl Cancel {
    /// A token nobody has cancelled yet.
    pub fn new() -> Cancel {
        Cancel::default()
    }

    pub fn cancel(&self) {
        self.stop(CancelReason::Cancelled);
    }

    /// Stops the call as a passed deadline does.
    pub fn expire(&self) {
        self.stop(CancelReason::DeadlineExceeded);
    }

    fn stop(&self, reason: CancelReason) {
        let mut slot = self.0.reason.lock().unwrap_or_else(|p| p.into_inner());
        if slot.is_none() {
            *slot = Some(reason);
        }
        drop(slot);
        self.0.notify.notify_waiters();
    }

    pub fn reason(&self) -> Option<CancelReason> {
        *self.0.reason.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Go's `ctx.Err()`.
    pub fn check(&self) -> Result<(), crate::Error> {
        match self.reason() {
            Some(reason) => Err(crate::Error::Cancelled(reason)),
            None => Ok(()),
        }
    }

    /// Resolves once the token is cancelled.
    pub async fn cancelled(&self) -> CancelReason {
        loop {
            let notified = self.0.notify.notified();
            if let Some(reason) = self.reason() {
                return reason;
            }
            notified.await;
        }
    }
}

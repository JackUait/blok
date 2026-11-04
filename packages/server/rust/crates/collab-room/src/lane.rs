use std::collections::VecDeque;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::task::{Context, Poll};

use tokio::sync::oneshot;

/// The room's SemaphoreSlim(1, 1): one holder, waiters served in arrival
/// order. The order matters: a checkpoint posted inside a commit must run
/// before work that queued after it.
#[derive(Default)]
pub(crate) struct Lane {
    state: Mutex<LaneState>,
}

#[derive(Default)]
struct LaneState {
    held: bool,
    waiters: VecDeque<oneshot::Sender<()>>,
}

impl Lane {
    fn lock(&self) -> MutexGuard<'_, LaneState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Takes a place in line now, as SemaphoreSlim.WaitAsync does when it is
    /// called; the turn completes on that place's turn. Dropping a turn that
    /// was not yet taken gives the place up, and passes the lane on when it
    /// was handed over as the turn dropped.
    pub(crate) fn reserve(&self) -> Turn<'_> {
        let mut state = self.lock();
        if !state.held {
            state.held = true;
            return Turn {
                lane: self,
                waiting: None,
                done: false,
            };
        }
        let (tx, rx) = oneshot::channel();
        state.waiters.push_back(tx);
        Turn {
            lane: self,
            waiting: Some(rx),
            done: false,
        }
    }

    pub(crate) fn leave(&self) {
        let mut state = self.lock();
        // A waiter whose turn dropped before its turn came closed its
        // channel: skip it.
        while let Some(next) = state.waiters.pop_front() {
            if next.send(()).is_ok() {
                return;
            }
        }
        state.held = false;
    }

    #[cfg(test)]
    pub(crate) fn waiters(&self) -> usize {
        self.lock()
            .waiters
            .iter()
            .filter(|w| !w.is_closed())
            .count()
    }
}

/// One place in the lane's line.
pub(crate) struct Turn<'a> {
    lane: &'a Lane,
    waiting: Option<oneshot::Receiver<()>>,
    done: bool,
}

impl Future for Turn<'_> {
    type Output = ();

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        if let Some(rx) = self.waiting.as_mut() {
            match Pin::new(rx).poll(cx) {
                Poll::Pending => return Poll::Pending,
                // The lane never drops a sender it did not send on.
                Poll::Ready(_) => self.waiting = None,
            }
        }
        self.done = true;
        Poll::Ready(())
    }
}

impl Drop for Turn<'_> {
    fn drop(&mut self) {
        if self.done {
            return;
        }
        match self.waiting.take() {
            None => self.lane.leave(),
            Some(mut rx) => {
                // Closed first, so a send after this point fails and the
                // lane moves past this place.
                rx.close();
                if rx.try_recv().is_ok() {
                    self.lane.leave();
                }
            }
        }
    }
}

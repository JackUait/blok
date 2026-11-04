use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;

use crate::runtime::Stop;

/// Stops one engine run at its deadline or when its caller goes away.
/// QuickJS polls the handler between instructions, also while it drains the
/// job queue, never inside a long native builtin.
#[derive(Clone)]
pub(crate) struct Guard(Arc<Mutex<State>>);

#[derive(Default)]
struct State {
    armed: bool,
    deadline: Option<Instant>,
    cancel: Option<Arc<AtomicBool>>,
    fired: Option<Stop>,
}

impl Guard {
    pub(crate) fn new() -> Guard {
        Guard(Arc::default())
    }

    fn state(&self) -> MutexGuard<'_, State> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(crate) fn arm(&self, deadline: Instant, cancel: Option<Arc<AtomicBool>>) {
        *self.state() = State {
            armed: true,
            deadline: Some(deadline),
            cancel,
            fired: None,
        };
    }

    /// A no-op once the run is over, so a late stop cannot reach the next
    /// caller's run on this engine.
    #[cfg(test)]
    pub(crate) fn interrupt(&self, stop: Stop) {
        let mut state = self.state();
        if state.armed && state.fired.is_none() {
            state.fired = Some(stop);
        }
    }

    pub(crate) fn fired(&self) -> Option<Stop> {
        self.state().fired
    }

    /// Must run before the engine serves another call. Returns what stopped
    /// the run, if anything did.
    pub(crate) fn disarm(&self) -> Option<Stop> {
        std::mem::take(&mut *self.state()).fired
    }

    pub(crate) fn handler(&self) -> impl FnMut() -> bool + Send + 'static {
        let guard = self.clone();
        move || {
            let mut state = guard.state();
            if !state.armed {
                return false;
            }
            if state.fired.is_none() {
                if state
                    .cancel
                    .as_ref()
                    .is_some_and(|cancel| cancel.load(Ordering::SeqCst))
                {
                    state.fired = Some(Stop::Cancel);
                } else if state.deadline.is_some_and(|at| Instant::now() >= at) {
                    state.fired = Some(Stop::Timeout);
                }
            }
            state.fired.is_some()
        }
    }
}

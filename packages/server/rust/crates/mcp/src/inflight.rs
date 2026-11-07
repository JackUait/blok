//! The tool calls a stop waits for (Node's `calls` set in src/mcp/server.ts).

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use tokio::sync::Notify;

#[derive(Default)]
pub struct InFlight {
    count: AtomicUsize,
    idle: Notify,
}

/// One call; the count drops when it does.
pub struct Call(Arc<InFlight>);

impl Drop for Call {
    fn drop(&mut self) {
        if self.0.count.fetch_sub(1, Ordering::AcqRel) == 1 {
            self.0.idle.notify_waiters();
        }
    }
}

impl InFlight {
    pub fn enter(self: &Arc<Self>) -> Call {
        self.count.fetch_add(1, Ordering::AcqRel);
        Call(self.clone())
    }

    /// Waits until no call runs, or `limit` passes. True when none runs.
    pub async fn drained(&self, limit: Duration) -> bool {
        tokio::time::timeout(limit, async {
            loop {
                let idle = self.idle.notified();
                tokio::pin!(idle);
                idle.as_mut().enable();
                if self.count.load(Ordering::Acquire) == 0 {
                    return;
                }
                idle.await;
            }
        })
        .await
        .is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_stop_waits_for_the_calls_in_flight() {
        let calls = Arc::new(InFlight::default());
        let call = calls.enter();
        assert!(!calls.drained(Duration::from_millis(50)).await);
        let waiting = {
            let calls = calls.clone();
            tokio::spawn(async move { calls.drained(Duration::from_secs(5)).await })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        drop(call);
        assert!(waiting.await.unwrap());
    }
}

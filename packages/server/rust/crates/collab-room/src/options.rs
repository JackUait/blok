use std::sync::Arc;
use std::time::{Duration, SystemTime};

use blok_collab::BoxFuture;

/// The room's clock.
pub type Clock = Arc<dyn Fn() -> SystemTime + Send + Sync>;

/// TimeProvider.CreateTimer: a wait on the host's clock.
pub trait Timers: Send + Sync {
    /// Resolves once d has passed on this clock.
    fn sleep(&self, d: Duration) -> BoxFuture<'static, ()>;
}

/// CollabRoomOptions. Default is C#'s defaults; an explicit zero stays zero,
/// as a C# init property does.
#[derive(Clone)]
pub struct Options {
    pub export_debounce: Duration,
    pub export_max_delay: Duration,
    pub eviction_linger: Duration,
    pub compaction_frame_threshold: usize,
    pub compaction_byte_threshold: i64,
    /// A journal room's counterpart to compaction.
    pub checkpoint_operation_threshold: i64,
    pub checkpoint_byte_threshold: i64,
    pub max_awareness_clients: usize,
    /// 0 announces no limits frame.
    pub announced_max_message_bytes: i64,
    /// The store's append limit when known; 0 means unknown.
    pub max_update_bytes: i64,
    pub retry_backoff: Duration,
    pub retry_backoff_cap: Duration,
    /// Bounds each store call made with the lane held.
    pub commit_timeout: Duration,
    /// SystemTime::now when None.
    pub now: Option<Clock>,
    /// The export, eviction and persist timers and every commit_timeout
    /// bound wait on it. Wall time when None.
    pub timers: Option<Arc<dyn Timers>>,
}

pub(crate) const MALFORMED_AWARENESS_LIMIT: i64 = 3;
pub(crate) const CHECKPOINT_FAILURE_LIMIT: i64 = 3;
pub(crate) const TRANSIENT_EXPORT_FAILURE_LIMIT: i64 = 8;
pub(crate) const MAX_JOIN_ATTEMPTS: i64 = 16;
// Shorter than the client's 60 s heartbeat on purpose: equal values let
// jitter drop every other heartbeat.
pub(crate) const ACTIVITY_WINDOW: Duration = Duration::from_secs(55);
pub(crate) const ACTIVITY_QUEUE_LIMIT: usize = 256;
pub(crate) const ACTIVITY_STAMP_LIMIT: usize = 256;

impl Default for Options {
    fn default() -> Self {
        Options {
            export_debounce: Duration::from_secs(2),
            export_max_delay: Duration::from_secs(10),
            eviction_linger: Duration::from_secs(30),
            compaction_frame_threshold: 64,
            compaction_byte_threshold: 1 << 20,
            checkpoint_operation_threshold: 64,
            checkpoint_byte_threshold: 1 << 20,
            max_awareness_clients: 256,
            announced_max_message_bytes: 0,
            max_update_bytes: 0,
            retry_backoff: Duration::from_secs(2),
            retry_backoff_cap: Duration::from_secs(60),
            commit_timeout: Duration::from_secs(10),
            now: None,
            timers: None,
        }
    }
}

impl Options {
    pub fn with_defaults(mut self) -> Options {
        if self.now.is_none() {
            self.now = Some(Arc::new(SystemTime::now));
        }
        self
    }

    /// A wait of d on the room's timers.
    pub(crate) fn sleep(&self, d: Duration) -> BoxFuture<'static, ()> {
        match &self.timers {
            Some(timers) => timers.sleep(d),
            None => Box::pin(tokio::time::sleep(d)),
        }
    }

    pub(crate) fn now(&self) -> SystemTime {
        match &self.now {
            Some(now) => now(),
            None => SystemTime::now(),
        }
    }

    /// The doubling wait after failures, capped: 2 s, 4 s, ... 60 s.
    pub fn backoff(&self, failures: i64) -> Duration {
        let steps = (failures - 1).clamp(0, 16) as u32;
        let delay = self.retry_backoff.saturating_mul(1 << steps);
        delay.min(self.retry_backoff_cap)
    }
}

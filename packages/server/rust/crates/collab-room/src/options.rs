use std::sync::Arc;
use std::time::{Duration, SystemTime};

/// The room's clock.
pub type Clock = Arc<dyn Fn() -> SystemTime + Send + Sync>;

/// CollabRoomOptions. Zero fields take C#'s defaults in `with_defaults`.
#[derive(Clone, Default)]
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

impl Options {
    pub fn with_defaults(mut self) -> Options {
        fn or(d: &mut Duration, default: Duration) {
            if d.is_zero() {
                *d = default;
            }
        }
        or(&mut self.export_debounce, Duration::from_secs(2));
        or(&mut self.export_max_delay, Duration::from_secs(10));
        or(&mut self.eviction_linger, Duration::from_secs(30));
        if self.compaction_frame_threshold == 0 {
            self.compaction_frame_threshold = 64;
        }
        if self.compaction_byte_threshold == 0 {
            self.compaction_byte_threshold = 1 << 20;
        }
        if self.checkpoint_operation_threshold == 0 {
            self.checkpoint_operation_threshold = 64;
        }
        if self.checkpoint_byte_threshold == 0 {
            self.checkpoint_byte_threshold = 1 << 20;
        }
        if self.max_awareness_clients == 0 {
            self.max_awareness_clients = 256;
        }
        or(&mut self.retry_backoff, Duration::from_secs(2));
        or(&mut self.retry_backoff_cap, Duration::from_secs(60));
        or(&mut self.commit_timeout, Duration::from_secs(10));
        if self.now.is_none() {
            self.now = Some(Arc::new(SystemTime::now));
        }
        self
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

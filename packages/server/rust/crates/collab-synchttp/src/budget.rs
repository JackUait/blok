//! SyncInboundBudget: every frame costs a slot, SyncStep1 and
//! queryAwareness also cost an amplifier token, and awareness also costs
//! its bytes.

use std::sync::Arc;
use std::time::Instant;

use blok_collab_wire::{
    MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS, MESSAGE_SYNC, SYNC_STEP1_TYPE, read_var_uint,
};

/// A monotonic clock, as TimeProvider.GetTimestamp is in C#.
pub type Clock = Arc<dyn Fn() -> Instant + Send + Sync>;

/// A flaky reconnect can land a few resyncs at once.
const AMPLIFIER_BURST: f64 = 10.0;

/// Several full presence replies in a large room; a single frame above it
/// can never be paid for.
const AWARENESS_BURST_BYTES: f64 = 512.0 * 1024.0;

/// The four CollabInbound* options. A rate of 0 is off.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BudgetOptions {
    pub frames_per_second: i64,
    pub burst_frames: i64,
    pub resyncs_per_minute: i64,
    pub awareness_bytes_per_second: i64,
}

/// One connection's budget. Only its receive loop uses it, so it takes
/// `&mut self` and has no lock.
pub struct InboundBudget {
    frames: TokenBucket,
    amplifiers: TokenBucket,
    awareness_bytes: TokenBucket,
}

impl InboundBudget {
    pub fn new(options: BudgetOptions, now: Clock) -> Self {
        Self {
            frames: TokenBucket::new(
                Arc::clone(&now),
                options.frames_per_second as f64,
                options.burst_frames as f64,
            ),
            amplifiers: TokenBucket::new(
                Arc::clone(&now),
                options.resyncs_per_minute as f64 / 60.0,
                AMPLIFIER_BURST,
            ),
            awareness_bytes: TokenBucket::new(
                now,
                options.awareness_bytes_per_second as f64,
                AWARENESS_BURST_BYTES,
            ),
        }
    }

    /// False when frame is over budget; the caller closes 1008.
    pub fn allows(&mut self, frame: &[u8]) -> bool {
        if !self.frames.take(1.0) {
            return false;
        }
        match classify(frame) {
            FrameClass::Amplifier => self.amplifiers.take(1.0),
            FrameClass::Presence => self.awareness_bytes.take(frame.len() as f64),
            FrameClass::Plain => true,
        }
    }
}

enum FrameClass {
    Plain,
    Amplifier,
    Presence,
}

/// Reads the type with the codec's varuint reader, never by bytes: [0x80,
/// 0x00] is also type 0.
fn classify(frame: &[u8]) -> FrameClass {
    let Some((message_type, rest)) = read_var_uint(frame) else {
        return FrameClass::Plain;
    };
    match message_type {
        MESSAGE_AWARENESS => FrameClass::Presence,
        MESSAGE_QUERY_AWARENESS => FrameClass::Amplifier,
        MESSAGE_SYNC => match read_var_uint(rest) {
            Some((SYNC_STEP1_TYPE, _)) => FrameClass::Amplifier,
            _ => FrameClass::Plain,
        },
        _ => FrameClass::Plain,
    }
}

struct TokenBucket {
    now: Clock,
    per_second: f64,
    capacity: f64,
    tokens: f64,
    stamp: Instant,
}

impl TokenBucket {
    fn new(now: Clock, per_second: f64, capacity: f64) -> Self {
        let stamp = now();
        Self {
            now,
            per_second,
            capacity,
            tokens: capacity,
            stamp,
        }
    }

    fn take(&mut self, cost: f64) -> bool {
        if self.per_second <= 0.0 {
            return true;
        }
        let now = (self.now)();
        let elapsed = now.saturating_duration_since(self.stamp).as_secs_f64();
        self.tokens = self.capacity.min(self.tokens + elapsed * self.per_second);
        self.stamp = now;
        if self.tokens < cost {
            return false;
        }
        self.tokens -= cost;
        true
    }
}

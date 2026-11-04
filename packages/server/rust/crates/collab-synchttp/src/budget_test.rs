use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::*;

#[derive(Clone)]
pub(crate) struct FakeClock(Arc<Mutex<Instant>>);

impl FakeClock {
    pub(crate) fn new() -> Self {
        Self(Arc::new(Mutex::new(Instant::now())))
    }

    pub(crate) fn advance(&self, by: Duration) {
        *self.0.lock().unwrap() += by;
    }

    pub(crate) fn clock(&self) -> Clock {
        let inner = Arc::clone(&self.0);
        Arc::new(move || *inner.lock().unwrap())
    }
}

fn new_test_budget(clock: &FakeClock, options: BudgetOptions) -> InboundBudget {
    InboundBudget::new(options, clock.clock())
}

pub(crate) fn default_budget() -> BudgetOptions {
    BudgetOptions {
        frames_per_second: 50,
        burst_frames: 100,
        resyncs_per_minute: 60,
        awareness_bytes_per_second: 128 << 10,
    }
}

fn presence(size: usize) -> Vec<u8> {
    let mut frame = vec![0u8; size];
    frame[0] = 1;
    frame
}

fn rate(frames_per_second: i64, burst_frames: i64) -> BudgetOptions {
    BudgetOptions {
        frames_per_second,
        burst_frames,
        resyncs_per_minute: 0,
        awareness_bytes_per_second: 0,
    }
}

#[test]
fn the_frame_after_the_burst_is_over_budget() {
    let clock = FakeClock::new();
    let mut budget = new_test_budget(&clock, rate(10, 10));
    for i in 0..10 {
        assert!(
            budget.allows(&presence(2)),
            "frame {} refused inside the burst",
            i + 1
        );
    }
    assert!(
        !budget.allows(&presence(2)),
        "the eleventh frame was allowed with no refill"
    );
}

#[test]
fn a_steady_cadence_refills_the_budget() {
    let clock = FakeClock::new();
    let mut budget = new_test_budget(&clock, rate(10, 10));
    for i in 0..31 {
        assert!(
            budget.allows(&presence(2)),
            "frame {} refused at the rate",
            i + 1
        );
        clock.advance(Duration::from_millis(100));
    }
}

#[test]
fn resyncs_and_presence_queries_share_the_tighter_budget() {
    let frames: [(&str, &[u8]); 5] = [
        ("SyncStep1", &[0, 0, 1, 0]),
        ("overlong SyncStep1", &[0x80, 0x00, 0x80, 0x00, 0x01, 0x00]),
        ("queryAwareness", &[3]),
        ("overlong query", &[0x83, 0x00]),
        ("SyncStep1 then extra", &[0, 0]),
    ];
    for (name, frame) in frames {
        let clock = FakeClock::new();
        let mut budget = new_test_budget(&clock, default_budget());
        for i in 0..10 {
            assert!(
                budget.allows(frame),
                "{name}: frame {} refused inside the amplifier burst",
                i + 1
            );
        }
        assert!(
            !budget.allows(frame),
            "{name}: the eleventh amplifier was allowed"
        );
    }
}

#[test]
fn updates_and_unknown_frames_are_not_amplifiers() {
    let frames: [(&str, &[u8]); 5] = [
        ("SyncStep2", &[0, 1, 0]),
        ("Update", &[0, 2, 0]),
        ("unknown", &[105]),
        ("undecodable", &[0x80]),
        ("empty", &[]),
    ];
    for (name, frame) in frames {
        let clock = FakeClock::new();
        let mut budget = new_test_budget(&clock, default_budget());
        for i in 0..100 {
            assert!(
                budget.allows(frame),
                "{name}: frame {} refused inside the frame burst",
                i + 1
            );
        }
    }
}

#[test]
fn presence_is_metered_by_bytes() {
    let clock = FakeClock::new();
    let mut budget = new_test_budget(&clock, default_budget());
    for i in 0..5 {
        assert!(
            budget.allows(&presence(100_000)),
            "presence frame {} refused under 512 KiB",
            i + 1
        );
    }
    assert!(
        !budget.allows(&presence(100_000)),
        "the sixth 100 KB presence frame was allowed"
    );

    let mut fresh = new_test_budget(&clock, default_budget());
    assert!(
        fresh.allows(&presence(512 << 10)),
        "a presence frame of exactly the burst was refused"
    );
    let mut fresh = new_test_budget(&clock, default_budget());
    assert!(
        !fresh.allows(&presence((512 << 10) + 1)),
        "a presence frame over the burst was allowed"
    );
}

#[test]
fn an_update_of_presence_size_is_not_metered_as_presence() {
    let clock = FakeClock::new();
    let mut budget = new_test_budget(&clock, default_budget());
    let mut update = vec![0u8; 100_000];
    update[1] = 2;
    for i in 0..6 {
        assert!(budget.allows(&update), "update {} refused", i + 1);
    }
}

#[test]
fn a_rate_of_zero_turns_a_bucket_off() {
    let clock = FakeClock::new();
    let mut budget = new_test_budget(&clock, rate(0, 1));
    for _ in 0..1000 {
        assert!(
            budget.allows(&[0, 0, 0]) && budget.allows(&presence(1 << 20)),
            "a zero rate refused a frame"
        );
    }
}

#[test]
fn the_amplifier_bucket_refills_per_minute() {
    let clock = FakeClock::new();
    let mut budget = new_test_budget(&clock, default_budget());
    let resync = [0u8, 0, 0];
    for _ in 0..10 {
        budget.allows(&resync);
    }
    // 60 a minute is one a second.
    clock.advance(Duration::from_millis(999));
    assert!(!budget.allows(&resync), "refilled before a whole token");
    clock.advance(Duration::from_millis(2));
    assert!(budget.allows(&resync), "no refill after one second");
}

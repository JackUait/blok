use std::time::{Duration, Instant};

use crate::DEFAULT_MEMORY_BUDGET;
use crate::engine::{Engine, Limits};
use crate::runtime::Stop;

fn engine() -> Engine {
    Engine::load(
        "guard.js",
        "globalThis.blokServerInvoke = () => String(1 + 1);",
        None,
    )
    .expect("load")
}

fn next_runs(engine: &mut Engine) {
    assert_eq!(engine.invoke("any", "", None).expect("the next run"), "2");
    let limits = Limits {
        deadline: Instant::now() + Duration::from_secs(60),
        budget: DEFAULT_MEMORY_BUDGET,
        cancel: None,
    };
    assert_eq!(
        engine
            .invoke("any", "", Some(&limits))
            .expect("the next guarded run"),
        "2"
    );
}

// An interrupt that lands as a run ends is cleared before the engine is reused.
#[test]
fn disarm_clears_an_interrupt_that_landed_after_the_run() {
    let mut engine = engine();
    let guard = engine.guard().clone();
    guard.arm(Instant::now() + Duration::from_secs(60), None);
    guard.interrupt(Stop::Timeout);
    assert_eq!(guard.disarm(), Some(Stop::Timeout));
    next_runs(&mut engine);
}

// A timer or watchdog that fires after disarm must not reach the next run.
#[test]
fn a_late_interrupt_after_disarm_is_ignored() {
    let mut engine = engine();
    let guard = engine.guard().clone();
    guard.arm(Instant::now() + Duration::from_secs(60), None);
    assert_eq!(guard.disarm(), None);
    guard.interrupt(Stop::Timeout);
    next_runs(&mut engine);
}

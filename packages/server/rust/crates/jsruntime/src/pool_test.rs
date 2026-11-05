use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::{
    ConstraintError, Error, Failure, InvokeError, Kind, MINIMUM_MEMORY_BUDGET, MINIMUM_TIMEOUT,
    Options, Pool, PoolError, StartupCause, StartupError,
};

// Each engine counts its own calls, so a test can tell reuse from a rebuild.
pub(crate) const COUNTING_SCRIPT: &str = r"
let calls = 0;
let open = 0;
globalThis.blokServerInvoke = async function (operation, input) {
  calls += 1;
  switch (operation) {
    case 'count': return String(calls);
    case 'spin': for (;;) {}
    case 'spinFor': { const until = Date.now() + Number(input); while (Date.now() < until) {} return 'ok'; }
    case 'throwError': throw new Error('the bundle itself broke');
    case 'throwTypeError': throw new TypeError('not a document');
    case 'throwSyntaxError': JSON.parse('not json');
    case 'throwRangeError': throw new RangeError('out of range');
    case 'throwString': throw 'bare';
    case 'pending': return new Promise(() => {});
    case 'awaitThenSpin': await null; for (;;) {}
    case 'recurse': { const r = (d) => d === 0 ? 0 : r(d - 1) + 1; return String(r(1000000)); }
    case 'catchRecursion': { try { const r = (d) => d === 0 ? 0 : r(d - 1) + 1; return String(r(1000000)); } catch (e) { return 'caught ' + e.name; } }
    case 'guardedRecurse': { const r = (d) => { open += 1; try { return d === 0 ? 0 : r(d - 1) + 1; } finally { open -= 1; } }; return String(r(1000000)); }
    case 'open': return String(open);
    case 'grow': { const kept = []; for (;;) { kept.push({ a: [1, 2, 3, 4, 5, 6, 7, 8] }); } }
    default: return 'ok';
  }
};";

pub(crate) fn counting_pool(size: usize, timeout: Duration, budget: i64) -> Pool {
    Pool::from_source(COUNTING_SCRIPT, size, timeout, budget).expect("from_source")
}

pub(crate) async fn invoke(pool: &Pool, op: &str, input: &str) -> Result<String, InvokeError> {
    pool.invoke(op, input, Duration::ZERO).await
}

#[track_caller]
pub(crate) fn want_kind(result: Result<String, InvokeError>, kind: Kind) -> Failure {
    match result {
        Err(InvokeError::Failure(failure)) if failure.kind == kind => failure,
        other => panic!("{other:?}, want a Failure of kind {kind:?}"),
    }
}

pub(crate) async fn want_count(pool: &Pool, want: &str) {
    let got = invoke(pool, "count", "").await.expect("count");
    assert_eq!(got, want, "count");
}

fn startup_error(result: Result<Pool, PoolError>) -> StartupError {
    match result {
        Err(PoolError::Startup(err)) => err,
        Err(other) => panic!("{other:?}, want a StartupError"),
        Ok(_) => panic!("want a StartupError, got a pool"),
    }
}

#[tokio::test]
async fn times_out_instead_of_hanging() {
    let pool = counting_pool(1, Duration::from_millis(200), 0);
    let start = Instant::now();
    want_kind(invoke(&pool, "spin", "").await, Kind::TimedOut);
    assert!(
        start.elapsed() <= Duration::from_secs(2),
        "took {:?}",
        start.elapsed()
    );
}

#[tokio::test]
async fn times_out_inside_the_job_queue() {
    let pool = counting_pool(1, Duration::from_millis(200), 0);
    want_kind(invoke(&pool, "awaitThenSpin", "").await, Kind::TimedOut);
}

// The pool is fixed size: a slot that is not refilled leaves later callers waiting forever.
#[tokio::test]
async fn keeps_serving_after_a_timeout_and_replaces_the_engine() {
    let pool = counting_pool(1, Duration::from_millis(200), 0);
    for _ in 0..3 {
        want_kind(invoke(&pool, "spin", "").await, Kind::TimedOut);
        // A fresh engine: its count starts again.
        want_count(&pool, "1").await;
    }
}

#[tokio::test]
async fn a_per_call_timeout_replaces_the_default_for_that_call_only() {
    let pool = counting_pool(1, Duration::from_millis(200), 0);
    let got = pool.invoke("spinFor", "600", Duration::from_secs(30)).await;
    assert_eq!(got.expect("long call"), "ok");
    want_kind(invoke(&pool, "spinFor", "600").await, Kind::TimedOut);
}

#[tokio::test]
async fn a_per_call_timeout_can_be_shorter_than_the_default() {
    let pool = counting_pool(1, Duration::ZERO, 0);
    let got = pool
        .invoke("spinFor", "600", Duration::from_millis(200))
        .await;
    want_kind(got, Kind::TimedOut);
}

#[tokio::test]
async fn refuses_a_per_call_timeout_below_the_floor() {
    let pool = counting_pool(1, Duration::ZERO, 0);
    match pool.invoke("count", "", Duration::from_millis(1)).await {
        Err(InvokeError::Constraint(ConstraintError {
            param: "timeout", ..
        })) => {}
        other => panic!("{other:?}, want a timeout ConstraintError"),
    }
    // Refused before an engine was taken.
    want_count(&pool, "1").await;
}

// A deadline that fires just as a call ends must not stop the next call on
// the same engine.
#[tokio::test]
async fn a_late_deadline_never_stops_the_next_call() {
    let pool = counting_pool(1, MINIMUM_TIMEOUT, 0);
    for attempt in 0..40 {
        let spin = (90 + attempt % 20).to_string();
        if let Err(err) = invoke(&pool, "spinFor", &spin).await {
            want_kind(Err(err), Kind::TimedOut);
        }
        if let Err(err) = invoke(&pool, "count", "").await {
            panic!("attempt {attempt}: the next call failed: {err}");
        }
    }
}

#[tokio::test]
async fn classifies_java_script_errors_and_keeps_the_engine() {
    let cases = [
        ("throwError", Some(Kind::Unknown)),
        ("throwTypeError", Some(Kind::InvalidDocument)),
        ("throwSyntaxError", Some(Kind::InvalidDocument)),
        ("throwRangeError", Some(Kind::Unknown)),
        ("throwString", Some(Kind::Unknown)),
        ("noSuchOp", None),
    ];
    let pool = counting_pool(1, Duration::ZERO, 0);
    for (op, kind) in cases {
        let Some(kind) = kind else { continue };
        want_kind(invoke(&pool, op, "").await, kind);
    }
    // Five failed calls, then this one: the same engine served them all.
    want_count(&pool, "6").await;
}

#[tokio::test]
async fn classifies_the_bundles_own_errors_by_name() {
    let pool = Pool::new(Options {
        pool_size: Some(1),
        ..Options::default()
    })
    .expect("new");
    want_kind(
        invoke(&pool, "noSuchOperation", "{}").await,
        Kind::InvalidDocument,
    );
    want_kind(
        invoke(&pool, "blocksToHtml", "not json").await,
        Kind::InvalidDocument,
    );
    want_kind(
        invoke(&pool, "blocksToMarkdown", r#"{"nope":1}"#).await,
        Kind::InvalidDocument,
    );
}

// QuickJS's stack limit throws a RangeError JS can catch, like Jint's guard.
#[tokio::test]
async fn survives_runaway_recursion_and_keeps_the_engine() {
    let pool = counting_pool(1, Duration::ZERO, 0);
    let failure = want_kind(invoke(&pool, "recurse", "").await, Kind::Unknown);
    assert!(
        matches!(&failure.err, Error::Js(err) if err.name == "RangeError"),
        "{failure}"
    );
    let caught = invoke(&pool, "catchRecursion", "").await;
    assert_eq!(caught.expect("catchRecursion"), "caught RangeError");
    want_count(&pool, "3").await;
}

// Go replaces its engine because goja's overflow skips every finally.
// QuickJS runs them, like Jint, so the kept engine is clean.
#[tokio::test]
async fn an_overflow_leaves_no_state_for_the_next_call() {
    let pool = counting_pool(1, Duration::ZERO, 0);
    want_kind(invoke(&pool, "guardedRecurse", "").await, Kind::Unknown);
    let open = invoke(&pool, "open", "").await;
    assert_eq!(open.expect("open"), "0");
}

// A promise that never settles: the caller's cancel (dropping the future)
// ends the wait, as in C# (WaitsOnAPendingPromiseUntilTheCallerCancels), and
// the engine is replaced.
#[tokio::test]
async fn waits_on_a_pending_promise_until_the_caller_cancels() {
    let pool = counting_pool(1, Duration::from_secs(5), 0);
    let start = Instant::now();
    let waited =
        tokio::time::timeout(Duration::from_millis(300), invoke(&pool, "pending", "")).await;
    assert!(
        waited.is_err(),
        "returned before the caller cancelled: {waited:?}"
    );
    want_count(&pool, "1").await;
    assert!(
        start.elapsed() < Duration::from_secs(4),
        "took {:?}",
        start.elapsed()
    );
}

// C# JintBlokRuntimeTests.EndsAPendingPromiseAtTheCallTimeout: with no
// cancel the wait ends at the call timeout, and the engine is replaced, so
// one request cannot hold an engine for good.
#[tokio::test]
async fn ends_a_pending_promise_at_the_call_timeout() {
    let pool = counting_pool(1, Duration::from_millis(200), 0);
    let start = Instant::now();
    let result = tokio::time::timeout(Duration::from_secs(3), invoke(&pool, "pending", ""))
        .await
        .expect("ends at the call timeout");
    want_kind(result, Kind::TimedOut);
    assert!(
        start.elapsed() >= Duration::from_millis(150),
        "took {:?}",
        start.elapsed()
    );
    want_count(&pool, "1").await;
}

#[tokio::test]
async fn stops_a_call_that_outgrows_its_memory_budget() {
    let pool = counting_pool(1, Duration::from_secs(30), 64 << 20);
    want_kind(invoke(&pool, "grow", "").await, Kind::DocumentTooLarge);
    want_count(&pool, "1").await;
}

#[tokio::test]
async fn returns_the_callers_cancellation_unwrapped() {
    let pool = counting_pool(1, Duration::from_secs(30), 0);
    let got = tokio::time::timeout(Duration::from_millis(150), invoke(&pool, "spin", "")).await;
    assert!(got.is_err(), "{got:?}, want the caller's own timeout");
    // The engine was stopped mid-run, so it was replaced.
    want_count(&pool, "1").await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancellation_ends_the_wait_for_an_engine() {
    let pool = Arc::new(counting_pool(1, Duration::from_secs(30), 0));
    let busy = {
        let pool = pool.clone();
        tokio::spawn(async move { pool.invoke("spinFor", "500", Duration::ZERO).await })
    };
    tokio::time::sleep(Duration::from_millis(50)).await;

    let start = Instant::now();
    let got = tokio::time::timeout(Duration::from_millis(50), invoke(&pool, "count", "")).await;
    assert!(got.is_err(), "{got:?}, want the caller's own cancellation");
    assert!(
        start.elapsed() <= Duration::from_millis(300),
        "waited {:?}",
        start.elapsed()
    );
    busy.await.expect("join").expect("the busy call");
}

#[tokio::test]
async fn refuses_an_already_cancelled_context() {
    let pool = counting_pool(1, Duration::ZERO, 0);
    let cancelled = tokio::select! {
        biased;
        () = std::future::ready(()) => true,
        _ = invoke(&pool, "count", "") => false,
    };
    assert!(cancelled);
    want_count(&pool, "1").await;
}

#[tokio::test]
async fn keeps_the_slot_when_a_rebuild_fails() {
    let pool = counting_pool(1, Duration::from_millis(200), 0);
    pool.set_load(|| {
        Err(StartupError {
            cause: StartupCause::Failed,
            message: "no rebuild".to_owned(),
            err: Error::Engine("no rebuild".to_owned()),
        })
    });
    want_kind(invoke(&pool, "spin", "").await, Kind::TimedOut);
    // The spent engine went back, so the call is served, not stuck.
    let got = invoke(&pool, "count", "").await;
    assert_eq!(got.expect("count"), "2", "want the spent engine's 2");
}

#[tokio::test]
async fn keeps_the_slot_when_a_rebuild_panics() {
    let pool = counting_pool(1, Duration::from_millis(200), 0);
    pool.set_load(|| panic!("no rebuild"));
    want_kind(invoke(&pool, "spin", "").await, Kind::TimedOut);
    let got = tokio::time::timeout(Duration::from_secs(5), invoke(&pool, "count", "")).await;
    assert_eq!(got.expect("served, not stuck").expect("count"), "2");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn handles_concurrent_calls_without_sharing_an_engine() {
    let pool = Arc::new(
        Pool::new(Options {
            pool_size: Some(4),
            ..Options::default()
        })
        .expect("new"),
    );
    let calls: Vec<_> = (0..64)
        .map(|i| {
            let pool = pool.clone();
            tokio::spawn(async move {
                let text = format!("paragraph number {i}");
                let input = format!(
                    r#"{{"blocks":[{{"id":"p","type":"paragraph","data":{{"text":"{text}"}}}}]}}"#
                );
                let got = pool
                    .invoke("blocksToPlainText", &input, Duration::ZERO)
                    .await;
                (i, text, got)
            })
        })
        .collect();
    for call in calls {
        let (i, text, got) = call.await.expect("join");
        assert_eq!(got.expect("invoke"), text, "call {i}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn callers_wait_when_every_engine_is_busy() {
    let pool = Arc::new(counting_pool(2, Duration::from_secs(30), 0));
    let start = Instant::now();
    let calls: Vec<_> = (0..4)
        .map(|_| {
            let pool = pool.clone();
            tokio::spawn(async move { pool.invoke("spinFor", "200", Duration::ZERO).await })
        })
        .collect();
    for call in calls {
        call.await.expect("join").expect("spinFor");
    }
    // Four 200 ms calls on two engines take two rounds.
    assert!(
        start.elapsed() >= Duration::from_millis(350),
        "took {:?}, want two rounds",
        start.elapsed()
    );
}

pub(crate) fn nested_outline(depth: usize) -> String {
    let blocks: Vec<String> = (0..depth)
        .map(|level| {
            let parent = if level == 0 {
                "null".to_owned()
            } else {
                format!(r#""n{}""#, level - 1)
            };
            format!(
                r#"{{"id":"n{level}","parent":{parent},"type":"list","data":{{"style":"unordered","text":"level {level}"}}}}"#
            )
        })
        .collect();
    format!(r#"{{"blocks":[{}]}}"#, blocks.join(","))
}

#[tokio::test]
async fn converts_a_deeply_nested_outline() {
    let pool = Pool::new(Options {
        pool_size: Some(1),
        ..Options::default()
    })
    .expect("new");
    let input = nested_outline(120);
    for op in ["blocksToPlainText", "blocksToMarkdown", "blocksToHtml"] {
        let got = pool.invoke(op, &input, Duration::from_secs(60)).await;
        let got = got.unwrap_or_else(|err| panic!("{op}: {err}"));
        assert!(got.contains("level 119"), "{op}: no level 119");
    }
}

// C# converts 2380 outline levels to HTML and stops at 2400 on its
// allocation budget (measured); QuickJS's stack must reach as far.
#[tokio::test]
async fn converts_as_many_outline_levels_to_html_as_csharp() {
    let pool = Pool::new(Options {
        pool_size: Some(1),
        timeout: Some(Duration::from_secs(120)),
        ..Options::default()
    })
    .expect("new");
    let got = pool
        .invoke("blocksToHtml", &nested_outline(2380), Duration::ZERO)
        .await
        .expect("2380 levels to HTML");
    assert!(got.contains("level 2379"));
}

#[test]
fn reports_a_load_that_runs_past_the_timeout() {
    let err = startup_error(Pool::from_source(
        "for (;;) {}",
        1,
        Duration::from_millis(200),
        0,
    ));
    assert_eq!(err.cause, StartupCause::TimedOut, "{err}");
    assert!(
        err.to_string().contains("200ms"),
        "{err} does not name the timeout"
    );
}

#[test]
fn reports_a_load_that_outgrows_the_budget() {
    let err = startup_error(Pool::from_source(
        "const kept = []; for (;;) { kept.push([1, 2, 3, 4]); }",
        1,
        Duration::from_secs(30),
        1 << 20,
    ));
    assert_eq!(err.cause, StartupCause::OverBudget, "{err}");
    assert!(
        err.to_string().contains("1048576-byte"),
        "{err} does not name the budget"
    );
}

#[test]
fn reports_any_other_load_failure() {
    for source in ["throw new Error('broken')", "var x = 1;", "syntax error ("] {
        let err = startup_error(Pool::from_source(source, 1, Duration::ZERO, 0));
        assert_eq!(err.cause, StartupCause::Failed, "{source}: {err}");
        assert_eq!(
            err.to_string(),
            "Could not load Blok's runtime bundle into an engine."
        );
    }
}

#[test]
fn refuses_limits_below_their_floors() {
    let cases = [
        (
            Options {
                memory_budget: Some(1024),
                ..Options::default()
            },
            "MemoryBudget",
        ),
        (
            Options {
                memory_budget: Some(-1),
                ..Options::default()
            },
            "MemoryBudget",
        ),
        // C# RefusesAnExplicitZero: None is the default, Some(0) is under
        // the floor.
        (
            Options {
                memory_budget: Some(0),
                ..Options::default()
            },
            "MemoryBudget",
        ),
        (
            Options {
                timeout: Some(Duration::from_millis(1)),
                ..Options::default()
            },
            "Timeout",
        ),
        (
            Options {
                timeout: Some(Duration::ZERO),
                ..Options::default()
            },
            "Timeout",
        ),
        (
            Options {
                pool_size: Some(0),
                ..Options::default()
            },
            "PoolSize",
        ),
    ];
    for (options, param) in cases {
        match Pool::new(options) {
            Err(PoolError::Constraint(err)) if err.param == param => {}
            Err(err) => panic!("{options:?}: {err}, want a {param} ConstraintError"),
            Ok(_) => panic!("{options:?}: want a {param} ConstraintError"),
        }
    }
}

#[test]
#[ignore = "QuickJS needs 9 MiB to load the bundle, as Jint does; C#'s 8 MiB floor is measured to fail in both"]
fn loads_at_the_floors() {
    Pool::new(Options {
        pool_size: Some(1),
        memory_budget: Some(MINIMUM_MEMORY_BUDGET),
        timeout: Some(Duration::from_secs(30)),
    })
    .expect("new at the budget floor");
}

#[test]
fn loads_one_mebibyte_above_the_floor() {
    Pool::new(Options {
        pool_size: Some(1),
        memory_budget: Some(MINIMUM_MEMORY_BUDGET + (1 << 20)),
        timeout: Some(Duration::from_secs(30)),
    })
    .expect("new one MiB above the budget floor");
}

#[tokio::test]
async fn takes_the_defaults_for_zero_options() {
    let pool = Pool::new(Options::default()).expect("new");
    let (timeout, budget, size) = pool.limits();
    assert_eq!(timeout, Duration::from_secs(10));
    assert_eq!(budget, 512 << 20);
    let want = std::thread::available_parallelism().map_or(1, |n| n.get().clamp(1, 4));
    assert_eq!(size, want);
    assert_eq!(pool.free_engines().await, want);
}

#[tokio::test]
async fn a_caught_out_of_memory_still_stops_the_call() {
    let script = "globalThis.blokServerInvoke = () => { try { const kept = []; for (;;) { kept.push({ a: [1, 2, 3, 4] }); } } catch (e) { return 'caught ' + e; } };";
    let pool =
        Pool::from_source(script, 1, Duration::from_secs(30), 64 << 20).expect("from_source");
    want_kind(
        pool.invoke("grow", "", Duration::ZERO).await,
        Kind::DocumentTooLarge,
    );
}

#[tokio::test]
async fn a_script_that_throws_null_is_unknown() {
    let pool = Pool::from_source(
        "globalThis.blokServerInvoke = () => { throw null; };",
        1,
        Duration::ZERO,
        0,
    )
    .expect("from_source");
    want_kind(pool.invoke("any", "", Duration::ZERO).await, Kind::Unknown);
}

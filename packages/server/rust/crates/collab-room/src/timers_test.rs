use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_collab::{BoxFuture, OperationSource};
use tokio::sync::oneshot;

use crate::activity_test::{GatedObserver, activity_manager};
use crate::test_support::*;
use crate::*;

/// C#'s ManualTimeProvider for timers: nothing fires until advance moves
/// its clock.
#[derive(Default)]
struct ManualTimers(Mutex<Clocked>);

/// The clock, and each waiting timer with its due time.
type Clocked = (Duration, Vec<(Duration, oneshot::Sender<()>)>);

impl ManualTimers {
    fn advance(&self, by: Duration) {
        let mut state = self.0.lock().unwrap();
        state.0 += by;
        let now = state.0;
        let (due, waiting): (Vec<_>, Vec<_>) = state.1.drain(..).partition(|(at, _)| *at <= now);
        state.1 = waiting;
        drop(state);
        for (_, fire) in due {
            let _ = fire.send(());
        }
    }
}

impl Timers for ManualTimers {
    fn sleep(&self, d: Duration) -> BoxFuture<'static, ()> {
        let (fire, fired) = oneshot::channel();
        let mut state = self.0.lock().unwrap();
        let at = state.0 + d;
        state.1.push((at, fire));
        Box::pin(async move {
            // A dropped timer (the clock owner gone) never fires.
            if fired.await.is_err() {
                std::future::pending::<()>().await;
            }
        })
    }
}

// C# ARoomTimerFiresOnTheTimeProviderWithNoWallTimePassing.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_room_timer_fires_on_the_time_provider_with_no_wall_time_passing() {
    let timers = Arc::new(ManualTimers::default());
    let (manager, _store, _endpoint) = test_manager(
        Options {
            eviction_linger: Duration::from_secs(30),
            timers: Some(timers.clone()),
            ..Options::default()
        },
        None,
    );
    let membership = join(&manager, "doc", &FakeMember::v1(false)).await;

    membership.leave();
    tokio::time::sleep(ms(100)).await;
    assert_eq!(manager.live_room_count(), 1, "before the clock moved");
    timers.advance(Duration::from_secs(30));

    wait_until("the room to be evicted", || manager.live_room_count() == 0).await;
}

// C# ACommitTimeoutBoundRunsOnTheTimeProvider.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_commit_timeout_bound_runs_on_the_time_provider() {
    let timers = Arc::new(ManualTimers::default());
    let observer = GatedObserver::new();
    let logs = Logs::default();
    let manager = activity_manager(
        Options {
            commit_timeout: Duration::from_secs(600),
            timers: Some(timers.clone()),
            ..Options::default()
        },
        observer.clone(),
        &logs,
    );
    join(
        &manager,
        "doc",
        &FakeMember::new("user-0", OperationSource::ClientV1, false),
    )
    .await;
    tokio::time::timeout(Duration::from_secs(10), observer.entered.wait())
        .await
        .expect("the observer was never called");

    let draining = manager.clone();
    let drain = tokio::spawn(async move { draining.drain().await });
    tokio::time::sleep(ms(200)).await;
    assert!(
        !drain.is_finished(),
        "the drain ended before the clock moved"
    );
    timers.advance(Duration::from_secs(600));
    tokio::time::timeout(Duration::from_secs(10), drain)
        .await
        .expect("the drain did not end when the clock passed CommitTimeout")
        .unwrap()
        .expect("drain");
    assert!(logs.lines().contains(
        &"collab: room \"doc\" abandoned its activity dispatch while draining: the observer is past its bound"
            .to_owned()
    ));
    observer.gate.open();
}

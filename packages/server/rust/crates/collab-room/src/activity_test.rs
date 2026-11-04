use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use blok_collab::{BoxFuture, OperationSource};

use crate::test_support::*;
use crate::*;

/// Holds its first call until the gate opens.
struct GatedObserver {
    gate: Gate,
    entered: Gate,
    actors: Mutex<Vec<String>>,
}

impl GatedObserver {
    fn new() -> Arc<GatedObserver> {
        Arc::new(GatedObserver {
            gate: Gate::new(),
            entered: Gate::new(),
            actors: Mutex::new(Vec::new()),
        })
    }
}

impl ActivityObserver for GatedObserver {
    fn record<'a>(
        &'a self,
        _doc: &'a str,
        actor: &'a str,
        _at: SystemTime,
        kind: ActivityKind,
    ) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move {
            let first = {
                let mut actors = lock(&self.actors);
                actors.push(format!("{actor} {kind}"));
                actors.len() == 1
            };
            if first {
                self.entered.open();
                self.gate.wait().await;
            }
            Ok(())
        })
    }
}

fn activity_manager(o: Options, observer: Arc<GatedObserver>, logs: &Logs) -> Manager {
    Manager::new(ManagerOptions {
        store: MemoryStore::new(),
        endpoint: FakeEndpoint::null(),
        converter: Arc::new(real_converter()),
        room: o,
        log: Some(logs.log()),
        operations: None,
        activity: Some(observer),
    })
}

// Twin of C# TheActivityQueueDropsItsOldestPastTheBound (M15): with the
// observer held, 258 records queue against a bound of 256, and the oldest
// pair goes.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_activity_queue_drops_its_oldest_past_the_bound() {
    let observer = GatedObserver::new();
    let logs = Logs::default();
    let manager = activity_manager(
        Options {
            export_debounce: HOUR,
            export_max_delay: HOUR,
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

    for index in 1..=129 {
        let member = FakeMember::new(&format!("user-{index}"), OperationSource::ClientV1, false);
        join(&manager, "doc", &member).await.leave();
    }
    observer.gate.open();
    manager.settle().await;

    let records = lock(&observer.actors).clone();
    assert_eq!(records.len(), 257);
    assert!(
        !records.iter().any(|r| r.starts_with("user-1 ")),
        "the oldest pair survived"
    );
    assert!(
        logs.logged("the activity observer is behind"),
        "nothing logged: {:?}",
        logs.lines()
    );
}

// M15: the drain waits for the activity pump at most CommitTimeout
// (CollabRoom.cs:1337-1350), then abandons it and says so.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_drain_stops_waiting_for_a_stuck_observer_at_the_commit_timeout() {
    let observer = GatedObserver::new();
    let logs = Logs::default();
    let manager = activity_manager(
        Options {
            commit_timeout: ms(50),
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
    observer.entered.wait().await;

    let started = tokio::time::Instant::now();
    manager.drain().await.expect("drain");
    assert!(
        started.elapsed() <= Duration::from_secs(2),
        "the drain took {:?}",
        started.elapsed()
    );
    assert!(
        logs.logged("the observer is past its bound"),
        "nothing logged: {:?}",
        logs.lines()
    );
    observer.gate.open();
}

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, oneshot};

use crate::lane::Lane;

async fn wait_for_waiters(lane: &Lane, n: usize) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(1);
    while tokio::time::Instant::now() < deadline {
        if lane.waiters() == n {
            return;
        }
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    panic!("never saw {n} waiters");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_lane_runs_waiters_in_arrival_order() {
    let lane = Arc::new(Lane::default());
    lane.reserve().await;
    let (order_tx, mut order) = mpsc::unbounded_channel();
    for i in 0..3 {
        let (ready_tx, ready) = oneshot::channel();
        let (lane2, order_tx) = (lane.clone(), order_tx.clone());
        tokio::spawn(async move {
            let turn = lane2.reserve();
            ready_tx.send(()).unwrap();
            turn.await;
            order_tx.send(i).unwrap();
            lane2.leave();
        });
        ready.await.unwrap();
        wait_for_waiters(&lane, i + 1).await;
    }
    lane.leave();
    for want in 0..3 {
        assert_eq!(order.recv().await, Some(want), "waiter order");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_cancelled_waiter_gives_up_its_place() {
    let lane = Arc::new(Lane::default());
    lane.reserve().await;
    let (cancel_tx, cancel) = oneshot::channel::<()>();
    let lane2 = lane.clone();
    let waiter = tokio::spawn(async move {
        tokio::select! {
            () = lane2.reserve() => "entered",
            _ = cancel => "canceled",
        }
    });
    wait_for_waiters(&lane, 1).await;
    cancel_tx.send(()).unwrap();
    assert_eq!(waiter.await.unwrap(), "canceled");
    lane.leave();
    // The lane is free again: a cancelled waiter must not keep it.
    let entered = tokio::time::timeout(Duration::from_secs(1), lane.reserve()).await;
    assert!(
        entered.is_ok(),
        "the lane stayed held by a cancelled waiter"
    );
}

// A turn handed over as its waiter gave up passes the lane on.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_turn_dropped_after_its_handover_passes_the_lane_on() {
    let lane = Lane::default();
    lane.reserve().await;
    let turn = lane.reserve();
    lane.leave();
    drop(turn);
    let entered = tokio::time::timeout(Duration::from_secs(1), lane.reserve()).await;
    assert!(entered.is_ok(), "the handed-over turn kept the lane");
}

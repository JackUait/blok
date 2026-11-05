//! A lane of two slots per caller key in one fetcher pool, kept while anyone
//! holds or waits for one of its slots. A pool holds four, so one caller
//! cannot fill it alone.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use tokio::sync::{OwnedSemaphorePermit, Semaphore};

const FETCHES_PER_CALLER: usize = 2;

type Lanes = Arc<Mutex<HashMap<String, (Arc<Semaphore>, usize)>>>;

#[derive(Clone, Default)]
pub(crate) struct CallerLanes {
    lanes: Lanes,
}

/// A held lane slot; dropping it frees the slot, then the lane if unused.
pub(crate) struct Lease {
    // Declared first: the slot is freed before the membership ends.
    _permit: OwnedSemaphorePermit,
    _member: Member,
}

/// Counts one holder or waiter of a lane.
struct Member {
    lanes: Lanes,
    key: String,
}

fn lock(lanes: &Lanes) -> MutexGuard<'_, HashMap<String, (Arc<Semaphore>, usize)>> {
    lanes
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl CallerLanes {
    /// Waits for one of key's slots. Cancel by dropping the future. An empty
    /// key has no lane.
    pub(crate) async fn enter(&self, key: &str) -> Option<Lease> {
        if key.is_empty() {
            return None;
        }
        let slots = {
            let mut lanes = lock(&self.lanes);
            let lane = lanes
                .entry(key.to_owned())
                .or_insert_with(|| (Arc::new(Semaphore::new(FETCHES_PER_CALLER)), 0));
            lane.1 += 1;
            Arc::clone(&lane.0)
        };
        let member = Member {
            lanes: Arc::clone(&self.lanes),
            key: key.to_owned(),
        };
        let permit = slots.acquire_owned().await.expect("a lane is never closed");
        Some(Lease {
            _permit: permit,
            _member: member,
        })
    }
}

impl Drop for Member {
    fn drop(&mut self) {
        let mut lanes = lock(&self.lanes);
        if let Some(lane) = lanes.get_mut(&self.key) {
            lane.1 -= 1;
            if lane.1 == 0 {
                lanes.remove(&self.key);
            }
        }
    }
}

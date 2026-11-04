//! SyncConnectionTable: live sync connections, process-wide against
//! CollabMaxConnections and per (doc, principal) against
//! CollabMaxConnectionsPerUserPerDoc.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

pub struct ConnectionTable {
    ceiling: i64,
    per_user: i64,
    live: AtomicI64,
    counts: Mutex<HashMap<(String, String), i64>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}

impl ConnectionTable {
    /// A ceiling of 0 means none.
    pub fn new(ceiling: i64, per_user_per_doc: i64) -> Self {
        Self {
            ceiling,
            per_user: per_user_per_doc,
            live: AtomicI64::new(0),
            counts: Mutex::new(HashMap::new()),
        }
    }

    /// The number of sync connections whose request has not ended.
    pub fn live(&self) -> i64 {
        self.live.load(Ordering::Acquire)
    }

    /// None when the process is at its ceiling.
    pub fn try_enter(self: &Arc<Self>) -> Option<Slot> {
        if self.live.fetch_add(1, Ordering::AcqRel) + 1 > self.ceiling && self.ceiling > 0 {
            self.live.fetch_sub(1, Ordering::AcqRel);
            return None;
        }
        Some(Slot {
            table: Arc::clone(self),
            released: AtomicBool::new(false),
        })
    }

    /// None when principal already holds the cap for doc.
    pub fn try_reserve(self: &Arc<Self>, doc: &str, principal: &str) -> Option<Lease> {
        let key = (doc.to_owned(), principal.to_owned());
        let mut counts = lock(&self.counts);
        let count = counts.entry(key.clone()).or_insert(0);
        if *count >= self.per_user {
            if *count == 0 {
                counts.remove(&key);
            }
            return None;
        }
        *count += 1;
        Some(Lease {
            table: Arc::clone(self),
            key,
            released: AtomicBool::new(false),
        })
    }
}

/// One process-wide connection; freed once, on release or drop.
pub struct Slot {
    table: Arc<ConnectionTable>,
    released: AtomicBool,
}

impl Slot {
    pub fn release(&self) {
        if !self.released.swap(true, Ordering::AcqRel) {
            self.table.live.fetch_sub(1, Ordering::AcqRel);
        }
    }
}

impl Drop for Slot {
    fn drop(&mut self) {
        self.release();
    }
}

/// One (doc, principal) connection; freed once, on release or drop.
pub struct Lease {
    table: Arc<ConnectionTable>,
    key: (String, String),
    released: AtomicBool,
}

impl Lease {
    pub fn release(&self) {
        if self.released.swap(true, Ordering::AcqRel) {
            return;
        }
        let mut counts = lock(&self.table.counts);
        match counts.get_mut(&self.key) {
            Some(count) if *count > 1 => *count -= 1,
            _ => {
                counts.remove(&self.key);
            }
        }
    }
}

impl Drop for Lease {
    fn drop(&mut self) {
        self.release();
    }
}

//! Kestrel's MaxConcurrentUpgradedConnections. Go wraps every handler's
//! Hijack; here only the sync endpoint upgrades, so it takes a slot itself
//! before each upgrade, the ones it accepts only to close too. Past the
//! limit the upgrade is an empty 500 that keeps the connection.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};

pub struct UpgradeLimit {
    max: i64,
    open: AtomicI64,
}

impl UpgradeLimit {
    pub fn new(max: i64) -> Self {
        Self {
            max,
            open: AtomicI64::new(0),
        }
    }

    /// None past the limit.
    pub fn try_take(self: &Arc<Self>) -> Option<UpgradeSlot> {
        if self.open.fetch_add(1, Ordering::AcqRel) + 1 > self.max {
            self.open.fetch_sub(1, Ordering::AcqRel);
            return None;
        }
        Some(UpgradeSlot {
            limit: Arc::clone(self),
            released: AtomicBool::new(false),
        })
    }
}

/// One upgraded socket; freed once, when the socket closes.
pub struct UpgradeSlot {
    limit: Arc<UpgradeLimit>,
    released: AtomicBool,
}

impl UpgradeSlot {
    pub fn release(&self) {
        if !self.released.swap(true, Ordering::AcqRel) {
            self.limit.open.fetch_sub(1, Ordering::AcqRel);
        }
    }
}

impl Drop for UpgradeSlot {
    fn drop(&mut self) {
        self.release();
    }
}

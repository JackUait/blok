//! The memory budget of one engine. A call is charged every byte it
//! allocates, as Jint's LimitMemory charges every allocation of an entry:
//! churn, not what is still held. A realloc is charged its growth. Loading
//! the bundle is charged what the engine holds instead: QuickJS's parser
//! allocates about 30 MiB to load what Jint loads in 8.4 MiB, and C# floors
//! the budget at 8 MiB with 9 MiB measured to load. A budget hit cannot be
//! caught by JS; QuickJS's own memory limit throws an ordinary error a `try`
//! can swallow.
// Unsafe code, with engine.rs's stack limit: rquickjs's `Allocator` is an
// unsafe trait, and its hook is the one place that sees every allocation.
#![allow(unsafe_code)]

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use rquickjs::allocator::{Allocator, RustAllocator};

/// What an armed budget charges.
#[derive(Clone, Copy)]
pub(crate) enum Charge {
    /// Every byte allocated since arming: a call.
    Allocated,
    /// Growth of the bytes held since arming: a load.
    Held,
}

/// The shared count. `limit` 0 means no limit.
#[derive(Clone, Default)]
pub(crate) struct Budget(Arc<State>);

#[derive(Default)]
struct State {
    held: AtomicUsize,
    spent: AtomicUsize,
    limit: AtomicUsize,
    held_charge: AtomicBool,
    over: AtomicBool,
}

impl Budget {
    /// Allows `budget` more bytes, charged as `charge` says.
    pub(crate) fn arm(&self, budget: i64, charge: Charge) {
        let budget = usize::try_from(budget).unwrap_or(usize::MAX);
        self.0.over.store(false, Ordering::Relaxed);
        self.0.spent.store(0, Ordering::Relaxed);
        let limit = match charge {
            Charge::Allocated => budget,
            Charge::Held => self.0.held.load(Ordering::Relaxed).saturating_add(budget),
        };
        self.0
            .held_charge
            .store(matches!(charge, Charge::Held), Ordering::Relaxed);
        self.0.limit.store(limit.max(1), Ordering::Relaxed);
    }

    /// Lifts the limit. Returns whether the run went over it.
    pub(crate) fn disarm(&self) -> bool {
        self.0.limit.store(0, Ordering::Relaxed);
        self.0.over.swap(false, Ordering::Relaxed)
    }

    pub(crate) fn over(&self) -> bool {
        self.0.over.load(Ordering::Relaxed)
    }

    /// False, and marks the run over budget, when `more` bytes do not fit.
    fn admit(&self, more: usize) -> bool {
        let limit = self.0.limit.load(Ordering::Relaxed);
        if limit == 0 {
            return true;
        }
        let charged = if self.0.held_charge.load(Ordering::Relaxed) {
            self.0.held.load(Ordering::Relaxed)
        } else {
            self.0.spent.fetch_add(more, Ordering::Relaxed)
        };
        if charged.saturating_add(more) > limit {
            self.0.over.store(true, Ordering::Relaxed);
            return false;
        }
        true
    }

    pub(crate) fn allocator(&self) -> CountingAllocator {
        CountingAllocator {
            budget: self.clone(),
        }
    }
}

/// `RustAllocator` that charges the budget and counts the bytes it holds.
pub(crate) struct CountingAllocator {
    budget: Budget,
}

impl CountingAllocator {
    fn added(&self, ptr: *mut u8) -> *mut u8 {
        if !ptr.is_null() {
            // SAFETY: ptr was just returned by RustAllocator.
            let size = unsafe { RustAllocator::usable_size(ptr) };
            self.budget.0.held.fetch_add(size, Ordering::Relaxed);
        }
        ptr
    }
}

// SAFETY: every call goes to RustAllocator, which upholds the contract; the
// count only reads sizes of pointers RustAllocator owns.
unsafe impl Allocator for CountingAllocator {
    fn alloc(&mut self, size: usize) -> *mut u8 {
        if !self.budget.admit(size) {
            return std::ptr::null_mut();
        }
        let ptr = RustAllocator.alloc(size);
        self.added(ptr)
    }

    fn calloc(&mut self, count: usize, size: usize) -> *mut u8 {
        if !self.budget.admit(count.saturating_mul(size)) {
            return std::ptr::null_mut();
        }
        let ptr = RustAllocator.calloc(count, size);
        self.added(ptr)
    }

    unsafe fn dealloc(&mut self, ptr: *mut u8) {
        // SAFETY: the caller passes a pointer this allocator returned.
        let size = unsafe { RustAllocator::usable_size(ptr) };
        self.budget.0.held.fetch_sub(size, Ordering::Relaxed);
        unsafe { RustAllocator.dealloc(ptr) }
    }

    unsafe fn realloc(&mut self, ptr: *mut u8, new_size: usize) -> *mut u8 {
        if ptr.is_null() {
            return self.alloc(new_size);
        }
        // SAFETY: the caller passes a pointer this allocator returned.
        let old = unsafe { RustAllocator::usable_size(ptr) };
        if new_size > old && !self.budget.admit(new_size - old) {
            return std::ptr::null_mut();
        }
        let fresh = unsafe { RustAllocator.realloc(ptr, new_size) };
        if !fresh.is_null() {
            self.budget.0.held.fetch_sub(old, Ordering::Relaxed);
            self.added(fresh);
        }
        fresh
    }

    unsafe fn usable_size(ptr: *mut u8) -> usize {
        // SAFETY: the caller passes a pointer this allocator returned.
        unsafe { RustAllocator::usable_size(ptr) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIB: usize = 1 << 20;

    /// Allocates 1 MiB blocks until the budget refuses one; returns them.
    fn fill(allocator: &mut CountingAllocator) -> Vec<*mut u8> {
        let mut blocks = Vec::new();
        for _ in 0..1024 {
            let ptr = allocator.alloc(MIB);
            if ptr.is_null() {
                break;
            }
            blocks.push(ptr);
        }
        blocks
    }

    fn free(allocator: &mut CountingAllocator, blocks: Vec<*mut u8>) {
        for ptr in blocks {
            // SAFETY: each pointer came from this allocator's alloc.
            unsafe { allocator.dealloc(ptr) };
        }
    }

    #[test]
    fn the_budget_bounds_what_a_call_can_hold() {
        let budget = Budget::default();
        let mut allocator = budget.allocator();
        budget.arm(64 << 20, Charge::Allocated);
        let blocks = fill(&mut allocator);
        let held = budget.0.held.load(Ordering::Relaxed);
        assert!(held <= 64 * MIB, "held {held} bytes past a 64 MiB budget");
        assert!(
            blocks.len() >= 60,
            "refused early, after {} MiB",
            blocks.len()
        );
        assert!(budget.disarm(), "the run is not marked over its budget");
        free(&mut allocator, blocks);
        assert_eq!(budget.0.held.load(Ordering::Relaxed), 0);
    }

    // Each engine has its own count, so one engine's allocations cannot use
    // up another's budget.
    #[test]
    fn one_engines_allocations_are_not_charged_to_another() {
        let (busy, quiet) = (Budget::default(), Budget::default());
        let (mut busy_alloc, mut quiet_alloc) = (busy.allocator(), quiet.allocator());
        busy.arm(64 << 20, Charge::Allocated);
        quiet.arm(64 << 20, Charge::Allocated);
        let hog = fill(&mut busy_alloc);
        let mine = fill(&mut quiet_alloc);
        assert!(
            mine.len() >= 60,
            "the quiet engine got only {} MiB",
            mine.len()
        );
        busy.disarm();
        free(&mut busy_alloc, hog);
        free(&mut quiet_alloc, mine);
    }
}

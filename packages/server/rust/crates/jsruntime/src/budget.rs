//! The memory budget of one engine. A call is charged every byte it
//! allocates, scaled to Jint's count (CHARGE_NUM), as Jint's LimitMemory
//! charges every allocation of an entry: churn, not what is still held. A
//! realloc is charged its growth. Loading
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

/// QuickJS allocates 0.29x to 0.96x what Jint charges for the same call
/// (1.35x on a 3 MiB URL to Markdown; all measured), so a call is charged
/// CHARGE_NUM/CHARGE_DEN of what it allocates. 5/2 is a factor that makes
/// the eleven big documents of ops.json convert or stop as in C# at 64 MiB
/// and at 512 MiB: it must lie between 2.25 (big.url.image.markdown stops at
/// 64 MiB) and 2.73 (big.plain.text converts at 64 MiB).
const CHARGE_NUM: usize = 5;
const CHARGE_DEN: usize = 2;

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
            Charge::Allocated => budget / CHARGE_NUM * CHARGE_DEN,
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

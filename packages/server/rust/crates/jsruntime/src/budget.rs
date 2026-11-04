//! Counts the bytes one engine holds, so a budget hit cannot be caught by JS.
//! QuickJS's own memory limit throws an ordinary error a `try` can swallow.
// The only unsafe code in the crate: rquickjs's `Allocator` is an unsafe
// trait, and its hook is the one place that sees every allocation.
#![allow(unsafe_code)]

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use rquickjs::allocator::{Allocator, RustAllocator};

/// The shared count. `limit` 0 means no limit.
#[derive(Clone, Default)]
pub(crate) struct Budget(Arc<State>);

#[derive(Default)]
struct State {
    held: AtomicUsize,
    limit: AtomicUsize,
    over: AtomicBool,
}

impl Budget {
    /// Allows `budget` more bytes than the engine holds now.
    pub(crate) fn arm(&self, budget: i64) {
        let budget = usize::try_from(budget).unwrap_or(usize::MAX);
        let held = self.0.held.load(Ordering::Relaxed);
        self.0.over.store(false, Ordering::Relaxed);
        self.0
            .limit
            .store(held.saturating_add(budget).max(1), Ordering::Relaxed);
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
        if limit != 0 && self.0.held.load(Ordering::Relaxed).saturating_add(more) > limit {
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

/// `RustAllocator` with a count of the bytes it holds.
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

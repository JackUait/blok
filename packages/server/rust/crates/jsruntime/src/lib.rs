//! Runs the Blok server runtime bundle in QuickJS (rquickjs), as Go's
//! `internal/jsruntime` runs it in goja and C# `JintBlokRuntime` in Jint.
//!
//! QuickJS engines are not `Send`, so every engine lives on its own thread
//! (see `worker.rs`) with a native stack sized for the bundle's recursion.

mod budget;
mod engine;
mod guard;
mod pool;
mod runtime;
mod worker;

pub use pool::{
    ConstraintError, DEFAULT_MEMORY_BUDGET, DEFAULT_TIMEOUT, Failure, InvokeError, Kind,
    MINIMUM_MEMORY_BUDGET, MINIMUM_TIMEOUT, Options, Pool, PoolError, StartupCause, StartupError,
    validate_constraints,
};
pub use runtime::{Error, JsError, Runtime, Stop};

#[cfg(test)]
mod csharp_runtime_test;
#[cfg(test)]
mod guard_test;
#[cfg(test)]
mod ops_fixture_test;
#[cfg(test)]
mod pool_test;
#[cfg(test)]
mod runtime_test;
#[cfg(test)]
mod scripts_fixture_test;
#[cfg(test)]
mod test_json;

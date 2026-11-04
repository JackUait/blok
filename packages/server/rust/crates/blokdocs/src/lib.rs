//! Converts saved Blok documents with Blok's own JavaScript, as the C#
//! Blok.Server.Documents package does: Markdown, HTML and plain text out,
//! Markdown and HTML in, translation texts, page indexes and id remaps. Port
//! of Go `blokdocs`.
//!
//! A Converter runs the embedded runtime bundle on a `blok_jsruntime::Pool`.
//! Requests are built and answers re-serialized the way System.Text.Json does,
//! so a Rust host stores the same bytes a C# host stores. Two shared fixtures
//! under test/unit/server-conformance/fixtures/documents pin that.

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use blok_jsruntime::{InvokeError, Pool};

mod answer;
mod converter;
mod errors;
mod types;

pub use blok_jsruntime::{ConstraintError, PoolError, StartupCause, StartupError};
pub use converter::{Converter, PageHref, Pages, looks_like_a_document};
pub use errors::{AnswerError, ConversionError, Error, Reason};
pub use types::{
    ACTION_DEGRADED, ACTION_DROPPED, Degradation, ImportConversion, MarkdownConversion, PageIcon,
    PageIndex, PageInfo, PageOwnerEdge, PageReference, PageTextEntry, PlainTextConversion,
    Validation,
};

/// Floors a host may not go below, as C# BlokDocuments publishes them.
pub const MINIMUM_MEMORY_BUDGET: i64 = blok_jsruntime::MINIMUM_MEMORY_BUDGET;
pub const MINIMUM_TIMEOUT: Duration = blok_jsruntime::MINIMUM_TIMEOUT;

/// Configures `new`. Zero values take the defaults.
#[derive(Clone, Copy, Debug, Default)]
pub struct Options {
    /// Bounds concurrent conversions. 0 means max(1, min(cores, 4)).
    pub pool_size: usize,
    /// The wall-clock budget of one conversion. 0 means 10 s. QuickJS checks
    /// it between JavaScript instructions, so a long native builtin (a
    /// backtracking regex) overruns it.
    pub timeout: Duration,
    /// The growth in bytes one conversion's engine may hold. 0 means 512 MiB.
    pub memory_budget: i64,
    /// Converts a long article in the background once the pool is built, so
    /// the first request does not pay for cold paths. `new` does not wait for
    /// it, and its failure is ignored.
    pub warm_up: bool,
}

/// The future one runtime call returns.
pub type InvokeFuture<'a> = Pin<Box<dyn Future<Output = Result<String, InvokeError>> + Send + 'a>>;

/// Runs one bundle operation; blokserver's shared engine pool is one. A zero
/// timeout means the runtime's own.
pub trait Runtime: Send + Sync + 'static {
    fn invoke<'a>(&'a self, op: &'a str, input: &'a str, timeout: Duration) -> InvokeFuture<'a>;
}

impl Runtime for Pool {
    fn invoke<'a>(&'a self, op: &'a str, input: &'a str, timeout: Duration) -> InvokeFuture<'a> {
        Box::pin(Pool::invoke(self, op, input, timeout))
    }
}

/// Builds a converter over a fresh engine pool. Building one is expensive,
/// so hold it for the life of the process. Blocks while the engines load.
pub fn new(options: Options) -> Result<Converter, PoolError> {
    let pool = Pool::new(blok_jsruntime::Options {
        pool_size: options.pool_size,
        timeout: options.timeout,
        memory_budget: options.memory_budget,
    })?;
    let converter = Converter::with_runtime(Box::new(pool));
    if options.warm_up {
        converter.warm_up_in_background();
    }
    Ok(converter)
}

/// Builds a converter over a runtime the caller holds, as C#'s
/// BlokDocumentConverter takes the registered IBlokRuntime.
pub fn new_on_runtime(runtime: impl Runtime) -> Converter {
    Converter::with_runtime(Box::new(runtime))
}

#[cfg(test)]
mod converter_test;
#[cfg(test)]
mod csharp_converter_test;
#[cfg(test)]
mod csharp_pages_test;
#[cfg(test)]
mod csharp_report_tabs_test;
#[cfg(test)]
mod csharp_table_test;
#[cfg(test)]
mod csharp_title_inspection_test;
#[cfg(test)]
mod host_fixture_test;
#[cfg(test)]
mod looks_test;
#[cfg(test)]
mod test_json;
#[cfg(test)]
mod warmup_test;

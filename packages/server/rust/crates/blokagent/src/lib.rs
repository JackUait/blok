//! Runs agent command batches on saved Blok documents, as the C#
//! Blok.Server.Agent executor does: the planning and the edits run in Blok's
//! own JavaScript bundle, and this crate carries the host's side of the
//! wire, the page callbacks and the session steps. Port of Go `blokagent`.
//!
//! Every request and answer is written the way System.Text.Json writes it,
//! so a Rust host sends and stores the same bytes as a C# host. The shared
//! fixture test/unit/server-conformance/fixtures/agent/host.json pins that.
//!
//! An executor built with `Rooms` runs batches on live collaboration
//! rooms; without them `execute_in_room` answers COMMAND_UNAVAILABLE, as a
//! C# executor built without rooms does.

mod cancel;
mod errors;
mod executor;
mod pageaction;
mod pagecreate;
mod room;
mod roomhistory;
mod roomreplay;
mod session;
mod translate;
mod types;
mod versions;
mod wire;

pub use cancel::{Cancel, CancelReason};
pub use errors::Error;
pub use executor::{Executor, FactoryOptions, InvokeFuture, Invoker};
pub use room::Rooms;
pub use session::Session;
pub use types::{
    Actor, Execution, HostFuture, Options, PageCreator, PageLocation, PageTarget, StoredPage,
};

#[cfg(test)]
mod computed_read_test;
#[cfg(test)]
mod executor_test;
#[cfg(test)]
mod formula_dates_test;
#[cfg(test)]
mod formula_limits_test;
#[cfg(test)]
mod host_fixture_test;
#[cfg(test)]
mod normalize_test;
#[cfg(test)]
mod parity_test;
#[cfg(test)]
mod room_test;
#[cfg(test)]
mod roomharness_test;
#[cfg(test)]
mod scenario_test;
#[cfg(test)]
mod test_json;
#[cfg(test)]
mod test_support;
#[cfg(test)]
mod translate_test;

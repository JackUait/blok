//! The Blok server as a library: the analogue of the C# AddBlokServer and
//! MapBlokServer. A host builds Options, calls Server::new, and mounts
//! handler.

mod collab;
mod contenttypes;
mod disposition;
mod handlers;
mod localfile;
mod log;
mod options;
mod outbound;
mod server;
mod upload;

#[cfg(test)]
mod testutil;

#[cfg(test)]
mod agent_test;
#[cfg(test)]
mod collab_test;
#[cfg(test)]
mod collabstore_test;
#[cfg(test)]
mod documents_test;
#[cfg(test)]
mod purge_errors_test;
#[cfg(test)]
mod sync_test;

#[cfg(test)]
#[path = "disposition_test.rs"]
mod disposition_test;

pub use blok_auth::{Authorization, User};
pub use collab::{CollabError, PurgeOutcome};
pub use log::{COLLAB_LOG_CATEGORY, HOST_LOG_CATEGORY, Level, Logger};
pub use options::{Clock, MINIMUM_SECRET_LENGTH, Options, OptionsError, format_time_span};
pub use server::{Conformance, RateKey, Server, user_from};

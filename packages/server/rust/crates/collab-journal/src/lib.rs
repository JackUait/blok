//! The per-document operation journal: the record codec, the lineage
//! ledger and the local store (C# CollabJournalCodec.cs,
//! CollabLineageLedger.cs, LocalCollabOperationStore.cs). The bytes are the
//! same as C# writes, so either server can open the other's directory. Port
//! of Go `internal/collab/journal`. The hold is flock(2) on Unix and the
//! open's share mode on Windows.

mod codec;
mod error;
mod files;
mod ledger;
#[cfg_attr(windows, path = "lock_windows.rs")]
mod lock;
mod store;

pub use codec::*;
pub use error::Error;
pub use files::*;
pub use ledger::*;
pub use store::*;

#[cfg(test)]
mod codec_test;
#[cfg(test)]
mod csharp_codec_test;
#[cfg(test)]
mod durability_law_test;
#[cfg(test)]
mod files_test;
#[cfg(test)]
mod fixture;
#[cfg(test)]
mod ledger_test;
#[cfg(test)]
mod store_scenario_test;
#[cfg(test)]
mod store_test;

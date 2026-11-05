//! The managed Yjs engine, ported from Go `internal/yjs` (and C#
//! Blok.Server/Yjs): the v1 update codec, the struct store, YATA
//! integration, pending updates, garbage collection and the Y.Map / Y.Array /
//! Y.Text types collab uses.
//!
//! Order matters wherever C# enumerates a Dictionary (insertion order), so
//! the engine keeps ordered vectors there and never iterates a HashMap where
//! the order could reach bytes or exports.
//!
//! Items live in an arena inside the document's store and point at each
//! other by index. Shared types are handles ([`TypeRef`]) that keep their
//! identity from prelim to integrated, as Go's pointers do.

mod content;
mod decode;
mod deleteset;
mod doc;
mod encode;
mod integrator;
mod item;
mod store;
mod text;
mod types;
mod yata;

#[cfg(test)]
mod test_support;

#[cfg(test)]
mod capture_test;
#[cfg(test)]
mod csharp_test;
#[cfg(test)]
mod decode_test;
#[cfg(test)]
mod headid_test;
#[cfg(test)]
mod integration_test;
#[cfg(test)]
mod pending_test;
#[cfg(test)]
mod scenario_test;
#[cfg(test)]
mod store_test;
#[cfg(test)]
mod structstore_test;
#[cfg(test)]
mod write_test;

use std::fmt;

pub use blok_lib0::FormatError;
pub use content::{Content, FormatContent, Subdoc};
pub use decode::{
    ClientStructs, DEFAULT_INSPECT_DEPTH, DecodedStruct, DecodedUpdate, Inspection, StructKind,
    Verdict, decode, inspect,
};
pub use deleteset::{DeleteRange, DeleteSet};
pub use doc::{ApplyResult, Doc, Options, Outcome, Subscription, Transaction, UpdateEvent};
pub use store::{StateVector, decode_state_vector};
pub use text::{Delta, Marks, marks};
pub use types::{
    Array, In, Map, MapEntry, Out, Text, TypeKind, TypeRef, XmlElement, XmlFragment, XmlHook,
    XmlText,
};

/// How deep a raw JSON payload (refs 2, 5, 6) may nest. C# validates with
/// JsonDocument at MaxDepth 512.
pub const JSON_MAX_DEPTH: usize = 512;

/// One clock tick of one client.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Id {
    pub client: u64,
    pub clock: u64,
}

impl Id {
    pub fn new(client: u64, clock: u64) -> Id {
        Id { client, clock }
    }
}

impl fmt::Display for Id {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}", self.client, self.clock)
    }
}

/// What every struct has: its first id and its clock span.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Header {
    pub id: Id,
    pub length: usize,
}

impl Header {
    /// Wraps, as C#'s unchecked ulong and Go's uint64 do: a length-0
    /// struct at clock 0 ends at 2^64-1.
    pub fn last_id(&self) -> Id {
        Id::new(
            self.id.client,
            self.id
                .clock
                .wrapping_add(self.length as u64)
                .wrapping_sub(1),
        )
    }

    pub fn end(&self) -> u64 {
        self.id.clock + self.length as u64
    }
}

/// An engine invariant broken by its caller or by an update that slipped
/// past the checks (InvalidOperationException in C#).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EngineError {
    pub reason: String,
}

impl EngineError {
    pub fn new(reason: impl Into<String>) -> EngineError {
        EngineError {
            reason: reason.into(),
        }
    }
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.reason)
    }
}

impl std::error::Error for EngineError {}

/// Either a malformed input or a broken engine invariant.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    Format(FormatError),
    Engine(EngineError),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Format(err) => err.fmt(f),
            Error::Engine(err) => err.fmt(f),
        }
    }
}

impl std::error::Error for Error {}

impl From<FormatError> for Error {
    fn from(err: FormatError) -> Error {
        Error::Format(err)
    }
}

impl From<EngineError> for Error {
    fn from(err: EngineError) -> Error {
        Error::Engine(err)
    }
}

pub(crate) type EngineResult<T> = Result<T, EngineError>;

macro_rules! fail {
    ($($arg:tt)*) => {
        return Err($crate::EngineError::new(format!($($arg)*)))
    };
}
pub(crate) use fail;

macro_rules! format_err {
    ($($arg:tt)*) => {
        $crate::FormatError::new(format!($($arg)*))
    };
}
pub(crate) use format_err;

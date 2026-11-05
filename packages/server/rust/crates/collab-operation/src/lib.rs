//! The journal's record types (C# CollabOperation.cs), shared by the codec,
//! the stores and the room.

use std::fmt;
use std::time::SystemTime;

/// How an operation reached the server. The value is the byte on disk, and
/// a decoded byte may be any value, so this is not a closed enum.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Source(pub u8);

impl Source {
    pub const CLIENT_V2: Source = Source(0);
    pub const CLIENT_V1: Source = Source(1);
    pub const HTTP_EDIT: Source = Source(2);

    /// Enum.IsDefined.
    pub fn defined(self) -> bool {
        self.0 <= Self::HTTP_EDIT.0
    }
}

impl fmt::Display for Source {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match *self {
            Self::CLIENT_V2 => f.write_str("ClientV2"),
            Self::CLIENT_V1 => f.write_str("ClientV1"),
            Self::HTTP_EDIT => f.write_str("HttpEdit"),
            // An undefined value prints as its number, as a C# enum does.
            Source(other) => write!(f, "{other}"),
        }
    }
}

/// CollabDocumentHead.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Head {
    pub format: i32,
    pub epoch: i64,
    pub lineage: String,
    pub durable_through: u64,
}

/// CollabOperationCheckpoint.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Checkpoint {
    pub through: u64,
    pub state: Vec<u8>,
}

/// One committed operation. `committed_at` has tick (100 ns) precision.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Record {
    pub operation_id: String,
    pub sequence: u64,
    pub committed_at: SystemTime,
    pub actor_id: Option<String>,
    pub source: Source,
    pub update: Vec<u8>,
    pub digest: Vec<u8>,
}

/// An operation about to be appended.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Candidate {
    pub operation_id: String,
    pub actor_id: Option<String>,
    pub source: Source,
    pub update: Vec<u8>,
    pub digest: Vec<u8>,
}

/// CollabOperationLookupOutcome.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LookupOutcome {
    NotCommitted,
    Duplicate,
    Conflict,
}

/// CollabOperationLookup.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Lookup {
    pub outcome: LookupOutcome,
    pub sequence: u64,
}

/// CollabOperationAppendOutcome.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AppendOutcome {
    Committed,
    Duplicate,
    Conflict,
}

/// CollabOperationAppendResult.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AppendResult {
    pub outcome: AppendOutcome,
    pub sequence: u64,
}

/// CollabOperationReset.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reset {
    pub format: i32,
    pub epoch: i64,
    pub lineage: String,
    pub baseline: Vec<Vec<u8>>,
}

/// CollabOperationOpenResult.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpenResult {
    pub head: Option<Head>,
    pub baseline: Vec<Vec<u8>>,
    pub checkpoint: Option<Checkpoint>,
    pub tail: Vec<Record>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_bytes_are_the_bytes_on_disk() {
        assert_eq!(Source::CLIENT_V2.0, 0);
        assert_eq!(Source::CLIENT_V1.0, 1);
        assert_eq!(Source::HTTP_EDIT.0, 2);
    }

    #[test]
    fn source_is_defined_only_for_the_three_named_values() {
        assert!(Source(0).defined());
        assert!(Source(1).defined());
        assert!(Source(2).defined());
        assert!(!Source(3).defined());
        assert!(!Source(255).defined());
    }

    #[test]
    fn names_a_source_or_prints_the_number_of_an_undefined_one() {
        assert_eq!(Source::CLIENT_V2.to_string(), "ClientV2");
        assert_eq!(Source::CLIENT_V1.to_string(), "ClientV1");
        assert_eq!(Source::HTTP_EDIT.to_string(), "HttpEdit");
        assert_eq!(Source(7).to_string(), "7");
        assert_eq!(Source(255).to_string(), "255");
    }
}

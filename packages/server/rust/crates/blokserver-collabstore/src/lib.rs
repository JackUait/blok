//! The seams a host fills for collaboration: its own operation store (C#
//! UseCollabOperationStore<T>) and an activity observer
//! (UseCollabActivityObserver<T>). Port of Go `blokserver/collabstore`.
//!
//! Every guarantee the sync protocol makes to a client rests on the store:
//! read ICollabOperationStore's remarks in the C# server before writing
//! one. A store that answers `as_history` serves the history routes; one
//! that answers `as_purge` can purge documents.

/// The store seams: ICollabOperationStore, ICollabOperationSession,
/// ICollabOperationPurgeStore and ICollabOperationHistoryStore.
pub use blok_collab_room::{
    Headers, HistoryStore, Opened, OperationSession, OperationStore, PurgeStore, Records,
};

/// What a store's calls fail with; room errors carry it as
/// `blok_collab_room::Error::Journal`. A checkpoint that fails with
/// `FenceLost` (CollabOperationFenceLostException), an out-of-range
/// `Argument` (ArgumentOutOfRangeException) or `InvalidData`
/// (InvalidDataException) fails the room at once; any other error is
/// retried.
pub use blok_collab_journal::Error as StoreError;

/// CollabDocumentOpenOutcome (a session comes back only with Opened),
/// CollabDocumentPurgeOutcome and CollabLineageDeleteOutcome.
pub use blok_collab_journal::{LineageDeleteOutcome, OpenOutcome, PurgeOutcome};

/// CollabLineageInfo and CollabRecordHeader. A store's calls take the
/// journal's cancel context.
pub use blok_collab_journal::{Context, LineageInfo, RecordHeader};

/// CollabOperationSource, the byte a store keeps per record, and the records
/// a session reads and writes.
pub use blok_collab_operation::{
    AppendOutcome, AppendResult, Candidate, Checkpoint, Head, Lookup, LookupOutcome, OpenResult,
    Record, Reset, Source,
};

/// ICollabActivityObserver and CollabActivityKind. Calls come off the
/// room's lane, one at a time per room, in the order the room made them.
/// Without one a room makes no calls at all.
pub use blok_collab_room::{ActivityKind, ActivityObserver};

/// ICollabRecordNotes, CollabRecordNote and InMemoryCollabRecordNotes: one
/// note per journal record, written right after the append but not
/// atomically with it. Blok never deletes notes; delete a document's notes
/// when you purge it.
pub use blok_collab_room::{MemoryRecordNotes, RecordNote, RecordNotesStore};

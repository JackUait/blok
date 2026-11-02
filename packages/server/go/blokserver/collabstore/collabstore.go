// Package collabstore names the seams a host fills for collaboration: its
// own operation store (C# UseCollabOperationStore<T>), and an activity
// observer (UseCollabActivityObserver<T>). Set them on
// blokserver.Options.CollabOperationStore and CollabActivityObserver.
//
// Every guarantee the sync protocol makes to a client rests on the store:
// read ICollabOperationStore's remarks in the C# server before writing one.
// A store that also implements HistoryStore serves the history routes; one
// that also implements PurgeStore can purge documents.
package collabstore

import (
	"github.com/JackUait/blok/packages/server/go/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/internal/collab/room"
)

// The store seams: ICollabOperationStore, ICollabOperationSession,
// ICollabOperationPurgeStore and ICollabOperationHistoryStore.
type (
	OperationStore   = room.OperationStore
	OperationSession = room.OperationSession
	PurgeStore       = room.PurgeStore
	HistoryStore     = room.HistoryStore
)

// ErrFenceLost is CollabOperationFenceLostException: a session whose
// document another process took returns it (wrapped or not), and the room
// fails instead of retrying.
var ErrFenceLost = journal.ErrFenceLost

// ArgumentError is ArgumentException; with OutOfRange it is
// ArgumentOutOfRangeException. InvalidDataError is InvalidDataException.
// A checkpoint that fails with ErrFenceLost, an out-of-range ArgumentError
// or an InvalidDataError fails the room at once; any other error is retried.
type (
	ArgumentError    = journal.ArgumentError
	InvalidDataError = journal.InvalidDataError
)

// OpenOutcome is CollabDocumentOpenOutcome. A session comes back only with
// Opened.
type OpenOutcome = journal.OpenOutcome

const (
	Opened                = journal.Opened
	DocumentOpenElsewhere = journal.DocumentOpenElsewhere
	DocumentPurged        = journal.DocumentPurged
)

// PurgeOutcome is CollabDocumentPurgeOutcome.
type PurgeOutcome = journal.PurgeOutcome

const (
	Purged             = journal.Purged
	PurgeOpenElsewhere = journal.PurgeOpenElsewhere
)

// LineageDeleteOutcome is CollabLineageDeleteOutcome.
type LineageDeleteOutcome = journal.LineageDeleteOutcome

const (
	LineageDeleted  = journal.LineageDeletedOutcome
	LineageNotFound = journal.LineageNotFound
	LineageCurrent  = journal.LineageCurrent
	LineagePurged   = journal.LineagePurged
)

// LineageInfo is CollabLineageInfo; RecordHeader is CollabRecordHeader.
type (
	LineageInfo  = journal.LineageInfo
	RecordHeader = journal.RecordHeader
)

// Source is CollabOperationSource, the byte a store keeps per record.
type Source = operation.Source

const (
	SourceClientV2 = operation.SourceClientV2
	SourceClientV1 = operation.SourceClientV1
	SourceHTTPEdit = operation.SourceHTTPEdit
)

// The records a session reads and writes: CollabDocumentHead,
// CollabOperationCheckpoint, CollabOperationRecord, CollabOperationCandidate,
// CollabOperationLookup, CollabOperationAppendResult, CollabOperationReset
// and CollabOperationOpenResult.
type (
	Head         = operation.Head
	Checkpoint   = operation.Checkpoint
	Record       = operation.Record
	Candidate    = operation.Candidate
	Lookup       = operation.Lookup
	AppendResult = operation.AppendResult
	Reset        = operation.Reset
	OpenResult   = operation.OpenResult
)

// LookupOutcome is CollabOperationLookupOutcome.
type LookupOutcome = operation.LookupOutcome

const (
	NotCommitted    = operation.NotCommitted
	LookupDuplicate = operation.LookupDuplicate
	LookupConflict  = operation.LookupConflict
)

// AppendOutcome is CollabOperationAppendOutcome.
type AppendOutcome = operation.AppendOutcome

const (
	Committed       = operation.Committed
	AppendDuplicate = operation.AppendDuplicate
	AppendConflict  = operation.AppendConflict
)

// ActivityObserver is ICollabActivityObserver. Calls come off the room's
// lane, one at a time per room, in the order the room made them. Without
// one a room makes no calls at all.
type ActivityObserver = room.ActivityObserver

// ActivityKind is CollabActivityKind.
type ActivityKind = room.ActivityKind

const (
	ActivityJoined = room.ActivityJoined
	ActivityActive = room.ActivityActive
	ActivityEdited = room.ActivityEdited
	ActivityLeft   = room.ActivityLeft
)

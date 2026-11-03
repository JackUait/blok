// Package operation holds the journal's record types (C# CollabOperation.cs),
// shared by the codec, the stores and the room.
package operation

import (
	"strconv"
	"time"
)

// Source is how an operation reached the server. The value is the byte on disk.
type Source byte

const (
	SourceClientV2 Source = 0
	SourceClientV1 Source = 1
	SourceHTTPEdit Source = 2
)

// Defined is Enum.IsDefined.
func (s Source) Defined() bool {
	return s <= SourceHTTPEdit
}

func (s Source) String() string {
	switch s {
	case SourceClientV2:
		return "ClientV2"
	case SourceClientV1:
		return "ClientV1"
	case SourceHTTPEdit:
		return "HttpEdit"
	}
	return "Source(" + strconv.Itoa(int(s)) + ")"
}

// Head is CollabDocumentHead.
type Head struct {
	Format         int32
	Epoch          int64
	Lineage        string
	DurableThrough uint64
}

// Checkpoint is CollabOperationCheckpoint.
type Checkpoint struct {
	Through uint64
	State   []byte
}

// Record is one committed operation. CommittedAt has tick precision.
type Record struct {
	OperationID string
	Sequence    uint64
	CommittedAt time.Time
	ActorID     *string
	Source      Source
	Update      []byte
	Digest      []byte
}

// Candidate is an operation about to be appended.
type Candidate struct {
	OperationID string
	ActorID     *string
	Source      Source
	Update      []byte
	Digest      []byte
}

// LookupOutcome is CollabOperationLookupOutcome.
type LookupOutcome int

const (
	NotCommitted LookupOutcome = iota
	LookupDuplicate
	LookupConflict
)

// Lookup is CollabOperationLookup.
type Lookup struct {
	Outcome  LookupOutcome
	Sequence uint64
}

// AppendOutcome is CollabOperationAppendOutcome.
type AppendOutcome int

const (
	Committed AppendOutcome = iota
	AppendDuplicate
	AppendConflict
)

// AppendResult is CollabOperationAppendResult.
type AppendResult struct {
	Outcome  AppendOutcome
	Sequence uint64
}

// Reset is CollabOperationReset.
type Reset struct {
	Format   int32
	Epoch    int64
	Lineage  string
	Baseline [][]byte
}

// OpenResult is CollabOperationOpenResult.
type OpenResult struct {
	Head       *Head
	Baseline   [][]byte
	Checkpoint *Checkpoint
	Tail       []Record
}

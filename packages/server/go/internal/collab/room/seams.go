// Package room is the collaboration room and its manager: C#
// CollabRoom.cs and CollabRoomManager.cs. A room is a single lane around one
// yjs.Doc; every doc access runs inside it. Methods suffixed Locked assume
// the lane is held and never re-enter it.
package room

import (
	"context"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/internal/collab/docendpoint"
	"github.com/JackUait/blok/packages/server/go/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// WorkingSetStore is ICollabWorkingSetStore; workingset.LocalStore and
// workingset.S3Store are both one.
type WorkingSetStore interface {
	Read(ctx context.Context, docID string) (*workingset.Set, error)
	Write(ctx context.Context, docID string, updates []byte, tag workingset.Tag) error
	Reset(ctx context.Context, docID string, tag workingset.Tag) error
	Retire(ctx context.Context, docID string) error
	Delete(ctx context.Context, docID string) error
}

// Endpoint is IDocEndpointClient.
type Endpoint interface {
	Load(ctx context.Context, docID string) (*docendpoint.Loaded, error)
	Save(ctx context.Context, docID string, outputData any, version *string, projection *docendpoint.Projection) (*string, error)
}

// Converter is ICollabDocConverter.
type Converter interface {
	Seed(ctx context.Context, doc *yjs.Doc, outputData *jsjson.Node) error
	Export(ctx context.Context, doc *yjs.Doc) (*jsjson.Object, error)
	ApplyOps(ctx context.Context, doc *yjs.Doc, ops []convert.EditOp) error
	MigrateRichText(ctx context.Context, doc *yjs.Doc) (int, error)
}

// OperationStore is ICollabOperationStore.
type OperationStore interface {
	// Open answers a session only for journal.Opened.
	Open(ctx context.Context, docID string) (journal.OpenOutcome, OperationSession, error)
}

// OperationSession is ICollabOperationSession. The room serialises its use.
type OperationSession interface {
	OpenResult() operation.OpenResult
	FindCommitted(ctx context.Context, operationID string, digest []byte) (operation.Lookup, error)
	Append(ctx context.Context, candidate operation.Candidate) (operation.AppendResult, error)
	WriteCheckpoint(ctx context.Context, checkpoint operation.Checkpoint) error
	Reset(ctx context.Context, reset operation.Reset) (operation.Head, error)
	Close() error
}

// PurgeStore is ICollabOperationPurgeStore.
type PurgeStore interface {
	Purge(ctx context.Context, docID string) (journal.PurgeOutcome, error)
}

// LocalJournal adapts the built-in journal.Store to OperationStore.
type LocalJournal struct{ *journal.Store }

func (j LocalJournal) Open(ctx context.Context, docID string) (journal.OpenOutcome, OperationSession, error) {
	outcome, session, err := j.Store.Open(ctx, docID)
	if session == nil {
		return outcome, nil, err
	}
	return outcome, session, err
}

// ActivityKind is CollabActivityKind.
type ActivityKind int

const (
	ActivityJoined ActivityKind = iota
	ActivityActive
	ActivityEdited
	ActivityLeft
)

func (k ActivityKind) String() string {
	switch k {
	case ActivityJoined:
		return "Joined"
	case ActivityActive:
		return "Active"
	case ActivityEdited:
		return "Edited"
	}
	return "Left"
}

// ActivityObserver is ICollabActivityObserver. Calls come off the room's
// lane, one at a time per room, in the order the room produced them.
type ActivityObserver interface {
	Record(ctx context.Context, docID, actorID string, at time.Time, kind ActivityKind) error
}

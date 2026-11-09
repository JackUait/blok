package room

import (
	"context"
	"sync"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
)

// RecordNote is CollabRecordNote: what kind of actor wrote one journal
// record. Kept beside the journal, never in it. Kind is "agent" for a write
// by the in-process agent executor and "person" for any other verified
// actor: a ticket's user is whatever the host minted, so its text never
// makes it an agent. A host that mints tickets for agents can rewrite the
// kind in its own Write. OnBehalfOf is "" when unknown.
type RecordNote struct {
	Kind       string
	OnBehalfOf string
}

// RecordNotes is ICollabRecordNotes: an optional store of one note per
// journal record, keyed by document, lineage and sequence. Without one,
// history answers carry no actor kinds.
//
// A note is written right after its record, inside the room's lane, within
// the commit timeout. It is not atomic with the journal: a crash, a timeout
// or an error in between loses that one note, and never fails the edit.
// Blok never deletes notes; delete a document's notes when you purge it.
type RecordNotes interface {
	Write(ctx context.Context, docID, lineage string, sequence uint64, note RecordNote) error
	// Read is every note of one lineage, by sequence.
	Read(ctx context.Context, docID, lineage string) (map[uint64]RecordNote, error)
}

// MemoryRecordNotes is InMemoryCollabRecordNotes: notes kept in memory, lost
// on restart.
type MemoryRecordNotes struct {
	mu    sync.Mutex
	notes map[[2]string]map[uint64]RecordNote
}

// NewMemoryRecordNotes makes an empty store.
func NewMemoryRecordNotes() *MemoryRecordNotes {
	return &MemoryRecordNotes{notes: map[[2]string]map[uint64]RecordNote{}}
}

func (m *MemoryRecordNotes) Write(_ context.Context, docID, lineage string, sequence uint64, note RecordNote) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := [2]string{docID, lineage}
	if m.notes[key] == nil {
		m.notes[key] = map[uint64]RecordNote{}
	}
	m.notes[key][sequence] = note
	return nil
}

func (m *MemoryRecordNotes) Read(_ context.Context, docID, lineage string) (map[uint64]RecordNote, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[uint64]RecordNote{}
	for sequence, note := range m.notes[[2]string{docID, lineage}] {
		out[sequence] = note
	}
	return out, nil
}

const (
	KindPerson = "person"
	KindAgent  = "agent"
)

// ClassifyActor is CollabActorKinds.Classify: nil when no actor is known.
// Only the in-process agent path passes agent: the id's text is never read,
// because a host may mint a person's ticket with any id, agent: ones too.
func ClassifyActor(actorID string, agent bool, onBehalfOf string) *RecordNote {
	if actorID == "" {
		return nil
	}
	if agent {
		return &RecordNote{Kind: KindAgent, OnBehalfOf: onBehalfOf}
	}
	return &RecordNote{Kind: KindPerson}
}

// Attribution is CollabActorKinds.Attribution: the By and With a block stamp
// gets. The person is the author and the agent co-authors; with no person
// the agent is the author. Both "" when no actor is known.
func Attribution(actorID string, note *RecordNote) (by, with string) {
	if note == nil || actorID == "" {
		return "", ""
	}
	if note.Kind == KindAgent && note.OnBehalfOf != "" {
		return note.OnBehalfOf, actorID
	}
	return actorID, ""
}

var stampKeys = []string{"createdAt", "createdBy", "createdWith", "lastEditedAt", "lastEditedBy", "lastEditedWith"}

// StampAuthority is CollabStampAuthority.Apply, for an /edit when the host
// turns stamp authority on. It runs after the request digest, so a retry
// still matches. An insert's six stamps are replaced: both times are nowMs,
// By and With follow Attribution, and an unknown one is removed. An update
// is followed by a stamp of its block, unless no actor is known.
func StampAuthority(ops []convert.EditOp, actorID string, nowMs float64) []convert.EditOp {
	by, with := Attribution(actorID, ClassifyActor(actorID, false, ""))
	stamped := make([]convert.EditOp, 0, len(ops))
	for _, op := range ops {
		switch op := op.(type) {
		case convert.Insert:
			block := op.Block.Clone()
			for _, key := range stampKeys {
				block.Remove(key)
			}
			now := jsjson.NewNumber(jsjson.FormatNumber(nowMs))
			_ = block.Set("createdAt", now)
			_ = block.Set("lastEditedAt", now)
			if by != "" {
				_ = block.Set("createdBy", jsjson.NewString(jsjson.FromString(by)))
				_ = block.Set("lastEditedBy", jsjson.NewString(jsjson.FromString(by)))
			}
			if with != "" {
				_ = block.Set("createdWith", jsjson.NewString(jsjson.FromString(with)))
				_ = block.Set("lastEditedWith", jsjson.NewString(jsjson.FromString(with)))
			}
			op.Block = block
			stamped = append(stamped, op)
		case convert.Update:
			stamped = append(stamped, op)
			if by != "" {
				var co *string
				if with != "" {
					co = &with
				}
				stamped = append(stamped, convert.SetMetadata{ID: op.ID, LastEditedAt: nowMs, LastEditedBy: by, LastEditedWith: co})
			}
		default:
			stamped = append(stamped, op)
		}
	}
	return stamped
}

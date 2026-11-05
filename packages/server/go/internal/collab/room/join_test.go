package room

import (
	"context"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/docendpoint"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/workingset"
)

// Twins of the C# CollabRoomManagerTests join outcomes (M3): SeedFailed,
// Forbidden and Purged.

func liveRooms(m *Manager) int { return len(m.liveRooms()) }

func TestASeedFailureReportsSeedFailedWritesNothingAndRetriesOnTheNextJoin(t *testing.T) {
	manager, store, endpoint := newTestManager(t, DefaultOptions(), nil)
	endpoint.fail(&docendpoint.Error{Message: "collab: the doc endpoint GET returned 503.", StatusCode: 503})
	member := &fakeMember{source: collab.SourceClientV1}

	failed, err := manager.Join(context.Background(), "doc", member)
	if err != nil || failed.Status != collab.JoinSeedFailed || failed.Membership != nil {
		t.Fatalf("join = %+v, %v; want SeedFailed", failed, err)
	}
	if set, _ := store.Read(context.Background(), "doc"); set != nil {
		t.Fatal("a failed seed wrote a working set")
	}
	if closes := member.closed(); len(closes) != 0 {
		t.Fatalf("closes = %v", closes)
	}

	endpoint.fail(nil)
	join(t, manager, "doc", &fakeMember{source: collab.SourceClientV1})
	if endpoint.loaded() != 2 {
		t.Fatalf("%d loads, want 2: the next join must seed again", endpoint.loaded())
	}
}

func TestForbiddenFirstJoinDoesNotLoadOrRetainARoom(t *testing.T) {
	manager, store, endpoint := newTestManager(t, DefaultOptions(), nil)

	denied, err := manager.Join(context.Background(), "doc", &fakeMember{source: collab.SourceClientV1, revoked: true})
	if err != nil || denied.Status != collab.JoinForbidden || denied.Membership != nil {
		t.Fatalf("join = %+v, %v; want Forbidden", denied, err)
	}
	if endpoint.loaded() != 0 || liveRooms(manager) != 0 {
		t.Fatalf("loads %d, rooms %d; want none", endpoint.loaded(), liveRooms(manager))
	}
	if set, _ := store.Read(context.Background(), "doc"); set != nil {
		t.Fatal("a forbidden join wrote a working set")
	}
}

func TestAStoredUpdateThatCannotBeAppliedFailsTheJoinClosed(t *testing.T) {
	manager, store, endpoint := newTestManager(t, DefaultOptions(), nil)
	tag := workingset.Tag{Format: workingset.CurrentFormat, Epoch: 1, Lineage: "0123456789abcdef0123456789abcdef"}
	if err := store.Write(context.Background(), "doc", []byte{2, 0, 0, 0, 0xde, 0xad}, tag); err != nil {
		t.Fatal(err)
	}

	result, err := manager.Join(context.Background(), "doc", &fakeMember{source: collab.SourceClientV1})
	if err != nil || result.Status != collab.JoinSeedFailed {
		t.Fatalf("join = %+v, %v; want SeedFailed", result, err)
	}
	if endpoint.loaded() != 0 || liveRooms(manager) != 0 {
		t.Fatalf("loads %d, rooms %d; want none", endpoint.loaded(), liveRooms(manager))
	}
}

func TestAPurgedDocumentRefusesEveryDoorForTheLifeOfTheProcess(t *testing.T) {
	manager, store, endpoint := newTestManager(t, DefaultOptions(), nil)
	member := &fakeMember{source: collab.SourceClientV1, write: true}
	join(t, manager, "doc", member)

	outcome, err := manager.Purge(context.Background(), "doc", func(context.Context) (bool, error) { return true, nil })
	if err != nil {
		t.Fatal(err)
	}
	if outcome != journal.Purged {
		t.Fatalf("outcome = %v", outcome)
	}
	if closes := member.closed(); len(closes) != 1 || closes[0] != collab.CloseForbidden {
		t.Fatalf("closes = %v, want one CloseForbidden", closes)
	}
	if set, _ := store.Read(context.Background(), "doc"); set != nil {
		t.Fatal("the purge left a working set")
	}
	if endpoint.saved() != 0 || liveRooms(manager) != 0 {
		t.Fatalf("saves %d, rooms %d; want none", endpoint.saved(), liveRooms(manager))
	}
	if result, err := manager.Join(context.Background(), "doc", &fakeMember{}); err != nil || result.Status != collab.JoinPurged {
		t.Fatalf("join = %v, %v; want Purged", result.Status, err)
	}
	insert := convert.Insert{ID: "late", Block: nil}
	if result, err := manager.Edit(context.Background(), "doc", []convert.EditOp{insert}, "op", make([]byte, 32), "", nil); err != nil || result.Status != EditPurged {
		t.Fatalf("edit = %v, %v; want Purged", result.Status, err)
	}
	if result, err := manager.Reset(context.Background(), "doc"); err != nil || result.Status != ResetPurged {
		t.Fatalf("reset = %v, %v; want Purged", result.Status, err)
	}
	if ok, err := manager.Checkpoint(context.Background(), "doc"); ok || err != nil {
		t.Fatalf("checkpoint = %v, %v", ok, err)
	}
}

package room

import (
	"context"
	"strconv"
	"sync"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

func customInsert(t *testing.T, id string) []convert.EditOp {
	t.Helper()
	block, err := jsjson.ParseNode([]byte(`{"type":"custom","data":{"n":1}}`), jsjson.Options{})
	if err != nil {
		t.Fatal(err)
	}
	return []convert.EditOp{convert.Insert{ID: id, Block: block}}
}

// G5: DocumentReplaced fires on a reset, an applied restore and a purge
// (CollabRoomManager.cs:333,832,1088), and not on a restore that finds no
// point. The agent drops its cached plans on it.
func TestDocumentReplacedFiresOnResetAppliedRestoreAndPurge(t *testing.T) {
	manager, _, _ := newTestManager(t, Options{}, openJournal(t))
	var mu sync.Mutex
	var fired []string
	manager.OnDocumentReplaced(func(docID string) {
		mu.Lock()
		defer mu.Unlock()
		fired = append(fired, docID)
	})
	count := func() int {
		mu.Lock()
		defer mu.Unlock()
		return len(fired)
	}
	ctx := context.Background()
	var lineage string
	for i := 1; i <= 2; i++ {
		result, err := manager.Edit(ctx, "doc", customInsert(t, "b"+strconv.Itoa(i)), "0000000000000000000000000000000"+strconv.Itoa(i), make([]byte, 32), "", nil)
		if err != nil || result.Status != EditApplied {
			t.Fatalf("edit = %v, %v", result.Status, err)
		}
		lineage = result.Receipt.Tag.Lineage
	}
	if count() != 0 {
		t.Fatal("an edit fired DocumentReplaced")
	}

	if status, _, err := manager.Restore(ctx, "doc", lineage, 9, "000000000000000000000000000000a0", "", nil); err != nil || status != HistoryNotFound {
		t.Fatalf("a missing point = %v, %v", status, err)
	}
	if count() != 0 {
		t.Fatal("a restore that found no point fired DocumentReplaced")
	}
	stale := &Precondition{Lineage: lineage, Sequence: 1}
	if _, refused, err := manager.Restore(ctx, "doc", lineage, 1, "000000000000000000000000000000a2", "", stale); err != nil || refused.Status != EditPreconditionFailed {
		t.Fatalf("a stale restore = %+v, %v", refused, err)
	}
	if count() != 0 {
		t.Fatal("a refused restore fired DocumentReplaced")
	}
	status, edit, err := manager.Restore(ctx, "doc", lineage, 1, "000000000000000000000000000000a1", "", nil)
	if err != nil || status != HistoryReady || edit.Status != EditApplied {
		t.Fatalf("restore = %v, %+v, %v", status, edit, err)
	}
	if count() != 1 {
		t.Fatalf("fired %d times after the restore, want 1", count())
	}

	if result, err := manager.Reset(ctx, "doc"); err != nil || result.Status != ResetDone {
		t.Fatalf("reset = %v, %v", result.Status, err)
	}
	if _, err := manager.Purge(ctx, "doc", func(context.Context) (bool, error) { return true, nil }); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(fired) != 3 || fired[0] != "doc" || fired[1] != "doc" || fired[2] != "doc" {
		t.Fatalf("fired %v, want doc three times", fired)
	}
}

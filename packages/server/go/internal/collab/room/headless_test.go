package room

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/collab/workingset"
)

// Twins of the C# CollabRoomTests headless-journal cases: a journal with no
// head adopts the working set (load.go tryAdoptWorkingSetLocked), and a
// working set beside a head is dropped (dropWorkingSetLocked).

const testDoc = "doc-1"

func TestAHeadlessJournalAdoptsTheWorkingSetAndThenDropsIt(t *testing.T) {
	r := newTextRoom()
	r.endpoint.Holds(t, testDoc, "from-endpoint", nil)
	r.store.Seed(t, testDoc, [][]byte{fullState(t, docWith("from-ws"))}, tagAt(3))
	manager := r.newManager(t, Options{}, true)

	if _, text := stateText(t, manager, testDoc); text != `{"text":"from-ws"}` {
		t.Fatalf("state = %s", text)
	}
	head := r.operations.Head(testDoc)
	if head == nil || head.Lineage != tagLineage || head.Epoch != 3 {
		t.Fatalf("head = %+v, want the working set's lineage at epoch 3", head)
	}
	if r.store.Holds(testDoc) {
		t.Fatal("the adopted working set was kept")
	}

	// The adopted content is owed to the endpoint, and the journal serves it after a reload.
	if err := manager.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}
	saves := r.endpoint.Saves()
	if len(saves) == 0 || saves[len(saves)-1].data != `{"text":"from-ws"}` {
		t.Fatalf("saves = %+v", saves)
	}
	if _, text := stateText(t, r.newManager(t, Options{}, true), testDoc); text != `{"text":"from-ws"}` {
		t.Fatalf("reloaded state = %s", text)
	}
}

func TestAHeadlessJournalWithAnEmptyWorkingSetSeedsFromTheEndpoint(t *testing.T) {
	r := newTextRoom()
	r.endpoint.Holds(t, testDoc, "from-endpoint", nil)
	r.store.Seed(t, testDoc, nil, tagAt(3))
	manager := r.newManager(t, Options{}, true)

	if _, text := stateText(t, manager, testDoc); text != `{"text":"from-endpoint"}` {
		t.Fatalf("state = %s", text)
	}
	if head := r.operations.Head(testDoc); head == nil || head.Lineage == tagLineage {
		t.Fatalf("head = %+v, want a fresh lineage", head)
	}
}

// A working set beside a journal head is stale by definition: a lost
// journal or a swapped store would adopt it and bring old content back.
func TestAStaleWorkingSetBesideAJournalHeadIsIgnoredAndDropped(t *testing.T) {
	r := newTextRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	first := r.newManager(t, Options{}, true)
	if result := httpEdit(t, first, testDoc, "0123456789abcdef0123456789abcdef", "!"); result.Status != EditApplied {
		t.Fatalf("edit = %v (%v)", result.Status, result.Err)
	}
	if err := first.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}
	r.store.Seed(t, testDoc, [][]byte{fullState(t, docWith("stale"))}, tagAt(0))

	if _, text := stateText(t, r.newManager(t, Options{}, true), testDoc); text != `{"text":"hello!"}` {
		t.Fatalf("state = %s", text)
	}
	if r.store.Holds(testDoc) {
		t.Fatal("the stale working set was kept")
	}
}

// A damaged working copy is moved aside by the store and the room seeds
// from the endpoint. Retiring a working copy later must not take the
// quarantined bytes with it: only a purge may.
func TestAQuarantinedWorkingCopySurvivesTheJournalTakingOver(t *testing.T) {
	r := newTextRoom()
	directory := t.TempDir()
	local := workingset.NewLocalStore(directory, r.logf)
	damaged := filepath.Join(directory, workingset.DocKey(testDoc))
	if err := os.WriteFile(damaged, []byte{9, 9, 9}, 0o600); err != nil {
		t.Fatal(err)
	}
	r.endpoint.Holds(t, testDoc, "from-endpoint", nil)
	open := func() StateResult {
		manager := NewManager(ManagerOptions{
			Store: local, Endpoint: r.endpoint, Converter: r.converter, Room: Options{Now: r.clock.Now},
			Log: r.logf, Operations: r.operations,
		})
		state, err := manager.State(context.Background(), testDoc)
		if err != nil {
			t.Fatal(err)
		}
		if err := manager.Drain(context.Background()); err != nil {
			t.Fatal(err)
		}
		return state
	}

	opened := open()
	open()

	if string(opened.JSON) != `{"text":"from-endpoint"}` {
		t.Fatalf("state = %s", opened.JSON)
	}
	aside, err := filepath.Glob(filepath.Join(directory, workingset.DocKey(testDoc)+".unreadable-*"))
	if err != nil || len(aside) != 1 {
		t.Fatalf("quarantined copies = %v, %v; want one", aside, err)
	}
	if content, err := os.ReadFile(aside[0]); err != nil || string(content) != "\x09\x09\x09" {
		t.Fatalf("the quarantined copy holds %v, %v", content, err)
	}
}

// A reset rebaselines from the endpoint, so whatever only the working copy
// held must reach the endpoint first.
func TestAResetOfAHeadlessDocumentAdoptsAndFlushesTheWorkingSetFirst(t *testing.T) {
	r := newTextRoom()
	r.endpoint.Holds(t, testDoc, "from-endpoint", nil)
	r.store.Seed(t, testDoc, [][]byte{fullState(t, docWith("from-ws"))}, tagAt(3))
	manager := r.newManager(t, Options{}, true)

	result, err := manager.Reset(context.Background(), testDoc)
	if err != nil || result.Status != ResetDone {
		t.Fatalf("reset = %v, %v (%v)", result.Status, err, result.Err)
	}
	flushed := false
	for _, save := range r.endpoint.Saves() {
		flushed = flushed || save.data == `{"text":"from-ws"}`
	}
	if !flushed {
		t.Fatalf("the adopted content never reached the endpoint: %+v", r.endpoint.Saves())
	}
	// The reset raised the ADOPTED epoch, so it ran on the adopted history.
	if head := r.operations.Head(testDoc); head == nil || head.Epoch != 4 {
		t.Fatalf("head = %+v, want epoch 4", head)
	}
	if r.store.Holds(testDoc) {
		t.Fatal("the working set was kept")
	}
}

// A working copy left beside a reset journal holds content the reset threw
// away, so a reset that cannot retire it is refused and a retry finishes it.
func TestAResetThatCannotRetireTheWorkingCopyIsRefused(t *testing.T) {
	r := newTextRoom()
	r.endpoint.Holds(t, testDoc, "from-endpoint", nil)
	r.store.Seed(t, testDoc, [][]byte{fullState(t, docWith("from-ws"))}, tagAt(3))
	busy := errors.New("the disk is busy")
	r.store.setFailRetires(func(string) error { return busy })
	manager := r.newManager(t, Options{}, true)

	refused, err := manager.Reset(context.Background(), testDoc)
	if err != nil || refused.Status != ResetUnavailable {
		t.Fatalf("reset = %v, %v", refused.Status, err)
	}
	if head := r.operations.Head(testDoc); head == nil || head.Epoch != 3 {
		t.Fatalf("head = %+v, want epoch 3", head)
	}
	if !r.store.Holds(testDoc) {
		t.Fatal("the working set is gone after a refused reset")
	}

	r.store.setFailRetires(nil)
	retried, err := manager.Reset(context.Background(), testDoc)
	if err != nil || retried.Status != ResetDone {
		t.Fatalf("retried reset = %v, %v (%v)", retried.Status, err, retried.Err)
	}
	if head := r.operations.Head(testDoc); head == nil || head.Epoch != 4 {
		t.Fatalf("head = %+v, want epoch 4", head)
	}
	if r.store.Holds(testDoc) {
		t.Fatal("the working set was kept")
	}
	if !r.logged("could not retire its working set, so the reset is refused") {
		t.Fatalf("log = %q", r.log)
	}
}

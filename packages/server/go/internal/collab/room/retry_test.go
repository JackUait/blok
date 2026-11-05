package room

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab"
	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/internal/collab/wire"
	"github.com/JackUait/blok/packages/server/go/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// G1: twins of AnEditQueuedBehindAClosingRoomIsRetriedOnAFreshOne and
// ACallQueuedBehindAClosingRoomIsRetriedOnAFreshOne. Each entry point has
// its own retry loop, so each is driven through one.
func TestACallQueuedBehindAClosingRoomIsRetriedOnAFreshOne(t *testing.T) {
	calls := []struct {
		name  string
		call  func(t *testing.T, m *Manager) string
		want  string
		rooms int
	}{
		{"join", func(t *testing.T, m *Manager) string {
			r, err := m.Join(context.Background(), "doc", &fakeMember{source: collab.SourceClientV1})
			if err != nil {
				t.Error(err)
			}
			if r.Status == collab.JoinJoined {
				return "Joined"
			}
			return "other"
		}, "Joined", 1},
		{"edit", func(t *testing.T, m *Manager) string {
			r, err := m.Edit(context.Background(), "doc", customInsert(t, "c"), "op", make([]byte, 32), "", nil)
			if err != nil {
				t.Error(err)
			}
			if r.Status == EditApplied {
				return "Applied"
			}
			return "other"
		}, "Applied", 1},
		{"state", func(t *testing.T, m *Manager) string {
			r, err := m.State(context.Background(), "doc")
			if err != nil {
				t.Error(err)
			}
			if r.Status == StateReady {
				return "Ready"
			}
			return "other"
		}, "Ready", 1},
		// A reset closes the room it ran on.
		{"reset", func(t *testing.T, m *Manager) string {
			r, err := m.Reset(context.Background(), "doc")
			if err != nil {
				t.Error(err)
			}
			if r.Status == ResetDone {
				return "Reset"
			}
			return "other"
		}, "Reset", 0},
	}
	for _, c := range calls {
		t.Run(c.name, func(t *testing.T) {
			manager, store, endpoint := newTestManager(t, OptionsWith(func(ro *Options) {
				ro.EvictionLinger = 10 * time.Millisecond
				ro.ExportDebounce = time.Hour
				ro.ExportMaxDelay = time.Hour
			}), nil)
			gate := make(chan struct{})
			endpoint.mu.Lock()
			endpoint.gate = gate
			endpoint.mu.Unlock()

			membership := join(t, manager, "doc", &fakeMember{source: collab.SourceClientV1, write: true})
			if err := membership.Receive(context.Background(), syncFrame(t, wire.SyncUpdate{Update: clientUpdate(t, 9, "k")})); err != nil {
				t.Fatal(err)
			}
			membership.Leave()
			waitFor(t, "the eviction's export to start", func() bool { return endpoint.saved() == 1 })

			manager.mu.Lock()
			closing := manager.rooms["doc"]
			manager.mu.Unlock()
			done := make(chan string, 1)
			go func() { done <- c.call(t, manager) }()
			// The call must be queued behind the flush, not run after it.
			waitFor(t, "the call to queue behind the flush", func() bool {
				closing.lane.mu.Lock()
				defer closing.lane.mu.Unlock()
				return len(closing.lane.waiters) == 1
			})
			endpoint.mu.Lock()
			endpoint.gate = nil
			endpoint.mu.Unlock()
			close(gate)

			var got string
			select {
			case got = <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("the queued call never answered")
			}
			if got != c.want {
				t.Fatalf("status = %s, want %s", got, c.want)
			}
			store.mu.Lock()
			reads := store.reads
			store.mu.Unlock()
			if endpoint.loaded() != 1 || reads != 2 {
				t.Fatalf("loads %d, reads %d; want 1 and 2: the fresh room hydrates from the blob", endpoint.loaded(), reads)
			}
			if manager.LiveRoomCount() != c.rooms {
				t.Fatalf("%d live rooms, want %d", manager.LiveRoomCount(), c.rooms)
			}
			// C# Assert.Equal("abc", Replay(store)): the client's write and
			// the edit both reached the store, so no update was lost.
			if c.name == "edit" {
				if got := storedDocument(t, store, "doc"); !strings.Contains(got, `"k":1`) || !strings.Contains(got, `"id":"c"`) {
					t.Fatalf("stored document = %s, want the client's key and the edit's block", got)
				}
			}
		})
	}
}

func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

// failingAppends opens real journal sessions whose appends fail, so a
// write closes the room as CommitUnavailable and starts the cooldown.
type failingAppends struct{ OperationStore }

func (s failingAppends) Open(ctx context.Context, docID string) (journal.OpenOutcome, OperationSession, error) {
	outcome, session, err := s.OperationStore.Open(ctx, docID)
	if session != nil {
		session = failingSession{session}
	}
	return outcome, session, err
}

type failingSession struct{ OperationSession }

func (failingSession) Append(context.Context, operation.Candidate) (operation.AppendResult, error) {
	return operation.AppendResult{}, errors.New("the disk is gone")
}

// G1 check order (CollabRoomManager.cs:264-283): purging, then draining,
// then the cooldown. Join, edit and state each carry their own copy.
func TestEveryDoorChecksPurgingThenDrainingThenTheCooldown(t *testing.T) {
	doors := []struct {
		name string
		call func(t *testing.T, m *Manager) string
	}{
		{"join", func(t *testing.T, m *Manager) string {
			r, err := m.Join(context.Background(), "doc", &fakeMember{source: collab.SourceClientV1})
			if err != nil {
				t.Fatal(err)
			}
			return map[collab.JoinStatus]string{collab.JoinPurged: "Purged", collab.JoinDraining: "Draining", collab.JoinUnavailable: "Unavailable"}[r.Status]
		}},
		{"edit", func(t *testing.T, m *Manager) string {
			r, err := m.Edit(context.Background(), "doc", customInsert(t, "c"), "op", make([]byte, 32), "", nil)
			if err != nil {
				t.Fatal(err)
			}
			return map[EditStatus]string{EditPurged: "Purged", EditDraining: "Draining", EditUnavailable: "Unavailable"}[r.Status]
		}},
		{"state", func(t *testing.T, m *Manager) string {
			r, err := m.State(context.Background(), "doc")
			if err != nil {
				t.Fatal(err)
			}
			return map[StateStatus]string{StatePurged: "Purged", StateDraining: "Draining", StateUnavailable: "Unavailable"}[r.Status]
		}},
	}
	for _, door := range doors {
		t.Run(door.name+"/draining beats the cooldown", func(t *testing.T) {
			manager, _, _ := newTestManager(t, DefaultOptions(), failingAppends{openJournal(t)})
			member := &fakeMember{source: collab.SourceClientV1, write: true}
			membership := join(t, manager, "doc", member)
			_ = membership.Receive(context.Background(), syncFrame(t, wire.SyncUpdate{Update: clientUpdate(t, 9, "k")}))
			waitFor(t, "the room to close on the failed append", func() bool { return manager.LiveRoomCount() == 0 })
			if got := door.call(t, manager); got != "Unavailable" {
				t.Fatalf("in the cooldown: %q, want Unavailable", got)
			}
			if err := manager.Drain(context.Background()); err != nil {
				t.Fatal(err)
			}
			if got := door.call(t, manager); got != "Draining" {
				t.Fatalf("draining in the cooldown: %q, want Draining", got)
			}
		})
		t.Run(door.name+"/purging beats draining", func(t *testing.T) {
			manager, _, _ := newTestManager(t, DefaultOptions(), nil)
			allow := func(context.Context) (bool, error) { return true, nil }
			if _, err := manager.Purge(context.Background(), "doc", allow); err != nil {
				t.Fatal(err)
			}
			if err := manager.Drain(context.Background()); err != nil {
				t.Fatal(err)
			}
			if got := door.call(t, manager); got != "Purged" {
				t.Fatalf("purged and draining: %q, want Purged", got)
			}
		})
	}
}

// C# AHeldOffWaitPrintsAsATimeSpan: the "held off" wait prints with
// TimeSpan's "c" format.
func TestAHeldOffWaitPrintsAsATimeSpan(t *testing.T) {
	cases := []struct {
		wait    time.Duration
		printed string
	}{
		{2 * time.Second, "00:00:02"},
		{time.Minute, "00:01:00"},
		{5 * time.Millisecond, "00:00:00.0050000"},
		{1500 * time.Millisecond, "00:00:01.5000000"},
		{150, "00:00:00.0000001"},
		{90_061 * time.Second, "1.01:01:01"},
		{12*24*time.Hour + time.Second, "12.00:00:01"},
	}
	for _, c := range cases {
		if got := timeSpan(c.wait); got != c.printed {
			t.Errorf("timeSpan(%v) = %q, want %q", c.wait, got, c.printed)
		}
	}
}

// storedDocument replays the working set into a fresh doc and prints its
// notes key "k" and the ids of its exported blocks.
func storedDocument(t *testing.T, store *memoryStore, doc string) string {
	t.Helper()
	set, err := store.Read(context.Background(), doc)
	if err != nil || set == nil {
		t.Fatalf("stored set = %v, %v", set, err)
	}
	frames, ok := workingset.DecodeFrames(set.Updates)
	if !ok {
		t.Fatal("the stored frames do not decode")
	}
	replica := yjs.NewDoc(yjs.Options{})
	for _, frame := range frames {
		if _, err := replica.ApplyUpdate(frame); err != nil {
			t.Fatal(err)
		}
	}
	notes := ""
	if value, ok := replica.GetMap(jsjson.FromString("notes")).Get(jsjson.FromString("k")); ok {
		text, err := jsjson.Stringify(value)
		if err != nil {
			t.Fatal(err)
		}
		notes = `"k":` + text
	}
	blocks, _, err := (&convert.DocConverter{Now: time.Now}).ExportBlocks(replica, map[string]bool{})
	if err != nil {
		t.Fatal(err)
	}
	for _, block := range blocks {
		if object, ok := block.(*jsjson.Object); ok {
			if id, ok := object.Get(jsjson.FromString("id")); ok {
				notes += fmt.Sprintf(` "id":%q`, fmt.Sprint(id))
			}
		}
	}
	return notes
}

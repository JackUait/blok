package room

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/wire"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsruntime"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

// failingExport is the real converter whose Export always fails.
type failingExport struct {
	*convert.DocConverter
	err     error
	mu      sync.Mutex
	exports int
}

func (f *failingExport) Export(context.Context, *yjs.Doc) (*jsjson.Object, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.exports++
	return nil, f.err
}

func (f *failingExport) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.exports
}

type exportRoom struct {
	manager   *Manager
	endpoint  *memoryEndpoint
	converter *failingExport
	mu        sync.Mutex
	log       []string
}

func newExportRoom(t *testing.T, err error, operations OperationStore) *exportRoom {
	t.Helper()
	e := &exportRoom{endpoint: &memoryEndpoint{}, converter: &failingExport{DocConverter: &convert.DocConverter{Now: time.Now}, err: err}}
	e.manager = NewManager(ManagerOptions{
		Store: newMemoryStore(), Endpoint: e.endpoint, Converter: e.converter, Operations: operations,
		Room: OptionsWith(func(ro *Options) {
			ro.ExportDebounce = time.Millisecond
			ro.ExportMaxDelay = time.Millisecond
			ro.RetryBackoff = time.Millisecond
			ro.RetryBackoffCap = time.Millisecond
			ro.EvictionLinger = 20 * time.Millisecond
		}),
		Log: func(message string) {
			e.mu.Lock()
			defer e.mu.Unlock()
			e.log = append(e.log, message)
		},
	})
	t.Cleanup(func() { _ = e.manager.Drain(context.Background()) })
	return e
}

func (e *exportRoom) logged(part string) int {
	e.mu.Lock()
	defer e.mu.Unlock()
	count := 0
	for _, line := range e.log {
		if strings.Contains(line, part) {
			count++
		}
	}
	return count
}

func waitUntil(t *testing.T, what string, done func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !done() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// Twin of ATransientExportFailureThatNeverHealsIsGivenUp (M28), on a room
// without a journal: eight runtime-limit failures, then no more attempts.
func TestATransientExportFailureThatNeverHealsIsGivenUp(t *testing.T) {
	limit := &convert.TransientError{Message: "collab: the rich text HTML could not be read",
		Err: &jsruntime.Failure{Kind: jsruntime.KindTimedOut, Err: errors.New("timed out")}}
	e := newExportRoom(t, limit, nil)
	membership := join(t, e.manager, "doc", &fakeMember{source: collab.SourceClientV1, write: true})
	if err := membership.Receive(context.Background(), syncFrame(t, wire.SyncUpdate{Update: clientUpdate(t, 9, "k")})); err != nil {
		t.Fatal(err)
	}

	waitUntil(t, "the give-up", func() bool { return e.logged("gave up exporting after 8 attempts") == 1 })
	time.Sleep(100 * time.Millisecond)

	if got := e.converter.count(); got != 8 {
		t.Fatalf("%d exports, want 8 and no retry after the give-up", got)
	}
	if e.endpoint.saved() != 0 {
		t.Fatal("a PUT was sent")
	}
}

// A failure that is not transient on a journal room is refused at once and
// never retried (CollabRoom.cs:3358-3429).
func TestANonTransientExportFailureOnAJournalRoomIsRefusedAtOnce(t *testing.T) {
	e := newExportRoom(t, &journal.InvalidDataError{Message: `collab: block "b-1" has data that is not a map.`}, openJournal(t))
	// Unheld, the 20 ms linger can fire during a slow checkpoint and evict
	// before the checkpoint's export runs. C# holds a member the same way.
	membership := join(t, e.manager, "doc", &fakeMember{source: collab.SourceClientV1, write: true})
	block, err := jsjson.ParseNode([]byte(`{"type":"custom","data":{"n":1}}`), jsjson.Options{})
	if err != nil {
		t.Fatal(err)
	}
	result, err := e.manager.Edit(context.Background(), "doc", []convert.EditOp{convert.Insert{ID: "a", Block: block}},
		"00000000000000000000000000000001", make([]byte, 32), "", nil)
	if err != nil || result.Status != EditApplied {
		t.Fatalf("edit = %v, %v", result.Status, err)
	}
	if ok, err := e.manager.Checkpoint(context.Background(), "doc"); !ok || err != nil {
		t.Fatalf("checkpoint = %v, %v", ok, err)
	}

	waitUntil(t, "the refusal", func() bool { return e.logged("cannot export its document") == 1 })
	time.Sleep(50 * time.Millisecond)
	if got := e.converter.count(); got != 1 {
		t.Fatalf("%d exports while the room was occupied, want 1: the refusal was retried", got)
	}
	membership.Leave()
	// The refusal releases the hold a dirty projection puts on eviction.
	waitUntil(t, "the room to be evicted", func() bool { return liveRooms(e.manager) == 0 })
	time.Sleep(50 * time.Millisecond)

	// The checkpoint's attempt and the eviction flush's, as C# counts them.
	if got := e.converter.count(); got != 2 {
		t.Fatalf("%d exports, want 2", got)
	}
	if e.logged("retrying") != 0 || e.endpoint.saved() != 0 || e.logged("b-1") != 1 {
		t.Fatal("the refusal was retried or logged twice")
	}
}

// M18, S3: a state read whose export hits a runtime limit is Overloaded
// (503 + Retry-After); any other export failure is ExportFailed (500).
func TestAStateReadMapsExportFailures(t *testing.T) {
	for _, c := range []struct {
		err  error
		want StateStatus
	}{
		{&convert.TransientError{Message: "limit", Err: &jsruntime.Failure{Kind: jsruntime.KindTimedOut, Err: errors.New("t")}}, StateOverloaded},
		{&journal.InvalidDataError{Message: "bad"}, StateExportFailed},
		{errors.New("anything else"), StateExportFailed},
	} {
		e := newExportRoom(t, c.err, nil)
		result, err := e.manager.State(context.Background(), "doc")
		if err != nil || result.Status != c.want {
			t.Errorf("%v: state = %v, %v; want %v", c.err, result.Status, err, c.want)
		}
	}
}

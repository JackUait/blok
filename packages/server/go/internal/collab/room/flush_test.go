package room

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab"
	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/internal/collab/docendpoint"
	"github.com/JackUait/blok/packages/server/go/internal/collab/wire"
	"github.com/JackUait/blok/packages/server/go/internal/collab/workingset"
)

// failingWrites is a working-set store whose writes fail while fail is set.
type failingWrites struct {
	*memoryStore
	fail atomic.Bool
}

func (s *failingWrites) Write(ctx context.Context, doc string, updates []byte, tag workingset.Tag) error {
	if s.fail.Load() {
		return context.DeadlineExceeded
	}
	return s.memoryStore.Write(ctx, doc, updates, tag)
}

type flushRoom struct {
	manager *Manager
	store   *failingWrites
	mu      sync.Mutex
	log     []string
}

func newFlushRoom(t *testing.T) *flushRoom {
	t.Helper()
	f := &flushRoom{store: &failingWrites{memoryStore: newMemoryStore()}}
	f.manager = NewManager(ManagerOptions{
		Store: f.store, Endpoint: &memoryEndpoint{}, Converter: &convert.DocConverter{Now: time.Now},
		Room: OptionsWith(func(ro *Options) {
			ro.ExportDebounce = time.Hour
			ro.ExportMaxDelay = time.Hour
			ro.RetryBackoff = 5 * time.Millisecond
			ro.RetryBackoffCap = 5 * time.Millisecond
			ro.EvictionLinger = 5 * time.Millisecond
		}),
		Log: func(message string) {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.log = append(f.log, message)
		},
	})
	t.Cleanup(func() {
		f.store.fail.Store(false)
		_ = f.manager.Drain(context.Background())
	})
	return f
}

func (f *flushRoom) logged(part string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, line := range f.log {
		if strings.Contains(line, part) {
			return true
		}
	}
	return false
}

func (f *flushRoom) edit(t *testing.T, member *fakeMember) collab.Membership {
	t.Helper()
	membership := join(t, f.manager, "doc", member)
	// Two frames, so the flush compacts and owes the store a write.
	for i, key := range []string{"k", "l"} {
		if err := membership.Receive(context.Background(), syncFrame(t, wire.SyncUpdate{Update: clientUpdate(t, uint32(9+i), key)})); err != nil {
			t.Fatal(err)
		}
	}
	f.manager.Settle()
	return membership
}

// The room's own flush failures never reach the caller: in C# only a
// cancelled room lifetime escapes FlushLocked, and a closed room never
// flushes. So a failing store logs "could not flush the working set", and
// never the callers' "could not flush before eviction/while draining".
// Twin of C# AStoreTimeoutDuringTheEvictionFlushIsAFailureNotAShutdown.
func TestAStoreTimeoutDuringTheEvictionFlushIsAFailureNotAShutdown(t *testing.T) {
	f := newFlushRoom(t)
	membership := f.edit(t, &fakeMember{source: collab.SourceClientV1, write: true})
	f.store.fail.Store(true)
	membership.Leave()

	waitUntil(t, "the eviction flush to fail", func() bool { return f.logged("could not flush the working set") })
	if f.manager.LiveRoomCount() != 1 {
		t.Fatal("a room whose flush failed was unloaded")
	}
	if f.logged("could not flush before eviction") {
		t.Fatal("a store failure escaped the flush")
	}

	f.store.fail.Store(false)
	waitUntil(t, "the room to unload once the store heals", func() bool { return f.manager.LiveRoomCount() == 0 })
	if set, _ := f.store.Read(context.Background(), "doc"); set == nil || len(set.Updates) == 0 {
		t.Fatal("the healed eviction wrote no working set")
	}
}

func TestAStoreFailureWhileDrainingStillClosesEveryMember(t *testing.T) {
	f := newFlushRoom(t)
	member := &fakeMember{source: collab.SourceClientV1, write: true}
	f.edit(t, member)
	f.store.fail.Store(true)

	if err := f.manager.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !f.logged("could not flush the working set: " + context.DeadlineExceeded.Error()) {
		t.Fatalf("log = %q", f.log)
	}
	if f.logged("could not flush while draining") {
		t.Fatal("a store failure escaped the flush")
	}
	if got := member.closed(); len(got) != 1 || got[0] != collab.CloseDraining {
		t.Fatalf("closes = %v, want one CloseDraining", got)
	}
	if f.manager.LiveRoomCount() != 0 {
		t.Fatal("the drained room stayed loaded")
	}
}

// C# ADrainCutShortByItsTokenStillClosesEveryRoom: the shutdown deadline
// cancels the drain mid-flush. Every room still closes, and the only lines
// are each room's own flush failure.
func TestADrainCutShortByItsTokenStillClosesEveryRoom(t *testing.T) {
	r := newTextRoom()
	r.endpoint.Holds(t, "doc-a", "a", nil)
	r.endpoint.Holds(t, "doc-b", "b", nil)
	manager := r.newManager(t, OptionsWith(func(ro *Options) { ro.ExportDebounce = 5 * time.Minute; ro.ExportMaxDelay = 5 * time.Minute }), false)
	memberA := &fakeMember{source: collab.SourceClientV1, write: true}
	memberB := &fakeMember{source: collab.SourceClientV1, write: true}
	membershipA := joinSynced(t, manager, "doc-a", memberA)
	membershipB := joinSynced(t, manager, "doc-b", memberB)
	clientA := syncedClient(t, manager, "doc-a", "a")
	clientB := syncedClient(t, manager, "doc-b", "b")
	if err := membershipA.Receive(context.Background(), syncFrame(t, wire.SyncUpdate{Update: updateAppending(clientA, "!")})); err != nil {
		t.Fatal(err)
	}
	if err := membershipB.Receive(context.Background(), syncFrame(t, wire.SyncUpdate{Update: updateAppending(clientB, "?")})); err != nil {
		t.Fatal(err)
	}
	manager.Settle()
	gate := make(chan struct{})
	defer close(gate)
	r.endpoint.setSaveGate(gate)
	shutdown, cancel := context.WithCancel(context.Background())

	drained := make(chan error, 1)
	go func() { drained <- manager.Drain(shutdown) }()
	waitUntil(t, "both drains to start their export", func() bool { return len(r.endpoint.Saves()) == 2 })
	cancel()
	select {
	case err := <-drained:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the cancelled drain did not finish")
	}

	if manager.LiveRoomCount() != 0 {
		t.Fatal("a drained room stayed loaded")
	}
	for _, member := range []*fakeMember{memberA, memberB} {
		if got := member.closed(); len(got) != 1 || got[0] != collab.CloseDraining {
			t.Fatalf("closes = %v, want one CloseDraining", got)
		}
	}
	r.mu.Lock()
	lines := slices.Sorted(slices.Values(r.log))
	r.mu.Unlock()
	want := []string{
		`collab: room "doc-a" could not export during flush: The operation was canceled.`,
		`collab: room "doc-b" could not export during flush: The operation was canceled.`,
	}
	if !slices.Equal(lines, want) {
		t.Fatalf("log = %q, want %q", lines, want)
	}
}

// panickingSave is an endpoint whose save panics once armed.
type panickingSave struct {
	memoryEndpoint
	armed atomic.Bool
}

func (e *panickingSave) Save(ctx context.Context, doc string, outputData any, version *string, projection *docendpoint.Projection) (*string, error) {
	if e.armed.Load() {
		panic(errors.New("endpoint exploded"))
	}
	return e.memoryEndpoint.Save(ctx, doc, outputData, version, projection)
}

// C# DrainRoomAsync: a room whose drain throws is logged and forgotten, and
// the drain still ends. A panic is Go's throw.
func TestARoomWhoseDrainPanicsIsLoggedAndForgotten(t *testing.T) {
	endpoint := &panickingSave{}
	var mu sync.Mutex
	var log []string
	manager := NewManager(ManagerOptions{
		Store: newMemoryStore(), Endpoint: endpoint, Converter: &convert.DocConverter{Now: time.Now},
		Room: OptionsWith(func(ro *Options) { ro.ExportDebounce = time.Hour; ro.ExportMaxDelay = time.Hour }),
		Log: func(message string) {
			mu.Lock()
			defer mu.Unlock()
			log = append(log, message)
		},
	})
	membership := join(t, manager, "doc", &fakeMember{source: collab.SourceClientV1, write: true})
	if err := membership.Receive(context.Background(), syncFrame(t, wire.SyncUpdate{Update: clientUpdate(t, 9, "k")})); err != nil {
		t.Fatal(err)
	}
	manager.Settle()
	endpoint.armed.Store(true)

	if err := manager.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if !slices.Contains(log, `collab: room "doc" could not be drained: endpoint exploded`) {
		t.Fatalf("log = %q", log)
	}
	if manager.LiveRoomCount() != 0 {
		t.Fatal("the room whose drain failed stayed loaded")
	}
}

// C# ADrainWhoseTokenIsAlreadyCancelledPrintsTheTaskCancelText.
func TestADrainWhoseTokenIsAlreadyCancelledPrintsTheTaskCancelText(t *testing.T) {
	r := newTextRoom()
	r.endpoint.Holds(t, "doc-a", "a", nil)
	manager := r.newManager(t, OptionsWith(func(ro *Options) { ro.ExportDebounce = 5 * time.Minute; ro.ExportMaxDelay = 5 * time.Minute }), false)
	member := &fakeMember{source: collab.SourceClientV1, write: true}
	membership := joinSynced(t, manager, "doc-a", member)
	client := syncedClient(t, manager, "doc-a", "a")
	if err := membership.Receive(context.Background(), syncFrame(t, wire.SyncUpdate{Update: updateAppending(client, "!")})); err != nil {
		t.Fatal(err)
	}
	manager.Settle()
	gate := make(chan struct{})
	defer close(gate)
	r.endpoint.setSaveGate(gate)
	r.store.mu.Lock()
	r.store.refusesCancelledWrites = true
	r.store.mu.Unlock()
	shutdown, cancel := context.WithCancel(context.Background())
	cancel()

	if err := manager.Drain(shutdown); err != nil {
		t.Fatal(err)
	}

	if manager.LiveRoomCount() != 0 {
		t.Fatal("a drained room stayed loaded")
	}
	r.mu.Lock()
	lines := slices.Clone(r.log)
	r.mu.Unlock()
	// The flush compacts, so it owes the store a write too.
	want := []string{
		`collab: room "doc-a" could not flush the working set: A task was canceled.`,
		`collab: room "doc-a" could not export during flush: A task was canceled.`,
	}
	if !slices.Equal(lines, want) {
		t.Fatalf("log = %q, want %q", lines, want)
	}
}

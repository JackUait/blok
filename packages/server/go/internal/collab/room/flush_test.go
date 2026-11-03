package room

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab"
	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
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
		Room: Options{
			ExportDebounce: time.Hour, ExportMaxDelay: time.Hour,
			RetryBackoff: 5 * time.Millisecond, RetryBackoffCap: 5 * time.Millisecond,
			EvictionLinger: 5 * time.Millisecond,
		},
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

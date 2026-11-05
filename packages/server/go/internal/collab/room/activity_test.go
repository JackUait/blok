package room

import (
	"context"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
)

// gatedObserver holds its first call until the gate opens.
type gatedObserver struct {
	mu       sync.Mutex
	gate     chan struct{}
	entered  chan struct{}
	actors   []string
	released atomic.Bool
}

func (o *gatedObserver) Record(_ context.Context, _, actorID string, _ time.Time, kind ActivityKind) error {
	o.mu.Lock()
	first := len(o.actors) == 0
	o.actors = append(o.actors, actorID+" "+kind.String())
	o.mu.Unlock()
	if first {
		close(o.entered)
		<-o.gate
		o.released.Store(true)
	}
	return nil
}

// Twin of C# TheActivityQueueDropsItsOldestPastTheBound (M15): with the
// observer held, 258 records queue against a bound of 256, and the oldest
// pair goes.
func TestTheActivityQueueDropsItsOldestPastTheBound(t *testing.T) {
	observer := &gatedObserver{gate: make(chan struct{}), entered: make(chan struct{})}
	var logMu sync.Mutex
	var log []string
	manager := NewManager(ManagerOptions{
		Store: newMemoryStore(), Endpoint: &memoryEndpoint{}, Converter: &convert.DocConverter{Now: time.Now},
		Room:     OptionsWith(func(ro *Options) { ro.ExportDebounce = time.Hour; ro.ExportMaxDelay = time.Hour }),
		Activity: observer,
		Log: func(message string) {
			logMu.Lock()
			defer logMu.Unlock()
			log = append(log, message)
		},
	})
	t.Cleanup(func() { _ = manager.Drain(context.Background()) })
	join(t, manager, "doc", &fakeMember{actor: "user-0", source: collab.SourceClientV1})
	select {
	case <-observer.entered:
	case <-time.After(10 * time.Second):
		t.Fatal("the observer was never called")
	}

	for index := 1; index <= 129; index++ {
		join(t, manager, "doc", &fakeMember{actor: "user-" + strconv.Itoa(index), source: collab.SourceClientV1}).Leave()
	}
	close(observer.gate)
	manager.Settle()

	observer.mu.Lock()
	records := append([]string(nil), observer.actors...)
	observer.mu.Unlock()
	if len(records) != 257 {
		t.Fatalf("%d records, want 257", len(records))
	}
	for _, record := range records {
		if strings.HasPrefix(record, "user-1 ") {
			t.Fatalf("the oldest pair survived: %s", record)
		}
	}
	logMu.Lock()
	defer logMu.Unlock()
	behind := false
	for _, line := range log {
		behind = behind || strings.Contains(line, "the activity observer is behind")
	}
	if !behind {
		t.Fatalf("nothing logged: %q", log)
	}
}

// M15: the drain waits for the activity pump at most CommitTimeout
// (CollabRoom.cs:1337-1350), then abandons it and says so.
func TestTheDrainStopsWaitingForAStuckObserverAtTheCommitTimeout(t *testing.T) {
	observer := &gatedObserver{gate: make(chan struct{}), entered: make(chan struct{})}
	t.Cleanup(func() { close(observer.gate) })
	var logMu sync.Mutex
	var log []string
	manager := NewManager(ManagerOptions{
		Store: newMemoryStore(), Endpoint: &memoryEndpoint{}, Converter: &convert.DocConverter{Now: time.Now},
		Room:     OptionsWith(func(ro *Options) { ro.CommitTimeout = 50 * time.Millisecond }),
		Activity: observer,
		Log: func(message string) {
			logMu.Lock()
			defer logMu.Unlock()
			log = append(log, message)
		},
	})
	join(t, manager, "doc", &fakeMember{actor: "user-0", source: collab.SourceClientV1})
	select {
	case <-observer.entered:
	case <-time.After(10 * time.Second):
		t.Fatal("the observer was never called")
	}

	drained := make(chan error, 1)
	go func() { drained <- manager.Drain(context.Background()) }()
	select {
	case err := <-drained:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the drain waited out the stuck observer")
	}

	// C# Assert.False(gate.Task.IsCompleted): the drain gave up while the
	// observer was still inside its call.
	if observer.released.Load() {
		t.Fatal("the observer returned before the drain did")
	}
	logMu.Lock()
	defer logMu.Unlock()
	if !slices.Contains(log, `collab: room "doc" abandoned its activity dispatch while draining: the observer is past its bound`) {
		t.Fatalf("nothing logged: %q", log)
	}
}

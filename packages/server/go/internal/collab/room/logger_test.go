package room

import (
	"context"
	"errors"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab"
	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/internal/collab/wire"
)

// A Go host logger throws by panicking. The recheck and activity-drop
// cases are in csharp_manager_test.go; this is the pump's.

func loggerManager(t *testing.T, log func(string), activity ActivityObserver) *Manager {
	t.Helper()
	manager := NewManager(ManagerOptions{
		Store: newMemoryStore(), Endpoint: &memoryEndpoint{}, Converter: &convert.DocConverter{Now: time.Now},
		Room:     OptionsWith(func(ro *Options) { ro.ExportDebounce = time.Hour; ro.ExportMaxDelay = time.Hour }),
		Log:      log,
		Activity: activity,
	})
	t.Cleanup(func() { _ = manager.Drain(context.Background()) })
	return manager
}

// failingObserver fails every call and counts them.
type failingObserver struct {
	mu    sync.Mutex
	kinds []ActivityKind
}

func (o *failingObserver) Record(_ context.Context, _, _ string, _ time.Time, kind ActivityKind) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.kinds = append(o.kinds, kind)
	return errors.New("the activity table is down")
}

// C# AThrowingObserverAndLoggerDoNotStopTheActivityPump.
func TestAThrowingObserverAndLoggerDoNotStopTheActivityPump(t *testing.T) {
	observer := &failingObserver{}
	manager := loggerManager(t, func(message string) {
		if strings.Contains(message, "activity observer failed") {
			panic(errors.New("logger failed"))
		}
	}, observer)
	member := &fakeMember{actor: "user-1", source: collab.SourceClientV1}
	membership := join(t, manager, "doc", member)
	manager.Settle()

	if err := membership.Receive(context.Background(), syncFrame(t, wire.Activity{})); err != nil {
		t.Fatal(err)
	}
	manager.Settle()

	observer.mu.Lock()
	defer observer.mu.Unlock()
	if len(observer.kinds) != 2 || observer.kinds[0] != ActivityJoined || observer.kinds[1] != ActivityActive {
		t.Fatalf("records = %v", observer.kinds)
	}
	if got := member.closed(); len(got) != 0 {
		t.Fatalf("closes = %v", got)
	}
}

// restartingObserver fails its first call once released; the second waits
// on its own gate.
type restartingObserver struct {
	mu               sync.Mutex
	calls            int
	first, firstIn   chan struct{}
	second, secondIn chan struct{}
}

func (o *restartingObserver) Record(context.Context, string, string, time.Time, ActivityKind) error {
	o.mu.Lock()
	o.calls++
	call := o.calls
	o.mu.Unlock()
	if call == 1 {
		close(o.firstIn)
		<-o.first
		return errors.New("the activity table is down")
	}
	if call == 2 {
		close(o.secondIn)
		<-o.second
	}
	return nil
}

// C# ASettleWaitsForRecordsARestartedPumpDelivers.
func TestASettleWaitsForRecordsARestartedPumpDelivers(t *testing.T) {
	observer := &restartingObserver{
		first: make(chan struct{}), firstIn: make(chan struct{}),
		second: make(chan struct{}), secondIn: make(chan struct{}),
	}
	manager := loggerManager(t, func(message string) {
		if strings.Contains(message, "activity observer failed") {
			panic(errors.New("logger failed"))
		}
	}, observer)
	member := &fakeMember{actor: "user-1", source: collab.SourceClientV1}
	membership := join(t, manager, "doc", member)
	wait := func(c <-chan struct{}) {
		t.Helper()
		select {
		case <-c:
		case <-time.After(10 * time.Second):
			t.Fatal("timed out")
		}
	}
	wait(observer.firstIn)

	if err := membership.Receive(context.Background(), syncFrame(t, wire.Activity{})); err != nil {
		t.Fatal(err)
	}
	settled := make(chan struct{})
	go func() {
		manager.Settle()
		close(settled)
	}()
	// Long enough for the settle to pass the lane and hold the first pump.
	time.Sleep(100 * time.Millisecond)

	close(observer.first)
	wait(observer.secondIn)
	time.Sleep(200 * time.Millisecond)
	select {
	case <-settled:
		close(observer.second)
		t.Fatal("the settle returned before the restarted pump delivered")
	default:
	}
	close(observer.second)
	wait(settled)
}

// backlogObserver blocks its first call and the call after `fails` failed
// ones; the calls between fail.
type backlogObserver struct {
	mu             sync.Mutex
	calls, fails   int
	first, firstIn chan struct{}
	last, lastIn   chan struct{}
}

func (o *backlogObserver) Record(context.Context, string, string, time.Time, ActivityKind) error {
	o.mu.Lock()
	o.calls++
	call := o.calls
	o.mu.Unlock()
	switch {
	case call == 1:
		close(o.firstIn)
		<-o.first
		return nil
	case call <= 1+o.fails:
		return errors.New("the activity table is down")
	case call == 2+o.fails:
		close(o.lastIn)
		<-o.last
	}
	return nil
}

// A pump restart after a logger throw continues in the same goroutine: a
// steady backlog with N throws does not hold N goroutines.
func TestPumpRestartsUnderABacklogDoNotPileUpGoroutines(t *testing.T) {
	const throws = 40
	observer := &backlogObserver{
		fails: throws,
		first: make(chan struct{}), firstIn: make(chan struct{}),
		last: make(chan struct{}), lastIn: make(chan struct{}),
	}
	manager := loggerManager(t, func(message string) {
		if strings.Contains(message, "activity observer failed") {
			panic(errors.New("logger failed"))
		}
	}, observer)
	wait := func(c <-chan struct{}) {
		t.Helper()
		select {
		case <-c:
		case <-time.After(10 * time.Second):
			t.Fatal("timed out")
		}
	}
	join(t, manager, "doc", &fakeMember{actor: "user-0", source: collab.SourceClientV1})
	wait(observer.firstIn)
	for i := 1; i <= throws+1; i++ {
		join(t, manager, "doc", &fakeMember{actor: "user-" + strconv.Itoa(i), source: collab.SourceClientV1})
	}
	baseline := runtime.NumGoroutine()

	close(observer.first)
	wait(observer.lastIn)
	grown := runtime.NumGoroutine() - baseline
	close(observer.last)
	manager.Settle()
	if grown > throws/4 {
		t.Fatalf("%d more goroutines after %d restarts", grown, throws)
	}
}

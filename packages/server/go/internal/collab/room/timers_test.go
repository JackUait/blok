package room

import (
	"context"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
)

// manualTimers is C#'s ManualTimeProvider for timers: nothing fires until
// Advance moves its clock.
type manualTimers struct {
	mu      sync.Mutex
	now     time.Duration
	pending []*manualTimer
}

type manualTimer struct {
	due  time.Duration
	f    func()
	done bool
}

func (m *manualTimers) AfterFunc(d time.Duration, f func()) func() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	t := &manualTimer{due: m.now + d, f: f}
	m.pending = append(m.pending, t)
	return func() bool {
		m.mu.Lock()
		defer m.mu.Unlock()
		stopped := !t.done
		t.done = true
		return stopped
	}
}

func (m *manualTimers) armed() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, t := range m.pending {
		if !t.done {
			n++
		}
	}
	return n
}

func (m *manualTimers) Advance(d time.Duration) {
	m.mu.Lock()
	m.now += d
	var due []func()
	for _, t := range m.pending {
		if !t.done && t.due <= m.now {
			t.done = true
			due = append(due, t.f)
		}
	}
	m.mu.Unlock()
	for _, f := range due {
		f()
	}
}

// C# ARoomTimerFiresOnTheTimeProviderWithNoWallTimePassing: the eviction
// timer runs on the host's timers.
func TestARoomTimerFiresOnTheTimeProviderWithNoWallTimePassing(t *testing.T) {
	timers := &manualTimers{}
	manager, _, _ := newTestManager(t, OptionsWith(func(ro *Options) {
		ro.EvictionLinger = 30 * time.Second
		ro.Timers = timers
	}), nil)
	membership := join(t, manager, "doc", &fakeMember{source: collab.SourceClientV1})

	membership.Leave()
	time.Sleep(100 * time.Millisecond)
	if got := manager.LiveRoomCount(); got != 1 {
		t.Fatalf("%d live rooms before the clock moved", got)
	}
	timers.Advance(30 * time.Second)

	waitFor(t, "the room to be evicted", func() bool { return manager.LiveRoomCount() == 0 })
}

// C# ACommitTimeoutBoundRunsOnTheTimeProvider: the drain's wait for a stuck
// observer ends when the host's clock passes CommitTimeout.
func TestACommitTimeoutBoundRunsOnTheTimeProvider(t *testing.T) {
	timers := &manualTimers{}
	observer := &gatedObserver{gate: make(chan struct{}), entered: make(chan struct{})}
	t.Cleanup(func() { close(observer.gate) })
	var logMu sync.Mutex
	var log []string
	manager := NewManager(ManagerOptions{
		Store: newMemoryStore(), Endpoint: &memoryEndpoint{}, Converter: &convert.DocConverter{Now: time.Now},
		Room: OptionsWith(func(ro *Options) {
			ro.CommitTimeout = 10 * time.Minute
			ro.Timers = timers
		}),
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
	case <-drained:
		t.Fatal("the drain ended before the clock moved")
	case <-time.After(200 * time.Millisecond):
	}
	timers.Advance(10 * time.Minute)
	select {
	case err := <-drained:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the drain did not end when the clock passed CommitTimeout")
	}
	logMu.Lock()
	defer logMu.Unlock()
	if !slices.Contains(log, `collab: room "doc" abandoned its activity dispatch while draining: the observer is past its bound`) {
		t.Fatalf("log = %q", log)
	}
}

func (m *manualTimers) armedFor(d time.Duration) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, t := range m.pending {
		if !t.done && t.due == m.now+d {
			n++
		}
	}
	return n
}

// A CommitTimeout bound that lost its select is stopped, as C# disposes the
// timer behind WaitAsync: nothing stays armed on the host's clock.
func TestABoundThatLostItsSelectIsStopped(t *testing.T) {
	timers := &manualTimers{}
	observer := &gatedObserver{gate: make(chan struct{}), entered: make(chan struct{})}
	const bound = 7 * time.Minute
	manager := NewManager(ManagerOptions{
		Store: newMemoryStore(), Endpoint: &memoryEndpoint{}, Converter: &convert.DocConverter{Now: time.Now},
		Room: OptionsWith(func(ro *Options) {
			ro.CommitTimeout = bound
			ro.Timers = timers
		}),
		Activity: observer,
	})
	join(t, manager, "doc", &fakeMember{actor: "user-0", source: collab.SourceClientV1})
	select {
	case <-observer.entered:
	case <-time.After(10 * time.Second):
		t.Fatal("the observer was never called")
	}

	drained := make(chan error, 1)
	go func() { drained <- manager.Drain(context.Background()) }()
	time.Sleep(200 * time.Millisecond)
	close(observer.gate)
	select {
	case err := <-drained:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the drain did not end")
	}
	if got := timers.armedFor(bound); got != 0 {
		t.Fatalf("%d CommitTimeout timers still armed", got)
	}
}

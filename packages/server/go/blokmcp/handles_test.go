package blokmcp

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type fakeSession struct{ closed int }

func newTestRegistry(t *testing.T, idleMs float64, max int) (*handleRegistry[*fakeSession], *float64) {
	t.Helper()
	now := 1000.0
	registry := newHandleRegistry[*fakeSession](idleMs, max)
	registry.now = func() float64 { return now }
	return registry, &now
}

func surfaceCode(err error) string {
	var failure *surfaceErr
	if errors.As(err, &failure) {
		return failure.Code
	}
	return ""
}

func TestRefusesAPrincipalAtTheCapButNotAnother(t *testing.T) {
	registry, _ := newTestRegistry(t, 1000, 1)
	if _, err := registry.add("alice", "doc", &fakeSession{}); err != nil {
		t.Fatal(err)
	}
	_, err := registry.add("alice", "doc", &fakeSession{})
	if surfaceCode(err) != "HANDLE_LIMIT" || err.Error() != "You already have 1 open documents. Close one with blok_close." {
		t.Fatalf("got %v", err)
	}
	if _, err := registry.add("bob", "doc", &fakeSession{}); err != nil {
		t.Fatalf("bob was refused: %v", err)
	}
}

func TestAnotherPrincipalsHandleIsUnknown(t *testing.T) {
	registry, _ := newTestRegistry(t, 1000, 8)
	handle, _ := registry.add("alice", "doc", &fakeSession{})
	err := registry.use(context.Background(), handle, "bob", func(*fakeSession, string) error { return nil })
	if surfaceCode(err) != "UNKNOWN_HANDLE" {
		t.Fatalf("got %v", err)
	}
}

func TestSweepSkipsBusyAndRecentHandles(t *testing.T) {
	registry, now := newTestRegistry(t, 1000, 8)
	idle, _ := registry.add("alice", "a", &fakeSession{})
	busy, _ := registry.add("alice", "b", &fakeSession{})
	*now += 2000
	fresh, _ := registry.add("alice", "c", &fakeSession{})

	release := make(chan struct{})
	started := make(chan struct{})
	go func() {
		_ = registry.use(context.Background(), busy, "alice", func(*fakeSession, string) error {
			close(started)
			<-release
			return nil
		})
	}()
	<-started
	*now += 500
	expired := registry.sweep(func(s *fakeSession) { s.closed++ })
	close(release)
	if expired != 1 {
		t.Fatalf("expired %d, want 1", expired)
	}
	if registry.has(idle) || !registry.has(busy) || !registry.has(fresh) {
		t.Fatal("the wrong handles expired")
	}
}

func TestCallsOnOneHandleRunOneAtATime(t *testing.T) {
	registry, _ := newTestRegistry(t, 1000, 8)
	handle, _ := registry.add("alice", "doc", &fakeSession{})
	var mu sync.Mutex
	running, most := 0, 0
	var group sync.WaitGroup
	for range 8 {
		group.Go(func() {
			_ = registry.use(context.Background(), handle, "alice", func(*fakeSession, string) error {
				mu.Lock()
				running++
				most = max(most, running)
				mu.Unlock()
				time.Sleep(2 * time.Millisecond)
				mu.Lock()
				running--
				mu.Unlock()
				return nil
			})
		})
	}
	group.Wait()
	if most != 1 {
		t.Fatalf("%d calls ran at once", most)
	}
}

func TestRemoveWaitsForTheRunningCall(t *testing.T) {
	registry, _ := newTestRegistry(t, 1000, 8)
	handle, _ := registry.add("alice", "doc", &fakeSession{})
	release := make(chan struct{})
	started := make(chan struct{})
	done := make(chan struct{})
	go func() {
		_ = registry.use(context.Background(), handle, "alice", func(*fakeSession, string) error {
			close(started)
			<-release
			close(done)
			return nil
		})
	}()
	<-started
	removed := make(chan struct{})
	go func() {
		_, _ = registry.remove(handle, "alice")
		close(removed)
	}()
	select {
	case <-removed:
		t.Fatal("remove did not wait for the call")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	<-removed
	<-done
}

func TestAHugeIdleTimeNeverExpires(t *testing.T) {
	registry, now := newTestRegistry(t, 9007199254740992, 8)
	handle, _ := registry.add("alice", "doc", &fakeSession{})
	*now += 1e12
	if registry.sweep(func(*fakeSession) {}) != 0 || !registry.has(handle) {
		t.Fatal("the handle expired")
	}
}

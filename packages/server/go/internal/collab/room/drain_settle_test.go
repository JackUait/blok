package room

import (
	"context"
	"testing"
	"time"
)

// C#'s drain calls SettleAsync, whose lane wait is queued at the call. With
// lane work queued behind the drain, that settle cannot be done at once, so
// a cancelled drain says it gave up, even with no activity at all.
func TestACancelledDrainWithLaneWorkQueuedBehindItSaysItWasCancelled(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.manager(t, DefaultOptions(), false)
	rb2Enter(t, manager, rb2V1("user-1", true))
	manager.mu.Lock()
	r := manager.rooms[testDoc]
	manager.mu.Unlock()

	holding, behind := make(chan struct{}), make(chan struct{})
	entered := make(chan struct{})
	r.post(func() error {
		close(entered)
		<-holding
		return nil
	})
	<-entered
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	drained := make(chan error, 1)
	go func() { drained <- manager.Drain(cancelled) }()
	// Long enough for the drain to queue on the lane.
	time.Sleep(100 * time.Millisecond)
	r.post(func() error {
		<-behind
		return nil
	})
	defer close(behind)

	close(holding)
	select {
	case err := <-drained:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the cancelled drain waited out the lane")
	}
	if !k.logged("abandoned its activity dispatch while draining: the drain was cancelled") {
		t.Fatalf("nothing logged: %q", k.lines())
	}
}

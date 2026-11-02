package room

import (
	"context"
	"testing"
	"time"
)

func TestTheLaneRunsWaitersInArrivalOrder(t *testing.T) {
	var l lane
	if err := l.enter(context.Background()); err != nil {
		t.Fatal(err)
	}
	order := make(chan int, 3)
	for i := 0; i < 3; i++ {
		ready := make(chan struct{})
		go func(i int) {
			close(ready)
			if err := l.enter(context.Background()); err != nil {
				t.Error(err)
				return
			}
			order <- i
			l.leave()
		}(i)
		<-ready
		waitForWaiters(t, &l, i+1)
	}
	l.leave()
	for want := 0; want < 3; want++ {
		if got := <-order; got != want {
			t.Fatalf("waiter %d ran at place %d", got, want)
		}
	}
}

func TestACancelledWaiterGivesUpItsPlace(t *testing.T) {
	var l lane
	if err := l.enter(context.Background()); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- l.enter(ctx) }()
	waitForWaiters(t, &l, 1)
	cancel()
	if err := <-done; err != context.Canceled {
		t.Fatalf("enter = %v, want context.Canceled", err)
	}
	l.leave()
	// The lane is free again: a cancelled waiter must not keep it.
	entered := make(chan struct{})
	go func() {
		_ = l.enter(context.Background())
		close(entered)
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("the lane stayed held by a cancelled waiter")
	}
}

func waitForWaiters(t *testing.T, l *lane, n int) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		l.mu.Lock()
		count := len(l.waiters)
		l.mu.Unlock()
		if count == n {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("never saw %d waiters", n)
}

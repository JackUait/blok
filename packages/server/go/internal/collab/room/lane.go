package room

import (
	"context"
	"sync"
)

// lane is the room's SemaphoreSlim(1, 1): one holder, waiters served in
// arrival order. The order matters: a checkpoint posted inside a commit must
// run before work that queued after it.
type lane struct {
	mu      sync.Mutex
	held    bool
	waiters []chan struct{}
}

// enter refuses an ended context even when the lane is free, as
// SemaphoreSlim.WaitAsync does.
func (l *lane) enter(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	l.mu.Lock()
	if !l.held {
		l.held = true
		l.mu.Unlock()
		return nil
	}
	turn := make(chan struct{})
	l.waiters = append(l.waiters, turn)
	l.mu.Unlock()

	select {
	case <-turn:
		return nil
	case <-ctx.Done():
		l.mu.Lock()
		for i, waiter := range l.waiters {
			if waiter == turn {
				l.waiters = append(l.waiters[:i], l.waiters[i+1:]...)
				l.mu.Unlock()
				return ctx.Err()
			}
		}
		l.mu.Unlock()
		// The lane was handed over as the context ended: pass it on.
		l.leave()
		return ctx.Err()
	}
}

// reserve takes a place in line at the call, as SemaphoreSlim.WaitAsync
// does when it is called; the channel closes on that place's turn.
func (l *lane) reserve() <-chan struct{} {
	l.mu.Lock()
	defer l.mu.Unlock()
	turn := make(chan struct{})
	if !l.held {
		l.held = true
		close(turn)
		return turn
	}
	l.waiters = append(l.waiters, turn)
	return turn
}

func (l *lane) leave() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.waiters) == 0 {
		l.held = false
		return
	}
	next := l.waiters[0]
	l.waiters = l.waiters[1:]
	close(next)
}

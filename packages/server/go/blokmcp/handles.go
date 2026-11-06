package blokmcp

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"sync"
	"time"
)

// handleRegistry is Node's HandleRegistry: handles per principal, a cap, an
// idle sweep, and one call at a time per handle. Times are milliseconds as
// float64, because --handle-idle-ms takes any JS number.
type handleRegistry[S any] struct {
	mu      sync.Mutex
	entries map[string]*handleEntry[S]
	closed  bool
	idleMs  float64
	max     int
	now     func() float64
}

type handleEntry[S any] struct {
	principal  string
	documentID string
	session    S
	lastUsed   float64
	busy       int
	// lane holds one token; a call takes it for its whole run.
	lane chan struct{}
}

func newHandleRegistry[S any](idleMs float64, max int) *handleRegistry[S] {
	return &handleRegistry[S]{
		entries: map[string]*handleEntry[S]{},
		idleMs:  idleMs,
		max:     max,
		now:     func() float64 { return float64(time.Now().UnixNano()) / 1e6 },
	}
}

func newHandleID() string {
	bytes := make([]byte, 16)
	_, _ = rand.Read(bytes)
	return base64.RawURLEncoding.EncodeToString(bytes)
}

func (r *handleRegistry[S]) assertRoomLocked(principal string) error {
	if r.closed {
		return surfaceError("SOURCE_UNAVAILABLE", "The server is shutting down.")
	}
	count := 0
	for _, entry := range r.entries {
		if entry.principal == principal {
			count++
		}
	}
	if count >= r.max {
		return handleLimit(r.max)
	}
	return nil
}

// assertRoom refuses before anything is opened.
func (r *handleRegistry[S]) assertRoom(principal string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.assertRoomLocked(principal)
}

func (r *handleRegistry[S]) add(principal, documentID string, session S) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	// Checked again: concurrent opens can pass assertRoom together.
	if err := r.assertRoomLocked(principal); err != nil {
		return "", err
	}
	handle := newHandleID()
	lane := make(chan struct{}, 1)
	lane <- struct{}{}
	r.entries[handle] = &handleEntry[S]{principal: principal, documentID: documentID, session: session, lastUsed: r.now(), lane: lane}
	return handle, nil
}

func (r *handleRegistry[S]) has(handle string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.entries[handle]
	return ok
}

func (r *handleRegistry[S]) use(ctx context.Context, handle, principal string, fn func(S, string) error) error {
	r.mu.Lock()
	entry, ok := r.entries[handle]
	if !ok || entry.principal != principal {
		r.mu.Unlock()
		return unknownHandle()
	}
	entry.busy++
	entry.lastUsed = r.now()
	r.mu.Unlock()
	defer func() {
		// Idle time restarts before the caller sees the answer.
		r.mu.Lock()
		entry.busy--
		entry.lastUsed = r.now()
		r.mu.Unlock()
	}()
	<-entry.lane
	defer func() { entry.lane <- struct{}{} }()
	return fn(entry.session, entry.documentID)
}

// remove refuses new calls at once, then waits for the running one.
func (r *handleRegistry[S]) remove(handle, principal string) (S, error) {
	r.mu.Lock()
	entry, ok := r.entries[handle]
	if !ok || entry.principal != principal {
		r.mu.Unlock()
		var zero S
		return zero, unknownHandle()
	}
	delete(r.entries, handle)
	r.mu.Unlock()
	<-entry.lane
	entry.lane <- struct{}{}
	return entry.session, nil
}

// sweep closes handles idle past the limit and not in a call.
func (r *handleRegistry[S]) sweep(onExpire func(S)) int {
	r.mu.Lock()
	cutoff := r.now() - r.idleMs
	var expired []S
	for handle, entry := range r.entries {
		if entry.busy != 0 || entry.lastUsed >= cutoff {
			continue
		}
		delete(r.entries, handle)
		expired = append(expired, entry.session)
	}
	r.mu.Unlock()
	for _, session := range expired {
		onExpire(session)
	}
	return len(expired)
}

// closeAll refuses every later open, then closes each session after its
// running call.
func (r *handleRegistry[S]) closeAll(closeSession func(S)) {
	r.mu.Lock()
	r.closed = true
	all := make([]*handleEntry[S], 0, len(r.entries))
	for _, entry := range r.entries {
		all = append(all, entry)
	}
	clear(r.entries)
	r.mu.Unlock()
	var group sync.WaitGroup
	for _, entry := range all {
		group.Go(func() {
			<-entry.lane
			entry.lane <- struct{}{}
			closeSession(entry.session)
		})
	}
	group.Wait()
}

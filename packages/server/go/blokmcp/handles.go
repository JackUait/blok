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
	mu sync.Mutex
	// settled is told each time a call leaves a handle.
	settled *sync.Cond
	entries map[string]*handleEntry[S]
	closed  bool
	// lines, when set, are the stdio lines: a stop lets the calls already
	// in a handle's line finish, as Node's call chain does.
	lines  *handleLines
	idleMs float64
	max    int
	now    func() float64
}

type handleEntry[S any] struct {
	principal  string
	documentID string
	session    S
	lastUsed   float64
	busy       int
	// lane holds one token; a call takes it for its whole run.
	lane chan struct{}
	// closing: closeAll took the handle. Only calls whose turn came before
	// cutoff may still use it.
	closing bool
	cutoff  uint64
}

func newHandleRegistry[S any](idleMs float64, max int) *handleRegistry[S] {
	registry := &handleRegistry[S]{
		entries: map[string]*handleEntry[S]{},
		idleMs:  idleMs,
		max:     max,
		now:     func() float64 { return float64(time.Now().UnixNano()) / 1e6 },
	}
	registry.settled = sync.NewCond(&registry.mu)
	return registry
}

// turnContextKey carries a stdio call's *handleTurn.
type turnContextKey struct{}

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

// count is the principal's handles in this process.
func (r *handleRegistry[S]) count(principal string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	count := 0
	for _, entry := range r.entries {
		if entry.principal == principal {
			count++
		}
	}
	return count
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
	turn, hasTurn := ctx.Value(turnContextKey{}).(*handleTurn)
	hasTurn = hasTurn && turn.handle == handle
	if !ok || entry.principal != principal || (entry.closing && (!hasTurn || turn.ticket >= entry.cutoff)) {
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
		r.settled.Broadcast()
		r.mu.Unlock()
	}()
	// The call waits for those read before it on this handle.
	if hasTurn {
		turn.wait()
	}
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
	all := map[string]*handleEntry[S]{}
	for handle, entry := range r.entries {
		entry.closing = true
		if r.lines != nil {
			entry.cutoff = r.lines.issuedSoFar()
		}
		all[handle] = entry
	}
	r.mu.Unlock()
	var group sync.WaitGroup
	for handle, entry := range all {
		group.Go(func() {
			// The calls already in line run first, then the running one.
			if r.lines != nil {
				r.lines.waitPast(handle, entry.cutoff)
			}
			r.mu.Lock()
			for entry.busy > 0 {
				r.settled.Wait()
			}
			mine := r.entries[handle] == entry
			if mine {
				delete(r.entries, handle)
			}
			r.mu.Unlock()
			<-entry.lane
			entry.lane <- struct{}{}
			// A blok_close in line may have closed it already.
			if mine {
				closeSession(entry.session)
			}
		})
	}
	group.Wait()
}

// handleLines puts the calls on each handle in line, in the order stdio
// read them: the SDK runs each call in its own goroutine, and Node's one
// event loop takes them in order. A line is kept by handle text, so it
// holds for a handle that does not exist yet or is unknown.
type handleLines struct {
	mu     sync.Mutex
	turned *sync.Cond
	lines  map[string]*handleLine
	// booked are the turns stdio took, by token, until their call claims one.
	booked map[string]*handleTurn
	// issued counts tickets for all lines, so a ticket tells which calls
	// came before a stop.
	issued uint64
}

// handleLine holds the tickets of a handle's calls not ended yet, oldest
// first; the oldest one runs.
type handleLine struct {
	pending []uint64
}

// handleTurn is one call's place in its handle's line.
type handleTurn struct {
	lines    *handleLines
	handle   string
	ticket   uint64
	released bool
}

func newHandleLines() *handleLines {
	lines := &handleLines{lines: map[string]*handleLine{}, booked: map[string]*handleTurn{}}
	lines.turned = sync.NewCond(&lines.mu)
	return lines
}

func (l *handleLines) reserve(handle string) *handleTurn {
	l.mu.Lock()
	defer l.mu.Unlock()
	line, ok := l.lines[handle]
	if !ok {
		line = &handleLine{}
		l.lines[handle] = line
	}
	turn := &handleTurn{lines: l, handle: handle, ticket: l.issued}
	l.issued++
	line.pending = append(line.pending, turn.ticket)
	return turn
}

// issuedSoFar is the ticket the next call will get.
func (l *handleLines) issuedSoFar() uint64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.issued
}

// waitPast waits until no ticket before cutoff is left on handle.
func (l *handleLines) waitPast(handle string, cutoff uint64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for {
		line := l.lines[handle]
		if line == nil || line.pending[0] >= cutoff {
			return
		}
		l.turned.Wait()
	}
}

// book reserves a turn and keeps it under a fresh token for its call.
func (l *handleLines) book(handle string) string {
	turn := l.reserve(handle)
	token := newHandleID()
	l.mu.Lock()
	l.booked[token] = turn
	l.mu.Unlock()
	return token
}

// claim hands a booked turn to its call; nil when there is none.
func (l *handleLines) claim(token string) *handleTurn {
	l.mu.Lock()
	defer l.mu.Unlock()
	turn := l.booked[token]
	delete(l.booked, token)
	return turn
}

// drop releases a booked turn no call claimed.
func (l *handleLines) drop(token string) {
	if turn := l.claim(token); turn != nil {
		turn.release()
	}
}

// wait blocks until it is this turn's go. It does not end on a cancel:
// Node runs a queued call the client cancelled too.
func (t *handleTurn) wait() {
	t.lines.mu.Lock()
	defer t.lines.mu.Unlock()
	for !t.released && t.lines.lines[t.handle].pending[0] != t.ticket {
		t.lines.turned.Wait()
	}
}

// release ends the turn, once. A turn that ends before it ran only leaves
// the line, so the next call never runs beside the one still running.
func (t *handleTurn) release() {
	t.lines.mu.Lock()
	defer t.lines.mu.Unlock()
	if t.released {
		return
	}
	t.released = true
	line := t.lines.lines[t.handle]
	for i, ticket := range line.pending {
		if ticket == t.ticket {
			line.pending = append(line.pending[:i], line.pending[i+1:]...)
			break
		}
	}
	if len(line.pending) == 0 {
		delete(t.lines.lines, t.handle)
	}
	t.lines.turned.Broadcast()
}

package room

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab"
	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// ManagerOptions are CollabRoomManager's constructor arguments.
type ManagerOptions struct {
	Store     WorkingSetStore
	Endpoint  Endpoint
	Converter Converter
	Room      Options
	Log       func(string)
	// Operations nil means no journal: v1 only, no history.
	Operations OperationStore
	Activity   ActivityObserver
}

type cooldown struct {
	failures int
	until    time.Time
}

// Manager owns one room per open doc: CollabRoomManager. Rooms remove
// themselves when they close; a call that races a closing room retries on a
// fresh one.
type Manager struct {
	store      WorkingSetStore
	endpoint   Endpoint
	converter  Converter
	options    Options
	log        func(string)
	operations OperationStore
	activity   ActivityObserver

	mu         sync.Mutex
	rooms      map[string]*Room
	purgeLanes map[string]*lane
	cooldowns  map[string]cooldown
	draining   atomic.Bool

	replacedMu sync.Mutex
	replaced   []func(docID string)
}

// NewManager builds the manager; nothing is loaded until a doc is used.
func NewManager(o ManagerOptions) *Manager {
	return &Manager{
		store:      o.Store,
		endpoint:   o.Endpoint,
		converter:  o.Converter,
		options:    o.Room.withDefaults(),
		log:        o.Log,
		operations: o.Operations,
		activity:   o.Activity,
		rooms:      map[string]*Room{},
		purgeLanes: map[string]*lane{},
		cooldowns:  map[string]cooldown{},
	}
}

// OnDocumentReplaced registers a DocumentReplaced listener: it fires on a
// reset, an applied restore and a purge.
func (m *Manager) OnDocumentReplaced(listener func(docID string)) {
	m.replacedMu.Lock()
	defer m.replacedMu.Unlock()
	m.replaced = append(m.replaced, listener)
}

func (m *Manager) documentReplaced(docID string) {
	m.replacedMu.Lock()
	listeners := append([]func(string){}, m.replaced...)
	m.replacedMu.Unlock()
	for _, listener := range listeners {
		listener(docID)
	}
}

func (m *Manager) logf(message string) {
	if m.log != nil {
		m.log(message)
	}
}

// RetryAfter is how long an overloaded request should wait.
func (m *Manager) RetryAfter() time.Duration { return m.options.RetryBackoff }

// HasJournal: an operation store is registered.
func (m *Manager) HasJournal() bool { return m.operations != nil }

// LiveRoomCount is the number of loaded rooms.
func (m *Manager) LiveRoomCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.rooms)
}

// Join is JoinAsync; it implements collab.Rooms.
func (m *Manager) Join(ctx context.Context, docID string, member collab.Member) (collab.JoinResult, error) {
	for attempt := 0; attempt < maxJoinAttempts; attempt++ {
		if m.isPurging(docID) {
			return collab.JoinResult{Status: collab.JoinPurged}, nil
		}
		if m.draining.Load() {
			return collab.JoinResult{Status: collab.JoinDraining}, nil
		}
		if m.inCommitCooldown(docID) {
			return collab.JoinResult{Status: collab.JoinUnavailable}, nil
		}
		r := m.roomFor(docID)
		if r == nil {
			return collab.JoinResult{Status: collab.JoinPurged}, nil
		}
		result, err := r.join(ctx, member)
		if err != nil {
			return collab.JoinResult{}, err
		}
		if result != nil {
			return *result, nil
		}
		m.forget(r)
	}
	return collab.JoinResult{}, errors.New(`collab: the room for "` + docID + `" kept closing during join.`)
}

// Reset is ResetForHttpAsync.
func (m *Manager) Reset(ctx context.Context, docID string) (ResetResult, error) {
	for attempt := 0; attempt < maxJoinAttempts; attempt++ {
		r := m.roomFor(docID)
		if r == nil {
			return ResetResult{Status: ResetPurged}, nil
		}
		result, err := r.reset(ctx)
		if err != nil {
			return ResetResult{}, err
		}
		if result != nil {
			m.documentReplaced(docID)
			return *result, nil
		}
		m.forget(r)
	}
	return ResetResult{}, errors.New(`collab: the room for "` + docID + `" kept closing during reset.`)
}

// Edit is the HTTP edit with the endpoint's idempotency receipt.
func (m *Manager) Edit(ctx context.Context, docID string, ops []convert.EditOp, operationID string, digest []byte,
	actorID string, expect *Precondition) (EditResult, error) {
	// Checked before a room is made, so no seed GET is spent on it.
	if expect != nil && m.operations == nil {
		return EditResult{Status: EditPreconditionRequired}, nil
	}
	return m.editInRoom(docID, func(r *Room) (*EditResult, error) {
		return r.edit(ctx, func(context.Context, *yjs.Doc) ([]convert.EditOp, error) { return ops, nil },
			false, operationID, digest, actorID, expect, nil)
	})
}

// AgentEdit is AgentEditAsync: a batch planned against the live doc inside
// the lane, after the duplicate and precondition checks, gated to one frame.
func (m *Manager) AgentEdit(ctx context.Context, docID string, plan PlanOps, operationID string, digest []byte,
	actorID string, expect *Precondition, applied Applied) (EditResult, error) {
	if expect != nil && m.operations == nil {
		return EditResult{Status: EditPreconditionRequired}, nil
	}
	return m.editInRoom(docID, func(r *Room) (*EditResult, error) {
		return r.edit(ctx, plan, true, operationID, digest, actorID, expect, applied)
	})
}

func (m *Manager) editInRoom(docID string, edit func(*Room) (*EditResult, error)) (EditResult, error) {
	for attempt := 0; attempt < maxJoinAttempts; attempt++ {
		if m.isPurging(docID) {
			return EditResult{Status: EditPurged}, nil
		}
		// A room created after the drain swept would seed and then close
		// without ever flushing.
		if m.draining.Load() {
			return EditResult{Status: EditDraining}, nil
		}
		if m.inCommitCooldown(docID) {
			return EditResult{Status: EditUnavailable}, nil
		}
		r := m.roomFor(docID)
		if r == nil {
			return EditResult{Status: EditPurged}, nil
		}
		result, err := edit(r)
		if err != nil {
			return EditResult{}, err
		}
		if result != nil {
			return *result, nil
		}
		m.forget(r)
	}
	return EditResult{}, errors.New(`collab: the room for "` + docID + `" kept closing during an edit.`)
}

// State is GET /sync/{doc}/state: the live document, loading the room the
// way an edit does.
func (m *Manager) State(ctx context.Context, docID string) (StateResult, error) {
	for attempt := 0; attempt < maxJoinAttempts; attempt++ {
		if m.isPurging(docID) {
			return StateResult{Status: StatePurged}, nil
		}
		if m.draining.Load() {
			return StateResult{Status: StateDraining}, nil
		}
		if m.inCommitCooldown(docID) {
			return StateResult{Status: StateUnavailable}, nil
		}
		r := m.roomFor(docID)
		if r == nil {
			return StateResult{Status: StatePurged}, nil
		}
		result, err := r.readState(ctx)
		if err != nil {
			return StateResult{}, err
		}
		if result != nil {
			return *result, nil
		}
		m.forget(r)
	}
	return StateResult{}, errors.New(`collab: the room for "` + docID + `" kept closing during a state read.`)
}

// RecheckAccess rechecks only a loaded room and answers the expelled count.
func (m *Manager) RecheckAccess(ctx context.Context, docID string) (int, error) {
	if docID == "" {
		return 0, ErrEmptyDocID
	}
	m.mu.Lock()
	r := m.rooms[docID]
	m.mu.Unlock()
	if r == nil {
		return 0, nil
	}
	return r.recheckAccess(ctx)
}

// Checkpoint publishes a checkpoint on a loaded document.
func (m *Manager) Checkpoint(ctx context.Context, docID string) (bool, error) {
	m.mu.Lock()
	_, purging := m.purgeLanes[docID]
	r := m.rooms[docID]
	m.mu.Unlock()
	if purging || r == nil {
		return false, nil
	}
	return r.checkpoint(ctx)
}

// ErrEmptyDocID, ErrNotSingleSegment, ErrPurgeNotAuthorized and
// ErrPurgeUnsupported are PurgeDocumentAsync's refusals.
var (
	// ErrEmptyDocID is ArgumentException.ThrowIfNullOrEmpty(documentId).
	ErrEmptyDocID         = errors.New("The value cannot be an empty string. (Parameter 'documentId')")
	ErrNotSingleSegment   = errors.New("collab: document ids must be a single path segment.")
	ErrPurgeNotAuthorized = errors.New("collab: document purge was not authorized.")
	ErrPurgeUnsupported   = errors.New("the operation journal cannot purge documents")
)

// purgeUnsupported names the registered store, as C#'s NotSupportedException does.
type purgeUnsupported struct{ store OperationStore }

func (e purgeUnsupported) Error() string {
	return fmt.Sprintf("%s: the registered collabstore.OperationStore (%T) must also implement collabstore.PurgeStore", ErrPurgeUnsupported, e.store)
}

func (e purgeUnsupported) Is(target error) bool { return target == ErrPurgeUnsupported }

// Purge is PurgeDocumentAsync. A purged id is refused for the life of the
// process: purge lanes are never removed.
func (m *Manager) Purge(ctx context.Context, docID string, authorize func(context.Context) (bool, error)) (journal.PurgeOutcome, error) {
	if docID == "" {
		return 0, ErrEmptyDocID
	}
	if docID == "." || docID == ".." || strings.ContainsAny(docID, `/\`) ||
		strings.Contains(strings.ToLower(docID), "%2f") || strings.Contains(strings.ToLower(docID), "%5c") {
		return 0, ErrNotSingleSegment
	}
	ok, err := authorize(ctx)
	if err != nil {
		return 0, err
	}
	if !ok {
		return 0, ErrPurgeNotAuthorized
	}
	purger, canPurge := m.operations.(PurgeStore)
	if m.operations != nil && !canPurge {
		return 0, purgeUnsupported{m.operations}
	}

	m.mu.Lock()
	purgeLane := m.purgeLanes[docID]
	if purgeLane == nil {
		purgeLane = &lane{}
		m.purgeLanes[docID] = purgeLane
	}
	if current := m.rooms[docID]; current != nil {
		current.requestPurge()
	}
	m.mu.Unlock()

	if err := purgeLane.enter(ctx); err != nil {
		return 0, err
	}
	defer purgeLane.leave()

	// Before anything is deleted: a failed attempt leaves no step to replay.
	m.documentReplaced(docID)
	m.mu.Lock()
	r := m.rooms[docID]
	if r != nil {
		r.requestPurge()
	}
	m.mu.Unlock()
	if r != nil {
		if err := r.purge(ctx); err != nil {
			return 0, err
		}
	}
	if canPurge {
		outcome, err := purger.Purge(ctx, docID)
		if err != nil {
			return 0, err
		}
		if outcome == journal.PurgeOpenElsewhere {
			return outcome, nil
		}
	}
	if err := m.store.Delete(ctx, docID); err != nil {
		return 0, err
	}
	return journal.Purged, nil
}

// Drain refuses new joins, flushes every room and closes members 1001. A
// join that passed the check a moment ago may add a room, so it loops.
func (m *Manager) Drain(ctx context.Context) error {
	m.draining.Store(true)
	for {
		rooms := m.liveRooms()
		if len(rooms) == 0 {
			return nil
		}
		var wg sync.WaitGroup
		for _, r := range rooms {
			wg.Add(1)
			go func() {
				defer wg.Done()
				r.drain(ctx)
				// drain always closes the room; forget it in case its close
				// callback raced a newer room.
				m.forget(r)
			}()
		}
		wg.Wait()
	}
}

// Settle is a test hook: every room's queued work and its activity delivered.
func (m *Manager) Settle() {
	for _, r := range m.liveRooms() {
		r.settle()
	}
}

func (m *Manager) liveRooms() []*Room {
	m.mu.Lock()
	defer m.mu.Unlock()
	rooms := make([]*Room, 0, len(m.rooms))
	for _, r := range m.rooms {
		rooms = append(rooms, r)
	}
	return rooms
}

func (m *Manager) isPurging(docID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.purgeLanes[docID]
	return ok
}

func (m *Manager) roomFor(docID string) *Room {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, purging := m.purgeLanes[docID]; purging {
		return nil
	}
	r := m.rooms[docID]
	if r == nil {
		r = newRoom(docID, m)
		r.onClosed = m.onRoomClosed
		m.rooms[docID] = r
	}
	return r
}

// inCommitCooldown: a document whose commit failed, or whose load repeats
// its failure, is refused for a doubling wait.
func (m *Manager) inCommitCooldown(docID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.cooldowns[docID]
	return ok && m.options.Now().Before(c.until)
}

func (m *Manager) onRoomClosed(r *Room) {
	m.mu.Lock()
	if r.commitUnavailable || r.loadHeldOff {
		failures := m.cooldowns[r.docID].failures + 1
		wait := m.options.Backoff(failures)
		m.cooldowns[r.docID] = cooldown{failures: failures, until: m.options.Now().Add(wait)}
		if r.loadHeldOff {
			m.logf(`collab: document "` + r.docID + `" failed to load in a way the next open repeats, so it is held off for ` +
				wait.String() + ` (failure ` + itoa(failures) + `); the room's own log line says why`)
		}
	} else {
		// An ordinary close: the next failure starts its wait over.
		delete(m.cooldowns, r.docID)
	}
	m.mu.Unlock()
	m.forget(r)
}

func (m *Manager) forget(r *Room) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.rooms[r.docID] == r {
		delete(m.rooms, r.docID)
	}
}

var _ collab.Rooms = (*Manager)(nil)

// Converter is the converter the rooms use, which the agent exports with.
func (m *Manager) Converter() Converter { return m.converter }

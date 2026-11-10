package room

import (
	"context"
	"errors"
	"strconv"
	"sync"
	"time"
)

// ChangeObserver is the optional half of ICollabActivityObserver.OnChangesAsync:
// an ActivityObserver that also implements it is told what changed in each
// window. Without it the room keeps no windows and reads nothing.
type ChangeObserver interface {
	OnChanges(ctx context.Context, signal ChangeSignal) error
}

// AuditObserver is ICollabActivityObserver.OnEventAsync: an ActivityObserver
// that also implements it is told each typed audit event.
type AuditObserver interface {
	OnEvent(ctx context.Context, event AuditEvent) error
}

// The audit event types: CollabAuditEventTypes.
const (
	AuditContentEdited  = "content.edited"
	AuditLineageDeleted = "history.lineageDeleted"
	AuditDocumentPurged = "document.purged"
)

// AuditActor is CollabAuditActor. Kind and OnBehalfOf are "" when unknown.
type AuditActor struct{ ID, Kind, OnBehalfOf string }

// AuditEvent is CollabAuditEvent. Actor is nil when the server does not
// know; Lineage is set for history.lineageDeleted.
type AuditEvent struct {
	Type    string
	DocID   string
	At      time.Time
	Actor   *AuditActor
	Lineage string
}

const (
	// signalQueueLimit: jobs waiting for the pump. Past it the oldest is dropped.
	signalQueueLimit = 1024
	// DefaultSignalWindow is the window when none or a non-positive one is set.
	DefaultSignalWindow = 60 * time.Second
	// MaxSignalWindow is the longest window: C#'s timers cannot be armed
	// past about 49.7 days, and every backend keeps the same bound.
	MaxSignalWindow = 24 * time.Hour
	// SignalCallTimeout bounds one journal read or one observer call on the pump.
	SignalCallTimeout = 30 * time.Second
	// editedWindow: content.edited at most once per this per document and actor.
	editedWindow     = 55 * time.Second
	editedStampLimit = 4096
)

var errSignalCallTimeout = errors.New("ran past " + strconv.Itoa(int(SignalCallTimeout/time.Second)) + " seconds")

// SignalWindowOf is the window a setting runs: zero or less is the default,
// and it never passes MaxSignalWindow.
func SignalWindowOf(setting time.Duration) time.Duration {
	switch {
	case setting <= 0:
		return DefaultSignalWindow
	case setting > MaxSignalWindow:
		return MaxSignalWindow
	}
	return setting
}

type signalWindow struct {
	lineage  string
	from, to uint64
	start    time.Time
	stop     func() bool
	closed   bool
	notes    map[uint64]RecordNote
}

type editedKey struct{ doc, actor string }

// signalHub is CollabChangeSignalHub: each document's open window, and one
// pump that reads, folds and calls the observer off every room's lane.
type signalHub struct {
	changes ChangeObserver
	audit   AuditObserver
	length  time.Duration
	now     func() time.Time
	timers  Timers
	read    func(ctx context.Context, docID, lineage string, sequence, since uint64, maxRecords int) (HistoryChanges, error)
	logf    func(string)

	mu     sync.Mutex
	open   map[string]*signalWindow
	edited map[editedKey]time.Time

	queueMu sync.Mutex
	queue   []func()
	pumping bool
	done    chan struct{}
}

// newSignalHub is nil unless the observer implements ChangeObserver or
// AuditObserver, so a host that does not pays nothing.
func newSignalHub(observer ActivityObserver, m *Manager) *signalHub {
	if observer == nil {
		return nil
	}
	changes, _ := observer.(ChangeObserver)
	audit, _ := observer.(AuditObserver)
	if changes == nil && audit == nil {
		return nil
	}
	return &signalHub{
		changes: changes, audit: audit, length: SignalWindowOf(m.options.ChangeSignalWindow), now: m.options.Now,
		timers: m.options.Timers, logf: m.logf, open: map[string]*signalWindow{}, edited: map[editedKey]time.Time{},
		read: func(ctx context.Context, docID, lineage string, sequence, since uint64, maxRecords int) (HistoryChanges, error) {
			return m.Changes(ctx, docID, lineage, sequence, since, maxRecords, MaxChangeBytes)
		},
	}
}

// committed: a record was journalled. Called on the room's lane. It never
// panics out: the record is durable, and a hub failure must not fail it.
func (h *signalHub) committed(docID, lineage string, sequence uint64, actorID string, note *RecordNote) {
	if h == nil {
		return
	}
	defer func() {
		if recover() != nil {
			h.logSafe(`collab: the change signal for "` + docID + `" lost a record`)
		}
	}()
	if h.changes != nil {
		h.window(docID, lineage, sequence, note)
	}
	if h.audit != nil && actorID != "" {
		h.editedEvent(docID, actorID, note)
	}
}

func (h *signalHub) window(docID, lineage string, sequence uint64, note *RecordNote) {
	var closed, opened *signalWindow
	h.mu.Lock()
	window := h.open[docID]
	if window != nil && window.lineage != lineage {
		delete(h.open, docID)
		window.closed = true
		closed, window = window, nil
	}
	if window == nil {
		window = &signalWindow{lineage: lineage, from: sequence, start: h.now(), notes: map[uint64]RecordNote{}}
		h.open[docID] = window
		opened = window
	}
	window.to = sequence
	if note != nil {
		window.notes[sequence] = *note
	}
	h.mu.Unlock()
	if closed != nil {
		h.deliver(docID, closed)
	}
	if opened != nil {
		// Armed outside the lock: a timer that fires at once takes it.
		stop := h.timers.AfterFunc(h.length, func() { h.close(docID, opened) })
		h.mu.Lock()
		opened.stop = stop
		h.mu.Unlock()
	}
}

// editedEvent is content.edited, throttled on its own stamps: a presence
// heartbeat never mutes it.
func (h *signalHub) editedEvent(docID, actorID string, note *RecordNote) {
	at := h.now()
	key := editedKey{docID, actorID}
	h.mu.Lock()
	if len(h.edited) > editedStampLimit {
		for k, stamp := range h.edited {
			if at.Sub(stamp) >= editedWindow {
				delete(h.edited, k)
			}
		}
	}
	if last, ok := h.edited[key]; ok && at.Sub(last) < editedWindow {
		h.mu.Unlock()
		return
	}
	h.edited[key] = at
	h.mu.Unlock()
	actor := &AuditActor{ID: actorID}
	if note != nil {
		actor.Kind, actor.OnBehalfOf = note.Kind, note.OnBehalfOf
	}
	h.event(AuditEvent{Type: AuditContentEdited, DocID: docID, At: at, Actor: actor})
}

// forget drops a purged document's open window: its records are gone.
func (h *signalHub) forget(docID string) {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if window := h.open[docID]; window != nil {
		delete(h.open, docID)
		window.closed = true
		if window.stop != nil {
			window.stop()
		}
	}
}

func (h *signalHub) event(event AuditEvent) {
	if h == nil || h.audit == nil {
		return
	}
	h.enqueue(func() {
		if err := h.bounded(func(ctx context.Context) error { return h.audit.OnEvent(ctx, event) }); err != nil {
			h.logSafe(`collab: the activity observer failed on an audit event: ` + err.Error())
		}
	})
}

// bounded runs call, giving up after SignalCallTimeout on the room's timers.
// A call that ignores its context keeps running, unawaited.
func (h *signalHub) bounded(call func(ctx context.Context) error) error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		defer func() {
			if failure := recover(); failure != nil {
				done <- errors.New(panicMessage(failure))
			}
		}()
		done <- call(ctx)
	}()
	expired := make(chan struct{})
	stop := h.timers.AfterFunc(SignalCallTimeout, func() { close(expired) })
	defer stop()
	select {
	case err := <-done:
		return err
	case <-expired:
		return errSignalCallTimeout
	}
}

func (h *signalHub) close(docID string, window *signalWindow) {
	h.mu.Lock()
	if window.closed {
		h.mu.Unlock()
		return
	}
	window.closed = true
	if h.open[docID] == window {
		delete(h.open, docID)
	}
	h.mu.Unlock()
	h.deliver(docID, window)
}

func (h *signalHub) deliver(docID string, window *signalWindow) {
	h.mu.Lock()
	stop := window.stop
	h.mu.Unlock()
	if stop != nil {
		stop()
	}
	h.enqueue(func() { h.signal(docID, window) })
}

func (h *signalHub) signal(docID string, window *signalWindow) {
	span := strconv.FormatUint(window.from, 10) + ".." + strconv.FormatUint(window.to, 10)
	count := int(min(window.to-window.from+1, uint64(MaxChangeRecords)))
	var result HistoryChanges
	err := h.bounded(func(ctx context.Context) error {
		var readErr error
		result, readErr = h.read(ctx, docID, window.lineage, window.to, window.from-1, count)
		return readErr
	})
	if err == nil && result.Status != HistoryReady {
		err = errors.New("the history is " + result.Status.String())
	}
	if err != nil {
		h.logSafe(`collab: the change signal for ` + span + ` of "` + docID + `" was dropped: ` + err.Error())
		return
	}
	records := make([]SignalRecord, len(result.Changes))
	for i, record := range result.Changes {
		var note *RecordNote
		if found, ok := window.notes[record.Sequence]; ok {
			note = &found
		}
		records[i] = signalRecordOf(window.lineage, record, note)
	}
	signal := CollapseSignal(docID, window.start, window.start.Add(h.length), records)
	if signal == nil {
		return
	}
	// A cut read names only the records it folded; the host reads the rest
	// through /history/changes.
	if result.Truncated {
		signal.Truncated = true
	} else {
		signal.FromSequence = window.from
	}
	if err := h.bounded(func(ctx context.Context) error { return h.changes.OnChanges(ctx, *signal) }); err != nil {
		h.logSafe(`collab: the activity observer failed on a change signal: ` + err.Error())
	}
}

func (h *signalHub) enqueue(job func()) {
	h.queueMu.Lock()
	dropped := false
	if len(h.queue) == signalQueueLimit {
		h.queue = h.queue[1:]
		dropped = true
	}
	h.queue = append(h.queue, job)
	if !h.pumping {
		h.pumping = true
		h.done = make(chan struct{})
		go h.pump(h.done)
	}
	h.queueMu.Unlock()
	if dropped {
		h.logSafe(`collab: a change signal or audit event was dropped; the observer is behind`)
	}
}

func (h *signalHub) pump(done chan struct{}) {
	defer close(done)
	for {
		h.queueMu.Lock()
		if len(h.queue) == 0 {
			h.pumping = false
			h.queueMu.Unlock()
			return
		}
		next := h.queue[0]
		h.queue = h.queue[1:]
		h.queueMu.Unlock()
		h.run(next)
	}
}

func (h *signalHub) run(job func()) {
	defer func() {
		if failure := recover(); failure != nil {
			h.logSafe(`collab: the activity observer failed on a change signal or audit event`)
		}
	}()
	job()
}

func (h *signalHub) logSafe(message string) {
	defer func() { _ = recover() }()
	h.logf(message)
}

// settle waits for every queued job. A test hook.
func (h *signalHub) settle() {
	if h == nil {
		return
	}
	h.queueMu.Lock()
	done := h.done
	h.queueMu.Unlock()
	if done != nil {
		<-done
	}
}

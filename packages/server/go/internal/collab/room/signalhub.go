package room

import (
	"context"
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

// signalQueueLimit: jobs waiting for the pump. Past it the oldest is dropped.
const signalQueueLimit = 1024

type signalWindow struct {
	lineage  string
	from, to uint64
	start    time.Time
	stop     func() bool
	closed   bool
	notes    map[uint64]RecordNote
}

// signalHub is CollabChangeSignalHub: each document's open window, and one
// pump that reads, folds and calls the observer off every room's lane.
type signalHub struct {
	changes ChangeObserver
	audit   AuditObserver
	length  time.Duration
	now     func() time.Time
	timers  Timers
	read    func(docID, lineage string, sequence, since uint64, maxRecords int) (HistoryChanges, error)
	logf    func(string)

	mu   sync.Mutex
	open map[string]*signalWindow

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
		changes: changes, audit: audit, length: m.options.ChangeSignalWindow, now: m.options.Now,
		timers: m.options.Timers, logf: m.logf, open: map[string]*signalWindow{},
		read: func(docID, lineage string, sequence, since uint64, maxRecords int) (HistoryChanges, error) {
			return m.Changes(context.Background(), docID, lineage, sequence, since, maxRecords, MaxChangeBytes)
		},
	}
}

// committed: a record was journalled. Called on the room's lane.
func (h *signalHub) committed(docID, lineage string, sequence uint64, note *RecordNote) {
	if h == nil || h.changes == nil {
		return
	}
	var closed *signalWindow
	h.mu.Lock()
	window := h.open[docID]
	if window != nil && window.lineage != lineage {
		delete(h.open, docID)
		window.closed = true
		closed, window = window, nil
	}
	var opened *signalWindow
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
		if err := h.audit.OnEvent(context.Background(), event); err != nil {
			h.logSafe(`collab: the activity observer failed on an audit event: ` + err.Error())
		}
	})
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
	result, err := h.read(docID, window.lineage, window.to, window.from-1, int(min(window.to-window.from+1, 1<<31-1)))
	if err != nil || result.Status != HistoryReady {
		reason := result.Status.String()
		if err != nil {
			reason = err.Error()
		}
		h.logSafe(`collab: the change signal for ` + span + ` of "` + docID + `" was dropped: ` + reason)
		return
	}
	if result.Truncated {
		h.logSafe(`collab: the change signal for ` + span + ` of "` + docID + `" lists only the newest records that fit one read`)
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
	signal.FromSequence = window.from
	if err := h.changes.OnChanges(context.Background(), *signal); err != nil {
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

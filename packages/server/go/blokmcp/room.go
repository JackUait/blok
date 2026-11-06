package blokmcp

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	mathrand "math/rand/v2"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/wire"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

// Timings of the Node provider (provider.ts) and headless room.
const (
	handshakeTimeout       = 10 * time.Second
	awarenessThrottle      = 100 * time.Millisecond
	awarenessSweepEvery    = 3 * time.Second
	maxHandshakeTimeouts   = 3
	backoffBase            = time.Second
	backoffCap             = 30 * time.Second
	shortReconnect         = 250 * time.Millisecond
	handshakeActivityEvery = 60 * time.Second
	ackTimeout             = 15 * time.Second
	emptyUpdateBytes       = 2
	maxBufferedInbound     = 64
	supportedFormat        = 2
)

const (
	relineageReason = "lineage-reset"
	oversizedReason = "oversized-update"
)

// Phases of one room connection.
const (
	phaseIdle            = "idle"
	phaseConnecting      = "connecting"
	phaseAwaitingControl = "awaiting-control"
	phaseReady           = "ready"
	phaseOffline         = "offline"
	phaseTerminal        = "terminal"
)

// roomEnd is why a room ended for good: "reset", or "terminal" with the
// collab terminal error.
type roomEnd struct {
	reason string
	err    string
}

// outboxFate is a row's fate: pending, acked (with its sequence) or
// quarantined (with the reason).
type outboxFate struct {
	state    string
	lineage  string
	sequence *string
	reason   string
}

type outboxRow struct {
	operationID string
	lineage     string
	bytes       []byte
}

// liveRoom is a headless, writing room member: the Node provider's state
// machine, its in-memory outbox and the store's awareness, on one native
// Y doc. Every field is guarded by mu; a batch holds mu from export to
// outbox append, so no peer frame lands in between.
type liveRoom struct {
	mu        sync.Mutex
	url       string // http(s)
	docID     string
	origin    *string
	tickets   func(force bool) (string, error)
	converter *convert.DocConverter
	doc       *yjs.Doc
	aware     *awareness
	count     int
	unhookDoc func()
	// pendingLocal holds local updates a batch made, until it appends them.
	pendingLocal [][]byte
	holdAppends  bool

	generation         int
	phase              string
	conn               *wsConn
	protocol           string
	lineage            *string
	buffered           []wire.Message
	handshakeTimer     *time.Timer
	firstSyncTimer     *time.Timer
	reconnectTimer     *time.Timer
	awarenessTimer     *time.Timer
	ackTimer           *time.Timer
	sweepTimer         *time.Timer
	awarenessClients   []uint64
	awarenessFull      bool
	hooked             bool
	attempt            int
	unauthorizedSince  int
	handshakeTimeouts  int
	announcedMax       *int64
	forceTicketRefresh bool
	synced             bool
	everSynced         bool
	destroyed          bool
	inFlight           *string
	resyncOwed         bool
	residual           string
	lastActivitySentAt time.Time

	// session is the lineage appends are stamped with: set when a sync
	// completes, dropped when that lineage is quarantined.
	session        *string
	appendFailures int
	rows           []*outboxRow
	fates          map[string]*outboxFate
	order          []string
	nextSeq        *string
	changed        *sync.Cond
	end            *roomEnd
	opened         chan error
	refusedBy      error
}

func newOperationID() string {
	bytes := make([]byte, 16)
	_, _ = rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

func newLiveRoom(url, docID string, origin *string, tickets func(bool) (string, error), converter *convert.DocConverter) *liveRoom {
	r := &liveRoom{url: url, docID: docID, origin: origin, tickets: tickets, converter: converter, phase: phaseIdle,
		protocol: "v1", residual: "none", fates: map[string]*outboxFate{}, opened: make(chan error, 1)}
	r.changed = sync.NewCond(&r.mu)
	r.resetDoc()
	return r
}

// resetDoc swaps in a fresh Y doc, as the store does on a relineage.
func (r *liveRoom) resetDoc() {
	if r.unhookDoc != nil {
		r.unhookDoc()
	}
	r.doc = yjs.NewDoc(yjs.Options{})
	// A new doc is a new client: the presence moves to it, state kept.
	if r.aware != nil {
		fields, present := r.aware.fields, r.aware.hasLocal
		r.aware = newAwareness(r.doc.ClientID())
		if present {
			r.aware.setLocal(fields, true)
		}
	}
	r.unhookDoc = r.doc.OnUpdate(func(event yjs.UpdateEvent) {
		r.count++
		if event.Local {
			r.onLocalUpdate(event.Update)
		}
	})
}

// onLocalUpdate is the write tap (v2) or the seam hook (v1).
func (r *liveRoom) onLocalUpdate(update []byte) {
	if r.protocol == "v2" {
		r.pendingLocal = append(r.pendingLocal, update)
		if !r.holdAppends {
			r.flushAppendsLocked()
		}
		return
	}
	if !r.hooked || r.conn == nil {
		return
	}
	bytes, err := wire.Encode(wire.SyncUpdate{Update: update})
	if err != nil {
		return
	}
	if r.announcedMax != nil && int64(len(bytes)) > *r.announcedMax {
		r.terminate("oversized-update")
		return
	}
	_ = r.conn.sendBinary(bytes)
}

// flushAppendsLocked journals the local updates a batch made and drains.
func (r *liveRoom) flushAppendsLocked() {
	updates := r.pendingLocal
	r.pendingLocal = nil
	for _, update := range updates {
		if r.session == nil {
			// The store refuses an edit with no session to stamp it.
			r.appendFailures++
			continue
		}
		row := &outboxRow{operationID: newOperationID(), lineage: *r.session, bytes: update}
		r.rows = append(r.rows, row)
		r.fates[row.operationID] = &outboxFate{state: "pending", lineage: row.lineage}
		r.order = append(r.order, row.operationID)
	}
	if len(updates) > 0 {
		r.drain()
	}
}

func (r *liveRoom) isStale(generation int) bool { return r.destroyed || generation != r.generation }

func (r *liveRoom) send(message wire.Message) {
	if r.conn == nil {
		return
	}
	bytes, err := wire.Encode(message)
	if err != nil {
		return
	}
	_ = r.conn.sendBinary(bytes)
}

func stopTimer(timer *time.Timer) *time.Timer {
	if timer != nil {
		timer.Stop()
	}
	return nil
}

// after runs fn under the lock after d, unless the generation moved on.
func (r *liveRoom) after(d time.Duration, fn func()) *time.Timer {
	generation := r.generation
	var timer *time.Timer
	timer = time.AfterFunc(d, func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		if r.destroyed || generation != r.generation {
			return
		}
		fn()
	})
	return timer
}

// --- awareness ---

func (r *liveRoom) enableAwareness() {
	if r.aware == nil {
		r.aware = newAwareness(r.doc.ClientID())
		r.scheduleSweep()
	}
}

func (r *liveRoom) scheduleSweep() {
	r.sweepTimer = stopTimer(r.sweepTimer)
	r.sweepTimer = time.AfterFunc(awarenessSweepEvery, func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		if r.destroyed || r.aware == nil {
			return
		}
		if r.aware.renewDue() {
			r.aware.setLocal(r.aware.fields, true)
			r.awarenessChanged(r.aware.local)
		}
		r.aware.sweepRemote()
		r.scheduleSweep()
	})
}

// setAwarenessField is the store's setLocalStateField plus the provider's
// update hook.
func (r *liveRoom) setAwarenessField(key string, value any) {
	if r.aware == nil {
		return
	}
	r.aware.setField(key, value)
	r.awarenessChanged(r.aware.local)
}

func (r *liveRoom) awarenessChanged(client uint64) {
	if !r.hooked {
		return
	}
	if !slices.Contains(r.awarenessClients, client) {
		r.awarenessClients = append(r.awarenessClients, client)
	}
	r.scheduleAwareness(false)
}

func (r *liveRoom) scheduleAwareness(full bool) {
	r.awarenessFull = r.awarenessFull || full
	if r.awarenessTimer != nil {
		return
	}
	r.awarenessTimer = r.after(awarenessThrottle, func() {
		r.awarenessTimer = nil
		r.flushAwareness()
	})
}

func (r *liveRoom) flushAwareness() {
	full, clients := r.awarenessFull, r.awarenessClients
	r.awarenessFull, r.awarenessClients = false, nil
	if r.conn == nil || r.phase != phaseReady || r.aware == nil {
		return
	}
	if !full && len(clients) == 0 {
		return
	}
	if full {
		clients = r.aware.known()
	}
	r.send(wire.Awareness{Update: r.aware.encode(clients)})
}

func (r *liveRoom) announceDeparture() {
	if r.conn == nil || r.phase != phaseReady || r.aware == nil {
		return
	}
	if update := r.aware.departure(); update != nil {
		r.send(wire.Awareness{Update: update})
	}
}

// sendActivity is the provider's: a no-op unless the connection is ready.
func (r *liveRoom) sendActivity() bool {
	if r.conn == nil || r.phase != phaseReady {
		return false
	}
	r.send(wire.Activity{})
	return true
}

func (r *liveRoom) sendActivityOnHandshake() {
	now := time.Now()
	if !r.lastActivitySentAt.IsZero() && now.Sub(r.lastActivitySentAt) < handshakeActivityEvery {
		return
	}
	r.lastActivitySentAt = now
	r.sendActivity()
}

// --- connection lifecycle ---

func (r *liveRoom) teardownGeneration(closeSocket bool) {
	r.hooked = false
	r.handshakeTimer = stopTimer(r.handshakeTimer)
	r.firstSyncTimer = stopTimer(r.firstSyncTimer)
	r.awarenessTimer = stopTimer(r.awarenessTimer)
	r.ackTimer = stopTimer(r.ackTimer)
	r.inFlight = nil
	r.resyncOwed = false
	r.residual = "none"
	r.awarenessClients = nil
	r.awarenessFull = false
	conn := r.conn
	if conn != nil {
		if closeSocket {
			conn.sendClose(1000)
		} else {
			conn.abort()
		}
	}
	r.conn = nil
	r.buffered = nil
	r.synced = false
	r.phase = phaseOffline
	// A new generation ignores every frame of the old socket.
	r.generation++
	if r.aware != nil {
		r.aware.clearRemote()
	}
}

func (r *liveRoom) terminate(terminal string) {
	r.teardownGeneration(true)
	r.reconnectTimer = stopTimer(r.reconnectTimer)
	r.phase = phaseTerminal
	r.reportError(terminal)
}

// reportError is the headless room's onStatus('error').
func (r *liveRoom) reportError(terminal string) {
	if r.everSynced {
		r.finish(roomEnd{reason: "terminal", err: terminal})
		return
	}
	r.signalOpen(&roomTerminalError{terminal: terminal})
}

type roomTerminalError struct{ terminal string }

func (e *roomTerminalError) Error() string { return "the room refused the connection: " + e.terminal }

func (r *liveRoom) signalOpen(err error) {
	select {
	case r.opened <- err:
	default:
	}
}

func (r *liveRoom) finish(end roomEnd) {
	if r.end != nil {
		return
	}
	r.end = &end
	r.changed.Broadcast()
}

func (r *liveRoom) nextDelay(code int) time.Duration {
	if code == 1008 {
		r.attempt += 2
	} else {
		r.attempt++
	}
	if code == 1001 && r.attempt == 1 {
		return shortReconnect
	}
	ceiling := min(float64(backoffCap), float64(backoffBase)*math.Pow(2, float64(r.attempt-1)))
	return time.Duration(math.Round(ceiling * (0.5 + mathrand.Float64()*0.5)))
}

func (r *liveRoom) scheduleReconnect(code int) {
	delay := r.nextDelay(code)
	generation := r.generation
	r.reconnectTimer = time.AfterFunc(delay, func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		if r.destroyed || generation != r.generation {
			return
		}
		r.reconnectTimer = nil
		r.openGeneration()
	})
}

// relineage drops the old lineage's pending rows and the doc, then
// reconnects for the room whole.
func (r *liveRoom) relineage(code int) {
	if r.lineage != nil {
		r.quarantineTail(*r.lineage, relineageReason)
	}
	r.resetDoc()
	r.finish(roomEnd{reason: "reset"})
	r.lineage = nil
	r.scheduleReconnect(code)
}

func (r *liveRoom) quarantineTail(lineage, reason string) {
	// A quarantined lineage takes no further rows until the next sync.
	if r.session != nil && *r.session == lineage {
		r.session = nil
	}
	r.rows = slices.DeleteFunc(r.rows, func(row *outboxRow) bool { return row.lineage == lineage })
	for _, fate := range r.fates {
		if fate.state == "pending" && fate.lineage == lineage {
			fate.state, fate.reason = "quarantined", reason
		}
	}
	r.changed.Broadcast()
}

func (r *liveRoom) openGeneration() {
	if r.destroyed {
		return
	}
	r.generation++
	r.phase = phaseConnecting
	r.enableAwareness()
	generation := r.generation
	force := r.forceTicketRefresh
	r.forceTicketRefresh = false
	go func() {
		token, err := r.tickets(force)
		r.mu.Lock()
		defer r.mu.Unlock()
		if r.isStale(generation) {
			return
		}
		if err != nil {
			if failure, ok := asSurface(err); ok && failure.Code == "FORBIDDEN" {
				// One refusal from the host ends the room for this handle.
				r.refusedBy = err
				r.teardownGeneration(false)
				r.phase = phaseTerminal
				if r.everSynced {
					r.finish(roomEnd{reason: "terminal", err: "forbidden"})
				} else {
					r.signalOpen(err)
				}
				return
			}
			r.phase = phaseOffline
			r.scheduleReconnect(0)
			return
		}
		r.openSocket(generation, token)
	}()
}

func (r *liveRoom) openSocket(generation int, token string) {
	r.phase = phaseAwaitingControl
	r.buffered = nil
	r.announcedMax = nil
	r.handshakeTimer = r.after(handshakeTimeout, func() {
		r.handshakeTimer = nil
		r.handleHandshakeTimeout()
	})
	header := map[string][]string{}
	if r.origin != nil {
		header["Origin"] = []string{*r.origin}
	}
	protocols := []string{"blok-sync.v2", "blok-sync.v1", token}
	url := r.url
	go func() {
		conn, err := dialWebSocket(context.Background(), url, header, protocols)
		r.mu.Lock()
		if r.isStale(generation) {
			r.mu.Unlock()
			if conn != nil {
				conn.abort()
			}
			return
		}
		if err != nil {
			// ws closes with 1006 after a failed handshake.
			r.handleClose(1006)
			r.mu.Unlock()
			return
		}
		r.conn = conn
		stateVector := r.doc.EncodeStateVector()
		r.send(wire.SyncStep1{StateVector: stateVector})
		r.mu.Unlock()
		r.readLoop(generation, conn)
	}()
}

func (r *liveRoom) readLoop(generation int, conn *wsConn) {
	for {
		message, code, err := conn.readMessage()
		r.mu.Lock()
		if r.isStale(generation) {
			r.mu.Unlock()
			conn.finishClosing(err != nil)
			return
		}
		if err != nil {
			r.handleClose(code)
			r.mu.Unlock()
			return
		}
		r.onMessage(message)
		r.mu.Unlock()
	}
}

func (r *liveRoom) onMessage(bytes []byte) {
	decoded, failure := wire.Decode(bytes)
	if failure != nil {
		return
	}
	switch frame := decoded.(type) {
	case wire.Unknown, wire.Operation, wire.Activity:
		return
	case wire.BlokControl:
		r.handleControl(frame.Tag)
		return
	case wire.Acknowledgement, wire.Rejection, wire.Identities:
		if r.phase == phaseAwaitingControl {
			return
		}
	}
	if r.phase == phaseAwaitingControl {
		if len(r.buffered) >= maxBufferedInbound {
			r.teardownGeneration(true)
			r.scheduleReconnect(0)
			return
		}
		r.buffered = append(r.buffered, decoded)
		return
	}
	r.handleFrame(decoded)
}

func (r *liveRoom) handleFrame(decoded wire.Message) {
	switch frame := decoded.(type) {
	case wire.SyncStep2:
		if !r.applyRemote(frame.Update) {
			return
		}
		r.markSynced()
	case wire.SyncUpdate:
		r.applyRemote(frame.Update)
	case wire.SyncStep1:
		if r.protocol == "v2" {
			r.handleResync(frame.StateVector)
		} else {
			r.answerResync(frame.StateVector)
		}
	case wire.Awareness:
		if r.aware != nil {
			r.aware.apply(frame.Update)
		}
	case wire.QueryAwareness:
		r.scheduleAwareness(true)
	case wire.BlokLimits:
		limit := frame.MaxMessageBytes
		r.announcedMax = &limit
	case wire.Acknowledgement:
		r.handleAcknowledgement(frame)
	case wire.Rejection:
		r.handleRejection(frame)
	}
}

// applyRemote applies a doc frame; a frame that cannot apply ends the room.
func (r *liveRoom) applyRemote(update []byte) bool {
	if _, err := r.doc.ApplyUpdate(update); err != nil {
		r.terminate("apply-failed")
		return false
	}
	return true
}

func (r *liveRoom) handleControl(tag wire.Tag) {
	r.handshakeTimer = stopTimer(r.handshakeTimer)
	if tag.Format != supportedFormat {
		r.terminate("unsupported-format")
		return
	}
	if r.lineage != nil && *r.lineage != tag.Lineage {
		r.teardownGeneration(true)
		r.relineage(0)
		return
	}
	lineage := tag.Lineage
	r.lineage = &lineage
	if r.conn != nil && r.conn.protocol == "blok-sync.v2" {
		r.protocol = "v2"
	} else {
		r.protocol = "v1"
	}
	if r.phase == phaseReady {
		return
	}
	r.phase = phaseReady
	r.hooked = true
	r.sendActivityOnHandshake()
	buffered := r.buffered
	r.buffered = nil
	for _, frame := range buffered {
		if r.phase != phaseReady {
			break
		}
		r.handleFrame(frame)
	}
	if r.phase != phaseReady {
		return
	}
	if r.aware != nil && len(r.aware.known()) > 0 {
		r.scheduleAwareness(true)
	}
	if !r.synced {
		r.firstSyncTimer = r.after(handshakeTimeout, func() {
			r.firstSyncTimer = nil
			r.teardownGeneration(true)
			r.scheduleReconnect(0)
		})
	}
}

func (r *liveRoom) markSynced() {
	if r.synced {
		return
	}
	r.synced = true
	if r.lineage != nil {
		lineage := *r.lineage
		r.session = &lineage
	}
	r.firstSyncTimer = stopTimer(r.firstSyncTimer)
	r.attempt = 0
	r.unauthorizedSince = 0
	r.handshakeTimeouts = 0
	if !r.everSynced {
		r.everSynced = true
		r.signalOpen(nil)
	}
	r.drain()
}

func (r *liveRoom) handleResync(stateVector []byte) {
	if r.residual != "requested" {
		r.resyncOwed = true
		r.drain()
		return
	}
	r.residual = "done"
	residual, err := r.doc.EncodeStateAsUpdate(stateVector)
	if err != nil || len(residual) <= emptyUpdateBytes || r.lineage == nil {
		return
	}
	r.pendingLocal = append(r.pendingLocal, residual)
	r.flushAppendsLocked()
}

func (r *liveRoom) answerResync(stateVector []byte) {
	update, err := r.doc.EncodeStateAsUpdate(stateVector)
	if err != nil {
		return
	}
	bytes, err := wire.Encode(wire.SyncStep2{Update: update})
	if err != nil {
		return
	}
	if r.announcedMax != nil && int64(len(bytes)) > *r.announcedMax {
		r.terminate("oversized-update")
		return
	}
	_ = r.conn.sendBinary(bytes)
}

// drain sends the oldest pending row, one at a time, on a synced v2
// connection; with none left it asks for the residual once.
func (r *liveRoom) drain() {
	if r.conn == nil || r.phase != phaseReady || r.protocol != "v2" || !r.synced || r.inFlight != nil {
		return
	}
	if len(r.rows) == 0 {
		if r.resyncOwed && r.residual == "none" {
			r.resyncOwed = false
			r.residual = "requested"
			r.send(wire.SyncStep1{StateVector: r.doc.EncodeStateVector()})
		}
		return
	}
	row := r.rows[0]
	if r.lineage == nil || row.lineage != *r.lineage {
		r.quarantineTail(row.lineage, "stale-lineage")
		r.drain()
		return
	}
	bytes, err := wire.Encode(wire.Operation{Lineage: row.lineage, OperationID: row.operationID, Update: row.bytes})
	if err != nil {
		return
	}
	if r.announcedMax != nil && int64(len(bytes)) > *r.announcedMax {
		r.quarantineTail(row.lineage, oversizedReason)
		return
	}
	_ = r.conn.sendBinary(bytes)
	id := row.operationID
	r.inFlight = &id
	r.ackTimer = r.after(ackTimeout, func() {
		r.ackTimer = nil
		r.teardownGeneration(true)
		r.scheduleReconnect(0)
	})
}

func (r *liveRoom) handleAcknowledgement(frame wire.Acknowledgement) {
	if r.protocol != "v2" || r.lineage == nil || frame.Lineage != *r.lineage {
		return
	}
	if r.inFlight != nil && *r.inFlight == frame.OperationID {
		r.inFlight = nil
		r.ackTimer = stopTimer(r.ackTimer)
	}
	sequence := strconv.FormatUint(frame.ServerSequence, 10)
	r.nextSeq = &sequence
	r.rows = slices.DeleteFunc(r.rows, func(row *outboxRow) bool { return row.operationID == frame.OperationID })
	if fate := r.fates[frame.OperationID]; fate != nil && fate.state == "pending" {
		fate.state, fate.sequence = "acked", r.nextSeq
	}
	r.nextSeq = nil
	r.changed.Broadcast()
	r.drain()
}

func (r *liveRoom) handleRejection(frame wire.Rejection) {
	if r.protocol != "v2" || r.lineage == nil || frame.Lineage != *r.lineage {
		return
	}
	if r.inFlight != nil && *r.inFlight == frame.OperationID {
		r.inFlight = nil
		r.ackTimer = stopTimer(r.ackTimer)
	}
	switch frame.Code {
	case "lineage-mismatch":
		r.teardownGeneration(true)
		r.relineage(0)
	case "not-synced":
		r.teardownGeneration(true)
		r.scheduleReconnect(0)
	default:
		r.quarantineTail(*r.lineage, frame.Code)
	}
}

func (r *liveRoom) handleClose(code int) {
	r.teardownGeneration(false)
	if code == 4401 {
		r.unauthorizedSince++
	}
	switch {
	case code == 4400:
		r.terminate("bad-request")
	case code == 4403:
		r.terminate("forbidden")
	case code == 4409:
		r.relineage(code)
	case code == 4401 && r.unauthorizedSince > 1:
		r.terminate("unauthorized")
	default:
		if code == 4401 {
			r.forceTicketRefresh = true
		}
		r.scheduleReconnect(code)
	}
}

func (r *liveRoom) handleHandshakeTimeout() {
	r.handshakeTimeouts++
	if r.handshakeTimeouts >= maxHandshakeTimeouts {
		r.terminate("handshake-timeout")
		return
	}
	r.teardownGeneration(true)
	r.scheduleReconnect(0)
}

// --- headless room ---

// open connects and waits for the first sync, a terminal answer, or the
// sync timeout.
func (r *liveRoom) open(ctx context.Context, timeout time.Duration) error {
	r.mu.Lock()
	r.openGeneration()
	r.mu.Unlock()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case err := <-r.opened:
		if err != nil {
			r.close()
		}
		return err
	case <-timer.C:
		r.close()
		return errRoomSyncTimeout
	case <-ctx.Done():
		r.close()
		return ctx.Err()
	}
}

var errRoomSyncTimeout = errors.New("the room did not finish its first sync in time")

// close announces the departure, closes with 1000 and stops every timer.
func (r *liveRoom) close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.destroyed {
		return
	}
	r.announceDeparture()
	r.destroyed = true
	r.teardownGeneration(true)
	r.reconnectTimer = stopTimer(r.reconnectTimer)
	r.sweepTimer = stopTimer(r.sweepTimer)
	r.phase = phaseTerminal
	r.changed.Broadcast()
}

// delivery waits until every id is acked, one is quarantined, the room
// ends, or timeout passes. Call with mu held.
func (r *liveRoom) waitFor(ids []string, timeout time.Duration) (state string, sequence *string, reason string, end *roomEnd) {
	deadline := time.Now().Add(timeout)
	timer := time.AfterFunc(timeout, func() {
		r.mu.Lock()
		r.changed.Broadcast()
		r.mu.Unlock()
	})
	defer timer.Stop()
	for {
		if r.end != nil {
			return "ended", nil, "", r.end
		}
		allAcked := true
		for _, id := range ids {
			fate := r.fates[id]
			if fate == nil {
				allAcked = false
				continue
			}
			if fate.state == "quarantined" {
				return "quarantined", nil, fate.reason, nil
			}
			if fate.state != "acked" {
				allAcked = false
			}
		}
		if allAcked {
			if len(ids) == 0 {
				return "acked", nil, "", nil
			}
			return "acked", r.fates[ids[len(ids)-1]].sequence, "", nil
		}
		if !time.Now().Before(deadline) || r.destroyed {
			return "timeout", nil, "", nil
		}
		r.changed.Wait()
	}
}

func roomErrorFor(err error) error {
	var terminal *roomTerminalError
	switch {
	case errors.Is(err, errRoomSyncTimeout):
		return surfaceError("ROOM_SYNC_TIMEOUT", "The room did not finish loading in time. Try again.")
	case errors.As(err, &terminal):
		return &roomTerminal{terminal: terminal.terminal}
	}
	return err
}

// roomTerminal is answered with the bundle's mcpRoomError.
type roomTerminal struct{ terminal string }

func (e *roomTerminal) Error() string { return fmt.Sprintf("the room ended: %s", e.terminal) }

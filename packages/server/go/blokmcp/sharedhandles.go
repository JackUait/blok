package blokmcp

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"
)

const (
	// leaseWait is above the slowest stored call (a 30 s endpoint load); a
	// longer wait is better told to retry.
	leaseWait = 30 * time.Second
	storeDown = "The handle store is unavailable. Retry shortly."
)

var (
	// storeSweepEvery is how often expired records leave the store.
	storeSweepEvery = 60 * time.Second
	// leaseRenewEvery is well inside the 30 s a store may keep an
	// unrenewed lease, so a few missed renewals do not lose it.
	leaseRenewEvery = 5 * time.Second
	// storeSweepTimeout ends a store sweep well before the next one is due.
	storeSweepTimeout = 30 * time.Second
)

// sweepStopWait is how long Close waits for a cancelled sweep. A sweep that
// ignores its context is left behind.
const sweepStopWait = time.Second

// storeFailed logs a store error in full; the agent sees fixed words. A
// store outage is transient, so it is no -32603.
func storeFailed(err error) error {
	logf("the handle store failed: %v", err)
	return surfaceError("SOURCE_UNAVAILABLE", storeDown)
}

// sharedHandles keeps stored handles in Options.HandleStore, so any process
// sharing it serves any call. Live handles hold sockets and stay in this
// process's registry. Per call: acquire the lease, rebuild the session from
// the record, run (the source save happens here), save the record if it
// changed, release. Shutdown never touches the store.
type sharedHandles struct {
	server *Server
	store  HandleStore
	// lanes keep one call per handle at a time in this process, so calls
	// here queue instead of polling the store's lease.
	mu    sync.Mutex
	lanes map[string]*sharedLane
	// sweepDone is closed when the sweep in flight ends; nil when none
	// runs. Under mu.
	sweepDone chan struct{}
	// sweepCtx is cancelled at shutdown.
	sweepCtx   context.Context
	stopSweeps context.CancelFunc
}

type sharedLane struct {
	token chan struct{}
	users int
}

func (h *sharedHandles) idle() time.Duration {
	return time.Duration(h.server.idleMs * float64(time.Millisecond))
}

func (h *sharedHandles) stopping() bool {
	select {
	case <-h.server.stopped:
		return true
	default:
		return false
	}
}

// assertRoom refuses an open past the cap: the store's handles plus this
// process's live ones.
func (h *sharedHandles) assertRoom(ctx context.Context, principal string) error {
	if h.stopping() {
		return surfaceError("SOURCE_UNAVAILABLE", "The server is shutting down.")
	}
	stored, err := h.store.Count(ctx, principal, h.idle())
	if err != nil {
		return storeFailed(err)
	}
	if stored+h.server.handles.count(principal) >= h.server.handles.max {
		return handleLimit(h.server.handles.max)
	}
	return nil
}

func (h *sharedHandles) add(ctx context.Context, principal, documentID string, sess session) (string, error) {
	stored, ok := sess.(*storedSession)
	if !ok {
		if err := h.assertRoom(ctx, principal); err != nil {
			return "", err
		}
		return h.server.handles.add(principal, documentID, sess)
	}
	if h.stopping() {
		return "", surfaceError("SOURCE_UNAVAILABLE", "The server is shutting down.")
	}
	handle := newHandleID()
	room := h.server.handles.max - h.server.handles.count(principal)
	added, err := h.store.TryAdd(ctx, handle, stored.snapshot(), room, h.idle())
	if err != nil {
		return "", storeFailed(err)
	}
	if !added {
		return "", handleLimit(h.server.handles.max)
	}
	return handle, nil
}

// leased runs fn under the handle's lease, after this process's earlier
// calls on it, for its owner only.
func (h *sharedHandles) leased(ctx context.Context, handle, principal string, fn func(HandleLease) error) error {
	// Checked here, before any store call: a client's text never becomes
	// a host's key.
	if !storeHandle.MatchString(handle) {
		return unknownHandle()
	}
	// A stdio call waits for the calls read before it on this handle.
	if turn, ok := ctx.Value(turnContextKey{}).(*handleTurn); ok && turn.handle == handle {
		turn.wait()
	}
	lane := h.lane(handle)
	<-lane.token
	defer h.leave(handle, lane)
	lease, err := h.store.Acquire(ctx, handle, h.idle(), leaseWait)
	switch {
	case errors.Is(err, ErrHandleUnknown):
		return unknownHandle()
	case errors.Is(err, ErrHandleBusy):
		return surfaceError("SOURCE_UNAVAILABLE", "Another call is using this handle. Retry shortly.")
	case err != nil:
		return storeFailed(err)
	}
	// Blok renews the lease while the call runs, and stops before release.
	stopRenewing := make(chan struct{})
	renewing := make(chan struct{})
	go func() {
		defer close(renewing)
		ticker := time.NewTicker(leaseRenewEvery)
		defer ticker.Stop()
		for {
			select {
			case <-stopRenewing:
				return
			case <-ticker.C:
				// A lost lease shows again when the call saves or removes.
				if err := lease.Renew(ctx); err != nil {
					logf("renewing a handle lease failed: %v", err)
				}
			}
		}
	}()
	// Release runs after Remove too: it is a no-op on an ended lease, and
	// after a failed Remove it frees the lease for the next call.
	defer func() {
		close(stopRenewing)
		<-renewing
		if err := lease.Release(ctx); err != nil {
			logf("releasing a handle lease failed: %v", err)
		}
	}()
	// Checked by Blok, not the store: a store bug must not hand one user's
	// handle to another.
	if record := lease.Record(); record.V != 1 || record.Principal != principal {
		return unknownHandle()
	}
	return fn(lease)
}

func (h *sharedHandles) lane(handle string) *sharedLane {
	h.mu.Lock()
	defer h.mu.Unlock()
	lane, ok := h.lanes[handle]
	if !ok {
		lane = &sharedLane{token: make(chan struct{}, 1)}
		lane.token <- struct{}{}
		h.lanes[handle] = lane
	}
	lane.users++
	return lane
}

func (h *sharedHandles) leave(handle string, lane *sharedLane) {
	lane.token <- struct{}{}
	h.mu.Lock()
	defer h.mu.Unlock()
	lane.users--
	if lane.users == 0 {
		delete(h.lanes, handle)
	}
}

// use rebuilds the stored session from its record and runs fn on it.
func (h *sharedHandles) use(ctx context.Context, handle, principal string, fn func(session, string) error) error {
	if h.server.handles.has(handle) {
		return h.server.handles.use(ctx, handle, principal, fn)
	}
	return h.leased(ctx, handle, principal, func(lease HandleLease) error {
		record := lease.Record()
		if record.ContractRevision != h.server.surface.ContractRevision.Stored {
			return surfaceError("VERSION_SKEW", "This handle was opened on a server with another tool contract. Call blok_open again.")
		}
		sess := h.server.restoreStored(record)
		before, _ := json.Marshal(sess.snapshot())
		err := fn(sess, record.DocumentID)
		after := sess.snapshot()
		if written, _ := json.Marshal(after); string(written) == string(before) {
			return err
		}
		if saveErr := lease.Save(ctx, after); saveErr != nil {
			// The source already has the work; a record left behind would
			// save with an old version.
			logf("saving a handle to the handle store failed, so the handle is closed: %v", saveErr)
			if removeErr := lease.Remove(ctx); removeErr != nil {
				logf("removing a handle from the handle store failed: %v", removeErr)
			}
		}
		return err
	})
}

// close checks access by the record's document, then removes the handle
// under the same lease. A refused check still closes, so the handle does
// not keep its place under the cap.
func (h *sharedHandles) close(ctx context.Context, who *caller, handle string) (refusal error, err error) {
	err = h.leased(ctx, handle, who.principal, func(lease HandleLease) error {
		allowed, err := h.server.allowed(ctx, who.principal, lease.Record().DocumentID, false)
		switch {
		case err != nil:
			refusal = err
		case !allowed:
			refusal = surfaceError("FORBIDDEN", "You no longer have access to this document.")
		}
		if err := lease.Remove(ctx); err != nil {
			return storeFailed(err)
		}
		return nil
	})
	return refusal, err
}

// startSweep deletes expired records apart from the caller, so a stuck
// store never holds local expiry. One sweep at a time: a tick while one
// runs is skipped. Errors are only logged.
func (h *sharedHandles) startSweep(timeout time.Duration) {
	// Under mu, so no sweep starts once wait began.
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.stopping() || h.sweepDone != nil {
		return
	}
	done := make(chan struct{})
	h.sweepDone = done
	ctx, cancel := context.WithTimeout(h.sweepCtx, timeout)
	go func() {
		defer close(done)
		defer cancel()
		if err := h.store.Sweep(ctx, h.idle()); err != nil {
			logf("sweeping the handle store failed: %v", err)
		}
		h.mu.Lock()
		h.sweepDone = nil
		h.mu.Unlock()
	}()
}

// wait cancels the sweep in flight and waits for it up to sweepStopWait.
// Call it after stopped is closed.
func (h *sharedHandles) wait() {
	h.mu.Lock()
	done := h.sweepDone
	h.mu.Unlock()
	h.stopSweeps()
	if done == nil {
		return
	}
	timer := time.NewTimer(sweepStopWait)
	defer timer.Stop()
	select {
	case <-done:
	case <-timer.C:
		logf("a handle store sweep ignored its cancel; shutting down without it")
	}
}

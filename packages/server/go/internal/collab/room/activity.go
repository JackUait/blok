package room

import (
	"context"
	"time"
)

// recordActivityLocked hands one moment of a member's presence to the
// host's observer. The decision needs the lane; the call runs off it, so a
// slow observer never stalls the document.
func (r *Room) recordActivityLocked(actorID string, kind ActivityKind) {
	// No verified identity, no call of any kind.
	if actorID == "" || r.activity == nil {
		return
	}
	at := r.options.Now()
	if len(r.activityStamps) > activityStampLimit {
		r.sweepActivityStampsLocked(at)
	}
	if kind == ActivityActive || kind == ActivityEdited {
		if reported, ok := r.activityStamps[actorID]; ok && at.Sub(reported) < activityWindow {
			return
		}
		// Stamped only where a call is made, or a busy actor stays silenced.
		r.activityStamps[actorID] = at
	}

	var dropped *pendingActivity
	r.activityMu.Lock()
	if len(r.activityQueue) == activityQueueLimit {
		// Heartbeats go first, oldest of them; a session boundary only when
		// no heartbeat is left.
		victim := 0
		for i, pending := range r.activityQueue {
			if pending.kind == ActivityActive || pending.kind == ActivityEdited {
				victim = i
				break
			}
		}
		lost := r.activityQueue[victim]
		dropped = &lost
		r.activityQueue = append(r.activityQueue[:victim], r.activityQueue[victim+1:]...)
	}
	r.activityQueue = append(r.activityQueue, pendingActivity{actor: actorID, at: at, kind: kind})
	if !r.activityPumping {
		r.activityPumping = true
		done := make(chan struct{})
		r.activityDispatch = done
		go r.pumpActivity(done)
	}
	r.activityMu.Unlock()

	if dropped != nil {
		r.logfSurviving(`collab: room "` + r.docID + `" dropped an activity record (` + dropped.kind.String() +
			`) for "` + dropped.actor + `"; the activity observer is behind`)
	}
}

// sweepActivityStampsLocked drops only stamps the window no longer covers.
func (r *Room) sweepActivityStampsLocked(at time.Time) {
	for actor, reported := range r.activityStamps {
		if at.Sub(reported) >= activityWindow {
			delete(r.activityStamps, actor)
		}
	}
}

// pumpActivity drains the queue one call at a time. It never takes the lane.
func (r *Room) pumpActivity(done chan struct{}) {
	defer close(done)
	for {
		r.activityMu.Lock()
		if len(r.activityQueue) == 0 {
			// Cleared under the lock that would start the next pump.
			r.activityPumping = false
			r.activityMu.Unlock()
			return
		}
		next := r.activityQueue[0]
		r.activityQueue = r.activityQueue[1:]
		r.activityMu.Unlock()
		r.recordOne(next)
	}
}

func (r *Room) recordOne(next pendingActivity) {
	defer func() {
		if failure := recover(); failure != nil {
			r.logf(`collab: room "` + r.docID + `" activity observer failed`)
		}
	}()
	if err := r.activity.Record(context.Background(), r.docID, next.actor, next.at, next.kind); err != nil {
		r.logf(`collab: room "` + r.docID + `" activity observer failed: ` + err.Error())
	}
}

// settle completes once every lane operation queued before it has run and
// the activity they produced has been delivered. Unbounded: callers bound it.
func (r *Room) settle() {
	_ = r.run(context.Background(), func() error { return nil })
	r.activityMu.Lock()
	pending := r.activityDispatch
	r.activityMu.Unlock()
	if pending != nil {
		<-pending
	}
}

// activityPending: the pump is still delivering records.
func (r *Room) activityPending() bool {
	r.activityMu.Lock()
	pending := r.activityDispatch
	r.activityMu.Unlock()
	if pending == nil {
		return false
	}
	select {
	case <-pending:
		return false
	default:
		return true
	}
}

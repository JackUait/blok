package room

import (
	"context"
	"time"
)

// recordActivityLocked hands one moment of a member's presence to the
// host's observer. The decision needs the lane; the call runs off it, so a
// slow observer never stalls the document.
func (r *Room) recordActivityLocked(actorID string, kind ActivityKind) {
	r.recordActivityNotedLocked(actorID, kind, nil)
}

// recordEditedLocked is Edited, and the content.edited event at the same
// moment, with the record's note.
func (r *Room) recordEditedLocked(actorID string, note *RecordNote) {
	r.recordActivityNotedLocked(actorID, ActivityEdited, note)
}

func (r *Room) recordActivityNotedLocked(actorID string, kind ActivityKind, note *RecordNote) {
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
	if kind == ActivityEdited {
		actor := &AuditActor{ID: actorID}
		if note != nil {
			actor.Kind, actor.OnBehalfOf = note.Kind, note.OnBehalfOf
		}
		r.signals.event(AuditEvent{Type: AuditContentEdited, DocID: r.docID, At: at, Actor: actor})
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
// done closes only once the queue is empty, so a settle holding it waits
// for records delivered after a restart too.
func (r *Room) pumpActivity(done chan struct{}) {
	defer close(done)
	for !r.drainActivity() {
	}
}

// drainActivity delivers records until the queue is empty. False if the
// host logger panicked first: left set, the pumping flag would make this
// room's activity dead for good, so the pump goes round again in the same
// goroutine.
func (r *Room) drainActivity() (drained bool) {
	defer func() {
		if recover() != nil {
			drained = false
		}
	}()
	for {
		r.activityMu.Lock()
		if len(r.activityQueue) == 0 {
			// Cleared under the lock that would start the next pump.
			r.activityPumping = false
			r.activityMu.Unlock()
			return true
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

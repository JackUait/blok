package room

import (
	"context"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab/docendpoint"
)

// persistLocked writes the blob INSIDE the lane; only the seed, edits and
// the flush pay that.
func (r *Room) persistLocked(ctx context.Context) error {
	pending := r.blobVersion
	if err := r.store.Write(ctx, r.docID, append([]byte(nil), r.frameSection.Bytes()...), r.tag); err != nil {
		return err
	}
	r.persistedVersion = pending
	r.persistFailures = 0
	return nil
}

// schedulePersistLocked starts the blob write beside the lane, single
// flight; edits made meanwhile are coalesced into the next one.
func (r *Room) schedulePersistLocked() {
	if r.purgeRequested.Load() || r.state != stateReady || r.inFlightPersist != nil || r.blobVersion == r.persistedVersion {
		return
	}
	r.persistingVersion = r.blobVersion
	frames := append([]byte(nil), r.frameSection.Bytes()...)
	tag := r.tag
	write := start(func() (struct{}, error) {
		return struct{}{}, r.store.Write(r.lifetime, r.docID, frames, tag)
	})
	r.inFlightPersist = write
	go func() {
		_, failure := write.wait()
		r.post(func() error {
			r.onPersistFinishedLocked(write, failure)
			return nil
		})
	}()
}

// settleInFlightPersistLocked waits out the off-lane write so nothing
// written after it can be overtaken.
func (r *Room) settleInFlightPersistLocked() {
	write := r.inFlightPersist
	if write == nil {
		return
	}
	r.inFlightPersist = nil
	if _, err := write.wait(); err != nil {
		if r.lifetime.Err() == nil {
			r.logf(`collab: room "` + r.docID + `" could not persist the working set: ` + err.Error())
		}
		return
	}
	r.persistedVersion = r.persistingVersion
	r.persistFailures = 0
}

func (r *Room) onPersistFinishedLocked(write *task[struct{}], failure error) {
	if write != r.inFlightPersist {
		return
	}
	r.inFlightPersist = nil
	if failure == nil {
		r.persistedVersion = r.persistingVersion
		r.persistFailures = 0
		r.schedulePersistLocked()
		return
	}
	if r.lifetime.Err() != nil {
		return
	}
	r.logf(`collab: room "` + r.docID + `" could not persist the working set: ` + failure.Error())
	r.persistFailures++
	r.persistTimer.change(r.options.Backoff(r.persistFailures))
}

// compactIfOversizedLocked is true when the log was replaced by one
// full-state frame.
func (r *Room) compactIfOversizedLocked() bool {
	if r.frameCount < 2 ||
		(r.frameCount < r.options.CompactionFrameThreshold &&
			int64(r.frameSection.Len())-r.baseFrameLength < r.options.CompactionByteThreshold) {
		return false
	}
	if err := r.compactLocked(); err != nil {
		r.logf(`collab: room "` + r.docID + `" background work failed: ` + err.Error())
		return false
	}
	return true
}

// compactLocked replaces the log with the doc's whole state, pending structs
// included.
func (r *Room) compactLocked() error {
	whole, err := r.doc.EncodeStateAsUpdate(nil)
	if err != nil {
		return err
	}
	r.replaceLogLocked(whole)
	return nil
}

func (r *Room) replaceLogLocked(whole []byte) {
	r.frameSection.Reset()
	r.frameCount = 0
	r.appendLocked(whole)
	r.baseFrameLength = int64(r.frameSection.Len())
}

// markDirtyLocked: the consumer's JSON is behind the document. A journal
// room's projection is scheduled by checkpoints and eviction/drain only.
func (r *Room) markDirtyLocked() {
	r.exportDirty = true
	if r.dirtySince == nil {
		now := r.options.Now()
		r.dirtySince = &now
	}
	if r.session == nil {
		r.scheduleExportLocked()
	}
}

// isTransientExportFailure: a CollabTransientException or a cancellation.
func isTransientExportFailure(err error) bool {
	return isTransient(err) || isCancellation(err)
}

func (r *Room) refuseProjectionLocked(err error, why string) {
	if r.projectionRefused {
		return
	}
	r.projectionRefused = true
	if why == "" {
		why = `collab: room "` + r.docID + `" cannot export its document, so the consumer's record ` +
			"stays behind and no retry will change that"
	}
	r.logf(why + ": " + err.Error())
}

// projectionLocked is nil on a working-set-only room: it has no sequence.
func (r *Room) projectionLocked() *docendpoint.Projection {
	if r.session == nil {
		return nil
	}
	return &docendpoint.Projection{Lineage: r.tag.Lineage, ServerSequence: r.committedThrough}
}

func (r *Room) scheduleExportLocked() {
	if r.inFlightSave != nil || r.dirtySince == nil {
		return
	}
	now := r.options.Now()
	due := now.Add(r.options.ExportDebounce)
	if latest := r.dirtySince.Add(r.options.ExportMaxDelay); latest.Before(due) {
		due = latest
	}
	if r.exportRetryAt != nil && r.exportRetryAt.After(due) {
		due = *r.exportRetryAt
	}
	delay := due.Sub(now)
	if delay < 0 {
		delay = 0
	}
	r.exportTimer.change(delay)
}

func (r *Room) tryExportLocked() error {
	if r.purgeRequested.Load() || r.state != stateReady || !r.exportDirty || r.inFlightSave != nil {
		return nil
	}
	r.settleVersionLocked()
	snapshot, err := r.converter.Export(r.lifetime, r.doc)
	if err != nil {
		if r.session != nil && !isTransientExportFailure(err) {
			r.refuseProjectionLocked(err, "")
			return nil
		}
		if r.lifetime.Err() != nil {
			return nil
		}
		if isRuntimeLimit(err) {
			r.transientExportFailures++
			if r.transientExportFailures >= transientExportFailureLimit {
				next := "next checkpoint"
				if r.session == nil {
					next = "next edit"
				}
				r.refuseProjectionLocked(err, `collab: room "`+r.docID+`" gave up exporting after `+itoa(r.transientExportFailures)+
					` attempts that ran past the runtime's limits, so the consumer's record stays behind until the `+
					next+` retries it (raise the runtime's timeout for documents this large)`)
				return nil
			}
		}
		r.logf(`collab: room "` + r.docID + `" could not export, retrying: ` + err.Error())
		r.exportFailures++
		retry := r.options.Now().Add(r.options.Backoff(r.exportFailures))
		r.exportRetryAt = &retry
		r.scheduleExportLocked()
		return nil
	}
	r.transientExportFailures = 0
	// Cleared at the snapshot: this is what the checkpoint owed.
	r.projectionOwed = false
	version, projection := r.version, r.projectionLocked()
	save := start(func() (*string, error) {
		return r.endpoint.Save(r.lifetime, r.docID, snapshot, version, projection)
	})
	r.exportDirty = false
	r.dirtySince = nil
	r.inFlightSave = save
	go func() {
		answered, failure := save.wait()
		r.post(func() error {
			r.onSaveFinishedLocked(save, answered, failure)
			return nil
		})
	}()
	return nil
}

func (r *Room) onSaveFinishedLocked(save *task[*string], answered *string, failure error) {
	if save != r.inFlightSave {
		return
	}
	r.inFlightSave = nil
	if r.state != stateReady {
		return
	}
	if failure != nil {
		r.logf(`collab: room "` + r.docID + `" export failed, retrying: ` + failure.Error())
		r.exportDirty = true
		if r.dirtySince == nil {
			now := r.options.Now()
			r.dirtySince = &now
		}
		r.exportFailures++
		retry := r.options.Now().Add(r.options.Backoff(r.exportFailures))
		r.exportRetryAt = &retry
	} else {
		r.exportFailures = 0
		r.exportRetryAt = nil
		r.projectionRefused = false
		if answered != nil {
			r.version = answered
		}
	}
	if r.exportDirty && (failure != nil || r.projectionOwed || r.session == nil) {
		r.scheduleExportLocked()
	}
}

func (r *Room) evictLocked() error {
	if r.state != stateReady || r.members.len() > 0 {
		return nil
	}
	r.flushLocked(context.Background())
	if r.blobVersion != r.persistedVersion {
		// A blob with any frame in it is authoritative on the next open, so
		// the room stays the authority until the write lands.
		r.persistFailures++
		r.logf(`collab: room "` + r.docID + `" is staying loaded until its working set is written`)
		r.updateEvictionLocked(r.options.Backoff(r.persistFailures))
		return nil
	}
	if r.exportDirty && !r.projectionRefused {
		r.exportFailures++
		r.logf(`collab: room "` + r.docID + `" is staying loaded until its export lands`)
		r.updateEvictionLocked(r.options.Backoff(r.exportFailures))
		return nil
	}
	r.closeRoomLocked(nil)
	return nil
}

// flushLocked is compact + persist + export, all awaited; failures are
// logged, not returned.
func (r *Room) flushLocked(caller context.Context) {
	ctx, cancel := context.WithCancel(r.lifetime)
	defer cancel()
	stop := context.AfterFunc(caller, cancel)
	defer stop()
	// AfterFunc runs later; C#'s linked token starts cancelled at once.
	if caller.Err() != nil {
		cancel()
	}

	if save := r.inFlightSave; save != nil {
		answered, err := save.wait()
		if err != nil {
			r.logf(`collab: room "` + r.docID + `" export failed during flush: ` + err.Error())
			r.exportDirty = true
		} else if answered != nil {
			r.version = answered
		}
		r.inFlightSave = nil
	}
	// The in-flight write carries an older snapshot: it lands first.
	r.settleInFlightPersistLocked()
	if r.frameCount > 1 {
		if err := r.compactLocked(); err != nil {
			r.logf(`collab: room "` + r.docID + `" could not flush the working set: ` + err.Error())
		}
	}
	if r.blobVersion != r.persistedVersion {
		before := ctx.Err() != nil
		if err := r.persistLocked(ctx); err != nil && r.lifetime.Err() == nil {
			r.logf(`collab: room "` + r.docID + `" could not flush the working set: ` + errorText(err, ctx, before))
		}
	}
	if !r.exportDirty {
		return
	}
	r.settleVersionLocked()
	before := ctx.Err() != nil
	snapshot, err := r.converter.Export(ctx, r.doc)
	if err != nil {
		if r.lifetime.Err() != nil {
			return
		}
		if r.session != nil && !isTransientExportFailure(err) {
			r.refuseProjectionLocked(err, "")
		} else {
			r.logf(`collab: room "` + r.docID + `" could not export during flush: ` + errorText(err, ctx, before))
		}
		return
	}
	r.projectionOwed = false
	before = ctx.Err() != nil
	answered, err := r.endpoint.Save(ctx, r.docID, snapshot, r.version, r.projectionLocked())
	if err != nil {
		if r.lifetime.Err() == nil {
			r.logf(`collab: room "` + r.docID + `" could not export during flush: ` + errorText(err, ctx, before))
		}
		return
	}
	if answered != nil {
		r.version = answered
	}
	r.exportDirty = false
	r.dirtySince = nil
	r.exportFailures = 0
	r.exportRetryAt = nil
	r.projectionRefused = false
}

// after is time.After on the room's timers.
func (r *Room) after(d time.Duration) <-chan struct{} {
	passed := make(chan struct{})
	r.options.Timers.AfterFunc(d, func() { close(passed) })
	return passed
}

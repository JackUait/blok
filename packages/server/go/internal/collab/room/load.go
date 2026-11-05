package room

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/JackUait/blok/packages/server/go/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/internal/collab/wire"
	"github.com/JackUait/blok/packages/server/go/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/internal/jsruntime"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

const (
	openPurged    = journal.DocumentPurged
	openElsewhere = journal.DocumentOpenElsewhere
)

// loadFailure is why a load produced no Ready room. open is journal.Opened
// when the failure is an error, not an open outcome.
type loadFailure struct {
	open journal.OpenOutcome
	err  error
}

// newDocLocked: a random uint32 client id, as a browser draws.
func (r *Room) newDocLocked() {
	if r.unsubscribe != nil {
		r.unsubscribe()
	}
	r.doc = yjs.NewDoc(yjs.Options{})
	r.unsubscribe = r.doc.OnUpdate(r.onLocalUpdate)
}

// onLocalUpdate captures what a LOCAL transaction produced; its caller
// decides when that becomes observable.
func (r *Room) onLocalUpdate(event yjs.UpdateEvent) {
	if event.Local {
		r.localUpdates = append(r.localUpdates, event.Update)
	}
}

func (r *Room) tryOpenJournalLocked() (journal.OpenOutcome, error) {
	outcome, session, err := r.operations.Open(r.lifetime, r.docID)
	if err != nil {
		return journal.Opened, err
	}
	if outcome == journal.DocumentPurged {
		return journal.DocumentPurged, nil
	}
	if session == nil {
		r.logf(`collab: document "` + r.docID + `" is open in another process`)
		return journal.DocumentOpenElsewhere, nil
	}
	r.session = session
	return journal.Opened, nil
}

// tryLoadLocked is load-or-seed; it returns the failure so the join can
// report it.
func (r *Room) tryLoadLocked() *loadFailure {
	failure, err := r.loadLocked()
	if err != nil {
		r.logf(`collab: room "` + r.docID + `" could not load: ` + err.Error())
		r.loadHeldOff = r.migrationFailed || isRuntimeLimit(err)
		return &loadFailure{open: journal.Opened, err: err}
	}
	return failure
}

func (r *Room) loadLocked() (*loadFailure, error) {
	r.newDocLocked()
	if r.operations != nil {
		open, err := r.tryOpenJournalLocked()
		if err != nil {
			return nil, err
		}
		if open != journal.Opened {
			return &loadFailure{open: open}, nil
		}
		if err := r.loadFromJournalLocked(true); err != nil {
			return nil, err
		}
		r.state = stateReady
		return nil, nil
	}

	stored, err := r.store.Read(r.lifetime, r.docID)
	if err != nil {
		return nil, err
	}
	if stored != nil {
		if err := r.requireReadableFormat(stored.Tag.Format); err != nil {
			return nil, err
		}
		r.tag = stored.Tag
		if err := r.hydrateLocked(stored.Updates); err != nil {
			return nil, err
		}
	}

	switch {
	case r.frameCount == 0:
		if r.tag.Format != workingset.CurrentFormat {
			// Nothing to migrate; the seed writes the current format.
			r.tag = workingset.Tag{Format: workingset.CurrentFormat, Epoch: r.tag.Epoch + 1, Lineage: workingset.NewLineage()}
		}
		if err := r.seedLocked(); err != nil {
			return nil, err
		}
	case r.tag.Format != workingset.CurrentFormat:
		if err := r.migrateWorkingSetLocked(); err != nil {
			return nil, err
		}
	case r.compactIfOversizedLocked():
		if err := r.persistLocked(r.lifetime); err != nil && r.lifetime.Err() == nil {
			// The doc and the stored blob are both fine; the compacted log
			// is retried once the room is Ready.
			r.logf(`collab: room "` + r.docID + `" could not write its compacted working set, retrying: ` + err.Error())
			r.persistFailures++
			r.persistTimer.change(r.options.Backoff(r.persistFailures))
		} else if err != nil {
			return nil, err
		}
	}
	r.state = stateReady
	return nil, nil
}

// loadFromJournalLocked replays committed data only: the baseline, the
// checkpoint, then the tail. A document with no head has never been seeded.
func (r *Room) loadFromJournalLocked(migrate bool) error {
	opened := r.session.OpenResult()
	if opened.Head == nil {
		return r.seedJournalLocked()
	}
	if err := r.requireReadableFormat(opened.Head.Format); err != nil {
		return err
	}
	r.tag = workingset.Tag{Format: opened.Head.Format, Epoch: opened.Head.Epoch, Lineage: opened.Head.Lineage}
	r.committedThrough = opened.Head.DurableThrough
	r.checkpointedThrough = 0
	if opened.Checkpoint != nil {
		r.checkpointedThrough = opened.Checkpoint.Through
	}
	// The uncovered tail counts toward the next checkpoint. Wraps like C#'s
	// ulong-to-long cast when a store answers a checkpoint ahead of durable.
	r.operationsSinceCheckpoint = int64(r.committedThrough - r.checkpointedThrough)
	r.startVersionReadLocked()
	if err := r.hydrateCommittedLocked(opened.Baseline); err != nil {
		return err
	}
	if opened.Checkpoint != nil {
		if err := r.hydrateCommittedLocked([][]byte{opened.Checkpoint.State}); err != nil {
			return err
		}
	}
	tail := make([][]byte, len(opened.Tail))
	for i, record := range opened.Tail {
		tail[i] = record.Update
	}
	if err := r.hydrateCommittedLocked(tail); err != nil {
		return err
	}
	if migrate && r.tag.Format != workingset.CurrentFormat {
		if err := r.migrateJournalLocked(); err != nil {
			return err
		}
	}
	// The journal is the record now; a working set beside it is stale.
	r.dropWorkingSetLocked()
	// The previous room may have died with a projection owed.
	r.markDirtyLocked()
	return nil
}

// startVersionReadLocked reads the consumer's version handle beside the
// room, best effort.
func (r *Room) startVersionReadLocked() {
	reading := start(func() (*string, error) {
		loaded, err := r.endpoint.Load(r.lifetime, r.docID)
		if err != nil {
			if r.lifetime.Err() == nil {
				r.logf(`collab: room "` + r.docID + `" could not read the document version, so its write-back will carry none: ` + err.Error())
			}
			return nil, nil
		}
		return loaded.Version, nil
	})
	r.pendingVersion = reading
	go func() {
		answered, _ := reading.wait()
		r.post(func() error {
			r.applyVersionLocked(reading, answered)
			return nil
		})
	}()
}

// applyVersionLocked may only fill the handle, never replace one.
func (r *Room) applyVersionLocked(reading *task[*string], answered *string) {
	if reading != r.pendingVersion {
		return
	}
	r.pendingVersion = nil
	if answered != nil && r.version == nil {
		r.version = answered
	}
}

// settleVersionLocked waits out the load-time version read where a PUT is
// built, bounded because the lane is held.
func (r *Room) settleVersionLocked() {
	reading := r.pendingVersion
	if reading == nil {
		return
	}
	select {
	case <-reading.done:
		r.applyVersionLocked(reading, reading.result)
	case <-r.after(r.options.CommitTimeout):
		r.logf(`collab: room "` + r.docID + `" is projecting before its version read finished: it did not answer within the commit timeout`)
	}
}

func (r *Room) hydrateCommittedLocked(updates [][]byte) error {
	for _, update := range updates {
		if _, ok := r.applyRemoteLocked(update); !ok {
			return fmt.Errorf(`collab: committed data for "%s" could not be applied.`, r.docID)
		}
		r.appendLocked(update)
	}
	return nil
}

// seedJournalLocked: the endpoint's JSON becomes the sequence-zero baseline
// under a fresh lineage, and the reset is awaited.
func (r *Room) seedJournalLocked() error {
	adopted, err := r.tryAdoptWorkingSetLocked()
	if err != nil || adopted {
		return err
	}
	loaded, err := r.endpoint.Load(r.lifetime, r.docID)
	if err != nil {
		return err
	}
	r.version = loaded.Version
	r.localUpdates = nil
	if loaded.Data != nil {
		if err := r.converter.Seed(r.lifetime, r.doc, loaded.Data); err != nil {
			return err
		}
	}
	baseline := make([][]byte, 0, len(r.localUpdates))
	for _, update := range r.localUpdates {
		r.appendLocked(update)
		baseline = append(baseline, update)
	}
	r.localUpdates = nil
	head, err := r.session.Reset(r.lifetime, operation.Reset{
		Format:   workingset.CurrentFormat,
		Epoch:    0,
		Lineage:  workingset.NewLineage(),
		Baseline: baseline,
	})
	if err != nil {
		return err
	}
	r.tag = workingset.Tag{Format: head.Format, Epoch: head.Epoch, Lineage: head.Lineage}
	return nil
}

// tryAdoptWorkingSetLocked makes a working set left by a journal-less room
// the journal's baseline. False when there is nothing to adopt.
func (r *Room) tryAdoptWorkingSetLocked() (bool, error) {
	stored, err := r.store.Read(r.lifetime, r.docID)
	if err != nil || stored == nil {
		return false, err
	}
	if err := r.requireReadableFormat(stored.Tag.Format); err != nil {
		return false, err
	}
	frames, ok := workingset.DecodeFrames(stored.Updates)
	if !ok {
		return false, fmt.Errorf(`collab: the stored working set for "%s" is not a valid update log.`, r.docID)
	}
	if len(frames) == 0 {
		return false, nil
	}
	for _, frame := range frames {
		if _, ok := r.applyRemoteLocked(frame); !ok {
			return false, fmt.Errorf(`collab: a stored update for "%s" could not be applied.`, r.docID)
		}
	}
	adopted := stored.Tag
	if !adopted.IsAnnounceable() {
		adopted = workingset.Tag{Format: workingset.CurrentFormat, Epoch: 0, Lineage: workingset.NewLineage()}
	}
	baseline := frames
	// The STORED format: the fallback above stamps the current one on a copy
	// that is still format 1.
	if stored.Tag.Format != workingset.CurrentFormat {
		if err := r.migrateRichTextLocked(); err != nil {
			return false, err
		}
		whole, err := r.doc.EncodeStateAsUpdate(nil)
		if err != nil {
			return false, err
		}
		baseline = [][]byte{whole}
		adopted = workingset.Tag{Format: workingset.CurrentFormat, Epoch: adopted.Epoch + 1, Lineage: workingset.NewLineage()}
	}
	head, err := r.session.Reset(r.lifetime, operation.Reset{
		Format: adopted.Format, Epoch: adopted.Epoch, Lineage: adopted.Lineage, Baseline: baseline,
	})
	if err != nil {
		return false, err
	}
	r.tag = workingset.Tag{Format: head.Format, Epoch: head.Epoch, Lineage: head.Lineage}
	r.startVersionReadLocked()
	r.markDirtyLocked()
	// Only after the reset is durable: before it, the working set is the only copy.
	r.dropWorkingSetLocked()
	return true, nil
}

// dropWorkingSetLocked retires (never deletes) the stale working set, best
// effort.
func (r *Room) dropWorkingSetLocked() {
	if err := r.store.Retire(r.lifetime, r.docID); err != nil && r.lifetime.Err() == nil {
		r.logf(`collab: room "` + r.docID + `" could not drop its stale working set: ` + err.Error())
	}
}

// resetJournalLocked builds a standalone baseline from the endpoint.
func (r *Room) resetJournalLocked(current workingset.Tag) (workingset.Tag, error) {
	loaded, err := r.endpoint.Load(r.lifetime, r.docID)
	if err != nil {
		return workingset.Tag{}, err
	}
	var baseline [][]byte
	resetDoc := yjs.NewDoc(yjs.Options{})
	unsubscribe := resetDoc.OnUpdate(func(event yjs.UpdateEvent) {
		if event.Local {
			baseline = append(baseline, event.Update)
		}
	})
	defer unsubscribe()
	if loaded.Data != nil {
		if err := r.converter.Seed(r.lifetime, resetDoc, loaded.Data); err != nil {
			return workingset.Tag{}, err
		}
	}
	head, err := r.session.Reset(r.lifetime, operation.Reset{
		Format: workingset.CurrentFormat, Epoch: current.Epoch + 1, Lineage: workingset.NewLineage(), Baseline: baseline,
	})
	if err != nil {
		return workingset.Tag{}, err
	}
	r.tag = workingset.Tag{Format: head.Format, Epoch: head.Epoch, Lineage: head.Lineage}
	return r.tag, nil
}

// isRuntimeLimit is the runtime's own timeout or allocation budget.
func isRuntimeLimit(err error) bool {
	var failure *jsruntime.Failure
	return errors.As(err, &failure) &&
		(failure.Kind == jsruntime.KindTimedOut || failure.Kind == jsruntime.KindDocumentTooLarge)
}

// requireReadableFormat: format 1 is read only to be migrated; anything newer
// was written by a newer server.
func (r *Room) requireReadableFormat(format int32) error {
	if format == workingset.HTMLRichTextFormat || format == workingset.CurrentFormat {
		return nil
	}
	return errors.New(`collab: the stored document "` + r.docID + `" has format ` + strconv.Itoa(int(format)) +
		`; this server reads format 2 and migrates format 1.`)
}

// migrateRichTextLocked is the doc half of a migration; its update is never
// published.
func (r *Room) migrateRichTextLocked() error {
	if _, err := r.converter.MigrateRichText(r.lifetime, r.doc); err != nil && r.lifetime.Err() == nil {
		r.migrationFailed = true
		return &wrappedError{
			message: `collab: room "` + r.docID + `" could not migrate its format-1 rich text, so the store keeps ` +
				`format 1 and the next open tries again (for a very large field, raise the runtime's ` +
				`timeout): ` + err.Error(),
			err: err,
		}
	} else if err != nil {
		return err
	}
	r.localUpdates = nil
	return nil
}

// migrateJournalLocked: the migrated state becomes the baseline of a NEW
// lineage. The reset is the commit point.
func (r *Room) migrateJournalLocked() error {
	if err := r.migrateRichTextLocked(); err != nil {
		return err
	}
	whole, err := r.doc.EncodeStateAsUpdate(nil)
	if err != nil {
		return err
	}
	head, err := r.session.Reset(r.lifetime, operation.Reset{
		Format: workingset.CurrentFormat, Epoch: r.tag.Epoch + 1, Lineage: workingset.NewLineage(), Baseline: [][]byte{whole},
	})
	if err != nil {
		return err
	}
	r.tag = workingset.Tag{Format: head.Format, Epoch: head.Epoch, Lineage: head.Lineage}
	r.committedThrough = head.DurableThrough
	r.checkpointedThrough = 0
	r.operationsSinceCheckpoint = 0
	r.bytesSinceCheckpoint = 0
	r.replaceLogLocked(whole)
	return nil
}

// migrateWorkingSetLocked: a write, never a store reset, awaited so a failed
// write leaves format 1 for the next open.
func (r *Room) migrateWorkingSetLocked() error {
	if err := r.migrateRichTextLocked(); err != nil {
		return err
	}
	if err := r.compactLocked(); err != nil {
		return err
	}
	r.tag = workingset.Tag{Format: workingset.CurrentFormat, Epoch: r.tag.Epoch + 1, Lineage: workingset.NewLineage()}
	if err := r.persistLocked(r.lifetime); err != nil {
		return err
	}
	// The host record still holds HTML.
	r.markDirtyLocked()
	return nil
}

func (r *Room) hydrateLocked(storedFrames []byte) error {
	frames, ok := workingset.DecodeFrames(storedFrames)
	if !ok {
		return fmt.Errorf(`collab: the stored working set for "%s" is not a valid update log.`, r.docID)
	}
	for _, frame := range frames {
		if _, ok := r.applyRemoteLocked(frame); !ok {
			return fmt.Errorf(`collab: a stored update for "%s" could not be applied.`, r.docID)
		}
	}
	r.frameSection.Write(storedFrames)
	r.frameCount = len(frames)
	return nil
}

func (r *Room) seedLocked() error {
	loaded, err := r.endpoint.Load(r.lifetime, r.docID)
	if err != nil {
		return err
	}
	r.version = loaded.Version
	// A seed is a new CRDT history, so a new lineage; a null document under
	// a lineage the store still holds creates none.
	if loaded.Data != nil || r.tag.Lineage == workingset.NoLineage {
		r.tag.Lineage = workingset.NewLineage()
	}
	r.localUpdates = nil
	if loaded.Data != nil {
		if err := r.converter.Seed(r.lifetime, r.doc, loaded.Data); err != nil {
			return err
		}
	}
	r.publishLocalUpdatesLocked()
	// Awaited: a seed that cannot be written fails the join closed.
	return r.persistLocked(r.lifetime)
}

// publishLocalUpdatesLocked appends and relays what the last local
// transaction emitted.
func (r *Room) publishLocalUpdatesLocked() {
	for _, update := range r.localUpdates {
		r.appendLocked(update)
		if frame, err := wire.Encode(wire.SyncUpdate{Update: update}); err == nil {
			r.broadcastLocked(frame, nil)
		}
	}
	r.localUpdates = nil
}

// applyRemoteLocked screens and applies an update. Only Malformed and
// TooDeep are refused, with a log and a drop.
func (r *Room) applyRemoteLocked(update []byte) (yjs.ApplyResult, bool) {
	inspection := yjs.Inspect(update, yjs.DefaultInspectDepth)
	if inspection.Verdict != yjs.VerdictOK || inspection.Decoded == nil {
		r.logf(`collab: room "` + r.docID + `" dropped an update it could not read: ` + inspection.Reason)
		return yjs.ApplyResult{}, false
	}
	applied, err := r.doc.ApplyDecoded(inspection.Decoded)
	if err != nil {
		r.logf(`collab: room "` + r.docID + `" dropped an update it could not apply: ` + err.Error())
		return yjs.ApplyResult{}, false
	}
	return applied, applied.Outcome == yjs.Applied
}

// appendLocked is the working-set log. A journal room keeps none, which is
// what skips every blob path.
func (r *Room) appendLocked(update []byte) {
	if r.session != nil {
		return
	}
	workingset.AppendFrame(&r.frameSection, update)
	r.frameCount++
	r.blobVersion++
}

type wrappedError struct {
	message string
	err     error
}

func (e *wrappedError) Error() string { return e.message }
func (e *wrappedError) Unwrap() error { return e.err }

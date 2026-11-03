package room

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab"
	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/internal/collab/docendpoint"
	"github.com/JackUait/blok/packages/server/go/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/internal/collab/wire"
	"github.com/JackUait/blok/packages/server/go/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// EditStatus is CollabEditStatus.
type EditStatus int

const (
	EditApplied EditStatus = iota
	EditConflict
	EditDraining
	EditInvalid
	EditOverloaded
	EditTooLarge
	EditPurged
	EditSeedFailed
	EditUnavailable
	EditPreconditionFailed
	EditPreconditionRequired
)

// Precondition is the journal head an edit expects (If-Match).
type Precondition struct {
	Lineage  string
	Sequence uint64
}

// Receipt is CollabEditReceipt.
type Receipt struct {
	Tag            workingset.Tag
	ServerSequence uint64
}

// EditResult is CollabEditResult.
type EditResult struct {
	Status  EditStatus
	Err     error
	Receipt *Receipt
}

// PlanOps plans an edit against the live doc, inside the lane.
type PlanOps func(ctx context.Context, doc *yjs.Doc) ([]convert.EditOp, error)

// Applied runs in the lane after an edit lands. receipt is the answer the
// edit gets, nil in a room without a journal.
type Applied func(ctx context.Context, doc *yjs.Doc, receipt *Receipt) error

func refusalStatus(refusal *convert.EditError) EditStatus {
	if convert.IsTooLarge(refusal.Err) {
		return EditTooLarge
	}
	return EditInvalid
}

func (r *Room) edit(ctx context.Context, plan PlanOps, gateFrameSize bool, operationID string, digest []byte,
	actorID string, expect *Precondition, applied Applied) (*EditResult, error) {
	var result *EditResult
	err := r.run(ctx, func() (err error) {
		result, err = r.editLocked(plan, gateFrameSize, operationID, digest, actorID, expect, applied)
		return err
	})
	return result, err
}

func (r *Room) editLocked(plan PlanOps, gateFrameSize bool, operationID string, digest []byte,
	actorID string, expect *Precondition, applied Applied) (*EditResult, error) {
	if r.purgeRequested.Load() {
		return &EditResult{Status: EditPurged}, nil
	}
	if r.state == stateClosed {
		return nil, nil
	}
	if r.state == stateNew {
		if failure := r.tryLoadLocked(); failure != nil {
			r.closeRoomLocked(nil)
			status := EditSeedFailed
			switch failure.open {
			case openPurged:
				status = EditPurged
			case openElsewhere:
				status = EditUnavailable
			}
			return &EditResult{Status: status, Err: failure.err}, nil
		}
	}
	if r.purgeRequested.Load() {
		return &EditResult{Status: EditPurged}, nil
	}

	if r.session != nil {
		ctx, cancel := r.boundedLocked()
		committed, err := r.session.FindCommitted(ctx, operationID, digest)
		cancel()
		if err != nil {
			r.failCommitLocked("look up an operation id", err)
			return &EditResult{Status: EditUnavailable}, nil
		}
		// A room this request loaded has no member to arm its eviction.
		switch committed.Outcome {
		case operation.LookupDuplicate:
			r.updateEvictionLocked(-1)
			return &EditResult{Status: EditApplied, Receipt: &Receipt{r.tag, committed.Sequence}}, nil
		case operation.LookupConflict:
			r.updateEvictionLocked(-1)
			return &EditResult{Status: EditConflict}, nil
		}
		if expect != nil && (expect.Lineage != r.tag.Lineage || expect.Sequence != r.committedThrough) {
			r.updateEvictionLocked(-1)
			return &EditResult{Status: EditPreconditionFailed, Receipt: &Receipt{r.tag, r.committedThrough}}, nil
		}
	}

	ops, err := plan(r.lifetime, r.doc)
	if err == nil && gateFrameSize && len(ops) > 0 {
		var fits bool
		fits, err = r.fitsOneFrameLocked(ops)
		if err == nil && !fits {
			r.updateEvictionLocked(-1)
			return &EditResult{Status: EditTooLarge, Err: &convert.EditError{Message: "collab: the restore is larger than one update may be."}}, nil
		}
	}
	if err != nil {
		// Planning only reads the live doc, so the room stays open.
		r.updateEvictionLocked(-1)
		if refusal, ok := isEditRefusal(err); ok {
			return &EditResult{Status: refusalStatus(refusal), Err: refusal}, nil
		}
		if isTransient(err) {
			return &EditResult{Status: EditOverloaded, Err: err}, nil
		}
		return nil, err
	}

	r.localUpdates = nil
	if r.session == nil {
		err := r.converter.ApplyOps(r.lifetime, r.doc, ops)
		r.publishLocalUpdatesLocked()
		r.updateEvictionLocked(-1)
		if err != nil {
			if refusal, ok := isEditRefusal(err); ok {
				return &EditResult{Status: refusalStatus(refusal), Err: refusal}, nil
			}
			if isTransient(err) {
				return &EditResult{Status: EditOverloaded, Err: err}, nil
			}
			return nil, err
		}
		r.compactIfOversizedLocked()
		r.settleInFlightPersistLocked()
		if err := r.persistLocked(r.lifetime); err != nil {
			if r.lifetime.Err() != nil {
				return nil, err
			}
			r.logf(`collab: room "` + r.docID + `" could not persist an edit, retrying: ` + err.Error())
			r.schedulePersistLocked()
		}
		r.markDirtyLocked()
		if applied != nil {
			if err := applied(r.lifetime, r.doc, nil); err != nil {
				return nil, err
			}
		}
		return &EditResult{Status: EditApplied}, nil
	}

	stateBefore := r.doc.EncodeStateVector()
	if err := r.converter.ApplyOps(r.lifetime, r.doc, ops); err != nil {
		r.localUpdates = nil
		if refusal, ok := isEditRefusal(err); ok {
			r.updateEvictionLocked(-1)
			return &EditResult{Status: refusalStatus(refusal), Err: refusal}, nil
		}
		if isTransient(err) {
			// Thrown before the first write: the room stays open.
			r.updateEvictionLocked(-1)
			return &EditResult{Status: EditOverloaded, Err: err}, nil
		}
		// The converter may have written part of the edit: the room holds
		// state no append can journal, so it goes.
		r.failCommitLocked("apply an edit", err)
		return &EditResult{Status: EditUnavailable}, nil
	}
	// An edit that changed nothing wrote no bytes: applied, nothing to append.
	if len(r.localUpdates) == 0 && bytes.Equal(r.doc.EncodeStateVector(), stateBefore) {
		r.updateEvictionLocked(-1)
		receipt := &Receipt{r.tag, r.committedThrough}
		if applied != nil {
			if err := applied(r.lifetime, r.doc, receipt); err != nil {
				return nil, err
			}
		}
		return &EditResult{Status: EditApplied, Receipt: receipt}, nil
	}
	// One update is what the append journals; anything else is bytes the
	// journal would never see.
	if len(r.localUpdates) != 1 {
		count := len(r.localUpdates)
		r.localUpdates = nil
		r.failCommitLocked("apply an edit", fmt.Errorf("collab: applying an edit emitted %d local updates.", count))
		return &EditResult{Status: EditUnavailable}, nil
	}
	update := r.localUpdates[0]
	sequence, ok := r.appendCommittedLocked(operationID, actorID, collab.SourceHTTPEdit, update, digest)
	if !ok {
		return &EditResult{Status: EditUnavailable}, nil
	}
	r.publishLocalUpdatesLocked()
	r.compactIfOversizedLocked()
	r.schedulePersistLocked()
	r.markDirtyLocked()
	r.updateEvictionLocked(-1)
	receipt := &Receipt{r.tag, sequence}
	if applied != nil {
		if err := applied(r.lifetime, r.doc, receipt); err != nil {
			return nil, err
		}
	}
	return &EditResult{Status: EditApplied, Receipt: receipt}, nil
}

// fitsOneFrameLocked: the limit is the announced cap (1 MiB when none),
// lowered to the store's append limit when known.
func (r *Room) fitsOneFrameLocked(ops []convert.EditOp) (bool, error) {
	limit := int64(1 << 20)
	if r.options.AnnouncedMaxMessageBytes > 0 {
		limit = r.options.AnnouncedMaxMessageBytes
	}
	if r.options.MaxUpdateBytes > 0 && r.options.MaxUpdateBytes < limit {
		limit = r.options.MaxUpdateBytes
	}
	planned, err := PlannedFrameBytes(r.lifetime, r.doc, r.converter, ops)
	if err != nil {
		return false, err
	}
	return planned <= limit, nil
}

// PlannedFrameBytes is what applying ops to live would broadcast, measured
// on a scratch copy with the same client id.
func PlannedFrameBytes(ctx context.Context, live *yjs.Doc, converter Converter, ops []convert.EditOp) (int64, error) {
	scratch := yjs.NewDoc(yjs.Options{})
	whole, err := live.EncodeStateAsUpdate(nil)
	if err != nil {
		return 0, err
	}
	if _, err := scratch.ApplyUpdate(whole); err != nil {
		return 0, err
	}
	scratch.AdoptClientID(live.ClientID())
	var frameBytes int64
	unsubscribe := scratch.OnUpdate(func(event yjs.UpdateEvent) {
		if event.Local {
			if frame, err := wire.Encode(wire.SyncUpdate{Update: event.Update}); err == nil {
				frameBytes += int64(len(frame))
			}
		}
	})
	defer unsubscribe()
	if err := converter.ApplyOps(ctx, scratch, ops); err != nil {
		return 0, err
	}
	return frameBytes, nil
}

// StateStatus is CollabStateStatus.
type StateStatus int

const (
	StateReady StateStatus = iota
	StatePurged
	StateDraining
	StateSeedFailed
	StateUnavailable
	StateExportFailed
	StateOverloaded
)

// StateResult is CollabStateResult.
type StateResult struct {
	Status StateStatus
	JSON   []byte
	Head   *Receipt
	Err    error
}

func (r *Room) readState(ctx context.Context) (*StateResult, error) {
	var result *StateResult
	err := r.run(ctx, func() error {
		if r.purgeRequested.Load() {
			result = &StateResult{Status: StatePurged}
			return nil
		}
		if r.state == stateClosed {
			return nil
		}
		if r.state == stateNew {
			if failure := r.tryLoadLocked(); failure != nil {
				r.closeRoomLocked(nil)
				status := StateSeedFailed
				switch failure.open {
				case openPurged:
					status = StatePurged
				case openElsewhere:
					status = StateUnavailable
				}
				result = &StateResult{Status: status, Err: failure.err}
				return nil
			}
		}
		if r.purgeRequested.Load() {
			result = &StateResult{Status: StatePurged}
			return nil
		}
		r.updateEvictionLocked(-1)
		exported, err := r.converter.Export(ctx, r.doc)
		var json []byte
		if err == nil {
			json, err = docendpoint.Serialize(exported)
		}
		if err != nil {
			r.logf(`collab: room "` + r.docID + `" could not export its state: ` + err.Error())
			status := StateExportFailed
			if isTransient(err) {
				status = StateOverloaded
			}
			result = &StateResult{Status: status, Err: err}
			return nil
		}
		result = &StateResult{Status: StateReady, JSON: json}
		if r.session != nil {
			result.Head = &Receipt{r.tag, r.committedThrough}
		}
		return nil
	})
	return result, err
}

func (r *Room) checkpoint(ctx context.Context) (bool, error) {
	var published bool
	err := r.run(ctx, func() (err error) {
		published, err = r.checkpointLocked()
		return err
	})
	return published, err
}

// checkpointLocked is refused while the engine holds pending state: a
// checkpoint replaces the operations it covers on replay.
func (r *Room) checkpointLocked() (bool, error) {
	if r.purgeRequested.Load() || r.state != stateReady || r.session == nil ||
		r.committedThrough == r.checkpointedThrough || r.doc.HasPending() {
		return false, nil
	}
	r.operationsSinceCheckpoint = 0
	r.bytesSinceCheckpoint = 0
	state, err := r.doc.EncodeStateAsUpdate(nil)
	if err == nil {
		ctx, cancel := r.boundedLocked()
		err = r.session.WriteCheckpoint(ctx, operation.Checkpoint{Through: r.committedThrough, State: state})
		cancel()
	}
	if err != nil {
		// A lost fence, a refused sequence and an unreadable journal never
		// heal by retrying.
		var argument *journal.ArgumentError
		var invalidData *journal.InvalidDataError
		if errors.Is(err, journal.ErrFenceLost) || (errors.As(err, &argument) && argument.OutOfRange) || errors.As(err, &invalidData) {
			r.failCommitLocked("publish a checkpoint", err)
			return false, nil
		}
		r.checkpointFailures++
		if r.checkpointFailures >= checkpointFailureLimit {
			r.failCommitLocked("publish a checkpoint", err)
			return false, nil
		}
		r.logf(fmt.Sprintf(`collab: room "%s" could not publish a checkpoint (%d of %d), retrying later: %s`,
			r.docID, r.checkpointFailures, checkpointFailureLimit, err.Error()))
		return false, nil
	}
	r.checkpointFailures = 0
	r.checkpointedThrough = r.committedThrough
	// MarkDirty arms no timer on a journal room, so the projection a
	// checkpoint earns is armed here, and marked owed.
	r.projectionOwed = true
	r.markDirtyLocked()
	r.scheduleExportLocked()
	return true, nil
}

// ResetStatus is CollabResetStatus.
type ResetStatus int

const (
	ResetDone ResetStatus = iota
	ResetSeedFailed
	ResetUnavailable
	ResetPurged
)

// ResetResult is CollabResetResult.
type ResetResult struct {
	Status ResetStatus
	Tag    *workingset.Tag
	Err    error
}

func (r *Room) reset(ctx context.Context) (*ResetResult, error) {
	var result *ResetResult
	err := r.run(ctx, func() (err error) {
		result, err = r.resetLocked(ctx)
		return err
	})
	return result, err
}

func (r *Room) resetLocked(ctx context.Context) (*ResetResult, error) {
	if r.purgeRequested.Load() {
		return &ResetResult{Status: ResetPurged}, nil
	}
	if r.state == stateClosed {
		return nil, nil
	}
	if r.operations != nil {
		if r.state == stateNew {
			if result := r.openForResetLocked(); result != nil {
				return result, nil
			}
		}
		if r.purgeRequested.Load() {
			return &ResetResult{Status: ResetPurged}, nil
		}
		if r.state == stateReady {
			// Not under the caller's context: a client that disconnects
			// mid-flush would leave the record stale.
			r.flushLocked(context.Background())
		}
		// Strict, unlike the load path: a copy left beside the new lineage
		// holds what this reset threw away.
		if err := r.store.Retire(r.lifetime, r.docID); err != nil && r.lifetime.Err() == nil {
			r.logf(`collab: room "` + r.docID + `" could not retire its working set, so the reset is refused: ` + err.Error())
			if r.state == stateReady && r.tag.Format == workingset.CurrentFormat {
				r.updateEvictionLocked(-1)
			} else {
				r.closeRoomLocked(nil)
			}
			return &ResetResult{Status: ResetUnavailable, Err: err}, nil
		} else if err != nil {
			return nil, err
		}
		current := r.tag
		if head := r.session.OpenResult().Head; head != nil {
			current = workingset.Tag{Format: head.Format, Epoch: head.Epoch, Lineage: head.Lineage}
		}
		next, err := r.resetJournalLocked(current)
		if err != nil {
			r.failCommitLocked("reset the document", err)
			return &ResetResult{Status: ResetUnavailable, Err: err}, nil
		}
		r.closeRoomLocked(reasonPtr(collab.CloseReset))
		return &ResetResult{Status: ResetDone, Tag: &next}, nil
	}

	current := r.tag
	if r.state == stateNew {
		stored, err := r.store.Read(ctx, r.docID)
		if err != nil {
			return nil, err
		}
		if stored != nil {
			current = stored.Tag
		}
	}
	r.settleInFlightPersistLocked()
	if r.purgeRequested.Load() {
		return &ResetResult{Status: ResetPurged}, nil
	}
	next := workingset.Tag{Format: workingset.CurrentFormat, Epoch: current.Epoch + 1, Lineage: workingset.NewLineage()}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := r.store.Reset(r.lifetime, r.docID, next); err != nil {
		return nil, err
	}
	r.closeRoomLocked(reasonPtr(collab.CloseReset))
	return &ResetResult{Status: ResetDone, Tag: &next}, nil
}

// openForResetLocked opens the journal for a reset on an unloaded room and
// hydrates it, so the flush can project first. A non-nil result ends the
// reset.
func (r *Room) openForResetLocked() *ResetResult {
	open, err := r.tryOpenJournalLocked()
	if err != nil {
		r.closeRoomLocked(nil)
		return &ResetResult{Status: ResetSeedFailed, Err: err}
	}
	if r.purgeRequested.Load() {
		return &ResetResult{Status: ResetPurged}
	}
	if open != journal.Opened {
		r.closeRoomLocked(nil)
		if open == journal.DocumentPurged {
			return &ResetResult{Status: ResetPurged}
		}
		return &ResetResult{Status: ResetUnavailable}
	}
	r.newDocLocked()
	if r.session.OpenResult().Head != nil {
		if err := r.loadFromJournalLocked(false); err != nil {
			// A journal this engine cannot replay: nobody could have been
			// served it, and the reset throws it away regardless.
			r.logf(`collab: room "` + r.docID + `" could not replay its journal before a reset, so the reset drops it: ` + err.Error())
		} else {
			r.state = stateReady
		}
		return nil
	}
	// A store that does not import working sets never seeded this document:
	// adopt the working copy so the flush sends its edits.
	adopted, err := r.tryAdoptWorkingSetLocked()
	if err != nil {
		r.closeRoomLocked(nil)
		return &ResetResult{Status: ResetSeedFailed, Err: err}
	}
	if adopted {
		r.state = stateReady
	}
	return nil
}

func (r *Room) purge(ctx context.Context) error {
	r.requestPurge()
	return r.run(ctx, func() error {
		if r.state == stateClosed {
			return nil
		}
		if save := r.inFlightSave; save != nil {
			// A failed export does not block deletion.
			_, _ = save.wait()
			r.inFlightSave = nil
		}
		r.settleInFlightPersistLocked()
		r.closeRoomLocked(reasonPtr(collab.CloseForbidden))
		return nil
	})
}

// drain flushes (bounded by ctx), closes 1001 whatever happens, then waits
// for the activity pump, bounded by CommitTimeout and by ctx.
func (r *Room) drain(ctx context.Context) {
	_ = r.run(context.Background(), func() error {
		if r.state == stateReady {
			r.flushLocked(ctx)
		}
		if r.state != stateClosed {
			r.closeRoomLocked(reasonPtr(collab.CloseDraining))
		}
		return nil
	})
	settled := make(chan struct{})
	go func() {
		r.settle()
		close(settled)
	}()
	select {
	case <-settled:
	case <-time.After(r.options.CommitTimeout):
		r.logf(`collab: room "` + r.docID + `" abandoned its activity dispatch while draining: the observer is past its bound`)
	case <-ctx.Done():
		r.logf(`collab: room "` + r.docID + `" abandoned its activity dispatch while draining: the drain was cancelled`)
	}
}

// String is the C# CollabEditStatus name, which agent answers print.
func (s EditStatus) String() string {
	names := [...]string{"Applied", "Conflict", "Draining", "Invalid", "Overloaded", "TooLarge", "Purged",
		"SeedFailed", "Unavailable", "PreconditionFailed", "PreconditionRequired"}
	if int(s) < len(names) && s >= 0 {
		return names[s]
	}
	return strconv.Itoa(int(s))
}

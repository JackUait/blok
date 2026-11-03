package convert

import (
	"context"
	"fmt"
	"iter"

	"github.com/JackUait/blok/packages/server/go/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// ReplayError is a baseline frame or record that the history replay could
// not read or apply (C# CollabHistoryReplayException). Sequence is nil for
// a baseline frame.
type ReplayError struct {
	Sequence *uint64
	Message  string
	Err      error
}

func (e *ReplayError) Error() string { return e.Message }
func (e *ReplayError) Unwrap() error { return e.Err }

// BuildReplay rebuilds the doc as it stood at one point of a lineage: the
// baseline frames, then the records in journal order, each screened and
// applied as the live room applies a remote update. A record that arrives
// before its dependency is parked and lands with it, as it did live.
func BuildReplay(ctx context.Context, baseline [][]byte, records iter.Seq2[operation.Record, error]) (*yjs.Doc, error) {
	var doc *yjs.Doc
	err := StepReplay(ctx, baseline, records, func(_ *operation.Record, d *yjs.Doc) error {
		doc = d
		return nil
	})
	if err != nil {
		return nil, err
	}
	return doc, nil
}

// StepReplay is the same replay one step at a time: visit sees the baseline
// (record nil), then each record. Every step hands over the same doc,
// changed in place, so read it before returning.
func StepReplay(ctx context.Context, baseline [][]byte, records iter.Seq2[operation.Record, error], visit func(*operation.Record, *yjs.Doc) error) error {
	doc := yjs.NewDoc(yjs.Options{})
	for i, frame := range baseline {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := replayApply(doc, frame, nil, fmt.Sprintf("baseline frame %d", i)); err != nil {
			return err
		}
	}
	if err := visit(nil, doc); err != nil {
		return err
	}
	for record, err := range records {
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		sequence := record.Sequence
		if err := replayApply(doc, record.Update, &sequence, fmt.Sprintf("record %d", sequence)); err != nil {
			return err
		}
		if err := visit(&record, doc); err != nil {
			return err
		}
	}
	return nil
}

// replayApply fails where the live room would drop the update: a point
// rebuilt without it is not the point the journal names. The default depth
// equals MaxValueDepth, because the edit path journals uninspected.
func replayApply(doc *yjs.Doc, update []byte, sequence *uint64, name string) error {
	inspection := yjs.Inspect(update, yjs.DefaultInspectDepth)
	if inspection.Verdict != yjs.VerdictOK || inspection.Decoded == nil {
		return &ReplayError{Sequence: sequence, Message: fmt.Sprintf("collab: history replay could not read %s: %s", name, inspection.Reason)}
	}
	if _, err := doc.ApplyDecoded(inspection.Decoded); err != nil {
		return &ReplayError{Sequence: sequence, Message: fmt.Sprintf("collab: history replay could not apply %s: %s", name, err.Error()), Err: err}
	}
	return nil
}

package blokagent

import (
	"context"
	"crypto/sha256"
	"errors"
	"strconv"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/room"
	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

func itoa(n uint64) string { return strconv.FormatUint(n, 10) }

func parseSequence(s string) (uint64, bool) { return dotnet.ParseUInt64None(s) }

// historyRefusal stops a replay inside the room lane; the room writes
// nothing.
type historyRefusal struct {
	code, message string
	retryable     bool
	details       *jsjson.Node
}

func (r *historyRefusal) Error() string { return r.message }

// runRoomHistory is undo or redo of this actor's last room step, planned in
// the room lane like a version restore, so a peer write cannot land between
// check and apply. The head it pins itself can go stale under a peer's
// write, so it tries three times; the caller's own expectRevision is never
// retried.
func (e *Executor) runRoomHistory(ctx context.Context, docID string, undo bool, actor Actor, expect *room.Precondition) (Execution, error) {
	for attempt := 0; ; attempt++ {
		execution, err := e.runRoomHistoryOnce(ctx, docID, undo, actor, expect)
		if err != nil {
			return Execution{}, err
		}
		if expect != nil || attempt == 2 {
			return execution, nil
		}
		result, err := parse(execution.ResultJSON)
		if err != nil {
			return Execution{}, err
		}
		if code, err := errorCode(result); err != nil {
			return Execution{}, err
		} else if code != "STALE" {
			return execution, nil
		}
	}
}

func (e *Executor) runRoomHistoryOnce(ctx context.Context, docID string, undo bool, actor Actor, expect *room.Precondition) (Execution, error) {
	verb, short := "redone", "redo"
	if undo {
		verb, short = "undone", "undo"
	}
	nothing := func() (Execution, error) {
		if undo {
			return failure("NOTHING_TO_UNDO", "This session has no step to undo.", false, nil, "")
		}
		return failure("NOTHING_TO_REDO", "This session has no undone step to redo.", false, nil, "")
	}
	lineageChanged := "The room was reset or reloaded since this step, so it can no longer be " + verb + ". Re-read the document."

	// Checked before the room: a purged document refuses every edit, and
	// this answer is the true one.
	top := e.history.top(docID, actor, undo)
	if top == nil {
		return nothing()
	}
	lineage := top.lineage
	if lineage != nil && expect == nil {
		_, current, _, err := e.roomStatus(ctx, docID)
		if err != nil {
			return Execution{}, err
		}
		colon := lastColon(current)
		if colon <= 0 || current[:colon] != *lineage {
			return failure("CONFLICT", lineageChanged, true, nil, "")
		}
		// Pins the lineage in the lane; a peer write since this read only
		// asks for another try.
		expect = parseHeadText(current)
	}
	if lineage != nil && expect != nil && expect.Lineage != *lineage {
		return failure("CONFLICT", lineageChanged, true, nil, "")
	}

	if e.beforeHistoryLane != nil {
		e.beforeHistoryLane()
	}
	var step *roomStep
	digest := sha256.Sum256([]byte("agent-" + verb + "\n" + actor.ID + "\n" + newGUID()))
	edit, err := e.rooms.manager.AgentEdit(ctx, docID, func(ctx context.Context, doc *yjs.Doc) ([]convert.EditOp, error) {
		step = e.history.top(docID, actor, undo)
		if step != nil && step.lineage != nil && (expect == nil || *step.lineage != expect.Lineage) {
			return nil, &historyRefusal{code: "CONFLICT", message: lineageChanged, retryable: true}
		}
		if step == nil {
			if undo {
				return nil, &historyRefusal{code: "NOTHING_TO_UNDO", message: "This session has no step to undo."}
			}
			return nil, &historyRefusal{code: "NOTHING_TO_REDO", message: "This session has no undone step to redo."}
		}
		if step.other {
			return nil, &historyRefusal{code: "UNDO_OTHER_DOCUMENT", message: "The last batch wrote another document (a sub-page title or icon). history.undo cannot undo it. To revert it, run that command again with the old value."}
		}
		export, err := e.rooms.manager.Converter().Export(ctx, doc)
		if err != nil {
			return nil, err
		}
		if export == nil {
			export = &jsjson.Object{}
		}
		maps := pageMaps(convert.ReadPageMaps(doc))
		projected, err := project(export, maps, step.ids, step.pageKeys)
		if err != nil {
			return nil, err
		}
		expected, wanted, page := step.before, step.after, step.pageAfter
		if undo {
			expected, wanted, page = step.after, step.before, step.pageBefore
		}
		if equal, err := same(projected, expected); err != nil {
			return nil, err
		} else if !equal {
			return nil, &historyRefusal{code: "CONFLICT", retryable: true,
				message: "Someone else changed what this step wrote, so it can no longer be " + verb + ". Re-read the document before retrying."}
		}
		// Undoing a lock or redoing an unlock unlocks; the server has no
		// person to approve it.
		if unlocked, found, err := unlocks(projected, wanted); err != nil {
			return nil, err
		} else if found {
			return nil, &historyRefusal{code: "APPROVAL_REQUIRED",
				message: "This " + short + ` would unlock database "` + unlocked + `". Unlocking needs a person's explicit approval, and nothing here can ask one. Nothing was written. Ask the person to unlock it themselves.`,
				details: jsjson.NewObject(member("reason", str("no-channel")), member("approval", jsjson.NewObject(
					member("kind", str("database.unlock")), member("blockId", str(unlocked)))))}
		}
		// Who can see or fill out a view is the person's too.
		if blockID, viewID, found, err := shares(projected, wanted); err != nil {
			return nil, err
		} else if found {
			return nil, &historyRefusal{code: "APPROVAL_REQUIRED",
				message: "This " + short + ` would change who can see or fill out view "` + viewID + `" of database "` + blockID + `". That needs a person's explicit approval, and nothing here can ask one. Nothing was written. Ask the person to do it themselves.`,
				details: jsjson.NewObject(member("reason", str("no-channel")), member("approval", jsjson.NewObject(
					member("kind", str("database.share")), member("blockId", str(blockID)), member("viewId", str(viewID)))))}
		}
		blocks, target, err := restoreTarget(export, maps, step, wanted, page)
		if err != nil {
			return nil, err
		}
		var current []any
		if value, ok := export.Get(jsjson.FromString("blocks")); ok {
			current, _ = value.([]any)
		}
		ops := room.PlanRestore(current, convert.DescribeStructure(doc), blocks, maps, target)
		restamp, err := stamps(wanted)
		if err != nil {
			return nil, err
		}
		return append(ops, restamp...), nil
	}, newGUID(), digest[:], actor.ID, expect, func(ctx context.Context, doc *yjs.Doc, _ *room.Receipt) error {
		if step == nil {
			return nil
		}
		now, err := e.rooms.manager.Converter().Export(ctx, doc)
		if err != nil || now == nil {
			return err
		}
		// What the room holds now is what the opposite replay checks against.
		actual, err := project(now, convert.ReadPageMaps(doc), step.ids, step.pageKeys)
		if err != nil {
			return err
		}
		_, err = e.history.replayed(docID, actor, step, undo, actual)
		return err
	})
	var refusal *historyRefusal
	if errors.As(err, &refusal) {
		return failure(refusal.code, refusal.message, refusal.retryable, refusal.details, "")
	}
	if err != nil {
		return Execution{}, err
	}

	head := receiptHead(edit.Receipt)
	switch edit.Status {
	case room.EditApplied:
		result := jsjson.NewObject(
			member("ok", jsjson.NewBool(true)),
			member("revision", str(head)),
			member("results", jsjson.NewArray(jsjson.NewObject())),
			member("refs", jsjson.NewObject()),
			member("changed", jsjson.NewObject(
				member("created", jsjson.NewArray()), member("updated", jsjson.NewArray()),
				member("moved", jsjson.NewArray()), member("removed", jsjson.NewArray()))),
			member("warnings", jsjson.NewArray()),
		)
		written, err := write(result)
		if err != nil {
			return Execution{}, err
		}
		return withHead(Execution{ResultJSON: written, Revision: head}, head)
	case room.EditPreconditionFailed:
		return stale(head)
	}
	return failure("APPLY_FAILED", "The room refused the "+short+" ("+edit.Status.String()+"). Nothing was written.",
		retryableEdit(edit.Status), jsjson.NewObject(member("status", str(edit.Status.String()))), head)
}

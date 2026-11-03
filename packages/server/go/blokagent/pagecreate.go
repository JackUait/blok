package blokagent

import (
	"context"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// createPages makes the pages a batch inserts before the bundle runs it:
// the bundle counts them on a copy (a refused batch makes none), the host
// creates each one for the actor, and the ids go in as createdPages, which
// the bundle hands out in batch order.
func (e *Executor) createPages(ctx context.Context, input *jsjson.Node, options *Options, actor Actor) ([]*jsjson.Node, *Execution, error) {
	if options == nil || !options.PageTitles {
		return nil, nil, nil
	}
	creator, ok := options.PageTarget.(PageCreator)
	if !ok {
		return nil, nil, nil
	}
	batch, _ := input.Lookup("batch")
	inserts, err := hasCommand(batch, "block.insert")
	if err != nil || !inserts {
		return nil, nil, err
	}

	answer, err := e.invoke(ctx, "agentPagesNeeded", input)
	if err != nil {
		return nil, nil, err
	}
	needed, err := parse(answer)
	if err != nil {
		return nil, nil, err
	}
	if needed.Kind != jsjson.KindObject {
		return nil, nil, noAnswer("page count")
	}
	refused, err := object(needed, "result")
	if err != nil {
		return nil, nil, err
	}
	if refused != nil {
		written, err := write(refused)
		if err != nil {
			return nil, nil, err
		}
		revision, err := revisionOf(refused)
		if err != nil {
			return nil, nil, err
		}
		return nil, &Execution{ResultJSON: written, Revision: revision}, nil
	}
	countNode, err := get(needed, "count")
	if err != nil {
		return nil, nil, err
	}
	count, err := intValue(countNode)
	if err != nil {
		return nil, nil, err
	}

	var created []*jsjson.Node
	for range count {
		pageID, err := createOne(ctx, creator, actor)
		if err != nil {
			if len(created) > 0 {
				stopped, err := stoppedAfterCreating(err, created)
				return nil, &stopped, err
			}
			return nil, nil, err
		}
		if pageID == "" {
			forbidden, err := failure("FORBIDDEN", "The host does not let this agent create a page here. Nothing was written.", false, nil, "")
			if err != nil || len(created) == 0 {
				return nil, &forbidden, err
			}
			stranded, err := stranded(forbidden, created)
			return nil, &stranded, err
		}
		created = append(created, str(pageID))
	}

	input.Members = append(input.Members, member("createdPages", jsjson.NewArray(created...)))
	return created, nil, nil
}

func createOne(ctx context.Context, creator PageCreator, actor Actor) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	return creator.Create(ctx, actor)
}

// stoppedAfterCreating answers a batch that stopped on a cancel or an
// error after the host made pages: nothing was written, and the host is told
// which pages to clean up. The error itself is not passed on.
func stoppedAfterCreating(err error, created []*jsjson.Node) (Execution, error) {
	var cause Execution
	var failed error
	if isCancel(err) {
		cause, failed = failure("CANCELLED", "The batch was cancelled. Nothing was written.", false, nil, "")
	} else {
		cause, failed = failure("APPLY_FAILED", "The batch stopped on a server error. Nothing was written.", true, nil, "")
	}
	if failed != nil {
		return Execution{}, failed
	}
	return stranded(cause, created)
}

// stranded wraps a failure after the host created pages in
// ORPHANED_SIDE_EFFECT, unless it already is one or has no error.
func stranded(failed Execution, created []*jsjson.Node) (Execution, error) {
	result, err := parse(failed.ResultJSON)
	if err != nil {
		return Execution{}, err
	}
	if result.Kind != jsjson.KindObject {
		return Execution{}, &InvalidOperationError{Message: "The agent result is not an object."}
	}
	cause, err := object(result, "error")
	if err != nil {
		return Execution{}, err
	}
	if cause == nil {
		return failed, nil
	}
	code, err := get(cause, "code")
	if err != nil {
		return Execution{}, err
	}
	if value, err := stringValue(code); err != nil {
		return Execution{}, err
	} else if value == "ORPHANED_SIDE_EFFECT" {
		return failed, nil
	}
	messageNode, err := get(cause, "message")
	if err != nil {
		return Execution{}, err
	}
	message, err := stringValue(messageNode)
	if err != nil {
		return Execution{}, err
	}
	orphaned := jsjson.NewArray()
	for _, pageID := range created {
		orphaned.Items = append(orphaned.Items, jsjson.NewObject(
			member("command", str("block.insert")),
			member("type", str("page")),
			member("prepared", jsjson.NewObject(member("pageId", pageID.Clone()))),
		))
	}
	details := jsjson.NewObject(member("orphaned", orphaned), member("cause", cause.Clone()))
	return failure("ORPHANED_SIDE_EFFECT", "The batch failed after the host did work for it ("+message+"). Clean up the listed items.", false, details, failed.Revision)
}

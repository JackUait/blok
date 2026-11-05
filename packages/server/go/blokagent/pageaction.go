package blokagent

import (
	"context"

	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
)

// runPageAction renames a page or sets its icon on the target's own
// document. The bundle checks the batch against the source (agentPlanHost)
// and never runs the action itself.
func (e *Executor) runPageAction(ctx context.Context, input *jsjson.Node, actor Actor, pages PageTarget) (Execution, error) {
	answer, err := e.invoke(ctx, "agentPlanHost", input)
	if err != nil {
		return Execution{}, err
	}
	output, err := parse(answer)
	if err != nil {
		return Execution{}, err
	}
	if !present(output) {
		return Execution{}, noAnswer("host plan")
	}
	source, err := field(output, "result")
	if err != nil {
		return Execution{}, err
	}
	if source == nil || source.Kind != jsjson.KindObject {
		return Execution{}, noAnswer("source result")
	}
	if ok, err := isTrue(source, "ok"); err != nil || !ok {
		if err != nil {
			return Execution{}, err
		}
		return sourceExecution(source)
	}

	command, err := firstCommand(output)
	if err != nil {
		return Execution{}, err
	}
	if command == nil {
		return Execution{}, &InvalidOperationError{Message: "The Blok runtime returned no checked host command."}
	}
	args, err := object(command, "args")
	if err != nil {
		return Execution{}, err
	}
	if args == nil {
		return Execution{}, &InvalidOperationError{Message: "The Blok runtime returned no checked host args."}
	}
	pageID, found, err := plannedPageID(output)
	if err != nil {
		return Execution{}, err
	}

	if err := ctx.Err(); err != nil {
		return Execution{}, err
	}
	var location PageLocation
	if found {
		if location, err = pages.Resolve(ctx, pageID, actor); err != nil {
			return Execution{}, err
		}
	}
	if location == nil {
		return pageFailure(source, pageID, found)
	}

	name, err := get(command, "name")
	if err != nil {
		return Execution{}, err
	}
	rename, err := stringValue(name)
	if err != nil {
		return Execution{}, err
	}
	field, innerName := "icon", "doc.setIcon"
	if rename == "page.rename" {
		field, innerName = "title", "doc.setTitle"
	}
	value, err := get(args, field)
	if err != nil {
		return Execution{}, err
	}
	if value == nil {
		value = jsjson.NewNull()
	}
	inner, err := write(jsjson.NewObject(member("commands", jsjson.NewArray(jsjson.NewObject(
		member("name", str(innerName)),
		member("args", jsjson.NewObject(member(field, value.Clone()))),
	)))))
	if err != nil {
		return Execution{}, err
	}

	var done Execution
	switch target := location.(type) {
	case StoredPage:
		document, err := target.Load(ctx)
		if err != nil {
			return Execution{}, err
		}
		// The target batch runs with no options: no custom tools,
		// overrides or comments flag reach it.
		if done, err = e.Execute(ctx, document, inner, actor, nil); err != nil {
			return Execution{}, err
		}
		if done.DocumentJSON != nil {
			if err := ctx.Err(); err != nil {
				return Execution{}, err
			}
			if err := target.Save(ctx, *done.DocumentJSON); err != nil {
				return Execution{}, err
			}
		}
	case RoomPage:
		if done, err = e.ExecuteInRoom(ctx, target.DocID, inner, actor, nil); err != nil {
			return Execution{}, err
		}
	default:
		return Execution{}, &InvalidOperationError{Message: "Unknown page location."}
	}

	targetResult, err := parse(done.ResultJSON)
	if err != nil {
		return Execution{}, err
	}
	if targetResult.Kind != jsjson.KindObject {
		return Execution{}, &InvalidOperationError{Message: "The target returned no agent result."}
	}
	warnings, err := get(source, "warnings")
	if err != nil {
		return Execution{}, err
	}
	if warnings == nil || warnings.Kind != jsjson.KindArray {
		return Execution{}, &InvalidOperationError{Message: "The source result returned no warnings."}
	}
	targetWarnings, err := get(targetResult, "warnings")
	if err != nil {
		return Execution{}, err
	}
	// C# adds to the source's own list, so a success answers both too.
	if targetWarnings != nil && targetWarnings.Kind == jsjson.KindArray {
		for _, warning := range targetWarnings.Items {
			warnings.Items = append(warnings.Items, warning.Clone())
		}
	}

	if ok, err := isTrue(targetResult, "ok"); err != nil {
		return Execution{}, err
	} else if !ok {
		errorNode, err := object(targetResult, "error")
		if err != nil {
			return Execution{}, err
		}
		if errorNode == nil {
			return Execution{}, &InvalidOperationError{Message: "The target failure returned no error."}
		}
		details, err := object(errorNode, "details")
		if err != nil {
			return Execution{}, err
		}
		if details == nil {
			details = jsjson.NewObject()
			if err := set(errorNode, "details", details); err != nil {
				return Execution{}, err
			}
		}
		if err := set(details, "pageId", str(pageID)); err != nil {
			return Execution{}, err
		}
		if err := set(targetResult, "revision", cloneOrNull(source, "revision")); err != nil {
			return Execution{}, err
		}
		if err := set(targetResult, "warnings", warnings.Clone()); err != nil {
			return Execution{}, err
		}
		return sourceExecution(targetResult)
	}

	applied := jsjson.NewArray(jsjson.NewObject(member("pageId", str(pageID)), member("applied", jsjson.NewBool(true))))
	if err := set(source, "results", applied); err != nil {
		return Execution{}, err
	}
	return sourceExecution(source)
}

// firstCommand is output["batch"]?["commands"]?[0] as JsonObject.
func firstCommand(output *jsjson.Node) (*jsjson.Node, error) {
	batch, err := field(output, "batch")
	if err != nil {
		return nil, err
	}
	commands, err := field(batch, "commands")
	if err != nil {
		return nil, err
	}
	command, err := first(commands)
	if err != nil || command == nil || command.Kind != jsjson.KindObject {
		return nil, err
	}
	return command, nil
}

// plannedPageID is output["view"]?["blocks"]?[0]?["data"]?["pageId"] read as a string.
func plannedPageID(output *jsjson.Node) (string, bool, error) {
	view, err := field(output, "view")
	if err != nil {
		return "", false, err
	}
	blocks, err := field(view, "blocks")
	if err != nil {
		return "", false, err
	}
	block, err := first(blocks)
	if err != nil {
		return "", false, err
	}
	data, err := field(block, "data")
	if err != nil {
		return "", false, err
	}
	value, err := field(data, "pageId")
	if err != nil {
		return "", false, err
	}
	return text(value)
}

// cloneOrNull is `source[key]?.DeepClone()` as a value to set: JSON null when absent.
func cloneOrNull(source *jsjson.Node, key string) *jsjson.Node {
	value, err := source.Lookup(key)
	if err != nil || !present(value) {
		return jsjson.NewNull()
	}
	return value.Clone()
}

// pageFailure is C#'s PageFailure. Its key order differs from failure's:
// ok, revision, error, warnings, and revision and warnings are copied even
// when absent, as null.
func pageFailure(source *jsjson.Node, pageID string, found bool) (Execution, error) {
	details := jsjson.NewObject()
	if found {
		details.Members = append(details.Members, member("pageId", str(pageID)))
	}
	result := jsjson.NewObject(
		member("ok", jsjson.NewBool(false)),
		member("revision", cloneOrNull(source, "revision")),
		member("error", jsjson.NewObject(
			member("code", str("PRECONDITION_FAILED")),
			member("message", str("The page block points at no page this server can open.")),
			member("retryable", jsjson.NewBool(false)),
			member("details", details),
		)),
		member("warnings", cloneOrNull(source, "warnings")),
	)
	return sourceExecution(result)
}

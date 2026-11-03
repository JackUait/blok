package blokagent

import (
	"context"
	"strconv"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab/room"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// runVersionRead is a version history call: the journal's answer goes into
// the bundle's input, which shapes it as every runtime does. A read runs
// outside the edit lane and writes nothing. A restore the bundle accepted
// then goes to the room as the history route's restore does.
func (e *Executor) runVersionRead(ctx context.Context, docID string, input *jsjson.Node, name string, args *jsjson.Node, expect *room.Precondition) (Execution, error) {
	document, current, status, err := e.roomStatus(ctx, docID)
	if err != nil {
		return Execution{}, err
	}
	if status == room.StatePurged {
		return failure("TOOL_ACTION_FAILED", "The version history failed: this document was deleted.", false, nil, "")
	}
	if document == nil {
		return roomUnreadable()
	}
	if expect != nil && headOf(expect) != current {
		return stale(current)
	}
	// No history journal: the contract says unavailable and the bundle
	// refuses it.
	if e.rooms.manager.HasHistory() {
		versions, err := e.loadVersions(ctx, docID, name, args)
		if err != nil {
			return Execution{}, err
		}
		input.Members = append(input.Members, member("versionHistory", versions))
	}
	input.Members = append(input.Members, member("document", document))
	output, err := e.agentExecute(ctx, input)
	if err != nil {
		return Execution{}, err
	}
	result, err := field(output, "result")
	if err != nil {
		return Execution{}, err
	}
	if result == nil || result.Kind != jsjson.KindObject {
		return Execution{}, noAnswer("agent result")
	}
	restore, err := field(output, "restore")
	if err != nil {
		return Execution{}, err
	}
	if version, ok, err := text(restore); err != nil {
		return Execution{}, err
	} else if ok {
		// The bundle checked the room at current; the restore must land on
		// that head or not at all.
		if expect == nil {
			expect = parseHeadText(current)
		}
		return e.restore(ctx, docID, version, result, input, expect)
	}
	written, err := write(result)
	if err != nil {
		return Execution{}, err
	}
	return withHead(Execution{ResultJSON: written, Revision: current}, current)
}

// restore is the restore the bundle checked, as one journalled edit by the
// agent: the same restore the history route runs.
func (e *Executor) restore(ctx context.Context, docID, version string, result, input *jsjson.Node, expect *room.Precondition) (Execution, error) {
	colon := lastColon(version)
	if colon < 0 {
		return Execution{}, &ArgumentError{Param: "length", Message: "Specified argument was out of the range of valid values."}
	}
	sequence, ok := parseSequence(version[colon+1:])
	if !ok {
		return Execution{}, &InvalidOperationError{Message: "The input string '" + version[colon+1:] + "' was not in a correct format."}
	}
	actorNode, err := field(input, "actor")
	if err != nil {
		return Execution{}, err
	}
	idNode, err := field(actorNode, "id")
	if err != nil {
		return Execution{}, err
	}
	actorID, err := stringValue(idNode)
	if err != nil {
		return Execution{}, err
	}
	status, edit, err := e.rooms.manager.Restore(ctx, docID, version[:colon], sequence, newGUID(), actorID, expect)
	if err != nil {
		return Execution{}, err
	}
	switch status {
	case room.HistoryReady:
	case room.HistoryNotFound:
		return failure("VERSION_NOT_FOUND", `There is no version "`+version+`". history.versions lists them.`, false, nil, "")
	default:
		return failure("TOOL_ACTION_FAILED", "The version history failed: the restore could not run ("+status.String()+").",
			restoreRetryable(status), nil, "")
	}
	if edit == nil {
		return Execution{}, &InvalidOperationError{Message: "A ready restore carries its edit."}
	}
	head := receiptHead(edit.Receipt)
	switch edit.Status {
	case room.EditApplied:
		written, err := write(result)
		if err != nil {
			return Execution{}, err
		}
		return withHead(Execution{ResultJSON: written, Revision: head}, head)
	case room.EditPreconditionFailed:
		return stale(head)
	}
	return failure("APPLY_FAILED", "The room refused the restore ("+edit.Status.String()+"). Nothing was written.",
		retryableEdit(edit.Status), jsjson.NewObject(member("status", str(edit.Status.String()))), head)
}

// loadVersions is what one read needs: the version list, or the documents
// it names (null when there is no such version).
func (e *Executor) loadVersions(ctx context.Context, docID, name string, args *jsjson.Node) (*jsjson.Node, error) {
	// A restore names the version that was current before, so it needs the
	// list too.
	if name == "history.restore" {
		listed, err := e.loadVersions(ctx, docID, "history.versions", jsjson.NewObject())
		if err != nil {
			return nil, err
		}
		if failed, _ := listed.Lookup("failed"); failed != nil {
			return listed, nil
		}
		named, err := e.loadVersions(ctx, docID, "history.read", args)
		if err != nil {
			return nil, err
		}
		versions, _ := listed.Lookup("versions")
		if err := named.Set("versions", versions.Clone()); err != nil {
			return nil, fromJSON(err)
		}
		return named, nil
	}

	if name == "history.versions" {
		var group time.Duration
		groupNode, err := field(args, "group")
		if err != nil {
			return nil, err
		}
		// Only a JSON int counts: 15.0 is refused, as TryGetValue<int>
		// refuses it, and the list keeps its default grouping.
		if groupNode != nil && groupNode.Kind == jsjson.KindNumber {
			if minutes, err := strconv.ParseInt(string(groupNode.Raw()), 10, 32); err == nil && (minutes == 1 || minutes == 15 || minutes == 60) {
				group = time.Duration(minutes) * time.Minute
			}
		}
		list, err := e.rooms.manager.History(ctx, docID, group)
		if err != nil {
			return nil, err
		}
		if list.Status != room.HistoryReady {
			return versionFailure("The version history could not be read ("+list.Status.String()+").", list.Status), nil
		}
		current := map[string]bool{}
		for _, lineage := range list.Lineages {
			if lineage.Current {
				current[lineage.Lineage] = true
			}
		}
		versions := jsjson.NewArray()
		for _, version := range list.Versions {
			actors := jsjson.NewArray()
			for _, actor := range version.Actors {
				actors.Items = append(actors.Items, str(actor))
			}
			entry := jsjson.NewObject(
				member("version", str(version.Lineage+":"+itoa(version.Sequence))),
				member("savedAt", unixMillis(version.SavedAt)),
				member("startedAt", unixMillis(version.StartedAt)),
				member("actors", actors),
			)
			if !current[version.Lineage] {
				entry.Members = append(entry.Members, member("beforeReset", jsjson.NewBool(true)))
			}
			versions.Items = append(versions.Items, entry)
		}
		return jsjson.NewObject(member("versions", versions)), nil
	}

	keys := []string{"from", "to"}
	if name == "history.read" {
		keys = []string{"version"}
	}
	var names []string
	seen := map[string]bool{}
	for _, key := range keys {
		value, err := field(args, key)
		if err != nil {
			return nil, err
		}
		if value == nil || value.Kind == jsjson.KindObject || value.Kind == jsjson.KindArray {
			continue
		}
		text, ok, err := text(value)
		if err != nil {
			return nil, err
		}
		if ok && !seen[text] {
			seen[text] = true
			names = append(names, text)
		}
	}
	documents := jsjson.NewObject()
	for _, version := range names {
		colon := lastColon(version)
		sequence, ok := uint64(0), false
		if colon > 0 {
			sequence, ok = parseSequence(version[colon+1:])
		}
		if !ok {
			documents.Members = append(documents.Members, member(version, jsjson.NewNull()))
			continue
		}
		read, err := e.rooms.manager.ReadVersion(ctx, docID, version[:colon], sequence)
		if err != nil {
			return nil, err
		}
		switch read.Status {
		case room.HistoryReady:
			document, err := parse(string(read.JSON))
			if err != nil {
				return nil, err
			}
			documents.Members = append(documents.Members, member(version, document))
		case room.HistoryNotFound:
			documents.Members = append(documents.Members, member(version, jsjson.NewNull()))
		default:
			return versionFailure(`Version "`+version+`" could not be read (`+read.Status.String()+").", read.Status), nil
		}
	}
	return jsjson.NewObject(member("documents", documents)), nil
}

func versionFailure(message string, status room.HistoryStatus) *jsjson.Node {
	return jsjson.NewObject(member("failed", str(message)), member("status", jsjson.NewNumber(strconv.Itoa(httpStatus(status)))))
}

func unixMillis(t *time.Time) *jsjson.Node {
	if t == nil {
		return jsjson.NewNull()
	}
	return jsjson.NewNumber(strconv.FormatInt(t.UnixMilli(), 10))
}

// httpStatus is what HistoryEndpoint answers for this refusal. The bundle
// decides from it whether a retry can help, as it does for MCP's HTTP
// reads, so the two must stay the same.
func httpStatus(status room.HistoryStatus) int {
	switch status {
	case room.HistoryNone:
		return 501
	case room.HistoryNotFound:
		return 404
	case room.HistoryPurged:
		return 403
	case room.HistoryUnavailable:
		return 503
	}
	return 500
}

// restoreRetryable is the shared runtime's restore: never asked twice, so
// a plain 500 is not retryable. Mirrors ask(..., retry = false) in
// src/shared/agent/version-history.ts.
func restoreRetryable(status room.HistoryStatus) bool {
	code := httpStatus(status)
	return code == 429 || (code >= 500 && code != 500 && code != 501)
}

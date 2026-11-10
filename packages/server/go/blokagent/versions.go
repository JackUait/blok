package blokagent

import (
	"context"
	"strconv"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/collabhttp"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/room"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
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
	var window *historyWindow
	// No history journal: the contract says unavailable and the bundle
	// refuses it.
	if e.rooms.manager.HasHistory() {
		refused, hidden, err := e.historyAccess(ctx, docID, input)
		if err != nil {
			return Execution{}, err
		}
		window = hidden
		versions := refused
		// A restore reads the version it writes, so the read hook refuses it too.
		if refused == nil && name == "history.previewRestore" {
			if versions, err = e.loadPreview(ctx, docID, args, input, window); err != nil {
				return Execution{}, err
			}
		} else if refused == nil {
			if versions, err = e.loadVersions(ctx, docID, name, args, window); err != nil {
				return Execution{}, err
			}
		}
		input.Members = append(input.Members, member("versionHistory", versions))
	}
	input.Members = append(input.Members, member("document", document))
	output, err := e.agentExecute(ctx, input)
	if err != nil {
		return Execution{}, err
	}
	if asked, err := askOf(output); err != nil || asked != nil {
		if err != nil {
			return Execution{}, err
		}
		return Execution{askJSON: &asked.json}, nil
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
		return e.restore(ctx, docID, version, result, input, expect, window)
	}
	written, err := write(result)
	if err != nil {
		return Execution{}, err
	}
	return withHead(Execution{ResultJSON: written, Revision: current}, current)
}

// restore is the restore the bundle checked, as one journalled edit by the
// agent: the same restore the history route runs.
func (e *Executor) restore(ctx context.Context, docID, version string, result, input *jsjson.Node, expect *room.Precondition,
	window *historyWindow) (Execution, error) {
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
	outcome, err := e.rooms.manager.RestoreWith(ctx, docID, version[:colon], sequence, newGUID(), actorID, expect, nil,
		room.RestoreOptions{Hidden: window.hides(version[:colon], sequence)})
	if err != nil {
		return Execution{}, err
	}
	status, edit := outcome.Status, outcome.Edit
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

// loadPreview is what history.previewRestore needs: the preview route's
// body for its version, or null when there is none or the window hides it.
// The batch's expectRevision was checked already, so it plans at the head.
func (e *Executor) loadPreview(ctx context.Context, docID string, args, input *jsjson.Node, window *historyWindow) (*jsjson.Node, error) {
	previews := jsjson.NewObject()
	loaded := jsjson.NewObject(member("previews", previews))
	value, err := field(args, "version")
	if err != nil {
		return nil, err
	}
	version, ok, err := text(value)
	if err != nil || !ok {
		// The bundle refuses the arguments before it reads the preview.
		return loaded, err
	}
	keep := false
	if databases, err := field(args, "databases"); err != nil {
		return nil, err
	} else if databases != nil {
		named, ok, err := text(databases)
		if err != nil {
			return nil, err
		}
		if !ok || (named != "keep" && named != "restore") {
			return loaded, nil
		}
		keep = named == "keep"
	}
	colon := lastColon(version)
	sequence, ok := uint64(0), false
	if colon > 0 {
		sequence, ok = parseSequence(version[colon+1:])
	}
	if !ok || window.hides(version[:colon], sequence) {
		previews.Members = append(previews.Members, member(version, jsjson.NewNull()))
		return loaded, nil
	}
	actorNode, err := field(input, "actor")
	if err != nil {
		return nil, err
	}
	idNode, err := field(actorNode, "id")
	if err != nil {
		return nil, err
	}
	actorID, err := stringValue(idNode)
	if err != nil {
		return nil, err
	}
	status, preview, edit, err := e.rooms.manager.PreviewRestoreWith(ctx, docID, version[:colon], sequence, nil, actorID,
		room.RestoreOptions{KeepDatabases: keep})
	if err != nil {
		return nil, err
	}
	switch {
	case status == room.HistoryNotFound:
		previews.Members = append(previews.Members, member(version, jsjson.NewNull()))
		return loaded, nil
	case status != room.HistoryReady:
		return versionFailure("The restore could not be previewed ("+status.String()+").", status), nil
	case preview == nil:
		return jsjson.NewObject(member("failed", str("The restore could not be previewed ("+edit.Status.String()+").")),
			member("retryable", jsjson.NewBool(retryableEdit(edit.Status)))), nil
	}
	body, err := collabhttp.RestorePreviewJSON(preview)
	if err != nil {
		return nil, err
	}
	parsed, err := parse(body)
	if err != nil {
		return nil, err
	}
	previews.Members = append(previews.Members, member(version, parsed))
	return loaded, nil
}

// loadVersions is what one read needs: the version list, or the documents
// it names (null when there is no such version).
func (e *Executor) loadVersions(ctx context.Context, docID, name string, args *jsjson.Node, window *historyWindow) (*jsjson.Node, error) {
	// A restore names the version that was current before, so it needs the
	// list too.
	if name == "history.restore" {
		listed, err := e.loadVersions(ctx, docID, "history.versions", jsjson.NewObject(), window)
		if err != nil {
			return nil, err
		}
		if failed, _ := listed.Lookup("failed"); failed != nil {
			return listed, nil
		}
		named, err := e.loadVersions(ctx, docID, "history.read", args, window)
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
		var cut *time.Time
		if window != nil {
			cut = &window.cut
		}
		list, err := e.rooms.manager.HistoryWindowed(ctx, docID, group, false, cut)
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
			if window.hides(version.Lineage, version.Sequence) {
				continue
			}
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
		// A version the host's window hides reads as one that does not exist.
		if !ok || (window.hides(version[:colon], sequence)) {
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

// historyAccess asks the host's hooks for this call: a versionHistory
// refusal when the read hook says no, and each lineage's floor when it sets
// a window.
func (e *Executor) historyAccess(ctx context.Context, docID string, input *jsjson.Node) (*jsjson.Node, *historyWindow, error) {
	if e.rooms.policy == nil {
		return nil, nil, nil
	}
	actor, err := field(input, "actor")
	if err != nil {
		return nil, nil, err
	}
	user, err := field(actor, "onBehalfOf")
	if err != nil {
		return nil, nil, err
	}
	if user == nil {
		if user, err = field(actor, "id"); err != nil {
			return nil, nil, err
		}
	}
	userID, err := stringValue(user)
	if err != nil {
		return nil, nil, err
	}
	access, err := e.rooms.policy(ctx, userID, docID)
	if err != nil {
		return nil, nil, err
	}
	var refused *jsjson.Node
	if !access.CanRead {
		refused = jsjson.NewObject(member("failed", str("The version history could not be read (not allowed).")),
			member("status", jsjson.NewNumber("403")))
	}
	if access.Window == nil {
		return refused, nil, nil
	}
	// A .NET tick is 100ns.
	cut := room.HistoryCut(e.rooms.manager.Now(), int64(*access.Window/100))
	floors, status, err := e.rooms.manager.HistoryFloorsAt(ctx, docID, cut)
	if err != nil {
		return nil, nil, err
	}
	if status != room.HistoryReady {
		if refused == nil {
			refused = versionFailure("The version history could not be read ("+status.String()+").", status)
		}
		return refused, nil, nil
	}
	return refused, &historyWindow{cut: cut, floors: floors}, nil
}

// historyWindow is the host's window for one agent call.
type historyWindow struct {
	cut    time.Time
	floors map[string]*uint64
}

func (w *historyWindow) hides(lineage string, sequence uint64) bool {
	return w != nil && room.HidesPoint(w.floors, lineage, sequence)
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

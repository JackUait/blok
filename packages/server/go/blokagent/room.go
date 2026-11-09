package blokagent

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/docendpoint"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/room"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

// Rooms is the collaboration server's live rooms, which ExecuteInRoom
// edits. blokserver.Server.AgentExecutor builds an executor over its own
// rooms; a host does not make one.
type Rooms struct{ manager *room.Manager }

// NewRooms wraps a room manager. It is for blokserver, which owns the
// manager.
func NewRooms(manager *room.Manager) *Rooms { return &Rooms{manager: manager} }

// NewOnRuntime is for blokserver: an executor over the server's own engine
// pool, the one its rooms read HTML with, as a C# host shares one
// IBlokRuntime. rooms may be nil.
func NewOnRuntime(runtime convert.Invoker, rooms *Rooms) *Executor {
	executor := newExecutor(runtime)
	if rooms != nil {
		executor.attach(rooms)
	}
	return executor
}

// attach is C#'s rooms constructor: the room steps forget a document the
// room replaced (a reset, an applied restore, a purge).
func (e *Executor) attach(rooms *Rooms) {
	e.rooms = rooms
	e.history = newRoomHistory(time.Now)
	rooms.manager.OnDocumentReplaced(e.history.forget)
}

// roomCommon is C#'s RoomCommon: room calls also read the version history
// when the journal keeps it.
func (e *Executor) roomCommon(options *Options) (*jsjson.Node, error) {
	input, err := common(options)
	if err != nil {
		return nil, err
	}
	// A room keeps the agent's steps on the server, so its contract says so.
	input.Members = append(input.Members, member("runtime", str("csharp-live")))
	if e.rooms != nil && e.rooms.manager.HasHistory() {
		services, _ := input.Lookup("services")
		services.Items = append(services.Items, str("versionHistory"))
		input.Members = append(input.Members, member("restores", jsjson.NewBool(true)))
	}
	return input, nil
}

// ExecuteInRoom runs a batch on a live room. The bundle plans it inside the
// room lane against the live document, and the revision is the journal
// head "lineage:sequence", never the bundle's content hash. Without Rooms
// it answers COMMAND_UNAVAILABLE and never runs the bundle.
func (e *Executor) ExecuteInRoom(ctx context.Context, docID, batchJSON string, actor Actor, options *Options) (Execution, error) {
	if docID == "" {
		return Execution{}, &ArgumentError{Param: "docId", Message: "The value cannot be an empty string."}
	}
	if e.rooms == nil {
		return unavailable("Live rooms need collaboration on this server.")
	}
	parsed, err := parse(batchJSON)
	if err != nil {
		return Execution{}, err
	}
	var expect *room.Precondition
	batch := parsed
	if parsed.Kind == jsjson.KindObject {
		// Removed before the bundle, which would compare a journal head with
		// its content hash.
		expected, err := parsed.Lookup("expectRevision")
		if err != nil {
			return Execution{}, fromJSON(err)
		}
		if expected != nil {
			parsed.Remove("expectRevision")
			if expect, err = parseHead(expected); err != nil {
				return Execution{}, err
			}
			if expect == nil {
				return failure("INVALID_ARGS", `In a room, expectRevision is the journal head "lineage:sequence" a result returned. Read the room again and pass its revision.`, false, nil, "")
			}
		}
		batch = parsed.Clone()
	}

	input, err := e.roomCommon(options)
	if err != nil {
		return Execution{}, err
	}
	input.Members = append(input.Members, member("batch", batch), member("actor", actorNode(actor)))

	name, args, err := versionCommand(batch)
	if err != nil {
		return Execution{}, err
	}
	if name != "" {
		return e.runVersionRead(ctx, docID, input, name, args, expect)
	}

	// The source room is only read; the host action writes the target.
	if options != nil && options.PageTitles && options.PageTarget != nil {
		action, err := hasCommand(batch, "page.rename", "page.setIcon")
		if err != nil {
			return Execution{}, err
		}
		if action {
			document, current, _, err := e.roomStatus(ctx, docID)
			if err != nil {
				return Execution{}, err
			}
			if document == nil {
				return roomUnreadable()
			}
			if expect != nil && headOf(expect) != current {
				return stale(current)
			}
			input.Members = append(input.Members, member("document", document))
			acted, err := e.runPageAction(ctx, input, actor, options.PageTarget)
			if err != nil {
				return Execution{}, err
			}
			result, err := parse(acted.ResultJSON)
			if err != nil {
				return Execution{}, err
			}
			if ok, err := isTrue(result, "ok"); err != nil {
				return Execution{}, err
			} else if ok {
				other := &roomStep{other: true, before: &jsjson.Object{}, after: &jsjson.Object{}}
				if err := other.measure(); err != nil {
					return Execution{}, err
				}
				e.history.add(docID, actor, other)
			}
			return withHead(acted, current)
		}
	}

	historyName, err := historyCommand(batch)
	if err != nil {
		return Execution{}, err
	}
	if historyName != "" {
		// The bundle checks the batch against the contract the options
		// build; only its "nothing to replay" answer, from a session with no
		// steps, lets the room replay.
		input.Members = append(input.Members, member("document", jsjson.NewObject(member("blocks", jsjson.NewArray()))))
		answer, err := e.invoke(ctx, "agentExecute", input)
		if err != nil {
			return Execution{}, err
		}
		output, err := parse(answer)
		if err != nil {
			return Execution{}, err
		}
		gate, err := field(output, "result")
		if err != nil {
			return Execution{}, err
		}
		if gate == nil || gate.Kind != jsjson.KindObject {
			return Execution{}, noAnswer("agent result")
		}
		code, err := errorCode(gate)
		if err != nil {
			return Execution{}, err
		}
		if code != "NOTHING_TO_UNDO" && code != "NOTHING_TO_REDO" {
			gate.Remove("revision")
			written, err := write(gate)
			return Execution{ResultJSON: written}, err
		}
		return e.runRoomHistory(ctx, docID, historyName == "history.undo", actor, expect)
	}

	var created []*jsjson.Node
	if options != nil && options.PageTitles {
		if _, creates := options.PageTarget.(PageCreator); creates {
			inserts, err := hasCommand(batch, "block.insert")
			if err != nil {
				return Execution{}, err
			}
			if inserts {
				state, current, _, err := e.roomStatus(ctx, docID)
				if err != nil {
					return Execution{}, err
				}
				if state == nil {
					return roomUnreadable()
				}
				// The bundle never sees expectRevision here, so a stale batch
				// must stop before the host creates pages.
				if expect != nil && headOf(expect) != current {
					return e.staleWithCurrent(ctx, docID, input, current)
				}
				// Made outside the room lane, so a slow host never holds
				// the room. The lane run checks the count again.
				input.Members = append(input.Members, member("document", state))
				made, refusal, err := e.createPages(ctx, input, options, actor, docID)
				if err != nil {
					return Execution{}, err
				}
				input.Remove("document")
				if refusal != nil {
					return withHead(*refusal, "")
				}
				created = made
			}
		}
	}

	var planned *jsjson.Node
	var before *jsjson.Object
	var beforeMaps pageMaps
	wrote := false
	operationID := newGUID()
	digest := sha256.Sum256([]byte("agent\n" + actor.ID + "\n" + batchJSON))
	edit, err := e.rooms.manager.AgentEdit(ctx, docID, func(ctx context.Context, doc *yjs.Doc) ([]convert.EditOp, error) {
		exported, err := e.rooms.manager.Converter().Export(ctx, doc)
		if err != nil {
			return nil, err
		}
		before = exported
		beforeMaps = convert.ReadPageMaps(doc)
		document, err := toNodeJSON(exported)
		if err != nil {
			return nil, err
		}
		if err := input.Set("document", document); err != nil {
			return nil, fromJSON(err)
		}
		output, err := e.agentExecute(ctx, input)
		if err != nil {
			return nil, err
		}
		if asked, err := askOf(output); err != nil || asked != nil {
			if err == nil {
				err = asked
			}
			return nil, err
		}
		result, err := field(output, "result")
		if err != nil {
			return nil, err
		}
		if result == nil || result.Kind != jsjson.KindObject {
			return nil, noAnswer("agent result")
		}
		planned = result
		// A failed batch must not reach the room.
		if ok, err := isTrue(result, "ok"); err != nil {
			return nil, err
		} else if !ok {
			return nil, errNoRoomWrite
		}
		edits, err := field(output, "edits")
		if err != nil {
			return nil, err
		}
		if edits == nil || edits.Kind != jsjson.KindArray {
			return nil, noAnswer("edits")
		}
		after, err := field(output, "document")
		if err != nil {
			return nil, err
		}
		if after == nil || after.Kind != jsjson.KindObject {
			return nil, noAnswer("document")
		}
		ops, err := translate(edits, after, result)
		if err != nil {
			return nil, err
		}
		// A journal room answers zero ops with its head and writes nothing;
		// a plain room would persist.
		if len(ops) == 0 && !e.rooms.manager.HasJournal() {
			return nil, errNoRoomWrite
		}
		// A read is no step, as the stored session marks only batches with
		// edits.
		wrote = len(edits.Items) > 0
		return ops, nil
	}, operationID, digest[:], actor.ID, expect, func(ctx context.Context, doc *yjs.Doc, receipt *room.Receipt) error {
		if !wrote || before == nil {
			return nil
		}
		after, err := e.rooms.manager.Converter().Export(ctx, doc)
		if err != nil {
			return err
		}
		recorded, err := between(before, beforeMaps, after, convert.ReadPageMaps(doc))
		if err != nil {
			return err
		}
		// Set before the step is shared: an undo reads it from another call.
		if receipt != nil {
			lineage := receipt.Tag.Lineage
			recorded.lineage = &lineage
		}
		e.history.add(docID, actor, recorded)
		return nil
	}, agentNote(actor))
	var asked *askError
	if errors.As(err, &asked) {
		return Execution{askJSON: &asked.json}, nil
	}
	if err != nil {
		if errors.Is(err, errNoRoomWrite) && planned != nil {
			// A refusal, or a read with no journal head. The bundle's
			// content hash means nothing in a room.
			written, err := write(planned)
			if err != nil {
				return Execution{}, err
			}
			return withHead(Execution{ResultJSON: written}, "")
		}
		if len(created) > 0 && !errors.Is(err, errNoRoomWrite) {
			// The room may have written before the error, and a page it
			// links is in use.
			none, linkErr := e.roomLinksNone(ctx, docID, created)
			if linkErr != nil {
				return Execution{}, linkErr
			}
			if !none {
				return Execution{}, err
			}
			return stoppedAfterCreating(err, created)
		}
		return Execution{}, err
	}

	head := receiptHead(edit.Receipt)
	if len(created) > 0 && edit.Status != room.EditApplied {
		refused, err := e.roomRefusal(ctx, edit, docID, input, head)
		if err != nil {
			return Execution{}, err
		}
		none, err := e.roomLinksNone(ctx, docID, created)
		if err != nil {
			return Execution{}, err
		}
		if none {
			return stranded(refused, created)
		}
		return refused, nil
	}
	if edit.Status == room.EditApplied && planned != nil {
		written, err := write(planned)
		if err != nil {
			return Execution{}, err
		}
		return withHead(Execution{ResultJSON: written, Revision: head}, head)
	}
	return e.roomRefusal(ctx, edit, docID, input, head)
}

// errNoRoomWrite stops the plan inside the lane when there is nothing to
// write, so the room writes nothing.
var errNoRoomWrite = errors.New("blokagent: nothing to write in the room")

// roomRefusal is the answer for a batch edit the room did not apply.
func (e *Executor) roomRefusal(ctx context.Context, edit room.EditResult, docID string, input *jsjson.Node, head string) (Execution, error) {
	switch edit.Status {
	case room.EditPreconditionFailed:
		return e.staleWithCurrent(ctx, docID, input, head)
	case room.EditPreconditionRequired:
		return failure("INVALID_ARGS", "This room keeps no journal, so expectRevision cannot be checked. Send the batch without it.", false, nil, "")
	}
	return failure("APPLY_FAILED", "The room refused the edit ("+edit.Status.String()+"). Nothing was written.",
		retryableEdit(edit.Status), jsjson.NewObject(member("status", str(edit.Status.String()))), head)
}

func retryableEdit(status room.EditStatus) bool {
	switch status {
	case room.EditOverloaded, room.EditUnavailable, room.EditDraining, room.EditSeedFailed:
		return true
	}
	return false
}

// roomLinksNone is true only when a fresh read of the room shows none of
// these pages linked. A room that cannot be read counts as linking them, so
// a host never deletes a page that may be in use. The read ignores the
// caller's cancel.
func (e *Executor) roomLinksNone(ctx context.Context, docID string, created []*jsjson.Node) (bool, error) {
	document, _, _, err := e.roomStatus(context.WithoutCancel(ctx), docID)
	if err != nil {
		return false, nil
	}
	blocks, err := field(document, "blocks")
	if err != nil || blocks == nil || blocks.Kind != jsjson.KindArray {
		return false, nil
	}
	ids := map[string]bool{}
	for _, id := range created {
		value, err := stringValue(id)
		if err != nil {
			return false, err
		}
		ids[value] = true
	}
	for _, block := range blocks.Items {
		if block.Kind != jsjson.KindObject {
			continue
		}
		kind, err := get(block, "type")
		if err != nil {
			return false, err
		}
		name, err := stringValue(kind)
		if err != nil {
			return false, err
		}
		if name != "page" {
			continue
		}
		data, err := field(block, "data")
		if err != nil {
			return false, err
		}
		pageID, err := field(data, "pageId")
		if err != nil {
			return false, err
		}
		if value, ok, err := text(pageID); err != nil {
			return false, err
		} else if ok && ids[value] {
			return false, nil
		}
	}
	return true, nil
}

// historyCommand is a batch that is only history.undo or history.redo with
// no args; anything else goes to the bundle, which checks it.
func historyCommand(batch *jsjson.Node) (string, error) {
	command, err := onlyCommand(batch)
	if err != nil || command == nil || len(command.Members) > 2 {
		return "", err
	}
	name, err := get(command, "name")
	if err != nil {
		return "", err
	}
	value, ok, err := text(name)
	if err != nil || !ok || (value != "history.undo" && value != "history.redo") {
		return "", err
	}
	args, err := command.Lookup("args")
	if err != nil {
		return "", fromJSON(err)
	}
	if args == nil || args.Kind != jsjson.KindObject || len(args.Members) != 0 {
		return "", nil
	}
	return value, nil
}

func onlyCommand(batch *jsjson.Node) (*jsjson.Node, error) {
	if batch.Kind != jsjson.KindObject {
		return nil, nil
	}
	commands, err := get(batch, "commands")
	if err != nil || commands == nil || commands.Kind != jsjson.KindArray || len(commands.Items) != 1 {
		return nil, err
	}
	if commands.Items[0].Kind != jsjson.KindObject {
		return nil, nil
	}
	return commands.Items[0], nil
}

// versionCommand: only commands[0] is checked for a version command.
func versionCommand(batch *jsjson.Node) (string, *jsjson.Node, error) {
	if batch.Kind != jsjson.KindObject {
		return "", nil, nil
	}
	commands, err := get(batch, "commands")
	if err != nil || commands == nil || commands.Kind != jsjson.KindArray || len(commands.Items) == 0 {
		return "", nil, err
	}
	command := commands.Items[0]
	if command.Kind != jsjson.KindObject {
		return "", nil, nil
	}
	name, err := get(command, "name")
	if err != nil {
		return "", nil, err
	}
	value, ok, err := text(name)
	if err != nil || !ok {
		return "", nil, err
	}
	switch value {
	case "history.versions", "history.read", "history.changes", "history.restore":
	default:
		return "", nil, nil
	}
	args, err := get(command, "args")
	if err != nil {
		return "", nil, err
	}
	if args == nil || args.Kind != jsjson.KindObject {
		args = jsjson.NewObject()
	}
	return value, args, nil
}

// roomStatus is the room's export and its journal head, read in one lane
// hold. The document is nil unless the room is ready.
func (e *Executor) roomStatus(ctx context.Context, docID string) (*jsjson.Node, string, room.StateStatus, error) {
	state, err := e.rooms.manager.State(ctx, docID)
	if err != nil {
		return nil, "", 0, err
	}
	head := receiptHead(state.Head)
	if state.Status != room.StateReady {
		return nil, head, state.Status, nil
	}
	document, err := parse(string(state.JSON))
	if err != nil {
		return nil, "", 0, err
	}
	if document.Kind != jsjson.KindObject {
		document = nil
	}
	return document, head, state.Status, nil
}

// staleWithCurrent is STALE with details.current: the bundle re-checks the
// batch against the room as it is now, with the head as its expected
// revision. A head never equals the bundle's content hash, so the bundle
// builds the stale context itself.
func (e *Executor) staleWithCurrent(ctx context.Context, docID string, input *jsjson.Node, head string) (Execution, error) {
	document, current, _, err := e.roomStatus(ctx, docID)
	if err != nil {
		return Execution{}, err
	}
	batch, _ := input.Lookup("batch")
	if document == nil || batch == nil || batch.Kind != jsjson.KindObject {
		return stale(head)
	}
	if err := batch.Set("expectRevision", str(current)); err != nil {
		return Execution{}, fromJSON(err)
	}
	if err := input.Set("document", document); err != nil {
		return Execution{}, fromJSON(err)
	}
	answer, err := e.invoke(ctx, "agentExecute", input)
	if err != nil {
		return Execution{}, err
	}
	output, err := parse(answer)
	if err != nil {
		return Execution{}, err
	}
	result, err := field(output, "result")
	if err != nil {
		return Execution{}, err
	}
	if result == nil || result.Kind != jsjson.KindObject {
		return stale(head)
	}
	if code, err := errorCode(result); err != nil {
		return Execution{}, err
	} else if code != "STALE" {
		return stale(head)
	}
	written, err := write(result)
	if err != nil {
		return Execution{}, err
	}
	return withHead(Execution{ResultJSON: written, Revision: current}, current)
}

// errorCode is result["error"]?["code"]?.GetValue<string>().
func errorCode(result *jsjson.Node) (string, error) {
	errorNode, err := field(result, "error")
	if err != nil {
		return "", err
	}
	code, err := field(errorNode, "code")
	if err != nil {
		return "", err
	}
	return stringValue(code)
}

func stale(head string) (Execution, error) {
	return failure("STALE", "The room changed since you read it. Read it again, then retry.", true,
		jsjson.NewObject(member("revision", str(head))), head)
}

func roomUnreadable() (Execution, error) {
	return failure("APPLY_FAILED", "The room could not be read. Nothing was written.", true, nil, "")
}

// withHead makes every revision a room result carries the journal head: the
// top level, each read result, and a STALE error's details. An agent passes
// these back as expectRevision. An empty head removes them.
func withHead(execution Execution, head string) (Execution, error) {
	result, err := parse(execution.ResultJSON)
	if err != nil {
		return Execution{}, err
	}
	if result.Kind != jsjson.KindObject {
		return Execution{}, &InvalidOperationError{Message: "The agent result is not an object."}
	}
	rewrite := func(holder *jsjson.Node) error {
		if head != "" {
			return holder.Set("revision", str(head))
		}
		holder.Remove("revision")
		return nil
	}
	if err := rewrite(result); err != nil {
		return Execution{}, fromJSON(err)
	}
	var holders []*jsjson.Node
	results, err := get(result, "results")
	if err != nil {
		return Execution{}, err
	}
	if results != nil && results.Kind == jsjson.KindArray {
		for _, item := range results.Items {
			if item.Kind == jsjson.KindObject {
				holders = append(holders, item)
			}
		}
	}
	errorNode, err := field(result, "error")
	if err != nil {
		return Execution{}, err
	}
	details, err := field(errorNode, "details")
	if err != nil {
		return Execution{}, err
	}
	if details != nil && details.Kind == jsjson.KindObject {
		holders = append(holders, details)
	}
	for _, holder := range holders {
		found, err := holder.Lookup("revision")
		if err != nil {
			return Execution{}, fromJSON(err)
		}
		if found == nil {
			continue
		}
		if err := rewrite(holder); err != nil {
			return Execution{}, fromJSON(err)
		}
	}
	written, err := write(result)
	if err != nil {
		return Execution{}, err
	}
	return Execution{ResultJSON: written, DocumentJSON: execution.DocumentJSON, Revision: head}, nil
}

// parseHead is C#'s ParseHead: lax on purpose (the last colon splits, a
// leading zero is fine, the lineage is not checked), unlike HTTP If-Match.
func parseHead(value *jsjson.Node) (*room.Precondition, error) {
	head, ok, err := text(value)
	if err != nil || !ok {
		return nil, err
	}
	return parseHeadText(head), nil
}

func parseHeadText(head string) *room.Precondition {
	colon := lastColon(head)
	if colon <= 0 {
		return nil
	}
	sequence, ok := parseSequence(head[colon+1:])
	if !ok {
		return nil
	}
	return &room.Precondition{Lineage: head[:colon], Sequence: sequence}
}

func lastColon(s string) int { return strings.LastIndexByte(s, ':') }

func headOf(expect *room.Precondition) string { return expect.Lineage + ":" + itoa(expect.Sequence) }

func receiptHead(receipt *room.Receipt) string {
	if receipt == nil {
		return ""
	}
	return receipt.Tag.Lineage + ":" + itoa(receipt.ServerSequence)
}

// newGUID is Guid.NewGuid().ToString("N").
func newGUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return hex.EncodeToString(b[:])
}

// toNodeJSON writes an export as the C# node it is and reads it back as one.
func toNodeJSON(exported *jsjson.Object) (*jsjson.Node, error) {
	written, err := docendpoint.Serialize(exported)
	if err != nil {
		return nil, err
	}
	return parse(string(written))
}

// askError carries a bundle question out of the room lane: the batch
// applied nothing.
type askError struct{ json string }

func (e *askError) Error() string { return "the batch waits on a person's approval" }

// askOf reads an agentExecute answer's question, if it asks one.
func askOf(output *jsjson.Node) (*askError, error) {
	ask, err := field(output, "ask")
	if err != nil || ask == nil || ask.Kind != jsjson.KindObject {
		return nil, err
	}
	written, err := write(ask)
	if err != nil {
		return nil, err
	}
	return &askError{json: written}, nil
}

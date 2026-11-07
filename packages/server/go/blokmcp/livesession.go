package blokmcp

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/agentbridge"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/docendpoint"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

// Delivery and presence timings of Node's live session.
const (
	deliveryWait     = 10 * time.Second
	presenceActivity = 60 * time.Second
)

// presencePalette is collaboration/presence.ts's PRESENCE_PALETTE.
var presencePalette = []string{"#0b6e99", "#c1461f", "#0f7b6c", "#6940a5", "#ad1a72", "#886c1a", "#1f5aa8", "#8f3a1c"}

// presenceColor is Node's: the first two bytes of the actor id's SHA-256.
func presenceColor(actorID string) string {
	sum := sha256.Sum256([]byte(actorID))
	return presencePalette[int(binary.BigEndian.Uint16(sum[:2]))%len(presencePalette)]
}

// liveSession is Node's createLiveSession over a liveRoom.
type liveSession struct {
	server     *Server
	room       *liveRoom
	documentID string
	write      bool
	readOnly   bool
	actorID    string
	name       string
	color      string
	onBehalfOf string
	lastActive time.Time
	batch      int
	unacked    map[int][]string
	batchOrder []int
	undo       *yjs.UndoManager
	// undoDoc is the doc undo tracks. The room swaps its doc after a refused
	// write; every step was on the old one, so history starts over.
	undoDoc *yjs.Doc
	done    []*liveStep
	undone  []*liveStep
	// marksPast and marksFuture are the executor's history marks: a write,
	// or a restore that undo cannot cross.
	marksPast   []historyMark
	marksFuture []historyMark
}

func (s *Server) liveConverter() *convert.DocConverter {
	converter := &convert.DocConverter{Now: time.Now, HTML: convert.RuntimeHTMLReader{Runtime: s.bundle.runtime}}
	if s.liveFields != nil {
		converter.Fields = s.liveFields
	}
	return converter
}

// richTextFieldsOf is Node's richTextFieldsOf: a type the contract's
// manifest names keeps the manifest's fields, and --rich-text-fields counts
// only for the other types.
func (s *Server) richTextFieldsOf(ctx context.Context) (*convert.RichTextFields, error) {
	input := map[string]any{}
	if len(s.options.Manifest) > 0 {
		input["customTools"] = s.options.Manifest
	}
	if len(s.options.Overrides) > 0 {
		input["overrides"] = s.options.Overrides
	}
	var out struct {
		Manifest struct {
			Blocks []struct {
				Name           string   `json:"name"`
				RichTextFields []string `json:"richTextFields"`
			} `json:"blocks"`
		} `json:"manifest"`
	}
	if _, err := s.bundle.call(ctx, "manifest", input, &out); err != nil {
		return nil, err
	}
	named := map[string]bool{}
	var entries []convert.RichTextFieldEntry
	for _, block := range out.Manifest.Blocks {
		named[block.Name] = true
		entries = append(entries, convert.RichTextFieldEntry{Type: block.Name, Fields: append([]string{}, block.RichTextFields...)})
	}
	kinds := make([]string, 0, len(s.options.RichTextFields))
	for kind := range s.options.RichTextFields {
		kinds = append(kinds, kind)
	}
	sort.Strings(kinds)
	for _, kind := range kinds {
		if !named[kind] {
			entries = append(entries, convert.RichTextFieldEntry{Type: kind, Fields: s.options.RichTextFields[kind]})
		}
	}
	return convert.NewRichTextFields(entries)
}

// openLive joins the room and waits for its first sync.
func (s *Server) openLive(ctx context.Context, documentID string, write bool, who *caller) (session, error) {
	if s.options.Sync == nil {
		return nil, surfaceError("INVALID_ARGS", "Live mode needs blok-mcp to run with --sync-url.")
	}
	url, err := syncURLFor(s.options.Sync.URL, documentID)
	if err != nil {
		return nil, err
	}
	var actor struct {
		ID         string  `json:"id"`
		OnBehalfOf *string `json:"onBehalfOf"`
	}
	_ = json.Unmarshal(who.actor, &actor)
	tickets, err := s.ticketSource(ctx, documentID, write, who, actor.ID)
	if err != nil {
		return nil, err
	}
	httpURL := url
	if rest, ok := strings.CutPrefix(strings.ToLower(url), "ws"); ok {
		httpURL = "http" + url[len(url)-len(rest):]
	}
	room := newLiveRoom(httpURL, documentID, s.options.Sync.Origin, tickets, s.liveConverter())
	if err := room.open(ctx, roomSyncTimeout); err != nil {
		if room.refusedBy != nil {
			return nil, room.refusedBy
		}
		return nil, s.roomError(ctx, roomErrorFor(err))
	}
	onBehalfOf := actor.ID
	if actor.OnBehalfOf != nil {
		onBehalfOf = *actor.OnBehalfOf
	}
	live := &liveSession{server: s, room: room, documentID: documentID, write: write, readOnly: !write,
		actorID: actor.ID, name: who.presenceName, color: presenceColor(actor.ID), onBehalfOf: onBehalfOf,
		unacked: map[int][]string{}, undo: yjs.NewUndoManager(room.doc), undoDoc: room.doc}
	room.mu.Lock()
	// l<n> counts updates from the session's start, not the first sync.
	room.count = 0
	room.setAwarenessField("user", map[string]string{"name": live.name, "color": live.color, "id": actor.ID})
	room.setAwarenessField("agent", map[string]string{"via": "mcp", "onBehalfOf": onBehalfOf})
	room.mu.Unlock()
	return live, nil
}

// roomError answers a terminal room through mcpRoomError.
func (s *Server) roomError(ctx context.Context, err error) error {
	terminal, ok := err.(*roomTerminal)
	if !ok {
		return err
	}
	var out struct {
		Error json.RawMessage `json:"error"`
	}
	if _, callErr := s.bundle.call(ctx, "mcpRoomError", map[string]string{"terminal": terminal.terminal}, &out); callErr != nil {
		return callErr
	}
	return rawError(out.Error)
}

func (l *liveSession) openInfo() map[string]any {
	l.room.mu.Lock()
	protocol := l.room.protocol
	l.room.mu.Unlock()
	durability := "best-effort"
	if protocol == "v2" {
		durability = "acknowledged"
	}
	info := map[string]any{
		"mode": "live", "write": l.write, "durability": durability,
		"contractRevision": l.server.surface.ContractRevision.Live,
	}
	var unavailable []json.RawMessage
	if json.Unmarshal(l.server.surface.LiveUnavailableCommands, &unavailable) == nil && len(unavailable) > 0 {
		info["unavailableCommands"] = l.server.surface.LiveUnavailableCommands
	}
	return info
}

// endError is why calls on an ended room fail. Call with mu held.
func (l *liveSession) endError(ctx context.Context, end *roomEnd) *surfaceErr {
	if end.reason == "reset" {
		failure := surfaceError("ROOM_RESET", "The room's history was reset. Work not acknowledged is lost; open the document again.")
		failure.Details = map[string]any{"notSavedBatches": l.notSaved()}
		return failure
	}
	err := l.server.roomError(ctx, &roomTerminal{terminal: end.err})
	failure, ok := asSurface(err)
	if !ok {
		return surfaceError("SOURCE_UNAVAILABLE", "The room connection stopped for good. Open the document again.")
	}
	return failure
}

// notSaved lists the batches whose rows are not all acked. Call with mu held.
func (l *liveSession) notSaved() []int {
	saved := []int{}
	for _, number := range l.batchOrder {
		ids, ok := l.unacked[number]
		if !ok {
			continue
		}
		all := true
		for _, id := range ids {
			if fate := l.room.fates[id]; fate == nil || fate.state != "acked" {
				all = false
			}
		}
		if all {
			delete(l.unacked, number)
			continue
		}
		saved = append(saved, number)
	}
	return saved
}

// exportLocked is the room document as the bundle reads it, with the
// revision it reports. Call with mu held.
func (l *liveSession) exportLocked(ctx context.Context) (json.RawMessage, map[string]string, error) {
	exported, err := l.room.converter.Export(ctx, l.room.doc)
	if err != nil {
		return nil, nil, err
	}
	written, err := docendpoint.Serialize(exported)
	if err != nil {
		return nil, nil, err
	}
	revision := map[string]string{"now": fmt.Sprintf("l%d", l.room.count), "afterWrite": fmt.Sprintf("l%d", l.room.count+1)}
	return written, revision, nil
}

func (l *liveSession) sessionInput(call *callContext, document json.RawMessage, revision map[string]string) map[string]any {
	return map[string]any{
		"mcp":      l.server.mcpFlags("live", l.write && !l.readOnly),
		"document": document,
		"actor":    call.actor,
		"revision": revision,
	}
}

func (l *liveSession) read(ctx context.Context, call *callContext, view json.RawMessage) (json.RawMessage, error) {
	l.room.mu.Lock()
	defer l.room.mu.Unlock()
	if l.room.end != nil {
		return nil, l.endError(ctx, l.room.end)
	}
	document, revision, err := l.exportLocked(ctx)
	if err != nil {
		return nil, err
	}
	input := l.sessionInput(call, document, revision)
	input["view"] = view
	return l.server.answerOf(ctx, "mcpRead", input)
}

func (l *liveSession) describe(ctx context.Context, call *callContext, query json.RawMessage) (json.RawMessage, error) {
	return l.server.answerOf(ctx, "mcpDescribe", map[string]any{
		"mcp": l.server.mcpFlags("live", l.write), "document": emptyDocument, "actor": call.actor, "query": query,
	})
}

type liveResult struct {
	OK      bool                   `json:"ok"`
	Error   *struct{ Code string } `json:"error"`
	Changed struct {
		Created []string `json:"created"`
		Updated []string `json:"updated"`
		Moved   []string `json:"moved"`
	} `json:"changed"`
	LastRange *struct {
		BlockID string `json:"blockId"`
		Field   string `json:"field"`
		Start   int    `json:"start"`
		End     int    `json:"end"`
	} `json:"lastRange"`
}

// afterBatch is Node's presence.afterBatch. Call with mu held.
func (l *liveSession) afterBatch(result json.RawMessage) {
	var parsed liveResult
	if json.Unmarshal(result, &parsed) != nil || !parsed.OK {
		return
	}
	now := time.Now()
	l.room.setAwarenessField("activeAt", now.UnixMilli())
	touched := ""
	for _, list := range [][]string{parsed.Changed.Created, parsed.Changed.Updated, parsed.Changed.Moved} {
		if touched == "" && len(list) > 0 {
			touched = list[len(list)-1]
		}
	}
	if touched != "" {
		blockID := touched
		if parsed.LastRange != nil {
			blockID = parsed.LastRange.BlockID
		}
		l.room.setAwarenessField("blockId", blockID)
		cursor := map[string]any{"actorId": l.actorID, "name": l.name, "color": l.color, "blockId": blockID}
		if parsed.LastRange != nil {
			cursor["field"], cursor["start"], cursor["end"] = parsed.LastRange.Field, parsed.LastRange.Start, parsed.LastRange.End
		}
		l.room.setAwarenessField("agentCursor", orderedCursor(cursor))
	}
	// A send on a socket that was not ready does not spend the minute.
	if (l.lastActive.IsZero() || now.Sub(l.lastActive) >= presenceActivity) && l.room.sendActivity() {
		l.lastActive = now
	}
}

// orderedCursor keeps Node's key order for agentCursor.
func orderedCursor(cursor map[string]any) json.RawMessage {
	keys := []string{"actorId", "name", "color", "blockId", "field", "start", "end"}
	buffer := []byte{'{'}
	for _, key := range keys {
		value, ok := cursor[key]
		if !ok {
			continue
		}
		if len(buffer) > 1 {
			buffer = append(buffer, ',')
		}
		name, _ := marshal(key)
		written, _ := marshal(value)
		buffer = append(append(append(buffer, name...), ':'), written...)
	}
	return append(buffer, '}')
}

type liveExecuteOutput struct {
	Ask      *askedQuestion  `json:"ask"`
	Result   json.RawMessage `json:"result"`
	Document json.RawMessage `json:"document"`
	Edits    json.RawMessage `json:"edits"`
	Writes   bool            `json:"writes"`
	Restore  string          `json:"restore"`
}

func (l *liveSession) failed(ctx context.Context, result json.RawMessage, failure *surfaceErr) (*executed, error) {
	if result == nil {
		result = json.RawMessage(`{"ok":false,"warnings":[]}`)
	}
	answer, err := l.server.executeAnswer(ctx, map[string]any{
		"result": result, "failed": map[string]any{"helper": failure.Helper, "error": failure.errorJSON()},
	})
	return &executed{answer: answer}, err
}

func (l *liveSession) execute(ctx context.Context, call *callContext, batch json.RawMessage) (*executed, error) {
	room := l.room
	versions := room.loadVersions(ctx, batch)
	room.mu.Lock()
	defer room.mu.Unlock()
	if room.end != nil {
		return l.failed(ctx, nil, l.endError(ctx, room.end))
	}
	if l.undoDoc != room.doc {
		l.undo.Destroy()
		l.undo, l.undoDoc = yjs.NewUndoManager(room.doc), room.doc
		l.done, l.undone = nil, nil
	}
	mark := len(room.order)
	document, revision, err := l.exportLocked(ctx)
	if err != nil {
		return nil, err
	}
	input := l.sessionInput(call, document, revision)
	input["batch"] = batch
	if call.approval != nil {
		input["approval"] = call.approval
	}
	if versions != nil {
		input["versionHistory"] = versions
	}
	if l.write && !l.readOnly && l.server.pageMap() && hasPageAction(batch) && call.who != nil {
		return l.pageAction(ctx, call, input, mark)
	}
	if l.write && !l.readOnly && l.server.createsPages() && isBatchEnvelope(batch) && call.who != nil {
		if err := l.server.createPages(ctx, input, call.who); err != nil {
			return nil, err
		}
	}
	var out liveExecuteOutput
	// The room takes peer updates while the host uploads, so the next run
	// reads the room again.
	unlocked := func(run func()) {
		room.mu.Unlock()
		run()
		room.mu.Lock()
		if fresh, freshRevision, err := l.exportLocked(ctx); err == nil {
			document = fresh
			input["document"], input["revision"] = fresh, freshRevision
		}
	}
	if err := l.server.agentExecute(ctx, input, &out, unlocked); err != nil {
		return nil, err
	}
	if out.Ask != nil {
		return &executed{ask: out.Ask}, nil
	}
	var parsed liveResult
	_ = json.Unmarshal(out.Result, &parsed)
	if name := historyReplay(batch); name != "" && parsed.Error != nil &&
		(parsed.Error.Code == "NOTHING_TO_UNDO" || parsed.Error.Code == "NOTHING_TO_REDO") {
		// The bundle checked the call with no steps; the session's own
		// steps replay natively, as Node's Y.UndoManager does.
		return l.historyBatch(ctx, call, batch, name, out, mark)
	}
	if !parsed.OK {
		if parsed.Error != nil && parsed.Error.Code == "APPLY_FAILED" {
			l.readOnly = true
		}
		answer, err := l.server.executeAnswer(ctx, map[string]any{"result": out.Result})
		return &executed{answer: answer}, err
	}
	if out.Restore != "" {
		// The lane opens while the host restores: its update comes back as a
		// peer's, and the result's revision counts it, as Node's does.
		before := room.count
		room.mu.Unlock()
		refusal := l.restore(ctx, out.Restore)
		room.mu.Lock()
		if refusal == nil {
			room.waitForUpdate(before, restoreEchoWait)
			out.Result = withRevision(out.Result, fmt.Sprintf("l%d", room.count))
		}
		if refusal != nil {
			answer, err := l.server.errorAnswer(ctx, "blok_execute", refusal)
			return &executed{answer: answer}, err
		}
	}
	var edits []json.RawMessage
	_ = json.Unmarshal(out.Edits, &edits)
	room.holdAppends = true
	if len(edits) > 0 {
		ops, err := agentbridge.RoomOps(string(out.Edits), string(out.Document), string(out.Result))
		stacked := l.undo.UndoTop()
		comments := commentsOnly(batch)
		if err == nil && comments {
			// A person's comment is no undo step, so neither is the agent's.
			err = room.converter.ApplyOps(ctx, room.doc, ops)
		} else if err == nil {
			l.undo.Capture(func(*yjs.Transaction) { err = room.converter.ApplyOps(ctx, room.doc, ops) })
		}
		if err != nil {
			room.holdAppends = false
			room.pendingLocal = nil
			l.readOnly = true
			return l.failed(ctx, out.Result, surfaceError("APPLY_FAILED", "The batch could not be applied to the room."))
		}
		after, _, err := l.exportLocked(ctx)
		if err != nil {
			// The edits are in the doc, so they go to the room as C#'s
			// write-time append sends them; a kept hold would buffer every
			// later local write too.
			room.holdAppends = false
			room.flushAppendsLocked()
			return nil, err
		}
		// A comment is no undo step, so it leaves the history marks alone,
		// as Node's executor does.
		if !comments {
			l.recordStep(stepFor(out.Edits, document), document, after, stacked)
			l.marksPast = append(l.marksPast, historyMark{})
			l.marksFuture = nil
		}
	}
	if out.Restore != "" {
		l.marksPast = append(l.marksPast, historyMark{restored: restoredPrevious(out.Result)})
		l.marksFuture = nil
	}
	return l.deliver(ctx, out, mark)
}

// pageAction runs page.rename or page.setIcon in the page's own room. The
// lock is let go meanwhile: the page write waits up to deliveryWait for its
// ack, and this room keeps taking peer updates. mu is held.
func (l *liveSession) pageAction(ctx context.Context, call *callContext, input map[string]any, mark int) (*executed, error) {
	room := l.room
	room.mu.Unlock()
	result, page, err := l.server.runPageAction(ctx, call, input, func(pageID string) bool { return pageID == l.documentID })
	room.mu.Lock()
	if err != nil {
		return nil, err
	}
	if !page.wrote {
		answer, err := l.server.executeAnswer(ctx, map[string]any{"result": result})
		return &executed{answer: answer}, err
	}
	l.marksPast = append(l.marksPast, historyMark{other: true})
	if page.pending {
		// This room has nothing of the batch to wait for; the page's room
		// had not acknowledged it.
		l.afterBatch(result)
		answer, err := l.server.executeAnswer(ctx, map[string]any{"result": result,
			"delivery": map[string]any{"durable": false, "pending": true, "serverSequence": nil, "savedVersion": nil}})
		return &executed{answer: answer}, err
	}
	return l.deliver(ctx, liveExecuteOutput{Result: result, Writes: true}, mark)
}

// deliver announces the batch, journals its update and waits for the
// room's answer. mu is held.
func (l *liveSession) deliver(ctx context.Context, out liveExecuteOutput, mark int) (*executed, error) {
	room := l.room
	l.afterBatch(out.Result)
	room.holdAppends = false
	failuresBefore := room.appendFailures
	room.flushAppendsLocked()
	if room.appendFailures != failuresBefore {
		l.readOnly = true
		failure := surfaceError("APPLY_FAILED", "The batch changed the local copy but could not be queued for the room. It was not saved; open the document again.")
		failure.Details = map[string]any{"stage": "journal"}
		return l.failed(ctx, out.Result, failure)
	}
	if !out.Writes || room.protocol != "v2" {
		answer, err := l.server.executeAnswer(ctx, map[string]any{"result": out.Result})
		return &executed{answer: answer}, err
	}
	ids := append([]string{}, room.order[mark:]...)
	l.batch++
	number := l.batch
	l.unacked[number] = ids
	l.batchOrder = append(l.batchOrder, number)
	state, sequence, reason, end := room.waitFor(ids, deliveryWait)
	switch state {
	case "ended":
		return l.failed(ctx, out.Result, l.endError(ctx, end))
	case "acked":
		delete(l.unacked, number)
		var seq any
		if sequence != nil {
			seq = *sequence
		}
		answer, err := l.server.executeAnswer(ctx, map[string]any{"result": out.Result,
			"delivery": map[string]any{"durable": true, "pending": false, "serverSequence": seq, "savedVersion": nil}})
		return &executed{answer: answer}, err
	case "timeout":
		answer, err := l.server.executeAnswer(ctx, map[string]any{"result": out.Result,
			"delivery": map[string]any{"durable": false, "pending": true, "serverSequence": nil, "savedVersion": nil}})
		return &executed{answer: answer}, err
	}
	if reason == relineageReason {
		return l.failed(ctx, out.Result, l.endError(ctx, &roomEnd{reason: "reset"}))
	}
	delete(l.unacked, number)
	if reason == "read-only" {
		l.readOnly = true
		return l.failed(ctx, out.Result, surfaceError("READ_ONLY", "The room refused the write: this agent may only read. The batch was not saved."))
	}
	failure := surfaceError("REJECTED", "The room refused this batch. It was not saved.")
	failure.Details = map[string]any{"rejectionCode": reason}
	return l.failed(ctx, out.Result, failure)
}

func (l *liveSession) close() (int, bool) {
	l.room.mu.Lock()
	unsaved := len(l.notSaved())
	lags := l.room.protocol == "v2"
	l.room.setAwarenessField("agentCursor", nil)
	l.room.setAwarenessField("blockId", nil)
	l.room.mu.Unlock()
	l.room.close()
	return unsaved, lags
}

// restore posts the restore the bundle checked; the room sends the
// result back as peer updates. A refusal is the batch's answer.
func (l *liveSession) restore(ctx context.Context, version string) *surfaceErr {
	outcome, err := l.room.restoreVersion(ctx, version)
	switch {
	case err != nil:
		return failureError("TOOL_ACTION_FAILED", "The version history failed: "+err.Error())
	case outcome == "missing":
		return failureError("VERSION_NOT_FOUND", `There is no version "`+version+`". history.versions lists them.`)
	case outcome == "stale":
		return failureError("STALE", "The room changed since you read it, so nothing was restored. Read it again, then retry.")
	}
	return nil
}

// restoreEchoWait bounds the wait for a restore's own update.
const restoreEchoWait = 2 * time.Second

func withRevision(result json.RawMessage, revision string) json.RawMessage {
	var members map[string]json.RawMessage
	if json.Unmarshal(result, &members) != nil {
		return result
	}
	members["revision"] = quoted(revision)
	written, err := marshal(members)
	if err != nil {
		return result
	}
	return written
}

// commentCommands are the database comment actions (COMMENT_COMMANDS);
// the planner refuses a batch that mixes them with other writes.
var commentCommands = map[string]bool{
	"database.addComment": true, "database.replyToComment": true, "database.editComment": true,
	"database.resolveComment": true, "database.deleteComment": true,
}

func commentsOnly(batch json.RawMessage) bool {
	commands, _ := batchCommands(batch)
	for _, command := range commands {
		if commentCommands[command.name] {
			return true
		}
	}
	return false
}

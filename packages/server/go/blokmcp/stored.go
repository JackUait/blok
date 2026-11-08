package blokmcp

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"sync"
)

// session is one open handle's document: Node's HandleSession.
type session interface {
	// openInfo is the session part of mcpOpenAnswer's input.
	openInfo() map[string]any
	read(ctx context.Context, call *callContext, view json.RawMessage) (json.RawMessage, error)
	describe(ctx context.Context, call *callContext, query json.RawMessage) (json.RawMessage, error)
	// execute answers the tool's structuredContent and isError, or an ask.
	execute(ctx context.Context, call *callContext, batch json.RawMessage) (*executed, error)
	close() (unsavedBatches int, hostRecordLags bool)
}

// callContext is what a handle call knows about its caller.
type callContext struct {
	who       *caller
	principal string
	actor     json.RawMessage
	approval  map[string]any
}

// executed is an agentExecute run made into an answer, or a question.
type executed struct {
	answer json.RawMessage
	ask    *askedQuestion
}

type askedQuestion struct {
	Key             string          `json:"key"`
	Message         string          `json:"message"`
	RequestedSchema json.RawMessage `json:"requestedSchema"`
}

// storedSession is Node's openStoredSession, with the agent's state carried
// between bundle calls: the document and its undo history.
type storedSession struct {
	server     *Server
	documentID string
	write      bool
	source     docSource
	exists     bool
	// opener is who opened the handle: the page documents a batch opens or
	// makes go through the source as that caller, as the handle's own do.
	opener *caller

	mu       sync.Mutex
	document json.RawMessage
	history  json.RawMessage
	version  *string
	stale    bool
}

var emptyHistory = json.RawMessage(`{}`)

func (s *Server) openStored(ctx context.Context, documentID string, write bool, who *caller) (*storedSession, error) {
	source := s.sourceFor(who)
	first, err := source.load(ctx, documentID)
	if err != nil {
		return nil, err
	}
	return &storedSession{
		server: s, documentID: documentID, write: write, source: source, exists: !first.missing, opener: who,
		document: first.document, history: emptyHistory, version: first.version,
	}, nil
}

func (st *storedSession) openInfo() map[string]any {
	return map[string]any{
		"mode": "stored", "write": st.write, "durability": "saved-on-execute",
		"contractRevision": st.server.surface.ContractRevision.Stored, "exists": st.exists,
	}
}

// reloaded reloads and gives the parent as stored, or nil when it could
// not be read.
func (st *storedSession) reloaded(ctx context.Context) json.RawMessage {
	if err := st.reload(ctx); err != nil {
		return nil
	}
	return st.document
}

// reload starts a fresh agent, as Node does after a refused save.
func (st *storedSession) reload(ctx context.Context) error {
	loaded, err := st.source.load(ctx, st.documentID)
	if err != nil {
		return err
	}
	st.document, st.version, st.history, st.stale = loaded.document, loaded.version, emptyHistory, false
	return nil
}

func (st *storedSession) sessionInput(call *callContext) map[string]any {
	actor := call.actor
	// The handle works for its opener, as Node binds the agent at open.
	if st.opener != nil && len(st.opener.actor) > 0 {
		actor = st.opener.actor
	}
	return map[string]any{
		"mcp":      st.server.mcpFlags("stored", st.write),
		"document": st.document,
		"actor":    actor,
		"history":  st.history,
	}
}

// snapshot is the handle as a HandleStore keeps it.
func (st *storedSession) snapshot() HandleRecord {
	record := HandleRecord{
		V: 1, ContractRevision: st.server.surface.ContractRevision.Stored, DocumentID: st.documentID, Write: st.write,
		Version: st.version, Stale: st.stale, Document: st.document, History: st.history,
	}
	if st.opener != nil {
		record.Principal, record.ClientName, record.Scopes, record.Actor = st.opener.principal, st.opener.clientName, st.opener.scopes, st.opener.actor
	}
	return record
}

// restoreStored rebuilds a stored handle from its record, with no load:
// the record carries the document. Its undo steps hold only while their
// revision is the document's, as the bundle checks on every call.
func (s *Server) restoreStored(record HandleRecord) *storedSession {
	opener := &caller{principal: record.Principal, clientName: record.ClientName, scopes: record.Scopes, actor: record.Actor}
	history := record.History
	if len(history) == 0 {
		history = emptyHistory
	}
	return &storedSession{
		server: s, documentID: record.DocumentID, write: record.Write, source: s.sourceFor(opener), exists: true, opener: opener,
		document: record.Document, history: history, version: record.Version, stale: record.Stale,
	}
}

func (st *storedSession) read(ctx context.Context, call *callContext, view json.RawMessage) (json.RawMessage, error) {
	if st.stale {
		if err := st.reload(ctx); err != nil {
			return nil, err
		}
	}
	input := st.sessionInput(call)
	input["view"] = view
	return st.server.answerOf(ctx, "mcpRead", input)
}

func (st *storedSession) describe(ctx context.Context, call *callContext, query json.RawMessage) (json.RawMessage, error) {
	input := st.sessionInput(call)
	input["query"] = query
	return st.server.answerOf(ctx, "mcpDescribe", input)
}

type executeOutput struct {
	Ask          *askedQuestion  `json:"ask"`
	Result       json.RawMessage `json:"result"`
	Document     json.RawMessage `json:"document"`
	History      json.RawMessage `json:"history"`
	Save         bool            `json:"save"`
	DocumentText *string         `json:"documentText"`
}

func (st *storedSession) execute(ctx context.Context, call *callContext, batch json.RawMessage) (*executed, error) {
	if st.stale {
		if err := st.reload(ctx); err != nil {
			return nil, err
		}
	}
	input := st.sessionInput(call)
	input["batch"] = batch
	if st.write && st.server.pageMap() && hasPageAction(batch) {
		return st.pageAction(ctx, call, input)
	}
	if call.approval != nil {
		input["approval"] = call.approval
	}
	var made *madePages
	if st.write && st.server.createsPages() && isBatchEnvelope(batch) {
		var err error
		if made, err = st.server.createPages(ctx, input, st.openerOr(call.who), st.source, st.documentID); err != nil {
			return nil, err
		}
		if made.cancelled {
			// The batch still gets its answer.
			ctx = context.WithoutCancel(ctx)
		}
	}
	input["documentText"] = st.source.documentForm()
	var out executeOutput
	if err := st.server.agentExecute(ctx, input, &out, func(run func()) { run() }); err != nil {
		return st.server.reportStopped(ctx, createdOf(made), st.document, nil, err)
	}
	if out.Ask != nil {
		return &executed{ask: out.Ask}, nil
	}
	// A failed batch wrote nothing, so memory is the parent as saved.
	out.Result = finishPages(out.Result, made, st.document)
	if !out.Save || out.DocumentText == nil {
		st.keep(out)
		answer, err := st.server.executeAnswer(ctx, map[string]any{"result": out.Result})
		return &executed{answer: answer}, err
	}
	// As Node: the answer is built before the save, so nothing that can fail
	// follows it, and a failed answer saved nothing a retry would repeat.
	standIn := savedVersionStandIn
	built, err := st.server.executeAnswer(ctx, map[string]any{
		"result":   out.Result,
		"delivery": delivery{Durable: true, Pending: false, ServerSequence: nil, SavedVersion: &standIn},
	})
	if err != nil {
		st.stale = true
		return st.server.reportStopped(ctx, createdOf(made), st.reloaded(ctx), out.Result, err)
	}
	saved, err := st.source.save(ctx, st.documentID, []byte(*out.DocumentText), st.version)
	if err != nil {
		failure, ok := asSurface(err)
		// The work was refused, so memory must match the source again. A
		// failed reload retries on the next call.
		st.stale = true
		parent := st.reloaded(ctx)
		if !ok {
			// A save can store the parent before it breaks: the reload
			// shows which pages it names.
			return st.server.reportStopped(ctx, createdOf(made), parent, out.Result, err)
		}
		answer, answerErr := st.server.executeAnswer(ctx, map[string]any{
			"result": out.Result, "failed": map[string]any{"helper": failure.Helper, "error": failure.errorJSON()},
		})
		return &executed{answer: answer}, answerErr
	}
	st.keep(out)
	st.version = saved
	version, _ := marshal(saved)
	return &executed{answer: bytes.Replace(built, []byte(`"`+standIn+`"`), version, 1)}, nil
}

// pageAction runs page.rename or page.setIcon on the page's own document.
// This document is not saved.
func (st *storedSession) pageAction(ctx context.Context, call *callContext, input map[string]any) (*executed, error) {
	same, _ := st.source.(interface {
		sameDocument(ctx context.Context, first, second string) bool
	})
	pageCall := *call
	pageCall.who = st.openerOr(call.who)
	result, page, err := st.server.runPageAction(ctx, &pageCall, input, func(pageID string) bool {
		return pageID == st.documentID || (same != nil && same.sameDocument(ctx, pageID, st.documentID))
	})
	if err != nil {
		return nil, err
	}
	answerInput := map[string]any{"result": result}
	if page.wrote {
		var parsed struct {
			Revision json.RawMessage `json:"revision"`
		}
		_ = json.Unmarshal(result, &parsed)
		st.history = withOtherStep(st.history, parsed.Revision)
	}
	if page.pending {
		answerInput["delivery"] = delivery{Durable: false, Pending: true, ServerSequence: nil, SavedVersion: nil}
	}
	answer, err := st.server.executeAnswer(ctx, answerInput)
	return &executed{answer: answer}, err
}

func (st *storedSession) openerOr(who *caller) *caller {
	if st.opener != nil {
		return st.opener
	}
	return who
}

func (st *storedSession) keep(out executeOutput) {
	if len(out.Document) > 0 {
		st.document = out.Document
	}
	if len(out.History) > 0 {
		st.history = out.History
	}
}

func (st *storedSession) close() (int, bool) { return 0, false }

// isBatchEnvelope is the bundle's check: commands is an array of objects.
func isBatchEnvelope(batch json.RawMessage) bool {
	record, ok := isRecordJSON(batch)
	if !ok || !isArrayJSON(record["commands"]) {
		return false
	}
	var commands []json.RawMessage
	if json.Unmarshal(record["commands"], &commands) != nil {
		return false
	}
	for _, command := range commands {
		if _, ok := isRecordJSON(command); !ok {
			return false
		}
	}
	return true
}

// delivery is an answer's delivery, its keys in Node's order.
type delivery struct {
	Durable        bool `json:"durable"`
	Pending        bool `json:"pending"`
	ServerSequence any  `json:"serverSequence"`
	SavedVersion   any  `json:"savedVersion"`
}

// savedVersionStandIn holds the saved version's place in an answer built
// before the save. Random, so no batch text holds it by chance.
var savedVersionStandIn = func() string {
	random := make([]byte, 16)
	_, _ = rand.Read(random)
	return "blok-saved-version-" + hex.EncodeToString(random)
}()

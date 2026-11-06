package blokmcp

import (
	"context"
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
	actor    json.RawMessage
	approval map[string]any
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

	mu       sync.Mutex
	document json.RawMessage
	history  json.RawMessage
	version  *string
	stale    bool
}

var emptyHistory = json.RawMessage(`{}`)

func (s *Server) openStored(ctx context.Context, documentID string, write bool) (*storedSession, error) {
	first, err := s.source.load(ctx, documentID)
	if err != nil {
		return nil, err
	}
	return &storedSession{
		server: s, documentID: documentID, write: write, source: s.source, exists: !first.missing,
		document: first.document, history: emptyHistory, version: first.version,
	}, nil
}

func (st *storedSession) openInfo() map[string]any {
	return map[string]any{
		"mode": "stored", "write": st.write, "durability": "saved-on-execute",
		"contractRevision": st.server.surface.ContractRevision.Stored, "exists": st.exists,
	}
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
	return map[string]any{
		"mcp":      st.server.mcpFlags("stored", st.write),
		"document": st.document,
		"actor":    call.actor,
		"history":  st.history,
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
	input["documentText"] = st.source.documentForm()
	if call.approval != nil {
		input["approval"] = call.approval
	}
	var out executeOutput
	if _, err := st.server.bundle.call(ctx, "agentExecute", input, &out); err != nil {
		return nil, err
	}
	if out.Ask != nil {
		return &executed{ask: out.Ask}, nil
	}
	if !out.Save || out.DocumentText == nil {
		st.keep(out)
		answer, err := st.server.executeAnswer(ctx, map[string]any{"result": out.Result})
		return &executed{answer: answer}, err
	}
	saved, err := st.source.save(ctx, st.documentID, []byte(*out.DocumentText), st.version)
	if err != nil {
		failure, ok := asSurface(err)
		// The work was refused, so memory must match the source again. A
		// failed reload retries on the next call.
		st.stale = true
		_ = st.reload(ctx)
		if !ok {
			return nil, err
		}
		answer, answerErr := st.server.executeAnswer(ctx, map[string]any{
			"result": out.Result, "failed": map[string]any{"helper": failure.Helper, "error": failure.errorJSON()},
		})
		return &executed{answer: answer}, answerErr
	}
	st.keep(out)
	st.version = saved
	answer, err := st.server.executeAnswer(ctx, map[string]any{
		"result":   out.Result,
		"delivery": map[string]any{"durable": true, "pending": false, "serverSequence": nil, "savedVersion": saved},
	})
	return &executed{answer: answer}, err
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

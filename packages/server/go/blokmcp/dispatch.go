package blokmcp

import (
	"context"
	"encoding/json"
	"sync"
)

// caller is who makes a call: the principal, the cleaned client name and
// the OAuth scopes (nil without OAuth).
type caller struct {
	principal    string
	clientName   string
	scopes       []string
	actor        json.RawMessage
	presenceName string
}

// toolCall is one tools/call as the dispatcher reads it.
type toolCall struct {
	name      string
	arguments json.RawMessage
	caller    *caller
	// approval is agentExecute's approval input.
	approval map[string]any
}

// outcome is a tools/call answer, or the question to ask first.
type outcome struct {
	answer json.RawMessage
	ask    *askedQuestion
}

// errUnknownToolName carries mcpCheckCall's "Unknown tool: x" message.
type errUnknownToolName struct{ message string }

func (e *errUnknownToolName) Error() string { return e.message }

type callStep struct {
	Tool       string          `json:"tool"`
	List       *listRequest    `json:"list"`
	DocumentID *string         `json:"documentId"`
	Find       json.RawMessage `json:"find"`
	Mode       string          `json:"mode"`
	Write      bool            `json:"write"`
	View       json.RawMessage `json:"view"`
	Handle     string          `json:"handle"`
	Call       struct {
		Name  string          `json:"name"`
		View  json.RawMessage `json:"view"`
		Query json.RawMessage `json:"query"`
		Batch json.RawMessage `json:"batch"`
	} `json:"call"`
}

// actorFor is mcpActor: the cleaned client name and the default actor.
func (s *Server) actorFor(ctx context.Context, principal string, rawClientName *string) (*caller, error) {
	input := map[string]any{"principal": principal}
	if rawClientName != nil {
		input["clientName"] = *rawClientName
	}
	var out struct {
		ClientName   string          `json:"clientName"`
		Actor        json.RawMessage `json:"actor"`
		PresenceName string          `json:"presenceName"`
	}
	if _, err := s.bundle.call(ctx, "mcpActor", input, &out); err != nil {
		return nil, err
	}
	return &caller{principal: principal, clientName: out.ClientName, actor: out.Actor, presenceName: out.PresenceName}, nil
}

// dispatch is Node's createToolDispatcher. A model-fixable refusal is an
// answer; any other error is a JSON-RPC internal error.
func (s *Server) dispatch(ctx context.Context, call *toolCall) (*outcome, error) {
	defer s.track()()
	// Node checks the client's cancel only before an open hands out its
	// handle; a batch that runs is saved even if the client hung up.
	signal := ctx
	ctx = context.WithoutCancel(ctx)
	result, err := s.dispatchStep(ctx, call, signal)
	if err == nil {
		return result, nil
	}
	failure, ok := asSurface(err)
	if !ok {
		return nil, err
	}
	answer, answerErr := s.errorAnswer(ctx, call.name, failure)
	if answerErr != nil {
		return nil, answerErr
	}
	return &outcome{answer: answer}, nil
}

func (s *Server) dispatchStep(ctx context.Context, call *toolCall, signal context.Context) (*outcome, error) {
	var arguments any = call.arguments
	if len(call.arguments) == 0 {
		arguments = map[string]any{}
	}
	var checked struct {
		UnknownTool *string         `json:"unknownTool"`
		Answer      json.RawMessage `json:"answer"`
		Step        *callStep       `json:"step"`
	}
	if _, err := s.bundle.call(ctx, "mcpCheckCall", map[string]any{"name": call.name, "arguments": arguments, "scopes": call.caller.scopes}, &checked); err != nil {
		return nil, err
	}
	if checked.UnknownTool != nil {
		return nil, &errUnknownToolName{message: *checked.UnknownTool}
	}
	if len(checked.Answer) > 0 {
		return &outcome{answer: checked.Answer}, nil
	}
	step := checked.Step
	switch step.Tool {
	case "blok_list_documents":
		listing, err := s.listDocuments(ctx, *step.List, call.caller)
		if err != nil {
			return nil, err
		}
		return s.plainAnswer(listing), nil
	case "blok_open":
		return s.openDocument(ctx, step, call.caller, signal)
	case "blok_close":
		// A refused check still closes, so the handle does not keep its
		// --max-handles place. An unknown handle fails again in remove.
		refusal := s.onHandle(ctx, call.caller, step.Handle, false, func(session) error { return nil })
		sess, err := s.handles.remove(step.Handle, call.caller.principal)
		if err != nil {
			return nil, err
		}
		unsaved, lags := sess.close()
		if refusal != nil {
			return nil, refusal
		}
		answer, _ := marshal(struct {
			Closed         bool `json:"closed"`
			UnsavedBatches int  `json:"unsavedBatches"`
			HostRecordLags bool `json:"hostRecordLags"`
		}{true, unsaved, lags})
		return s.plainAnswer(answer), nil
	}
	var result *outcome
	err := s.onHandle(ctx, call.caller, step.Handle, step.Write, func(sess session) error {
		context := &callContext{who: call.caller, principal: call.caller.principal, actor: call.caller.actor, approval: call.approval}
		var err error
		switch step.Call.Name {
		case "blok_read":
			var answer json.RawMessage
			answer, err = sess.read(ctx, context, step.Call.View)
			result = &outcome{answer: answer}
		case "blok_describe":
			var answer json.RawMessage
			answer, err = sess.describe(ctx, context, step.Call.Query)
			result = &outcome{answer: answer}
		default:
			var ran *executed
			ran, err = sess.execute(ctx, context, step.Call.Batch)
			if ran != nil {
				result = &outcome{answer: ran.answer, ask: ran.ask}
			}
		}
		return err
	})
	return result, err
}

// plainAnswer is a successful answer whose structuredContent is content.
func (s *Server) plainAnswer(content json.RawMessage) *outcome {
	answer, _ := marshal(struct {
		StructuredContent json.RawMessage `json:"structuredContent"`
		IsError           bool            `json:"isError"`
	}{content, false})
	return &outcome{answer: answer}
}

func (s *Server) onHandle(ctx context.Context, who *caller, handle string, write bool, operation func(session) error) error {
	return s.handles.use(ctx, handle, who.principal, func(sess session, documentID string) error {
		allowed, err := s.allowed(ctx, who.principal, documentID, write)
		if err != nil {
			return err
		}
		if !allowed {
			return surfaceError("FORBIDDEN", "You no longer have access to this document.")
		}
		return operation(sess)
	})
}

// allowed asks the authorize hook; without one everything is allowed.
func (s *Server) allowed(ctx context.Context, principal, documentID string, write bool) (bool, error) {
	if s.options.Authorize == nil {
		return true, nil
	}
	return s.options.Authorize(ctx, principal, documentID, write)
}

type listResult struct {
	Documents  []listedEntry `json:"documents"`
	NextCursor *string       `json:"nextCursor"`
	Supported  bool          `json:"supported"`
}

type listedEntry struct {
	ID    string  `json:"id"`
	Title *string `json:"title"`
	Live  bool    `json:"live"`
}

// list is the opener's list: the source's page, filtered by the authorize
// hook with write false.
func (s *Server) list(ctx context.Context, request listRequest, who *caller) (*listResult, error) {
	if s.source == nil || !s.source.lists() {
		return &listResult{Documents: []listedEntry{}, Supported: false}, nil
	}
	listing, err := s.source.list(ctx, request)
	if err != nil {
		return nil, err
	}
	readable := make([]bool, len(listing.Documents))
	var group sync.WaitGroup
	var failed error
	var mu sync.Mutex
	for index, doc := range listing.Documents {
		group.Go(func() {
			ok, err := s.allowed(ctx, who.principal, doc.ID, false)
			mu.Lock()
			defer mu.Unlock()
			if err != nil && failed == nil {
				failed = err
			}
			readable[index] = ok
		})
	}
	group.Wait()
	if failed != nil {
		return nil, failed
	}
	result := &listResult{Documents: []listedEntry{}, NextCursor: listing.NextCursor, Supported: true}
	for index, doc := range listing.Documents {
		if readable[index] {
			result.Documents = append(result.Documents, listedEntry{ID: doc.ID, Title: doc.Title, Live: s.options.live()})
		}
	}
	return result, nil
}

// listDocuments lists, then lists again without the query when it matched
// nothing (mcpListAnswer decides).
func (s *Server) listDocuments(ctx context.Context, request listRequest, who *caller) (json.RawMessage, error) {
	listing, err := s.list(ctx, request, who)
	if err != nil {
		return nil, err
	}
	var out struct {
		Relist  *listRequest    `json:"relist"`
		Listing json.RawMessage `json:"listing"`
	}
	if _, err := s.bundle.call(ctx, "mcpListAnswer", map[string]any{"request": request, "listing": listing}, &out); err != nil {
		return nil, err
	}
	if out.Relist == nil {
		return out.Listing, nil
	}
	relisted, err := s.list(ctx, *out.Relist, who)
	if err != nil {
		return nil, err
	}
	if _, err := s.bundle.call(ctx, "mcpListAnswer", map[string]any{"request": request, "listing": listing, "relisted": relisted}, &out); err != nil {
		return nil, err
	}
	return out.Listing, nil
}

func (s *Server) openDocument(ctx context.Context, step *callStep, who *caller, signal context.Context) (*outcome, error) {
	if step.DocumentID != nil {
		return s.openFound(ctx, step, *step.DocumentID, nil, who, signal)
	}
	var find struct {
		Query *string `json:"query"`
	}
	_ = json.Unmarshal(step.Find, &find)
	listing, err := s.listDocuments(ctx, listRequest{Limit: 25, Query: find.Query}, who)
	if err != nil {
		return nil, err
	}
	var picked struct {
		Answer json.RawMessage `json:"answer"`
		Open   *struct {
			DocumentID string  `json:"documentId"`
			Title      *string `json:"title"`
		} `json:"open"`
	}
	if _, err := s.bundle.call(ctx, "mcpPickDocument", map[string]any{"find": step.Find, "listing": listing}, &picked); err != nil {
		return nil, err
	}
	if picked.Open == nil {
		return &outcome{answer: picked.Answer}, nil
	}
	found := map[string]any{"documentId": picked.Open.DocumentID, "title": picked.Open.Title}
	return s.openFound(ctx, step, picked.Open.DocumentID, found, who, signal)
}

func (s *Server) openFound(ctx context.Context, step *callStep, documentID string, found map[string]any, who *caller, signal context.Context) (*outcome, error) {
	// Opening can mint a ticket and join a room, so the cap is checked first.
	if err := s.handles.assertRoom(who.principal); err != nil {
		return nil, err
	}
	sess, err := s.open(ctx, documentID, step.Mode, step.Write, who)
	if err != nil {
		return nil, err
	}
	var view json.RawMessage
	if len(step.View) > 0 {
		answer, err := sess.read(ctx, &callContext{actor: who.actor}, step.View)
		if err != nil {
			sess.close()
			return nil, err
		}
		var read struct {
			StructuredContent json.RawMessage `json:"structuredContent"`
			IsError           bool            `json:"isError"`
		}
		_ = json.Unmarshal(answer, &read)
		if read.IsError {
			sess.close()
			return &outcome{answer: answer}, nil
		}
		view = read.StructuredContent
	}
	if signal.Err() != nil {
		sess.close()
		return nil, failureError("CANCELLED", "The request was cancelled before the document opened.")
	}
	handle, err := s.handles.add(who.principal, documentID, sess)
	if err != nil {
		sess.close()
		return nil, err
	}
	input := map[string]any{"handle": handle, "expiresAfterIdleMs": s.idleJSON, "session": sess.openInfo()}
	if found != nil {
		input["found"] = found
	}
	if view != nil {
		input["view"] = view
	}
	answer, err := s.answerOf(ctx, "mcpOpenAnswer", input)
	if err != nil {
		return nil, err
	}
	return &outcome{answer: answer}, nil
}

// open is the opener: authorize, resolve the mode, then a stored or live
// session.
func (s *Server) open(ctx context.Context, documentID, requested string, write bool, who *caller) (session, error) {
	allowed, err := s.allowed(ctx, who.principal, documentID, write)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, surfaceError("FORBIDDEN", "You may not open this document with this access.")
	}
	var resolved struct {
		Mode  string          `json:"mode"`
		Error json.RawMessage `json:"error"`
	}
	if _, err := s.bundle.call(ctx, "mcpResolveMode", map[string]any{"requested": requested, "sync": s.options.live()}, &resolved); err != nil {
		return nil, err
	}
	if len(resolved.Error) > 0 {
		return nil, rawError(resolved.Error)
	}
	if resolved.Mode == "live" {
		if s.options.Rooms != nil {
			return s.openRoom(ctx, documentID, write)
		}
		return s.openLive(ctx, documentID, write, who)
	}
	if s.source == nil {
		return nil, surfaceError("SOURCE_UNAVAILABLE", "No document source is configured. Start blok-mcp with --source.")
	}
	return s.openStored(ctx, documentID, write)
}

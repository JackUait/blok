package blokagent

import (
	"context"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// Same caps as AGENT_HISTORY_LIMITS in src/shared/agent/document-session.ts.
const (
	maxSteps = 100
	// Counted in the UTF-16 units of each step as System.Text.Json writes it
	// (non-ASCII escaped), not in bytes or runes.
	maxChars = 4 * 1024 * 1024
)

// Session is one agent's batches on stored documents, kept in memory so
// that history.undo and history.redo can take them back and write them
// again. Its steps stay usable while each call passes the document the
// session last returned; when someone else saved in between, undo and redo
// answer CONFLICT. Not safe for concurrent use: finish each call before the
// next.
type Session struct {
	executor *Executor
	options  *Options
	actor    Actor
	history  *jsjson.Node
}

// OpenSession opens a session for one agent on stored documents.
func (e *Executor) OpenSession(actor Actor, options *Options) *Session {
	return &Session{executor: e, options: options, actor: actor, history: jsjson.NewObject()}
}

// Actor is the agent every batch runs as.
func (s *Session) Actor() Actor { return s.actor }

// Contract is the command contract for this session. Unlike a plain call's,
// it offers history.undo and history.redo.
func (s *Session) Contract(ctx context.Context) (string, error) {
	input, err := common(s.options)
	if err != nil {
		return "", err
	}
	input.Members = append(input.Members, member("history", jsjson.NewObject()))
	return s.executor.contract(ctx, input)
}

// Execute runs a batch. The answer holds a document to save only when the
// batch succeeded.
func (s *Session) Execute(ctx context.Context, documentJSON, batchJSON string) (Execution, error) {
	execution, next, err := s.executor.run(ctx, documentJSON, batchJSON, s.actor, s.options, s.history)
	if err != nil {
		return Execution{}, err
	}
	if next != nil {
		if s.history, err = bounded(next); err != nil {
			return Execution{}, err
		}
	}
	return execution, nil
}

// bounded drops the oldest steps, past before future, until both caps
// hold; the newest step stays.
func bounded(history *jsjson.Node) (*jsjson.Node, error) {
	past, err := steps(history, "past")
	if err != nil {
		return nil, err
	}
	future, err := steps(history, "future")
	if err != nil {
		return nil, err
	}
	chars := 0
	for _, entry := range append(append([]*jsjson.Node{}, past.Items...), future.Items...) {
		size, err := charsOf(entry)
		if err != nil {
			return nil, err
		}
		chars += size
	}
	for count := len(past.Items) + len(future.Items); count > maxSteps || (count > 1 && chars > maxChars); count-- {
		from := future
		if len(past.Items) > 0 {
			from = past
		}
		size, err := charsOf(from.Items[0])
		if err != nil {
			return nil, err
		}
		chars -= size
		from.Items = from.Items[1:]
	}
	return history, nil
}

// steps is `history[key] as JsonArray ?? []`; a missing list is a detached one.
func steps(history *jsjson.Node, key string) (*jsjson.Node, error) {
	list, err := get(history, key)
	if err != nil {
		return nil, err
	}
	if list == nil || list.Kind != jsjson.KindArray {
		return jsjson.NewArray(), nil
	}
	return list, nil
}

// charsOf is `entry?.ToJsonString().Length`: a JSON null counts 0. The
// written form is ASCII, so its bytes are its UTF-16 units.
func charsOf(entry *jsjson.Node) (int, error) {
	if !present(entry) {
		return 0, nil
	}
	written, err := entry.AppendJSON(nil)
	if err != nil {
		return 0, fromJSON(err)
	}
	return len(written), nil
}

// wroteAnotherDocument marks a page action's step. It writes the target,
// not this document, so the step holds no snapshot: "other" makes
// history.undo answer UNDO_OTHER_DOCUMENT.
func wroteAnotherDocument(history *jsjson.Node) (*jsjson.Node, error) {
	next := history.Clone()
	past, err := get(next, "past")
	if err != nil {
		return nil, err
	}
	if past == nil || past.Kind != jsjson.KindArray {
		past = jsjson.NewArray()
		if err := set(next, "past", past); err != nil {
			return nil, err
		}
	}
	past.Items = append(past.Items, str("other"))
	return next, nil
}

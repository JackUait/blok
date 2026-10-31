package blokagent

import (
	"context"
	"errors"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/jsruntime"
)

// invoker is the runtime seam; tests put a scripted runtime behind it.
type invoker interface {
	Invoke(ctx context.Context, op, input string, timeout time.Duration) (string, error)
}

// Rooms runs batches on live rooms. The collaboration server provides it;
// without it ExecuteInRoom answers COMMAND_UNAVAILABLE.
type Rooms interface {
	// ExecuteInRoom runs one batch in the room; docID is never empty.
	ExecuteInRoom(ctx context.Context, docID, batchJSON string, actor Actor, options *Options) (Execution, error)
	// HasHistory reports whether the journal keeps version history, which
	// adds the history reads and restore to the room contract.
	HasHistory() bool
}

// Executor runs agent batches. It is safe for concurrent use; a Session is
// not.
type Executor struct {
	runtime invoker
	rooms   Rooms
}

// FactoryOptions configure New. Zero values take the defaults, as in
// blokdocs.Options.
type FactoryOptions struct {
	PoolSize     int
	Timeout      time.Duration
	MemoryBudget int64
	// Rooms, when set, runs ExecuteInRoom.
	Rooms Rooms
}

// New builds an executor over a fresh engine pool, as C#
// BlokDocuments.CreateAgentExecutor does. Building one is expensive, so hold
// it for the life of the process. A limit below its floor is a
// *blokdocs.ConstraintError.
func New(options FactoryOptions) (*Executor, error) {
	pool, err := jsruntime.NewPool(jsruntime.Options{
		PoolSize:     options.PoolSize,
		Timeout:      options.Timeout,
		MemoryBudget: options.MemoryBudget,
	})
	if err != nil {
		return nil, err
	}
	executor := newExecutor(pool)
	executor.rooms = options.Rooms
	return executor, nil
}

func newExecutor(runtime invoker) *Executor { return &Executor{runtime: runtime} }

func (e *Executor) invoke(ctx context.Context, op string, input *jsjson.Node) (string, error) {
	written, err := write(input)
	if err != nil {
		return "", err
	}
	output, err := e.runtime.Invoke(ctx, op, written, 0)
	if err != nil {
		return "", fromRuntime(err)
	}
	return output, nil
}

// isCancel is C#'s `error is OperationCanceledException`.
func isCancel(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

// Execute runs a batch on a stored document. The answer holds a document to
// save only when the batch succeeded. A plain call keeps no steps, so
// history.undo and history.redo are unavailable; OpenSession offers them.
func (e *Executor) Execute(ctx context.Context, documentJSON, batchJSON string, actor Actor, options *Options) (Execution, error) {
	execution, _, err := e.run(ctx, documentJSON, batchJSON, actor, options, nil)
	return execution, err
}

// run is a stored batch. With history, the bundle takes a session's steps
// and hands them back with the batch applied; Go only carries them.
func (e *Executor) run(ctx context.Context, documentJSON, batchJSON string, actor Actor, options *Options, history *jsjson.Node) (Execution, *jsjson.Node, error) {
	input, err := common(options)
	if err != nil {
		return Execution{}, nil, err
	}
	document, err := parse(documentJSON)
	if err != nil {
		return Execution{}, nil, err
	}
	batch, err := parse(batchJSON)
	if err != nil {
		return Execution{}, nil, err
	}
	input.Members = append(input.Members, member("document", document), member("batch", batch), member("actor", actorNode(actor)))

	if options != nil && options.PageTitles && options.PageTarget != nil {
		action, err := hasCommand(batch, "page.rename", "page.setIcon")
		if err != nil {
			return Execution{}, nil, err
		}
		if action {
			done, err := e.runPageAction(ctx, input, actor, options.PageTarget)
			if err != nil || history == nil {
				return done, history, err
			}
			result, err := parse(done.ResultJSON)
			if err != nil {
				return Execution{}, nil, err
			}
			ok, err := isTrue(result, "ok")
			if err != nil || !ok {
				return done, history, err
			}
			next, err := wroteAnotherDocument(history)
			return done, next, err
		}
	}

	made, refusal, err := e.createPages(ctx, input, options, actor)
	if err != nil || refusal != nil {
		if refusal != nil {
			return *refusal, history, nil
		}
		return Execution{}, nil, err
	}
	if history != nil {
		input.Members = append(input.Members, member("history", history.Clone()))
	}

	output, err := e.agentExecute(ctx, input)
	if err != nil {
		if len(made) > 0 {
			stopped, err := stoppedAfterCreating(err, made)
			return stopped, history, err
		}
		return Execution{}, nil, err
	}
	result, err := get(output, "result")
	if err != nil {
		return Execution{}, nil, err
	}
	if result == nil {
		return Execution{}, nil, noAnswer("agent result")
	}
	ok, err := isTrue(result, "ok")
	if err != nil {
		return Execution{}, nil, err
	}
	var saved *string
	if ok {
		document, err := get(output, "document")
		if err != nil {
			return Execution{}, nil, err
		}
		if document == nil {
			return Execution{}, nil, noAnswer("document")
		}
		written, err := write(document)
		if err != nil {
			return Execution{}, nil, err
		}
		saved = &written
	}
	var next *jsjson.Node
	if history != nil {
		if next, err = object(output, "history"); err != nil {
			return Execution{}, nil, err
		}
		if next == nil {
			return Execution{}, nil, noAnswer("session history")
		}
		next = next.Clone()
	}
	written, err := write(result)
	if err != nil {
		return Execution{}, nil, err
	}
	revision, err := revisionOf(result)
	if err != nil {
		return Execution{}, nil, err
	}
	return Execution{ResultJSON: written, DocumentJSON: saved, Revision: revision}, next, nil
}

// agentExecute is the call C# wraps in one try: the invoke, the parse and
// the null check all count as the run stopping.
func (e *Executor) agentExecute(ctx context.Context, input *jsjson.Node) (*jsjson.Node, error) {
	answer, err := e.invoke(ctx, "agentExecute", input)
	if err != nil {
		return nil, err
	}
	output, err := parse(answer)
	if err != nil {
		return nil, err
	}
	if !present(output) {
		return nil, noAnswer("agent execution")
	}
	return output, nil
}

// hasCommand reports a command with one of names, as C# HasInsert and
// HasPageAction do: it stops at the first match, so a bad key after it is
// never read.
func hasCommand(batch *jsjson.Node, names ...string) (bool, error) {
	if batch.Kind != jsjson.KindObject {
		return false, nil
	}
	commands, err := get(batch, "commands")
	if err != nil || commands == nil || commands.Kind != jsjson.KindArray {
		return false, err
	}
	for _, command := range commands.Items {
		if command.Kind != jsjson.KindObject {
			continue
		}
		name, err := get(command, "name")
		if err != nil {
			return false, err
		}
		value, ok := text(name)
		if !ok {
			continue
		}
		for _, wanted := range names {
			if value == wanted {
				return true, nil
			}
		}
	}
	return false, nil
}

// Contract is the command contract for Execute.
func (e *Executor) Contract(ctx context.Context, options *Options) (string, error) {
	input, err := common(options)
	if err != nil {
		return "", err
	}
	return e.contract(ctx, input)
}

// RoomContract is the command contract for ExecuteInRoom. With rooms whose
// journal keeps history it adds the version history reads and restore.
func (e *Executor) RoomContract(ctx context.Context, options *Options) (string, error) {
	input, err := common(options)
	if err != nil {
		return "", err
	}
	// A room keeps the agent's steps on the server, so its contract says so.
	input.Members = append(input.Members, member("runtime", str("csharp-live")))
	if e.rooms != nil && e.rooms.HasHistory() {
		services := input.Members[0].Value
		services.Items = append(services.Items, str("versionHistory"))
		input.Members = append(input.Members, member("restores", jsjson.NewBool(true)))
	}
	return e.contract(ctx, input)
}

func (e *Executor) contract(ctx context.Context, input *jsjson.Node) (string, error) {
	answer, err := e.invoke(ctx, "manifest", input)
	if err != nil {
		return "", err
	}
	output, err := parse(answer)
	if err != nil {
		return "", err
	}
	contract, err := get(output, "contract")
	if err != nil {
		return "", err
	}
	if contract == nil {
		return "", noAnswer("agent contract")
	}
	return write(contract)
}

// ExecuteInRoom runs a batch on a live room. Without Rooms it answers
// COMMAND_UNAVAILABLE and never runs the bundle.
func (e *Executor) ExecuteInRoom(ctx context.Context, docID, batchJSON string, actor Actor, options *Options) (Execution, error) {
	if docID == "" {
		return Execution{}, &ArgumentError{Param: "docId", Message: "The value cannot be an empty string."}
	}
	if e.rooms == nil {
		return unavailable("Live rooms need collaboration on this server.")
	}
	return e.rooms.ExecuteInRoom(ctx, docID, batchJSON, actor, options)
}

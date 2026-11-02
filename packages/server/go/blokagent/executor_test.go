package blokagent

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/blokdocs"
)

// C# BlokAgentExecutorTests.FactoryForwardsPoolAndStartupConstraints. Go's
// zero means the default, so a pool below its floor is a negative size.
func TestNewRefusesLimitsBelowTheirFloorsBeforeLoading(t *testing.T) {
	for _, row := range []struct {
		param   string
		options FactoryOptions
	}{
		{"PoolSize", FactoryOptions{PoolSize: -1}},
		{"Timeout", FactoryOptions{PoolSize: 1, Timeout: time.Millisecond}},
		{"MemoryBudget", FactoryOptions{PoolSize: 1, MemoryBudget: 1024}},
	} {
		var constraint *blokdocs.ConstraintError
		if _, err := New(row.options); !errors.As(err, &constraint) || constraint.Param != row.param {
			t.Errorf("%s: err = %v", row.param, err)
		}
	}
}

type fakeRooms struct {
	history bool
	calls   []string
}

func (f *fakeRooms) ExecuteInRoom(_ context.Context, docID, batchJSON string, _ Actor, _ *Options) (Execution, error) {
	f.calls = append(f.calls, docID+" "+batchJSON)
	return Execution{ResultJSON: `{"ok":true}`, Revision: "lin:1"}, nil
}

func (f *fakeRooms) HasHistory() bool { return f.history }

// The room seam: a Rooms runner takes ExecuteInRoom, and its history adds
// versionHistory and restores to the room contract, as C# RoomCommon does
// (BlokAgentExecutor.cs:1205-1219: services gets versionHistory last, then
// restores after runtime).
func TestRoomsPlugIntoExecuteInRoomAndTheRoomContract(t *testing.T) {
	ctx := context.Background()
	runtime := &recordingRuntime{answer: `{"contract":{}}`}
	rooms := &fakeRooms{history: true}
	executor := newExecutor(runtime)
	executor.rooms = rooms

	execution, err := executor.ExecuteInRoom(ctx, "doc", `{"commands":[]}`, Actor{ID: "a", Name: "A"}, nil)
	if err != nil || execution.Revision != "lin:1" || len(rooms.calls) != 1 || rooms.calls[0] != `doc {"commands":[]}` {
		t.Fatalf("execution %+v, err %v, calls %v", execution, err, rooms.calls)
	}
	if _, err := executor.RoomContract(ctx, nil); err != nil {
		t.Fatal(err)
	}
	if want := `{"services":["versionHistory"],"runtime":"csharp-live","restores":true}`; runtime.input != want {
		t.Fatalf("room contract input %s, want %s", runtime.input, want)
	}
}

type recordingRuntime struct {
	answer string
	input  string
}

func (r *recordingRuntime) Invoke(_ context.Context, _, input string, _ time.Duration) (string, error) {
	r.input = input
	return r.answer, nil
}

// An Executor is shared by every request, so calls on it may overlap; each
// one must answer as if it ran alone. Run with -race.
func TestConcurrentCallsAnswerAsTheyDoAlone(t *testing.T) {
	executor, err := New(FactoryOptions{PoolSize: 2})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	document := `{"blocks":[{"id":"p","type":"paragraph","data":{"text":"Hi"}}]}`
	batch := `{"commands":[{"name":"block.update","args":{"id":"p","data":{"text":"Bye"}}}]}`
	actor := Actor{ID: "a", Name: "A"}
	alone, err := executor.Execute(ctx, document, batch, actor, nil)
	if err != nil || alone.DocumentJSON == nil {
		t.Fatalf("alone %+v, err %v", alone, err)
	}
	const calls = 6
	answers := make(chan string, calls)
	failures := make(chan error, calls)
	for range calls {
		go func() {
			session := executor.OpenSession(actor, nil)
			execution, err := session.Execute(ctx, document, batch)
			if err != nil {
				failures <- err
				return
			}
			undo, err := session.Execute(ctx, *execution.DocumentJSON, `{"commands":[{"name":"history.undo","args":{}}]}`)
			if err != nil {
				failures <- err
				return
			}
			answers <- untimed(*execution.DocumentJSON) + "\n" + undo.ResultJSON
		}()
	}
	var first string
	for range calls {
		select {
		case err := <-failures:
			t.Fatal(err)
		case answer := <-answers:
			if first == "" {
				first = answer
			} else if answer != first {
				t.Fatalf("answers differ:\n%s\n%s", first, answer)
			}
		}
	}
	if saved, _, _ := strings.Cut(first, "\n"); saved != untimed(*alone.DocumentJSON) {
		t.Fatalf("concurrent document %s, alone %s", saved, *alone.DocumentJSON)
	}
}

// untimed drops the edit time, the one field that differs between calls.
func untimed(document string) string {
	return regexp.MustCompile(`"lastEditedAt":\d+,`).ReplaceAllString(document, "")
}

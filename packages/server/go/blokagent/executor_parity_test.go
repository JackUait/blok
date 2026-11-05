package blokagent

import (
	"context"
	"strings"
	"testing"
	"time"
)

// Twins of C# BlokAgentExecutorTests and BlokAgentPageCreateTests cases that
// no scenario file holds.

const (
	exDocument   = `{"blocks":[{"id":"p","type":"paragraph","data":{"text":"Hello world"}}]}`
	exNormalized = `{"blocks":[{"id":"p","type":"paragraph","data":{"text":[{"text":"Hello world"}]}}]}`
	exRead       = `{"commands":[{"name":"doc.read","args":{"detail":"full"}}]}`
	exSuccess    = `{"result":{"ok":true,"revision":"h41","results":[{}],"refs":{},"changed":{"created":[],"updated":["p"],"moved":[],"removed":[]},"warnings":[]},
"document":{"blocks":[{"id":"p","type":"paragraph","data":{"text":[{"text":"Hello"}]}}]},"edits":[]}`
	exContract = `{"manifest":{"formatVersion":1,"revision":"h10","blokVersion":"fixture","readOnly":false,"defaultBlock":"paragraph","blocks":[],"inlineTools":[],"tunes":[]},
"contract":{"formatVersion":1,"revision":"h11","commands":[],"manifest":{"formatVersion":1,"revision":"h10","blokVersion":"fixture","readOnly":false,"defaultBlock":"paragraph","blocks":[],"inlineTools":[],"tunes":[]},"guidance":{"general":"","commands":{},"tools":{}}}}`
)

// exCalls answers every call with one fixed output and keeps them all.
type exCalls struct {
	answer string
	calls  []paCall
}

func (r *exCalls) Invoke(_ context.Context, op, input string, _ *time.Duration) (string, error) {
	r.calls = append(r.calls, paCall{op, input})
	return r.answer, nil
}

// exNoPages counts every page backend call.
type exNoPages struct{ calls int }

func (p *exNoPages) Resolve(context.Context, string, Actor) (PageLocation, error) {
	p.calls++
	return nil, nil
}

func TestFailedStoredBatchReturnsNothingToSaveAndLeavesNoPartialWireWrites(t *testing.T) {
	runtime := &paObserving{inner: sharedExecutor(t).runtime}
	execution := paRun(t, newExecutor(runtime), exNormalized,
		`{"commands":[{"name":"doc.setTitle","args":{"title":"Never written"}},{"name":"block.delete","args":{"id":"missing"}}]}`, nil)
	if execution.DocumentJSON != nil || len(runtime.calls) == 0 {
		t.Fatalf("document saved, or %d calls", len(runtime.calls))
	}
	output := runtime.output
	wire := mustParse(t, output)
	if !deepEquals(mustParse(t, exNormalized), lookup(wire, "document")) || stable(t, lookup(wire, "edits")) != "[]" {
		t.Fatalf("wire %s", output)
	}
	result := mustParse(t, execution.ResultJSON)
	failure := lookup(result, "error")
	if paString(t, failure, "code") != "BLOCK_NOT_FOUND" || stable(t, lookup(failure, "commandIndex")) != "1" ||
		stable(t, lookup(result, "ok")) != "false" || paString(t, result, "revision") != execution.Revision ||
		!deepEquals(result, lookup(wire, "result")) {
		t.Fatalf("result %s", execution.ResultJSON)
	}
}

func TestAPlainCallRefusesHistoryAndHasNothingToSave(t *testing.T) {
	for _, name := range []string{"history.undo", "history.redo"} {
		execution := paRun(t, sharedExecutor(t), exDocument, `{"commands":[{"name":"`+name+`","args":{}}]}`, nil)
		result := mustParse(t, execution.ResultJSON)
		failure := lookup(result, "error")
		if execution.DocumentJSON != nil || paString(t, failure, "code") != "COMMAND_UNAVAILABLE" ||
			paString(t, lookup(failure, "details"), "reason") != "runtime" || stable(t, lookup(result, "ok")) != "false" ||
			stable(t, lookup(failure, "retryable")) != "false" || strings.TrimSpace(paString(t, failure, "message")) == "" ||
			stable(t, lookup(result, "warnings")) != "[]" || paString(t, result, "revision") != execution.Revision {
			t.Fatalf("%s: %s", name, execution.ResultJSON)
		}
	}
}

func TestDeclaresPageBackendOnlyWithBothOptInsForEachWireOperation(t *testing.T) {
	for _, operation := range []string{"manifest", "agentExecute"} {
		for _, row := range []struct{ titles, target bool }{{false, false}, {true, false}, {false, true}, {true, true}} {
			answer := exSuccess
			if operation == "manifest" {
				answer = exContract
			}
			runtime := &exCalls{answer: answer}
			executor := newExecutor(runtime)
			pages := &exNoPages{}
			options := &Options{PageTitles: row.titles}
			if row.target {
				options.PageTarget = pages
			}
			var err error
			if operation == "manifest" {
				_, err = executor.Contract(context.Background(), options)
			} else {
				_, err = executor.Execute(context.Background(), exDocument, exRead, paActor, options)
			}
			if err != nil {
				t.Fatal(err)
			}
			want := "[]"
			if row.titles && row.target {
				want = `["pageBackend"]`
			}
			if len(runtime.calls) != 1 || runtime.calls[0].op != operation ||
				stable(t, lookup(mustParse(t, runtime.calls[0].input), "services")) != want || pages.calls != 0 {
				t.Fatalf("%s %+v: calls %+v, pages %d", operation, row, runtime.calls, pages.calls)
			}
		}
	}
}

func TestOverridesHideToolsAndActionsInTheEmbeddedContractAndRefuseExecution(t *testing.T) {
	executor := sharedExecutor(t)
	contract := func(options *Options) (commands, blocks []string) {
		text, err := executor.Contract(context.Background(), options)
		if err != nil {
			t.Fatal(err)
		}
		node := mustParse(t, text)
		for _, command := range lookup(node, "commands").Items {
			if paString(t, command, "name") == "column_list.create" && stable(t, lookup(command, "available")) == "true" {
				commands = append(commands, "column_list.create")
			}
		}
		for _, block := range lookup(lookup(node, "manifest"), "blocks").Items {
			blocks = append(blocks, paString(t, block, "name"))
		}
		return commands, blocks
	}
	commands, blocks := contract(nil)
	if len(commands) != 1 || !strings.Contains(","+strings.Join(blocks, ",")+",", ",spacer,") {
		t.Fatalf("baseline commands %v, blocks %v", commands, blocks)
	}
	overrides := `{"spacer":{"hidden":true},"column_list":{"hiddenActions":["create"],"guidance":"Use the host layout."}}`
	options := &Options{OverridesJSON: &overrides}
	commands, blocks = contract(options)
	if len(commands) != 0 || strings.Contains(","+strings.Join(blocks, ",")+",", ",spacer,") {
		t.Fatalf("overridden commands %v, blocks %v", commands, blocks)
	}
	for _, row := range []struct{ batch, code string }{
		{`{"commands":[{"name":"block.insert","args":{"type":"spacer","data":{}}}]}`, "UNKNOWN_TOOL"},
		{`{"commands":[{"name":"column_list.create","args":{"count":2}}]}`, "UNKNOWN_COMMAND"},
	} {
		execution := paRun(t, executor, exDocument, row.batch, options)
		if execution.DocumentJSON != nil || paString(t, lookup(mustParse(t, execution.ResultJSON), "error"), "code") != row.code {
			t.Fatalf("%s: %s", row.code, execution.ResultJSON)
		}
	}
}

func TestTheEmbeddedContractRevisionReflectsOnlyTheTwoPartPageOptIn(t *testing.T) {
	executor := sharedExecutor(t)
	revision := func(options *Options) string {
		text, err := executor.Contract(context.Background(), options)
		if err != nil {
			t.Fatal(err)
		}
		return paString(t, mustParse(t, text), "revision")
	}
	original := revision(nil)
	for _, row := range []struct{ titles, target bool }{{false, false}, {true, false}, {false, true}, {true, true}} {
		pages := &exNoPages{}
		options := &Options{PageTitles: row.titles}
		if row.target {
			options.PageTarget = pages
		}
		if changed := revision(options) != original; changed != (row.titles && row.target) || pages.calls != 0 {
			t.Fatalf("%+v: changed %v, page calls %d", row, changed, pages.calls)
		}
	}
}

// exCreator creates pages; it only counts resolves.
type exCreator struct{ exNoPages }

func (c *exCreator) Create(context.Context, Actor) (string, error) { return "host-1", nil }

func TestRefusesToDeleteALockedDatabase(t *testing.T) {
	locked := `{"blocks":[{"id":"D","type":"database","data":{"schema":[{"id":"dt","name":"Name","type":"title","position":"a0","databaseLocked":true}],"views":[{"id":"v","name":"Table","type":"table","position":"a0"}],"activeViewId":"v"}}]}`
	execution := paRun(t, sharedExecutor(t), locked, `{"commands":[{"name":"block.delete","args":{"id":"D"}}]}`,
		&Options{PageTitles: true, PageTarget: &exCreator{}})
	if execution.DocumentJSON != nil || paString(t, lookup(mustParse(t, execution.ResultJSON), "error"), "code") != "PRECONDITION_FAILED" {
		t.Fatalf("result %s", execution.ResultJSON)
	}
}

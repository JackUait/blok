package blokagent

import (
	"context"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// Twins of C# BlokAgentPageActionTests cases that no scenario file holds.

const (
	paSource = `{"id":"source","title":"Source title","blocks":[{"id":"pg","type":"page","data":{"pageId":"page-2"}}]}`
	paTarget = `{"id":"target","title":"Target title","icon":{"type":"emoji","value":"old"},"blocks":[{"id":"body","type":"paragraph","data":{"text":[{"text":"Keep this content"}]}}]}`
	paRename = `{"commands":[{"name":"page.rename","args":{"id":"pg","title":"Roadmap"}}]}`
)

var paActor = Actor{ID: "agent-cs", Name: "Server agent"}

type paPages struct {
	mu     sync.Mutex
	events []string
	saved  []string
}

func (p *paPages) Resolve(_ context.Context, pageID string, _ Actor) (PageLocation, error) {
	p.mu.Lock()
	p.events = append(p.events, "resolve:"+pageID)
	p.mu.Unlock()
	if pageID != "page-2" {
		return nil, nil
	}
	return StoredPage{
		Load: func(context.Context) (string, error) {
			p.mu.Lock()
			defer p.mu.Unlock()
			p.events = append(p.events, "load")
			return paTarget, nil
		},
		Save: func(_ context.Context, documentJSON string) error {
			p.mu.Lock()
			defer p.mu.Unlock()
			p.events = append(p.events, "save")
			p.saved = append(p.saved, documentJSON)
			return nil
		},
	}, nil
}

type paCall struct{ op, input string }

// paObserving is the shared pool with every call kept.
type paObserving struct {
	inner invoker
	mu    sync.Mutex
	calls []paCall
	// output is the last answer.
	output string
}

func (o *paObserving) Invoke(ctx context.Context, op, input string, timeout *time.Duration) (string, error) {
	output, err := o.inner.Invoke(ctx, op, input, timeout)
	o.mu.Lock()
	defer o.mu.Unlock()
	o.calls = append(o.calls, paCall{op, input})
	o.output = output
	return output, err
}

func paOptions(pages *paPages) *Options { return &Options{PageTitles: true, PageTarget: pages} }

func paRevision(t *testing.T, executor *Executor, document string) string {
	t.Helper()
	execution, err := executor.Execute(context.Background(), document, `{"commands":[{"name":"doc.read","args":{"detail":"full"}}]}`, paActor, nil)
	if err != nil {
		t.Fatal(err)
	}
	result := mustParse(t, execution.ResultJSON)
	if revision, _ := stringOf(lookup(result, "revision")); revision != execution.Revision || !regexp.MustCompile(`^h[0-9a-f]+$`).MatchString(revision) {
		t.Fatalf("revision %q in %s", execution.Revision, execution.ResultJSON)
	}
	return execution.Revision
}

func paRun(t *testing.T, executor *Executor, document, batch string, options *Options) Execution {
	t.Helper()
	execution, err := executor.Execute(context.Background(), document, batch, paActor, options)
	if err != nil {
		t.Fatal(err)
	}
	return execution
}

// paFailure is C# AssertSourceFailure; it returns the error object.
func paFailure(t *testing.T, execution Execution, revision, code string, retryable bool) *jsjson.Node {
	t.Helper()
	if execution.DocumentJSON != nil || execution.Revision != revision {
		t.Fatalf("document %v, revision %q, want %q", execution.DocumentJSON != nil, execution.Revision, revision)
	}
	result := mustParse(t, execution.ResultJSON)
	got, _ := stringOf(lookup(result, "revision"))
	if stable(t, lookup(result, "ok")) != "false" || got != revision || stable(t, lookup(result, "warnings")) != "[]" ||
		lookup(result, "results") != nil || lookup(result, "refs") != nil || lookup(result, "changed") != nil {
		t.Fatalf("result %s", execution.ResultJSON)
	}
	failure := lookup(result, "error")
	message, _ := stringOf(lookup(failure, "message"))
	if c, _ := stringOf(lookup(failure, "code")); c != code || stable(t, lookup(failure, "retryable")) != map[bool]string{true: "true", false: "false"}[retryable] || strings.TrimSpace(message) == "" {
		t.Fatalf("error %s, want %s", stable(t, failure), code)
	}
	return failure
}

func paNoBackend(t *testing.T, pages *paPages) {
	t.Helper()
	if len(pages.events) != 0 || len(pages.saved) != 0 {
		t.Fatalf("backend called: %v", pages.events)
	}
}

func paString(t *testing.T, node *jsjson.Node, key string) string {
	t.Helper()
	value, _ := stringOf(lookup(node, key))
	return value
}

func TestSetsOrClearsTheStoredTargetIconWithoutChangingTheSource(t *testing.T) {
	for _, icon := range []string{`{"type":"emoji","value":"🚀"}`, `{"type":"image","url":"https://example.com/icon.png"}`, `null`} {
		runtime := &paObserving{inner: sharedExecutor(t).runtime}
		executor := newExecutor(runtime)
		pages := &paPages{}
		revision := paRevision(t, executor, paSource)
		runtime.calls = nil
		batch := `{"commands":[{"name":"page.setIcon","args":{"id":"pg","icon":` + icon + `}}],"expectRevision":"` + revision + `"}`
		execution := paRun(t, executor, paSource, batch, paOptions(pages))
		if len(pages.saved) != 1 {
			t.Fatalf("%s: saved %d", icon, len(pages.saved))
		}
		saved := mustParse(t, pages.saved[0])
		if icon == "null" {
			if lookup(saved, "icon") != nil {
				t.Fatalf("icon kept: %s", pages.saved[0])
			}
		} else if !deepEquals(mustParse(t, icon), lookup(saved, "icon")) {
			t.Fatalf("%s: saved %s", icon, pages.saved[0])
		}
		if paString(t, saved, "title") != "Target title" || !deepEquals(lookup(mustParse(t, paTarget), "blocks"), lookup(saved, "blocks")) {
			t.Fatalf("%s: saved %s", icon, pages.saved[0])
		}
		if !slices.Equal(pages.events, []string{"resolve:page-2", "load", "save"}) {
			t.Fatalf("%s: events %v", icon, pages.events)
		}
		want := mustParse(t, `{"ok":true,"results":[{"pageId":"page-2","applied":true}],"refs":{},"changed":{"created":[],"updated":[],"moved":[],"removed":[]},"warnings":[],"revision":"`+revision+`"}`)
		if execution.DocumentJSON != nil || execution.Revision != revision || !deepEquals(want, mustParse(t, execution.ResultJSON)) {
			t.Fatalf("%s: result %s", icon, execution.ResultJSON)
		}
		var writes []*jsjson.Node
		for _, call := range runtime.calls {
			if call.op != "agentExecute" {
				continue
			}
			input := mustParse(t, call.input)
			for _, command := range lookup(lookup(input, "batch"), "commands").Items {
				switch paString(t, command, "name") {
				case "page.rename", "page.setIcon":
					t.Fatalf("the bundle ran the page action: %s", call.input)
				case "doc.setIcon":
					if paString(t, lookup(input, "document"), "id") == "target" {
						writes = append(writes, lookup(input, "batch"))
					}
				}
			}
		}
		if len(writes) != 1 || len(lookup(writes[0], "commands").Items) != 1 ||
			!deepEquals(mustParse(t, `{"icon":`+icon+`}`), lookup(lookup(writes[0], "commands").Items[0], "args")) {
			t.Fatalf("%s: %d target writes", icon, len(writes))
		}
		if paRevision(t, executor, pages.saved[0]) == execution.Revision {
			t.Fatalf("%s: the target kept the source revision", icon)
		}
	}
}

func TestRequiresBothPageOptInsBeforeAnyBackendCall(t *testing.T) {
	executor := sharedExecutor(t)
	revision := paRevision(t, executor, paSource)
	for _, name := range []string{"page.rename", "page.setIcon"} {
		for _, row := range []struct{ titles, target bool }{{false, false}, {true, false}, {false, true}} {
			pages := &paPages{}
			options := &Options{PageTitles: row.titles}
			if row.target {
				options.PageTarget = pages
			}
			args := `{"id":"pg","title":"Roadmap"}`
			if name == "page.setIcon" {
				args = `{"id":"pg","icon":null}`
			}
			execution := paRun(t, executor, paSource, `{"commands":[{"name":"`+name+`","args":`+args+`}]}`, options)
			paNoBackend(t, pages)
			failure := paFailure(t, execution, revision, "COMMAND_UNAVAILABLE", false)
			details := lookup(failure, "details")
			if stable(t, lookup(failure, "commandIndex")) != "0" || paString(t, failure, "path") != "/commands/0/name" ||
				paString(t, details, "reason") != "service" || stable(t, lookup(details, "requires")) != `["pageBackend"]` {
				t.Fatalf("%s %+v: %s", name, row, stable(t, failure))
			}
			contract, err := executor.Contract(context.Background(), options)
			if err != nil {
				t.Fatal(err)
			}
			var found *jsjson.Node
			for _, entry := range lookup(mustParse(t, contract), "commands").Items {
				if paString(t, entry, "name") == name {
					found = entry
				}
			}
			if found == nil || stable(t, lookup(found, "available")) != "false" || paString(t, found, "unavailableReason") != "service" {
				t.Fatalf("%s %+v: contract entry %s", name, row, stable(t, found))
			}
			paNoBackend(t, pages)
		}
	}
}

func TestRejectsAStaleSourceBeforeResolvingOrLoadingTheTarget(t *testing.T) {
	executor := sharedExecutor(t)
	pages := &paPages{}
	revision := paRevision(t, executor, paSource)
	batch := `{"commands":[{"name":"page.rename","args":{"id":"pg","title":"Roadmap"}}],"expectRevision":"not-the-source-revision"}`
	execution := paRun(t, executor, paSource, batch, paOptions(pages))
	paNoBackend(t, pages)
	details := lookup(paFailure(t, execution, revision, "STALE", true), "details")
	if paString(t, details, "revision") != revision || !deepEquals(mustParse(t, `[{"id":"pg","type":"page"}]`), lookup(details, "current")) {
		t.Fatalf("details %s", stable(t, details))
	}
}

func TestValidatesTheOriginalEnvelopeBeforeBackendWork(t *testing.T) {
	executor := sharedExecutor(t)
	revision := paRevision(t, executor, paSource)
	for _, row := range []struct{ batch, path string }{
		{`{"commands":[{"name":"page.rename","args":{"id":"pg","title":"Roadmap"},"ref":1}]}`, "/commands/0"},
		{`{"expectRevision":1,"commands":[{"name":"page.rename","args":{"id":"pg","title":"Roadmap"}}]}`, "/expectRevision"},
		{`{"commands":[{"name":"page.rename","args":{"id":"pg","title":"Roadmap"},"ref":"created"}]}`, "/commands/0/ref"},
	} {
		pages := &paPages{}
		execution := paRun(t, executor, paSource, row.batch, paOptions(pages))
		paNoBackend(t, pages)
		if got := paString(t, paFailure(t, execution, revision, "INVALID_ARGS", false), "path"); got != row.path {
			t.Fatalf("%s: path %q, want %q", row.batch, got, row.path)
		}
	}
}

func TestRejectsMalformedActionArgsBeforeBackendWork(t *testing.T) {
	executor := sharedExecutor(t)
	revision := paRevision(t, executor, paSource)
	for _, command := range []string{
		`{"name":"page.rename","args":{"title":"Roadmap"}}`,
		`{"name":"page.rename","args":{"id":"pg"}}`,
		`{"name":"page.rename","args":{"id":"pg","title":7}}`,
		`{"name":"page.rename","args":{"id":"pg","title":"Roadmap","extra":true}}`,
		`{"name":"page.setIcon","args":{"id":"pg"}}`,
		`{"name":"page.setIcon","args":{"id":"pg","icon":"🚀"}}`,
	} {
		pages := &paPages{}
		execution := paRun(t, executor, paSource, `{"commands":[`+command+`]}`, paOptions(pages))
		paNoBackend(t, pages)
		failure := paFailure(t, execution, revision, "INVALID_ARGS", false)
		if stable(t, lookup(failure, "commandIndex")) != "0" || !strings.HasPrefix(paString(t, failure, "path"), "/commands/0/args") {
			t.Fatalf("%s: %s", command, stable(t, failure))
		}
	}
}

func TestHonorsTheSourceContractOverridesBeforeBackendWork(t *testing.T) {
	executor := sharedExecutor(t)
	revision := paRevision(t, executor, paSource)
	for _, overrides := range []string{`{"page":{"hidden":true}}`, `{"page":{"hiddenActions":["rename"]}}`} {
		pages := &paPages{}
		options := paOptions(pages)
		options.OverridesJSON = &overrides
		execution := paRun(t, executor, paSource, paRename, options)
		paNoBackend(t, pages)
		failure := paFailure(t, execution, revision, "UNKNOWN_COMMAND", false)
		if stable(t, lookup(failure, "commandIndex")) != "0" || paString(t, failure, "path") != "/commands/0/name" {
			t.Fatalf("%s: %s", overrides, stable(t, failure))
		}
	}
}

func TestRefusesAMatchingPageIDOnTheWrongSourceToolOrAMissingBlockBeforeBackendWork(t *testing.T) {
	executor := sharedExecutor(t)
	for _, row := range []struct{ source, code string }{
		{`{"blocks":[{"id":"pg","type":"paragraph","data":{"text":[{"text":"Not a page"}],"pageId":"page-2"}}]}`, "INVALID_ARGS"},
		{`{"blocks":[]}`, "BLOCK_NOT_FOUND"},
	} {
		pages := &paPages{}
		revision := paRevision(t, executor, row.source)
		execution := paRun(t, executor, row.source, paRename, paOptions(pages))
		paNoBackend(t, pages)
		failure := paFailure(t, execution, revision, row.code, false)
		if stable(t, lookup(failure, "commandIndex")) != "0" || paString(t, failure, "path") != "/commands/0/args/id" {
			t.Fatalf("%s: %s", row.code, stable(t, failure))
		}
	}
}

func TestRefusesARoomSourceWithoutCallingTheStoredRuntimeOrPageBackend(t *testing.T) {
	runtime := &paObserving{inner: sharedExecutor(t).runtime}
	pages := &paPages{}
	execution, err := newExecutor(runtime).ExecuteInRoom(context.Background(), "source-room", paRename, paActor, paOptions(pages))
	if err != nil {
		t.Fatal(err)
	}
	paNoBackend(t, pages)
	if len(runtime.calls) != 0 || execution.DocumentJSON != nil || execution.Revision != "" {
		t.Fatalf("calls %d, execution %+v", len(runtime.calls), execution)
	}
	result := mustParse(t, execution.ResultJSON)
	failure := lookup(result, "error")
	if stable(t, lookup(result, "ok")) != "false" || lookup(result, "revision") != nil || stable(t, lookup(result, "warnings")) != "[]" ||
		paString(t, failure, "code") != "COMMAND_UNAVAILABLE" || stable(t, lookup(failure, "retryable")) != "false" ||
		strings.TrimSpace(paString(t, failure, "message")) == "" || paString(t, lookup(failure, "details"), "reason") != "runtime" {
		t.Fatalf("result %s", execution.ResultJSON)
	}
}

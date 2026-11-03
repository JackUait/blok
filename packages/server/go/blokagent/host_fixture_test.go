package blokagent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
	"unicode/utf16"

	"github.com/JackUait/blok/packages/server/go/blokdocs"
	"github.com/JackUait/blok/packages/server/go/internal/jsruntime"
)

// The repo root, from this package's directory.
const repoRoot = "../../../.."

// Longer strings are pinned by length and hash, as AgentHostFixtureTests does.
const maxInline = 65536

type hostCase struct {
	Name      string            `json:"name"`
	Call      string            `json:"call"`
	Actor     fixtureActor      `json:"actor"`
	Options   *fixtureOptions   `json:"options"`
	Host      fixtureHost       `json:"host"`
	Cancelled bool              `json:"cancelled"`
	Calls     []json.RawMessage `json:"calls"`
	Runtime   []runtimeStep     `json:"runtime"`
	Events    []any             `json:"events"`
	Results   []any             `json:"results"`
}

type fixtureActor struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	OnBehalfOf *string `json:"onBehalfOf"`
}

type fixtureOptions struct {
	PageTitles      bool    `json:"pageTitles"`
	Target          string  `json:"target"`
	CustomTools     *string `json:"customTools"`
	Overrides       *string `json:"overrides"`
	BuiltInComments *bool   `json:"builtInComments"`
}

type fixtureHost struct {
	Pages    map[string]map[string]json.RawMessage `json:"pages"`
	Create   []*string                             `json:"create"`
	CancelOn string                                `json:"cancelOn"`
	ThrowOn  map[string]string                     `json:"throwOn"`
}

type runtimeStep struct {
	Answer      json.RawMessage `json:"answer"`
	Throw       string          `json:"throw"`
	CancelAfter bool            `json:"cancelAfter"`
}

type fixtureCall struct {
	Document json.RawMessage `json:"document"`
	Batch    json.RawMessage `json:"batch"`
	DocID    string          `json:"docId"`
}

// scripted reads a fixture string: text, or {template, fill:[{marker, unit, count}]}.
func scripted(t *testing.T, raw json.RawMessage) string {
	t.Helper()
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	var spec struct {
		Template string `json:"template"`
		Fill     []struct {
			Marker string `json:"marker"`
			Unit   string `json:"unit"`
			Count  int    `json:"count"`
		} `json:"fill"`
	}
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatalf("scripted string: %v", err)
	}
	text = spec.Template
	for _, fill := range spec.Fill {
		text = strings.ReplaceAll(text, fill.Marker, strings.Repeat(fill.Unit, fill.Count))
	}
	return text
}

func pinned(text *string) any {
	if text == nil {
		return nil
	}
	length := len(utf16.Encode([]rune(*text)))
	if length <= maxInline {
		return *text
	}
	sum := sha256.Sum256([]byte(*text))
	return map[string]any{"length": float64(length), "sha256": hex.EncodeToString(sum[:])}
}

type recorder struct {
	t      *testing.T
	events []any
	cancel context.CancelFunc
	// What the scripted host and runtime throw for "cancel".
	cancelErr error
	host      fixtureHost
	creates   int
}

var errHostFailure = errors.New("The host's page store is down.")

func (r *recorder) hook(name string) error {
	if r.host.CancelOn == name {
		r.cancel()
	}
	switch r.host.ThrowOn[name] {
	case "cancel":
		return r.cancelErr
	case "error":
		return errHostFailure
	}
	return nil
}

func actorEvent(actor Actor) map[string]any {
	var onBehalfOf any
	if actor.OnBehalfOf != nil {
		onBehalfOf = *actor.OnBehalfOf
	}
	return map[string]any{"id": actor.ID, "name": actor.Name, "onBehalfOf": onBehalfOf}
}

type fixtureTarget struct{ r *recorder }

func (f fixtureTarget) Resolve(_ context.Context, pageID string, actor Actor) (PageLocation, error) {
	r := f.r
	r.events = append(r.events, map[string]any{"host": "resolve", "pageId": pageID, "actor": actorEvent(actor)})
	if err := r.hook("resolve"); err != nil {
		return nil, err
	}
	page := r.host.Pages[pageID]
	if stored, ok := page["stored"]; ok {
		return StoredPage{
			Load: func(context.Context) (string, error) {
				r.events = append(r.events, map[string]any{"host": "load"})
				if err := r.hook("load"); err != nil {
					return "", err
				}
				return scripted(r.t, stored), nil
			},
			Save: func(_ context.Context, document string) error {
				r.events = append(r.events, map[string]any{"host": "save", "document": pinned(&document)})
				return r.hook("save")
			},
		}, nil
	}
	if room, ok := page["room"]; ok {
		return RoomPage{DocID: scripted(r.t, room)}, nil
	}
	return nil, nil
}

type fixtureCreator struct{ fixtureTarget }

func (f fixtureCreator) Create(_ context.Context, actor Actor) (string, error) {
	r := f.r
	at := r.creates
	r.creates++
	r.events = append(r.events, map[string]any{"host": "create", "actor": actorEvent(actor)})
	if err := r.hook(fmt.Sprintf("create:%d", at)); err != nil {
		return "", err
	}
	if at < len(r.host.Create) {
		if r.host.Create[at] == nil {
			return "", nil
		}
		return *r.host.Create[at], nil
	}
	return fmt.Sprintf("host-%d", at+1), nil
}

// fixtureRuntime answers each call with the next scripted step.
type fixtureRuntime struct {
	r      *recorder
	script []runtimeStep
	next   int
}

func (f *fixtureRuntime) Invoke(ctx context.Context, op, input string, timeout time.Duration) (string, error) {
	f.r.events = append(f.r.events, map[string]any{"op": op, "input": pinned(&input)})
	if timeout != 0 {
		f.r.t.Errorf("%s: timeout %v, want the pool's", op, timeout)
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if f.next >= len(f.script) {
		f.r.t.Fatalf("no scripted answer for call %d (%s)", f.next+1, op)
	}
	step := f.script[f.next]
	f.next++
	switch step.Throw {
	case "":
	case "cancel":
		return "", f.r.cancelErr
	default:
		kinds := map[string]jsruntime.Kind{
			"Unknown":          jsruntime.KindUnknown,
			"InvalidDocument":  jsruntime.KindInvalidDocument,
			"TimedOut":         jsruntime.KindTimedOut,
			"DocumentTooLarge": jsruntime.KindDocumentTooLarge,
		}
		kind, ok := kinds[step.Throw]
		if !ok {
			f.r.t.Fatalf("unknown throw %s", step.Throw)
		}
		return "", &jsruntime.Failure{Kind: kind, Err: errors.New("fake runtime failure")}
	}
	if step.CancelAfter {
		f.r.cancel()
	}
	return scripted(f.r.t, step.Answer), nil
}

func errorShape(err, cancelErr error) map[string]any {
	var conversion *blokdocs.ConversionError
	var argument *ArgumentError
	var syntax *JSONError
	var invalid *InvalidOperationError
	switch {
	case errors.Is(err, cancelErr):
		return map[string]any{"error": map[string]any{"kind": "cancelled"}}
	case errors.As(err, &conversion):
		return map[string]any{"error": map[string]any{"kind": "conversion", "reason": conversion.Reason.String()}}
	case errors.Is(err, errHostFailure):
		return map[string]any{"error": map[string]any{"kind": "host"}}
	case errors.As(err, &argument):
		return map[string]any{"error": map[string]any{"kind": "argument", "param": argument.Param, "message": argument.Message}}
	case errors.As(err, &syntax):
		return map[string]any{"error": map[string]any{"kind": "json"}}
	case errors.As(err, &invalid):
		return map[string]any{"error": map[string]any{"kind": "invalidOperation", "message": invalid.Message}}
	}
	return map[string]any{"error": map[string]any{"kind": "unexpected", "message": err.Error()}}
}

func executionShape(execution Execution) map[string]any {
	return map[string]any{
		"result":   pinned(&execution.ResultJSON),
		"document": pinned(execution.DocumentJSON),
		"revision": execution.Revision,
	}
}

func runHostCase(t *testing.T, c hostCase, deadline bool) ([]any, []any) {
	var ctx context.Context
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var cancelErr error = context.Canceled
	if deadline {
		ctx = deadlineContext{ctx}
		cancelErr = context.DeadlineExceeded
	}
	r := &recorder{t: t, cancel: cancel, cancelErr: cancelErr, host: c.Host, events: []any{}}
	runtime := &fixtureRuntime{r: r, script: c.Runtime}
	executor := newExecutor(runtime)
	actor := Actor{ID: c.Actor.ID, Name: c.Actor.Name, OnBehalfOf: c.Actor.OnBehalfOf}

	var options *Options
	if c.Options != nil {
		options = &Options{
			PageTitles:      c.Options.PageTitles,
			CustomToolsJSON: c.Options.CustomTools,
			OverridesJSON:   c.Options.Overrides,
		}
		if c.Options.BuiltInComments != nil {
			options.DisableBuiltInComments = !*c.Options.BuiltInComments
		}
		switch c.Options.Target {
		case "":
		case "plain":
			options.PageTarget = fixtureTarget{r}
		case "creator":
			options.PageTarget = fixtureCreator{fixtureTarget{r}}
		default:
			t.Fatalf("unknown target %s", c.Options.Target)
		}
	}
	if c.Cancelled {
		cancel()
	}

	calls := c.Calls
	if calls == nil {
		calls = []json.RawMessage{json.RawMessage(`{}`)}
	}
	var session *Session
	if c.Call == "Session" {
		session = executor.OpenSession(actor, options)
	}
	results := []any{}
	for _, raw := range calls {
		var call fixtureCall
		if err := json.Unmarshal(raw, &call); err != nil {
			t.Fatal(err)
		}
		var execution Execution
		var contract string
		var err error
		switch c.Call {
		case "Execute":
			execution, err = executor.Execute(ctx, scripted(t, call.Document), scripted(t, call.Batch), actor, options)
		case "Session":
			execution, err = session.Execute(ctx, scripted(t, call.Document), scripted(t, call.Batch))
		case "ExecuteInRoom":
			execution, err = executor.ExecuteInRoom(ctx, call.DocID, scripted(t, call.Batch), actor, options)
		case "Contract":
			contract, err = executor.Contract(ctx, options)
		case "SessionContract":
			contract, err = executor.OpenSession(actor, options).Contract(ctx)
		case "RoomContract":
			contract, err = executor.RoomContract(ctx, options)
		default:
			t.Fatalf("unknown call %s", c.Call)
		}
		switch {
		case err != nil:
			results = append(results, errorShape(err, cancelErr))
		case strings.HasSuffix(c.Call, "Contract"):
			results = append(results, map[string]any{"contract": contract})
		default:
			results = append(results, executionShape(execution))
		}
	}
	if runtime.next != len(c.Runtime) {
		t.Errorf("the case scripts %d runtime answers, %d were asked for", len(c.Runtime), runtime.next)
	}
	return r.events, results
}

// normal turns Go values into what encoding/json decodes, so they compare
// with the fixture by reflect.DeepEqual.
func normal(t *testing.T, value any) any {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestMatchesTheSharedHostFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(repoRoot, "test/unit/server-conformance/fixtures/agent/host.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases []hostCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			events, results := runHostCase(t, c, false)
			if got, want := normal(t, events), normal(t, c.Events); !reflect.DeepEqual(got, want) {
				t.Errorf("events\n got %s\nwant %s", mustJSON(got), mustJSON(want))
			}
			if got, want := normal(t, results), normal(t, c.Results); !reflect.DeepEqual(got, want) {
				t.Errorf("results\n got %s\nwant %s", mustJSON(got), mustJSON(want))
			}
		})
	}
}

func mustJSON(value any) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

// deadlineContext reports a cancel as a passed deadline. blokagent derives
// no context of its own, so its Err is what the executor sees.
type deadlineContext struct{ context.Context }

func (c deadlineContext) Err() error {
	if c.Context.Err() != nil {
		return context.DeadlineExceeded
	}
	return nil
}

// C# has one cancel exception, a timeout included, so the fixture cannot
// tell a deadline from a cancel. Each cancel case is replayed with the
// caller's deadline passing instead, and must answer the same.
func TestACallerDeadlineAnswersAsACancel(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(repoRoot, "test/unit/server-conformance/fixtures/agent/host.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases []hostCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	stranded := 0
	for _, c := range cases {
		if !cancels(c) {
			continue
		}
		t.Run(c.Name, func(t *testing.T) {
			events, results := runHostCase(t, c, true)
			if got, want := normal(t, events), normal(t, c.Events); !reflect.DeepEqual(got, want) {
				t.Errorf("events\n got %s\nwant %s", mustJSON(got), mustJSON(want))
			}
			if got, want := normal(t, results), normal(t, c.Results); !reflect.DeepEqual(got, want) {
				t.Errorf("results\n got %s\nwant %s", mustJSON(got), mustJSON(want))
			}
		})
		if strings.Contains(mustJSON(c.Results), "ORPHANED_SIDE_EFFECT") {
			stranded++
		}
	}
	// A cancel after pages were made is where a deadline could turn into a
	// retryable APPLY_FAILED.
	if stranded == 0 {
		t.Fatal("no replayed case cancels after pages were made")
	}
}

func cancels(c hostCase) bool {
	if c.Cancelled || c.Host.CancelOn != "" {
		return true
	}
	for _, how := range c.Host.ThrowOn {
		if how == "cancel" {
			return true
		}
	}
	for _, step := range c.Runtime {
		if step.Throw == "cancel" || step.CancelAfter {
			return true
		}
	}
	return false
}

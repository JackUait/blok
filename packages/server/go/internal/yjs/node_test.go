package yjs

import (
	"bytes"
	"encoding/base64"
	"os"
	"os/exec"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/lib0"
	"github.com/JackUait/blok/packages/server/go/internal/yjs/yjstest"
)

// The engine → Node direction of the interop law (C# NodeReplay.cs): update
// bytes the engine wrote are applied by real yjs through
// scripts/replay-yjs-update.mjs, and yjs must render what the engine renders.
// Like C#, a missing node or yjs fails the test: CI installs both before the
// Go job runs.

type nodeReplayResult struct {
	json       any
	sv         []byte
	hasPending bool
	diff       []byte
}

func nodeReplay(t *testing.T, roots [][2]string, updates [][]byte, stateVectorFor []byte) nodeReplayResult {
	t.Helper()
	root, err := yjstest.RepoRoot()
	if err != nil {
		t.Fatal(err)
	}
	request := &jsjson.Object{}
	rootsJSON := &jsjson.Object{}
	for _, entry := range roots {
		rootsJSON.Set(s(entry[0]), s(entry[1]))
	}
	encoded := []any{}
	for _, update := range updates {
		encoded = append(encoded, s(base64.StdEncoding.EncodeToString(update)))
	}
	request.Set(s("roots"), rootsJSON)
	request.Set(s("updates"), encoded)
	if stateVectorFor == nil {
		request.Set(s("stateVectorFor"), nil)
	} else {
		request.Set(s("stateVectorFor"), s(base64.StdEncoding.EncodeToString(stateVectorFor)))
	}
	body, err := jsjson.Stringify(request)
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command("node", "scripts/replay-yjs-update.mjs")
	command.Dir = root
	command.Stdin = strings.NewReader(body)
	var stdout, stderr bytes.Buffer
	command.Stdout, command.Stderr = &stdout, &stderr
	command.WaitDelay = time.Second
	done := make(chan error, 1)
	if err := command.Start(); err != nil {
		t.Fatalf("could not start node: %v", err)
	}
	go func() { done <- command.Wait() }()
	select {
	case err = <-done:
	case <-time.After(30 * time.Second):
		_ = command.Process.Kill()
		t.Fatalf("node did not finish within 30s: %s", stderr.String())
	}
	if err != nil {
		t.Fatalf("node exited: %v: %s", err, stderr.String())
	}
	replay, err := jsjson.Parse(bytes.TrimSpace(stdout.Bytes()))
	if err != nil {
		t.Fatalf("the replay script printed %q: %v", stdout.String(), err)
	}
	result := nodeReplayResult{json: yjstest.Field(replay, "json")}
	if result.json == nil {
		t.Fatal("the replay script printed no json")
	}
	if result.sv, err = base64.StdEncoding.DecodeString(yjstest.String(replay, "sv")); err != nil || !yjstest.Has(replay, "sv") {
		t.Fatalf("the replay script printed no sv: %v", err)
	}
	pending, ok := yjstest.Field(replay, "hasPending").(bool)
	if !ok {
		t.Fatal("the replay script printed no hasPending")
	}
	result.hasPending = pending
	if diff, ok := yjstest.Field(replay, "diff").(jsjson.Str); ok {
		if result.diff, err = base64.StdEncoding.DecodeString(diff.String()); err != nil {
			t.Fatal(err)
		}
	}
	return result
}

// sameJSON compares the engine's render with what yjs rendered.
func sameJSON(t *testing.T, what string, engine, replayed any) {
	t.Helper()
	if got, want := canonical(t, engine), canonical(t, replayed); got != want {
		t.Fatalf("%s:\nengine %s\n   yjs %s", what, got, want)
	}
}

func mustState(t *testing.T, doc *Doc, target []byte) []byte {
	t.Helper()
	update, err := doc.EncodeStateAsUpdate(target)
	if err != nil {
		t.Fatal(err)
	}
	return update
}

func recordUpdates(doc *Doc) *[]UpdateEvent {
	events := &[]UpdateEvent{}
	doc.OnUpdate(func(event UpdateEvent) { *events = append(*events, event) })
	return events
}

func structsCase(t *testing.T, name string) ([]byte, [][2]string) {
	t.Helper()
	c := fixtureCase(t, "structs.json", name)
	return fixtureBytes(t, c, "update"), rootsOf(yjstest.Field(c, "roots"))
}

func TestNodeReplayAppliesAnEmptyUpdateAndReportsNoPending(t *testing.T) {
	result := nodeReplay(t, [][2]string{{"m", "map"}}, [][]byte{{0, 0}}, nil)
	if got := canonical(t, result.json); got != `{"m":{}}` {
		t.Fatal(got)
	}
	if !bytes.Equal(result.sv, []byte{0}) || result.hasPending || result.diff != nil {
		t.Fatalf("%+v", result)
	}
}

// The whole document as one update, as a joining peer receives it.
func TestDiffAgainstAnEmptyVectorReplaysIntoYjsWithIdenticalJSON(t *testing.T) {
	for _, c := range scenarios(t) {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			runner := newScenarioRunner(t, c)
			runner.runAll()
			replay := nodeReplay(t, c.roots, [][]byte{mustState(t, runner.doc, nil)}, nil)
			sameJSON(t, "json", render(t, runner.doc, c.roots), replay.json)
			if !bytes.Equal(runner.doc.EncodeStateVector(), replay.sv) || runner.doc.HasPending() != replay.hasPending {
				t.Fatalf("sv %x / %x, pending %v / %v", runner.doc.EncodeStateVector(), replay.sv, runner.doc.HasPending(), replay.hasPending)
			}
		})
	}
}

// A peer that stopped listening half way asks for the rest; its snapshot
// plus the diff must be the whole document.
func TestDiffAgainstAPeerVectorIsAcceptedByYjs(t *testing.T) {
	for _, c := range scenarios(t) {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			runner := newScenarioRunner(t, c)
			half := len(c.steps) / 2
			for _, step := range c.steps[:half] {
				runner.run(step)
			}
			atHalf := mustState(t, runner.doc, nil)
			peer := runner.doc.EncodeStateVector()
			for _, step := range c.steps[half:] {
				runner.run(step)
			}
			replay := nodeReplay(t, c.roots, [][]byte{atHalf, mustState(t, runner.doc, peer)}, nil)
			sameJSON(t, "json", render(t, runner.doc, c.roots), replay.json)
			if !bytes.Equal(runner.doc.EncodeStateVector(), replay.sv) {
				t.Fatalf("sv %x / %x", runner.doc.EncodeStateVector(), replay.sv)
			}
		})
	}
}

// A parked struct is still encodable, with a Skip naming the hole before it.
func TestPendingWithGapsEncodesSkipsReadableByYjs(t *testing.T) {
	c := scenarioNamed(t, "engine-writes-while-pending")
	runner := newScenarioRunner(t, c)
	for _, step := range c.steps[:len(c.steps)-2] {
		runner.run(step)
	}
	if !runner.doc.HasPending() {
		t.Fatal("nothing is pending")
	}
	pending := mustState(t, runner.doc, nil)
	skip := false
	for _, group := range mustDecode(t, pending).Groups {
		for _, d := range group.Structs {
			skip = skip || (group.Client == 1000 && d.Kind == KindSkip)
		}
	}
	if !skip {
		t.Fatal("client 1000 has no Skip")
	}
	replay := nodeReplay(t, c.roots, [][]byte{pending}, nil)
	if !replay.hasPending {
		t.Fatal("yjs parked nothing")
	}
	sameJSON(t, "pending json", render(t, runner.doc, c.roots), replay.json)
	closing := stepUpdate(t, c, "s2")
	applyBytes(t, runner.doc, closing)
	converged := nodeReplay(t, c.roots, [][]byte{pending, closing}, nil)
	if runner.doc.HasPending() || converged.hasPending {
		t.Fatalf("pending engine %v, yjs %v", runner.doc.HasPending(), converged.hasPending)
	}
	sameJSON(t, "converged json", render(t, runner.doc, c.roots), converged.json)
}

func TestTransactionEmitsOneUpdateThatReplaysIntoYjs(t *testing.T) {
	seed, roots := structsCase(t, "map-set-any")
	doc := docWithID(4242)
	applyBytes(t, doc, seed)
	events := recordUpdates(doc)
	written := doc.Transact(func(txn *Transaction) { doc.GetMap(s("m")).Set(txn, s("engine"), s("written")) })
	if len(*events) != 1 || !(*events)[0].Local || !bytes.Equal((*events)[0].Update, written) {
		t.Fatalf("%d events", len(*events))
	}
	sameJSON(t, "json", render(t, doc, roots), nodeReplay(t, roots, [][]byte{seed, written}, nil).json)
}

// An applied update is emitted as what the apply changed, not the whole doc.
func TestApplyEmitsTheAppliedChangeOnly(t *testing.T) {
	c := scenarioNamed(t, "out-of-order-delivery")
	doc := docWithID(4242)
	first, second := stepUpdate(t, c, "s1"), stepUpdate(t, c, "s2")
	applyBytes(t, doc, first)
	events := recordUpdates(doc)
	applyBytes(t, doc, second)
	if len(*events) != 1 || (*events)[0].Local {
		t.Fatalf("%+v", *events)
	}
	sameJSON(t, "json", render(t, doc, c.roots), nodeReplay(t, c.roots, [][]byte{first, (*events)[0].Update}, nil).json)
}

func TestNothingChangedEmitsNothing(t *testing.T) {
	c := scenarioNamed(t, "out-of-order-delivery")
	doc := docWithID(4242)
	update := stepUpdate(t, c, "s1")
	applyBytes(t, doc, update)
	events := recordUpdates(doc)
	applyBytes(t, doc, update)
	if len(*events) != 0 {
		t.Fatal("a duplicate apply emitted")
	}
	if doc.Transact(func(*Transaction) {}) != nil || len(*events) != 0 {
		t.Fatal("an empty transaction emitted")
	}
}

// Embeds and marks are foreign content the engine never writes itself.
func TestForeignTextEmbedsAndFormatsSurviveTheOracle(t *testing.T) {
	update, roots := structsCase(t, "text-insert-format-embed")
	doc := docWithID(4242)
	applyBytes(t, doc, update)
	sameJSON(t, "json", render(t, doc, roots), nodeReplay(t, roots, [][]byte{mustState(t, doc, nil)}, nil).json)
}

// yrs writes these two with integer tags yjs writes as floats; the rewrite
// of a rewrite must be a fixed point.
func TestRewritingARewriteIsAFixedPoint(t *testing.T) {
	for _, name := range yrsIntegerTagCases {
		once := reEncode(mustDecode(t, fixtureBytes(t, fixtureCase(t, "yrs-compat.json", name), "update")))
		if twice := reEncode(mustDecode(t, once)); !bytes.Equal(once, twice) {
			t.Errorf("%s: the second rewrite differs", name)
		}
	}
}

var everyRoot = [][2]string{{"blocks", "map"}, {"list", "array"}, {"content", "text"}}

func TestOneTransactionEmitsOneUpdateReadableByYjs(t *testing.T) {
	doc := docWithID(4242)
	blocks, list, content := doc.GetMap(s("blocks")), doc.GetArray(s("list")), doc.GetText(s("content"))
	events := recordUpdates(doc)
	written := doc.Transact(func(txn *Transaction) {
		blocks.Set(txn, s("title"), s("hello"))
		list.Insert(txn, 0, []any{s("a"), s("b")})
		content.Insert(txn, 0, s("text"), nil)
	})
	if len(*events) != 1 || !(*events)[0].Local || !bytes.Equal((*events)[0].Update, written) {
		t.Fatalf("%d events", len(*events))
	}
	replay := nodeReplay(t, everyRoot, [][]byte{written}, nil)
	sameJSON(t, "json", render(t, doc, everyRoot), replay.json)
	if !bytes.Equal(doc.EncodeStateVector(), replay.sv) {
		t.Fatalf("sv %x / %x", doc.EncodeStateVector(), replay.sv)
	}
}

var mapRoot = [][2]string{{"blocks", "map"}}

// The Node halves of YDocWriteTests PrelimMapIntegratesWithItsParent,
// SetAdmitsUndefined and JsonNumbersAlwaysLowerToDouble.
func TestLocalMapWritesReadBackInYjs(t *testing.T) {
	built := buildValue(t, parseRaw(t, s(`{"i": 1, "f": 0.5, "wide": 2147483648, "deep": [7]}`)))
	members, ok := built.(*jsjson.Object)
	if !ok {
		t.Fatalf("%T", built)
	}
	for _, member := range members.Members() {
		value := member.Value
		if items, ok := value.([]any); ok && member.Key.String() == "deep" && len(items) == 1 {
			value = items[0]
		}
		if _, ok := value.(float64); !ok {
			t.Fatalf("%s is %T", member.Key.String(), value)
		}
	}
	if _, ok := buildValue(t, 1.0).(float64); !ok {
		t.Fatal("a bare number is not a double")
	}
	for name, value := range map[string]any{
		"prelim":    NewMap(MapEntry{s("title"), s("first")}, MapEntry{s("tags"), NewArray(s("a"), s("b"))}),
		"undefined": jsjson.Undefined{},
		"numbers":   built,
	} {
		doc := docWithID(4242)
		written := doc.Transact(func(txn *Transaction) { doc.GetMap(s("blocks")).Set(txn, s(name), value) })
		sameJSON(t, name, render(t, doc, mapRoot), nodeReplay(t, mapRoot, [][]byte{written}, nil).json)
	}
}

// The scenarios whose engine steps write text; yjs then reads the engine's
// whole state back.
func TestTextWritesMatchYjs(t *testing.T) {
	for _, name := range []string{
		"nul-and-astral-strings",
		"text-format-and-embed",
		"formatted-text-engine-writes",
		"formatted-text-prelim-queue",
		"formatted-text-link-key-order",
		"formatted-text-equal-links-cleanup",
		"formatted-text-remote-cleanup",
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			c := scenarioNamed(t, name)
			runner := newScenarioRunner(t, c)
			runner.runAll()
			if runner.checks == 0 {
				t.Fatal("asserted nothing")
			}
			rendered := render(t, runner.doc, c.roots)
			replayed := nodeReplay(t, c.roots, [][]byte{mustState(t, runner.doc, nil)}, nil).json
			if c.segments {
				rendered, replayed = mergeTextRuns(t, rendered), mergeTextRuns(t, replayed)
			}
			sameJSON(t, "json", rendered, replayed)
		})
	}
}

var textRoot = [][2]string{{"content", "text"}}

// Cutting a surrogate pair makes each half U+FFFD, keeping its unit count.
func TestTextSplitsOnSurrogatePairsLikeYjs(t *testing.T) {
	doc := docWithID(4242)
	content := doc.GetText(s("content"))
	events := recordUpdates(doc)
	doc.Transact(func(txn *Transaction) { content.Insert(txn, 0, s("a😀b"), nil) })
	doc.Transact(func(txn *Transaction) { content.Delete(txn, 1, 1) })
	if got := content.Units(); !slices.Equal(got, jsjson.Str{'a', 0xfffd, 'b'}) {
		t.Fatalf("%x", got)
	}
	var updates [][]byte
	for _, event := range *events {
		updates = append(updates, event.Update)
	}
	sameJSON(t, "json", render(t, doc, textRoot), nodeReplay(t, textRoot, updates, nil).json)
}

func TestTextRoundTripsThroughNode(t *testing.T) {
	doc := docWithID(4242)
	content := doc.GetText(s("content"))
	events := recordUpdates(doc)
	doc.Transact(func(txn *Transaction) { content.Insert(txn, 0, s("hello world"), nil) })
	doc.Transact(func(txn *Transaction) { content.Insert(txn, 5, s(","), nil) })
	doc.Transact(func(txn *Transaction) { content.Delete(txn, 0, 1) })
	if content.String() != "ello, world" || len(*events) != 3 {
		t.Fatalf("%q, %d updates", content.String(), len(*events))
	}
	var updates [][]byte
	for _, event := range *events {
		updates = append(updates, event.Update)
	}
	replay := nodeReplay(t, textRoot, updates, nil)
	sameJSON(t, "json", render(t, doc, textRoot), replay.json)
	if !bytes.Equal(doc.EncodeStateVector(), replay.sv) {
		t.Fatalf("sv %x / %x", doc.EncodeStateVector(), replay.sv)
	}
}

// deltaJSON renders the production ToDelta, not the test renderer.
func deltaJSON(delta []Delta) []any {
	rendered := []any{}
	for _, op := range delta {
		entry := obj("insert", op.Insert)
		if op.Attributes != nil {
			entry.Set(s("attributes"), op.Attributes)
		}
		rendered = append(rendered, entry)
	}
	return rendered
}

// Every formatted write, one transaction each, replayed by real yjs; the
// production ToDelta must read what yjs reads.
func TestFormattedWritesReadBackInYjs(t *testing.T) {
	roots := [][2]string{{"content", "text"}, {"blocks", "map"}}
	doc := docWithID(4242)
	content, blocks := doc.GetText(s("content")), doc.GetMap(s("blocks"))
	events := recordUpdates(doc)
	doc.Transact(func(txn *Transaction) { blocks.Set(txn, s("b1"), NewXmlText(nil)) })
	nested, _ := blocks.Get(s("b1"))
	rich := nested.(*XmlText)
	for _, text := range []textWriter{content, rich} {
		doc.Transact(func(txn *Transaction) { text.Insert(txn, 0, s("Hello world"), obj()) })
		doc.Transact(func(txn *Transaction) { text.Format(txn, 0, 5, obj("bold", true)) })
		doc.Transact(func(txn *Transaction) {
			text.Format(txn, 6, 5, obj("link", obj("href", s("h"), "rel", s("r"))))
		})
		doc.Transact(func(txn *Transaction) { text.Format(txn, 1, 2, obj("bold", nil)) })
		doc.Transact(func(txn *Transaction) {
			text.InsertEmbed(txn, 5, obj("equation", obj("expression", s("x"))), obj("italic", true))
		})
		doc.Transact(func(txn *Transaction) { text.Insert(txn, 12, s("!"), nil) })
		doc.Transact(func(txn *Transaction) { text.Delete(txn, 3, 4) })
	}
	var updates [][]byte
	for _, event := range *events {
		updates = append(updates, event.Update)
	}
	replay := nodeReplay(t, roots, updates, nil)
	sameJSON(t, "json", render(t, doc, roots), replay.json)
	sameJSON(t, "content delta", deltaJSON(content.ToDelta()), yjstest.Field(yjstest.Field(replay.json, "content"), "$text"))
	b1 := yjstest.Field(yjstest.Field(replay.json, "blocks"), "b1")
	sameJSON(t, "b1 delta", deltaJSON(rich.ToDelta()), yjstest.Field(b1, "$text"))
	if !bytes.Equal(doc.EncodeStateVector(), replay.sv) {
		t.Fatalf("sv %x / %x", doc.EncodeStateVector(), replay.sv)
	}
}

func TestToDeltaReadsAPeersFormatsAndEmbeds(t *testing.T) {
	c := scenarioNamed(t, "text-format-and-embed")
	runner := newScenarioRunner(t, c)
	runner.runAll()
	var want any
	for _, step := range c.steps {
		if step.expect != nil && step.expect.hasJSON {
			want = step.expect.json
		}
	}
	sameJSON(t, "delta", deltaJSON(runner.doc.GetText(s("content")).ToDelta()), yjstest.Field(yjstest.Field(want, "content"), "$text"))
}

func panicReason(t *testing.T, run func()) (reason string) {
	t.Helper()
	defer func() {
		recovered := recover()
		failure, ok := recovered.(*EngineError)
		if !ok {
			t.Fatalf("panic %v, want an *EngineError", recovered)
		}
		reason = failure.Reason
	}()
	run()
	return ""
}

func TestAttachedTextNeedsATransaction(t *testing.T) {
	doc := docWithID(4242)
	if got := panicReason(t, func() { doc.GetText(s("content")).Insert(nil, 0, s("a"), nil) }); got != "yjs: a text in a document needs a transaction." {
		t.Fatal(got)
	}
}

func TestUndefinedAttributeIsRefused(t *testing.T) {
	doc := docWithID(4242)
	content := doc.GetText(s("content"))
	expectPanic(t, "an undefined mark", func() {
		doc.Transact(func(txn *Transaction) { content.Insert(txn, 0, s("a"), obj("bold", jsjson.Undefined{})) })
	})
	if len(doc.store.order) != 0 {
		t.Fatal("a refused write reached the store")
	}
}

// A bad argument to a text not yet in a doc throws from the call, not later
// from whatever integrates the text.
func TestQueuedWritesAreCheckedWhenMade(t *testing.T) {
	text := NewXmlText(nil)
	undefined := obj("bold", jsjson.Undefined{})
	for name, write := range map[string]func(){
		"insert, undefined mark": func() { text.Insert(nil, 0, s("a"), undefined) },
		"format, undefined mark": func() { text.Format(nil, 0, 1, undefined) },
		"embed, bigint":          func() { text.InsertEmbed(nil, 0, obj("big", lib0.BigInt(1)), nil) },
		"embed, undefined mark":  func() { text.InsertEmbed(nil, 0, obj("page", s("p")), undefined) },
		"insert, negative index": func() { text.Insert(nil, -1, s("a"), nil) },
		"embed, negative index":  func() { text.InsertEmbed(nil, -1, obj(), nil) },
		"format, negative index": func() { text.Format(nil, -1, 1, obj()) },
		"delete, negative index": func() { text.Delete(nil, -1, 1) },
	} {
		expectPanic(t, name, write)
	}
	doc := docWithID(4242)
	// Nothing bad was queued, so the text integrates cleanly.
	doc.Transact(func(txn *Transaction) { doc.GetMap(s("blocks")).Set(txn, s("b1"), text) })
	if delta := text.ToDelta(); len(delta) != 0 {
		t.Fatalf("%+v", delta)
	}
}

// FuzzCorpusTests: each seed's final state round-trips through yjs.
func TestEverySeedReplaysInYjs(t *testing.T) {
	for _, c := range fuzzSeeds(t) {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			runner := newScenarioRunner(t, c)
			runner.runAll()
			replay := nodeReplay(t, c.roots, [][]byte{mustState(t, runner.doc, nil)}, nil)
			sameJSON(t, "json", render(t, runner.doc, c.roots), replay.json)
			if !bytes.Equal(runner.doc.EncodeStateVector(), replay.sv) || runner.doc.HasPending() != replay.hasPending {
				t.Fatalf("sv %x / %x, pending %v / %v", runner.doc.EncodeStateVector(), replay.sv, runner.doc.HasPending(), replay.hasPending)
			}
		})
	}
}

func TestOutOfOrderDeliveryRetainsPendingThenConverges(t *testing.T) {
	runner := newScenarioRunner(t, scenarioNamed(t, "out-of-order-delivery"))
	runner.runAll()
	if runner.doc.HasPending() || runner.checks < 9 {
		t.Fatalf("pending %v, %d checks", runner.doc.HasPending(), runner.checks)
	}
}

// YrsCompatCorpusTests.EveryCorpusEntryNamesACollabFixture: the corpus can
// only shrink, so this is a subset check.
func TestEveryCorpusEntryNamesACollabFixture(t *testing.T) {
	root, err := yjstest.RepoRoot()
	if err != nil {
		t.Fatal(err)
	}
	cases := fixtureCases(t, "yrs-compat.json")
	if len(cases) == 0 {
		t.Fatal("empty corpus")
	}
	for _, c := range cases {
		name := yjstest.String(c, "name")
		if !isDir(root + "/test/unit/server-conformance/fixtures/collab/" + name) {
			t.Errorf("%s names no collab fixture", name)
		}
		if len(fixtureBytes(t, c, "update")) == 0 {
			t.Errorf("%s: empty update", name)
		}
	}
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// C# ToDeltaReadsANullEmbed: the decoder only checks that an embed is JSON,
// so a peer can send null; the engine and yjs both read { insert: null }.
func TestToDeltaReadsANullEmbed(t *testing.T) {
	writer := docWithID(4242)
	content := writer.GetText(s("content"))
	written := writer.Transact(func(txn *Transaction) {
		content.InsertEmbed(txn, 0, obj("a", 1.0), nil)
	})
	json := []byte(`{"a":1}`)
	at := bytes.Index(written, append([]byte{byte(len(json))}, json...))
	if at < 0 {
		t.Fatal("the embed's JSON is not in the update")
	}
	patched := slices.Concat(written[:at], []byte{4}, []byte("null"), written[at+1+len(json):])
	doc := docWithID(4343)
	if result, err := doc.ApplyUpdate(patched); err != nil || result.Outcome != Applied {
		t.Fatalf("%+v, %v", result, err)
	}
	delta := doc.GetText(s("content")).ToDelta()
	replay := nodeReplay(t, [][2]string{{"content", "text"}}, [][]byte{patched}, nil)

	if len(delta) != 1 || delta[0].Insert != nil {
		t.Fatalf("delta %+v", delta)
	}
	got, err := jsjson.Stringify(yjstest.Field(replay.json, "content"))
	if err != nil {
		t.Fatal(err)
	}
	if want := `{"$text":[{"insert":null}]}`; got != want {
		t.Fatalf("yjs read %s, want %s", got, want)
	}
}

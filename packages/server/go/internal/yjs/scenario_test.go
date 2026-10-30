package yjs

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/lib0"
	"github.com/JackUait/blok/packages/server/go/internal/yjs/yjstest"
)

// Port of Blok.Server.Tests/Yjs/ScenarioSupport.cs and JsonRenderer.cs: the
// scenarios and fuzz seeds replayed against the engine, checked against
// what real yjs produced.

type scenarioExpect struct {
	sv         []byte
	hasPending *bool
	json       any
	hasJSON    bool
	jsonSha256 string
	diverges   bool
	noCleanup  *scenarioExpect
}

type scenarioStep struct {
	kind            string
	id              string
	doc             string
	op              any
	update          []byte
	updateOf        string
	to              []string
	toSet           bool
	expect          *scenarioExpect
	noCleanupUpdate []byte
}

type scenarioCase struct {
	name     string
	gc       bool
	roots    [][2]string
	engine   string
	clientID uint32
	steps    []scenarioStep
	segments bool
}

func optionalBytes(t *testing.T, value any, key string) []byte {
	t.Helper()
	if !yjstest.Has(value, key) {
		return nil
	}
	return fixtureBytes(t, value, key)
}

func readExpect(t *testing.T, value any) *scenarioExpect {
	if _, ok := value.(*jsjson.Object); !ok {
		return nil
	}
	expect := &scenarioExpect{sv: optionalBytes(t, value, "sv"), jsonSha256: yjstest.String(value, "jsonSha256")}
	if yjstest.Has(value, "hasPending") {
		pending := yjstest.Bool(value, "hasPending")
		expect.hasPending = &pending
	}
	if yjstest.Has(value, "json") {
		expect.json, expect.hasJSON = yjstest.Field(value, "json"), true
	}
	return expect
}

func names(value any) ([]string, bool) {
	items, ok := value.([]any)
	if !ok {
		return nil, false
	}
	out := []string{}
	for _, item := range items {
		out = append(out, item.(jsjson.Str).String())
	}
	return out, true
}

func readCase(t *testing.T, name string, value any, seed bool) scenarioCase {
	t.Helper()
	c := scenarioCase{name: name, gc: true, engine: yjstest.String(value, "engine")}
	if yjstest.Has(value, "gc") {
		c.gc = yjstest.Bool(value, "gc")
	}
	for _, member := range yjstest.Field(value, "roots").(*jsjson.Object).Members() {
		c.roots = append(c.roots, [2]string{member.Key.String(), member.Value.(jsjson.Str).String()})
	}
	c.clientID = uint32(yjstest.Number(yjstest.Field(value, "docs"), c.engine))
	switch compare := yjstest.String(value, "compare"); compare {
	case "":
	case "segments":
		c.segments = true
	default:
		t.Fatalf("%q is not a compare mode", compare)
	}
	for _, raw := range yjstest.Items(value, "steps") {
		step := scenarioStep{
			kind:            yjstest.String(raw, "kind"),
			id:              yjstest.String(raw, "id"),
			doc:             yjstest.String(raw, "doc"),
			op:              yjstest.Field(raw, "op"),
			update:          optionalBytes(t, raw, "update"),
			updateOf:        yjstest.String(raw, "updateOf"),
			expect:          readExpect(t, yjstest.Field(raw, "expect")),
			noCleanupUpdate: optionalBytes(t, raw, "noCleanupUpdate"),
		}
		if !seed {
			field := "deliver"
			if step.kind == "deliver" {
				field = "to"
			}
			step.to, step.toSet = names(yjstest.Field(raw, field))
			if step.expect != nil {
				step.expect.diverges = yjstest.Bool(raw, "diverges")
				step.expect.noCleanup = readExpect(t, yjstest.Field(raw, "noCleanup"))
			}
		}
		c.steps = append(c.steps, step)
	}
	return c
}

func scenarios(t *testing.T) []scenarioCase {
	var cases []scenarioCase
	for _, value := range fixtureCases(t, "scenarios.json") {
		cases = append(cases, readCase(t, yjstest.String(value, "name"), value, false))
	}
	return cases
}

func fuzzSeeds(t *testing.T) []scenarioCase {
	dir, err := yjstest.Dir()
	if err != nil {
		t.Fatal(err)
	}
	paths, err := filepath.Glob(filepath.Join(dir, "fuzz", "seed-*.json"))
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(paths)
	var cases []scenarioCase
	for _, path := range paths {
		value, err := yjstest.Load("fuzz/" + filepath.Base(path))
		if err != nil {
			t.Fatal(err)
		}
		cases = append(cases, readCase(t, strings.TrimSuffix(filepath.Base(path), ".json"), value, true))
	}
	return cases
}

// buildValue turns a generator value descriptor into an engine value.
func buildValue(t *testing.T, descriptor any) any {
	t.Helper()
	switch d := descriptor.(type) {
	case []any:
		items := []any{}
		for _, item := range d {
			items = append(items, buildValue(t, item))
		}
		return items
	case *jsjson.Object:
		return buildDescribed(t, d)
	}
	return descriptor
}

func buildDescribed(t *testing.T, members *jsjson.Object) any {
	t.Helper()
	get := func(key string) (any, bool) { return members.Get(s(key)) }
	if value, ok := get("$num"); ok {
		number, err := yjstest.ToEngine(obj("$num", value))
		if err != nil {
			t.Fatal(err)
		}
		return number
	}
	if value, ok := get("$bigint"); ok {
		big, err := yjstest.ToEngine(obj("$bigint", value))
		if err != nil {
			t.Fatal(err)
		}
		return big
	}
	if value, ok := get("$u8"); ok {
		data, err := base64.StdEncoding.DecodeString(value.(jsjson.Str).String())
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	if _, ok := get("$undefined"); ok {
		return jsjson.Undefined{}
	}
	if nested, ok := get("$ymap"); ok {
		var entries []MapEntry
		for _, member := range nested.(*jsjson.Object).Members() {
			entries = append(entries, MapEntry{Key: member.Key, Value: buildValue(t, member.Value)})
		}
		return NewMap(entries...)
	}
	if items, ok := get("$yarray"); ok {
		return NewArray(buildValue(t, items).([]any)...)
	}
	if characters, ok := get("$ytext"); ok {
		return NewText(characters.(jsjson.Str))
	}
	if characters, ok := get("$yxmltext"); ok {
		text := NewXmlText(characters.(jsjson.Str))
		ops, _ := get("ops")
		list, _ := ops.([]any)
		for _, op := range list {
			applyTextOp(t, text, nil, op)
		}
		return text
	}
	for _, member := range members.Members() {
		if strings.HasPrefix(member.Key.String(), "$yxml") {
			t.Fatalf("%q is a placeholder type the engine never writes", member.Key.String())
		}
	}
	built := &jsjson.Object{}
	for _, member := range members.Members() {
		built.Set(member.Key, buildValue(t, member.Value))
	}
	return built
}

type textWriter interface {
	Insert(t *Transaction, index int, chunk jsjson.Str, attributes *jsjson.Object)
	InsertEmbed(t *Transaction, index int, embed any, attributes *jsjson.Object)
	Format(t *Transaction, index, length int, attributes *jsjson.Object)
	Delete(t *Transaction, index, length int)
}

func applyTextOp(t *testing.T, text textWriter, txn *Transaction, op any) {
	t.Helper()
	var attributes *jsjson.Object
	if yjstest.Has(op, "attributes") && yjstest.Field(op, "attributes") != nil {
		attributes = buildValue(t, yjstest.Field(op, "attributes")).(*jsjson.Object)
	}
	index := int(yjstest.Number(op, "index"))
	switch kind := yjstest.String(op, "op"); kind {
	case "text.insert":
		text.Insert(txn, index, yjstest.Field(op, "text").(jsjson.Str), attributes)
	case "text.delete":
		text.Delete(txn, index, int(yjstest.Number(op, "length")))
	case "text.format":
		text.Format(txn, index, int(yjstest.Number(op, "length")), attributes)
	case "text.embed":
		text.InsertEmbed(txn, index, buildValue(t, yjstest.Field(op, "embed")), attributes)
	default:
		t.Fatalf("%q is not an op the engine performs", kind)
	}
}

func opTarget(t *testing.T, doc *Doc, op any) AbstractType {
	t.Helper()
	root := yjstest.Field(op, "root").(jsjson.Str)
	var target AbstractType
	switch kind := yjstest.String(op, "rootKind"); kind {
	case "map":
		target = doc.GetMap(root)
	case "array":
		target = doc.GetArray(root)
	case "text":
		target = doc.GetText(root)
	default:
		t.Fatalf("%q is not a root kind", kind)
	}
	for _, segment := range yjstest.Items(op, "path") {
		m, ok := target.(*Map)
		if !ok {
			t.Fatal("the op's target is not a Y.Map")
		}
		nested, _ := m.Get(segment.(jsjson.Str))
		child, ok := nested.(AbstractType)
		if !ok {
			t.Fatalf("%q does not hold a nested shared type", segment.(jsjson.Str).String())
		}
		target = child
	}
	return target
}

// applyOp performs one generator op in one transaction.
func applyOp(t *testing.T, doc *Doc, op any) []byte {
	t.Helper()
	target := opTarget(t, doc, op)
	return doc.Transact(func(txn *Transaction) {
		switch kind := yjstest.String(op, "op"); kind {
		case "map.set":
			target.(*Map).Set(txn, yjstest.Field(op, "key").(jsjson.Str), buildValue(t, yjstest.Field(op, "value")))
		case "map.delete":
			target.(*Map).Delete(txn, yjstest.Field(op, "key").(jsjson.Str))
		case "array.insert":
			target.(*Array).Insert(txn, int(yjstest.Number(op, "index")), buildValue(t, yjstest.Field(op, "values")).([]any))
		case "array.delete":
			target.(*Array).Delete(txn, int(yjstest.Number(op, "index")), int(yjstest.Number(op, "length")))
		default:
			applyTextOp(t, target.(textWriter), txn, op)
		}
	})
}

// render is the twin of scripts/yjs-engine-render.mjs.
func render(t *testing.T, doc *Doc, roots [][2]string) any {
	t.Helper()
	rendered := &jsjson.Object{}
	for _, root := range roots {
		var value AbstractType
		switch root[1] {
		case "map":
			value = doc.GetMap(s(root[0]))
		case "array":
			value = doc.GetArray(s(root[0]))
		case "text":
			value = doc.GetText(s(root[0]))
		default:
			t.Fatalf("%q is not a root kind", root[1])
		}
		rendered.Set(s(root[0]), renderValue(t, value))
	}
	return rendered
}

func renderValue(t *testing.T, value any) any {
	t.Helper()
	switch v := value.(type) {
	case nil, bool, jsjson.Str:
		return v
	case float64, jsjson.Undefined, lib0.BigInt, []byte:
		return yjstest.ToFixture(v)
	case *Text:
		return obj("$text", renderDelta(t, &v.textBase))
	case *XmlText:
		return obj("$text", renderDelta(t, &v.textBase))
	case *XmlElement, *XmlFragment, *XmlHook:
		return obj("$xml", s(renderXML(t, v.(AbstractType))))
	case *Map:
		rendered := &jsjson.Object{}
		for _, key := range v.Keys() {
			item, _ := v.Get(key)
			rendered.Set(key, renderValue(t, item))
		}
		return rendered
	case *Array:
		items := []any{}
		for _, item := range v.Values() {
			items = append(items, renderValue(t, item))
		}
		return items
	case *jsjson.Object:
		rendered := &jsjson.Object{}
		for _, member := range v.Members() {
			rendered.Set(member.Key, renderValue(t, member.Value))
		}
		return rendered
	case []any:
		items := []any{}
		for _, item := range v {
			items = append(items, renderValue(t, item))
		}
		return items
	case *Subdoc:
		return &jsjson.Object{}
	}
	t.Fatalf("%T has no JSON rendering", value)
	return nil
}

func renderDelta(t *testing.T, text *textBase) []any {
	t.Helper()
	delta := []any{}
	var marks attrs
	var run jsjson.Str
	operation := func(insert any) {
		op := obj("insert", insert)
		if len(marks) > 0 {
			op.Set(s("attributes"), snapshot(marks))
		}
		delta = append(delta, op)
	}
	packRun := func() {
		if len(run) > 0 {
			operation(run)
			run = nil
		}
	}
	for item := text.start; item != nil; item = item.right {
		if item.deleted {
			continue
		}
		switch content := item.content.(type) {
		case *ContentString:
			run = append(run, content.Text...)
		case *ContentEmbed, *ContentType:
			packRun()
			operation(renderValue(t, content.Values()[0]))
		case *ContentFormat:
			packRun()
			value := parseRaw(t, content.JSON)
			if value == nil {
				marks.remove(content.Key)
			} else {
				marks.set(content.Key, value)
			}
		}
	}
	packRun()
	return delta
}

func renderXML(t *testing.T, value AbstractType) string {
	switch v := value.(type) {
	case *XmlText:
		return v.String()
	case *XmlElement:
		name := ""
		if v.NodeName != nil {
			name = strings.ToLower(v.NodeName.String())
		}
		entries := slices.Clone(v.entries)
		slices.SortFunc(entries, func(a, b mapEntry) int { return jsjson.Compare(a.key, b.key) })
		var attributes strings.Builder
		for _, entry := range entries {
			if entry.head.deleted {
				continue
			}
			attributeValue, ok := entry.head.content.Values()[entry.head.length-1].(jsjson.Str)
			if !ok {
				t.Fatalf("an XML attribute that is not a string")
			}
			fmt.Fprintf(&attributes, " %s=%q", entry.key.String(), attributeValue.String())
		}
		return "<" + name + attributes.String() + ">" + renderXMLChildren(t, v.core()) + "</" + name + ">"
	}
	return renderXMLChildren(t, value.core())
}

func renderXMLChildren(t *testing.T, core *typeCore) string {
	var written strings.Builder
	for item := core.start; item != nil; item = item.right {
		if child, ok := item.content.(*ContentType); ok && !item.deleted {
			written.WriteString(renderXML(t, child.Type))
		}
	}
	return written.String()
}

// mergeTextRuns merges neighbouring string runs with equal attributes.
func mergeTextRuns(t *testing.T, value any) any {
	switch v := value.(type) {
	case *jsjson.Object:
		if v.Len() == 1 && v.Members()[0].Key.String() == "$text" {
			if delta, ok := v.Members()[0].Value.([]any); ok {
				return obj("$text", mergeDelta(t, delta))
			}
		}
		merged := &jsjson.Object{}
		for _, member := range v.Members() {
			merged.Set(member.Key, mergeTextRuns(t, member.Value))
		}
		return merged
	case []any:
		items := []any{}
		for _, item := range v {
			items = append(items, mergeTextRuns(t, item))
		}
		return items
	}
	return value
}

func mergeDelta(t *testing.T, delta []any) []any {
	merged := []any{}
	var last *jsjson.Object
	attributesOf := func(op any) string {
		attributes, ok := op.(*jsjson.Object).Get(s("attributes"))
		if !ok {
			attributes = &jsjson.Object{}
		}
		return canonical(t, attributes)
	}
	for _, entry := range delta {
		insert, _ := entry.(*jsjson.Object).Get(s("insert"))
		text, isText := insert.(jsjson.Str)
		if last != nil && isText {
			previous, _ := last.Get(s("insert"))
			if before, ok := previous.(jsjson.Str); ok && attributesOf(last) == attributesOf(entry) {
				last.Set(s("insert"), append(append(jsjson.Str{}, before...), text...))
				continue
			}
		}
		last = &jsjson.Object{}
		for _, member := range entry.(*jsjson.Object).Members() {
			last.Set(member.Key, member.Value)
		}
		merged = append(merged, last)
	}
	return merged
}

func jsonSha256(t *testing.T, value any) string {
	sum := sha256.Sum256([]byte(canonical(t, value)))
	return hex.EncodeToString(sum[:])
}

type scenarioRunner struct {
	t       *testing.T
	c       scenarioCase
	doc     *Doc
	emitted map[string][]byte
	checks  int
	// observe runs after each step; the golden capture hooks in here.
	observe func(step scenarioStep, emitted []byte, result *ApplyResult)
}

func newScenarioRunner(t *testing.T, c scenarioCase) *scenarioRunner {
	id := c.clientID
	return &scenarioRunner{t: t, c: c, doc: NewDoc(Options{ClientID: &id, NoGC: !c.gc}), emitted: map[string][]byte{}}
}

func (r *scenarioRunner) runAll() {
	for _, step := range r.c.steps {
		r.run(step)
	}
}

func (r *scenarioRunner) engineIn(names []string) bool { return slices.Contains(names, r.c.engine) }

func (r *scenarioRunner) run(step scenarioStep) {
	t := r.t
	t.Helper()
	// engineWrites files the ENGINE's bytes, so later deliveries replay them.
	if step.kind != "engineWrites" && step.id != "" && step.update != nil {
		r.emitted[step.id] = step.update
	}
	var written []byte
	var result *ApplyResult
	switch step.kind {
	case "op":
		if r.engineIn(step.to) {
			result = r.apply(step, step.update)
		}
	case "engineWrites":
		written = r.write(step)
	case "deliver":
		if !step.toSet || r.engineIn(step.to) {
			update := step.update
			if update == nil {
				var ok bool
				if update, ok = r.emitted[step.updateOf]; !ok {
					t.Fatalf("%s: no step has produced %q yet", r.c.name, step.updateOf)
				}
			}
			result = r.apply(step, update)
		}
	case "expect":
	default:
		t.Fatalf("%q is not a step kind", step.kind)
	}
	if r.observe != nil {
		r.observe(step, written, result)
	}
	if step.expect != nil && (step.doc == "" || step.doc == r.c.engine) {
		r.check(step, step.expect)
	}
}

func (r *scenarioRunner) write(step scenarioStep) []byte {
	t := r.t
	t.Helper()
	written := applyOp(t, r.doc, step.op)
	if written == nil {
		t.Fatalf("%s step %q: the op emitted nothing", r.c.name, step.id)
	}
	mirror := step.update
	if r.c.segments {
		mirror = step.noCleanupUpdate
	}
	if !bytes.Equal(written, mirror) {
		t.Errorf("%s step %q: engine %s, yjs %s", r.c.name, step.id,
			base64.StdEncoding.EncodeToString(written), base64.StdEncoding.EncodeToString(mirror))
	}
	r.checks++
	if step.id != "" {
		r.emitted[step.id] = written
	}
	return written
}

func (r *scenarioRunner) apply(step scenarioStep, update []byte) *ApplyResult {
	if update == nil {
		r.t.Fatalf("%s step %q carries no update", r.c.name, step.id)
	}
	result, err := r.doc.ApplyUpdate(update)
	if err != nil || result.Outcome != Applied {
		r.t.Fatalf("%s step %q: %+v %v", r.c.name, step.id, result, err)
	}
	return &result
}

func (r *scenarioRunner) check(step scenarioStep, expect *scenarioExpect) {
	t := r.t
	t.Helper()
	where := fmt.Sprintf("%s step %q", r.c.name, step.id)
	if expect.sv != nil {
		if got := r.doc.EncodeStateVector(); !bytes.Equal(got, expect.sv) {
			t.Errorf("%s: sv %x, want %x", where, got, expect.sv)
		}
		r.checks++
	}
	if expect.hasPending != nil {
		if r.doc.HasPending() != *expect.hasPending {
			t.Errorf("%s: hasPending %v", where, r.doc.HasPending())
		}
		r.checks++
	}
	if expect.hasJSON {
		rendered := render(t, r.doc, r.c.roots)
		want, got := expect.json, rendered
		if r.c.segments {
			want, got = mergeTextRuns(t, want), mergeTextRuns(t, got)
		}
		equal := canonical(t, want) == canonical(t, got)
		if expect.diverges && equal {
			t.Errorf("%s: json should diverge from yjs until a peer's cleanup arrives", where)
		}
		if !expect.diverges && !equal {
			t.Errorf("%s: json\n got %s\nwant %s", where, canonical(t, got), canonical(t, want))
		}
		r.checks++
	}
	if no := expect.noCleanup; no != nil {
		if got := r.doc.EncodeStateVector(); !bytes.Equal(got, no.sv) {
			t.Errorf("%s: no-cleanup sv %x, want %x", where, got, no.sv)
		}
		if got := canonical(t, render(t, r.doc, r.c.roots)); got != canonical(t, no.json) {
			t.Errorf("%s: no-cleanup json\n got %s\nwant %s", where, got, canonical(t, no.json))
		}
		r.checks++
	}
	if expect.jsonSha256 != "" {
		if got := jsonSha256(t, render(t, r.doc, r.c.roots)); got != expect.jsonSha256 {
			t.Errorf("%s: jsonSha256 %s, want %s (json %s)", where, got, expect.jsonSha256, canonical(t, render(t, r.doc, r.c.roots)))
		}
		r.checks++
	}
}

func TestEveryScenarioMatchesTheYjsOracle(t *testing.T) {
	cases := scenarios(t)
	if len(cases) != 21 {
		t.Fatalf("want 21 scenarios, got %d", len(cases))
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			runner := newScenarioRunner(t, c)
			runner.runAll()
			if runner.checks == 0 {
				t.Fatal("the scenario checked nothing")
			}
		})
	}
}

func TestEverySeedMatchesTheYjsOracleAtEveryStep(t *testing.T) {
	seeds := fuzzSeeds(t)
	if len(seeds) != 50 {
		t.Fatalf("want 50 seeds, got %d", len(seeds))
	}
	for _, c := range seeds {
		t.Run(c.name, func(t *testing.T) {
			runner := newScenarioRunner(t, c)
			runner.runAll()
			if runner.checks == 0 {
				t.Fatal("the seed checked nothing")
			}
		})
	}
}


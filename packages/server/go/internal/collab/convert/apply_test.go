package convert

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/collabtest"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

type editCase struct {
	Name       string            `json:"name"`
	SeedUpdate string            `json:"seedUpdate"`
	Body       *string           `json:"body"`
	Agent      []json.RawMessage `json:"agent"`
	HTML       []struct {
		HTML     string          `json:"html"`
		Segments json.RawMessage `json:"segments"`
	} `json:"html"`
	Updates []string `json:"updates"`
	Refused *struct {
		Kind    string `json:"kind"`
		Message string `json:"message"`
	} `json:"refused"`
	Export     json.RawMessage `json:"export"`
	ExportPage json.RawMessage `json:"exportPage"`
	Seed       json.RawMessage `json:"seed"`
	Page       json.RawMessage `json:"page"`
	Shape      *string         `json:"shape"`
	Prior      *string         `json:"prior"`
	// A peer's concurrent edit on the seeded doc, and the doc after both.
	PeerUpdate   string          `json:"peerUpdate"`
	MergedExport json.RawMessage `json:"mergedExport"`
	SeedHTML     []struct {
		HTML     string          `json:"html"`
		Segments json.RawMessage `json:"segments"`
	} `json:"seedHtml"`
}

type editCases struct {
	SeedClient uint32     `json:"seedClient"`
	EditClient uint32     `json:"editClient"`
	Cases      []editCase `json:"cases"`
}

func jsValue(t *testing.T, raw []byte) any {
	t.Helper()
	v, err := jsjson.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func node(t *testing.T, raw []byte) *jsjson.Node {
	t.Helper()
	n, err := jsjson.ParseNode(raw, jsjson.Options{})
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func optional(t *testing.T, op *jsjson.Node, key string) *string {
	t.Helper()
	v, err := member(op, key)
	if err != nil || v == nil || v.Kind == jsjson.KindNull {
		return nil
	}
	text, err := v.Text()
	if err != nil {
		t.Fatal(err)
	}
	s := text.String()
	return &s
}

func required(t *testing.T, op *jsjson.Node, key string) string {
	t.Helper()
	s := optional(t, op, key)
	if s == nil {
		t.Fatalf("agent op lacks %q", key)
	}
	return *s
}

// agentOp is the capture's AgentOp: the agent-only ops from a small JSON
// shape, insert, update and remove through the /edit parser.
func agentOp(t *testing.T, raw []byte) EditOp {
	t.Helper()
	op := node(t, raw)
	sub := func(key string) *jsjson.Node {
		v, err := member(op, key)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	switch required(t, op, "op") {
	case "move":
		return Move{ID: required(t, op, "id"), After: optional(t, op, "after"), Parent: optional(t, op, "parent")}
	case "lift":
		return Lift{ID: required(t, op, "id")}
	case "retype":
		return Retype{ID: required(t, op, "id"), Type: required(t, op, "type"), Data: sub("data")}
	case "setTunes":
		return SetTunes{ID: required(t, op, "id"), Tunes: sub("tunes")}
	case "setMetadata":
		at := jsValue(t, sub("lastEditedAt").Raw()).(float64)
		return SetMetadata{ID: required(t, op, "id"), LastEditedAt: at, LastEditedBy: required(t, op, "lastEditedBy"), LastEditedWith: optional(t, op, "lastEditedWith")}
	case "setPageField":
		return SetPageField{Key: required(t, op, "key"), Value: sub("value")}
	case "patchMaps":
		var patches []MapPatch
		for _, p := range sub("patches").Items {
			patch := MapPatch{Map: required(t, p, "map"), Key: required(t, p, "key")}
			if v, _ := member(p, "value"); v != nil {
				value, err := strictValue(v)
				if err != nil {
					t.Fatal(err)
				}
				patch.Value = value
			}
			if v, _ := member(p, "remove"); v != nil {
				patch.Remove = v.Kind == jsjson.KindTrue
			}
			patches = append(patches, patch)
		}
		return PatchMaps{Patches: patches}
	}
	ops, err := ParseEditOps([]byte(`{"ops":[` + string(raw) + `]}`))
	if err != nil {
		t.Fatal(err)
	}
	return ops[0]
}

func rowKeyCounter(prefix string) func() string {
	next := 0
	return func() string {
		next++
		return fmt.Sprintf("%s%09d", prefix, next)
	}
}

func decode64(t *testing.T, text string) []byte {
	t.Helper()
	b, err := base64.StdEncoding.DecodeString(text)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// Twin of YDocConverterEditCaptureTests: the same seed and ops emit the same
// update bytes, export the same blocks, or refuse with the same message and
// write nothing.
func TestApplyOpsWritesWhatCSharpWrites(t *testing.T) {
	var fixture editCases
	collabtest.Read(t, "collab-edits/cases.json", &fixture)
	if len(fixture.Cases) == 0 {
		t.Fatal("no cases")
	}
	original := GenerateRowKey
	t.Cleanup(func() { GenerateRowKey = original })
	for _, c := range fixture.Cases {
		t.Run(c.Name, func(t *testing.T) {
			GenerateRowKey = rowKeyCounter("e")
			client := fixture.EditClient
			doc := yjs.NewDoc(yjs.Options{ClientID: &client})
			if result, err := doc.ApplyUpdate(decode64(t, c.SeedUpdate)); err != nil || result.Outcome != yjs.Applied {
				t.Fatalf("seed: %+v %v", result, err)
			}
			var ops []EditOp
			if c.Body != nil {
				parsed, err := ParseEditOps([]byte(*c.Body))
				if err != nil {
					t.Fatal(err)
				}
				ops = parsed
			}
			for _, raw := range c.Agent {
				ops = append(ops, agentOp(t, raw))
			}
			converted := map[string][]any{}
			for _, h := range c.HTML {
				converted[HTMLKey(str(h.HTML))] = jsValue(t, h.Segments).([]any)
			}
			var updates []string
			doc.OnUpdate(func(e yjs.UpdateEvent) {
				if e.Local {
					updates = append(updates, base64.StdEncoding.EncodeToString(e.Update))
				}
			})
			vector := doc.EncodeStateVector()
			// As the room calls it: collect the HTML, then apply. Both plan,
			// and planning mints grid row keys, so the order counts.
			found, err := CollectOpsHTML(doc, ops, BuiltInRichTextFields())
			if err == nil {
				var htmls []string
				for _, h := range found {
					htmls = append(htmls, h.HTML.String())
				}
				var want []string
				for _, h := range c.HTML {
					want = append(want, h.HTML)
				}
				if fmt.Sprint(htmls) != fmt.Sprint(want) {
					t.Errorf("html\n got %q\nwant %q", htmls, want)
				}
				err = ApplyOps(doc, ops, Converting(BuiltInRichTextFields(), converted))
			}
			if c.Refused != nil {
				var edit *EditError
				if !errors.As(err, &edit) || c.Refused.Kind != "edit" || edit.Message != c.Refused.Message {
					t.Fatalf("refusal: got %v, want %s %q", err, c.Refused.Kind, c.Refused.Message)
				}
				if len(updates) != 0 || !bytes.Equal(vector, doc.EncodeStateVector()) {
					t.Fatalf("a refused request wrote: %v", updates)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if fmt.Sprint(updates) != fmt.Sprint(c.Updates) {
				t.Errorf("updates\n got %v\nwant %v", updates, c.Updates)
			}
			blocks, _, err := Export(doc, BuiltInRichTextFields(), nil)
			if err != nil {
				t.Fatal(err)
			}
			if got, want := canonical(t, blocks), canonical(t, jsValue(t, c.Export)); got != want {
				t.Errorf("export\n got %s\nwant %s", got, want)
			}
			if got, want := canonical(t, ExportPage(doc)), canonical(t, jsValue(t, c.ExportPage)); got != want {
				t.Errorf("page\n got %s\nwant %s", got, want)
			}
			if c.PeerUpdate == "" {
				return
			}
			if result, err := doc.ApplyUpdate(decode64(t, c.PeerUpdate)); err != nil || result.Outcome != yjs.Applied {
				t.Fatalf("peer: %+v %v", result, err)
			}
			merged, _, err := Export(doc, BuiltInRichTextFields(), nil)
			if err != nil {
				t.Fatal(err)
			}
			if got, want := canonical(t, merged), canonical(t, jsValue(t, c.MergedExport)); got != want {
				t.Errorf("merged\n got %s\nwant %s", got, want)
			}
		})
	}
}

// Each edit case's seed, seeded by Go as client 1, must give C#'s seed update
// byte for byte: the bytes pin every container the seed mints (Y.Text or
// atomic, Y.Array or leaf, keyed grids, doubles), which no export can see.
func TestSeedWritesWhatCSharpWrites(t *testing.T) {
	var fixture editCases
	collabtest.Read(t, "collab-edits/cases.json", &fixture)
	original := GenerateRowKey
	t.Cleanup(func() { GenerateRowKey = original })
	compared := 0
	for _, c := range fixture.Cases {
		if c.Shape != nil || c.Prior != nil {
			continue
		}
		compared++
		t.Run(c.Name, func(t *testing.T) {
			GenerateRowKey = rowKeyCounter("s")
			client := fixture.SeedClient
			doc := yjs.NewDoc(yjs.Options{ClientID: &client})
			var page *jsjson.Object
			if len(c.Page) > 0 {
				page = jsValue(t, c.Page).(*jsjson.Object)
			}
			blocks := node(t, c.Seed).Items
			// As C# RichTextRuntime.Seed calls it: collecting plans the grids,
			// and planning mints row keys, so the call shows in the bytes.
			if _, err := CollectSeedHTML(blocks, BuiltInRichTextFields()); err != nil {
				t.Fatal(err)
			}
			converted := map[string][]any{}
			for _, h := range c.SeedHTML {
				converted[HTMLKey(str(h.HTML))] = jsValue(t, h.Segments).([]any)
			}
			if err := Seed(doc, blocks, Converting(BuiltInRichTextFields(), converted), page); err != nil {
				t.Fatal(err)
			}
			update, err := doc.EncodeStateAsUpdate(nil)
			if err != nil {
				t.Fatal(err)
			}
			if got := base64.StdEncoding.EncodeToString(update); got != c.SeedUpdate {
				t.Errorf("seed update\n got %s\nwant %s", got, c.SeedUpdate)
			}
		})
	}
	if compared < 80 {
		t.Fatalf("only %d seeds compared", compared)
	}
}

// Twin of YDocConverterEditTests.RemovesFromALargeDocumentWithoutRescanningItPerStep:
// the removal walk is linear in the subtree, never the document.
func TestRemovalVisitsOnlyTheSubtree(t *testing.T) {
	const chain = 10
	var blocks []*jsjson.Node
	for i := 0; i < 4000; i++ {
		blocks = append(blocks, node(t, []byte(fmt.Sprintf(`{"id":"n%d","type":"paragraph","data":{}}`, i))))
	}
	// n0 owns a chain c1 -> c2 -> ... by parentId alone.
	for i := 1; i <= chain; i++ {
		parent := fmt.Sprintf("c%d", i-1)
		if i == 1 {
			parent = "n0"
		}
		blocks = append(blocks, node(t, []byte(fmt.Sprintf(`{"id":"c%d","type":"paragraph","data":{},"parent":"%s"}`, i, parent))))
	}
	doc := yjs.NewDoc(yjs.Options{})
	if err := Seed(doc, blocks, Refusing(BuiltInRichTextFields()), nil); err != nil {
		t.Fatal(err)
	}
	ops, err := ParseEditOps([]byte(`{"ops":[{"op":"remove","id":"n0"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	visited, err := applyOps(doc, ops, Refusing(BuiltInRichTextFields()))
	if err != nil {
		t.Fatal(err)
	}
	exported, _, err := Export(doc, BuiltInRichTextFields(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(exported) != 3999 || visited != chain+1 {
		t.Fatalf("exported %d, visited %d", len(exported), visited)
	}
}

// A step failing inside the transaction emits nothing, keeps what it wrote,
// and is reported as a failed write, not a refusal (C# ApplyOps catch).
func TestAStepThatFailsMidWriteIsAServerError(t *testing.T) {
	doc := yjs.NewDoc(yjs.Options{})
	emitted := 0
	doc.OnUpdate(func(yjs.UpdateEvent) { emitted++ })
	before := doc.EncodeStateVector()
	err := runSteps(doc, []step{
		putBlock(str("a"), yjs.NewMap()),
		func(*yjs.Transaction, *yjs.Map, *yjs.Array) { panic("boom") },
	})
	var edit *EditError
	if !errors.Is(err, ErrEditFailedMidWrite) || errors.As(err, &edit) {
		t.Fatalf("got %v", err)
	}
	if emitted != 0 || bytes.Equal(before, doc.EncodeStateVector()) {
		t.Fatalf("emitted %d; the write must stay unemitted", emitted)
	}
}

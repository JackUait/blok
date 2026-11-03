package convert

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab/collabtest"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// The Go reader of agent-moves.json (from document-store moves) and
// agent-page-fields.json (from page-fields.ts), and twins of the inline
// cases in C# AgentRoomOpsTests.

func agSeeded(t *testing.T, blocks string) *yjs.Doc {
	t.Helper()
	doc := yjs.NewDoc(yjs.Options{})
	var items []*jsjson.Node
	if root := node(t, []byte(blocks)); root.Kind == jsjson.KindArray {
		items = root.Items
	}
	if err := Seed(doc, items, Refusing(BuiltInRichTextFields()), nil); err != nil {
		t.Fatal(err)
	}
	return doc
}

func agApply(doc *yjs.Doc, ops ...EditOp) error {
	return ApplyOps(doc, ops, Refusing(BuiltInRichTextFields()))
}

func agExported(t *testing.T, doc *yjs.Doc) []any {
	t.Helper()
	blocks, _, err := Export(doc, BuiltInRichTextFields(), nil)
	if err != nil {
		t.Fatal(err)
	}
	return blocks
}

func agPtr(s string) *string { return &s }

func agField(value any, key string) any {
	object, _ := value.(*jsjson.Object)
	if object == nil {
		return nil
	}
	found, _ := object.Get(str(key))
	return found
}

func agBlock(blocks []any, id string) any {
	for _, block := range blocks {
		if text, _ := agField(block, "id").(jsjson.Str); text.String() == id {
			return block
		}
	}
	return nil
}

func agIDs(blocks []any) string {
	var out []string
	for _, block := range blocks {
		text, _ := agField(block, "id").(jsjson.Str)
		out = append(out, text.String())
	}
	return strings.Join(out, ",")
}

// structure is ids, parents and children in order; the data spelling
// differs between the two exports.
func agStructure(t *testing.T, blocks []any) string {
	t.Helper()
	var out []any
	for _, block := range blocks {
		entry := &jsjson.Object{}
		entry.Set(str("id"), agField(block, "id"))
		entry.Set(str("type"), agField(block, "type"))
		entry.Set(str("parent"), agField(block, "parent"))
		content := agField(block, "content")
		if content == nil {
			content = []any{}
		}
		entry.Set(str("content"), content)
		out = append(out, entry)
	}
	return canonical(t, out)
}

type movesFixture struct {
	Seed  json.RawMessage `json:"seed"`
	Cases []struct {
		Name     string          `json:"name"`
		ID       string          `json:"id"`
		After    *string         `json:"after"`
		Parent   *string         `json:"parent"`
		Expected json.RawMessage `json:"expected"`
	} `json:"cases"`
}

func agMoves(t *testing.T) movesFixture {
	t.Helper()
	var fixture movesFixture
	collabtest.Read(t, "agent-moves.json", &fixture)
	return fixture
}

func TestMoveMatchesDocumentStore(t *testing.T) {
	fixture := agMoves(t)
	if len(fixture.Cases) != 4 {
		t.Fatalf("%d move cases, want 4", len(fixture.Cases))
	}
	for _, c := range fixture.Cases {
		t.Run(c.Name, func(t *testing.T) {
			doc := agSeeded(t, string(fixture.Seed))
			if err := agApply(doc, Move{ID: c.ID, After: c.After, Parent: c.Parent}); err != nil {
				t.Fatal(err)
			}
			want := jsValue(t, c.Expected).([]any)
			if got, want := agStructure(t, agExported(t, doc)), agStructure(t, want); got != want {
				t.Fatalf("got %s\nwant %s", got, want)
			}
		})
	}
}

func TestSetPageFieldMatchesPageFieldsTs(t *testing.T) {
	var fixture struct {
		Steps []struct {
			Key   string          `json:"key"`
			Value json.RawMessage `json:"value"`
		} `json:"steps"`
		After []json.RawMessage `json:"after"`
	}
	collabtest.Read(t, "agent-page-fields.json", &fixture)
	if len(fixture.Steps) != 4 {
		t.Fatalf("%d steps, want 4", len(fixture.Steps))
	}
	doc := agSeeded(t, `[]`)
	for i, step := range fixture.Steps {
		value := node(t, step.Value)
		if value.Kind == jsjson.KindNull {
			value = nil
		}
		if err := agApply(doc, SetPageField{Key: step.Key, Value: value}); err != nil {
			t.Fatal(err)
		}
		if got, want := canonical(t, ExportPage(doc)), canonical(t, jsValue(t, fixture.After[i])); got != want {
			t.Fatalf("step %d: %s, want %s", i, got, want)
		}
	}
}

func agRefused(t *testing.T, err error) {
	t.Helper()
	var edit *EditError
	if !errors.As(err, &edit) {
		t.Fatalf("err %v, want an edit refusal", err)
	}
}

func TestSetPageFieldRefusesABadIconAndAnUnknownKey(t *testing.T) {
	doc := yjs.NewDoc(yjs.Options{})
	agRefused(t, agApply(doc, SetPageField{Key: "icon", Value: node(t, []byte(`{"type":"emoji"}`))}))
	agRefused(t, agApply(doc, SetPageField{Key: "cover", Value: node(t, []byte(`"x"`))}))
	if got := canonical(t, ExportPage(doc)); got != "{}" {
		t.Fatalf("page %s", got)
	}
}

func TestMoveRefusesItsOwnSubtree(t *testing.T) {
	seed := string(agMoves(t).Seed)
	agRefused(t, agApply(agSeeded(t, seed), Move{ID: "a", Parent: agPtr("a1")}))
	agRefused(t, agApply(agSeeded(t, seed), Move{ID: "a", Parent: agPtr("a")}))
}

func TestAMovedChildSurvivesItsOldParentsRemovalInTheSameRequest(t *testing.T) {
	doc := agSeeded(t, string(agMoves(t).Seed))
	if err := agApply(doc, Move{ID: "a1", After: agPtr("b")}, Remove{ID: "a"}); err != nil {
		t.Fatal(err)
	}
	blocks := agExported(t, doc)
	if agIDs(blocks) != "b,a1" || agField(blocks[1], "parent") != nil {
		t.Fatalf("blocks %s", canonical(t, blocks))
	}
}

func TestAMovedBlockCanBeAnAnchorLaterInTheSameRequest(t *testing.T) {
	doc := agSeeded(t, string(agMoves(t).Seed))
	if err := agApply(doc,
		Move{ID: "b", Parent: agPtr("a")},
		Insert{ID: "n", Block: node(t, []byte(`{"type":"paragraph","data":{}}`)), After: agPtr("b"), Parent: agPtr("a")},
		Move{ID: "a2", After: agPtr("n"), Parent: agPtr("a")},
	); err != nil {
		t.Fatal(err)
	}
	if got := canonical(t, agField(agBlock(agExported(t, doc), "a"), "content")); got != `["b","n","a2","a1"]` {
		t.Fatalf("content %s", got)
	}
}

func TestRetypeKeepsTheBlockAndItsChildren(t *testing.T) {
	doc := agSeeded(t, `[{"id":"t","type":"toggle","data":{"text":[{"text":"T"}]},"content":["k"],"tunes":{"align":{"value":"left"}}},{"id":"k","type":"paragraph","data":{},"parent":"t"}]`)
	if err := agApply(doc, Retype{ID: "t", Type: "header", Data: node(t, []byte(`{"text":[{"text":"T"}],"level":2}`))}); err != nil {
		t.Fatal(err)
	}
	block := agBlock(agExported(t, doc), "t")
	if got := canonical(t, block); !strings.Contains(got, `"type":"header"`) ||
		canonical(t, agField(agField(block, "data"), "level")) != "2" ||
		canonical(t, agField(agField(block, "data"), "text")) != `[{"text":"T"}]` ||
		canonical(t, agField(block, "content")) != `["k"]` ||
		canonical(t, agField(agField(agField(block, "tunes"), "align"), "value")) != `"left"` {
		t.Fatalf("block %s", got)
	}
}

func TestSetTunesAndMetadataLandOnTheBlock(t *testing.T) {
	doc := agSeeded(t, `[{"id":"p","type":"paragraph","data":{},"tunes":{"gone":{"x":1}}}]`)
	if err := agApply(doc,
		SetTunes{ID: "p", Tunes: node(t, []byte(`{"align":{"value":"center"},"gone":null}`))},
		SetMetadata{ID: "p", LastEditedAt: 42, LastEditedBy: "agent-cs"},
	); err != nil {
		t.Fatal(err)
	}
	p := agExported(t, doc)[0]
	if canonical(t, agField(p, "tunes")) != `{"align":{"value":"center"}}` ||
		canonical(t, agField(p, "lastEditedBy")) != `"agent-cs"` || canonical(t, agField(p, "lastEditedAt")) != "42" {
		t.Fatalf("block %s", canonical(t, p))
	}
}

func TestMetadataSetsTheCoEditorAndAnEditWithoutOneRemovesIt(t *testing.T) {
	doc := agSeeded(t, `[{"id":"p","type":"paragraph","data":{}}]`)
	if err := agApply(doc, SetMetadata{ID: "p", LastEditedAt: 42, LastEditedBy: "human-1", LastEditedWith: agPtr("agent-cs")}); err != nil {
		t.Fatal(err)
	}
	p := agExported(t, doc)[0]
	if canonical(t, agField(p, "lastEditedBy")) != `"human-1"` || canonical(t, agField(p, "lastEditedWith")) != `"agent-cs"` {
		t.Fatalf("block %s", canonical(t, p))
	}
	if err := agApply(doc, SetMetadata{ID: "p", LastEditedAt: 43, LastEditedBy: "agent-cs"}); err != nil {
		t.Fatal(err)
	}
	p = agExported(t, doc)[0]
	if _, has := p.(*jsjson.Object).Get(str("lastEditedWith")); has || canonical(t, agField(p, "lastEditedBy")) != `"agent-cs"` {
		t.Fatalf("block %s", canonical(t, p))
	}
}

func TestAnInsertCarriesTheCoAuthorIds(t *testing.T) {
	doc := agSeeded(t, `[]`)
	if err := agApply(doc, Insert{ID: "n", Block: node(t, []byte(`{"type":"paragraph","data":{},"createdBy":"human-1","createdWith":"agent-cs"}`))}); err != nil {
		t.Fatal(err)
	}
	if got := canonical(t, agField(agExported(t, doc)[0], "createdWith")); got != `"agent-cs"` {
		t.Fatalf("createdWith %s", got)
	}
}

func TestLiftThenRemoveKeepsTheChildrenInTheSlot(t *testing.T) {
	doc := agSeeded(t, string(agMoves(t).Seed))
	if err := agApply(doc, Lift{ID: "a"}, Remove{ID: "a"}); err != nil {
		t.Fatal(err)
	}
	blocks := agExported(t, doc)
	if agIDs(blocks) != "a1,a2,b" {
		t.Fatalf("blocks %s", canonical(t, blocks))
	}
	for _, block := range blocks {
		if agField(block, "parent") != nil {
			t.Fatalf("blocks %s", canonical(t, blocks))
		}
	}
}

func TestTheNewOpsRefuseAnUnknownBlock(t *testing.T) {
	empty := node(t, []byte(`{}`))
	for _, op := range []EditOp{
		Retype{ID: "x", Type: "header", Data: empty},
		SetTunes{ID: "x", Tunes: empty},
		SetMetadata{ID: "x", LastEditedAt: 1, LastEditedBy: "a"},
		Lift{ID: "x"},
	} {
		agRefused(t, agApply(agSeeded(t, `[]`), op))
	}
}

// Twins of C# AgentRoomMoveTests: a peer types in a block while the server
// moves or retypes it, then they sync both ways; the typing survives.
func TestAMoveOrRetypeKeepsAPeersConcurrentTyping(t *testing.T) {
	for _, row := range []struct {
		name, seed string
		op         EditOp
		check      func(t *testing.T, blocks []any)
	}{
		{"move", `[{"id":"t","type":"toggle","data":{"text":[]}},{"id":"p","type":"paragraph","data":{"text":[{"text":"ab"}]}}]`,
			Move{ID: "p", Parent: agPtr("t")}, func(t *testing.T, blocks []any) {
				p := agBlock(blocks, "p")
				if canonical(t, agField(p, "parent")) != `"t"` || canonical(t, agField(agField(p, "data"), "text")) != `[{"text":"aXb"}]` ||
					canonical(t, agField(agBlock(blocks, "t"), "content")) != `["p"]` {
					t.Fatalf("blocks %s", canonical(t, blocks))
				}
			}},
		{"retype", `[{"id":"p","type":"paragraph","data":{"text":[{"text":"ab"}]}}]`,
			Retype{ID: "p", Type: "header", Data: nil}, func(t *testing.T, blocks []any) {
				p := blocks[0]
				if canonical(t, agField(p, "type")) != `"header"` || canonical(t, agField(agField(p, "data"), "text")) != `[{"text":"aXb"}]` {
					t.Fatalf("blocks %s", canonical(t, blocks))
				}
			}},
	} {
		t.Run(row.name, func(t *testing.T) {
			server := agSeeded(t, row.seed)
			peer := yjs.NewDoc(yjs.Options{})
			sync := func(to, from *yjs.Doc) {
				update, err := from.EncodeStateAsUpdate(nil)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := to.ApplyUpdate(update); err != nil {
					t.Fatal(err)
				}
			}
			sync(peer, server)
			if err := agApply(peer, Update{ID: "p", Data: node(t, []byte(`{"text":[{"text":"aXb"}]}`))}); err != nil {
				t.Fatal(err)
			}
			op := row.op
			if retype, ok := op.(Retype); ok {
				retype.Data = node(t, []byte(`{"text":[{"text":"ab"}],"level":2}`))
				op = retype
			}
			if err := agApply(server, op); err != nil {
				t.Fatal(err)
			}
			sync(server, peer)
			sync(peer, server)
			for _, doc := range []*yjs.Doc{server, peer} {
				row.check(t, agExported(t, doc))
			}
		})
	}
}

// C# AgentRoomOpsTests.SeedCarriesTitleAndIconIntoThePageRoot.
func TestSeedCarriesTitleAndIconIntoThePageRoot(t *testing.T) {
	converter := &DocConverter{Now: time.Now}
	doc := yjs.NewDoc(yjs.Options{})
	if err := converter.Seed(context.Background(), doc, node(t, []byte(`{"title":"T","icon":{"type":"emoji","value":"x"},"blocks":[]}`))); err != nil {
		t.Fatal(err)
	}
	exported, err := converter.Export(context.Background(), doc)
	if err != nil {
		t.Fatal(err)
	}
	if canonical(t, agField(exported, "title")) != `"T"` || canonical(t, agField(agField(exported, "icon"), "value")) != `"x"` {
		t.Fatalf("export %s", canonical(t, exported))
	}
}

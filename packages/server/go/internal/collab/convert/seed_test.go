package convert

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/collabtest"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsruntime"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

var (
	poolOnce   sync.Once
	sharedPool *jsruntime.Pool
	poolErr    error
)

func runtimeReader(t *testing.T) HTMLReader {
	poolOnce.Do(func() { sharedPool, poolErr = jsruntime.NewPool(jsruntime.Options{PoolSize: new(1)}) })
	if poolErr != nil {
		t.Fatal(poolErr)
	}
	return RuntimeHTMLReader{sharedPool}
}

func nodeOf(t *testing.T, relative string) *jsjson.Node {
	data, err := os.ReadFile(collabtest.Path(t, relative))
	if err != nil {
		t.Fatal(err)
	}
	node, err := jsjson.ParseNode(data, jsjson.Options{MaxDepth: JSONMaxDepth})
	if err != nil {
		t.Fatal(err)
	}
	return node
}

// converting is RichTextRuntime: collect the seed's HTML, read it in the runtime.
func converting(t *testing.T, blocks []*jsjson.Node) *RichTextInput {
	found, err := CollectSeedHTML(blocks, BuiltInRichTextFields())
	if err != nil {
		t.Fatal(err)
	}
	read, err := runtimeReader(t).Read(context.Background(), found, nil)
	if err != nil {
		t.Fatal(err)
	}
	converted := map[string][]any{}
	for i, field := range found {
		converted[HTMLKey(field.HTML)] = read[i]
	}
	return Converting(BuiltInRichTextFields(), converted)
}

func exported(t *testing.T, doc *yjs.Doc) []any {
	blocks, slots, err := Export(doc, BuiltInRichTextFields(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(slots) > 0 {
		t.Fatalf("%d HTML slots", len(slots))
	}
	return blocks
}

// Twins of SeedingInputJsonExportsCanonicalJson and
// SeedRoundTripsThroughStateDiffIntoASecondDoc.
func TestSeedingTheInputExportsTheCanonicalJSON(t *testing.T) {
	for _, c := range collabCases(t) {
		blocks := nodeOf(t, "collab/"+c.name+"/input.json").Items
		source := yjs.NewDoc(yjs.Options{})
		if err := Seed(source, blocks, converting(t, blocks), nil); err != nil {
			t.Errorf("%s: %v", c.name, err)
			continue
		}
		want := canonical(t, c.segments)
		if got := canonical(t, exported(t, source)); got != want {
			t.Errorf("%s seed:\n got %s\nwant %s", c.name, got, want)
			continue
		}
		replica := yjs.NewDoc(yjs.Options{})
		diff, err := source.EncodeStateAsUpdate(replica.EncodeStateVector())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := replica.ApplyUpdate(diff); err != nil {
			t.Fatal(err)
		}
		if got := canonical(t, exported(t, replica)); got != want {
			t.Errorf("%s replica:\n got %s\nwant %s", c.name, got, want)
		}
	}
}

// Twin of SeedingPageJsonExportsCanonicalPage.
func TestSeedingThePageExportsTheCanonicalPage(t *testing.T) {
	pages := 0
	for _, c := range collabCases(t) {
		if c.page == nil {
			continue
		}
		pages++
		blocks := nodeOf(t, "collab/"+c.name+"/input.json").Items
		doc := yjs.NewDoc(yjs.Options{})
		page, err := strictValue(nodeOf(t, "collab/"+c.name+"/page.json"))
		if err != nil {
			t.Fatal(err)
		}
		if err := Seed(doc, blocks, converting(t, blocks), page.(*jsjson.Object)); err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if got, want := canonical(t, ExportPage(doc)), canonical(t, c.pageCanon); got != want {
			t.Errorf("%s:\n got %s\nwant %s", c.name, got, want)
		}
	}
	if pages != 13 {
		t.Fatalf("%d page cases", pages)
	}
}

func seedJSON(t *testing.T, text string) *yjs.Doc {
	node, err := jsjson.ParseNode([]byte(text), jsjson.Options{MaxDepth: JSONMaxDepth})
	if err != nil {
		t.Fatal(err)
	}
	doc := yjs.NewDoc(yjs.Options{})
	if err := Seed(doc, node.Items, Refusing(BuiltInRichTextFields()), nil); err != nil {
		t.Fatal(err)
	}
	return doc
}

// Two rows naming one rowId cannot share a key: the second gets a minted one.
func TestASecondRowWithTheSameRowIDGetsItsOwnKey(t *testing.T) {
	doc := seedJSON(t, `[{"id":"t","type":"table","data":{"content":[[{"rowId":"r"}],[{"rowId":"r","x":1}]]}}]`)
	got := canonical(t, exported(t, doc))
	want := `[{"data":{"content":[[{"rowId":"r"}],[{"rowId":"r","x":1}]]},"id":"t","type":"table"}]`
	if got != want {
		t.Fatalf("%s", got)
	}
}

// A content string spreads into runes, an astral character whole. A lone
// surrogate never gets here: reading the string fails first, as in C#.
func TestAContentStringSpreadsIntoRunes(t *testing.T) {
	doc := seedJSON(t, `[{"id":"p","type":"paragraph","data":{},"content":"a\ud83d\ude00b"}]`)
	block, _ := doc.GetMap(str(blocksRoot)).Get(str("p"))
	ids, _ := block.(*yjs.Map).Get(str("contentIds"))
	got, err := jsjson.Stringify(ids.(*yjs.Array).Values())
	if err != nil {
		t.Fatal(err)
	}
	if got != "[\"a\",\"\U0001F600\",\"b\"]" {
		t.Fatalf("%s", got)
	}
}

// GetValue<string> throws InvalidOperationException on a lone-surrogate
// escape (probed), so a seed reading one fails, and not as a DataError.
func TestASeedStringThatIsNotUnicodeFails(t *testing.T) {
	node, err := jsjson.ParseNode([]byte(`[{"id":"p","type":"paragraph","data":{"x":"\ud800"}}]`), jsjson.Options{MaxDepth: JSONMaxDepth})
	if err != nil {
		t.Fatal(err)
	}
	err = Seed(yjs.NewDoc(yjs.Options{}), node.Items, Refusing(BuiltInRichTextFields()), nil)
	var data *DataError
	if !errors.Is(err, ErrNotUnicode) || errors.As(err, &data) {
		t.Fatalf("%v", err)
	}
}

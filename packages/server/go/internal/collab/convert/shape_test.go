package convert

import (
	"slices"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

// shape names every shared type and leaf under v. Grid and identity row
// keys are left out (the client mints random ones); a row keyed by its
// table rowId is marked, since the key is then deterministic.
func shape(t *testing.T, v any) string {
	var b strings.Builder
	var walk func(any)
	walk = func(v any) {
		switch v := v.(type) {
		case *yjs.Map:
			if isGridMap(v) {
				rows := value(v, gridRowsKey).(*yjs.Map)
				b.WriteString("G[")
				for _, key := range gridRowKeys(v, rows) {
					row, _ := rows.Get(key)
					if len(key) != rowKeyLength {
						b.WriteString(key.String() + "=")
					}
					walk(row)
					b.WriteByte(',')
				}
				b.WriteByte(']')
				return
			}
			keys := v.Keys()
			slices.SortFunc(keys, jsjson.Compare)
			b.WriteString("M{")
			for _, key := range keys {
				b.WriteString(key.String() + ":")
				child, _ := v.Get(key)
				walk(child)
				b.WriteByte(',')
			}
			b.WriteByte('}')
		case *yjs.Array:
			b.WriteString("A[")
			for _, item := range v.Values() {
				walk(item)
				b.WriteByte(',')
			}
			b.WriteByte(']')
		case *yjs.XmlText:
			b.WriteString("X" + canonical(t, FromDelta(v.ToDelta())))
		case *yjs.Text:
			b.WriteString("T" + string(jsjson.AppendQuoted(nil, v.Units())))
		default:
			text, err := jsjson.Stringify(v)
			if err != nil {
				t.Fatalf("%T: %v", v, err)
			}
			b.WriteString("V" + text)
		}
	}
	walk(v)
	return b.String()
}

func docShape(t *testing.T, doc *yjs.Doc) string {
	return shape(t, doc.GetMap(str(blocksRoot))) + "|" + shape(t, doc.GetArray(str(orderRoot)))
}

// The seed builds the same shared types the client's fromJSON wrote into
// update.b64: maps, arrays, texts, grids and leaves, block by block.
// The cases with a mutate step in scripts/generate-collab-fixtures.mjs are
// left out: their update.b64 holds a shape fromJSON never writes.
func TestSeedBuildsTheTypesTheClientBuilds(t *testing.T) {
	mutated := map[string]bool{"grid-normalization": true, "legacy-bare-grid": true, "malformed-doc-blocks": true}
	compared := 0
	for _, c := range collabCases(t) {
		if mutated[c.name] {
			delete(mutated, c.name)
			continue
		}
		compared++
		blocks := nodeOf(t, "collab/"+c.name+"/input.json").Items
		seeded := yjs.NewDoc(yjs.Options{})
		if err := Seed(seeded, blocks, converting(t, blocks), nil); err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if got, want := docShape(t, seeded), docShape(t, applied(t, c.update)); got != want {
			t.Errorf("%s:\n got %s\nwant %s", c.name, got, want)
		}
	}
	if len(mutated) > 0 || compared < 25 {
		t.Fatalf("missing mutate cases %v, compared %d", mutated, compared)
	}
}

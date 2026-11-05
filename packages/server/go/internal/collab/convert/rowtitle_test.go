package convert

import (
	"slices"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

// Twins of C# YDocConverterDatabaseRowTitleTests. A plain string and a YText
// export to the same JSON, so these read the CRDT types, not the export.

const rowWithTitle = `[{ "id": "r1", "type": "database-row",
  "data": { "title": "Ship it", "properties": { "status": "todo" } } }]`

func rowEntry(t *testing.T, m *yjs.Map, key string) any {
	t.Helper()
	value, ok := m.Get(str(key))
	if !ok {
		t.Fatalf("no entry %s", key)
	}
	return value
}

func rowData(t *testing.T, doc *yjs.Doc, id string) *yjs.Map {
	t.Helper()
	block, ok := rowEntry(t, doc.GetMap(str("blocks")), id).(*yjs.Map)
	if !ok {
		t.Fatalf("%s is not a map", id)
	}
	data, ok := rowEntry(t, block, "data").(*yjs.Map)
	if !ok {
		t.Fatalf("%s data is not a map", id)
	}
	return data
}

func rowTitle(t *testing.T, doc *yjs.Doc) *yjs.Text {
	t.Helper()
	title, ok := rowEntry(t, rowData(t, doc, "r1"), "title").(*yjs.Text)
	if !ok {
		t.Fatalf("title is %T, want a YText", rowEntry(t, rowData(t, doc, "r1"), "title"))
	}
	return title
}

func rowApply(t *testing.T, doc *yjs.Doc, op string) {
	t.Helper()
	ops, err := ParseEditOps([]byte(`{ "ops": [` + op + `] }`))
	if err != nil {
		t.Fatal(err)
	}
	if err := agApply(doc, ops...); err != nil {
		t.Fatal(err)
	}
}

func rowExchange(t *testing.T, left, right *yjs.Doc) {
	t.Helper()
	toRight, err := left.EncodeStateAsUpdate(right.EncodeStateVector())
	if err != nil {
		t.Fatal(err)
	}
	toLeft, err := right.EncodeStateAsUpdate(left.EncodeStateVector())
	if err != nil {
		t.Fatal(err)
	}
	for _, step := range []struct {
		doc    *yjs.Doc
		update []byte
	}{{right, toRight}, {left, toLeft}} {
		if result, err := step.doc.ApplyUpdate(step.update); err != nil || result.Outcome != yjs.Applied {
			t.Fatalf("apply: %v %v", result.Outcome, err)
		}
	}
}

func rowPeer(t *testing.T, server *yjs.Doc) *yjs.Doc {
	t.Helper()
	peer := yjs.NewDoc(yjs.Options{})
	update, err := server.EncodeStateAsUpdate(peer.EncodeStateVector())
	if err != nil {
		t.Fatal(err)
	}
	if result, err := peer.ApplyUpdate(update); err != nil || result.Outcome != yjs.Applied {
		t.Fatalf("apply: %v %v", result.Outcome, err)
	}
	return peer
}

func rowType(doc *yjs.Doc, title *yjs.Text, index int, characters string) {
	doc.Transact(func(tx *yjs.Transaction) { title.Insert(tx, index, str(characters), nil) })
}

func TestSeedStoresADatabaseRowTitleAsAYText(t *testing.T) {
	if got := rowTitle(t, agSeeded(t, rowWithTitle)).String(); got != "Ship it" {
		t.Fatal(got)
	}
}

func TestAnInsertOpMintsAYTextForTheRowTitle(t *testing.T) {
	doc := agSeeded(t, `[{ "id": "p", "type": "paragraph", "data": { "text": "" } }]`)
	rowApply(t, doc, `{ "op": "insert", "id": "r1", "after": "p",
  "block": { "type": "database-row", "data": { "title": "Ship it" } } }`)
	if got := rowTitle(t, doc).String(); got != "Ship it" {
		t.Fatal(got)
	}
}

func TestAnEditKeepsTheSameYTextInstanceForTheRowTitle(t *testing.T) {
	doc := agSeeded(t, rowWithTitle)
	before := rowTitle(t, doc)
	rowApply(t, doc, `{ "op": "update", "id": "r1", "data": { "title": "Ship it!" } }`)
	after := rowTitle(t, doc)
	if before != after || after.String() != "Ship it!" {
		t.Fatalf("same %v, title %q", before == after, after.String())
	}
}

// The row was seeded by the server; a client types into its title while the
// server pushes an /edit. Both bursts survive.
func TestAServerSeededRowMergesAClientsTypingWithAnEdit(t *testing.T) {
	server := agSeeded(t, rowWithTitle)
	client := rowPeer(t, server)
	rowType(client, rowTitle(t, client), len("Ship it"), " now")
	rowApply(t, server, `{ "op": "update", "id": "r1", "data": { "title": "Do Ship it" } }`)
	rowExchange(t, server, client)
	merged := rowTitle(t, server).String()
	if merged != "Do Ship it now" || rowTitle(t, client).String() != merged {
		t.Fatalf("server %q, client %q", merged, rowTitle(t, client).String())
	}
}

func TestTwoClientsTypingInOneRowTitleKeepBothBursts(t *testing.T) {
	server := agSeeded(t, rowWithTitle)
	left, right := rowPeer(t, server), rowPeer(t, server)
	rowType(left, rowTitle(t, left), 0, "A ")
	rowType(right, rowTitle(t, right), len("Ship it"), " B")
	rowExchange(t, server, left)
	rowExchange(t, server, right)
	rowExchange(t, server, left)
	for _, doc := range []*yjs.Doc{server, left, right} {
		if got := rowTitle(t, doc).String(); got != "A Ship it B" {
			t.Fatal(got)
		}
	}
}

// Only top-level data keys are diffable, so a nested title stays atomic.
func TestAnOldRowKeepsItsNestedTitleAtomic(t *testing.T) {
	doc := agSeeded(t, `[{ "id": "r0", "type": "database-row",
  "data": { "properties": { "title": "Legacy", "status": "todo" } } }]`)
	properties, ok := rowEntry(t, rowData(t, doc, "r0"), "properties").(*yjs.Map)
	if !ok {
		t.Fatal("properties is not a map")
	}
	if nested, ok := rowEntry(t, properties, "title").(jsjson.Str); !ok || nested.String() != "Legacy" {
		t.Fatalf("nested title %T", rowEntry(t, properties, "title"))
	}
}

// A whole-key set is last-writer-wins, so inventing a top-level title for an
// old row would lose data.
func TestTheServerNeverInventsATopLevelTitleForAnOldRow(t *testing.T) {
	doc := agSeeded(t, `[{ "id": "r0", "type": "database-row",
  "data": { "properties": { "title": "Legacy" } } }]`)
	keys := func() []string {
		var names []string
		for _, key := range rowData(t, doc, "r0").Keys() {
			names = append(names, key.String())
		}
		return names
	}
	if got := keys(); !slices.Equal(got, []string{"properties"}) {
		t.Fatal(got)
	}
	rowApply(t, doc, `{ "op": "update", "id": "r0",
  "data": { "properties": { "title": "Legacy", "status": "done" } } }`)
	if got := keys(); !slices.Equal(got, []string{"properties"}) {
		t.Fatal(got)
	}
	want := `[{"id":"r0","type":"database-row","data":{"properties":{"title":"Legacy","status":"done"}}}]`
	if got := stringify(t, agExported(t, doc)); got != want {
		t.Fatal(got)
	}
}

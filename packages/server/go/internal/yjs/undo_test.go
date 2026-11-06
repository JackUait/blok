package yjs

import (
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
)

func peers(t *testing.T) (*Doc, *Doc, func()) {
	t.Helper()
	one := uint32(1)
	two := uint32(2)
	mine := NewDoc(Options{ClientID: &one, NoGC: true})
	theirs := NewDoc(Options{ClientID: &two, NoGC: true})
	sync := func() {
		for _, pair := range [][2]*Doc{{mine, theirs}, {theirs, mine}} {
			update, err := pair[0].EncodeStateAsUpdate(pair[1].EncodeStateVector())
			if err != nil {
				t.Fatal(err)
			}
			if _, err := pair[1].ApplyUpdate(update); err != nil {
				t.Fatal(err)
			}
		}
	}
	return mine, theirs, sync
}

func TestUndoRestoresAMapKeyAndRedoPutsItBack(t *testing.T) {
	doc, _, _ := peers(t)
	undo := NewUndoManager(doc)
	doc.Transact(func(t *Transaction) { doc.GetMap(s("m")).Set(t, s("k"), s("one")) })
	undo.Capture(func(t *Transaction) { doc.GetMap(s("m")).Set(t, s("k"), s("two")) })
	if changed, err := undo.Undo(); err != nil || !changed {
		t.Fatalf("undo: %v %v", changed, err)
	}
	if value, _ := doc.GetMap(s("m")).Get(s("k")); !equalStr(value, "one") {
		t.Fatalf("after undo %v", value)
	}
	if changed, err := undo.Redo(); err != nil || !changed {
		t.Fatalf("redo: %v %v", changed, err)
	}
	if value, _ := doc.GetMap(s("m")).Get(s("k")); !equalStr(value, "two") {
		t.Fatalf("after redo %v", value)
	}
}

func TestUndoKeepsAPeersTextTypedAfterTheStep(t *testing.T) {
	mine, theirs, sync := peers(t)
	mine.Transact(func(t *Transaction) { mine.GetText(s("t")).Insert(t, 0, s("Hello"), nil) })
	undo := NewUndoManager(mine)
	undo.Capture(func(t *Transaction) { mine.GetText(s("t")).Insert(t, 0, s(">> "), nil) })
	sync()
	theirs.Transact(func(t *Transaction) { theirs.GetText(s("t")).Insert(t, 8, s(" world"), nil) })
	sync()
	if _, err := undo.Undo(); err != nil {
		t.Fatal(err)
	}
	if got := mine.GetText(s("t")).String(); got != "Hello world" {
		t.Fatalf("after undo %q", got)
	}
	if _, err := undo.Redo(); err != nil {
		t.Fatal(err)
	}
	if got := mine.GetText(s("t")).String(); got != ">> Hello world" {
		t.Fatalf("after redo %q", got)
	}
}

func TestUndoOfAnInsertRemovesItAndRedoBringsANestedMapBack(t *testing.T) {
	doc, _, _ := peers(t)
	undo := NewUndoManager(doc)
	undo.Capture(func(t *Transaction) {
		block := NewMap()
		doc.GetMap(s("blocks")).Set(t, s("p1"), block)
		block.Set(t, s("text"), s("hi"))
		doc.GetArray(s("order")).Insert(t, 0, []any{s("p1")})
	})
	if _, err := undo.Undo(); err != nil {
		t.Fatal(err)
	}
	if _, ok := doc.GetMap(s("blocks")).Get(s("p1")); ok || doc.GetArray(s("order")).Len() != 0 {
		t.Fatal("the insert stayed")
	}
	if _, err := undo.Redo(); err != nil {
		t.Fatal(err)
	}
	block, ok := doc.GetMap(s("blocks")).Get(s("p1"))
	nested, _ := block.(*Map)
	if !ok || nested == nil || doc.GetArray(s("order")).Len() != 1 {
		t.Fatalf("redo left %v", block)
	}
	if value, _ := nested.Get(s("text")); !equalStr(value, "hi") {
		t.Fatalf("the nested key came back as %v", value)
	}
}

func TestOnlyCapturedTransactionsAreSteps(t *testing.T) {
	doc, _, _ := peers(t)
	undo := NewUndoManager(doc)
	doc.Transact(func(t *Transaction) { doc.GetMap(s("m")).Set(t, s("k"), s("local")) })
	if undo.UndoTop() != nil {
		t.Fatal("an uncaptured transaction became a step")
	}
}

func equalStr(value any, want string) bool {
	text, ok := value.(jsjson.Str)
	return ok && text.String() == want
}

func TestPreviewShowsTheUndoAndLeavesTheDocAlone(t *testing.T) {
	doc, _, _ := peers(t)
	undo := NewUndoManager(doc)
	doc.Transact(func(t *Transaction) { doc.GetMap(s("m")).Set(t, s("k"), s("one")) })
	undo.Capture(func(t *Transaction) { doc.GetMap(s("m")).Set(t, s("k"), s("two")) })
	preview, err := undo.Preview(true)
	if err != nil {
		t.Fatal(err)
	}
	if value, _ := preview.GetMap(s("m")).Get(s("k")); !equalStr(value, "one") {
		t.Fatalf("the preview has %v", value)
	}
	if value, _ := doc.GetMap(s("m")).Get(s("k")); !equalStr(value, "two") || undo.UndoTop() == nil {
		t.Fatalf("the doc changed to %v", value)
	}
}

// The copy must replay the step the real stacks replay, redone links
// included, or an approval gate judges the wrong outcome.
func TestPreviewMatchesTheUndoAfterUndoRedo(t *testing.T) {
	doc, _, _ := peers(t)
	undo := NewUndoManager(doc)
	doc.Transact(func(t *Transaction) {
		block := NewMap()
		doc.GetMap(s("blocks")).Set(t, s("db"), block)
		block.Set(t, s("locked"), false)
	})
	block := func(d *Doc) *Map {
		value, _ := d.GetMap(s("blocks")).Get(s("db"))
		m, _ := value.(*Map)
		return m
	}
	undo.Capture(func(t *Transaction) { block(doc).Set(t, s("locked"), true) })
	if _, err := undo.Undo(); err != nil {
		t.Fatal(err)
	}
	if _, err := undo.Redo(); err != nil {
		t.Fatal(err)
	}
	preview, err := undo.Preview(true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := undo.Undo(); err != nil {
		t.Fatal(err)
	}
	want, _ := block(doc).Get(s("locked"))
	got, _ := block(preview).Get(s("locked"))
	if got != want || want != false {
		t.Fatalf("the preview has locked=%v, the undo locked=%v", got, want)
	}
	for item, live := range redoneLinks(doc) {
		if copied := redoneLinks(preview)[item]; copied != live {
			t.Fatalf("the copy lost the redone link of %v", item)
		}
	}
}

func redoneLinks(d *Doc) map[ID]ID {
	links := map[ID]ID{}
	for _, structs := range d.store.clients {
		for _, s := range structs {
			if item, ok := s.(*Item); ok && item.redone != nil {
				links[item.id] = *item.redone
			}
		}
	}
	return links
}

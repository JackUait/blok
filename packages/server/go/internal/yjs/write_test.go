package yjs

import (
	"slices"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/lib0"
)

// Ports of the YDocWriteTests, YTextFormattingTests and StructStoreTests
// cases that need no Node replay.

func expectPanic(t *testing.T, what string, run func()) {
	t.Helper()
	defer func() {
		if recover() == nil {
			t.Errorf("%s: no panic", what)
		}
	}()
	run()
}

func ownStructs(doc *Doc) []Struct { return doc.store.clients[doc.clientID] }

func TestSetPacksEveryPrimitiveAsAnyOfLengthOne(t *testing.T) {
	doc := docWithID(4242)
	blocks := doc.GetMap(s("blocks"))
	doc.Transact(func(txn *Transaction) {
		blocks.Set(txn, s("nothing"), nil)
		blocks.Set(txn, s("flag"), true)
		blocks.Set(txn, s("number"), 42.0)
		blocks.Set(txn, s("text"), s("v"))
		blocks.Set(txn, s("object"), obj("a", 1.0))
		blocks.Set(txn, s("array"), []any{s("x")})
		blocks.Set(txn, s("binary"), []byte{1, 2, 3})
	})
	structs := ownStructs(doc)
	if len(structs) != 7 {
		t.Fatalf("%d structs", len(structs))
	}
	for _, current := range structs[:6] {
		if content, ok := current.(*Item).content.(*ContentAny); !ok || content.Len() != 1 {
			t.Fatalf("%T", current.(*Item).content)
		}
	}
	if _, ok := structs[6].(*Item).content.(*ContentBinary); !ok {
		t.Fatal("bytes are not ContentBinary")
	}
}

func TestInsertPacksConsecutiveAnysIntoOneItemAndATypeFlushes(t *testing.T) {
	doc := docWithID(4242)
	list := doc.GetArray(s("list"))
	doc.Transact(func(txn *Transaction) { list.Insert(txn, 0, []any{s("a"), 1.0, true, nil}) })
	if structs := ownStructs(doc); len(structs) != 1 || structs[0].(*Item).content.Len() != 4 {
		t.Fatal("the run was not packed")
	}
	other := docWithID(4242)
	otherList := other.GetArray(s("list"))
	other.Transact(func(txn *Transaction) { otherList.Insert(txn, 0, []any{s("a"), NewMap(), s("b")}) })
	var kinds []byte
	for _, current := range ownStructs(other) {
		kinds = append(kinds, current.(*Item).content.Ref())
	}
	if !slices.Equal(kinds, []byte{8, 7, 8}) {
		t.Fatalf("refs %v", kinds)
	}
}

func TestNoChangeEmitsNothing(t *testing.T) {
	doc := docWithID(4242)
	blocks, list, content := doc.GetMap(s("blocks")), doc.GetArray(s("list")), doc.GetText(s("content"))
	emitted := 0
	doc.OnUpdate(func(UpdateEvent) { emitted++ })
	for name, body := range map[string]func(*Transaction){
		"nothing":       func(*Transaction) {},
		"absent key":    func(txn *Transaction) { blocks.Delete(txn, s("absent")) },
		"clear":         func(txn *Transaction) { blocks.Clear(txn) },
		"empty insert":  func(txn *Transaction) { list.Insert(txn, 0, nil) },
		"empty delete":  func(txn *Transaction) { list.Delete(txn, 0, 0) },
		"empty text":    func(txn *Transaction) { content.Insert(txn, 0, s(""), nil) },
		"empty removal": func(txn *Transaction) { content.Delete(txn, 0, 0) },
	} {
		if doc.Transact(body) != nil {
			t.Errorf("%s emitted", name)
		}
	}
	if emitted != 0 {
		t.Fatalf("%d emitted", emitted)
	}
}

func TestNestedTransactJoinsAndOnlyTheOutermostEmits(t *testing.T) {
	doc := docWithID(4242)
	blocks := doc.GetMap(s("blocks"))
	var inner []byte
	outer := doc.Transact(func(txn *Transaction) {
		blocks.Set(txn, s("a"), 1.0)
		inner = doc.Transact(func(nested *Transaction) {
			if nested != txn {
				t.Error("a nested call opened a second transaction")
			}
			blocks.Set(nested, s("b"), 2.0)
		})
	})
	if inner != nil || outer == nil || len(mustDecode(t, outer).Groups[0].Structs) != 2 {
		t.Fatalf("inner %x outer %x", inner, outer)
	}
}

func TestPrelimMapIntegratesWithItsParent(t *testing.T) {
	doc := docWithID(4242)
	blocks := doc.GetMap(s("blocks"))
	row := NewMap(MapEntry{s("title"), s("first")}, MapEntry{s("tags"), NewArray(s("a"), s("b"))})
	if row.Doc() != nil {
		t.Fatal("a prelim map has a doc")
	}
	doc.Transact(func(txn *Transaction) { blocks.Set(txn, s("b1"), row) })
	value, _ := blocks.Get(s("b1"))
	title, _ := row.Get(s("title"))
	if row.Doc() != doc || value != AbstractType(row) || title.(jsjson.Str).String() != "first" {
		t.Fatal("the prelim map did not integrate")
	}
	expectPanic(t, "a type already in a document", func() {
		doc.Transact(func(txn *Transaction) { blocks.Set(txn, s("again"), row) })
	})
}

func TestDeleteFromArraySplitsARun(t *testing.T) {
	doc := docWithID(4242)
	list := doc.GetArray(s("list"))
	doc.Transact(func(txn *Transaction) { list.Insert(txn, 0, []any{s("a"), s("b"), s("c"), s("d")}) })
	doc.Transact(func(txn *Transaction) { list.Delete(txn, 1, 2) })
	if got := shapeOf(ownStructs(doc)); !slices.Equal(got, []shape{{0, 1, false}, {1, 2, true}, {3, 1, false}}) {
		t.Fatalf("%v", got)
	}
	if values := list.Values(); len(values) != 2 || values[1].(jsjson.Str).String() != "d" {
		t.Fatalf("%v", values)
	}
	expectPanic(t, "a delete past the end", func() {
		doc.Transact(func(txn *Transaction) { list.Delete(txn, 1, 5) })
	})
}

func TestInsertRejectsUndefinedAndBigIntLikeYjs(t *testing.T) {
	doc := docWithID(4242)
	list := doc.GetArray(s("list"))
	expectPanic(t, "undefined in a list", func() {
		doc.Transact(func(txn *Transaction) { list.Insert(txn, 0, []any{jsjson.Undefined{}}) })
	})
	expectPanic(t, "bigint in a list", func() {
		doc.Transact(func(txn *Transaction) { list.Insert(txn, 0, []any{lib0.BigInt(1)}) })
	})
	expectPanic(t, "bigint in a map", func() {
		doc.Transact(func(txn *Transaction) { doc.GetMap(s("blocks")).Set(txn, s("big"), lib0.BigInt(1)) })
	})
	if len(doc.store.order) != 0 {
		t.Fatal("a refused write reached the store")
	}
	blocks := doc.GetMap(s("blocks"))
	doc.Transact(func(txn *Transaction) { blocks.Set(txn, s("undef"), jsjson.Undefined{}) })
	if value, ok := blocks.Get(s("undef")); !ok || value != (jsjson.Undefined{}) {
		t.Fatalf("undefined in a map: %#v", value)
	}
}

func TestADetachedTypeRefusesWrites(t *testing.T) {
	doc := docWithID(4242)
	expectPanic(t, "a write to a prelim map", func() {
		doc.Transact(func(txn *Transaction) { NewMap().Set(txn, s("k"), 1.0) })
	})
	expectPanic(t, "a write to a prelim array", func() {
		doc.Transact(func(txn *Transaction) { NewArray().Insert(txn, 0, []any{1.0}) })
	})
	expectPanic(t, "an attached text with no transaction", func() {
		doc.GetText(s("t")).Insert(nil, 0, s("a"), nil)
	})
	expectPanic(t, "a root typed twice", func() { doc.GetArray(s("t")) })
}

func TestAQueuedTextWriteIsCheckedWhenMade(t *testing.T) {
	text := NewXmlText(nil)
	expectPanic(t, "an undefined mark", func() {
		text.Insert(nil, 0, s("a"), obj("bold", jsjson.Undefined{}))
	})
	expectPanic(t, "a string embed", func() { text.InsertEmbed(nil, 0, s("x"), nil) })
	text.Insert(nil, 0, s("ab"), obj("bold", true))
	doc := docWithID(4242)
	doc.Transact(func(txn *Transaction) { doc.GetMap(s("m")).Set(txn, s("t"), text) })
	delta := text.ToDelta()
	if len(delta) != 1 || delta[0].Insert.(jsjson.Str).String() != "ab" || delta[0].Attributes == nil {
		t.Fatalf("%+v", delta)
	}
}

func TestMarksAreWrittenInJSKeyOrder(t *testing.T) {
	doc := docWithID(4242)
	text := doc.GetText(s("t"))
	doc.Transact(func(txn *Transaction) { text.Insert(txn, 0, s("a"), obj("b", true, "1", true, "a", true)) })
	var keys []string
	for item := text.start; item != nil; item = item.right {
		if format, ok := item.content.(*ContentFormat); ok && format.Value() != nil {
			keys = append(keys, format.Key.String())
		}
	}
	if !slices.Equal(keys, []string{"1", "b", "a"}) {
		t.Fatalf("marks in order %v", keys)
	}
}

func TestToDeltaReadsANullEmbedAndSkipsFormatsInToString(t *testing.T) {
	doc := docWithID(4242)
	text := doc.GetText(s("t"))
	root := s("t")
	applyStructs(t, doc, []*DecodedStruct{
		{ID: ID{peer, 0}, Length: 1, Kind: KindItem, ParentRoot: &root, Content: &ContentEmbed{JSON: s("null")}, Info: 0x05},
		{ID: ID{peer, 1}, Length: 1, Kind: KindItem, Origin: &ID{peer, 0}, Content: &ContentFormat{Key: s("bold"), JSON: s("true")}, Info: 0x86},
		{ID: ID{peer, 2}, Length: 2, Kind: KindItem, Origin: &ID{peer, 1}, Content: &ContentString{Text: s("hi")}, Info: 0x84},
	}, nil)
	delta := text.ToDelta()
	if len(delta) != 2 || delta[0].Insert != nil || delta[1].Insert.(jsjson.Str).String() != "hi" || delta[1].Attributes == nil {
		t.Fatalf("%+v", delta)
	}
	if text.String() != "hi" {
		t.Fatalf("%q", text.String())
	}
}

func TestContentStringSpliceReplacesASplitSurrogatePair(t *testing.T) {
	left := &ContentString{Text: s("a😀b")}
	right := left.splice(2).(*ContentString)
	if !slices.Equal(left.Text, jsjson.Str{'a', 0xfffd}) || !slices.Equal(right.Text, jsjson.Str{0xfffd, 'b'}) {
		t.Fatalf("%x %x", left.Text, right.Text)
	}
}

func TestEqualAttrsComparesFlatAndStrictEqualsByIdentity(t *testing.T) {
	a, b := obj("href", s("x"), "rel", s("y")), obj("rel", s("y"), "href", s("x"))
	if !equalAttrs(a, b) || strictEquals(a, b) || !strictEquals(a, a) {
		t.Fatal("objects")
	}
	nan := jsjson.NaN()
	if strictEquals(nan, nan) || !strictEquals(0.0, -0.0) {
		t.Fatal("numbers")
	}
	items := []any{1.0}
	if !strictEquals(items, items) || strictEquals(items, []any{1.0}) || !equalAttrs(items, []any{1.0}) {
		t.Fatal("arrays")
	}
	if equalAttrs(obj("a", obj()), obj("a", obj())) {
		t.Fatal("a nested object only equals itself")
	}
}

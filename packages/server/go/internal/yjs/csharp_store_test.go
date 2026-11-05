package yjs

import (
	"slices"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// The C# StructStoreTests and YDocWriteTests assertions the older Go twins
// leave out.

func TestCreateTypeKeepsTheKindAndTheNames(t *testing.T) {
	for ref, want := range []string{"*yjs.Array", "*yjs.Map", "*yjs.Text", "*yjs.XmlElement", "*yjs.XmlFragment", "*yjs.XmlHook", "*yjs.XmlText"} {
		if got := typeName(createType(ref, nil)); got != want {
			t.Errorf("ref %d is %s, want %s", ref, got, want)
		}
	}
	div, hook := s("div"), s("hook")
	if element := createType(3, &div).(*XmlElement); element.NodeName == nil || element.NodeName.String() != "div" {
		t.Fatal("the element lost its node name")
	}
	if h := createType(5, &hook).(*XmlHook); h.HookName == nil || h.HookName.String() != "hook" {
		t.Fatal("the hook lost its name")
	}
}

func typeName(value AbstractType) string {
	switch value.(type) {
	case *Array:
		return "*yjs.Array"
	case *Map:
		return "*yjs.Map"
	case *Text:
		return "*yjs.Text"
	case *XmlElement:
		return "*yjs.XmlElement"
	case *XmlFragment:
		return "*yjs.XmlFragment"
	case *XmlHook:
		return "*yjs.XmlHook"
	case *XmlText:
		return "*yjs.XmlText"
	}
	return "?"
}

// Both halves of a split keep their unit count, so no clock drifts.
func TestContentSpliceKeepsBothHalves(t *testing.T) {
	left := &ContentString{Text: s("ab😀cd")}
	right := left.splice(3).(*ContentString)
	if !slices.Equal(left.Text, jsjson.Str{'a', 'b', 0xfffd}) || !slices.Equal(right.Text, jsjson.Str{0xfffd, 'c', 'd'}) {
		t.Fatalf("%x %x", left.Text, right.Text)
	}
	whole := &ContentString{Text: s("abcd")}
	if tail := whole.splice(2).(*ContentString); whole.Text.String() != "ab" || tail.Text.String() != "cd" {
		t.Fatalf("%q %q", whole.Text.String(), tail.Text.String())
	}
	anyContent := &ContentAny{Items: []any{s("a"), s("b"), s("c")}}
	if anyRight := anyContent.splice(1).(*ContentAny); anyContent.Len() != 1 || len(anyRight.Items) != 2 || !isStr(anyRight.Items[0], "b") || !isStr(anyRight.Items[1], "c") {
		t.Fatalf("any %v %v", anyContent.Items, anyRight.Items)
	}
	jsonContent := &ContentJSON{Raw: []jsjson.Str{s("1"), s("2"), s("3")}}
	if jsonRight := jsonContent.splice(2).(*ContentJSON); jsonContent.Len() != 2 || len(jsonRight.Raw) != 1 || jsonRight.Raw[0].String() != "3" {
		t.Fatalf("json %v %v", jsonContent.Raw, jsonRight.Raw)
	}
	deleted := &ContentDeleted{ticks: 5}
	if deletedRight := deleted.splice(2).(*ContentDeleted); deleted.Len() != 2 || deletedRight.Len() != 3 {
		t.Fatalf("deleted %d %d", deleted.Len(), deletedRight.Len())
	}
	expectPanic(t, "a type", func() { newContentType(1, nil).splice(0) })
	expectPanic(t, "a format", func() { (&ContentFormat{Key: s("b"), JSON: s("true")}).splice(0) })
}

func TestTextToStringSkipsFormatsEmbedsAndDeletedStrings(t *testing.T) {
	text := &Text{}
	gone := itemWith(7, &ContentString{Text: s(" gone")})
	gone.deleted = true
	chain(&text.typeCore,
		itemWith(0, &ContentString{Text: s("Hel")}),
		itemWith(3, &ContentFormat{Key: s("bold"), JSON: s("true")}),
		itemWith(4, &ContentString{Text: s("lo")}),
		itemWith(6, &ContentEmbed{unsplittable: unsplittable{5}, JSON: s(`{"image":1}`)}),
		gone)
	if text.String() != "Hello" {
		t.Fatalf("%q", text.String())
	}
	xmlText := &XmlText{}
	only := itemWith(0, &ContentString{Text: s("xml")})
	only.id.Client = storeClient + 1
	chain(&xmlText.typeCore, only)
	if xmlText.String() != "xml" {
		t.Fatalf("%q", xmlText.String())
	}
}

func TestInsertPacksConsecutiveAnysReadsBackEveryValue(t *testing.T) {
	doc := docWithID(4242)
	list := doc.GetArray(s("list"))
	doc.Transact(func(txn *Transaction) { list.Insert(txn, 0, []any{s("a"), 1.0, true, nil}) })
	values := list.Values()
	if len(values) != 4 || !isStr(values[0], "a") || values[1] != 1.0 || values[2] != true || values[3] != nil {
		t.Fatalf("%#v", values)
	}
}

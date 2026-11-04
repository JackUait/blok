package convert

import (
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/lib0"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// Twins of C# YDocConverterLoneSurrogateTests: a lone surrogate in a type or
// data key is not its U+FFFD replacement. A Go config string cannot hold a
// lone surrogate, so the C# half where one matches itself has no twin.

func TestATypeOfALoneSurrogateIsNotItsReplacementsRichField(t *testing.T) {
	doc := loneSurrogateRoom(t, false)
	fields, err := NewRichTextFields([]RichTextFieldEntry{{Type: "�", Fields: []string{"text"}}})
	if err != nil {
		t.Fatal(err)
	}

	blocks, slots, err := Export(doc, fields, nil)

	if err != nil || len(slots) != 0 {
		t.Fatalf("slots %v, %v", slots, err)
	}
	if kind := mustGet(blocks[0].(*jsjson.Object), "type"); !sameUnits(kind, jsjson.Str{0xd800}) {
		t.Fatalf("type %#v", kind)
	}
}

func TestANestedDataKeyOfALoneSurrogateIsNotItsReplacementsRichField(t *testing.T) {
	doc := loneSurrogateRoom(t, true)
	fields, err := NewRichTextFields([]RichTextFieldEntry{{Type: "callout", Fields: []string{"�"}}})
	if err != nil {
		t.Fatal(err)
	}

	blocks, slots, err := Export(doc, fields, nil)

	if err != nil || len(slots) != 0 {
		t.Fatalf("slots %v, %v", slots, err)
	}
	data := mustGet(blocks[0].(*jsjson.Object), "data").(*jsjson.Object)
	document := mustGet(mustGet(data, "properties").(*jsjson.Object), "p").(*jsjson.Object)
	nested := mustGet(mustGet(document, "blocks").([]any)[0].(*jsjson.Object), "data").(*jsjson.Object)
	if members := nested.Members(); len(members) != 1 || !sameUnits(members[0].Key, jsjson.Str{0xd800}) {
		t.Fatalf("nested data %#v", members)
	}
}

func sameUnits(value any, want jsjson.Str) bool {
	got, ok := value.(jsjson.Str)
	return ok && jsjson.Compare(got, want) == 0
}

// loneSurrogateRoom is C# YDocConverterLoneSurrogateTests.Room.
func loneSurrogateRoom(t *testing.T, nested bool) *yjs.Doc {
	t.Helper()
	w := &lib0.Writer{}
	field := func(key string, info byte, parentClock uint64) {
		w.WriteUint8(info)
		w.WriteVarUint(0)
		w.WriteVarUint(1)
		w.WriteVarUint(parentClock)
		w.WriteVarString(str(key))
	}
	anyString := func(value string) {
		w.WriteVarUint(1)
		w.WriteUint8(119)
		w.WriteVarString(str(value))
	}
	structs := uint64(7)
	if nested {
		structs = 6
	}
	w.WriteVarUint(1)
	w.WriteVarUint(structs)
	w.WriteVarUint(1)
	w.WriteVarUint(0)
	w.WriteUint8(0x27)
	w.WriteVarUint(1)
	w.WriteVarString(str("blocks"))
	w.WriteVarString(str("p"))
	w.WriteVarUint(1)
	field("id", 0x28, 0)
	anyString("p")
	if nested {
		field("type", 0x28, 0)
		anyString("database-row")
	} else {
		field("type", 0x22, 0)
		w.WriteVarUint(1)
		w.WriteVarString(str(`"\ud800"`))
	}
	field("data", 0x27, 0)
	w.WriteVarUint(1)
	if nested {
		field("properties", 0x22, 3)
		w.WriteVarUint(1)
		w.WriteVarString(str(`{"p":{"blocks":[{"type":"callout","data":{"\ud800":"<b>x</b>"}}]}}`))
	} else {
		field("text", 0x27, 3)
		w.WriteVarUint(2)
		w.WriteUint8(0x04)
		w.WriteVarUint(0)
		w.WriteVarUint(1)
		w.WriteVarUint(4)
		w.WriteVarString(str("<b>x</b>"))
	}
	w.WriteUint8(0x08)
	w.WriteVarUint(1)
	w.WriteVarString(str("root"))
	anyString("p")
	w.WriteVarUint(0)
	client := uint32(2)
	doc := yjs.NewDoc(yjs.Options{ClientID: &client})
	if _, err := doc.ApplyUpdate(w.Bytes()); err != nil {
		t.Fatal(err)
	}
	return doc
}

package convert

import (
	"errors"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

// Twins of C# YDocConverterRichTextTests: a rich (type, key) is a formatted
// Y.XmlText holding segments, and every reader decides by class.

func rtBlocks(t *testing.T, blocks ...string) []*jsjson.Node {
	t.Helper()
	return node(t, []byte("["+strings.Join(blocks, ",")+"]")).Items
}

func rtSeeded(t *testing.T, blocks ...string) *yjs.Doc {
	t.Helper()
	return agSeeded(t, "["+strings.Join(blocks, ",")+"]")
}

func rtValue(t *testing.T, doc *yjs.Doc, id, key string) any {
	t.Helper()
	value, _ := rowData(t, doc, id).Get(str(key))
	return value
}

// rtText is the block's exported text, failing on an unconverted HTML slot.
func rtText(t *testing.T, doc *yjs.Doc, id string) string {
	t.Helper()
	return rtField(t, doc, BuiltInRichTextFields(), id, "text")
}

func rtField(t *testing.T, doc *yjs.Doc, fields *RichTextFields, id, key string) string {
	t.Helper()
	blocks, slots, err := Export(doc, fields, nil)
	if err != nil || len(slots) > 0 {
		t.Fatalf("export: %v, %d slots", err, len(slots))
	}
	return stringify(t, agField(agField(agBlock(blocks, id), "data"), key))
}

func rtApply(t *testing.T, doc *yjs.Doc, ops ...string) error {
	t.Helper()
	parsed, err := ParseEditOps([]byte(`{ "ops": [` + strings.Join(ops, ",") + `] }`))
	if err != nil {
		t.Fatal(err)
	}
	return agApply(doc, parsed...)
}

func rtUpdates(doc *yjs.Doc) *int {
	count := new(int)
	doc.OnUpdate(func(yjs.UpdateEvent) { *count++ })
	return count
}

func rtLegacyDoc(html string) *yjs.Doc {
	doc := yjs.NewDoc(yjs.Options{})
	data := yjs.NewMap(yjs.MapEntry{Key: str("text"), Value: yjs.NewText(str(html))})
	block := yjs.NewMap(
		yjs.MapEntry{Key: str("id"), Value: str("b1")},
		yjs.MapEntry{Key: str("type"), Value: str("paragraph")},
		yjs.MapEntry{Key: str("data"), Value: data},
		yjs.MapEntry{Key: str("tunes"), Value: yjs.NewMap()},
		yjs.MapEntry{Key: str("contentIds"), Value: yjs.NewArray()},
	)
	setBlock(doc, "b1", block, str("b1"))
	return doc
}

func rtCalloutFields(t *testing.T) *RichTextFields {
	t.Helper()
	fields, err := NewRichTextFields([]RichTextFieldEntry{{Type: "callout", Fields: []string{"title"}}})
	if err != nil {
		t.Fatal(err)
	}
	return fields
}

func rtWant(t *testing.T, got, want string) {
	t.Helper()
	if got != want {
		t.Fatalf("got  %s\nwant %s", got, want)
	}
}

func TestSeedsSegmentsAsFormattedTextAndExportsThemCanonical(t *testing.T) {
	doc := rtSeeded(t, `{ "id": "b1", "type": "paragraph", "data": { "text": [
  { "text": "Hi " },
  { "text": "bold", "marks": { "italic": true, "bold": true } },
  { "embed": { "page": { "id": "p1" } } },
  { "text": "" },
  { "text": "x", "marks": { "link": { "rel": "r", "href": "h" } } }
] } }`)
	if _, ok := rtValue(t, doc, "b1", "text").(*yjs.XmlText); !ok {
		t.Fatal("text is not a Y.XmlText")
	}
	rtWant(t, rtText(t, doc, "b1"), `[{"text":"Hi "},{"text":"bold","marks":{"bold":true,"italic":true}},{"embed":{"page":{"id":"p1"}}},{"text":"x","marks":{"link":{"href":"h","rel":"r"}}}]`)
}

func TestStoresEachMarkAsItsOwnAttributeWithSortedKeys(t *testing.T) {
	doc := rtSeeded(t, `{ "id": "b1", "type": "paragraph", "data": { "text": [
  { "text": "x", "marks": { "link": { "target": "_blank", "href": "h" }, "bold": true } }
] } }`)
	delta := rtValue(t, doc, "b1", "text").(*yjs.XmlText).ToDelta()
	if len(delta) != 1 {
		t.Fatalf("%d ops", len(delta))
	}
	rtWant(t, stringify(t, delta[0].Attributes), `{"bold":true,"link":{"href":"h","target":"_blank"}}`)
}

func TestMarkupCharactersTypedAsTextStayText(t *testing.T) {
	doc := rtSeeded(t, `{ "id": "b1", "type": "paragraph", "data": { "text": [{ "text": "a < b && \"c\" <b>x</b>" }] } }`)
	rtWant(t, rtText(t, doc, "b1"), `[{"text":"a < b && \"c\" <b>x</b>"}]`)
}

func TestEmptyParagraphDataBecomesAnEmptyFormattedText(t *testing.T) {
	doc := rtSeeded(t, `{ "id": "b1", "type": "paragraph", "data": {} }`)
	if _, ok := rtValue(t, doc, "b1", "text").(*yjs.XmlText); !ok {
		t.Fatal("text is not a Y.XmlText")
	}
	rtWant(t, rtText(t, doc, "b1"), `[]`)
}

func TestDropsMarkKeysTheClientCannotRender(t *testing.T) {
	doc := rtSeeded(t, `{ "id": "b1", "type": "paragraph", "data": { "text": [
  { "text": "x", "marks": { "bold": true, "glow": true, "tag:bad name": {}, "tag:abbr": { "title": "t" } } }
] } }`)
	rtWant(t, rtText(t, doc, "b1"), `[{"text":"x","marks":{"bold":true,"tag:abbr":{"title":"t"}}}]`)
}

func TestReadsAnArrayThatIsNotSegmentsLeniently(t *testing.T) {
	doc := rtSeeded(t, `{ "id": "b1", "type": "paragraph", "data": { "text": [
  { "text": "a", "checked": true }, 5, { "embed": "no" }, { "text": "b", "marks": { "bold": true } }
] } }`)
	rtWant(t, rtText(t, doc, "b1"), `[{"text":"a"},{"text":"b","marks":{"bold":true}}]`)
}

func TestRefusesHTMLThatNoConverterRead(t *testing.T) {
	err := Seed(yjs.NewDoc(yjs.Options{}), rtBlocks(t, `{ "id": "b1", "type": "paragraph", "data": { "text": "<b>x</b>" } }`), Refusing(BuiltInRichTextFields()), nil)
	var data *DataError
	if !errors.As(err, &data) {
		t.Fatalf("err %v, want a data refusal", err)
	}
	rtWant(t, data.Message, `collab: rich text field "paragraph.text" holds HTML that was not converted to segments.`)
}

func TestReadsHTMLThroughTheConvertedTable(t *testing.T) {
	blocks := rtBlocks(t, `{ "id": "b1", "type": "paragraph", "data": { "text": "<b>x</b>" } }`)
	found, err := CollectSeedHTML(blocks, BuiltInRichTextFields())
	if err != nil || len(found) != 1 || found[0].Type != "paragraph" || found[0].Field != "text" || found[0].HTML.String() != "<b>x</b>" {
		t.Fatalf("found %v, %v", found, err)
	}
	doc := yjs.NewDoc(yjs.Options{})
	converted := map[string][]any{HTMLKey(str("<b>x</b>")): jsValue(t, []byte(`[{"text":"x","marks":{"bold":true}}]`)).([]any)}
	if err := Seed(doc, blocks, Converting(BuiltInRichTextFields(), converted), nil); err != nil {
		t.Fatal(err)
	}
	rtWant(t, rtText(t, doc, "b1"), `[{"text":"x","marks":{"bold":true}}]`)
}

func TestAnEmptyHTMLStringNeedsNoConverter(t *testing.T) {
	rtWant(t, rtText(t, rtSeeded(t, `{ "id": "b1", "type": "paragraph", "data": { "text": "" } }`), "b1"), `[]`)
}

func TestNonRichDiffableKeysKeepPlainText(t *testing.T) {
	doc := rtSeeded(t, `{ "id": "c1", "type": "code", "data": { "code": "a < b", "text": "<b>t</b>" } }`)
	for _, key := range []string{"code", "text"} {
		if _, ok := rtValue(t, doc, "c1", key).(*yjs.Text); !ok {
			t.Fatalf("%s is %T, want a Y.Text", key, rtValue(t, doc, "c1", key))
		}
	}
	rtWant(t, rtField(t, doc, BuiltInRichTextFields(), "c1", "text"), `"<b>t</b>"`)
}

func TestARichFieldHoldingNeitherStringNorArrayStaysAPlainLeaf(t *testing.T) {
	doc := rtSeeded(t, `{ "id": "b1", "type": "paragraph", "data": { "text": 5 } }`)
	if value := rtValue(t, doc, "b1", "text"); value != 5.0 {
		t.Fatalf("%T %v", value, value)
	}
	rtWant(t, rtText(t, doc, "b1"), `5`)
}

func TestCustomFieldsFromTheOptionsAreRich(t *testing.T) {
	fields := rtCalloutFields(t)
	doc := yjs.NewDoc(yjs.Options{})
	if err := Seed(doc, rtBlocks(t, `{ "id": "c1", "type": "callout", "data": { "title": [{ "text": "T", "marks": { "bold": true } }] } }`), Refusing(fields), nil); err != nil {
		t.Fatal(err)
	}
	if _, ok := rtValue(t, doc, "c1", "title").(*yjs.XmlText); !ok {
		t.Fatal("title is not a Y.XmlText")
	}
	rtWant(t, rtField(t, doc, fields, "c1", "title"), `[{"text":"T","marks":{"bold":true}}]`)
}

// Export decides by class, so a server whose field list lacks a field a
// client formatted still exports segments.
func TestFormattedTextUnderAnyKeyExportsAsSegments(t *testing.T) {
	doc := yjs.NewDoc(yjs.Options{})
	if err := Seed(doc, rtBlocks(t, `{ "id": "c1", "type": "callout", "data": { "title": [{ "text": "T", "marks": { "bold": true } }] } }`), Refusing(rtCalloutFields(t)), nil); err != nil {
		t.Fatal(err)
	}
	rtWant(t, rtField(t, doc, BuiltInRichTextFields(), "c1", "title"), `[{"text":"T","marks":{"bold":true}}]`)
}

func TestLegacyHTMLTextUnderARichFieldIsHandedOutForConversion(t *testing.T) {
	doc := rtLegacyDoc("<b>x</b>")
	blocks, slots, err := Export(doc, BuiltInRichTextFields(), nil)
	if err != nil || len(slots) != 1 {
		t.Fatalf("%v, %d slots", err, len(slots))
	}
	slot := slots[0]
	if slot.HTML.Type != "paragraph" || slot.HTML.Field != "text" || slot.HTML.HTML.String() != "<b>x</b>" || slot.Key.String() != "text" {
		t.Fatalf("slot %+v", slot)
	}
	if data, _ := agField(blocks[0], "data").(*jsjson.Object); data == nil || data != slot.Target {
		t.Fatal("the slot does not target the exported block's data")
	}
}

func TestLegacyHTMLStringsInsideDatabaseRowDocumentsAreHandedOutToo(t *testing.T) {
	doc := rtSeeded(t, `{ "id": "r1", "type": "database-row", "data": { "properties": {
  "notes": { "blocks": [
    { "id": "n1", "type": "paragraph", "data": { "text": "<i>n</i>" } },
    { "id": "n2", "type": "code", "data": { "code": "<i>c</i>" } }
  ] },
  "status": "done"
} } }`)
	_, slots, err := Export(doc, BuiltInRichTextFields(), nil)
	if err != nil || len(slots) != 1 {
		t.Fatalf("%v, %d slots", err, len(slots))
	}
	if html := slots[0].HTML; html.Type != "paragraph" || html.Field != "text" || html.HTML.String() != "<i>n</i>" {
		t.Fatalf("slot %+v", html)
	}
	if _, ok := rtValue(t, doc, "r1", "properties").(*yjs.XmlText); ok {
		t.Fatal("properties became a Y.XmlText")
	}
}

func TestAnUpdateWithUnchangedSegmentsWritesNothing(t *testing.T) {
	doc := rtSeeded(t, `{ "id": "b1", "type": "paragraph", "data": { "text": [{ "text": "a", "marks": { "link": { "href": "h", "rel": "r" } } }] } }`)
	updates := rtUpdates(doc)
	if err := rtApply(t, doc, `{ "op": "update", "id": "b1", "data": { "text": [{ "marks": { "link": { "rel": "r", "href": "h", "title": "x" } }, "text": "a" }] } }`); err != nil {
		t.Fatal(err)
	}
	if *updates != 0 {
		t.Fatalf("%d updates", *updates)
	}
}

func TestAnUpdateEditsTheFormattedTextInPlace(t *testing.T) {
	doc := rtSeeded(t, `{ "id": "b1", "type": "paragraph", "data": { "text": [{ "text": "hello world" }] } }`)
	live := rtValue(t, doc, "b1", "text")
	if err := rtApply(t, doc, `{ "op": "update", "id": "b1", "data": { "text": [{ "text": "hello " }, { "text": "big", "marks": { "bold": true } }, { "text": " world" }] } }`); err != nil {
		t.Fatal(err)
	}
	if rtValue(t, doc, "b1", "text") != live {
		t.Fatal("the edit replaced the Y.XmlText")
	}
	rtWant(t, rtText(t, doc, "b1"), `[{"text":"hello "},{"text":"big","marks":{"bold":true}},{"text":" world"}]`)
}

// Replacing a legacy plain text is a whole-key set; it happens once per
// field, on the first rich write.
func TestAnUpdateReplacesLegacyPlainTextWithFormattedText(t *testing.T) {
	doc := rtLegacyDoc("<b>x</b>")
	if err := rtApply(t, doc, `{ "op": "update", "id": "b1", "data": { "text": [{ "text": "x", "marks": { "bold": true } }] } }`); err != nil {
		t.Fatal(err)
	}
	if _, ok := rtValue(t, doc, "b1", "text").(*yjs.XmlText); !ok {
		t.Fatal("text is not a Y.XmlText")
	}
	rtWant(t, rtText(t, doc, "b1"), `[{"text":"x","marks":{"bold":true}}]`)
}

func TestAnUpdateFindsHTMLForTheConverterUsingTheBlocksTypeInTheDoc(t *testing.T) {
	doc := rtSeeded(t,
		`{ "id": "b1", "type": "paragraph", "data": { "text": [] } }`,
		`{ "id": "c1", "type": "code", "data": { "code": "" } }`)
	ops, err := ParseEditOps([]byte(`{ "ops": [
  { "op": "update", "id": "b1", "data": { "text": "<b>x</b>" } },
  { "op": "update", "id": "c1", "data": { "code": "<b>y</b>" } },
  { "op": "insert", "id": "n1", "block": { "type": "header", "data": { "text": "<i>z</i>" } } },
  { "op": "update", "id": "n1", "data": { "text": "<u>w</u>" } }
] }`))
	if err != nil {
		t.Fatal(err)
	}
	found, err := CollectOpsHTML(doc, ops, BuiltInRichTextFields())
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, html := range found {
		got = append(got, html.Type+"."+html.Field+"="+html.HTML.String())
	}
	rtWant(t, strings.Join(got, " "), "paragraph.text=<b>x</b> header.text=<i>z</i> header.text=<u>w</u>")
	var edit *EditError
	if err := agApply(doc, ops...); !errors.As(err, &edit) {
		t.Fatalf("err %v, want an edit refusal", err)
	}
}

func TestSameAsLiveReadsFormattedTextAsSegments(t *testing.T) {
	doc := rtSeeded(t, `{ "id": "x1", "type": "custom", "data": { "nested": { "k": 1 } } }`)
	doc.Transact(func(tx *yjs.Transaction) {
		rowData(t, doc, "x1").Set(tx, str("rich"), yjs.NewXmlText(str("a")))
	})
	updates := rtUpdates(doc)
	if err := rtApply(t, doc, `{ "op": "update", "id": "x1", "data": { "nested": { "k": 1 }, "rich": [{ "text": "a" }] } }`); err != nil {
		t.Fatal(err)
	}
	if *updates != 0 {
		t.Fatalf("%d updates", *updates)
	}
}

// Host data is never trusted: a malformed mark or embed is normalised on the
// way in.
func TestSeedNormalisesMalformedMarksAndEmbeds(t *testing.T) {
	doc := rtSeeded(t, `{ "id": "b1", "type": "paragraph", "data": { "text": [
  { "text": "a", "marks": { "tag:b": { "x": 1, "y": "1" }, "color": {}, "background": 5 } },
  { "embed": { "equation": { "expression": 5 } } },
  { "embed": { "equation": null } },
  { "embed": { "page": { "id": {} } } },
  { "embed": { "html": 5 } },
  { "text": "b", "marks": { "tag:i": "str" } }
] } }`, `{ "id": "b2", "type": "paragraph", "data": { "text": [{ "text": "other" }] } }`)
	rtWant(t, rtText(t, doc, "b1"), `[{"text":"a","marks":{"tag:b":{"y":"1"}}},{"text":"b"}]`)
	rtWant(t, rtText(t, doc, "b2"), `[{"text":"other"}]`)
}

func TestARestEditNormalisesMalformedMarksAndEmbeds(t *testing.T) {
	doc := rtSeeded(t, `{ "id": "b1", "type": "paragraph", "data": { "text": [{ "text": "a" }] } }`)
	if err := rtApply(t, doc, `{ "op": "update", "id": "b1", "data": { "text": [
  { "text": "a", "marks": { "tag:b": { "x": null }, "color": [1] } },
  { "embed": { "page": { "id": "p", "extra": "1" } } },
  { "embed": { "equation": { "expression": "e" } } }
] } }`); err != nil {
		t.Fatal(err)
	}
	rtWant(t, rtText(t, doc, "b1"), `[{"text":"a","marks":{"tag:b":{}}},{"embed":{"equation":{"expression":"e"}}}]`)
}

// A peer writes what it likes into a formatted text: export reads the valid
// segments, and a REST edit of that text plans and applies.
func TestAPeersMalformedWriteNeitherBreaksExportNorTheNextEdit(t *testing.T) {
	doc := rtSeeded(t,
		`{ "id": "b1", "type": "paragraph", "data": { "text": [{ "text": "ab" }] } }`,
		`{ "id": "b2", "type": "paragraph", "data": { "text": [{ "text": "other" }] } }`)
	object := func(key string, value any) *jsjson.Object {
		o := &jsjson.Object{}
		o.Set(str(key), value)
		return o
	}
	marks := object("color", &jsjson.Object{})
	marks.Set(str("tag:b"), object("x", 1.0))
	text := rtValue(t, doc, "b1", "text").(*yjs.XmlText)
	doc.Transact(func(tx *yjs.Transaction) {
		text.InsertEmbed(tx, 1, object("equation", object("expression", 5.0)), &jsjson.Object{})
		text.Insert(tx, 2, str("x"), marks)
		text.InsertEmbed(tx, 3, object("page", object("id", &jsjson.Object{})), &jsjson.Object{})
	})
	rtWant(t, rtText(t, doc, "b1"), `[{"text":"a"},{"text":"x","marks":{"tag:b":{}}},{"text":"b"}]`)
	rtWant(t, rtText(t, doc, "b2"), `[{"text":"other"}]`)
	if err := rtApply(t, doc, `{ "op": "update", "id": "b1", "data": { "text": [{ "text": "abc" }] } }`); err != nil {
		t.Fatal(err)
	}
	rtWant(t, rtText(t, doc, "b1"), `[{"text":"abc"}]`)
	var inserted strings.Builder
	for _, op := range text.ToDelta() {
		chunk, ok := op.Insert.(jsjson.Str)
		if !ok {
			t.Fatalf("a %T is left in the text", op.Insert)
		}
		inserted.WriteString(chunk.String())
	}
	rtWant(t, inserted.String(), "abc")
}

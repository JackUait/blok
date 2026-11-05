package convert

import (
	"os"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/collabtest"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

// engine reads a fixture as JSON.parse does: the same values a Y doc holds.
func engine(t *testing.T, relative string) any {
	data, err := os.ReadFile(collabtest.Path(t, relative))
	if err != nil {
		t.Fatal(err)
	}
	value, err := jsjson.Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func field(value any, key string) any {
	v, _ := value.(*jsjson.Object).Get(jsjson.FromString(key))
	return v
}

func stringify(t *testing.T, value any) string {
	text, err := jsjson.Stringify(value)
	if err != nil {
		t.Fatal(err)
	}
	return text
}

// Twin of RichTextCanonicalTests: expected values come from the real client.
func TestCanonicalizesRichTextLikeTheClient(t *testing.T) {
	inputs := engine(t, "rich-text-canonical/inputs.json")
	expected := engine(t, "rich-text-canonical/expected.json")
	count := 0
	for _, entry := range field(inputs, "segments").([]any) {
		name := field(entry, "name").(jsjson.Str).String()
		want := stringify(t, field(field(expected, "segments"), name))
		if got := stringify(t, Canonicalize(field(entry, "input").([]any))); got != want {
			t.Errorf("segments %s:\n got %s\nwant %s", name, got, want)
		}
		count++
	}
	for _, entry := range field(inputs, "deltas").([]any) {
		name := field(entry, "name").(jsjson.Str).String()
		var delta []yjs.Delta
		for _, op := range field(entry, "input").([]any) {
			attributes, _ := field(op, "attributes").(*jsjson.Object)
			delta = append(delta, yjs.Delta{Insert: field(op, "insert"), Attributes: attributes})
		}
		want := stringify(t, field(field(expected, "deltas"), name))
		if got := stringify(t, FromDelta(delta)); got != want {
			t.Errorf("deltas %s:\n got %s\nwant %s", name, got, want)
		}
		count++
	}
	if count < 30 {
		t.Fatalf("only %d cases", count)
	}
}

// Twin of RichTextMalformedTests: host and peer input is normalised the same
// way the canonical form is, never thrown on.
func TestReadInputNormalisesMalformedValuesLikeCanonicalize(t *testing.T) {
	inputs := engine(t, "rich-text-canonical/inputs.json")
	expected := engine(t, "rich-text-canonical/expected.json")
	count := 0
	for _, entry := range field(inputs, "segments").([]any) {
		name := field(entry, "name").(jsjson.Str).String()
		if !strings.HasPrefix(name, "malformed-") {
			continue
		}
		want := stringify(t, field(field(expected, "segments"), name))
		if got := stringify(t, ReadInput(field(entry, "input").([]any))); got != want {
			t.Errorf("segments %s:\n got %s\nwant %s", name, got, want)
		}
		count++
	}
	if count < 20 {
		t.Fatalf("only %d malformed cases", count)
	}
}

func TestFromDeltaNeverChangesTheDeltaItReads(t *testing.T) {
	link := &jsjson.Object{}
	link.Set(jsjson.FromString("rel"), jsjson.FromString("r"))
	link.Set(jsjson.FromString("href"), jsjson.FromString("h"))
	attributes := &jsjson.Object{}
	attributes.Set(jsjson.FromString("link"), link)
	attributes.Set(jsjson.FromString("bold"), true)
	before := stringify(t, attributes)
	FromDelta([]yjs.Delta{{Insert: jsjson.FromString("a"), Attributes: attributes}})
	Normalize(attributes)
	if after := stringify(t, attributes); after != before {
		t.Fatalf("%s became %s", before, after)
	}
}

// Twin of RichTextEditFixtureTests: the planner issues exactly the fixture's
// ops, and applying them leaves the delta and segments yjs leaves.
func TestPlansAndAppliesEveryRichTextEditFixture(t *testing.T) {
	cases := engine(t, "rich-text-edits/cases.json").([]any)
	if len(cases) < 20 {
		t.Fatalf("only %d cases", len(cases))
	}
	for _, entry := range cases {
		name := field(entry, "name").(jsjson.Str).String()
		doc := yjs.NewDoc(yjs.Options{})
		var text *yjs.XmlText
		doc.Transact(func(tx *yjs.Transaction) {
			text = yjs.NewXmlText(nil)
			doc.GetMap(jsjson.FromString("blocks")).Set(tx, jsjson.FromString("b1"), text)
			index := 0
			for _, op := range ToWriteOps(Canonicalize(field(entry, "current").([]any))) {
				if insert, ok := op.Insert.(jsjson.Str); ok {
					text.Insert(tx, index, insert, op.Attributes)
				} else {
					text.InsertEmbed(tx, index, op.Insert, op.Attributes)
				}
				index += op.Length()
			}
		})
		next := ReadInput(field(entry, "next").([]any))
		ops := PlanRichTextEdit(text.ToDelta(), next)
		if got, want := stringify(t, richTextOpsJSON(ops)), stringify(t, field(entry, "ops")); got != want {
			t.Errorf("%s: ops\n got %s\nwant %s", name, got, want)
			continue
		}
		expected := field(entry, "expected")
		updates := 0
		stop := doc.OnUpdate(func(yjs.UpdateEvent) { updates++ })
		if len(ops) > 0 {
			doc.Transact(func(tx *yjs.Transaction) { ApplyRichTextOps(tx, text, ops) })
		}
		stop()
		if wantWrites := field(expected, "writes").(bool); (updates == 1) != wantWrites || updates > 1 {
			t.Errorf("%s: %d updates, writes=%v", name, updates, wantWrites)
		}
		if got, want := stringify(t, deltaJSON(text.ToDelta())), stringify(t, field(expected, "delta")); got != want {
			t.Errorf("%s: delta\n got %s\nwant %s", name, got, want)
		}
		if got, want := stringify(t, FromDelta(text.ToDelta())), stringify(t, field(expected, "segments")); got != want {
			t.Errorf("%s: segments\n got %s\nwant %s", name, got, want)
		}
	}
}

func set(object *jsjson.Object, key string, value any) { object.Set(jsjson.FromString(key), value) }

func richTextOpsJSON(ops []RichTextOp) []any {
	result := []any{}
	for _, op := range ops {
		json := &jsjson.Object{}
		switch op := op.(type) {
		case RichTextInsert:
			set(json, "op", jsjson.FromString("insert"))
			set(json, "index", float64(op.Index))
			set(json, "text", op.Text)
			set(json, "attributes", op.Attributes)
		case RichTextInsertEmbed:
			set(json, "op", jsjson.FromString("insertEmbed"))
			set(json, "index", float64(op.Index))
			set(json, "embed", op.Embed)
			set(json, "attributes", op.Attributes)
		case RichTextDelete:
			set(json, "op", jsjson.FromString("delete"))
			set(json, "index", float64(op.Index))
			set(json, "length", float64(op.Length))
		case RichTextFormat:
			set(json, "op", jsjson.FromString("format"))
			set(json, "index", float64(op.Index))
			set(json, "length", float64(op.Length))
			set(json, "attributes", op.Attributes)
		}
		result = append(result, json)
	}
	return result
}

func deltaJSON(delta []yjs.Delta) []any {
	result := []any{}
	for _, op := range delta {
		json := &jsjson.Object{}
		set(json, "insert", op.Insert)
		if op.Attributes != nil {
			set(json, "attributes", op.Attributes)
		}
		result = append(result, json)
	}
	return result
}

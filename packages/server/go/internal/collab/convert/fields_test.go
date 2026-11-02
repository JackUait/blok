package convert

import (
	"maps"
	"slices"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/collab/collabtest"
)

// Twin of RichTextFieldsTests: the built-ins equal the client table the TS suite pins.
func TestBuiltInRichTextFieldsEqualTheClientTable(t *testing.T) {
	var fixture map[string][]string
	collabtest.Read(t, "rich-text-fields.json", &fixture)
	table := BuiltInRichTextFields().Table()
	if !maps.EqualFunc(table, fixture, slices.Equal) {
		t.Fatalf("%v, want %v", table, fixture)
	}
	for _, c := range []struct {
		kind, key string
		rich      bool
	}{
		{"paragraph", "text", true}, {"header", "text", true}, {"quote", "text", true}, {"toggle", "text", true},
		{"list", "text", true}, {"quote", "caption", false}, {"code", "code", false}, {"image", "caption", false},
		{"custom", "text", false}, {"", "text", false},
	} {
		if got := BuiltInRichTextFields().IsRich(c.kind, c.key); got != c.rich {
			t.Errorf("%s.%s: %v", c.kind, c.key, got)
		}
	}
}

func TestCustomRichTextFieldsAddToTheBuiltIns(t *testing.T) {
	fields, err := NewRichTextFields(map[string][]string{"callout": {"title", "body"}, "paragraph": {"note"}})
	if err != nil {
		t.Fatal(err)
	}
	if !fields.IsRich("callout", "title") || !fields.IsRich("callout", "body") || !fields.IsRich("paragraph", "text") ||
		!fields.IsRich("paragraph", "note") || fields.IsRich("callout", "text") || BuiltInRichTextFields().IsRich("callout", "title") {
		t.Fatal("custom fields did not add to the built-ins")
	}
	empty, err := NewRichTextFields(map[string][]string{"divider": {}})
	if err != nil {
		t.Fatal(err)
	}
	// C# keeps a type listed with no fields in the table.
	if got, ok := empty.Table()["divider"]; !ok || len(got) != 0 {
		t.Fatalf("divider: %v %v", got, ok)
	}
	for _, bad := range []map[string][]string{{"": {"text"}}, {"callout": {""}}, {"call\x00out": {"text"}}, {"callout": {"ti\x00tle"}}, {"callout": nil}} {
		if _, err := NewRichTextFields(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

package blokagent

import (
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
)

// Go twins of C# RoomEditTranslatorTests: the translator has no runtime
// and no room, so a fixture adds nothing over the same three inputs.

func opString(t *testing.T, op convert.EditOp) string {
	t.Helper()
	optional := func(s *string) string {
		if s == nil {
			return "<nil>"
		}
		return *s
	}
	node := func(n *jsjson.Node) string {
		if n == nil {
			return "<nil>"
		}
		out, err := write(n)
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	switch op := op.(type) {
	case convert.Insert:
		return fmt.Sprintf("Insert(%s after %s under %s %s)", op.ID, optional(op.After), optional(op.Parent), node(op.Block))
	case convert.Update:
		return fmt.Sprintf("Update(%s %s)", op.ID, node(op.Data))
	case convert.Remove:
		return "Remove(" + op.ID + ")"
	case convert.Lift:
		return "Lift(" + op.ID + ")"
	case convert.Move:
		return fmt.Sprintf("Move(%s after %s under %s)", op.ID, optional(op.After), optional(op.Parent))
	case convert.SetPageField:
		return fmt.Sprintf("SetPageField(%s %s)", op.Key, node(op.Value))
	case convert.SetTunes:
		return fmt.Sprintf("SetTunes(%s %s)", op.ID, node(op.Tunes))
	case convert.Retype:
		return fmt.Sprintf("Retype(%s %s %s)", op.ID, op.Type, node(op.Data))
	case convert.SetMetadata:
		return fmt.Sprintf("SetMetadata(%s %v %s %s)", op.ID, op.LastEditedAt, op.LastEditedBy, optional(op.LastEditedWith))
	}
	t.Fatalf("unknown op %T", op)
	return ""
}

func translateText(t *testing.T, edits, after, result string) ([]string, error) {
	t.Helper()
	ops, err := translate(mustParse(t, edits), mustParse(t, after), mustParse(t, result))
	var lines []string
	for _, op := range ops {
		lines = append(lines, opString(t, op))
	}
	return lines, err
}

func checkOps(t *testing.T, got, want []string) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ops\n got %s\nwant %s", strings.Join(got, "\n     "), strings.Join(want, "\n     "))
	}
}

func TestTranslatesEachEditKind(t *testing.T) {
	got, err := translateText(t, `[
		{"op":"insert","parentId":null,"afterId":"p","block":{"id":"n","type":"toggle","data":{"text":[]},"children":[{"id":"n1","type":"paragraph","data":{},"children":[]}]}},
		{"op":"setRichText","id":"p","field":"text","value":[{"text":"x"}]},
		{"op":"setData","id":"p","patch":{"keep":null}},
		{"op":"move","id":"q","parentId":"n","afterId":"n1"},
		{"op":"setPageField","key":"title","value":"T"}
	]`, `{"title":"T","blocks":[
		{"id":"p","type":"paragraph","data":{"text":[{"text":"x"}]},"lastEditedAt":7,"lastEditedBy":"agent"},
		{"id":"n","type":"toggle","data":{"text":[]},"content":["n1","q"],"lastEditedAt":7,"lastEditedBy":"agent"},
		{"id":"n1","type":"paragraph","data":{},"parent":"n","lastEditedAt":7,"lastEditedBy":"agent"},
		{"id":"q","type":"paragraph","data":{},"parent":"n"}
	]}`, `{"ok":true,"changed":{"created":["n","n1"],"updated":["p"],"moved":["q"],"removed":[]}}`)
	if err != nil {
		t.Fatal(err)
	}
	checkOps(t, got, []string{
		`Insert(n after p under <nil> {"type":"toggle","data":{"text":[]}})`,
		`Insert(n1 after <nil> under n {"type":"paragraph","data":{}})`,
		`Update(p {"text":[{"text":"x"}]})`,
		`Move(q after n1 under n)`,
		`SetPageField(title "T")`,
		`SetMetadata(n 7 agent <nil>)`,
		`SetMetadata(n1 7 agent <nil>)`,
		`SetMetadata(p 7 agent <nil>)`,
	})
}

func TestCarriesTheCoAuthorIdsTheJsonApplierWrote(t *testing.T) {
	got, err := translateText(t, `[
		{"op":"insert","parentId":null,"afterId":null,"block":{"id":"n","type":"paragraph","data":{},"children":[]}},
		{"op":"setData","id":"p","patch":{"keep":1}}
	]`, `{"blocks":[
		{"id":"n","type":"paragraph","data":{},"createdAt":7,"createdBy":"human-1","createdWith":"agent","lastEditedAt":7,"lastEditedBy":"human-1","lastEditedWith":"agent"},
		{"id":"p","type":"paragraph","data":{"keep":1},"lastEditedAt":7,"lastEditedBy":"human-1","lastEditedWith":"agent"}
	]}`, `{"ok":true,"changed":{"created":["n"],"updated":["p"],"moved":[],"removed":[]}}`)
	if err != nil {
		t.Fatal(err)
	}
	checkOps(t, got, []string{
		`Insert(n after <nil> under <nil> {"type":"paragraph","data":{},"createdAt":7,"createdBy":"human-1","createdWith":"agent"})`,
		`Update(p {"keep":1})`,
		`SetMetadata(n 7 human-1 agent)`,
		`SetMetadata(p 7 human-1 agent)`,
	})
}

func TestARemoveThatKeepsChildrenLiftsThemAndStampsThem(t *testing.T) {
	got, err := translateText(t, `[
		{"op":"remove","id":"a","withChildren":false},
		{"op":"remove","id":"b","withChildren":true},
		{"op":"setTunes","id":"a1","tunes":{"align":{"value":"center"},"gone":null}},
		{"op":"replaceType","id":"a2","type":"header","data":{"text":[],"level":2}}
	]`, `{"blocks":[
		{"id":"a1","type":"paragraph","data":{},"tunes":{"align":{"value":"center"}},"lastEditedAt":9,"lastEditedBy":"agent"},
		{"id":"a2","type":"header","data":{"text":[{"text":"H"}],"level":2},"lastEditedAt":9,"lastEditedBy":"agent"}
	]}`, `{"ok":true,"changed":{"created":[],"updated":["a1","a2"],"moved":["a1","a2"],"removed":["a","b","b1"]}}`)
	if err != nil {
		t.Fatal(err)
	}
	checkOps(t, got, []string{
		`Lift(a)`,
		`Remove(a)`,
		`Remove(b)`,
		`SetTunes(a1 {"align":{"value":"center"},"gone":null})`,
		`Retype(a2 header {"text":[{"text":"H"}],"level":2})`,
		`SetMetadata(a1 9 agent <nil>)`,
		`SetMetadata(a2 9 agent <nil>)`,
	})
}

// T-9: what the translator cannot read is an InvalidDataException in C#
// (RoomEditTranslator.cs:43,121,165); an op it does not know is skipped.
func TestRefusesAnEditItCannotReadAndSkipsAnUnknownOp(t *testing.T) {
	ok := `{"ok":true,"changed":{"created":[],"updated":[],"moved":[],"removed":[]}}`
	cases := []struct{ name, edits, message string }{
		{"a null edit", `[null]`, "An agent edit is not an object."},
		{"an insert without a block", `[{"op":"insert"}]`, "An agent edit field is not an object."},
		{"a block without an id", `[{"op":"insert","block":{"type":"paragraph","data":{}}}]`, "A planned block has no id."},
		{"a block whose data is not an object", `[{"op":"insert","block":{"id":"n","type":"paragraph","data":[]}}]`, "An agent edit field is not an object."},
		{"a page field without a key", `[{"op":"setPageField","value":"T"}]`, "A page field edit has no key."},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := translateText(t, c.edits, `{"blocks":[]}`, ok)
			var invalid *InvalidDataError
			if !errors.As(err, &invalid) || invalid.Message != c.message {
				t.Fatalf("err %v, want InvalidDataError %q", err, c.message)
			}
		})
	}
	got, err := translateText(t, `[{"op":"later"},{"op":"remove"}]`, `{"blocks":[]}`, ok)
	if err != nil || len(got) != 0 {
		t.Fatalf("ops %v, err %v", got, err)
	}
	// A retype whose block has no type.
	_, err = translateText(t, `[{"op":"replaceType","id":"a"}]`, `{"blocks":[{"id":"a","data":{}}]}`, ok)
	var invalid *InvalidDataError
	if !errors.As(err, &invalid) || invalid.Message != `Block "a" has no type.` {
		t.Fatalf("err %v", err)
	}
}

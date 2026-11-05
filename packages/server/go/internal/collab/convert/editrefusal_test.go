package convert

import (
	"errors"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

// Twins of the C# YDocConverterEditTests theories whose ops never pass the
// request parser.

const editRoot = `[{ "id": "root", "type": "paragraph", "data": { "text": [{ "text": "r" }] } }]`

func editRefusal(t *testing.T, doc *yjs.Doc, ops ...EditOp) string {
	t.Helper()
	var edit *EditError
	if err := agApply(doc, ops...); !errors.As(err, &edit) {
		t.Fatalf("err %v, want an edit refusal", err)
	}
	return edit.Message
}

// A peer can put anything in the blocks map; a step that throws mid-write
// would leave half an edit.
func TestRefusesAnOpAimedAtSomethingThatIsNotABlock(t *testing.T) {
	for name, op := range map[string]EditOp{
		"update": Update{ID: "poison", Data: node(t, []byte(`{ "text": "x" }`))},
		"insert": Insert{ID: "new", Parent: agPtr("poison"), Block: node(t, []byte(`{ "type": "p", "data": {} }`))},
	} {
		doc := agSeeded(t, editRoot)
		doc.Transact(func(tx *yjs.Transaction) {
			doc.GetMap(str("blocks")).Set(tx, str("poison"), str("not a block"))
		})
		if message := editRefusal(t, doc, op); !strings.Contains(message, "not a block") {
			t.Errorf("%s: %s", name, message)
		}
		if got := agIDs(agExported(t, doc)); got != "root" {
			t.Errorf("%s: blocks %s", name, got)
		}
	}
}

func TestRefusesANulInAnIdThatIsOnlyEverCompared(t *testing.T) {
	for name, op := range map[string]EditOp{
		"after":     Insert{ID: "new", After: agPtr("root\x00x"), Block: node(t, []byte(`{ "type": "p", "data": {} }`))},
		"update id": Update{ID: "root\x00x", Data: node(t, []byte(`{}`))},
	} {
		if message := editRefusal(t, agSeeded(t, editRoot), op); !strings.Contains(message, "NUL") {
			t.Errorf("%s: %s", name, message)
		}
	}
}

// The request parser is the first NUL gate; this is the second one, for any
// caller that reaches the converter directly. An escaped NUL is not a raw
// one, so the JSON reader lets it through to the converter's own guard.
func TestRefusesANulThatDidNotComeThroughTheRequestParser(t *testing.T) {
	paragraph := `{ "type": "p", "data": {} }`
	for name, op := range map[string]EditOp{
		"insert id":         Insert{ID: "new\x00id", Block: node(t, []byte(paragraph))},
		"insert type":       Insert{ID: "new", Block: node(t, []byte(`{ "type": "p\u0000p", "data": {} }`))},
		"insert data key":   Insert{ID: "new", Block: node(t, []byte(`{ "type": "p", "data": { "k\u0000": 1 } }`))},
		"insert data value": Insert{ID: "new", Block: node(t, []byte(`{ "type": "p", "data": { "k": "a\u0000b" } }`))},
		"insert parent":     Insert{ID: "new", Parent: agPtr("root\x00"), Block: node(t, []byte(paragraph))},
		"update data":       Update{ID: "root", Data: node(t, []byte(`{ "text": "a\u0000b" }`))},
		"remove id":         Remove{ID: "root\x00"},
	} {
		doc := agSeeded(t, editRoot)
		message := editRefusal(t, doc, op)
		if !strings.HasPrefix(message, "collab: op 0:") || !strings.Contains(message, "NUL") {
			t.Errorf("%s: %s", name, message)
		}
		if got := agIDs(agExported(t, doc)); got != "root" {
			t.Errorf("%s: blocks %s", name, got)
		}
	}
}

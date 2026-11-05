package convert

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/lib0"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// Twins of C# CollabRestorePlannerTests edit-planner cases that had no Go twin.

func histParagraphDoc(t *testing.T) *yjs.Doc {
	t.Helper()
	data, err := jsjson.ParseNode([]byte(`{"blocks":[{"id":"a","type":"paragraph","data":{"text":"a"}}]}`), jsjson.Options{MaxDepth: JSONMaxDepth})
	if err != nil {
		t.Fatal(err)
	}
	doc := yjs.NewDoc(yjs.Options{})
	if err := (&DocConverter{Now: time.Now, HTML: runtimeReader(t)}).Seed(context.Background(), doc, data); err != nil {
		t.Fatal(err)
	}
	return doc
}

func histState(t *testing.T, doc *yjs.Doc) []byte {
	t.Helper()
	state, err := doc.EncodeStateAsUpdate(nil)
	if err != nil {
		t.Fatal(err)
	}
	return state
}

func histRefusedUnchanged(t *testing.T, doc *yjs.Doc, ops []EditOp) {
	t.Helper()
	state := histState(t, doc)
	err := ApplyOps(doc, ops, nil)
	var refusal *EditError
	if !errors.As(err, &refusal) {
		t.Fatalf("err = %v, want an EditError", err)
	}
	if !bytes.Equal(state, histState(t, doc)) {
		t.Fatal("a refused patch wrote to the doc")
	}
}

// The "blocks" row is refuse-patch-of-an-unknown-map in collab-edits/cases.json.
func TestTheEditPlannerRefusesAPatchOfAnotherMap(t *testing.T) {
	for _, name := range []string{"root"} {
		t.Run(name, func(t *testing.T) {
			histRefusedUnchanged(t, histParagraphDoc(t), []EditOp{
				PatchMaps{Patches: []MapPatch{{Map: name, Key: "a", Value: jsjson.FromString("x")}}},
			})
		})
	}
}

func TestTheEditPlannerRefusesAValueAMapCannotHold(t *testing.T) {
	histRefusedUnchanged(t, histParagraphDoc(t), []EditOp{
		PatchMaps{Patches: []MapPatch{
			{Map: "page", Key: "title", Value: jsjson.FromString("ok")},
			{Map: "values", Key: "k", Value: lib0.BigInt(7)},
		}},
	})
}

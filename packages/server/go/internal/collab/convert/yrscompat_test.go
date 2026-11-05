package convert

import (
	"context"
	"encoding/base64"
	"os"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/collab/collabtest"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// Twin of C# YrsCompatCorpusTests.CapturedUpdatesApplyIntoTheEngineAndExportTheCanonicalJson:
// yrs bytes, integrated by the engine, export the client's canonical JSON.
func TestCapturedUpdatesApplyIntoTheEngineAndExportTheCanonicalJSON(t *testing.T) {
	raw, err := os.ReadFile(collabtest.Path(t, "yjs-engine/yrs-compat.json"))
	if err != nil {
		t.Fatal(err)
	}
	cases, _ := lookupValue(jsValue(t, raw).(*jsjson.Object), "cases").([]any)
	if len(cases) == 0 {
		t.Fatal("empty corpus")
	}
	clientID := uint32(2)
	for _, entry := range cases {
		object := entry.(*jsjson.Object)
		name := lookupValue(object, "name").(jsjson.Str).String()
		update, err := base64.StdEncoding.DecodeString(lookupValue(object, "update").(jsjson.Str).String())
		if err != nil {
			t.Fatal(err)
		}
		doc := yjs.NewDoc(yjs.Options{ClientID: &clientID})
		if result, err := doc.ApplyUpdate(update); err != nil || result.Outcome != yjs.Applied {
			t.Fatalf("%s: %+v %v", name, result, err)
		}
		exported, err := converter(t, nil).Export(context.Background(), doc)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		want := canonical(t, withSegments(t, lookupValue(object, "canonical").([]any)))
		if got := canonical(t, lookupValue(exported, "blocks")); got != want {
			t.Errorf("%s:\n got %s\nwant %s", name, got, want)
		}
	}
}

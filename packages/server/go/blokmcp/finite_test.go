package blokmcp

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFiniteJSONWritesAnOverflowingNumberAsNull(t *testing.T) {
	in := `{"a":1e400,"b":-1E+999,"c":"1e400","d":[1e-400,12,-0.5e3],"e":"x\"1e400"}`
	want := `{"a":null,"b":null,"c":"1e400","d":[1e-400,12,-0.5e3],"e":"x\"1e400"}`
	if got := string(finiteJSON([]byte(in))); got != want {
		t.Fatalf("got %s", got)
	}
}

// JSON.parse reads 1e400 as Infinity and JSON.stringify writes null: Node
// opens such a document and saves null.
func TestADocumentHoldingAnOverflowingNumberOpensAndSavesNull(t *testing.T) {
	doc := `{"title":"x","blocks":[{"id":"p1","type":"paragraph","data":{"text":"a","n":1e400}}]}`
	var put string
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPut {
			body, _ := io.ReadAll(r.Body)
			put = string(body)
			_, _ = w.Write([]byte(`{"version":"v2"}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":` + doc + `,"version":"v1"}`))
	}))
	t.Cleanup(host.Close)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "doc.json"), []byte(doc), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, source := range []*Source{{Kind: "files", Dir: dir}, {Kind: "endpoint", URL: host.URL + "/docs", EndpointAuth: "Token t"}} {
		server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: source})
		if err != nil {
			t.Fatal(err)
		}
		send, answer, end := rawStdio(t, server)
		handle := openHandle(t, send, answer)
		send(insertLine(2, handle, 1))
		if _, ok := answer("2")["result"]; !ok {
			t.Fatalf("%s execute: %s", source.Kind, answer("2")["error"])
		}
		end()
		server.Close()
	}
	saved, _ := os.ReadFile(filepath.Join(dir, "doc.json"))
	if !strings.Contains(string(saved), `"n": null`) {
		t.Fatalf("files saved: %s", saved)
	}
	if !strings.Contains(put, `"n":null`) {
		t.Fatalf("endpoint saved: %s", put)
	}
}

// JSON.parse reads 1e400 in the arguments as Infinity: a list limit takes
// it, and a read view refuses it as not finite.
func TestAnOverflowingArgumentIsInfinityAsInNode(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "doc.json"), []byte(`{"blocks":[]}`), 0o644)
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: dir}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	ctx := context.Background()
	who, err := server.actorFor(ctx, "alice", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, limit := range []string{"1e400", "-1e400"} {
		listed, err := server.dispatch(ctx, &toolCall{name: "blok_list_documents", arguments: json.RawMessage(`{"limit":` + limit + `}`), caller: who})
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := structured(t, listed.answer)["documents"]; !ok {
			t.Errorf("limit %s: %s", limit, listed.answer)
		}
	}
	opened, err := server.dispatch(ctx, &toolCall{name: "blok_open", arguments: json.RawMessage(`{"documentId":"doc","view":{"limit":1e400}}`), caller: who})
	if err != nil {
		t.Fatal(err)
	}
	failure, _ := structured(t, opened.answer)["error"].(map[string]any)
	if failure["message"] != "doc.read: must be a finite number" {
		t.Errorf("view limit: %s", opened.answer)
	}
}

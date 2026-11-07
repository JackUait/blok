package blokmcp

import (
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

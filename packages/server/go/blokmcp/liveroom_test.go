package blokmcp

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/blokserver"
)

func structured(t *testing.T, answer json.RawMessage) map[string]any {
	t.Helper()
	var parts struct {
		StructuredContent map[string]any `json:"structuredContent"`
	}
	if err := json.Unmarshal(answer, &parts); err != nil {
		t.Fatal(err)
	}
	return parts.StructuredContent
}

// An app that hosts Blok collaboration gives the MCP server its own rooms.
func TestLiveHandlesEditTheRoomsOfTheSameProcess(t *testing.T) {
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, `{"blocks":[{"id":"a","type":"paragraph","data":{"text":"Hello"}}]}`)
		}
	}))
	defer endpoint.Close()
	options := blokserver.DefaultOptions()
	options.CollabEnabled = true
	options.CollabDirectory = t.TempDir()
	options.CollabJournal = true
	options.Auth = new("none")
	options.DocEndpoint = endpoint.URL + "/docs"
	host, err := blokserver.New(options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = host.Drain(context.Background()) })
	executor, err := host.AgentExecutor()
	if err != nil {
		t.Fatal(err)
	}
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Rooms: executor})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	ctx := context.Background()
	who, err := server.actorFor(ctx, "alice", nil)
	if err != nil {
		t.Fatal(err)
	}
	call := func(name string, arguments map[string]any) map[string]any {
		raw, _ := json.Marshal(arguments)
		result, err := server.dispatch(ctx, &toolCall{name: name, arguments: raw, caller: who})
		if err != nil {
			t.Fatal(err)
		}
		return structured(t, result.answer)
	}

	opened := call("blok_open", map[string]any{"documentId": "doc", "write": true})
	if opened["mode"] != "live" || opened["durability"] != "acknowledged" {
		t.Fatalf("opened %v", opened)
	}
	handle := opened["handle"]
	ran := call("blok_execute", map[string]any{"handle": handle, "commands": []any{map[string]any{"name": "doc.setTitle", "args": map[string]any{"title": "From MCP"}}}})
	delivery, _ := ran["delivery"].(map[string]any)
	if ran["ok"] != true || delivery["durable"] != true {
		t.Fatalf("executed %v", ran)
	}
	read := call("blok_read", map[string]any{"handle": handle})
	page, _ := read["page"].(map[string]any)
	if page["title"] != "From MCP" {
		t.Fatalf("read %v", read)
	}
}

package blokmcp

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/blokagent"
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

func roomHost(t *testing.T, document string) *blokserver.Server {
	t.Helper()
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, document)
		}
	}))
	t.Cleanup(endpoint.Close)
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
	return host
}

func roomServer(t *testing.T, host *blokserver.Server) (*Server, func(name string, arguments map[string]any, approval map[string]any) *outcome) {
	t.Helper()
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
	return server, func(name string, arguments map[string]any, approval map[string]any) *outcome {
		raw, _ := json.Marshal(arguments)
		result, err := server.dispatch(ctx, &toolCall{name: name, arguments: raw, caller: who, approval: approval})
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
}

// An app that hosts Blok collaboration gives the MCP server its own rooms.
func TestLiveHandlesEditTheRoomsOfTheSameProcess(t *testing.T) {
	server, call := roomServer(t, roomHost(t, `{"blocks":[{"id":"a","type":"paragraph","data":{"text":"Hello"}}]}`))
	opened := structured(t, call("blok_open", map[string]any{"documentId": "doc", "write": true}, nil).answer)
	if opened["mode"] != "live" || opened["durability"] != "acknowledged" || opened["contractRevision"] != server.surface.ContractRevision.Live {
		t.Fatalf("opened %v, live contract %s", opened, server.surface.ContractRevision.Live)
	}
	handle := opened["handle"]
	ran := structured(t, call("blok_execute", map[string]any{"handle": handle, "commands": []any{map[string]any{"name": "doc.setTitle", "args": map[string]any{"title": "From MCP"}}}}, nil).answer)
	delivery, _ := ran["delivery"].(map[string]any)
	if ran["ok"] != true || delivery["durable"] != true {
		t.Fatalf("executed %v", ran)
	}
	read := structured(t, call("blok_read", map[string]any{"handle": handle}, nil).answer)
	page, _ := read["page"].(map[string]any)
	if page["title"] != "From MCP" {
		t.Fatalf("read %v", read)
	}
}

// A room's unlock asks the person through the client, as a remote one does.
func TestAnInProcessUnlockAsksThenApplies(t *testing.T) {
	_, call := roomServer(t, roomHost(t, `{"blocks":[{"id":"db","type":"database","content":[],"data":{"title":"Payroll","activeViewId":"v",`+
		`"schema":[{"id":"t","name":"Name","type":"title","position":"a0","databaseLocked":true}],`+
		`"views":[{"id":"v","name":"Table","type":"table","position":"a0","sorts":[],"filters":[],"visibleProperties":[]}]}}]}`))
	handle := structured(t, call("blok_open", map[string]any{"documentId": "doc", "write": true}, nil).answer)["handle"]
	unlock := map[string]any{"handle": handle, "commands": []any{map[string]any{"name": "database.setLock", "args": map[string]any{"id": "db", "locked": false}}}}
	approval := map[string]any{"capabilities": map[string]any{"elicitation": map[string]any{}}, "clientName": "c"}
	asked := call("blok_execute", unlock, approval)
	if asked.ask == nil {
		t.Fatalf("no question: %s", asked.answer)
	}
	approval["replies"] = map[string]any{asked.ask.Key: map[string]any{"action": "accept", "content": map[string]any{"unlock": true}}}
	ran := structured(t, call("blok_execute", unlock, approval).answer)
	if ran["ok"] != true {
		t.Fatalf("the approved unlock answered %v", ran)
	}
}

// One caller's cancelled request must not become every later caller's
// answer.
func TestACancelledFirstContractLoadIsNotKept(t *testing.T) {
	executor, err := blokagent.New(blokagent.FactoryOptions{})
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{options: Options{Rooms: executor}, flags: map[string]any{"sync": true, "source": false, "uploads": false}}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	_, _ = server.roomReadOnly(cancelled)
	readOnly, err := server.roomReadOnly(context.Background())
	if err != nil || len(readOnly) == 0 {
		t.Fatalf("the second load answered %v (%d commands)", err, len(readOnly))
	}
}

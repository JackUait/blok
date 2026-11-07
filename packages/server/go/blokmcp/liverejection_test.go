package blokmcp

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/blokserver"
	"github.com/JackUait/blok/packages/server/go/v2/blokserver/ticket"
)

const rejectionSecret = "mcp-live-conformance-secret-0123456789"
const rejectionOrigin = "https://app.example.com"

// A real sync host with ticket auth and a journal, served over HTTP.
func ticketHost(t *testing.T) *httptest.Server {
	t.Helper()
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, "null")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(endpoint.Close)
	options := blokserver.DefaultOptions()
	options.CollabEnabled = true
	options.CollabDirectory = t.TempDir()
	options.CollabJournal = true
	options.Auth = new("ticket")
	options.Secret = rejectionSecret
	options.AllowedOrigins = []string{rejectionOrigin}
	options.DocEndpoint = endpoint.URL + "/docs"
	host, err := blokserver.New(options)
	if err != nil {
		t.Fatal(err)
	}
	served := httptest.NewServer(host.Handler(""))
	t.Cleanup(func() {
		served.CloseClientConnections()
		served.Close()
		_ = host.Drain(context.Background())
	})
	return served
}

// The ticket endpoint grants read only first, then write. The first ticket
// lives 31 s, so with the 30 s refresh margin a reconnect mints again.
func downgradedTickets(t *testing.T) *httptest.Server {
	t.Helper()
	var posts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request ticketRequest
		_ = json.NewDecoder(r.Body).Decode(&request)
		write := posts.Add(1) > 1
		ttl := int64(1800)
		if !write {
			ttl = 31
		}
		pass, err := ticket.Mint(rejectionSecret, ticket.Claims{User: request.ActorID, Doc: &request.Doc, Write: write, TTLSeconds: &ttl}, time.Now())
		if err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"ticket": pass})
	}))
	t.Cleanup(server.Close)
	return server
}

// The journal's versions, read through the host's own history route.
func hostVersions(t *testing.T, host *httptest.Server, doc string) []any {
	t.Helper()
	ttl := int64(60)
	reader, err := ticket.Mint(rejectionSecret, ticket.Claims{User: "inspector", Doc: &doc, TTLSeconds: &ttl}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	request, _ := http.NewRequest(http.MethodGet, host.URL+"/sync/"+doc+"/history", nil)
	request.Header.Set("Authorization", "Bearer "+reader)
	request.Header.Set("Origin", rejectionOrigin)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var body struct {
		Versions []any `json:"versions"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("history %d: %v", response.StatusCode, err)
	}
	return body.Versions
}

// A batch the room refused as read-only is answered "not saved". A later
// connection, now allowed to write, must not send it as the residual diff.
func TestARefusedBatchIsNotSavedByTheNextConnection(t *testing.T) {
	host := ticketHost(t)
	tickets := downgradedTickets(t)
	origin := rejectionOrigin
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"},
		Sync:    &Sync{URL: "ws" + strings.TrimPrefix(host.URL, "http") + "/sync", Origin: &origin},
		Tickets: &Tickets{Kind: "url", URL: tickets.URL, HostToken: "host-token-1"}})
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

	handle, _ := call("blok_open", map[string]any{"documentId": "live-doc", "write": true})["handle"].(string)
	refused := call("blok_execute", map[string]any{"handle": handle, "commands": []any{map[string]any{"name": "block.insert",
		"args": map[string]any{"type": "paragraph", "id": "p1", "data": map[string]any{"text": "REFUSED"}}}}})
	if failure, _ := refused["error"].(map[string]any); failure["code"] != "READ_ONLY" {
		t.Fatalf("the refused batch answered %v", refused)
	}

	server.handles.mu.Lock()
	room := server.handles.entries[handle].session.(*liveSession).room
	server.handles.mu.Unlock()
	// Past the first ticket's refresh margin, so the reconnect may write.
	time.Sleep(1100 * time.Millisecond)
	room.mu.Lock()
	generation := room.generation
	room.conn.abort()
	room.mu.Unlock()

	deadline := time.Now().Add(10 * time.Second)
	for {
		room.mu.Lock()
		synced := room.synced && room.generation > generation+1
		room.mu.Unlock()
		if synced {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the room did not reconnect")
		}
		time.Sleep(20 * time.Millisecond)
	}
	// Room for the residual round to run.
	time.Sleep(500 * time.Millisecond)

	if versions := hostVersions(t, host, "live-doc"); len(versions) != 1 {
		t.Fatalf("the host journalled the refused batch after the reconnect: %v", versions)
	}
	read := call("blok_read", map[string]any{"handle": handle})
	if blocks, _ := read["blocks"].([]any); len(blocks) != 0 {
		t.Fatalf("the handle still reads the refused batch: %v", blocks)
	}
}

// After the swap, history.undo and history.redo know nothing of the
// discarded doc, and undo a later step on the live one.
func TestHistoryAfterTheSwapActsOnTheLiveDoc(t *testing.T) {
	host := ticketHost(t)
	tickets := downgradedTickets(t)
	origin := rejectionOrigin
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"},
		Sync:    &Sync{URL: "ws" + strings.TrimPrefix(host.URL, "http") + "/sync", Origin: &origin},
		Tickets: &Tickets{Kind: "url", URL: tickets.URL, HostToken: "host-token-1"}})
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
	execute := func(handle string, command map[string]any) map[string]any {
		return call("blok_execute", map[string]any{"handle": handle, "commands": []any{command}})
	}
	code := func(answer map[string]any) any {
		failure, _ := answer["error"].(map[string]any)
		return failure["code"]
	}

	handle, _ := call("blok_open", map[string]any{"documentId": "live-doc", "write": true})["handle"].(string)
	execute(handle, map[string]any{"name": "block.insert", "args": map[string]any{"type": "paragraph", "id": "p1", "data": map[string]any{"text": "REFUSED"}}})
	server.handles.mu.Lock()
	live := server.handles.entries[handle].session.(*liveSession)
	server.handles.mu.Unlock()
	room := live.room
	time.Sleep(1100 * time.Millisecond)
	room.mu.Lock()
	generation := room.generation
	room.conn.abort()
	room.mu.Unlock()
	deadline := time.Now().Add(10 * time.Second)
	for {
		room.mu.Lock()
		synced := room.synced && room.generation > generation+1
		room.mu.Unlock()
		if synced {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the room did not reconnect")
		}
		time.Sleep(20 * time.Millisecond)
	}
	time.Sleep(300 * time.Millisecond)
	// A read-only refusal latches the handle read-only; lift it so history is
	// reached, as after a refusal with another code.
	live.readOnly = false

	if got := code(execute(handle, map[string]any{"name": "history.undo", "args": map[string]any{}})); got != "NOTHING_TO_UNDO" {
		t.Fatalf("history.undo after the swap answered %v", got)
	}
	if got := code(execute(handle, map[string]any{"name": "history.redo", "args": map[string]any{}})); got != "NOTHING_TO_REDO" {
		t.Fatalf("history.redo after the swap answered %v", got)
	}
	if wrote := execute(handle, map[string]any{"name": "block.insert", "args": map[string]any{"type": "paragraph", "id": "p2", "data": map[string]any{"text": "later"}}}); wrote["ok"] != true {
		t.Fatalf("the later write answered %v", wrote)
	}
	if undone := execute(handle, map[string]any{"name": "history.undo", "args": map[string]any{}}); undone["ok"] != true {
		t.Fatalf("the undo of the later write answered %v", undone)
	}
	read := call("blok_read", map[string]any{"handle": handle})
	if blocks, _ := read["blocks"].([]any); len(blocks) != 0 {
		t.Fatalf("the undo missed the live doc: %v", blocks)
	}
}

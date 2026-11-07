package blokmcp

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/blokserver"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
)

// failsSecondSeededRead fails the second read of the seeded row's HTML.
// A batch exports the room once before it runs and once after it applies.
type failsSecondSeededRead struct {
	inner convert.HTMLReader
	mu    sync.Mutex
	reads int
}

func (r *failsSecondSeededRead) Read(ctx context.Context, fields []convert.RichTextHTML, timeout *time.Duration) ([][]any, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, field := range fields {
		if strings.Contains(field.HTML.String(), "SEEDED") {
			r.reads++
			if r.reads == 2 {
				return nil, errors.New("the export broke")
			}
			break
		}
	}
	return r.inner.Read(ctx, fields, timeout)
}

const exportFailSecret = "mcp-live-export-fail-secret-0123456789"
const exportFailOrigin = "https://app.example.com"

func openHostServer(t *testing.T, document string) *httptest.Server {
	t.Helper()
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, document)
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
	options.Secret = exportFailSecret
	options.AllowedOrigins = []string{exportFailOrigin}
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

func syncClient(t *testing.T, host *httptest.Server) (*Server, *callContextWho) {
	t.Helper()
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"},
		Sync:    &Sync{URL: "ws" + strings.TrimPrefix(host.URL, "http") + "/sync", Origin: new(exportFailOrigin)},
		Tickets: &Tickets{Kind: "secret", Secret: exportFailSecret}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	who, err := server.actorFor(context.Background(), "alice", nil)
	if err != nil {
		t.Fatal(err)
	}
	return server, &callContextWho{server: server, who: who}
}

type callContextWho struct {
	server *Server
	who    *caller
}

func (c *callContextWho) dispatch(name string, arguments map[string]any) (*outcome, error) {
	raw, _ := json.Marshal(arguments)
	return c.server.dispatch(context.Background(), &toolCall{name: name, arguments: raw, caller: c.who})
}

// A batch whose edits applied but whose export then failed must not keep
// the room holding local writes: they still reach the host.
func TestAFailedExportAfterApplyStillSendsTheEdits(t *testing.T) {
	host := openHostServer(t, `{"blocks":[{"id":"r","type":"database-row","data":{"properties":{"body":{"blocks":[`+
		`{"id":"n","type":"paragraph","data":{"text":"<b>SEEDED</b>"}}]}}}}]}`)
	server, writer := syncClient(t, host)
	opened, err := writer.dispatch("blok_open", map[string]any{"documentId": "doc", "write": true})
	if err != nil {
		t.Fatal(err)
	}
	handle, _ := structured(t, opened.answer)["handle"].(string)
	server.handles.mu.Lock()
	live, ok := server.handles.entries[handle].session.(*liveSession)
	server.handles.mu.Unlock()
	if !ok {
		t.Fatal("the handle is not a live session")
	}
	live.room.mu.Lock()
	live.room.converter.HTML = &failsSecondSeededRead{inner: live.room.converter.HTML}
	live.room.mu.Unlock()

	_, err = writer.dispatch("blok_execute", map[string]any{"handle": handle, "commands": []any{map[string]any{"name": "block.insert",
		"args": map[string]any{"type": "paragraph", "id": "p1", "data": map[string]any{"text": "APPLIED"}}}}})
	if err == nil || !strings.Contains(err.Error(), "the export broke") {
		t.Fatalf("the batch did not stop at the export after its apply: %v", err)
	}

	live.room.mu.Lock()
	held, pending := live.room.holdAppends, len(live.room.pendingLocal)
	live.room.mu.Unlock()
	if held || pending > 0 {
		t.Fatalf("the room still holds local writes (hold %v, %d pending)", held, pending)
	}

	_, reader := syncClient(t, host)
	deadline := time.Now().Add(5 * time.Second)
	for {
		got, err := reader.dispatch("blok_open", map[string]any{"documentId": "doc"})
		if err != nil {
			t.Fatal(err)
		}
		readHandle, _ := structured(t, got.answer)["handle"].(string)
		read, err := reader.dispatch("blok_read", map[string]any{"handle": readHandle})
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(read.answer), "APPLIED") {
			break
		}
		_, _ = reader.dispatch("blok_close", map[string]any{"handle": readHandle})
		if time.Now().After(deadline) {
			t.Fatalf("the applied edit never reached the host: %s", read.answer)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

package collabhttp

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/internal/collab/room"
	"github.com/JackUait/blok/packages/server/go/internal/collab/workingset"
)

// Twins of C# StateEndpointTests cases that had no Go twin.

const synAllowedOrigin = "https://app.example.com"

// synExposed is C# ExposedHeaders: the names, split and sorted, after
// checking the answer is a CORS one.
func synExposed(t *testing.T, response *http.Response) []string {
	t.Helper()
	if origin := response.Header.Values("Access-Control-Allow-Origin"); len(origin) != 1 || origin[0] != synAllowedOrigin {
		t.Fatalf("Access-Control-Allow-Origin = %q", origin)
	}
	var names []string
	for _, value := range response.Header.Values("Access-Control-Expose-Headers") {
		for _, name := range strings.Split(value, ",") {
			names = append(names, strings.TrimSpace(name))
		}
	}
	slices.Sort(names)
	return names
}

// A host's own CORS layer may expose headers first; ours are added, not
// swapped in, and "etag" already covers ETag.
func TestTheHeadHeadersJoinHeadersTheAppAlreadyExposes(t *testing.T) {
	store, err := journal.NewStore(t.TempDir(), journal.StoreOptions{})
	if err != nil {
		t.Fatal(err)
	}
	manager := room.NewManager(room.ManagerOptions{
		Store: workingset.NewLocalStore(t.TempDir(), nil), Endpoint: heldDocument{},
		Converter:  &convert.DocConverter{Now: time.Now, HTML: runtimeReader(t)},
		Operations: room.LocalJournal{Store: store}, Room: room.Options{MaxUpdateBytes: store.MaxUpdateBytes()},
	})
	t.Cleanup(func() { _ = manager.Drain(context.Background()) })
	routes := New(Config{Rooms: func() (*room.Manager, error) { return manager, nil }, MaxMessageBytes: 8 << 20})
	mux := http.NewServeMux()
	mux.HandleFunc("POST /sync/{doc}/edit", routes.Edit)
	mux.HandleFunc("GET /sync/{doc}/state", routes.State)
	// The CORS answer and the app's own exposed names, set before the routes run.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", synAllowedOrigin)
		w.Header().Set("Access-Control-Expose-Headers", "X-Request-Id, etag")
		mux.ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)

	send := func(method, path, key, body string) *http.Response {
		request, err := http.NewRequest(method, server.URL+"/sync/doc"+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Origin", synAllowedOrigin)
		if key != "" {
			request.Header.Set(IdempotencyKeyHeader, key)
			request.Header.Set("Content-Type", "application/json")
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, response.Body)
		response.Body.Close()
		return response
	}
	state := send("GET", "/state", "", "")
	edit := send("POST", "/edit", "joined-edit",
		`{ "ops": [ { "op": "insert", "id": "new", "block": { "type": "p", "data": { "text": "!" } } } ] }`)

	want := []string{"Blok-Doc-Lineage", "Blok-Doc-Sequence", "X-Request-Id", "etag"}
	if got := synExposed(t, state); !slices.Equal(got, want) {
		t.Errorf("state (%d) exposes %q", state.StatusCode, got)
	}
	if got := synExposed(t, edit); !slices.Equal(got, want) {
		t.Errorf("edit (%d) exposes %q", edit.StatusCode, got)
	}
}

package blokserver

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
)

// Twin of C# StateEndpointTests.TheHeadHeadersJoinHeadersTheAppAlreadyExposes.
// It runs through the whole server, so Access-Control-Allow-Origin comes
// from the server's own CORS step, as in C#'s SyncApp.

const corsAllowedOrigin = "https://app.example.com"

// corsExposed is C# ExposedHeaders: the names, split and sorted, after
// checking the answer is a CORS one.
func corsExposed(t *testing.T, response *http.Response) []string {
	t.Helper()
	if origin := response.Header.Values("Access-Control-Allow-Origin"); len(origin) != 1 || origin[0] != corsAllowedOrigin {
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
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, `{"blocks":[{"id":"a","type":"paragraph","data":{"text":"seeded"}}]}`)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(endpoint.Close)
	o := collabOptions(t)
	o.StorageDirectory = ""
	o.DocEndpoint = endpoint.URL + "/docs"
	o.CollabJournal = true
	o.AllowedOrigins = []string{corsAllowedOrigin}
	o.Authorization = allowAll{}
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Drain(context.Background()) })
	handler := s.Handler("")
	// The app's own exposed names, set before the server runs.
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Expose-Headers", "X-Request-Id, etag")
		handler.ServeHTTP(w, r)
	}))
	t.Cleanup(host.Close)

	send := func(method, path, key, body string) *http.Response {
		request, err := http.NewRequest(method, host.URL+"/sync/doc"+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Origin", corsAllowedOrigin)
		if key != "" {
			request.Header.Set("Blok-Idempotency-Key", key)
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

	if state.StatusCode != http.StatusOK || edit.StatusCode != http.StatusNoContent {
		t.Fatalf("state %d, edit %d", state.StatusCode, edit.StatusCode)
	}
	want := []string{"Blok-Doc-Lineage", "Blok-Doc-Sequence", "X-Request-Id", "etag"}
	if got := corsExposed(t, state); !slices.Equal(got, want) {
		t.Errorf("state exposes %q", got)
	}
	if got := corsExposed(t, edit); !slices.Equal(got, want) {
		t.Errorf("edit exposes %q", got)
	}
}

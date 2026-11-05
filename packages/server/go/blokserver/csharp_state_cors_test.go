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

// corsApp is SyncApp with the journal on, behind the whole server.
// exposed is what the app's own CORS layer exposes first.
func corsApp(t *testing.T, exposed string) func(method, path, key, ifMatch string) *http.Response {
	t.Helper()
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
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if exposed != "" {
			w.Header().Set("Access-Control-Expose-Headers", exposed)
		}
		handler.ServeHTTP(w, r)
	}))
	t.Cleanup(host.Close)

	return func(method, path, key, ifMatch string) *http.Response {
		body := ""
		if method == http.MethodPost {
			body = `{ "ops": [ { "op": "insert", "id": "new", "block": { "type": "p", "data": { "text": "!" } } } ] }`
		}
		request, err := http.NewRequest(method, host.URL+"/sync/doc"+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Origin", corsAllowedOrigin)
		if key != "" {
			request.Header.Set("Blok-Idempotency-Key", key)
			request.Header.Set("Content-Type", "application/json")
		}
		if ifMatch != "" {
			request.Header.Set("If-Match", ifMatch)
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, response.Body)
		response.Body.Close()
		return response
	}
}

// A browser hides every response header CORS does not expose, so a
// cross-origin page could not build If-Match from /state or recover from a 412.
func TestACrossOriginPageCanReadTheHeadHeadersOnStateAndEdit(t *testing.T) {
	send := corsApp(t, "")
	state := send("GET", "/state", "", "")
	applied := send("POST", "/edit", "exposed-edit", "")
	stale := send("POST", "/edit", "exposed-stale", state.Header.Get("ETag"))

	if applied.StatusCode != http.StatusNoContent || stale.StatusCode != http.StatusPreconditionFailed {
		t.Fatalf("applied %d, stale %d", applied.StatusCode, stale.StatusCode)
	}
	want := []string{"Blok-Doc-Lineage", "Blok-Doc-Sequence", "ETag"}
	for name, response := range map[string]*http.Response{"state": state, "applied": applied, "stale": stale} {
		if got := corsExposed(t, response); !slices.Equal(got, want) {
			t.Errorf("%s exposes %q", name, got)
		}
	}
}

// A host's own CORS layer may expose headers first; ours are added, not
// swapped in, and "etag" already covers ETag.
func TestTheHeadHeadersJoinHeadersTheAppAlreadyExposes(t *testing.T) {
	send := corsApp(t, "X-Request-Id, etag")
	state := send("GET", "/state", "", "")
	edit := send("POST", "/edit", "joined-edit", "")

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

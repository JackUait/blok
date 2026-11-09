package blokserver

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Twins of C# SyncEndpointTests registration cases that had no Go twin.

func syn2Preflight(h http.Handler, path string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodOptions, path, nil)
	request.Header.Set("Origin", "https://app.example.com")
	request.Header.Set("Access-Control-Request-Method", "POST")
	recorder := httptest.NewRecorder()
	h.ServeHTTP(recorder, request)
	return recorder
}

// The reset route is POST plus its OPTIONS preflight with collaboration on,
// and neither sync route exists with it off. The GET door itself is pinned
// by TestTheSyncDoorIsMappedOutsideTheGuardWithAGetOnly405 and
// TestTheSyncDoorLiftsTheRequestDeadlineBeforeItJoins.
func TestMapsTheSyncRoutesOnlyWhenCollaborationIsEnabled(t *testing.T) {
	o := collabOptions(t)
	o.AllowedOrigins = []string{"https://app.example.com"}
	o.Authorization = allowAll{}
	enabled, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	h := enabled.Handler("/blok")
	preflight := syn2Preflight(h, "/blok/sync/doc/reset")
	if preflight.Code != http.StatusNoContent || preflight.Header().Get("Access-Control-Allow-Methods") != "POST, OPTIONS" {
		t.Fatalf("reset preflight: %d %v", preflight.Code, preflight.Header())
	}

	disabledOptions := DefaultOptions()
	disabledOptions.AllowedOrigins = []string{"https://app.example.com"}
	disabled, err := New(disabledOptions)
	if err != nil {
		t.Fatal(err)
	}
	h = disabled.Handler("/blok")
	for _, c := range []struct{ method, path string }{
		{"GET", "/blok/sync/doc"},
		{"POST", "/blok/sync/doc/reset"},
	} {
		recorder := httptest.NewRecorder()
		h.ServeHTTP(recorder, httptest.NewRequest(c.method, c.path, nil))
		if recorder.Code != http.StatusNotFound {
			t.Errorf("%s %s with collaboration off: %d", c.method, c.path, recorder.Code)
		}
	}
	if got := syn2Preflight(h, "/blok/sync/doc/reset"); got.Code != http.StatusNotFound {
		t.Errorf("reset preflight with collaboration off: %d", got.Code)
	}
}

// The open-routes warning names every collab route. Go names its own hook
// (Options.Authorization) where C# names IBlokAuthorization; the hook and
// ticket cases are TestOpenSyncRoutesWarnUnderTheHostCategory.
func TestWarnsAtRegistrationWhenNothingGuardsTheSyncRoutesInProcess(t *testing.T) {
	var records []string
	o := collabOptions(t)
	o.Logger = slog.New(recordingHandler{&records})
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	s.Handler("/blok")

	if len(records) != 1 || !strings.HasPrefix(records[0], "WARN ") {
		t.Fatalf("records = %q, want one warning", records)
	}
	warning := records[0]
	for _, part := range []string{
		"Options.Authorization",
		"/blok/sync/{doc}",
		"/blok/sync/{doc}/reset",
		"/blok/sync/{doc}/edit",
		"GET /blok/sync/{doc}/state",
		"GET /blok/sync/{doc}/history,",
		"GET /blok/sync/{doc}/history/{lineage}/{sequence}",
		"DELETE /blok/sync/{doc}/history/{lineage}",
		"POST /blok/sync/{doc}/history/{lineage}/{sequence}/restore,",
		"POST /blok/sync/{doc}/history/{lineage}/{sequence}/restore/preview",
		"GET /blok/sync/{doc}/history/{lineage}/{sequence}/changes",
	} {
		if !strings.Contains(warning, part) {
			t.Errorf("the warning lacks %q: %s", part, warning)
		}
	}
	// The standalone host forwards only the room category.
	if strings.HasPrefix(warning, "WARN Blok.Server.Collab ") {
		t.Errorf("warned under the room category: %s", warning)
	}

	// C# logs EventId 2 "CollabOpen" with the routes as fields, which
	// shipped in 1.16.1; log queries may key on them.
	fields := map[string]string{}
	o = collabOptions(t)
	o.Logger = slog.New(attrsHandler{fields})
	s, err = New(o)
	if err != nil {
		t.Fatal(err)
	}
	s.Handler("/blok")
	for key, want := range map[string]string{
		"EventId":   "2",
		"EventName": "CollabOpen",
		"Sync":      "GET /blok/sync/{doc}",
		"Reset":     "POST /blok/sync/{doc}/reset",
		"Edit":      "POST /blok/sync/{doc}/edit",
		"State":     "GET /blok/sync/{doc}/state",
		"History": "GET /blok/sync/{doc}/history, GET /blok/sync/{doc}/history/{lineage}/{sequence}, " +
			"DELETE /blok/sync/{doc}/history/{lineage}, POST /blok/sync/{doc}/history/{lineage}/{sequence}/restore, " +
			"POST /blok/sync/{doc}/history/{lineage}/{sequence}/restore/preview, " +
			"GET /blok/sync/{doc}/history/{lineage}/{sequence}/changes, GET /blok/sync/{doc}/history/at, " +
			"GET /blok/sync/{doc}/history/changes",
	} {
		if fields[key] != want {
			t.Errorf("field %s = %q, want %q", key, fields[key], want)
		}
	}
}

// attrsHandler keeps every attribute of the records it gets, as text.
type attrsHandler struct{ fields map[string]string }

func (h attrsHandler) Enabled(context.Context, slog.Level) bool { return true }
func (h attrsHandler) Handle(_ context.Context, r slog.Record) error {
	r.Attrs(func(a slog.Attr) bool {
		h.fields[a.Key] = a.Value.String()
		return true
	})
	return nil
}
func (h attrsHandler) WithAttrs([]slog.Attr) slog.Handler { return h }
func (h attrsHandler) WithGroup(string) slog.Handler      { return h }

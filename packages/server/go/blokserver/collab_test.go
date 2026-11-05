package blokserver

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/jsruntime"
)

// recordingHandler keeps every record with its category.
type recordingHandler struct{ records *[]string }

func (h recordingHandler) Enabled(context.Context, slog.Level) bool { return true }
func (h recordingHandler) Handle(_ context.Context, r slog.Record) error {
	category := ""
	r.Attrs(func(a slog.Attr) bool {
		if a.Key == "category" {
			category = a.Value.String()
		}
		return true
	})
	*h.records = append(*h.records, r.Level.String()+" "+category+" "+r.Message)
	return nil
}
func (h recordingHandler) WithAttrs([]slog.Attr) slog.Handler { return h }
func (h recordingHandler) WithGroup(string) slog.Handler      { return h }

func collabOptions(t *testing.T) Options {
	t.Helper()
	o := DefaultOptions()
	o.CollabEnabled = true
	o.CollabDirectory = t.TempDir()
	o.DocEndpoint = "http://127.0.0.1:1/docs"
	return o
}

type allowAll struct{}

func (allowAll) CanReadDocument(context.Context, User, string) (bool, error)  { return true, nil }
func (allowAll) CanWriteDocument(context.Context, User, string) (bool, error) { return true, nil }

// L9: collab on, Auth none and no hook warns once per mapping, under its own
// category, so the standalone host (which prints only the room category)
// never shows it.
func TestOpenSyncRoutesWarnUnderTheHostCategory(t *testing.T) {
	var records []string
	o := collabOptions(t)
	o.Logger = slog.New(recordingHandler{&records})
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	s.Handler("/blok")
	if len(records) != 1 {
		t.Fatalf("records = %q, want one warning", records)
	}
	if !strings.HasPrefix(records[0], "WARN Blok.Server.AspNetCore collab: no authorization hook is set and Auth is \"none\", so GET /blok/sync/{doc}, POST /blok/sync/{doc}/reset") {
		t.Fatalf("warning = %q", records[0])
	}

	records = nil
	o.Authorization = allowAll{}
	if s, err = New(o); err != nil {
		t.Fatal(err)
	}
	s.Handler("")
	o.Authorization, o.Auth, o.Secret, o.AllowedOrigins = nil, new("ticket"), strings.Repeat("s", 32), []string{"https://app.example.com"}
	if s, err = New(o); err != nil {
		t.Fatal(err)
	}
	s.Handler("")
	if len(records) != 0 {
		t.Fatalf("a hook or ticket mode still warned: %q", records)
	}
}

// ICollabRoomManager.RecheckAccessAsync: only a loaded room is rechecked.
func TestRecheckAccessOfAnUnloadedDocumentExpelsNobody(t *testing.T) {
	s, err := New(collabOptions(t))
	if err != nil {
		t.Fatal(err)
	}
	expelled, err := s.RecheckAccess(context.Background(), "doc")
	if err != nil || expelled != 0 {
		t.Fatalf("RecheckAccess = %d, %v", expelled, err)
	}
}

// ICollabDocumentPurger: the id and the authorize callback are checked
// first, and a purged id is refused from then on.
func TestPurgeDocumentRefusesThenTombstones(t *testing.T) {
	s, err := New(collabOptions(t))
	if err != nil {
		t.Fatal(err)
	}
	allow := func(context.Context) (bool, error) { return true, nil }
	if _, err := s.PurgeDocument(context.Background(), "a/b", allow); err == nil || err.Error() != "collab: document ids must be a single path segment." {
		t.Fatalf("a two-segment id: %v", err)
	}
	deny := func(context.Context) (bool, error) { return false, nil }
	if _, err := s.PurgeDocument(context.Background(), "doc", deny); err == nil || err.Error() != "collab: document purge was not authorized." {
		t.Fatalf("a denied purge: %v", err)
	}
	if outcome, err := s.PurgeDocument(context.Background(), "doc", allow); err != nil || outcome != Purged {
		t.Fatalf("purge = %v, %v", outcome, err)
	}
	if outcome, err := s.PurgeDocument(context.Background(), "doc", allow); err != nil || outcome != Purged {
		t.Fatalf("a second purge of the same id: %v, %v", outcome, err)
	}
	if _, err := s.PurgeDocument(context.Background(), "x", nil); !errors.Is(err, ErrNoAuthorize) {
		t.Fatal("a nil authorize callback was accepted")
	}
}

// Shutdown does not wait for hijacked sockets, so Drain does: a member's
// 1001 close is only queued when the rooms are closed, and the process
// must not exit before its pump writes it (Kestrel waits for upgraded
// connections up to the shutdown timeout).
func TestDrainWaitsForOpenSyncConnectionsUpToItsContext(t *testing.T) {
	s, err := New(collabOptions(t))
	if err != nil {
		t.Fatal(err)
	}
	slot := s.connections.TryEnter()
	done := make(chan error, 1)
	go func() { done <- s.Drain(context.Background()) }()
	select {
	case err := <-done:
		t.Fatalf("Drain returned with a connection still open: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	slot.Release()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Drain did not return once the connection ended")
	}

	// Past its context the wait gives up quietly, as Kestrel aborts what is
	// left at the shutdown timeout without a warning of its own.
	held := s.connections.TryEnter()
	defer held.Release()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	started := time.Now()
	if err := s.Drain(ctx); err != nil || time.Since(started) > time.Second {
		t.Fatalf("a drain cut off by its context: %v after %s", err, time.Since(started))
	}
}

// S3, S4, E7, Y11: a purged id answers 403 forbidden on every collab door
// for the life of the process (CollabRoomManager.cs:201, purge lanes are
// never removed).
func TestAPurgedDocumentAnswersForbiddenOnEveryDoor(t *testing.T) {
	o := collabOptions(t)
	o.Auth = new("none")
	o.StorageDirectory = ""
	o.CollabJournal = true
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.PurgeDocument(context.Background(), "doc", func(context.Context) (bool, error) { return true, nil }); err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(s.Handler(""))
	defer host.Close()
	for _, c := range []struct{ method, path string }{
		{"GET", "/sync/doc/state"},
		{"POST", "/sync/doc/reset"},
		{"POST", "/sync/doc/edit"},
		{"GET", "/sync/doc/history"},
		{"GET", "/sync/doc/history/0123456789abcdef0123456789abcdef/0"},
		{"GET", "/sync/doc/history/0123456789abcdef0123456789abcdef/0/changes"},
		{"DELETE", "/sync/doc/history/0123456789abcdef0123456789abcdef"},
		{"POST", "/sync/doc/history/0123456789abcdef0123456789abcdef/0/restore"},
	} {
		request, _ := http.NewRequest(c.method, host.URL+c.path,
			strings.NewReader(`{"ops":[{"op":"remove","id":"a"}]}`))
		request.Header.Set("Blok-Idempotency-Key", "k1")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != http.StatusForbidden || string(body) != "forbidden\n" {
			t.Errorf("%s %s: %d %q", c.method, c.path, response.StatusCode, body)
		}
	}
}

// L2: like AddBlokServer's AddBlokDocuments(warmUp: false), a collab host
// builds no engine pool until a conversion first needs one.
func TestTheCollabRuntimeIsBuiltOnlyOnTheFirstHTMLRead(t *testing.T) {
	builds := 0
	previous := newCollabRuntime
	newCollabRuntime = func(jsruntime.Options) (*jsruntime.Pool, error) {
		builds++
		return nil, errors.New("no engine in this test")
	}
	t.Cleanup(func() { newCollabRuntime = previous })

	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/rich") {
			_, _ = io.WriteString(w, `{"blocks":[{"id":"a","type":"paragraph","data":{"text":"<b>x</b>"}}]}`)
			return
		}
		_, _ = io.WriteString(w, `null`)
	}))
	defer endpoint.Close()
	o := collabOptions(t)
	o.Auth = new("none")
	o.StorageDirectory = ""
	o.DocEndpoint = endpoint.URL + "/docs"
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(s.Handler(""))
	defer host.Close()
	get := func(path string) {
		response, err := http.Get(host.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, response.Body)
		response.Body.Close()
	}

	get("/health")
	get("/sync/plain/state")
	if builds != 0 {
		t.Fatalf("%d pools built before any HTML read, want 0", builds)
	}
	get("/sync/rich/state")
	get("/sync/rich/state")
	if builds != 1 {
		t.Fatalf("%d pools built after HTML reads, want 1", builds)
	}
}

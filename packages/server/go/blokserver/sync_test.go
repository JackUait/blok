package blokserver

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab"
)

type countingRooms struct {
	mu    sync.Mutex
	joins []string
}

func (r *countingRooms) Join(_ context.Context, doc string, _ collab.Member) (collab.JoinResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.joins = append(r.joins, doc)
	return collab.JoinResult{Status: collab.JoinDraining}, nil
}

func collabServer(t *testing.T, rooms collab.Rooms) *Server {
	t.Helper()
	o := DefaultOptions()
	o.CollabEnabled = true
	o.CollabDirectory = t.TempDir()
	o.DocEndpoint = "http://127.0.0.1:1/docs"
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	s.rooms = rooms
	return s
}

func upgradeRequest(method, path string) *http.Request {
	request := httptest.NewRequest(method, path, nil)
	request.Header.Set("Connection", "Upgrade")
	request.Header.Set("Upgrade", "websocket")
	request.Header.Set("Sec-WebSocket-Version", "13")
	request.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	return request
}

// MapGet("/sync/{doc}") outside the guard, and its 405 answers Allow: GET
// (BlokServerEndpointRouteBuilderExtensions.cs:103-105).
func TestTheSyncDoorIsMappedOutsideTheGuardWithAGetOnly405(t *testing.T) {
	rooms := &countingRooms{}
	h := collabServer(t, rooms).Handler("/blok")

	recorder := httptest.NewRecorder()
	h.ServeHTTP(recorder, upgradeRequest("GET", "/blok/sync/doc-1"))
	if recorder.Code != http.StatusServiceUnavailable || recorder.Body.String() != "shutting down\n" {
		t.Fatalf("GET: %d %q", recorder.Code, recorder.Body.String())
	}
	if len(rooms.joins) != 1 || rooms.joins[0] != "doc-1" {
		t.Fatalf("joins %v", rooms.joins)
	}

	recorder = httptest.NewRecorder()
	h.ServeHTTP(recorder, upgradeRequest("POST", "/blok/sync/doc-1"))
	if recorder.Code != http.StatusMethodNotAllowed || recorder.Header().Get("Allow") != "GET" {
		t.Fatalf("POST: %d Allow %q", recorder.Code, recorder.Header().Get("Allow"))
	}
}

func TestTheSyncDoorIsNotMappedWithoutCollaboration(t *testing.T) {
	s, err := New(DefaultOptions())
	if err != nil {
		t.Fatal(err)
	}
	s.rooms = &countingRooms{}
	recorder := httptest.NewRecorder()
	s.Handler("").ServeHTTP(recorder, upgradeRequest("GET", "/sync/doc-1"))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("got %d", recorder.Code)
	}
}

// GET /sync/{doc} lifts the host's request deadline before the door runs,
// as MapGet(...).DisableRequestTimeout() does; its 405 keeps it.
func TestTheSyncDoorLiftsTheRequestDeadlineBeforeItJoins(t *testing.T) {
	rooms := &liftCheckingRooms{}
	h := collabServer(t, rooms).Handler("")

	lifted := 0
	request := upgradeRequest("GET", "/sync/doc-1")
	request = request.WithContext(WithRequestTimeoutLift(request.Context(), func() { lifted++ }))
	rooms.lifted = &lifted
	h.ServeHTTP(httptest.NewRecorder(), request)
	if lifted != 1 || rooms.liftedAtJoin != 1 {
		t.Fatalf("lifted %d times, %d before the join", lifted, rooms.liftedAtJoin)
	}

	lifted = 0
	request = upgradeRequest("POST", "/sync/doc-1")
	request = request.WithContext(WithRequestTimeoutLift(request.Context(), func() { lifted++ }))
	h.ServeHTTP(httptest.NewRecorder(), request)
	if lifted != 0 {
		t.Fatal("the 405 lifted the deadline")
	}
}

type liftCheckingRooms struct {
	lifted       *int
	liftedAtJoin int
}

func (r *liftCheckingRooms) Join(context.Context, string, collab.Member) (collab.JoinResult, error) {
	r.liftedAtJoin = *r.lifted
	return collab.JoinResult{Status: collab.JoinDraining}, nil
}

// The real rooms answer the sync door before the upgrade.
func TestTheSyncDoorAsksTheRealRooms(t *testing.T) {
	purged := collabServer(t, nil)
	purged.rooms = purged.collab
	if _, err := purged.PurgeDocument(context.Background(), "doc", func(context.Context) (bool, error) { return true, nil }); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	purged.Handler("").ServeHTTP(recorder, upgradeRequest("GET", "/sync/doc"))
	if recorder.Code != http.StatusForbidden || recorder.Body.String() != "forbidden\n" {
		t.Errorf("purged: %d %q", recorder.Code, recorder.Body.String())
	}

	draining := collabServer(t, nil)
	draining.rooms = draining.collab
	if err := draining.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}
	recorder = httptest.NewRecorder()
	draining.Handler("").ServeHTTP(recorder, upgradeRequest("GET", "/sync/doc"))
	if recorder.Code != http.StatusServiceUnavailable || recorder.Body.String() != "shutting down\n" {
		t.Errorf("draining: %d %q", recorder.Code, recorder.Body.String())
	}
}

// Rooms that cannot be built are the host's empty 500 at the sync door.
func TestTheSyncDoorAnswersAnEmpty500WhenTheRoomsCannotBeBuilt(t *testing.T) {
	o := DefaultOptions()
	o.CollabEnabled = true
	o.CollabJournal = true
	// New accepts it; the journal refuses an empty directory when the rooms
	// are first built.
	o.CollabDirectory = ""
	o.DocEndpoint = "http://127.0.0.1:1/docs"
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	// A real server: a recorder cannot be hijacked, which is a 500 of its own.
	host := httptest.NewServer(s.Handler(""))
	defer host.Close()
	request := upgradeRequest("GET", host.URL+"/sync/doc")
	request.RequestURI = ""
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != http.StatusInternalServerError || len(body) != 0 {
		t.Fatalf("got %d %q", response.StatusCode, body)
	}
}

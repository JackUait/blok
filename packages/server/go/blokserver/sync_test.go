package blokserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/collab"
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

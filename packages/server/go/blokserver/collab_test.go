package blokserver

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"
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
	o.Authorization, o.Auth, o.Secret, o.AllowedOrigins = nil, "ticket", strings.Repeat("s", 32), []string{"https://app.example.com"}
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

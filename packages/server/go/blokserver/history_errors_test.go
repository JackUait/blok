package blokserver_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/JackUait/blok/packages/server/go/blokserver"
	"github.com/JackUait/blok/packages/server/go/blokserver/collabstore"
	"github.com/JackUait/blok/packages/server/go/internal/collab/journal"
)

// unreadableHistory keeps history whose lineage list fails with err.
type unreadableHistory struct {
	keeping
	err error
}

func (u unreadableHistory) ListLineages(context.Context, string) ([]journal.LineageInfo, error) {
	return nil, u.err
}

type errorLog struct {
	mu    sync.Mutex
	lines []string
}

func (l *errorLog) Enabled(context.Context, slog.Level) bool { return true }
func (l *errorLog) Handle(_ context.Context, r slog.Record) error {
	if r.Level < slog.LevelError {
		return nil
	}
	category := ""
	r.Attrs(func(a slog.Attr) bool {
		if a.Key == "category" {
			category = a.Value.String()
		}
		return true
	})
	l.mu.Lock()
	defer l.mu.Unlock()
	l.lines = append(l.lines, category+" "+r.Message)
	return nil
}
func (l *errorLog) WithAttrs([]slog.Attr) slog.Handler { return l }
func (l *errorLog) WithGroup(string) slog.Handler      { return l }

func (l *errorLog) seen() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return strings.Join(l.lines, "\n")
}

func historyHost(t *testing.T, err error, log *errorLog) string {
	t.Helper()
	inner := localJournal(t)
	store := unreadableHistory{keeping{&opening{inner: inner}, inner}, err}
	return hostServer(t, func(o *blokserver.Options) {
		o.CollabOperationStore = store
		o.Logger = slog.New(log)
	}).URL
}

// C# HistoryEndpoint logs CollabHistoryCorrupt at Error and answers 500.
func TestUnreadableHistoryIsLoggedAndAnswered500(t *testing.T) {
	log := &errorLog{}
	base := historyHost(t, &collabstore.InvalidDataError{Message: "bad record"}, log)
	response, err := http.Get(base + "/sync/doc/history")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != http.StatusInternalServerError || string(body) != "a stored version could not be read\n" {
		t.Fatalf("got %d %q", response.StatusCode, body)
	}
	if got := response.Header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control %q", got)
	}
	want := blokserver.CollabLogCategory + ` collab: a stored version of "doc" could not be read`
	if got := log.seen(); got != want {
		t.Fatalf("error log %q, want %q", got, want)
	}
}

// Any other store error is the host's empty 500, with nothing logged as
// corrupt.
func TestAFailingHistoryStoreIsAnEmpty500(t *testing.T) {
	log := &errorLog{}
	base := historyHost(t, errors.New("disk gone"), log)
	response, err := http.Get(base + "/sync/doc/history")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != http.StatusInternalServerError || len(body) != 0 || response.Header.Get("Content-Length") != "0" {
		t.Fatalf("got %d %q, Content-Length %q", response.StatusCode, body, response.Header.Get("Content-Length"))
	}
	if got := log.seen(); got != "" {
		t.Fatalf("error log %q", got)
	}
}

type failingAuthorization struct{}

func (failingAuthorization) CanReadDocument(context.Context, blokserver.User, string) (bool, error) {
	return false, errors.New("directory down")
}

func (failingAuthorization) CanWriteDocument(context.Context, blokserver.User, string) (bool, error) {
	return false, errors.New("directory down")
}

// A hook that fails is the host's empty 500, not a 403.
func TestAFailingAuthorizationHookIsAnEmpty500OnTheCollabRoutes(t *testing.T) {
	base := hostServer(t, func(o *blokserver.Options) {
		o.CollabJournal = true
		o.Authorization = failingAuthorization{}
	}).URL
	for _, path := range []string{"/sync/doc/state", "/sync/doc/history"} {
		response, err := http.Get(base + path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != http.StatusInternalServerError || len(body) != 0 || response.Header.Get("Content-Length") != "0" {
			t.Errorf("%s: got %d %q", path, response.StatusCode, body)
		}
	}
}

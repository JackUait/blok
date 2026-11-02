package blokserver_test

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/blokserver"
	"github.com/JackUait/blok/packages/server/go/blokserver/collabstore"
	"github.com/JackUait/blok/packages/server/go/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/internal/collab/room"
)

// opening is a host store: the built-in journal behind a recorder, so the
// test sees which store the rooms opened. It keeps no history.
type opening struct {
	mu     sync.Mutex
	opened []string
	inner  room.LocalJournal
}

func (o *opening) Open(ctx context.Context, docID string) (collabstore.OpenOutcome, collabstore.OperationSession, error) {
	o.mu.Lock()
	o.opened = append(o.opened, docID)
	o.mu.Unlock()
	return o.inner.Open(ctx, docID)
}

// keeping adds the history reads, as a host store that keeps history would.
type keeping struct {
	*opening
	room.LocalJournal
}

func (k keeping) Open(ctx context.Context, docID string) (collabstore.OpenOutcome, collabstore.OperationSession, error) {
	return k.opening.Open(ctx, docID)
}

type observed struct {
	mu    sync.Mutex
	calls []string
}

func (o *observed) Record(_ context.Context, docID, actorID string, _ time.Time, kind collabstore.ActivityKind) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.calls = append(o.calls, docID+" "+actorID+" "+kind.String())
	return nil
}

func (o *observed) seen() []string {
	o.mu.Lock()
	defer o.mu.Unlock()
	return append([]string(nil), o.calls...)
}

var (
	_ collabstore.OperationStore   = (*opening)(nil)
	_ collabstore.HistoryStore     = keeping{}
	_ collabstore.PurgeStore       = keeping{}
	_ collabstore.ActivityObserver = (*observed)(nil)
)

func nullEndpoint(t *testing.T) string {
	t.Helper()
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, "null")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(endpoint.Close)
	return endpoint.URL + "/docs"
}

func hostServer(t *testing.T, configure func(*blokserver.Options)) *httptest.Server {
	t.Helper()
	options := blokserver.DefaultOptions()
	options.Auth = "none"
	options.StorageDirectory = ""
	options.CollabEnabled = true
	options.CollabDirectory = t.TempDir()
	options.DocEndpoint = nullEndpoint(t)
	configure(&options)
	server, err := blokserver.New(options)
	if err != nil {
		t.Fatal(err)
	}
	handler := server.Handler("")
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := blokserver.User{ID: "u1", Authenticated: true, Write: true}
		handler.ServeHTTP(w, r.WithContext(blokserver.WithUser(r.Context(), user)))
	}))
	t.Cleanup(func() {
		host.Close()
		_ = server.Drain(context.Background())
	})
	return host
}

func edit(t *testing.T, base, doc, key string) *http.Response {
	t.Helper()
	request, _ := http.NewRequest(http.MethodPost, base+"/sync/"+doc+"/edit",
		strings.NewReader(`{"ops":[{"op":"insert","id":"`+key+`","block":{"type":"paragraph","data":{"text":"x"}}}]}`))
	request.Header.Set("Blok-Idempotency-Key", key)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	response.Body.Close()
	return response
}

func get(t *testing.T, url string) (int, string) {
	t.Helper()
	response, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	return response.StatusCode, string(body)
}

func localJournal(t *testing.T) room.LocalJournal {
	t.Helper()
	store, err := journal.NewStore(t.TempDir(), journal.StoreOptions{})
	if err != nil {
		t.Fatal(err)
	}
	return room.LocalJournal{Store: store}
}

// T1, T7: UseCollabOperationStore<T> turns the journal on with the host's
// store; history needs a store that also keeps it (T2), as C#'s
// "is ICollabOperationHistoryStore".
func TestAHostOperationStoreTurnsTheJournalOn(t *testing.T) {
	store := &opening{inner: localJournal(t)}
	host := hostServer(t, func(o *blokserver.Options) { o.CollabOperationStore = store })

	response := edit(t, host.URL, "doc", "k1")
	if response.StatusCode != http.StatusNoContent || response.Header.Get("Blok-Doc-Sequence") != "1" {
		t.Fatalf("edit: %d, sequence %q", response.StatusCode, response.Header.Get("Blok-Doc-Sequence"))
	}
	store.mu.Lock()
	opened := strings.Join(store.opened, ",")
	store.mu.Unlock()
	if opened != "doc" {
		t.Fatalf("the host store opened %q", opened)
	}
	if status, body := get(t, host.URL+"/sync/doc/history"); status != http.StatusNotImplemented ||
		body != "history needs a journal that keeps it\n" {
		t.Fatalf("history on a store that keeps none: %d %q", status, body)
	}

	inner := localJournal(t)
	kept := keeping{&opening{inner: inner}, inner}
	withHistory := hostServer(t, func(o *blokserver.Options) { o.CollabOperationStore = kept })
	if response := edit(t, withHistory.URL, "doc", "k1"); response.StatusCode != http.StatusNoContent {
		t.Fatalf("edit: %d", response.StatusCode)
	}
	if status, body := get(t, withHistory.URL+"/sync/doc/history"); status != http.StatusOK || !strings.Contains(body, `"sequence":1`) {
		t.Fatalf("history: %d %q", status, body)
	}
}

// T5, T7: UseCollabActivityObserver<T>; an edit is recorded once it is
// journalled, under the caller's id.
func TestAHostActivityObserverHearsAnEdit(t *testing.T) {
	observer := &observed{}
	host := hostServer(t, func(o *blokserver.Options) {
		o.CollabJournal = true
		o.CollabActivityObserver = observer
	})
	if response := edit(t, host.URL, "doc", "k1"); response.StatusCode != http.StatusNoContent {
		t.Fatalf("edit: %d", response.StatusCode)
	}
	deadline := time.Now().Add(5 * time.Second)
	for len(observer.seen()) == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if got := strings.Join(observer.seen(), ","); got != "doc u1 Edited" {
		t.Fatalf("observed %q", got)
	}
}

// failingCheckpoints wraps each session so its checkpoint fails with err.
type failingCheckpoints struct {
	inner room.LocalJournal
	err   error
}

func (f failingCheckpoints) Open(ctx context.Context, docID string) (collabstore.OpenOutcome, collabstore.OperationSession, error) {
	outcome, session, err := f.inner.Open(ctx, docID)
	if session == nil {
		return outcome, nil, err
	}
	return outcome, failingSession{session, f.err}, err
}

type failingSession struct {
	collabstore.OperationSession
	err error
}

func (s failingSession) WriteCheckpoint(context.Context, collabstore.Checkpoint) error { return s.err }

// T4: a host store fails a checkpoint with the same error values the
// built-in journal uses. Unreadable data fails the room, so the next edit
// is refused; any other error is retried and edits go on.
func TestAHostStoresCheckpointErrorDecidesBetweenFailAndRetry(t *testing.T) {
	for _, c := range []struct {
		name   string
		err    error
		status int
	}{
		{"invalid data", &collabstore.InvalidDataError{Message: "unreadable"}, http.StatusServiceUnavailable},
		{"out of range", &collabstore.ArgumentError{Message: "sequence", OutOfRange: true}, http.StatusServiceUnavailable},
		{"fence lost", collabstore.ErrFenceLost, http.StatusServiceUnavailable},
		{"other", errors.New("disk busy"), http.StatusNoContent},
	} {
		t.Run(c.name, func(t *testing.T) {
			store := failingCheckpoints{localJournal(t), c.err}
			host := hostServer(t, func(o *blokserver.Options) { o.CollabOperationStore = store })
			// 64 operations since the last checkpoint publish the next one.
			for i := 1; i <= 64; i++ {
				if response := edit(t, host.URL, "doc", "k"+strconv.Itoa(i)); response.StatusCode != http.StatusNoContent {
					t.Fatalf("edit %d: %d", i, response.StatusCode)
				}
			}
			// The checkpoint is queued behind edit 64, so it runs before this one.
			status := edit(t, host.URL, "doc", "after").StatusCode
			if status != c.status {
				t.Fatalf("the edit after the checkpoint answered %d, want %d", status, c.status)
			}
		})
	}
}

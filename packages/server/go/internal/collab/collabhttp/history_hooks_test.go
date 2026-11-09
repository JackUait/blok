package collabhttp

import (
	"context"
	"encoding/json"
	"iter"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/auth"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/room"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs/yjstest"
)

// Twins of C# HistoryEndpointTests.Hooks: the history hooks found on the
// Authorization by type assertion.

// historyPolicy allows reads and writes; the history hooks answer from its fields.
type historyPolicy struct {
	mu          sync.Mutex
	readHistory bool
	// cut is where the window should cut; the hook answers the span from now to it.
	cut        *time.Time
	held       map[string]bool
	holdsAsked []string
}

func (p *historyPolicy) CanReadDocument(context.Context, auth.User, string) (bool, error) {
	return true, nil
}
func (p *historyPolicy) CanWriteDocument(context.Context, auth.User, string) (bool, error) {
	return true, nil
}

func (p *historyPolicy) CanReadHistory(context.Context, auth.User, string) (bool, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.readHistory, nil
}

func (p *historyPolicy) HistoryWindow(context.Context, auth.User, string) (*time.Duration, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.cut == nil {
		return nil, nil
	}
	return new(time.Since(*p.cut)), nil
}

func (p *historyPolicy) IsHistoryHeld(_ context.Context, _ string, lineage string) (bool, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.holdsAsked = append(p.holdsAsked, lineage)
	return p.held[lineage], nil
}

// spacedJournal: header N reads as committed at the Unix epoch plus N times spacing.
type spacedJournal struct {
	room.LocalJournal
	spacing time.Duration
}

func (j spacedJournal) ReadHeaders(ctx context.Context, docID, lineage string) iter.Seq2[journal.RecordHeader, error] {
	return func(yield func(journal.RecordHeader, error) bool) {
		for header, err := range j.LocalJournal.ReadHeaders(ctx, docID, lineage) {
			if err == nil {
				header.CommittedAt = time.Unix(0, 0).UTC().Add(j.spacing * time.Duration(header.Sequence))
			}
			if !yield(header, err) {
				return
			}
		}
	}
}

// startHooked is startHistory with every history route, a policy, and spaced headers.
func startHooked(t *testing.T, policy auth.Authorization, spacing time.Duration) *historyApp {
	t.Helper()
	store, err := journal.NewStore(t.TempDir(), journal.StoreOptions{})
	if err != nil {
		t.Fatal(err)
	}
	var operations room.OperationStore = room.LocalJournal{Store: store}
	if spacing > 0 {
		operations = spacedJournal{room.LocalJournal{Store: store}, spacing}
	}
	converter := &failingConverter{DocConverter: &convert.DocConverter{Now: time.Now, HTML: runtimeReader(t)}}
	manager := room.NewManager(room.ManagerOptions{
		Store: workingset.NewLocalStore(t.TempDir(), nil), Endpoint: heldDocument{}, Converter: converter,
		Operations: operations, Room: room.OptionsWith(func(ro *room.Options) { ro.MaxUpdateBytes = store.MaxUpdateBytes() }),
	})
	t.Cleanup(func() { _ = manager.Drain(context.Background()) })
	routes := New(Config{Rooms: func() (*room.Manager, error) { return manager, nil }, MaxMessageBytes: 8 << 20, Authorization: policy})
	mux := http.NewServeMux()
	mux.HandleFunc("POST /sync/{doc}/edit", routes.Edit)
	mux.HandleFunc("GET /sync/{doc}/state", routes.State)
	mux.HandleFunc("POST /sync/{doc}/reset", routes.Reset)
	mux.HandleFunc("GET /sync/{doc}/history", routes.HistoryList)
	mux.HandleFunc("GET /sync/{doc}/history/{lineage}/{sequence}", routes.HistoryRead)
	mux.HandleFunc("DELETE /sync/{doc}/history/{lineage}", routes.HistoryDelete)
	mux.HandleFunc("GET /sync/{doc}/history/{lineage}/{sequence}/changes", routes.HistoryChanges)
	mux.HandleFunc("POST /sync/{doc}/history/{lineage}/{sequence}/restore", routes.HistoryRestore)
	mux.HandleFunc("POST /sync/{doc}/history/{lineage}/{sequence}/restore/preview", routes.HistoryRestorePreview)
	mux.HandleFunc("GET /sync/{doc}/history/at", routes.HistoryAt)
	mux.HandleFunc("GET /sync/{doc}/history/changes", routes.HistoryChangesBetween)
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return &historyApp{server: server, converter: converter}
}

func windowFixture(t *testing.T) map[string]any {
	t.Helper()
	root, err := yjstest.RepoRoot()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "test", "unit", "server-conformance", "fixtures", "collab-history", "window.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture map[string]any
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture
}

func TestTheReadHookGuardsEveryRouteThatShowsHistory(t *testing.T) {
	policy := &historyPolicy{readHistory: false}
	history := startHooked(t, policy, 0)
	lineage := history.open(t)
	history.editText(t, "two")

	for _, route := range [][2]string{
		{"GET", "/history"},
		{"GET", "/history/" + lineage + "/1"},
		{"GET", "/history/" + lineage + "/1/changes"},
		{"GET", "/history/at?time=2099-01-01T00:00:00Z"},
		{"GET", "/history/changes"},
		{"POST", "/history/" + lineage + "/0/restore/preview"},
	} {
		if a := history.send(t, route[0], route[1], "", "", ""); a.status != http.StatusForbidden || string(a.body) != "forbidden\n" {
			t.Errorf("%s %s = %d %q", route[0], route[1], a.status, a.body)
		}
	}
	// A restore changes the document: the write gate decides it.
	if a := history.restore(t, lineage, "0", "allowed", ""); a.status != http.StatusNoContent {
		t.Fatalf("restore = %d %q", a.status, a.body)
	}
}

func sequencesOf(t *testing.T, body []byte, key string) []uint64 {
	t.Helper()
	var parsed map[string][]struct {
		Sequence uint64 `json:"sequence"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("%v: %.200s", err, body)
	}
	var out []uint64
	for _, entry := range parsed[key] {
		out = append(out, entry.Sequence)
	}
	return out
}

func TestTheWindowHidesPointsBeforeItsCutOnEveryRoute(t *testing.T) {
	policy := &historyPolicy{readHistory: true}
	history := startHooked(t, policy, 24*time.Hour)
	lineage := history.open(t)
	history.editText(t, "two")
	history.editText(t, "three")
	history.editText(t, "four")
	// Records 1 and 2 are before the cut, 3 after it. The baseline is newer, but below a hidden record.
	cut := time.Unix(0, 0).UTC().Add(60 * time.Hour)
	policy.cut = &cut
	retention := windowFixture(t)["answers"].(map[string]any)["retention"].(map[string]any)

	for _, route := range [][2]string{
		{"GET", "/history/" + lineage + "/2"},
		{"GET", "/history/" + lineage + "/0"},
		{"GET", "/history/" + lineage + "/2/changes"},
		{"POST", "/history/" + lineage + "/2/restore/preview"},
		{"GET", "/history/at?time=1970-01-03T00:00:00Z"},
		{"GET", "/history/changes?from=1970-01-01T00:00:00Z&before=" + lineage + ":2"},
	} {
		a := history.send(t, route[0], route[1], "", "", "")
		if float64(a.status) != retention["status"].(float64) || a.header.Get("Content-Type") != retention["contentType"] ||
			string(a.body) != retention["body"] {
			t.Errorf("%s %s = %d %s %q", route[0], route[1], a.status, a.header.Get("Content-Type"), a.body)
		}
	}
	if a := history.restore(t, lineage, "2", "too-old", ""); a.status != http.StatusNotFound || string(a.body) != retention["body"] {
		t.Errorf("restore = %d %q", a.status, a.body)
	}
	if a := history.send(t, "GET", "/history/"+lineage+"/3", "", "", ""); a.status != http.StatusOK {
		t.Errorf("read 3 = %d %q", a.status, a.body)
	}
	if got := sequencesOf(t, history.send(t, "GET", "/history/"+lineage+"/3/changes", "", "", "").body, "changes"); len(got) != 1 || got[0] != 3 {
		t.Errorf("changes = %v, want [3]", got)
	}
	if got := sequencesOf(t, history.send(t, "GET", "/history?group=1", "", "", "").body, "versions"); len(got) != 1 || got[0] != 3 {
		t.Errorf("versions = %v, want [3]", got)
	}
	if got := sequencesOf(t, history.send(t, "GET", "/history/changes?from=1970-01-01T00:00:00Z", "", "", "").body, "changes"); len(got) != 1 || got[0] != 3 {
		t.Errorf("range = %v, want [3]", got)
	}
	request, _ := http.NewRequest("GET", history.server.URL+"/sync/doc/history/at?time=1970-01-05T00:00:00Z", nil)
	request.Header.Set("Accept", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK || response.Header.Get("Blok-History-Sequence") != "3" {
		t.Errorf("at = %d sequence %q", response.StatusCode, response.Header.Get("Blok-History-Sequence"))
	}

	// A window shrunk at runtime takes effect on the next call.
	shrunk := time.Unix(0, 0).UTC().Add(84 * time.Hour)
	policy.mu.Lock()
	policy.cut = &shrunk
	policy.mu.Unlock()
	if a := history.send(t, "GET", "/history/"+lineage+"/3", "", "", ""); a.status != http.StatusNotFound {
		t.Errorf("read 3 after the window shrank = %d %q", a.status, a.body)
	}
}

func TestAHeldLineageIsNotDeleted(t *testing.T) {
	for _, item := range windowFixture(t)["delete"].([]any) {
		entry := item.(map[string]any)
		name := entry["name"].(string)
		policy := &historyPolicy{readHistory: true, held: map[string]bool{}}
		history := startHooked(t, policy, 0)
		old := history.open(t)
		if a := history.send(t, "POST", "/reset", "", "", ""); a.status != http.StatusNoContent {
			t.Fatalf("reset = %d %q", a.status, a.body)
		}
		current := history.open(t)
		lineage := map[string]string{"old": old, "current": current}[entry["lineage"].(string)]
		if lineage == "" {
			lineage = strings.Repeat("f", 32)
		}
		if entry["held"].(bool) {
			policy.held[lineage] = true
		}

		a := history.send(t, "DELETE", "/history/"+lineage, "", "", "")
		want, _ := entry["body"].(string)
		if float64(a.status) != entry["status"].(float64) || string(a.body) != want {
			t.Errorf("%s: %d %q, want %v %q", name, a.status, a.body, entry["status"], want)
		}
		if len(policy.holdsAsked) != 1 || policy.holdsAsked[0] != lineage {
			t.Errorf("%s: holds asked %v", name, policy.holdsAsked)
		}
		if entry["held"].(bool) && a.header.Get("Content-Type") != "application/json" {
			t.Errorf("%s: content type %q", name, a.header.Get("Content-Type"))
		}
	}
}

package blokmcp

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/blokserver"
)

// brokenSource fails chosen loads and saves with a plain error, as a host
// whose disk or network broke would.
type brokenSource struct {
	docSource
	mu sync.Mutex
	// failSave fails the next save of this id once.
	failSave string
	// breakAfterSave saves this id once, then fails as if it had not.
	breakAfterSave string
	// refuseSave refuses the next save of this id once, as a host does.
	refuseSave string
	// failNewLoad fails the load of the n-th new page id (1-based).
	failNewLoad int
	newLoads    int
}

func (b *brokenSource) load(ctx context.Context, documentID string) (*loaded, error) {
	b.mu.Lock()
	if documentID != "doc" {
		b.newLoads++
		if b.newLoads == b.failNewLoad {
			b.mu.Unlock()
			return nil, errors.New("the disk broke")
		}
	}
	b.mu.Unlock()
	return b.docSource.load(ctx, documentID)
}

func (b *brokenSource) save(ctx context.Context, documentID string, text []byte, ifVersion *string) (*string, error) {
	b.mu.Lock()
	if documentID == b.failSave {
		b.failSave = ""
		b.mu.Unlock()
		return nil, errors.New("the disk broke")
	}
	if documentID == b.refuseSave {
		b.refuseSave = ""
		b.mu.Unlock()
		return nil, surfaceError("SOURCE_UNAVAILABLE", "The host is busy.")
	}
	breaks := documentID == b.breakAfterSave
	if breaks {
		b.breakAfterSave = ""
	}
	b.mu.Unlock()
	saved, err := b.docSource.save(ctx, documentID, text, ifVersion)
	if breaks && err == nil {
		return nil, errors.New("the reply was lost")
	}
	return saved, err
}

// brokenRuntime fails the next call of one bundle operation once.
type brokenRuntime struct {
	inner invoker
	mu    sync.Mutex
	fail  string
}

func (b *brokenRuntime) Invoke(ctx context.Context, op, input string, timeout *time.Duration) (string, error) {
	b.mu.Lock()
	if op == b.fail {
		b.fail = ""
		b.mu.Unlock()
		return "", errors.New("the engine broke")
	}
	b.mu.Unlock()
	return b.inner.Invoke(ctx, op, input, timeout)
}

type brokenStored struct {
	server  *Server
	dir     string
	who     *caller
	handle  string
	source  *brokenSource
	runtime *brokenRuntime
}

// brokenStoredServer opens doc for writing over a files source the test can
// break. The source is swapped before the open: a session keeps its own.
func brokenStoredServer(t *testing.T, document, pageTitles string) *brokenStored {
	t.Helper()
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "doc.json"), []byte(document), 0o644)
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: dir}, PageTitles: pageTitles})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	source := &brokenSource{docSource: server.source}
	server.source = source
	runtime := &brokenRuntime{inner: server.bundle.runtime}
	server.bundle.runtime = runtime
	who, _ := server.actorFor(context.Background(), "alice", nil)
	opened, err := server.dispatch(context.Background(), &toolCall{name: "blok_open", arguments: json.RawMessage(`{"documentId":"doc","write":true}`), caller: who})
	if err != nil {
		t.Fatal(err)
	}
	handle, _ := json.Marshal(structured(t, opened.answer)["handle"])
	return &brokenStored{server: server, dir: dir, who: who, handle: string(handle), source: source, runtime: runtime}
}

func (b *brokenStored) execute(commands string) (*outcome, error) {
	return b.server.dispatch(context.Background(), &toolCall{name: "blok_execute", caller: b.who,
		arguments: json.RawMessage(`{"handle":` + b.handle + `,"commands":` + commands + `}`)})
}

// newPageIDs are the page documents made in dir, besides doc.
func newPageIDs(t *testing.T, dir string) []string {
	t.Helper()
	entries, _ := os.ReadDir(dir)
	ids := []string{}
	for _, entry := range entries {
		if entry.Name() != "doc.json" {
			ids = append(ids, strings.TrimSuffix(entry.Name(), ".json"))
		}
	}
	return ids
}

// wantOrphaned checks the answer reports exactly pages as orphaned, in the
// bundle's shape, with a server-error cause.
func wantOrphaned(t *testing.T, answer map[string]any, pages []string) {
	t.Helper()
	failure, _ := answer["error"].(map[string]any)
	if answer["ok"] != false || failure["code"] != "ORPHANED_SIDE_EFFECT" || failure["retryable"] != false {
		t.Fatalf("answer %v", answer)
	}
	details, _ := failure["details"].(map[string]any)
	want := []any{}
	for _, page := range pages {
		want = append(want, map[string]any{"command": "block.insert", "type": "page", "prepared": map[string]any{"pageId": page}})
	}
	if !reflect.DeepEqual(details["orphaned"], want) {
		t.Fatalf("orphaned %v, want %v", details["orphaned"], want)
	}
	cause, _ := details["cause"].(map[string]any)
	if cause["code"] != "APPLY_FAILED" || cause["message"] != "The batch stopped on a server error. Nothing was written." {
		t.Fatalf("cause %v", cause)
	}
	if failure["message"] != "The batch failed after the host did work for it (The batch stopped on a server error. Nothing was written.). Clean up the listed items." {
		t.Fatalf("message %v", failure["message"])
	}
}

const twoPages = `[{"name":"block.insert","args":{"type":"page"}},{"name":"block.insert","args":{"type":"page"}}]`

// A save that fails with a plain error keeps nothing of the batch in
// memory: the next read shows the source, and undo has no step to replay.
func TestAFailedStoredSaveLeavesMemoryAsTheSource(t *testing.T) {
	stored := brokenStoredServer(t, `{"blocks":[]}`, "")
	before, _ := os.ReadFile(filepath.Join(stored.dir, "doc.json"))
	stored.source.failSave = "doc"
	if _, err := stored.execute(`[{"name":"doc.setTitle","args":{"title":"Lost"}}]`); err == nil {
		t.Fatal("a broken save answered as if it worked")
	}
	read, err := stored.server.dispatch(context.Background(), &toolCall{name: "blok_read", caller: stored.who,
		arguments: json.RawMessage(`{"handle":` + stored.handle + `}`)})
	if err != nil {
		t.Fatal(err)
	}
	if written, _ := json.Marshal(structured(t, read.answer)); strings.Contains(string(written), "Lost") {
		t.Fatalf("the read shows the failed batch: %s", written)
	}
	undo, err := stored.execute(`[{"name":"history.undo","args":{}}]`)
	if err != nil {
		t.Fatal(err)
	}
	failure, _ := structured(t, undo.answer)["error"].(map[string]any)
	if failure["code"] != "NOTHING_TO_UNDO" {
		t.Fatalf("undo: %v", structured(t, undo.answer))
	}
	after, _ := os.ReadFile(filepath.Join(stored.dir, "doc.json"))
	if string(after) != string(before) {
		t.Fatalf("the source changed: %s", after)
	}
}

// A page made before a later page broke is reported, not lost.
func TestAPageMadeBeforeABrokenCreateIsReported(t *testing.T) {
	stored := brokenStoredServer(t, `{"blocks":[]}`, "page-map")
	stored.source.failNewLoad = 2
	ran, err := stored.execute(twoPages)
	if err != nil {
		t.Fatal(err)
	}
	pages := newPageIDs(t, stored.dir)
	if len(pages) != 1 {
		t.Fatalf("pages %v", pages)
	}
	wantOrphaned(t, structured(t, ran.answer), pages)
	if written, _ := os.ReadFile(filepath.Join(stored.dir, "doc.json")); string(written) != `{"blocks":[]}` {
		t.Fatalf("the parent changed: %s", written)
	}
}

// Pages made for a batch the engine then failed are reported.
func TestPagesMadeBeforeABrokenRunAreReported(t *testing.T) {
	stored := brokenStoredServer(t, `{"blocks":[]}`, "page-map")
	stored.runtime.fail = "agentExecute"
	ran, err := stored.execute(twoPages)
	if err != nil {
		t.Fatal(err)
	}
	pages := newPageIDs(t, stored.dir)
	if len(pages) != 2 {
		t.Fatalf("pages %v", pages)
	}
	answer := structured(t, ran.answer)
	failure, _ := answer["error"].(map[string]any)
	details, _ := failure["details"].(map[string]any)
	orphaned, _ := details["orphaned"].([]any)
	got := []string{}
	for _, entry := range orphaned {
		prepared, _ := entry.(map[string]any)["prepared"].(map[string]any)
		id, _ := prepared["pageId"].(string)
		got = append(got, id)
	}
	// The files list sorts by name; the report keeps the creation order.
	if len(got) != 2 || !(got[0] == pages[0] && got[1] == pages[1] || got[0] == pages[1] && got[1] == pages[0]) {
		t.Fatalf("orphaned %v, made %v", got, pages)
	}
	wantOrphaned(t, answer, got)
}

// Pages made for a batch whose answer could not be built are reported:
// nothing was saved.
func TestPagesMadeBeforeABrokenAnswerAreReported(t *testing.T) {
	stored := brokenStoredServer(t, `{"blocks":[]}`, "page-map")
	stored.runtime.fail = "mcpExecuteAnswer"
	ran, err := stored.execute(`[{"name":"block.insert","args":{"type":"page"}}]`)
	if err != nil {
		t.Fatal(err)
	}
	wantOrphaned(t, structured(t, ran.answer), newPageIDs(t, stored.dir))
	if written, _ := os.ReadFile(filepath.Join(stored.dir, "doc.json")); string(written) != `{"blocks":[]}` {
		t.Fatalf("the parent changed: %s", written)
	}
}

// Pages made for a batch whose parent save broke are reported.
func TestPagesMadeBeforeABrokenParentSaveAreReported(t *testing.T) {
	stored := brokenStoredServer(t, `{"blocks":[]}`, "page-map")
	stored.source.failSave = "doc"
	ran, err := stored.execute(`[{"name":"block.insert","args":{"type":"page"}}]`)
	if err != nil {
		t.Fatal(err)
	}
	wantOrphaned(t, structured(t, ran.answer), newPageIDs(t, stored.dir))
	if written, _ := os.ReadFile(filepath.Join(stored.dir, "doc.json")); string(written) != `{"blocks":[]}` {
		t.Fatalf("the parent changed: %s", written)
	}
}

// A save that stored the parent before it broke leaves its page in use, so
// the page is not reported.
func TestAPageTheSavedParentLinksIsNotReported(t *testing.T) {
	stored := brokenStoredServer(t, `{"blocks":[]}`, "page-map")
	stored.source.breakAfterSave = "doc"
	if _, err := stored.execute(`[{"name":"block.insert","args":{"type":"page"}}]`); err == nil || err.Error() != "the reply was lost" {
		t.Fatalf("err %v", err)
	}
	pages := newPageIDs(t, stored.dir)
	written, _ := os.ReadFile(filepath.Join(stored.dir, "doc.json"))
	if len(pages) != 1 || !strings.Contains(string(written), pages[0]) {
		t.Fatalf("pages %v, parent %s", pages, written)
	}
}

// A refused parent save stays a plain refusal, as packages/mcp/README.md
// documents: the host deletes the page itself.
func TestARefusedParentSaveStaysUnreported(t *testing.T) {
	stored := brokenStoredServer(t, `{"blocks":[]}`, "page-map")
	stored.source.refuseSave = "doc"
	ran, err := stored.execute(`[{"name":"block.insert","args":{"type":"page"}}]`)
	if err != nil {
		t.Fatal(err)
	}
	failure, _ := structured(t, ran.answer)["error"].(map[string]any)
	if failure["code"] != "SOURCE_UNAVAILABLE" || len(newPageIDs(t, stored.dir)) != 1 {
		t.Fatalf("answer %v", structured(t, ran.answer))
	}
}

// Pages made in live mode for a batch the engine then failed are reported.
func TestLivePagesMadeBeforeABrokenRunAreReported(t *testing.T) {
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, `{"blocks":[]}`)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(endpoint.Close)
	options := blokserver.DefaultOptions()
	options.CollabEnabled = true
	options.CollabDirectory = t.TempDir()
	options.CollabJournal = true
	options.Auth = new("ticket")
	options.Secret = exportFailSecret
	options.AllowedOrigins = []string{exportFailOrigin}
	options.DocEndpoint = endpoint.URL + "/docs"
	host, err := blokserver.New(options)
	if err != nil {
		t.Fatal(err)
	}
	served := httptest.NewServer(host.Handler(""))
	t.Cleanup(func() {
		served.CloseClientConnections()
		served.Close()
		_ = host.Drain(context.Background())
	})
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, PageTitles: "page-map",
		Sync:    &Sync{URL: "ws" + strings.TrimPrefix(served.URL, "http") + "/sync", Origin: new(exportFailOrigin)},
		Tickets: &Tickets{Kind: "secret", Secret: exportFailSecret}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	runtime := &brokenRuntime{inner: server.bundle.runtime}
	server.bundle.runtime = runtime
	who, _ := server.actorFor(context.Background(), "alice", nil)
	writer := &callContextWho{server: server, who: who}
	opened, err := writer.dispatch("blok_open", map[string]any{"documentId": "doc", "write": true})
	if err != nil {
		t.Fatal(err)
	}
	handle, _ := structured(t, opened.answer)["handle"].(string)
	runtime.mu.Lock()
	runtime.fail = "agentExecute"
	runtime.mu.Unlock()
	ran, err := writer.dispatch("blok_execute", map[string]any{"handle": handle,
		"commands": []any{map[string]any{"name": "block.insert", "args": map[string]any{"type": "page"}}}})
	if err != nil {
		t.Fatal(err)
	}
	answer := structured(t, ran.answer)
	failure, _ := answer["error"].(map[string]any)
	details, _ := failure["details"].(map[string]any)
	orphaned, _ := details["orphaned"].([]any)
	if len(orphaned) != 1 {
		t.Fatalf("answer %v", answer)
	}
	prepared, _ := orphaned[0].(map[string]any)["prepared"].(map[string]any)
	page, _ := prepared["pageId"].(string)
	if page == "" || page == "doc" {
		t.Fatalf("orphaned %v", orphaned)
	}
	wantOrphaned(t, answer, []string{page})
}

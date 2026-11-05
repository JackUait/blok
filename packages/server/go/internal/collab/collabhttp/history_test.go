package collabhttp

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/internal/collab/docendpoint"
	"github.com/JackUait/blok/packages/server/go/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/internal/collab/room"
	"github.com/JackUait/blok/packages/server/go/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/jsruntime"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// Twins of C# HistoryEndpointTests cases that had no Go or TS proof: the
// answer's byte cap after HTML is read, a restore pinned with If-Match, and
// the 503 for an export past the runtime's limits.

var (
	runtimeOnce sync.Once
	runtimePool *jsruntime.Pool
	runtimeErr  error
)

func runtimeReader(t *testing.T) convert.HTMLReader {
	t.Helper()
	runtimeOnce.Do(func() { runtimePool, runtimeErr = jsruntime.NewPool(jsruntime.Options{PoolSize: 1}) })
	if runtimeErr != nil {
		t.Fatal(runtimeErr)
	}
	return convert.RuntimeHTMLReader{Runtime: runtimePool}
}

// failingConverter is C# FailingConverter over the real converter.
type failingConverter struct {
	*convert.DocConverter
	mu           sync.Mutex
	exportErr    error
	resolvedBlob *string
}

func (c *failingConverter) set(exportErr error, resolvedBlob *string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.exportErr, c.resolvedBlob = exportErr, resolvedBlob
}

func (c *failingConverter) state() (error, *string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.exportErr, c.resolvedBlob
}

func (c *failingConverter) Export(ctx context.Context, doc *yjs.Doc) (*jsjson.Object, error) {
	if failure, _ := c.state(); failure != nil {
		return nil, failure
	}
	return c.DocConverter.Export(ctx, doc)
}

// ExportBlocks: while resolvedBlob is set, every rawblob's blob reads as
// HTML, a row that grows only once its HTML is read.
func (c *failingConverter) ExportBlocks(doc *yjs.Doc, warned map[string]bool) ([]any, []convert.RichTextHTMLSlot, error) {
	failure, blob := c.state()
	if failure != nil {
		return nil, nil, failure
	}
	blocks, slots, err := c.DocConverter.ExportBlocks(doc, warned)
	if err != nil || blob == nil {
		return blocks, slots, err
	}
	slots = nil
	for _, block := range blocks {
		object, ok := block.(*jsjson.Object)
		if !ok {
			continue
		}
		if kind, _ := object.Get(jsjson.FromString("type")); kind == nil || kind.(jsjson.Str).String() != "rawblob" {
			continue
		}
		data, _ := object.Get(jsjson.FromString("data"))
		value, _ := data.(*jsjson.Object).Get(jsjson.FromString("blob"))
		slots = append(slots, convert.RichTextHTMLSlot{
			Target: data.(*jsjson.Object), Key: jsjson.FromString("blob"),
			HTML: convert.RichTextHTML{Type: "rawblob", Field: "blob", HTML: value.(jsjson.Str)},
		})
	}
	return blocks, slots, nil
}

func (c *failingConverter) Resolve(ctx context.Context, slots []convert.RichTextHTMLSlot) error {
	if _, blob := c.state(); blob != nil {
		for _, slot := range slots {
			slot.Target.Set(slot.Key, jsjson.FromString(*blob))
		}
		return nil
	}
	return c.DocConverter.Resolve(ctx, slots)
}

// heldDocument is a doc endpoint holding one paragraph "one".
type heldDocument struct{}

func (heldDocument) Load(context.Context, string) (*docendpoint.Loaded, error) {
	data, err := jsjson.ParseNode([]byte(`{"blocks":[{"id":"a","type":"paragraph","data":{"text":"one"}}]}`), jsjson.Options{MaxDepth: 64})
	return &docendpoint.Loaded{Data: data}, err
}

func (heldDocument) Save(context.Context, string, any, *string, *docendpoint.Projection) (*string, error) {
	return nil, nil
}

type historyApp struct {
	server    *httptest.Server
	converter *failingConverter
}

// startHistory is C# HistoryApp.StartAsync: the routes over a room manager
// on the built-in journal.
func startHistory(t *testing.T) *historyApp {
	t.Helper()
	directory := t.TempDir()
	store, err := journal.NewStore(directory, journal.StoreOptions{})
	if err != nil {
		t.Fatal(err)
	}
	converter := &failingConverter{DocConverter: &convert.DocConverter{Now: time.Now, HTML: runtimeReader(t)}}
	manager := room.NewManager(room.ManagerOptions{
		Store: workingset.NewLocalStore(t.TempDir(), nil), Endpoint: heldDocument{}, Converter: converter,
		Operations: room.LocalJournal{Store: store}, Room: room.OptionsWith(func(ro *room.Options) { ro.MaxUpdateBytes = store.MaxUpdateBytes() }),
	})
	t.Cleanup(func() { _ = manager.Drain(context.Background()) })
	routes := New(Config{Rooms: func() (*room.Manager, error) { return manager, nil }, MaxMessageBytes: 8 << 20})
	mux := http.NewServeMux()
	mux.HandleFunc("POST /sync/{doc}/edit", routes.Edit)
	mux.HandleFunc("GET /sync/{doc}/state", routes.State)
	mux.HandleFunc("GET /sync/{doc}/history", routes.HistoryList)
	mux.HandleFunc("GET /sync/{doc}/history/{lineage}/{sequence}", routes.HistoryRead)
	mux.HandleFunc("GET /sync/{doc}/history/{lineage}/{sequence}/changes", routes.HistoryChanges)
	mux.HandleFunc("POST /sync/{doc}/history/{lineage}/{sequence}/restore", routes.HistoryRestore)
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return &historyApp{server: server, converter: converter}
}

type answer struct {
	status int
	header http.Header
	body   []byte
}

func (h *historyApp) send(t *testing.T, method, path, key, ifMatch, body string) answer {
	t.Helper()
	request, err := http.NewRequest(method, h.server.URL+"/sync/doc"+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if key != "" {
		request.Header.Set(IdempotencyKeyHeader, key)
	}
	if ifMatch != "" {
		request.Header.Set("If-Match", ifMatch)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	read, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return answer{response.StatusCode, response.Header, read}
}

// open loads the room through /state and answers its lineage.
func (h *historyApp) open(t *testing.T) string {
	t.Helper()
	state := h.send(t, "GET", "/state", "", "", "")
	if state.status != http.StatusOK {
		t.Fatalf("state = %d %s", state.status, state.body)
	}
	return state.header.Get("Blok-Doc-Lineage")
}

func (h *historyApp) blocks(t *testing.T) string {
	t.Helper()
	state := h.send(t, "GET", "/state", "", "", "")
	if state.status != http.StatusOK {
		t.Fatalf("state = %d %s", state.status, state.body)
	}
	return string(state.body)
}

var editKeys int

func (h *historyApp) edit(t *testing.T, key, body string) {
	t.Helper()
	if response := h.send(t, "POST", "/edit", key, "", body); response.status != http.StatusNoContent {
		t.Fatalf("edit %s = %d %s", key, response.status, response.body)
	}
}

func (h *historyApp) editText(t *testing.T, text string) {
	t.Helper()
	editKeys++
	h.edit(t, "text-"+strconv.Itoa(editKeys)+"-"+text, `{ "ops": [ { "op": "update", "id": "a", "data": { "text": "`+text+`" } } ] }`)
}

func (h *historyApp) restore(t *testing.T, lineage, sequence, key, ifMatch string) answer {
	t.Helper()
	return h.send(t, "POST", "/history/"+lineage+"/"+sequence+"/restore", key, ifMatch, "")
}

func changeSequences(t *testing.T, body []byte) ([]uint64, bool) {
	t.Helper()
	var parsed struct {
		Changes []struct {
			Sequence uint64 `json:"sequence"`
		} `json:"changes"`
		Truncated bool `json:"truncated"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("%v: %.200s", err, body)
	}
	sequences := make([]uint64, len(parsed.Changes))
	for i, change := range parsed.Changes {
		sequences[i] = change.Sequence
	}
	return sequences, parsed.Truncated
}

// Reading a row's HTML can make it larger than the replay measured; the
// answer still keeps to the budget.
func TestRowsThatGrowWhenTheirHtmlIsReadStillKeepToTheByteBudget(t *testing.T) {
	history := startHistory(t)
	lineage := history.open(t)
	history.edit(t, "insert", `{ "ops": [ { "op": "insert", "id": "b", "block": { "type": "rawblob", "data": { "blob": "0" } } } ] }`)
	for edit := 1; edit <= 4; edit++ {
		history.edit(t, "blob-"+strconv.Itoa(edit), `{ "ops": [ { "op": "update", "id": "b", "data": { "blob": "`+strconv.Itoa(edit)+`" } } ] }`)
	}

	blob := strings.Repeat("z", 1_000_000)
	history.converter.set(nil, &blob)
	response := history.send(t, "GET", "/history/"+lineage+"/5/changes?since=0", "", "", "")

	if int64(len(response.body)) > room.MaxChangeBytes {
		t.Fatalf("%d bytes, past the %d budget", len(response.body), room.MaxChangeBytes)
	}
	sequences, truncated := changeSequences(t, response.body)
	if !truncated {
		t.Fatal("the answer does not say truncated")
	}
	if len(sequences) != 2 || sequences[0] != 4 || sequences[1] != 5 {
		t.Fatalf("sequences = %v, want [4 5]", sequences)
	}
}

// An agent pins its restore to the newest listed version: that point is the
// If-Match head until the room moves.
func TestARestorePinnedToTheNewestListedVersionLandsUntilTheRoomMoves(t *testing.T) {
	history := startHistory(t)
	lineage := history.open(t)
	history.editText(t, "two")
	history.editText(t, "three")
	newest := func() string {
		list := history.send(t, "GET", "/history", "", "", "")
		var parsed struct {
			Versions []struct {
				Lineage  string `json:"lineage"`
				Sequence uint64 `json:"sequence"`
			} `json:"versions"`
		}
		if err := json.Unmarshal(list.body, &parsed); err != nil || len(parsed.Versions) == 0 {
			t.Fatalf("list = %d %s (%v)", list.status, list.body, err)
		}
		return `"` + parsed.Versions[0].Lineage + ":" + strconv.FormatUint(parsed.Versions[0].Sequence, 10) + `"`
	}

	landed := history.restore(t, lineage, "1", "pinned-current", newest())
	if landed.status != http.StatusNoContent {
		t.Fatalf("pinned restore = %d %s", landed.status, landed.body)
	}
	if restored := history.blocks(t); !strings.Contains(restored, "two") || strings.Contains(restored, "three") {
		t.Fatalf("restored = %s", restored)
	}

	again := newest()
	history.editText(t, "peer")
	stale := history.restore(t, lineage, "0", "pinned-stale", again)
	if stale.status != http.StatusPreconditionFailed || string(stale.body) != "the document is no longer at the If-Match head\n" {
		t.Fatalf("stale restore = %d %q", stale.status, stale.body)
	}
	if !strings.Contains(history.blocks(t), "peer") {
		t.Fatal("the stale restore landed")
	}
}

// As /state: an export past the runtime's limits may pass on a retry; one
// that never can is a 500.
func TestAnExportPastTheRuntimesLimitsIsARetryable503(t *testing.T) {
	history := startHistory(t)
	lineage := history.open(t)
	history.editText(t, "two")

	history.converter.set(&convert.TransientError{Message: "collab: the runtime timed out"}, nil)
	overloaded := history.send(t, "GET", "/history/"+lineage+"/0", "", "", "")
	restoreOverloaded := history.restore(t, lineage, "0", "overloaded", "")
	changesOverloaded := history.send(t, "GET", "/history/"+lineage+"/1/changes", "", "", "")
	history.converter.set(errors.New("not JSON"), nil)
	failed := history.send(t, "GET", "/history/"+lineage+"/0", "", "", "")
	changesFailed := history.send(t, "GET", "/history/"+lineage+"/1/changes", "", "", "")
	history.converter.set(nil, nil)

	const retry = "the server ran past its limits exporting this version, retry\n"
	for name, a := range map[string]answer{"changes": changesOverloaded, "read": overloaded} {
		if a.status != http.StatusServiceUnavailable || string(a.body) != retry || a.header.Get("Retry-After") != "2" {
			t.Fatalf("%s overloaded = %d %q Retry-After %q", name, a.status, a.body, a.header.Get("Retry-After"))
		}
	}
	if restoreOverloaded.status != http.StatusServiceUnavailable || restoreOverloaded.header.Get("Retry-After") != "2" {
		t.Fatalf("restore overloaded = %d %q Retry-After %q", restoreOverloaded.status, restoreOverloaded.body, restoreOverloaded.header.Get("Retry-After"))
	}
	for name, a := range map[string]answer{"changes": changesFailed, "read": failed} {
		if a.status != http.StatusInternalServerError || string(a.body) != "the version could not be exported\n" {
			t.Fatalf("%s failed = %d %q", name, a.status, a.body)
		}
	}
	if failed.header.Get("Retry-After") != "" {
		t.Fatal("a failed export says retry")
	}
}

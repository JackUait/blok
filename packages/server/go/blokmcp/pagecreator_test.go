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

	"github.com/JackUait/blok/packages/server/go/v2/blokagent"
)

// hostPages is a host page creator: each answer in turn, then "page-N".
type hostPages struct {
	mu       sync.Mutex
	answers  []func(ctx context.Context) (string, error)
	requests []blokagent.PageCreateRequest
}

func (h *hostPages) create(ctx context.Context, request blokagent.PageCreateRequest) (string, error) {
	h.mu.Lock()
	h.requests = append(h.requests, request)
	at := len(h.requests) - 1
	h.mu.Unlock()
	if at < len(h.answers) {
		return h.answers[at](ctx)
	}
	return "page-" + string(rune('1'+at)), nil
}

func answer(id string, err error) func(context.Context) (string, error) {
	return func(context.Context) (string, error) { return id, err }
}

type creatorServer struct {
	server     *Server
	dir        string
	who        *caller
	handle     string
	pages      *hostPages
	authorized []string
}

// creatorServer opens doc for writing with a host page creator.
func newCreatorServer(t *testing.T, document string, pages *hostPages) *creatorServer {
	t.Helper()
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "doc.json"), []byte(document), 0o644)
	made := &creatorServer{dir: dir, pages: pages}
	var mu sync.Mutex
	server, err := New(Options{
		Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: dir}, PageTitles: "page-map",
		CreatePage: pages.create,
		Authorize: func(_ context.Context, _, documentID string, _ bool) (bool, error) {
			mu.Lock()
			defer mu.Unlock()
			made.authorized = append(made.authorized, documentID)
			return true, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	made.server = server
	made.who, _ = server.actorFor(context.Background(), "alice", new("Desktop"))
	opened, err := server.dispatch(context.Background(), &toolCall{name: "blok_open", arguments: json.RawMessage(`{"documentId":"doc","write":true}`), caller: made.who})
	if err != nil {
		t.Fatal(err)
	}
	handle, _ := json.Marshal(structured(t, opened.answer)["handle"])
	made.handle = string(handle)
	return made
}

func (c *creatorServer) execute(t *testing.T, commands string) map[string]any {
	t.Helper()
	ran, err := c.server.dispatch(context.Background(), &toolCall{name: "blok_execute", caller: c.who,
		arguments: json.RawMessage(`{"handle":` + c.handle + `,"commands":` + commands + `}`)})
	if err != nil {
		t.Fatal(err)
	}
	return structured(t, ran.answer)
}

func (c *creatorServer) parent(t *testing.T) string {
	t.Helper()
	written, _ := os.ReadFile(filepath.Join(c.dir, "doc.json"))
	return string(written)
}

func (c *creatorServer) files(t *testing.T) []string {
	t.Helper()
	entries, _ := os.ReadDir(c.dir)
	names := []string{}
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	return names
}

const onePage = `[{"name":"block.insert","args":{"type":"page","id":"np0","position":"end"}}]`

// The host's id becomes the page's pageId. The host gets the parent, the
// opener and a suggested id; Blok asks no authorize about the new id and
// saves no page document.
func TestAHostPageCreatorMakesThePage(t *testing.T) {
	pages := &hostPages{answers: []func(context.Context) (string, error){answer("host-page-1", nil)}}
	creator := newCreatorServer(t, `{"blocks":[]}`, pages)
	ran := creator.execute(t, onePage)
	if ran["ok"] != true || !strings.Contains(creator.parent(t), `"host-page-1"`) {
		t.Fatalf("answer %v, parent %s", ran, creator.parent(t))
	}
	if len(pages.requests) != 1 {
		t.Fatalf("requests %+v", pages.requests)
	}
	request := pages.requests[0]
	onBehalf := "alice"
	want := blokagent.Actor{ID: "agent:alice:Desktop", Name: "Desktop (for alice)", OnBehalfOf: &onBehalf}
	if request.ParentDocumentID != "doc" || request.Principal != "alice" || !reflect.DeepEqual(request.Actor, want) || len(request.SuggestedPageID) != 10 {
		t.Fatalf("request %+v (actor %+v)", request, request.Actor)
	}
	if !reflect.DeepEqual(creator.authorized, []string{"doc", "doc"}) {
		t.Fatalf("authorized %v", creator.authorized)
	}
	if files := creator.files(t); !reflect.DeepEqual(files, []string{"doc.json"}) {
		t.Fatalf("files %v", files)
	}
}

// ErrPageRefused fails the insert with FORBIDDEN, and nothing is saved.
func TestARefusedHostPageIsForbidden(t *testing.T) {
	creator := newCreatorServer(t, `{"blocks":[]}`, &hostPages{answers: []func(context.Context) (string, error){answer("", ErrPageRefused)}})
	ran := creator.execute(t, onePage)
	failure, _ := ran["error"].(map[string]any)
	if failure["code"] != "FORBIDDEN" || failure["message"] != "You may not create a page document here." || failure["details"] != nil || failure["commandIndex"] != float64(0) {
		t.Fatalf("answer %v", ran)
	}
	if creator.parent(t) != `{"blocks":[]}` {
		t.Fatalf("parent %s", creator.parent(t))
	}
}

// A host error, or an id that is not one, fails the first page with
// SOURCE_UNAVAILABLE in fixed words; the host's text is only logged.
func TestAHostPageErrorIsSourceUnavailable(t *testing.T) {
	cases := []struct {
		name   string
		answer func(context.Context) (string, error)
		logged string
	}{
		{"error", answer("", errors.New("db password=hunter2")), "hunter2"},
		{"empty", answer("", nil), "no valid page id"},
		{"dot", answer(".", nil), "no valid page id"},
		{"dots", answer("..", nil), "no valid page id"},
		{"C0", answer("page\a", nil), "no valid page id"},
		{"C1", answer("page\u0085", nil), "no valid page id"},
		{"invalid UTF-8", answer("page\xff", nil), "no valid page id"},
		{"513 code points", answer(strings.Repeat("😀", 513), nil), "no valid page id"},
	}
	for _, row := range cases {
		t.Run(row.name, func(t *testing.T) {
			var log strings.Builder
			previous := logOutput
			logOutput = &log
			t.Cleanup(func() { logOutput = previous })
			creator := newCreatorServer(t, `{"blocks":[]}`, &hostPages{answers: []func(context.Context) (string, error){row.answer}})
			ran := creator.execute(t, onePage)
			failure, _ := ran["error"].(map[string]any)
			if failure["code"] != "SOURCE_UNAVAILABLE" || failure["message"] != "The host could not create the page." || failure["retryable"] != true || failure["details"] != nil {
				t.Fatalf("answer %v", ran)
			}
			if !strings.Contains(log.String(), row.logged) || strings.Contains(failure["message"].(string), "hunter2") {
				t.Fatalf("log %q", log.String())
			}
			if creator.parent(t) != `{"blocks":[]}` {
				t.Fatalf("parent %s", creator.parent(t))
			}
		})
	}
}

// 512 code points is an id, even when each is four bytes.
func TestAHostPageIdIsCountedInCodePoints(t *testing.T) {
	id := strings.Repeat("😀", 512)
	creator := newCreatorServer(t, `{"blocks":[]}`, &hostPages{answers: []func(context.Context) (string, error){answer(id, nil)}})
	if ran := creator.execute(t, onePage); ran["ok"] != true {
		t.Fatalf("answer %v", ran)
	}
}

// pagesStopped checks a batch the second page stopped: the first page is
// orphaned with cause, at command 1, and the answer has the revision.
func wantHostOrphan(t *testing.T, ran map[string]any, page string, cause map[string]any) {
	t.Helper()
	failure, _ := ran["error"].(map[string]any)
	details, _ := failure["details"].(map[string]any)
	receipts := []any{map[string]any{"command": "block.insert", "type": "page", "prepared": map[string]any{"pageId": page}}}
	if failure["code"] != "ORPHANED_SIDE_EFFECT" || failure["commandIndex"] != float64(1) || failure["retryable"] != false ||
		!reflect.DeepEqual(details["orphaned"], receipts) || !reflect.DeepEqual(details["cause"], cause) {
		t.Fatalf("answer %v", ran)
	}
	if failure["message"] != "The batch failed after the host did work for it ("+cause["message"].(string)+"). Clean up the listed items." {
		t.Fatalf("message %v", failure["message"])
	}
	if revision, _ := ran["revision"].(string); revision == "" {
		t.Fatalf("no revision: %v", ran)
	}
}

const twoHostPages = `[{"name":"block.insert","args":{"type":"page","id":"np0","position":"end"}},` +
	`{"name":"block.insert","args":{"type":"page","id":"np1","position":"end"}}]`

// A host error after a page was made lists it, with Blok.Server's cause.
func TestAHostPageErrorAfterAPageListsIt(t *testing.T) {
	creator := newCreatorServer(t, `{"blocks":[]}`, &hostPages{answers: []func(context.Context) (string, error){
		answer("host-1", nil), answer("", errors.New("database down")),
	}})
	wantHostOrphan(t, creator.execute(t, twoHostPages), "host-1", map[string]any{
		"code": "APPLY_FAILED", "message": "The batch stopped on a server error. Nothing was written.", "retryable": true, "commandIndex": float64(1),
	})
	if creator.parent(t) != `{"blocks":[]}` {
		t.Fatalf("parent %s", creator.parent(t))
	}
}

// A refusal after a page was made lists it, with FORBIDDEN as the cause.
func TestAHostRefusalAfterAPageListsIt(t *testing.T) {
	creator := newCreatorServer(t, `{"blocks":[]}`, &hostPages{answers: []func(context.Context) (string, error){
		answer("host-1", nil), answer("", ErrPageRefused),
	}})
	wantHostOrphan(t, creator.execute(t, twoHostPages), "host-1", map[string]any{
		"code": "FORBIDDEN", "message": "You may not create a page document here.", "retryable": false, "commandIndex": float64(1),
	})
}

// A page the parent already links (a page block's data.pageId) is no
// orphan: with none left, the cause is the answer. Text elsewhere does not
// count as a link.
func TestOnlyPagesTheParentDoesNotLinkAreOrphaned(t *testing.T) {
	stop := []func(context.Context) (string, error){answer("linked", nil), answer("", errors.New("database down"))}
	linked := newCreatorServer(t, `{"blocks":[{"id":"old","type":"page","data":{"pageId":"linked"}}]}`, &hostPages{answers: stop})
	ran := linked.execute(t, twoHostPages)
	failure, _ := ran["error"].(map[string]any)
	if !reflect.DeepEqual(failure, map[string]any{
		"code": "APPLY_FAILED", "message": "The batch stopped on a server error. Nothing was written.", "retryable": true, "commandIndex": float64(1),
	}) {
		t.Fatalf("answer %v", ran)
	}
	text := newCreatorServer(t, `{"blocks":[{"id":"p","type":"paragraph","data":{"text":"linked"}}]}`, &hostPages{answers: stop})
	wantHostOrphan(t, text.execute(t, twoHostPages), "linked", map[string]any{
		"code": "APPLY_FAILED", "message": "The batch stopped on a server error. Nothing was written.", "retryable": true, "commandIndex": float64(1),
	})
}

// A cancel between pages stops the creating. The pages made are orphaned
// with CANCELLED as the cause, in the shape of the APPLY_FAILED stop. MCP
// calls run on a context a client cancel never reaches (as Node, which
// saves a cancelled batch), so this guards a cancel from elsewhere.
func TestACancelAfterAPageListsIt(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	pages := &hostPages{answers: []func(context.Context) (string, error){func(context.Context) (string, error) {
		cancel()
		return "host-1", nil
	}}}
	creator := newCreatorServer(t, `{"blocks":[]}`, pages)
	var opened session
	_ = creator.server.handles.use(context.Background(), strings.Trim(creator.handle, `"`), "alice", func(sess session, _ string) error {
		opened = sess
		return nil
	})
	ran, err := opened.execute(ctx, &callContext{who: creator.who, principal: "alice", actor: creator.who.actor}, json.RawMessage(`{"commands":`+twoHostPages+`}`))
	if err != nil {
		t.Fatal(err)
	}
	wantHostOrphan(t, structured(t, ran.answer), "host-1", map[string]any{
		"code": "CANCELLED", "message": "The batch was cancelled. Nothing was written.", "retryable": false, "commandIndex": float64(1),
	})
	if len(pages.requests) != 1 {
		t.Fatalf("the host was asked after the cancel: %d", len(pages.requests))
	}
}

// 26 page inserts are refused before the host is asked; undo and redo
// never ask it.
func TestTheHostIsNotAskedPastTheLimitOrOnUndo(t *testing.T) {
	pages := &hostPages{}
	creator := newCreatorServer(t, `{"blocks":[]}`, pages)
	inserts := make([]string, 26)
	for index := range inserts {
		inserts[index] = `{"name":"block.insert","args":{"type":"page","position":"end"}}`
	}
	if ran := creator.execute(t, "["+strings.Join(inserts, ",")+"]"); ran["ok"] != false || len(pages.requests) != 0 {
		t.Fatalf("answer %v, requests %d", ran, len(pages.requests))
	}
	creator.execute(t, onePage)
	for _, command := range []string{"history.undo", "history.redo"} {
		if ran := creator.execute(t, `[{"name":"`+command+`","args":{}}]`); ran["ok"] != true {
			t.Fatalf("%s: %v", command, ran)
		}
	}
	if len(pages.requests) != 1 {
		t.Fatalf("requests %d", len(pages.requests))
	}
}

// A page creator needs stored mode with a source.
func TestAPageCreatorIsRefusedWithoutStoredMode(t *testing.T) {
	create := func(context.Context, blokagent.PageCreateRequest) (string, error) { return "", nil }
	dir := t.TempDir()
	for name, options := range map[string]Options{
		"sync":      {Sync: &Sync{URL: "ws://127.0.0.1:9/sync"}, Tickets: &Tickets{Kind: "secret", Secret: "s"}, Source: &Source{Kind: "files", Dir: dir}},
		"no source": {},
		"rooms":     {Rooms: &blokagent.Executor{}, Source: &Source{Kind: "files", Dir: dir}},
	} {
		options.Transport, options.Auth, options.PageTitles, options.CreatePage = Transport{Kind: "stdio"}, Auth{Kind: "none"}, "page-map", create
		var refused *ConfigError
		if _, err := New(options); !errors.As(err, &refused) {
			t.Fatalf("%s: %v", name, err)
		}
	}
}

// The --create-page webhook: the wire every port sends, and how its answer
// reads.
func TestTheCreatePageWebhook(t *testing.T) {
	var got struct {
		header http.Header
		body   string
	}
	reply := `{"pageId":"a","pageId":null}`
	status := http.StatusOK
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		got.header, got.body = r.Header, string(body)
		w.WriteHeader(status)
		_, _ = io.WriteString(w, reply)
	}))
	t.Cleanup(host.Close)
	create := CreatePageWebhook(host.URL + "/pages")
	request := blokagent.PageCreateRequest{ParentDocumentID: "doc", Principal: "alice", SuggestedPageID: "abcdefghij", Actor: blokagent.Actor{ID: "agent:alice:x", Name: "x"}}
	if _, err := create(context.Background(), request); !errors.Is(err, ErrPageRefused) {
		t.Fatalf("a repeated key keeps its last value, null: %v", err)
	}
	if got.body != `{"parentDocumentId":"doc","principal":"alice","actor":{"id":"agent:alice:x","name":"x","onBehalfOf":null},"suggestedPageId":"abcdefghij"}` ||
		got.header.Get("Content-Type") != "application/json" {
		t.Fatalf("sent %s %v", got.body, got.header)
	}
	for _, row := range []struct {
		status int
		reply  string
		want   string
	}{
		{200, `{"pageId":"page\ud800"}`, "no valid page id"},
		{200, `{"pageId":""}`, "no valid page id"},
		{200, `{}`, `no "pageId"`},
		{200, `[]`, `no "pageId"`},
		{200, `not json`, "not JSON"},
		{201, `{"pageId":"a"}`, "answered 201"},
		{307, ``, "answered 307"},
	} {
		status, reply = row.status, row.reply
		if _, err := create(context.Background(), request); err == nil || errors.Is(err, ErrPageRefused) || !strings.Contains(err.Error(), row.want) {
			t.Fatalf("%d %s: %v", row.status, row.reply, err)
		}
	}
	status, reply = 200, `{"pageId":"page-é"}`
	if id, err := create(context.Background(), request); err != nil || id != "page-é" {
		t.Fatalf("%q %v", id, err)
	}
}

// --create-page and --handle-store are read, not ignored.
func TestParseArgsReadsTheCreatePageHook(t *testing.T) {
	options, err := ParseArgs([]string{"--source", "files:" + t.TempDir(), "--page-titles", "page-map", "--create-page", "http://127.0.0.1:9/pages"}, map[string]string{})
	if err != nil || options.CreatePage == nil {
		t.Fatalf("hook set %v, err %v", options.CreatePage != nil, err)
	}
}

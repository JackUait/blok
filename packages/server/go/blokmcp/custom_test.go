package blokmcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
)

// memorySource is a host's document store in memory. fail, when set,
// answers an op instead of the store.
type memorySource struct {
	mu       sync.Mutex
	docs     map[string]StoredDocument
	next     int
	calls    []sourceCall
	fail     func(op, documentID string) error
	noLister bool
	// saveVersion, when set, is the version every save answers.
	saveVersion *string
	// loadAnswer, when set, answers every load.
	loadAnswer func(documentID string) *StoredDocument
}

type sourceCall struct {
	op, documentID string
	caller         DocumentCaller
	text           string
	ifVersion      *string
	list           ListRequest
}

func newMemorySource(docs map[string]StoredDocument) *memorySource {
	if docs == nil {
		docs = map[string]StoredDocument{}
	}
	return &memorySource{docs: docs}
}

func (m *memorySource) record(call sourceCall) error {
	m.mu.Lock()
	m.calls = append(m.calls, call)
	fail := m.fail
	m.mu.Unlock()
	if fail != nil {
		return fail(call.op, call.documentID)
	}
	return nil
}

func (m *memorySource) Load(_ context.Context, caller DocumentCaller, documentID string) (*StoredDocument, error) {
	if err := m.record(sourceCall{op: "load", documentID: documentID, caller: caller}); err != nil {
		return nil, err
	}
	if m.loadAnswer != nil {
		return m.loadAnswer(documentID), nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	doc, ok := m.docs[documentID]
	if !ok {
		return nil, nil
	}
	return &doc, nil
}

func (m *memorySource) Save(_ context.Context, caller DocumentCaller, documentID, documentText string, ifVersion *string) (string, error) {
	if err := m.record(sourceCall{op: "save", documentID: documentID, caller: caller, text: documentText, ifVersion: ifVersion}); err != nil {
		return "", err
	}
	if m.saveVersion != nil {
		return *m.saveVersion, nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	current, exists := m.docs[documentID]
	if (ifVersion == nil) == exists || (ifVersion != nil && *ifVersion != current.Version) {
		return "", &SourceError{Kind: SourceChanged}
	}
	m.next++
	version := "v" + string(rune('0'+m.next))
	m.docs[documentID] = StoredDocument{DocumentText: documentText, Version: version}
	return version, nil
}

// listingSource is a memorySource that lists.
type listingSource struct {
	*memorySource
	listing *DocumentList
}

func (l *listingSource) List(_ context.Context, caller DocumentCaller, request ListRequest) (*DocumentList, error) {
	if err := l.record(sourceCall{op: "list", caller: caller, list: request}); err != nil {
		return nil, err
	}
	return l.listing, nil
}

func (m *memorySource) callsOf(op string) []sourceCall {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []sourceCall
	for _, call := range m.calls {
		if call.op == op {
			out = append(out, call)
		}
	}
	return out
}

// customClient is a server on a host source, with a caller per client name.
type customClient struct {
	t      *testing.T
	server *Server
}

func newCustomClient(t *testing.T, source DocumentSource, options Options) *customClient {
	t.Helper()
	options.Transport = Transport{Kind: "stdio"}
	options.Auth = Auth{Kind: "none"}
	options.DocumentSource = source
	server, err := New(options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	return &customClient{t: t, server: server}
}

func (c *customClient) call(principal, client, name string, arguments map[string]any) map[string]any {
	c.t.Helper()
	who, err := c.server.actorFor(context.Background(), principal, &client)
	if err != nil {
		c.t.Fatal(err)
	}
	raw, _ := json.Marshal(arguments)
	ran, err := c.server.dispatch(context.Background(), &toolCall{name: name, arguments: raw, caller: who})
	if err != nil {
		c.t.Fatalf("%s: %v", name, err)
	}
	return structured(c.t, ran.answer)
}

func errorCodeOf(answer map[string]any) (string, string) {
	failure, _ := answer["error"].(map[string]any)
	code, _ := failure["code"].(string)
	message, _ := failure["message"].(string)
	return code, message
}

const storedParagraph = `{"blocks":[{"id":"p1","type":"paragraph","data":{"text":"Stored"}}]}`

func TestACustomSourceOpensAMissingDocumentEmptyAndCreatesItOnTheFirstSave(t *testing.T) {
	source := newMemorySource(nil)
	client := newCustomClient(t, source, Options{})
	opened := client.call("alice", "Desktop", "blok_open", map[string]any{"documentId": "new", "write": true})
	if opened["exists"] != false {
		t.Fatalf("open: %v", opened)
	}
	ran := client.call("alice", "Desktop", "blok_execute", map[string]any{"handle": opened["handle"],
		"commands": []any{map[string]any{"name": "doc.setTitle", "args": map[string]any{"title": "First"}}}})
	delivery, _ := ran["delivery"].(map[string]any)
	if ran["ok"] != true || delivery["savedVersion"] != "v1" {
		t.Fatalf("execute: %v", ran)
	}
	saves := source.callsOf("save")
	if len(saves) != 1 || saves[0].ifVersion != nil || saves[0].text != `{"title":"First","blocks":[]}` {
		t.Fatalf("saves: %+v", saves)
	}
}

func TestACustomSourceActsForTheOpenerAndListsForTheCurrentCaller(t *testing.T) {
	source := &listingSource{memorySource: newMemorySource(map[string]StoredDocument{"doc": {DocumentText: storedParagraph, Version: "v0"}}),
		listing: &DocumentList{Documents: []ListedDocument{{ID: "doc"}}}}
	client := newCustomClient(t, source, Options{})
	opened := client.call("alice", "Desktop", "blok_open", map[string]any{"documentId": "doc", "write": true})
	client.call("alice", "Other", "blok_execute", map[string]any{"handle": opened["handle"],
		"commands": []any{map[string]any{"name": "doc.setTitle", "args": map[string]any{"title": "T"}}}})
	client.call("alice", "Other", "blok_list_documents", map[string]any{})
	for _, call := range source.calls {
		want := "Desktop"
		if call.op == "list" {
			want = "Other"
		}
		if call.caller.Principal != "alice" || call.caller.ClientName != want || call.caller.Actor.ID != "agent:alice:"+want ||
			call.caller.Actor.OnBehalfOf == nil || *call.caller.Actor.OnBehalfOf != "alice" || call.caller.Scopes != nil {
			t.Fatalf("%s got caller %+v", call.op, call.caller)
		}
	}
	if len(source.callsOf("save")) != 1 || len(source.callsOf("list")) != 1 {
		t.Fatalf("calls: %+v", source.calls)
	}
}

func TestAChangedSaveIsDocumentChangedAndReloadsTheStoredDocument(t *testing.T) {
	source := newMemorySource(map[string]StoredDocument{"doc": {DocumentText: storedParagraph, Version: "v0"}})
	client := newCustomClient(t, source, Options{})
	opened := client.call("alice", "Desktop", "blok_open", map[string]any{"documentId": "doc", "write": true})
	source.fail = func(op, _ string) error {
		if op == "save" {
			return &SourceError{Kind: SourceChanged}
		}
		return nil
	}
	ran := client.call("alice", "Desktop", "blok_execute", map[string]any{"handle": opened["handle"],
		"commands": []any{map[string]any{"name": "doc.setTitle", "args": map[string]any{"title": "Lost"}}}})
	if code, message := errorCodeOf(ran); code != "DOCUMENT_CHANGED" || message != "Someone saved this document since you opened it. Read it again, then retry." {
		t.Fatalf("execute: %v", ran)
	}
	if loads := source.callsOf("load"); len(loads) != 2 {
		t.Fatalf("the handle did not reload: %+v", loads)
	}
}

// A plain error is the host's bug: logged in full, generic for the agent,
// and memory goes back to the store's document (no undo step survives).
func TestAPlainSaveErrorIsLoggedAndTheAgentSeesGenericWords(t *testing.T) {
	var log bytes.Buffer
	previous := logOutput
	logOutput = &log
	t.Cleanup(func() { logOutput = previous })
	source := newMemorySource(map[string]StoredDocument{"doc": {DocumentText: storedParagraph, Version: "v0"}})
	client := newCustomClient(t, source, Options{})
	opened := client.call("alice", "Desktop", "blok_open", map[string]any{"documentId": "doc", "write": true})
	source.fail = func(op, _ string) error {
		if op == "save" {
			return errors.New("db password=hunter2")
		}
		return nil
	}
	ran := client.call("alice", "Desktop", "blok_execute", map[string]any{"handle": opened["handle"],
		"commands": []any{map[string]any{"name": "doc.setTitle", "args": map[string]any{"title": "Lost"}}}})
	if code, message := errorCodeOf(ran); code != "SOURCE_UNAVAILABLE" || message != "The host could not save this document, so nothing was saved. Try again." {
		t.Fatalf("execute: %v", ran)
	}
	if strings.Contains(ran["error"].(map[string]any)["message"].(string), "hunter2") || !strings.Contains(log.String(), "hunter2") {
		t.Fatalf("log %q", log.String())
	}
	source.fail = nil
	undo := client.call("alice", "Desktop", "blok_execute", map[string]any{"handle": opened["handle"],
		"commands": []any{map[string]any{"name": "history.undo", "args": map[string]any{}}}})
	if code, _ := errorCodeOf(undo); code != "NOTHING_TO_UNDO" {
		t.Fatalf("undo: %v", undo)
	}
}

func TestSourceErrorKindsMapToCodesWithTheHostsMessageOrBloksWords(t *testing.T) {
	cases := []struct {
		kind    SourceErrorKind
		message string
		code    string
		want    string
	}{
		{SourceForbidden, "", "FORBIDDEN", "The host does not allow this."},
		{SourceForbidden, "Ask the owner.", "FORBIDDEN", "Ask the owner."},
		{SourceInvalidID, " ", "INVALID_ARGS", "The host does not accept this document id."},
		{SourceUnavailable, "", "SOURCE_UNAVAILABLE", "The host could not load this document. Try again."},
		{SourceChanged, "", "DOCUMENT_CHANGED", "Someone saved this document since you opened it. Read it again, then retry."},
	}
	for _, c := range cases {
		source := newMemorySource(nil)
		source.fail = func(string, string) error {
			return &SourceError{Kind: c.kind, AgentMessage: c.message, Err: errors.New("cause")}
		}
		client := newCustomClient(t, source, Options{})
		opened := client.call("alice", "Desktop", "blok_open", map[string]any{"documentId": "doc"})
		if code, message := errorCodeOf(opened); code != c.code || message != c.want {
			t.Fatalf("%s %q: %v", c.kind, c.message, opened)
		}
	}
}

func TestACustomLoadIsCheckedAsTheEndpointSourceChecksIt(t *testing.T) {
	deep := strings.Repeat("[", 49) + strings.Repeat("]", 49)
	cases := map[string]struct{ text, want string }{
		"shape": {`{"title":"x"}`, `The host's document "doc" is not a Blok document: expected an object with a "blocks" array.`},
		"deep":  {`{"blocks":[],"x":` + deep + `}`, `The host's document "doc" nests deeper than 48 levels of objects and arrays.`},
		"json":  {`{"blocks":`, `The host's document "doc" is not JSON.`},
		"empty": {``, `The host's document "doc" is not JSON.`},
		"last":  {`{"blocks":[],"blocks":7}`, `The host's document "doc" is not a Blok document: expected an object with a "blocks" array.`},
	}
	for name, c := range cases {
		source := newMemorySource(map[string]StoredDocument{"doc": {DocumentText: c.text, Version: "v1"}})
		client := newCustomClient(t, source, Options{})
		opened := client.call("alice", "Desktop", "blok_open", map[string]any{"documentId": "doc"})
		if code, message := errorCodeOf(opened); code != "SOURCE_UNAVAILABLE" || message != c.want {
			t.Fatalf("%s: %v", name, opened)
		}
	}
}

func TestALoneSurrogateInACustomDocumentReadsAsTheReplacementCharacter(t *testing.T) {
	source := newMemorySource(map[string]StoredDocument{"doc": {DocumentText: `{"blocks":[{"id":"p1","type":"paragraph","data":{"text":"a\ud800b"}}]}`, Version: "v1"}})
	client := newCustomClient(t, source, Options{})
	opened := client.call("alice", "Desktop", "blok_open", map[string]any{"documentId": "doc"})
	read := client.call("alice", "Desktop", "blok_read", map[string]any{"handle": opened["handle"]})
	written, _ := json.Marshal(read)
	if !strings.Contains(string(written), "a�b") {
		t.Fatalf("open: %s", written)
	}
}

func TestAnswersWithoutAVersionAreSourceUnavailable(t *testing.T) {
	var log bytes.Buffer
	previous := logOutput
	logOutput = &log
	t.Cleanup(func() { logOutput = previous })
	source := newMemorySource(map[string]StoredDocument{"blank": {DocumentText: storedParagraph}, "doc": {DocumentText: storedParagraph, Version: "v1"}})
	empty := ""
	source.saveVersion = &empty
	client := newCustomClient(t, source, Options{})
	opened := client.call("alice", "Desktop", "blok_open", map[string]any{"documentId": "blank"})
	if code, message := errorCodeOf(opened); code != "SOURCE_UNAVAILABLE" || message != "The host could not load this document. Try again." {
		t.Fatalf("load: %v", opened)
	}
	opened = client.call("alice", "Desktop", "blok_open", map[string]any{"documentId": "doc", "write": true})
	ran := client.call("alice", "Desktop", "blok_execute", map[string]any{"handle": opened["handle"],
		"commands": []any{map[string]any{"name": "doc.setTitle", "args": map[string]any{"title": "x"}}}})
	if code, message := errorCodeOf(ran); code != "SOURCE_UNAVAILABLE" ||
		message != "The host may have saved this document but did not say which version. Read it before you retry." {
		t.Fatalf("save: %v", ran)
	}
	if !strings.Contains(log.String(), "the host document source failed to load") || !strings.Contains(log.String(), "failed to save") {
		t.Fatalf("log %q", log.String())
	}
}

func TestDotIdsNeverReachTheHostSource(t *testing.T) {
	source := newMemorySource(nil)
	client := newCustomClient(t, source, Options{})
	for _, id := range []string{".", ".."} {
		opened := client.call("alice", "Desktop", "blok_open", map[string]any{"documentId": id})
		if code, message := errorCodeOf(opened); code != "INVALID_ARGS" || message != `"`+id+`" is not a document id.` {
			t.Fatalf("%q: %v", id, opened)
		}
	}
	if len(source.calls) != 0 {
		t.Fatalf("the source was called: %+v", source.calls)
	}
}

func TestAListingIsFilteredByAuthorize(t *testing.T) {
	title := "Notes"
	source := &listingSource{memorySource: newMemorySource(nil),
		listing: &DocumentList{Documents: []ListedDocument{{ID: "doc", Title: &title}, {ID: "secret"}}}}
	client := newCustomClient(t, source, Options{Authorize: func(_ context.Context, _, documentID string, _ bool) (bool, error) {
		return documentID != "secret", nil
	}})
	listed := client.call("alice", "Desktop", "blok_list_documents", map[string]any{})
	written, _ := json.Marshal(listed["documents"])
	if string(written) != `[{"id":"doc","live":false,"title":"Notes"}]` || listed["supported"] != true {
		t.Fatalf("list: %v", listed)
	}
}

func TestASourceWithoutListDoesNotList(t *testing.T) {
	client := newCustomClient(t, newMemorySource(nil), Options{})
	listed := client.call("alice", "Desktop", "blok_list_documents", map[string]any{})
	if listed["supported"] != false {
		t.Fatalf("list: %v", listed)
	}
}

func TestADocumentSourceCannotBeCombinedWithSource(t *testing.T) {
	_, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"},
		Source: &Source{Kind: "files", Dir: t.TempDir()}, DocumentSource: newMemorySource(nil)})
	var refused *ConfigError
	if !errors.As(err, &refused) || refused.Message != "DocumentSource cannot be combined with Source: give one document source" {
		t.Fatalf("got %v", err)
	}
}

// A host source is a source: --ticket-url with no authorize must not start,
// or any HTTP caller could open any stored document.
func TestATicketURLWithAHostSourceAndNoAuthorizeRefusesToStart(t *testing.T) {
	_, err := New(Options{Transport: Transport{Kind: "http", Listen: "127.0.0.1:0"}, Auth: Auth{Kind: "none"},
		Sync:           &Sync{URL: "ws://127.0.0.1:9/sync"},
		Tickets:        &Tickets{Kind: "url", URL: "http://127.0.0.1:9/tickets", HostToken: "token"},
		DocumentSource: newMemorySource(nil)})
	var refused *ConfigError
	if !errors.As(err, &refused) || !strings.Contains(refused.Message, "needs a per-document check") {
		t.Fatalf("got %v", err)
	}
}

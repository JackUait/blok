package blokmcp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

// Node's one event loop runs pipelined calls on one handle in the order
// they came; the SDK runs each in its own goroutine.
func TestPipelinedCallsOnOneHandleRunInOrder(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "doc.json"), []byte(`{"blocks":[]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: dir}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	send, reader, _ := stdioClient(t, server, ctx)
	send(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"blok_open","arguments":{"documentId":"doc","write":true}}}`)
	line, err := reader.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	var opened struct {
		Result struct {
			StructuredContent map[string]any `json:"structuredContent"`
		} `json:"result"`
	}
	_ = json.Unmarshal([]byte(line), &opened)
	handle, _ := opened.Result.StructuredContent["handle"].(string)
	if handle == "" {
		t.Fatalf("no handle: %s", line)
	}
	const n = 60
	for i := range n {
		send(fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"method":"tools/call","params":{"name":"blok_execute","arguments":{"handle":%q,"commands":[{"name":"block.insert","args":{"type":"paragraph","data":{"text":"P%02d"}}}]}}}`, 100+i, handle, i))
	}
	for i := range n {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		var answer struct {
			ID int `json:"id"`
		}
		_ = json.Unmarshal([]byte(line), &answer)
		if answer.ID != 100+i {
			t.Fatalf("answer %d has id %d", i, answer.ID)
		}
	}
	saved, _ := os.ReadFile(filepath.Join(dir, "doc.json"))
	var applied []string
	for _, found := range regexp.MustCompile(`"text":\s*"(P\d\d)"`).FindAllStringSubmatch(string(saved), -1) {
		applied = append(applied, found[1])
	}
	if len(applied) != n {
		t.Fatalf("applied %d of %d: %.400s", len(applied), n, saved)
	}
	for i, text := range applied {
		if text != fmt.Sprintf("P%02d", i) {
			t.Fatalf("applied out of order: %v", applied)
		}
	}
}

func runsNow(turn *handleTurn) bool {
	done := make(chan struct{})
	go func() { turn.wait(); close(done) }()
	select {
	case <-done:
		return true
	case <-time.After(40 * time.Millisecond):
		return false
	}
}

// A call that ends before its turn only marks its place done: the next
// waiting call still waits for the one that runs.
func TestATurnThatEndsEarlyKeepsTheOthersInOrderAndOneAtATime(t *testing.T) {
	lines := newHandleLines()
	first, second, third := lines.reserve("h"), lines.reserve("h"), lines.reserve("h")
	if !runsNow(first) {
		t.Fatal("the first did not run")
	}
	second.release()
	if runsNow(third) {
		t.Fatal("the third ran beside the first")
	}
	first.release()
	if !runsNow(third) {
		t.Fatal("the third did not run after the first")
	}
	fourth := lines.reserve("h")
	if runsNow(fourth) {
		t.Fatal("the fourth ran beside the third")
	}
	third.release()
	if !runsNow(fourth) {
		t.Fatal("the fourth did not run")
	}
	fourth.release()
	fourth.release()
	if !runsNow(lines.reserve("h")) {
		t.Fatal("a twice-released turn wedged the line")
	}
}

// A reused id keeps both places; an id's unclaimed places go only once
// every request with it has ended.
func TestAReusedIDKeepsBothPlaces(t *testing.T) {
	lines := newHandleLines()
	tracker := newCallTracker()
	tracker.lines = lines
	a := tracker.book(id(t, 9.0), "h")
	b := tracker.book(id(t, 9.0), "h")
	first, second := lines.claim(a), lines.claim(b)
	if first == nil || second == nil || !runsNow(first) || runsNow(second) {
		t.Fatal("the two places of one id did not run in order")
	}
	first.release()
	second.release()
	c := tracker.book(id(t, 7.0), "k")
	d := tracker.book(id(t, 7.0), "k")
	tracker.ended(id(t, 7.0))
	kept := lines.claim(c)
	if kept == nil {
		t.Fatal("one ended request let go of an unclaimed place")
	}
	kept.release()
	tracker.ended(id(t, 7.0))
	if lines.claim(d) != nil {
		t.Fatal("an ended id kept its unclaimed place")
	}
	if !runsNow(lines.reserve("k")) {
		t.Fatal("the line stayed held")
	}
}

// Node's SDK answers a request id that is still in use as it answers any
// other; the Go SDK refuses it. Both get answered, in order.
func TestAReusedRequestIDIsAnsweredEachTime(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "doc.json"), []byte(`{"blocks":[]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: dir}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	send, reader, _ := stdioClient(t, server, ctx)
	send(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"blok_open","arguments":{"documentId":"doc","write":true}}}`)
	line, err := reader.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	var opened struct {
		Result struct {
			StructuredContent map[string]any `json:"structuredContent"`
		} `json:"result"`
	}
	_ = json.Unmarshal([]byte(line), &opened)
	handle, _ := opened.Result.StructuredContent["handle"].(string)
	send(`{"jsonrpc":"2.0","id":7,"method":"ping"}`)
	send(`{"jsonrpc":"2.0","id":7,"method":"ping"}`)
	for _, title := range []string{"A", "B"} {
		send(fmt.Sprintf(`{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"blok_execute","arguments":{"handle":%q,"commands":[{"name":"doc.setTitle","args":{"title":%q}}]}}}`, handle, title))
	}
	send(`{"jsonrpc":"2.0","id":"7","method":"ping"}`)
	lines := make(chan string, 8)
	go func() {
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			lines <- line
		}
	}()
	var ids []string
	for range 5 {
		var line string
		select {
		case line = <-lines:
		case <-time.After(10 * time.Second):
			t.Fatalf("answered only ids %v", ids)
		}
		var answer struct {
			ID    json.RawMessage `json:"id"`
			Error json.RawMessage `json:"error"`
		}
		_ = json.Unmarshal([]byte(line), &answer)
		if answer.Error != nil {
			t.Fatalf("an error: %s", line)
		}
		ids = append(ids, string(answer.ID))
	}
	counts := map[string]int{}
	for _, id := range ids {
		counts[id]++
	}
	if counts["7"] != 2 || counts["9"] != 2 || counts[`"7"`] != 1 {
		t.Fatalf("answered ids %v", ids)
	}
	saved, _ := os.ReadFile(filepath.Join(dir, "doc.json"))
	if !regexp.MustCompile(`"title":\s*"B"`).Match(saved) {
		t.Fatalf("the two calls did not run in order: %s", saved)
	}
}

// A stop waits for a call still waiting its turn on a handle, as Node's
// does for every call it took.
func TestAStopWaitsForACallQueuedOnItsHandle(t *testing.T) {
	var mu sync.Mutex
	var titles []string
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPut {
			body, _ := io.ReadAll(r.Body)
			time.Sleep(300 * time.Millisecond)
			mu.Lock()
			titles = append(titles, regexp.MustCompile(`"title":\s*"(\w+)"`).FindStringSubmatch(string(body))[1])
			mu.Unlock()
			_, _ = io.WriteString(w, `{"version":"v2"}`)
			return
		}
		_, _ = io.WriteString(w, `{"data":{"blocks":[]},"version":"v1"}`)
	}))
	t.Cleanup(host.Close)
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"},
		Source: &Source{Kind: "endpoint", URL: host.URL + "/docs", EndpointAuth: "Token t"}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	ctx, stop := context.WithCancel(context.Background())
	send, reader, done := stdioClient(t, server, ctx)
	send(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"blok_open","arguments":{"documentId":"doc","write":true}}}`)
	line, err := reader.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	handle := regexp.MustCompile(`\\"handle\\":\\"([^\\"]+)`).FindStringSubmatch(line)[1]
	for _, title := range []string{"First", "Second"} {
		send(fmt.Sprintf(`{"jsonrpc":"2.0","id":%q,"method":"tools/call","params":{"name":"blok_execute","arguments":{"handle":%q,"commands":[{"name":"doc.setTitle","args":{"title":%q}}]}}}`, title, handle, title))
	}
	time.Sleep(100 * time.Millisecond)
	stop()
	go func() { _, _ = io.Copy(io.Discard, reader) }()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("ServeStdio did not return")
	}
	mu.Lock()
	defer mu.Unlock()
	if strings.Join(titles, ",") != "First,Second" {
		t.Fatalf("saved %v before the stop ended", titles)
	}
}

package blokmcp

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestClampDepthMatchesTheSharedVectors(t *testing.T) {
	raw, err := os.ReadFile("../../../../test/unit/server-conformance/fixtures/mcp-depth-clamp.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors struct {
		HostLimit int `json:"hostLimit"`
		Cases     []struct {
			Name   string `json:"name"`
			Input  string `json:"input"`
			Limit  int    `json:"limit"`
			Output string `json:"output"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatal(err)
	}
	if vectors.HostLimit != messageDepthLimit {
		t.Fatalf("messageDepthLimit = %d, fixture says %d", messageDepthLimit, vectors.HostLimit)
	}
	for _, c := range vectors.Cases {
		if got := string(clampDepth([]byte(c.Input), c.Limit)); got != c.Output {
			t.Errorf("%s: clampDepth(%q, %d) = %q, want %q", c.Name, c.Input, c.Limit, got, c.Output)
		}
	}
}

func TestClampDepthTakesAHundredThousandLevels(t *testing.T) {
	deep := strings.Repeat("[", 100000) + strings.Repeat("]", 100000)
	got := string(clampDepth([]byte(`{"a":`+deep+`}`), 3))
	if got != `{"a":[[[]]]}` {
		t.Fatalf("got %q", got)
	}
}

const tooDeepArguments = "The arguments nest deeper than 48 levels of objects and arrays. Send flatter data."

// deepCall is a tools/call whose arguments nest depth levels (the arguments object is level 1).
func deepCall(id int, depth int, tail string) string {
	inner := strings.Repeat("[", depth-1) + tail + strings.Repeat("]", depth-1)
	return `{"jsonrpc":"2.0","id":` + strconv.Itoa(id) + `,"method":"tools/call","params":{"name":"blok_list_documents","arguments":{"zz":` + inner + `}}}`
}

// Node answers INVALID_ARGS at every depth past 48, over stdio and HTTP.
func TestDeepArgumentsGetNodesRefusalAtAnyDepth(t *testing.T) {
	dir := t.TempDir()
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: dir}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	send, reader, _ := stdioClient(t, server, ctx)
	for _, depth := range []int{49, 64, 65, 129, 1001, 10001, 100001} {
		send(deepCall(depth, depth, ""))
		line := readWithin(reader, 20*time.Second)
		if !strings.Contains(line, `"id":`+strconv.Itoa(depth)+`,`) || !strings.Contains(line, tooDeepArguments) {
			t.Errorf("stdio depth %d: %s", depth, truncate(line))
		}
	}
	// Invalid JSON past the clamp is still dropped, as Node drops it.
	send(deepCall(7, 2000, "1,"))
	send(`{"jsonrpc":"2.0","id":"after","method":"ping"}`)
	if line := readWithin(reader, 20*time.Second); !strings.Contains(line, `"after"`) {
		t.Errorf("deep invalid line got an answer: %s", truncate(line))
	}
}

func TestDeepArgumentsOverHTTPGetNodesRefusal(t *testing.T) {
	server, err := New(Options{Transport: Transport{Kind: "http", Listen: "127.0.0.1:0"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: t.TempDir()},
		Authorize: func(context.Context, string, string, bool) (bool, error) { return true, nil }})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	handler, err := server.Handler()
	if err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(handler)
	t.Cleanup(front.Close)
	post := func(version, body string) (*http.Response, string) {
		return sendRaw(t, front, map[string]string{"Host": front.Listener.Addr().String(), "Accept": acceptBoth, "Content-Type": "application/json", "Mcp-Protocol-Version": version}, body)
	}
	for _, depth := range []int{49, 64, 1001, 10001, 100001} {
		response, body := post("2025-11-25", deepCall(depth, depth, ""))
		if response.StatusCode != 200 || !strings.Contains(body, tooDeepArguments) {
			t.Errorf("http depth %d: %d %s", depth, response.StatusCode, truncate(body))
		}
		// In a batch the arguments sit one level deeper.
		response, body = post("2025-03-26", `[`+deepCall(depth, depth, "")+`]`)
		if response.StatusCode != 200 || !strings.Contains(body, tooDeepArguments) {
			t.Errorf("http batch depth %d: %d %s", depth, response.StatusCode, truncate(body))
		}
	}
	response, body := post("2025-11-25", deepCall(7, 2000, "1,"))
	if response.StatusCode != 400 || !sameJSON(t, body, `{"jsonrpc":"2.0","error":{"code":-32700,"message":"Parse error: Invalid JSON"},"id":null}`) {
		t.Errorf("deep invalid: %d %s", response.StatusCode, truncate(body))
	}
}

// readWithin is one line, or "" when none comes in time.
func readWithin(reader *bufio.Reader, wait time.Duration) string {
	got := make(chan string, 1)
	go func() {
		line, _ := reader.ReadString('\n')
		got <- line
	}()
	select {
	case line := <-got:
		return line
	case <-time.After(wait):
		return ""
	}
}

func truncate(text string) string {
	if len(text) > 300 {
		return text[:300] + "..."
	}
	return text
}

// deepDoc nests total levels: object 1, blocks 2, block 3, data 4, arrays after.
func deepDoc(total int, tail string) string {
	n := total - 4
	return `{"title":"T","blocks":[{"id":"p","type":"paragraph","data":{"text":"a","x":` + strings.Repeat("[", n) + tail + strings.Repeat("]", n) + `}}]}`
}

// Node checks an endpoint answer's depth before it parses it.
func TestEndpointAnswersNestedPast48AreRefusedAsNode(t *testing.T) {
	var answer string
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(answer)) }))
	t.Cleanup(host.Close)
	list := host.URL + "/list"
	source := newEndpointSource(&Source{Kind: "endpoint", URL: host.URL + "/docs", EndpointAuth: "Token x", List: &list})
	const deep = "The document endpoint answered JSON nested deeper than 48 levels for doc."
	cases := []struct{ name, answer, want string }{
		{"48 levels", deepDoc(48, ""), ""},
		{"49 levels", deepDoc(49, ""), deep},
		{"20000 levels", deepDoc(20000, ""), deep},
		{"deep and invalid", deepDoc(60, "1,"), deep},
		{"wrapped", `{"data":` + deepDoc(48, "") + `,"version":"v1"}`, deep},
	}
	for _, c := range cases {
		answer = c.answer
		_, err := source.load(context.Background(), "doc")
		got := ""
		if err != nil {
			got = err.Error()
		}
		if !strings.Contains(got, c.want) || (c.want == "" && err != nil) {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
	answer = `{"documents":[],"x":` + strings.Repeat("[", 48) + strings.Repeat("]", 48) + `}`
	if _, err := source.list(context.Background(), listRequest{Limit: 10}); err == nil || !strings.Contains(err.Error(), "The document endpoint answered JSON nested deeper than 48 levels for the list.") {
		t.Errorf("deep list: %v", err)
	}
}

// Node reads a save answer of any depth; its version still counts.
func TestADeepSaveAnswerStillGivesItsVersion(t *testing.T) {
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"version":"v2","x":` + strings.Repeat("[", 20000) + strings.Repeat("]", 20000) + `}`))
	}))
	t.Cleanup(host.Close)
	source := newEndpointSource(&Source{Kind: "endpoint", URL: host.URL + "/docs", EndpointAuth: "Token x"})
	before := "v1"
	version, err := source.save(context.Background(), "doc", []byte(`{"blocks":[]}`), &before)
	if err != nil || version == nil || *version != "v2" {
		t.Fatalf("got %v %v", version, err)
	}
}

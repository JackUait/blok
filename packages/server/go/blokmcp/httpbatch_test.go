package blokmcp

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Node runs a batch's requests together and writes each answer as it ends:
// the ping's event reaches the client while the list call still waits.
func TestABatchStreamsEachAnswerAsItEnds(t *testing.T) {
	release := make(chan struct{})
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-time.After(10 * time.Second):
		}
		_, _ = w.Write([]byte(`{"documents":[{"id":"a"}]}`))
	}))
	t.Cleanup(host.Close)
	list := host.URL + "/list"
	server, err := New(Options{Transport: Transport{Kind: "http", Listen: "127.0.0.1:0"}, Auth: Auth{Kind: "none"},
		Source:    &Source{Kind: "endpoint", URL: host.URL + "/docs", EndpointAuth: "Token t", List: &list},
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
	request, _ := http.NewRequest(http.MethodPost, front.URL+"/mcp", strings.NewReader(
		`[{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"blok_list_documents","arguments":{}}},{"jsonrpc":"2.0","id":2,"method":"ping"}]`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", acceptBoth)
	request.Header.Set("Mcp-Protocol-Version", "2025-03-26")
	lines := make(chan string, 16)
	// Do itself waits for the headers, which a held answer holds too.
	go func() {
		defer close(lines)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			return
		}
		defer response.Body.Close()
		reader := bufio.NewReader(response.Body)
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			if strings.HasPrefix(line, "data: ") {
				lines <- line
			}
		}
	}()
	select {
	case first := <-lines:
		if !strings.Contains(first, `"id":2`) {
			t.Fatalf("first event: %s", first)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no event before the list call ended")
	}
	close(release)
	if second := <-lines; !strings.Contains(second, `"id":1`) {
		t.Fatalf("second event: %s", second)
	}
}

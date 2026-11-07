package blokmcp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
)

// stdioClient runs ServeStdio over pipes and returns a line writer and
// reader for the client side.
func stdioClient(t *testing.T, server *Server, ctx context.Context) (func(string), *bufio.Reader, chan error) {
	t.Helper()
	clientIn, serverOut := io.Pipe()
	serverIn, clientOut := io.Pipe()
	done := make(chan error, 1)
	go func() { done <- server.ServeStdio(ctx, serverIn, serverOut) }()
	t.Cleanup(func() { _ = clientOut.Close(); _ = clientIn.Close() })
	send := func(line string) {
		if _, err := io.WriteString(clientOut, line+"\n"); err != nil {
			t.Fatal(err)
		}
	}
	reader := bufio.NewReader(clientIn)
	send(`{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}`)
	if _, err := reader.ReadString('\n'); err != nil {
		t.Fatal(err)
	}
	send(`{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	return send, reader, done
}

// A stop while nothing runs ends the stdio server at once, as Node's does.
func TestStdioStopsAtOnceWhenIdle(t *testing.T) {
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	ctx, stop := context.WithCancel(context.Background())
	_, _, done := stdioClient(t, server, ctx)
	stop()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("ServeStdio did not return after the stop")
	}
}

// Node's SDK sends no answer to a request the client cancelled.
func TestACancelledRequestGetsNoAnswer(t *testing.T) {
	tracker := newCallTracker()
	call := &jsonrpc.Request{ID: id(t, 77.0), Method: "tools/call"}
	tracker.read(call)
	tracker.read(&jsonrpc.Request{Method: "notifications/cancelled", Params: json.RawMessage(`{"requestId":77}`)})
	if tracker.answer(&jsonrpc.Response{ID: id(t, 77.0)}) {
		t.Fatal("the cancelled request was answered")
	}
	tracker.answered(&jsonrpc.Response{ID: id(t, 77.0)})
	other := &jsonrpc.Request{ID: id(t, "77"), Method: "tools/call"}
	tracker.read(other)
	if !tracker.answer(&jsonrpc.Response{ID: id(t, "77")}) {
		t.Fatal("a request with another id was not answered")
	}
	tracker.answered(&jsonrpc.Response{ID: id(t, "77")})
	// A cancel for a request that already ended changes nothing later.
	tracker.read(&jsonrpc.Request{Method: "notifications/cancelled", Params: json.RawMessage(`{"requestId":5}`)})
	tracker.read(&jsonrpc.Request{ID: id(t, 5.0), Method: "tools/call"})
	if !tracker.answer(&jsonrpc.Response{ID: id(t, 5.0)}) {
		t.Fatal("a stale cancel dropped a later answer")
	}
}

// A stop waits for a save in flight, and its answer still goes out.
func TestStdioStopDeliversTheAnswerInFlight(t *testing.T) {
	saving := make(chan struct{}, 1)
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPut {
			saving <- struct{}{}
			time.Sleep(300 * time.Millisecond)
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
	var opened struct {
		Result struct {
			StructuredContent struct {
				Handle string `json:"handle"`
			} `json:"structuredContent"`
		} `json:"result"`
	}
	_ = json.Unmarshal([]byte(line), &opened)
	send(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"blok_execute","arguments":{"handle":"` + opened.Result.StructuredContent.Handle + `","commands":[{"name":"doc.setTitle","args":{"title":"Kept"}}]}}}`)
	<-saving
	stop()
	line, err = reader.ReadString('\n')
	if err != nil || !strings.Contains(line, `"id":2`) || !strings.Contains(line, `"durable":true`) {
		t.Fatalf("answer %q, %v", line, err)
	}
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("ServeStdio did not return after the call")
	}
}

func id(t *testing.T, value any) jsonrpc.ID {
	t.Helper()
	made, err := jsonrpc.MakeID(value)
	if err != nil {
		t.Fatal(err)
	}
	return made
}

// A stop closes the handles first, so an open sent during the wait is
// answered "The server is shutting down." while the call in flight ends.
func TestAnOpenDuringTheStopIsRefused(t *testing.T) {
	loading := make(chan struct{}, 4)
	release := make(chan struct{})
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		loading <- struct{}{}
		<-release
		w.Header().Set("Content-Type", "application/json")
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
	send(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"blok_open","arguments":{"documentId":"a"}}}`)
	<-loading
	stop()
	time.Sleep(100 * time.Millisecond)
	send(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"blok_open","arguments":{"documentId":"b"}}}`)
	go func() {
		<-loading
	}()
	time.Sleep(300 * time.Millisecond)
	close(release)
	answers := map[string]string{}
	for range 2 {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(line, `"id":1`) {
			answers["1"] = line
		} else {
			answers["2"] = line
		}
	}
	if !strings.Contains(answers["2"], "The server is shutting down.") || !strings.Contains(answers["1"], "The server is shutting down.") {
		t.Fatalf("answers %v", answers)
	}
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("ServeStdio did not return")
	}
}

func pingLine(id int, size int) string {
	head := fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"method":"ping","params":{"x":"`, id)
	tail := `"}}`
	return head + strings.Repeat("a", size-len(head)-len(tail)) + tail
}

// Node's SDK holds at most 10 MiB of a message not yet ended: past that it
// closes the transport. Nothing is answered after, the big message
// included, and the process ends 0 when stdin closes. A line of 10 MiB less
// one byte, with its newline, still fits.
func TestStdioClosesPastTenMiBUnread(t *testing.T) {
	for _, c := range []struct {
		size     int
		answered bool
	}{{stdioMaxBuffer - 1, true}, {stdioMaxBuffer, false}} {
		server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}})
		if err != nil {
			t.Fatal(err)
		}
		clientIn, serverOut := io.Pipe()
		serverIn, clientOut := io.Pipe()
		done := make(chan error, 1)
		go func() { done <- server.ServeStdio(context.Background(), serverIn, serverOut) }()
		lines := make(chan string, 8)
		go func() {
			reader := bufio.NewReader(clientIn)
			for {
				line, err := reader.ReadString('\n')
				if err != nil {
					close(lines)
					return
				}
				lines <- line
			}
		}()
		write := func(line string) { _, _ = io.WriteString(clientOut, line+"\n") }
		write(`{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}`)
		<-lines
		write(`{"jsonrpc":"2.0","method":"notifications/initialized"}`)
		write(pingLine(1, c.size))
		write(`{"jsonrpc":"2.0","id":2,"method":"ping"}`)
		var got []string
		// A refused message is never answered, so its wait is a fixed time.
		timeout := time.After(time.Second)
		if c.answered {
			timeout = time.After(20 * time.Second)
		}
	collect:
		for c.answered && len(got) < 2 || !c.answered {
			select {
			case line, ok := <-lines:
				if !ok {
					break collect
				}
				got = append(got, line)
			case <-timeout:
				break collect
			}
		}
		if c.answered && len(got) != 2 || !c.answered && len(got) != 0 {
			t.Fatalf("%d bytes: answers %q", c.size, got)
		}
		_ = clientOut.Close()
		select {
		case err := <-done:
			if err != nil {
				t.Fatalf("%d bytes: %v", c.size, err)
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("%d bytes: ServeStdio did not end with stdin", c.size)
		}
		server.Close()
	}
}

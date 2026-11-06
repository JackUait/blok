package blokmcp

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
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
	other := &jsonrpc.Request{ID: id(t, "77"), Method: "tools/call"}
	tracker.read(other)
	if !tracker.answer(&jsonrpc.Response{ID: id(t, "77")}) {
		t.Fatal("a request with another id was not answered")
	}
	// A cancel for a request that already ended changes nothing later.
	tracker.read(&jsonrpc.Request{Method: "notifications/cancelled", Params: json.RawMessage(`{"requestId":5}`)})
	tracker.read(&jsonrpc.Request{ID: id(t, 5.0), Method: "tools/call"})
	if !tracker.answer(&jsonrpc.Response{ID: id(t, 5.0)}) {
		t.Fatal("a stale cancel dropped a later answer")
	}
}

// A stop waits for a call in flight, and its answer still goes out.
func TestStdioStopDeliversTheAnswerInFlight(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "doc.json"), []byte(`{"blocks":[]}`), 0o644)
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: dir}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	ctx, stop := context.WithCancel(context.Background())
	send, reader, done := stdioClient(t, server, ctx)
	send(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"blok_open","arguments":{"documentId":"doc"}}}`)
	stop()
	line, err := reader.ReadString('\n')
	if err != nil || !strings.Contains(line, `"id":1`) || !strings.Contains(line, "handle") {
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

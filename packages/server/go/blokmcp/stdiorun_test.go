package blokmcp

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func filesServer(t *testing.T) (*Server, string) {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "doc.json"), []byte(`{"title":"x","blocks":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: dir}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	return server, dir
}

func insertLine(id int, handle string, count int) string {
	commands := make([]string, count)
	for i := range commands {
		commands[i] = `{"name":"block.insert","args":{"type":"paragraph","id":"b` + strings.Repeat("x", i%3) + string(rune('a'+i%26)) + `","position":"end","data":{"text":"` + strings.Repeat("y", 2000) + `"}}}`
	}
	written, _ := json.Marshal(id)
	return `{"jsonrpc":"2.0","id":` + string(written) + `,"method":"tools/call","params":{"name":"blok_execute","arguments":{"handle":"` + handle + `","commands":[` + strings.Join(commands, ",") + `]}}}`
}

func openHandle(t *testing.T, send func(string), answer func(string) map[string]json.RawMessage) string {
	t.Helper()
	send(`{"jsonrpc":"2.0","id":"open","method":"tools/call","params":{"name":"blok_open","arguments":{"documentId":"doc","write":true}}}`)
	var opened struct {
		StructuredContent struct{ Handle string } `json:"structuredContent"`
	}
	if err := json.Unmarshal(answer(`"open"`)["result"], &opened); err != nil || opened.StructuredContent.Handle == "" {
		t.Fatalf("open: %s", answer(`"open"`)["error"])
	}
	return opened.StructuredContent.Handle
}

func savedBlocks(t *testing.T, dir string) int {
	t.Helper()
	saved, err := os.ReadFile(filepath.Join(dir, "doc.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct{ Blocks []json.RawMessage }
	if err := json.Unmarshal(saved, &doc); err != nil {
		t.Fatal(err)
	}
	return len(doc.Blocks)
}

// A write read just before stdin ends runs and is saved, as in Node; its
// answer is dropped.
func TestAWriteReadBeforeStdinEndsIsSaved(t *testing.T) {
	server, dir := filesServer(t)
	send, answer, end := rawStdio(t, server)
	send(initializeLine("init", "2025-11-25", "t"))
	answer(`"init"`)
	handle := openHandle(t, send, answer)
	send(insertLine(10, handle, 1))
	end()
	if got := savedBlocks(t, dir); got != 1 {
		t.Fatalf("saved %d blocks, want 1", got)
	}
}

// A cancelled blok_execute still runs and is saved, with no answer, as in
// Node; the cancel reaches only an open.
func TestACancelledExecuteIsAppliedWithNoAnswer(t *testing.T) {
	server, dir := filesServer(t)
	send, answer, has, end := rawStdioPeek(t, server)
	send(initializeLine("init", "2025-11-25", "t"))
	answer(`"init"`)
	handle := openHandle(t, send, answer)
	// One write: the cancel is read before the call can start.
	send(insertLine(10, handle, 20) + "\n" + `{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":10}}`)
	send(`{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"blok_read","arguments":{"handle":"` + handle + `"}}}`)
	answer("11")
	if got := savedBlocks(t, dir); got != 20 {
		t.Fatalf("saved %d blocks, want 20", got)
	}
	time.Sleep(200 * time.Millisecond)
	if has("10") {
		t.Fatal("the cancelled call was answered")
	}
	end()
}

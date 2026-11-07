package blokmcp

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// rawStdio serves stdio with no initialize sent; answers are by id.
func rawStdio(t *testing.T, server *Server) (func(string), func(id string) map[string]json.RawMessage, func()) {
	send, answer, _, end := rawStdioPeek(t, server)
	return send, answer, end
}

// rawStdioPeek is rawStdio plus a check that does not wait.
func rawStdioPeek(t *testing.T, server *Server) (func(string), func(id string) map[string]json.RawMessage, func(id string) bool, func()) {
	t.Helper()
	clientIn, serverOut := io.Pipe()
	serverIn, clientOut := io.Pipe()
	done := make(chan error, 1)
	go func() { done <- server.ServeStdio(context.Background(), serverIn, serverOut) }()
	t.Cleanup(func() { _ = clientIn.Close() })
	var mu sync.Mutex
	answers := map[string]map[string]json.RawMessage{}
	arrived := make(chan struct{}, 100)
	lines := bufio.NewReader(clientIn)
	go func() {
		for {
			line, err := lines.ReadString('\n')
			if err != nil {
				return
			}
			var members map[string]json.RawMessage
			_ = json.Unmarshal([]byte(line), &members)
			mu.Lock()
			answers[string(members["id"])] = members
			mu.Unlock()
			arrived <- struct{}{}
		}
	}()
	send := func(line string) {
		if _, err := io.WriteString(clientOut, line+"\n"); err != nil {
			t.Fatal(err)
		}
	}
	answer := func(id string) map[string]json.RawMessage {
		t.Helper()
		deadline := time.After(10 * time.Second)
		for {
			mu.Lock()
			found, ok := answers[id]
			mu.Unlock()
			if ok {
				return found
			}
			select {
			case <-arrived:
			case <-deadline:
				t.Fatalf("no answer to %s", id)
			}
		}
	}
	has := func(id string) bool {
		mu.Lock()
		defer mu.Unlock()
		_, ok := answers[id]
		return ok
	}
	end := func() {
		_ = clientOut.Close()
		<-done
	}
	return send, answer, has, end
}

func initializeLine(id, version, name string) string {
	return `{"jsonrpc":"2.0","id":"` + id + `","method":"initialize","params":{"protocolVersion":"` + version + `","capabilities":{},"clientInfo":{"name":"` + name + `","version":"1"}}}`
}

// Node answers a call sent before initialize, and every initialize; the
// latest one names the client.
func TestStdioAnswersCallsBeforeInitializeAndEveryInitialize(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "doc.json"), []byte(`{"title":"x","blocks":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: dir}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	send, answer, end := rawStdio(t, server)

	send(`{"jsonrpc":"2.0","id":"list","method":"tools/list"}`)
	if _, ok := answer(`"list"`)["result"]; !ok {
		t.Fatalf("tools/list before initialize: %s", answer(`"list"`)["error"])
	}
	insert := func(id, block string) {
		t.Helper()
		send(`{"jsonrpc":"2.0","id":"open` + id + `","method":"tools/call","params":{"name":"blok_open","arguments":{"documentId":"doc","write":true}}}`)
		var opened struct {
			StructuredContent struct{ Handle string } `json:"structuredContent"`
		}
		if err := json.Unmarshal(answer(`"open` + id + `"`)["result"], &opened); err != nil || opened.StructuredContent.Handle == "" {
			t.Fatalf("open %s: %s", id, answer(`"open` + id + `"`)["error"])
		}
		send(`{"jsonrpc":"2.0","id":"run` + id + `","method":"tools/call","params":{"name":"blok_execute","arguments":{"handle":"` + opened.StructuredContent.Handle +
			`","commands":[{"name":"block.insert","args":{"type":"paragraph","id":"` + block + `","position":"end","data":{"text":"x"}}}]}}}`)
		if _, ok := answer(`"run` + id + `"`)["result"]; !ok {
			t.Fatalf("execute %s: %s", id, answer(`"run` + id + `"`)["error"])
		}
	}
	insert("1", "before")

	versions := map[string]string{"i1": "2025-06-18", "i2": "1999-01-01", "i3": "2024-10-07"}
	want := map[string]string{"i1": "2025-06-18", "i2": "2025-11-25", "i3": "2024-10-07"}
	for _, id := range []string{"i1", "i2", "i3"} {
		send(initializeLine(id, versions[id], "client-"+id))
		var result struct {
			ProtocolVersion string `json:"protocolVersion"`
			ServerInfo      struct{ Name string }
		}
		if err := json.Unmarshal(answer(`"` + id + `"`)["result"], &result); err != nil || result.ProtocolVersion != want[id] || result.ServerInfo.Name != "blok-mcp" {
			t.Fatalf("%s answered %s %s", id, answer(`"` + id + `"`)["result"], answer(`"` + id + `"`)["error"])
		}
	}
	insert("2", "after")
	end()

	saved, err := os.ReadFile(filepath.Join(dir, "doc.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Blocks []struct {
			ID          string `json:"id"`
			CreatedWith string `json:"createdWith"`
		} `json:"blocks"`
	}
	if err := json.Unmarshal(saved, &doc); err != nil {
		t.Fatal(err)
	}
	got := []string{}
	for _, block := range doc.Blocks {
		got = append(got, block.ID+"="+block.CreatedWith)
	}
	if strings.Join(got, " ") != "before=agent:local:mcp-client after=agent:local:client-i3" {
		t.Fatalf("blocks: %v", got)
	}
}

// An initialize right behind the first call waits for the SDK to take its
// own, so it is answered, not refused as a second.
func TestStdioInitializeRightAfterAFirstCallIsAnswered(t *testing.T) {
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	send, answer, end := rawStdio(t, server)
	defer end()
	send(`{"jsonrpc":"2.0","id":"list","method":"tools/list"}` + "\n" + initializeLine("i1", "2025-06-18", "c") + "\n" + initializeLine("i2", "2025-03-26", "c"))
	for _, id := range []string{`"i1"`, `"i2"`, `"list"`} {
		if _, ok := answer(id)["result"]; !ok {
			t.Fatalf("%s: %s", id, answer(id)["error"])
		}
	}
}

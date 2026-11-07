package blokmcp

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A lone UTF-16 surrogate, in the document or in an argument, becomes
// U+FFFD and never fails the call (the policy every port follows).
func TestALoneSurrogateBecomesTheReplacementCharacter(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "doc.json"), []byte(`{"title":"x","blocks":[{"id":"p1","type":"paragraph","data":{"text":"a\ud800b"}}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: dir}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	send, answer, end := rawStdio(t, server)
	handle := openHandle(t, send, answer)
	send(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"blok_execute","arguments":{"handle":"` + handle +
		`","commands":[{"name":"block.insert","args":{"type":"paragraph","id":"n1","position":"end","data":{"text":"c\udc00d"}}}]}}}`)
	var result struct {
		StructuredContent struct{ OK bool } `json:"structuredContent"`
	}
	if err := json.Unmarshal(answer("2")["result"], &result); err != nil || !result.StructuredContent.OK {
		t.Fatalf("execute: %s %s", answer("2")["result"], answer("2")["error"])
	}
	end()
	saved, err := os.ReadFile(filepath.Join(dir, "doc.json"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(saved)
	if !strings.Contains(text, "a�b") || !strings.Contains(text, "c�d") || strings.Contains(text, `\ud`) {
		t.Fatalf("saved: %s", text)
	}
}

// An id with a lone surrogate is answered under U+FFFD, written as UTF-8.
func TestAnIdWithALoneSurrogateIsAnsweredAsTheReplacementCharacter(t *testing.T) {
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: t.TempDir()}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	send, answer, end := rawStdio(t, server)
	defer end()
	send(`{"jsonrpc":"2.0","id":"x\udc00","method":"ping"}`)
	if got := answer("\"x�\""); got["result"] == nil {
		t.Fatalf("ping: %v", got)
	}
}

package blokmcp

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Node reads the client's capabilities from its latest initialize: a
// client that gains elicitation on a later initialize is asked.
func TestAClientThatGainsElicitationOnALaterInitializeIsAsked(t *testing.T) {
	dir := t.TempDir()
	doc := `{"blocks":[{"id":"db","type":"database","content":[],"data":{"title":"Payroll","schema":[{"id":"t","name":"Name","type":"title","position":"a0","databaseLocked":true}],"views":[{"id":"v","name":"Table","type":"table","position":"a0","sorts":[],"filters":[],"visibleProperties":[]}],"activeViewId":"v"}}]}`
	if err := os.WriteFile(filepath.Join(dir, "doc.json"), []byte(doc), 0o600); err != nil {
		t.Fatal(err)
	}
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: dir}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	send, answer, end := rawStdio(t, server)
	defer end()
	send(`{"jsonrpc":"2.0","id":"i1","method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"Desktop","version":"1"}}}`)
	answer(`"i1"`)
	send(`{"jsonrpc":"2.0","id":"i2","method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{"elicitation":{}},"clientInfo":{"name":"Desktop","version":"1"}}}`)
	answer(`"i2"`)
	send(`{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	send(`{"jsonrpc":"2.0","id":"o","method":"tools/call","params":{"name":"blok_open","arguments":{"documentId":"doc","write":true}}}`)
	var opened struct {
		StructuredContent struct{ Handle string } `json:"structuredContent"`
	}
	if err := json.Unmarshal(answer(`"o"`)["result"], &opened); err != nil {
		t.Fatal(err)
	}
	send(`{"jsonrpc":"2.0","id":"x","method":"tools/call","params":{"name":"blok_execute","arguments":{"handle":"` + opened.StructuredContent.Handle +
		`","commands":[{"name":"database.setLock","args":{"id":"db","locked":false}}]}}}`)
	asked := answer("1")
	if string(asked["method"]) != `"elicitation/create"` {
		t.Fatalf("no elicitation/create: %v", asked)
	}
	send(`{"jsonrpc":"2.0","id":1,"result":{"action":"accept","content":{"unlock":true}}}`)
	result := string(answer(`"x"`)["result"])
	if !strings.Contains(result, `"ok":true`) {
		t.Fatalf("execute: %s", result)
	}
}

package blokmcp

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// zod's words for a tools/call Node's SDK refuses.
func zodRefusal(issues ...string) string {
	return "Invalid tools/call request: [\n" + strings.Join(issues, ",\n") + "\n]"
}

func wantIssue(expected, field, received string) string {
	path := `"params"`
	if field != "" {
		path += ",\n      \"" + field + `"`
	}
	return "  {\n    \"expected\": \"" + expected + "\",\n    \"code\": \"invalid_type\",\n    \"path\": [\n      " + path +
		"\n    ],\n    \"message\": \"Invalid input: expected " + expected + ", received " + received + "\"\n  }"
}

// Node's SDK drops a line whose params or params._meta is not an object,
// and answers a bad tools/call shape -32602 in zod's words.
func TestStdioRefusesToolsCallShapesAsNodesSDK(t *testing.T) {
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	send, reader, _ := stdioClient(t, server, ctx)
	for _, line := range []string{
		`{"jsonrpc":"2.0","id":101,"method":"tools/call","params":"x"}`,
		`{"jsonrpc":"2.0","id":201,"method":"tools/call","params":{"name":"blok_read","arguments":{"handle":"h"},"_meta":"x"}}`,
		`{"jsonrpc":"2.0","id":202,"method":"tools/call","params":null}`,
		`{"jsonrpc":"2.0","method":"notifications/cancelled","params":"x"}`,
	} {
		send(line)
	}
	cases := []struct {
		line, message string
	}{
		{`{"jsonrpc":"2.0","id":203,"method":"tools/call"}`, zodRefusal(wantIssue("object", "", "undefined"))},
		{`{"jsonrpc":"2.0","id":204,"method":"tools/call","params":{"arguments":{}}}`, zodRefusal(wantIssue("string", "name", "undefined"))},
		{`{"jsonrpc":"2.0","id":205,"method":"tools/call","params":{"name":5,"arguments":"x"}}`, zodRefusal(wantIssue("string", "name", "number"), wantIssue("record", "arguments", "string"))},
		{`{"jsonrpc":"2.0","id":206,"method":"tools/call","params":{"name":"blok_read","arguments":null}}`, zodRefusal(wantIssue("record", "arguments", "null"))},
		{`{"jsonrpc":"2.0","id":207,"method":"tools/call","params":{"name":"blok_read","arguments":[1]}}`, zodRefusal(wantIssue("record", "arguments", "array"))},
	}
	for _, c := range cases {
		send(c.line)
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		var answer struct {
			ID    json.RawMessage `json:"id"`
			Error struct {
				Code    int    `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal([]byte(line), &answer)
		var sent struct {
			ID json.RawMessage `json:"id"`
		}
		_ = json.Unmarshal([]byte(c.line), &sent)
		if string(answer.ID) != string(sent.ID) || answer.Error.Code != -32602 || answer.Error.Message != c.message {
			t.Fatalf("%s answered %s", c.line, line)
		}
	}
	send(`{"jsonrpc":"2.0","id":9,"method":"ping"}`)
	if line, _ := reader.ReadString('\n'); line != `{"jsonrpc":"2.0","id":9,"result":{}}`+"\n" {
		t.Fatalf("after the refusals: %q", line)
	}
}

// Over HTTP Node's SDK answers such a body 400 -32600, or -32602 in zod's words.
func TestHTTPRefusesToolsCallShapesAsNodesSDK(t *testing.T) {
	front, port := testHTTPServer(t)
	header := map[string]string{"Host": "localhost:" + port, "Content-Type": "application/json",
		"Accept": "application/json, text/event-stream", "Mcp-Protocol-Version": "2025-11-25"}
	notAMessage := `"error":{"code":-32600,"message":"Bad Request: the request body is not a valid JSON-RPC message"}`
	for body, want := range map[string]string{
		`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":"x"}`:                                             `"id":1`,
		`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"blok_read","arguments":{},"_meta":"x"}}`: `"id":2`,
		`{"jsonrpc":"2.0","method":"notifications/cancelled","params":"x"}`:                                       `"id":null`,
	} {
		response, text := send(t, http.MethodPost, front.URL+"/mcp", header, body)
		if response.StatusCode != http.StatusBadRequest || response.Header.Get("Content-Type") != "application/json" ||
			!strings.Contains(text, notAMessage) || !strings.Contains(text, want) {
			t.Errorf("%s: %d %q", body, response.StatusCode, text)
		}
	}
	response, text := send(t, http.MethodPost, front.URL+"/mcp", header, `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"blok_read","arguments":"x"}}`)
	message, _ := json.Marshal(zodRefusal(wantIssue("record", "arguments", "string")))
	if response.StatusCode != http.StatusOK || !strings.HasPrefix(response.Header.Get("Content-Type"), "text/event-stream") ||
		!strings.Contains(text, `"id":3`) || !strings.Contains(text, `"code":-32602`) || !strings.Contains(text, string(message)) {
		t.Fatalf("bad arguments: %d %q", response.StatusCode, text)
	}
}

// Node fails a --manifest that is a folder with EISDIR, exit code 1.
func TestAManifestThatIsAFolderFailsAsNodeReadsIt(t *testing.T) {
	dir := t.TempDir()
	_, err := configFile(bundle{runtime: fakeRuntime{}}, "manifest", dir)
	if _, isConfig := err.(*configError); err == nil || isConfig || !strings.HasPrefix(err.Error(), "EISDIR: ") {
		t.Fatalf("got %T %v", err, err)
	}
}

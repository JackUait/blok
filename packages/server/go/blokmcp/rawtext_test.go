package blokmcp

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The text the model reads holds U+2028 and U+2029 as they are, as Node's
// JSON.stringify writes them; Go's encoder escapes them.
func TestListedTitlesKeepLineSeparatorsRaw(t *testing.T) {
	dir := t.TempDir()
	title := "a\u2028b\u2029c<&>"
	doc, _ := json.Marshal(map[string]any{"title": title, "blocks": []any{}})
	if err := os.WriteFile(filepath.Join(dir, "doc.json"), doc, 0o600); err != nil {
		t.Fatal(err)
	}
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: dir}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	send, answer, end := rawStdio(t, server)
	defer end()
	send(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"blok_list_documents","arguments":{}}}`)
	var result struct {
		Content []struct{ Text string } `json:"content"`
	}
	if err := json.Unmarshal(answer("1")["result"], &result); err != nil || len(result.Content) != 1 {
		t.Fatalf("answer: %s", answer("1")["result"])
	}
	if !strings.Contains(result.Content[0].Text, `"title":"`+title+`"`) {
		t.Fatalf("text: %q", result.Content[0].Text)
	}
}

func TestMarshalWritesLineSeparatorsRaw(t *testing.T) {
	written, _ := marshal(map[string]string{"a": "x\u2028y\u2029z", "b": "\\u2028", "c": "\\\u2028"})
	want := "{\"a\":\"x\u2028y\u2029z\",\"b\":\"\\\\u2028\",\"c\":\"\\\\\u2028\"}"
	if string(written) != want {
		t.Fatalf("got %s, want %s", written, want)
	}
}

// delivery's keys come in Node's order.
func TestDeliveryKeysComeInNodesOrder(t *testing.T) {
	server, _ := filesServer(t)
	send, answer, end := rawStdio(t, server)
	defer end()
	handle := openHandle(t, send, answer)
	send(insertLine(2, handle, 1))
	var result struct {
		Content []struct{ Text string } `json:"content"`
	}
	if err := json.Unmarshal(answer("2")["result"], &result); err != nil || len(result.Content) != 1 {
		t.Fatalf("answer: %s", answer("2")["result"])
	}
	if !strings.Contains(result.Content[0].Text, `"delivery":{"durable":true,"pending":false,"serverSequence":null,"savedVersion":"`) {
		t.Fatalf("text: %s", result.Content[0].Text)
	}
}

// A tools/call answer goes out as Node writes it: content items as
// {"type","text"}, then structuredContent, then isError, and no \u escapes
// for <, >, & or the line separators.
func TestToolAnswerWireBytesAreNodes(t *testing.T) {
	dir := t.TempDir()
	doc, _ := marshal(map[string]any{"title": "a b<&>\"é", "blocks": []any{}})
	if err := os.WriteFile(filepath.Join(dir, "doc.json"), doc, 0o600); err != nil {
		t.Fatal(err)
	}
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: dir}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	clientIn, serverOut := io.Pipe()
	serverIn, clientOut := io.Pipe()
	go func() { _ = server.ServeStdio(context.Background(), serverIn, serverOut) }()
	t.Cleanup(func() { _ = clientOut.Close(); _ = clientIn.Close() })
	go func() {
		_, _ = io.WriteString(clientOut, `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"blok_list_documents","arguments":{}}}`+"\n")
	}()
	line, err := bufio.NewReader(clientIn).ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	// Node's bytes for the same call (blok-mcp.mjs, 2025-11-25).
	want := `"result":{"content":[{"type":"text","text":"{\"documents\":[{\"id\":\"doc\",\"title\":\"a` + " " + `b<&>\\\"é\",\"live\":false}],\"nextCursor\":null,\"supported\":true}"}],"structuredContent":{"documents":[{"id":"doc","title":"a` + " " + `b<&>\"é","live":false}],"nextCursor":null,"supported":true},"isError":false}`
	if !strings.Contains(line, want) {
		t.Fatalf("got  %s\nwant %s", line, want)
	}
}

// Over HTTP too, as an event (2025) and as one JSON body (2026).
func TestToolAnswerHTTPBytesAreNodes(t *testing.T) {
	dir := t.TempDir()
	doc, _ := marshal(map[string]any{"title": "a b<&>\"é", "blocks": []any{}})
	if err := os.WriteFile(filepath.Join(dir, "doc.json"), doc, 0o600); err != nil {
		t.Fatal(err)
	}
	server, err := New(Options{Transport: Transport{Kind: "http", Listen: "127.0.0.1:0"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: dir},
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
	header := map[string]string{"Host": front.Listener.Addr().String(), "Accept": acceptBoth, "Content-Type": "application/json", "Mcp-Protocol-Version": "2025-11-25"}
	_, body := sendRaw(t, front, header, `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"blok_list_documents","arguments":{}}}`)
	want := `"result":{"content":[{"type":"text","text":"{\"documents\":[{\"id\":\"doc\",\"title\":\"a` + " " + `b<&>\\\"é\",\"live\":false}],\"nextCursor\":null,\"supported\":true}"}],"structuredContent":{"documents":[{"id":"doc","title":"a` + " " + `b<&>\"é","live":false}],"nextCursor":null,"supported":true},"isError":false}`
	if !strings.Contains(body, want) {
		t.Errorf("2025 got  %s\nwant %s", body, want)
	}
	header["Mcp-Protocol-Version"] = "2026-07-28"
	header["Mcp-Method"] = "tools/call"
	header["Mcp-Name"] = "blok_list_documents"
	_, body = sendRaw(t, front, header, `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"blok_list_documents","arguments":{},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"x","version":"1"},"io.modelcontextprotocol/clientCapabilities":{}}}}`)
	if !strings.Contains(body, strings.TrimSuffix(want, "}")+`,"resultType":"complete","_meta":`) {
		t.Errorf("2026 got  %s\nwant %s", body, want)
	}
}

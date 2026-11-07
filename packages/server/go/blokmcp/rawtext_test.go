package blokmcp

import (
	"encoding/json"
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

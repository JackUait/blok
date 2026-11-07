package blokmcp

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"testing"
	"time"
)

// Node's stdio drops a line that is not one JSON-RPC message of its
// schema, and keeps reading. Answered ids come from a Node run.
func TestStdioDropsLinesNodeDropsAndKeepsServing(t *testing.T) {
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	send, reader, done := stdioClient(t, server, ctx)
	lines := []string{
		`42`,
		`{"jsonrpc":"2.0",`,
		"\ufeff" + `{"jsonrpc":"2.0","id":"bom","method":"ping"}`,
		`{"id":"noversion","method":"ping"}`,
		`{"jsonrpc":"1.0","id":"v1","method":"ping"}`,
		`{"jsonrpc":"2.0","id":5,"method":5}`,
		`{"jsonrpc":"2.0","id":1.5,"method":"ping"}`,
		`{"jsonrpc":"2.0","id":9007199254740993,"method":"ping"}`,
		`{"jsonrpc":"2.0","id":null,"method":"ping"}`,
		`[{"jsonrpc":"2.0","id":"batch","method":"ping"}]`,
		`[]`,
		`{"jsonrpc":"2.0","id":"extra","method":"ping","extra":1}`,
		`{"jsonrpc":"2.0","id":"pt","method":"ping","params":{"_meta":{"progressToken":1.5}}}`,
		`{"jsonrpc":"2.0","id":"task","method":"ping","params":{"_meta":{"io.modelcontextprotocol/related-task":{"taskId":5}}}}`,
		`{"jsonrpc":"2.0","id":"two","method":"ping"}{"jsonrpc":"2.0","id":"three","method":"ping"}`,
		`{"jsonrpc":"2.0","id":"nometa","method":"ping","params":{"_meta":null}}`,
		`{"jsonrpc":"2.0","id":"nomethod"}`,
		``,
		`   `,
		`{"jsonrpc":"2.0","id":9007199254740991,"method":"ping"}`,
		`{"jsonrpc":"2.0","id":1e3,"method":"ping"}`,
		`{"jsonrpc":"2.0","id":-3,"method":"ping"}`,
		`  {"jsonrpc":"2.0","id":"spaced","method":"ping"}  ` + "\r",
		`{"jsonrpc":"2.0","id":"pts","method":"ping","params":{"_meta":{"progressToken":"t"}}}`,
		`{"jsonrpc":"2.0","id":"last","method":"ping"}`,
	}
	for _, line := range lines {
		send(line)
	}
	// Calls answer out of order: the sentinel goes once the rest are done.
	time.Sleep(500 * time.Millisecond)
	send(`{"jsonrpc":"2.0","id":"sentinel","method":"ping"}`)
	var got []string
	for len(got) == 0 || got[len(got)-1] != `"sentinel"` {
		readLine := make(chan string, 1)
		go func() {
			line, _ := reader.ReadString('\n')
			readLine <- line
		}()
		select {
		case line := <-readLine:
			if line == "" {
				t.Fatalf("the server stopped; answered %v", got)
			}
			answer := struct {
				ID any `json:"id"`
			}{}
			if err := jsonUnmarshalString(line, &answer); err != nil {
				t.Fatalf("not one message: %q", line)
			}
			got = append(got, jsonString(answer.ID))
		case <-time.After(5 * time.Second):
			t.Fatalf("no answer after %v", got)
		}
	}
	want := []string{`"last"`, `"pts"`, `"sentinel"`, `"spaced"`, "-3", "1000", "9007199254740991"}
	sort.Strings(got)
	if strings.Join(got, " ") != strings.Join(want, " ") {
		t.Fatalf("answered %v, want %v", got, want)
	}
	select {
	case err := <-done:
		t.Fatalf("the server ended: %v", err)
	default:
	}
}

func jsonUnmarshalString(text string, out any) error { return json.Unmarshal([]byte(text), out) }

func jsonString(value any) string {
	written, _ := json.Marshal(value)
	return string(written)
}

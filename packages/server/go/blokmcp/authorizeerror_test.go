package blokmcp

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// An authorize hook that fails does not deny: the call fails with -32603
// and the hook's text, as Node's does.
func TestAnAuthorizeErrorFailsTheCallWithItsText(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "doc.json"), []byte(`{"blocks":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: dir},
		Authorize: func(context.Context, string, string, bool) (bool, error) {
			return false, errors.New("the policy service is down")
		}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	send, answer, end := rawStdio(t, server)
	defer end()
	send(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"blok_open","arguments":{"documentId":"doc"}}}`)
	var failure struct {
		Code    int64  `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(answer("1")["error"], &failure); err != nil || failure.Code != -32603 || failure.Message != "the policy service is down" {
		t.Fatalf("answered %s %s", answer("1")["result"], answer("1")["error"])
	}
}

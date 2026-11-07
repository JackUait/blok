package blokmcp

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// answerFails runs the real engine but fails the answer of a saved batch.
type answerFails struct{ real invoker }

func (a answerFails) Invoke(ctx context.Context, op, input string, timeout *time.Duration) (string, error) {
	if op == "mcpExecuteAnswer" && strings.Contains(input, `"durable":true`) {
		return "", errors.New("answer failed")
	}
	return a.real.Invoke(ctx, op, input, timeout)
}

func storedWrite(t *testing.T, runtime invoker) (*Server, string, func(title string) (*outcome, error)) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "doc.json")
	_ = os.WriteFile(path, []byte(`{"blocks":[]}`), 0o644)
	server, err := newServer(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: dir}}, runtime)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	ctx := context.Background()
	who, err := server.actorFor(ctx, "alice", nil)
	if err != nil {
		t.Fatal(err)
	}
	opened, err := server.dispatch(ctx, &toolCall{name: "blok_open", arguments: json.RawMessage(`{"documentId":"doc","write":true}`), caller: who})
	if err != nil {
		t.Fatal(err)
	}
	handle, _ := json.Marshal(structured(t, opened.answer)["handle"])
	return server, path, func(title string) (*outcome, error) {
		return server.dispatch(ctx, &toolCall{name: "blok_execute", caller: who,
			arguments: json.RawMessage(`{"handle":` + string(handle) + `,"commands":[{"name":"doc.setTitle","args":{"title":"` + title + `"}}]}`)})
	}
}

// Node builds the answer before it saves, so a call that fails to answer
// saved nothing, and a retry cannot apply the batch twice.
func TestABatchWhoseAnswerFailsIsNotSaved(t *testing.T) {
	pool, err := newPool(1)
	if err != nil {
		t.Fatal(err)
	}
	_, path, execute := storedWrite(t, answerFails{pool})
	if _, err := execute("Kept"); err == nil {
		t.Fatal("the answer did not fail")
	}
	written, _ := os.ReadFile(path)
	if string(written) != `{"blocks":[]}` {
		t.Fatalf("saved after a failed answer: %s", written)
	}
}

func TestASavedBatchAnswersWithItsSavedVersion(t *testing.T) {
	pool, err := newPool(1)
	if err != nil {
		t.Fatal(err)
	}
	_, path, execute := storedWrite(t, pool)
	ran, err := execute("Kept")
	if err != nil {
		t.Fatal(err)
	}
	delivery, _ := structured(t, ran.answer)["delivery"].(map[string]any)
	written, _ := os.ReadFile(path)
	if delivery["durable"] != true || !strings.Contains(string(written), `"title": "Kept"`) || strings.Contains(string(ran.answer), savedVersionStandIn) {
		t.Fatalf("answer %s, file %s", ran.answer, written)
	}
}

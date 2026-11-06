package blokmcp

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Node ignores a cancel once a batch runs: it saves what it planned. A
// client that hangs up mid-call must not lose the edit.
func TestACancelledCallStillSavesItsBatch(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "doc.json")
	_ = os.WriteFile(path, []byte(`{"blocks":[]}`), 0o644)
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: dir}})
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
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	ran, err := server.dispatch(cancelled, &toolCall{name: "blok_execute", caller: who,
		arguments: json.RawMessage(`{"handle":` + string(handle) + `,"commands":[{"name":"doc.setTitle","args":{"title":"Kept"}}]}`)})
	if err != nil {
		t.Fatal(err)
	}
	answer := structured(t, ran.answer)
	delivery, _ := answer["delivery"].(map[string]any)
	written, _ := os.ReadFile(path)
	if delivery["durable"] != true || !strings.Contains(string(written), `"title": "Kept"`) {
		t.Fatalf("answer %v, file %s", answer, written)
	}
}

// Under --page-titles page-map with a source, a page block gets its own
// new document, made before the batch runs.
func TestAnInsertedPageGetsItsOwnDocument(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "doc.json"), []byte(`{"blocks":[]}`), 0o644)
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: dir}, PageTitles: "page-map"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	ctx := context.Background()
	who, _ := server.actorFor(ctx, "alice", nil)
	opened, err := server.dispatch(ctx, &toolCall{name: "blok_open", arguments: json.RawMessage(`{"documentId":"doc","write":true}`), caller: who})
	if err != nil {
		t.Fatal(err)
	}
	handle, _ := json.Marshal(structured(t, opened.answer)["handle"])
	ran, err := server.dispatch(ctx, &toolCall{name: "blok_execute", caller: who,
		arguments: json.RawMessage(`{"handle":` + string(handle) + `,"commands":[{"name":"block.insert","args":{"type":"page"}}]}`)})
	if err != nil {
		t.Fatal(err)
	}
	answer := structured(t, ran.answer)
	entries, _ := os.ReadDir(dir)
	if answer["ok"] != true || len(entries) != 2 {
		t.Fatalf("answer %v, %d files", answer, len(entries))
	}
}

const lockedDatabase = `{"blocks":[{"id":"db","type":"database","content":[],"data":{"title":"Payroll","activeViewId":"v",` +
	`"schema":[{"id":"t","name":"Name","type":"title","position":"a0","databaseLocked":true}],` +
	`"views":[{"id":"v","name":"Table","type":"table","position":"a0","sorts":[],"filters":[],"visibleProperties":[]}]}}]}`

func pageMapServer(t *testing.T, document string) (*Server, string, *caller, string) {
	t.Helper()
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "doc.json"), []byte(document), 0o644)
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: dir}, PageTitles: "page-map"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	who, _ := server.actorFor(context.Background(), "alice", nil)
	opened, err := server.dispatch(context.Background(), &toolCall{name: "blok_open", arguments: json.RawMessage(`{"documentId":"doc","write":true}`), caller: who})
	if err != nil {
		t.Fatal(err)
	}
	handle, _ := json.Marshal(structured(t, opened.answer)["handle"])
	return server, dir, who, string(handle)
}

func fileCount(t *testing.T, dir string) int {
	t.Helper()
	entries, _ := os.ReadDir(dir)
	return len(entries)
}

// Node plans the whole batch before it makes a page's document, so a batch
// that asks first or fails makes none.
func TestABatchThatAsksOrFailsMakesNoPage(t *testing.T) {
	unlock := `{"name":"database.setLock","args":{"id":"db","locked":false}}`
	server, dir, who, handle := pageMapServer(t, lockedDatabase)
	approval := map[string]any{"capabilities": map[string]any{"elicitation": map[string]any{}}, "clientName": "c"}
	asked, err := server.dispatch(context.Background(), &toolCall{name: "blok_execute", caller: who, approval: approval,
		arguments: json.RawMessage(`{"handle":` + handle + `,"commands":[{"name":"block.insert","args":{"type":"page"}},` + unlock + `]}`)})
	if err != nil || asked.ask == nil || fileCount(t, dir) != 1 {
		t.Fatalf("ask %v, err %v, %d files", asked, err, fileCount(t, dir))
	}
	failed, err := server.dispatch(context.Background(), &toolCall{name: "blok_execute", caller: who,
		arguments: json.RawMessage(`{"handle":` + handle + `,"commands":[{"name":"block.insert","args":{"type":"page"}},{"name":"block.delete","args":{"id":"nope"}}]}`)})
	if err != nil || structured(t, failed.answer)["ok"] != false || fileCount(t, dir) != 1 {
		t.Fatalf("failed %v, err %v, %d files", failed, err, fileCount(t, dir))
	}
	reply := map[string]json.RawMessage{asked.ask.Key: json.RawMessage(`{"action":"accept","content":{"unlock":true}}`)}
	approval["replies"] = reply
	approved, err := server.dispatch(context.Background(), &toolCall{name: "blok_execute", caller: who, approval: approval,
		arguments: json.RawMessage(`{"handle":` + handle + `,"commands":[{"name":"block.insert","args":{"type":"page"}},` + unlock + `]}`)})
	if err != nil || structured(t, approved.answer)["ok"] != true || fileCount(t, dir) != 2 {
		t.Fatalf("approved %v, err %v, %d files", approved, err, fileCount(t, dir))
	}
}

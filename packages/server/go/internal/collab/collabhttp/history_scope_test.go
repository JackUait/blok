package collabhttp

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

// Twins of C# HistoryEndpointTests.Scope: databases=keep|restore.

const tableData = `{ "schema": [{ "id": "t", "type": "title" }], "views": [] }`

func TestOnlyOneExactKeepKeepsDatabasesAndTheShippedRestoreIgnoresAnyOtherValue(t *testing.T) {
	for _, query := range []string{"?databases=", "?databases=Keep", "?databases=none", "?databases=keep&databases=keep"} {
		history := startHooked(t, nil, 0)
		lineage := history.open(t)
		history.edit(t, "database", `{ "ops": [ { "op": "insert", "id": "d", "block": { "type": "database", "data": `+tableData+` } } ] }`)
		// The shipped route ignored unknown values: anything but one exact keep is a plain restore.
		if a := history.send(t, "POST", "/history/"+lineage+"/0/restore"+query, "other", "", ""); a.status != http.StatusNoContent {
			t.Errorf("restore %s = %d %q", query, a.status, a.body)
		}
		if blocks := history.blocks(t); strings.Contains(blocks, `"id":"d"`) {
			t.Errorf("restore %s kept the database: %s", query, blocks)
		}
		// The preview route is new, so it refuses what it does not know.
		if a := history.send(t, "POST", "/history/"+lineage+"/0/restore/preview"+query, "", "", ""); a.status != http.StatusBadRequest ||
			string(a.body) != "databases must be keep or restore\n" {
			t.Errorf("preview %s = %d %q", query, a.status, a.body)
		}
	}
}

func TestAKeepRestoreThatWouldOrphanADatabaseIsRefusedEvenWithEveryConfirm(t *testing.T) {
	history := startHooked(t, nil, 0)
	lineage := history.open(t)
	history.edit(t, "toggle", `{ "ops": [ { "op": "insert", "id": "t", "block": { "type": "toggle", "data": {} } } ] }`)
	history.edit(t, "database", `{ "ops": [ { "op": "insert", "id": "d", "parent": "t", "block": { "type": "database", "data": `+tableData+` } } ] }`)
	blocksOf := func() string {
		var state struct {
			Blocks json.RawMessage `json:"blocks"`
		}
		if err := json.Unmarshal([]byte(history.blocks(t)), &state); err != nil {
			t.Fatal(err)
		}
		return string(state.Blocks)
	}
	before := blocksOf()

	request, _ := http.NewRequest("POST", history.server.URL+"/sync/doc/history/"+lineage+"/0/restore?databases=keep", strings.NewReader(""))
	request.Header.Set(IdempotencyKeyHeader, "orphan")
	request.Header.Set(RestoreConfirmHeader, "share, unlock, lockedReshape, orphanedDatabase")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(response.Body)
	_ = response.Body.Close()
	body := string(raw)
	if response.StatusCode != http.StatusConflict || response.Header.Get(RestoreRefusalHeader) != "restore_refused" ||
		body != `{"error":"restore_refused","guards":[{"kind":"orphanedDatabase","blockId":"d"}]}` {
		t.Fatalf("refused = %d %q %s", response.StatusCode, response.Header.Get(RestoreRefusalHeader), body)
	}
	if blocksOf() != before {
		t.Fatal("the refused restore wrote")
	}

	preview := history.send(t, "POST", "/history/"+lineage+"/0/restore/preview?databases=keep", "", "", "")
	var parsed struct {
		Guards json.RawMessage `json:"guards"`
	}
	if err := json.Unmarshal(preview.body, &parsed); err != nil || string(parsed.Guards) != `[{"kind":"orphanedDatabase","blockId":"d"}]` {
		t.Fatalf("preview = %d %s", preview.status, preview.body)
	}
	// Without keep, the same restore runs as it always did.
	if a := history.restore(t, lineage, "0", "orphan", ""); a.status != http.StatusNoContent {
		t.Fatalf("restore = %d %q", a.status, a.body)
	}
}

func TestAKeepRestoreLeavesADatabaseAsItIsNow(t *testing.T) {
	history := startHooked(t, nil, 0)
	lineage := history.open(t)
	history.edit(t, "database", `{ "ops": [ { "op": "insert", "id": "d", "block": { "type": "database", "data": `+tableData+` } } ] }`)
	history.editText(t, "two")

	if a := history.send(t, "POST", "/history/"+lineage+"/0/restore?databases=keep", "keep", "", ""); a.status != http.StatusNoContent {
		t.Fatalf("restore = %d %q", a.status, a.body)
	}
	var state struct {
		Blocks []struct {
			ID string `json:"id"`
		} `json:"blocks"`
	}
	if err := json.Unmarshal([]byte(history.blocks(t)), &state); err != nil {
		t.Fatal(err)
	}
	// An insert with no anchor went first; the kept database stays there.
	if len(state.Blocks) != 2 || state.Blocks[0].ID != "d" || state.Blocks[1].ID != "a" {
		t.Fatalf("blocks = %s", history.blocks(t))
	}
	if !strings.Contains(history.blocks(t), `"one"`) {
		t.Fatalf("blocks = %s", history.blocks(t))
	}
}

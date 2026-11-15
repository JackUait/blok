package cloud

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func timestampPage(t *testing.T, w *readsWorld, id string) map[string]any {
	t.Helper()
	index := w.send(t, "GET", tokenAlice, "/api/workspaces/equipe/index", nil, 200)
	for _, raw := range index["pages"].([]any) {
		p := raw.(map[string]any)
		if p["id"] == id {
			return p
		}
	}
	t.Fatalf("missing page %s", id)
	return nil
}

func TestPageTimestampsAreAuthoritativeAndAdvanceOnChanges(t *testing.T) {
	w := newReadsWorld(t)
	before := timestampPage(t, w, "public")
	created, ok := before["createdAt"].(string)
	if !ok {
		t.Fatal("new pages must expose createdAt", before)
	}
	if _, e := time.Parse(time.RFC3339Nano, created); e != nil {
		t.Fatal(e)
	}
	updated := before["updatedAt"]
	before["createdAt"] = "1900-01-01T00:00:00Z"
	before["updatedAt"] = "2999-01-01T00:00:00Z"
	w.putIndex(t, tokenAlice, []map[string]any{before}, 0, 200)
	after := timestampPage(t, w, "public")
	if after["createdAt"] != created || after["updatedAt"] != updated {
		t.Fatal("forged dates or unchanged index changed timestamps", after)
	}
	after["title"] = "Renamed"
	w.putIndex(t, tokenAlice, []map[string]any{after}, 1, 200)
	renamed := timestampPage(t, w, "public")
	if renamed["createdAt"] != created || renamed["updatedAt"] == updated {
		t.Fatal("rename timestamp", renamed)
	}
	document := map[string]any{"blocks": []any{map[string]any{"type": "paragraph", "data": map[string]any{"text": "changed"}}}}
	w.send(t, "PUT", w.service.Config.InternalSecret, "/internal/documents/public", document, 200)
	written := timestampPage(t, w, "public")
	if written["createdAt"] != created || written["updatedAt"] == renamed["updatedAt"] {
		t.Fatal("content timestamp", written)
	}
	w.send(t, "PUT", w.service.Config.InternalSecret, "/internal/documents/public", document, 200)
	if timestampPage(t, w, "public")["updatedAt"] != written["updatedAt"] {
		t.Fatal("redundant projection changed updatedAt")
	}
	// Access filtering is unchanged: Alice cannot see Bob's private page.
	index := w.send(t, "GET", tokenAlice, "/api/workspaces/equipe/index", nil, 200)
	for _, raw := range index["pages"].([]any) {
		if raw.(map[string]any)["id"] == "prive" {
			t.Fatal("private page leaked")
		}
	}
}

func TestPageTimestampMigrationLeavesLegacyDatesUnknown(t *testing.T) {
	ctx, _, open := permissionsFixture(t)
	s := open()
	seedWorld(t, ctx, s)
	seedPage(t, ctx, s, "legacy", "w", "", visWorkspace)
	if _, e := s.DB.Exec(ctx, `DROP TRIGGER IF EXISTS pages_timestamps ON pages; ALTER TABLE pages DROP COLUMN created_at; ALTER TABLE pages DROP COLUMN updated_at; DELETE FROM schema_migrations WHERE version=9`); e != nil {
		t.Fatal(e)
	}
	s.Close()
	migrated := open()
	var created, updated *time.Time
	if e := migrated.DB.QueryRow(ctx, "SELECT created_at,updated_at FROM pages WHERE id='legacy'").Scan(&created, &updated); e != nil {
		t.Fatal(e)
	}
	if created != nil || updated != nil {
		t.Fatal("migration invented legacy dates")
	}
	if _, e := migrated.DB.Exec(ctx, `UPDATE pages SET metadata=jsonb_set(metadata,'{title}','"Legacy edited"') WHERE id='legacy'`); e != nil {
		t.Fatal(e)
	}
	if e := migrated.DB.QueryRow(ctx, "SELECT created_at,updated_at FROM pages WHERE id='legacy'").Scan(&created, &updated); e != nil {
		t.Fatal(e)
	}
	if created != nil || updated == nil {
		t.Fatal("editing a legacy page must record modification without inventing creation")
	}
	seedPage(t, ctx, migrated, "new", "w", "", visWorkspace)
	if e := migrated.DB.QueryRow(ctx, "SELECT created_at,updated_at FROM pages WHERE id='new'").Scan(&created, &updated); e != nil {
		t.Fatal(e)
	}
	if created == nil || updated == nil {
		t.Fatal("new page missing dates")
	}
}

func TestPageTimestampsMCPMatchesAuthorizedIndex(t *testing.T) {
	w := newReadsWorld(t)
	page := timestampPage(t, w, "public")
	ctx := context.WithValue(w.ctx, mcpUserKey{}, identity{ID: "alice"})
	result, e := w.service.mcpListPages(ctx, mcpRequestFor(t, map[string]any{"workspace": "equipe"}))
	if e != nil {
		t.Fatal(e)
	}
	var listed struct {
		Pages []map[string]any `json:"pages"`
	}
	if e := json.Unmarshal([]byte(mcpResultText(t, result)), &listed); e != nil {
		t.Fatal(e)
	}
	found := false
	for _, p := range listed.Pages {
		if p["id"] == "prive" {
			t.Fatal("MCP exposed private page")
		}
		if p["id"] == "public" {
			found = true
			if p["createdAt"] != page["createdAt"] || p["updatedAt"] != page["updatedAt"] {
				t.Fatal("MCP dates differ", p)
			}
		}
	}
	if !found {
		t.Fatal("MCP missing public page")
	}
}

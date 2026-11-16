package cloud

import (
	"context"
	"encoding/json"
	"testing"
)

// Visiting a document must not be required to populate its sidebar icon, and a
// later index refresh must not restore an obsolete icon from metadata.
func TestPageListsUseSavedDocumentIcon(t *testing.T) {
	w := newReadsWorld(t)
	for _, tc := range []struct {
		name, document, want string
	}{
		{"emoji", `{"blocks":[],"icon":{"type":"emoji","value":"🚀"}}`, "🚀"},
		{"changed emoji", `{"blocks":[],"icon":{"type":"emoji","value":"🔒"}}`, "🔒"},
		{"custom image", `{"blocks":[],"icon":{"type":"image","url":"/files/commun.png"}}`, "/files/commun.png"},
		{"removed icon", `{"blocks":[]}`, ""},
		{"explicit null", `{"blocks":[],"icon":null}`, ""},
		{"invalid value", `{"blocks":[],"icon":{"type":"emoji","value":42}}`, ""},
		{"uninitialized document", "", "📚"},
		{"null document", "null", "📚"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var document any
			if tc.document != "" {
				document = tc.document
			}
			if _, err := w.service.DB.Exec(w.ctx, `UPDATE pages SET content=$1,
				metadata=metadata || '{"icon":"📚"}'::jsonb WHERE id='public'`, document); err != nil {
				t.Fatal(err)
			}
			for _, source := range []string{"index", "mcp"} {
				t.Run(source, func(t *testing.T) {
					var payload map[string]any
					if source == "index" {
						status, result := w.get(t, tokenAlice, "/api/workspaces/equipe/index")
						if status != 200 {
							t.Fatalf("index status: %d", status)
						}
						payload = result
					} else {
						ctx := context.WithValue(w.ctx, mcpUserKey{}, identity{ID: "alice"})
						result, err := w.service.mcpListPages(ctx, mcpRequestFor(t, map[string]any{"workspace": "equipe"}))
						if err != nil {
							t.Fatal(err)
						}
						if err := json.Unmarshal([]byte(mcpResultText(t, result)), &payload); err != nil {
							t.Fatal(err)
						}
					}
					for _, raw := range payload["pages"].([]any) {
						page := raw.(map[string]any)
						if page["id"] != "public" {
							continue
						}
						icon, present := page["icon"]
						if tc.want == "" && present || tc.want != "" && icon != tc.want {
							t.Fatalf("sidebar icon = %v (present=%v), want %q", icon, present, tc.want)
						}
						if page["title"] != "public" || page["createdAt"] == nil {
							t.Fatalf("page metadata lost: %v", page)
						}
						return
					}
					t.Fatal("page missing from list")
				})
			}
		})
	}
}

func TestPageListsUseSavedDocumentIconAfterRefreshAndStaleIndexWrite(t *testing.T) {
	w := newReadsWorld(t)
	_, stale := w.get(t, tokenAlice, "/api/workspaces/equipe/index")
	pages := []map[string]any{}
	for _, raw := range stale["pages"].([]any) {
		pages = append(pages, raw.(map[string]any))
	}
	document := map[string]any{"blocks": []any{}, "icon": map[string]any{"type": "emoji", "value": "🚀"}}
	w.send(t, "PUT", w.service.Config.InternalSecret, "/internal/documents/public", document, 200)
	for refresh := 0; refresh < 3; refresh++ {
		if refresh == 2 {
			w.putIndex(t, tokenAlice, pages, int(stale["revision"].(float64)), 200)
		}
		status, index := w.get(t, tokenAlice, "/api/workspaces/equipe/index")
		if status != 200 {
			t.Fatalf("index status: %d", status)
		}
		found := false
		for _, raw := range index["pages"].([]any) {
			page := raw.(map[string]any)
			if page["id"] == "public" {
				found = true
				if page["icon"] != "🚀" {
					t.Errorf("refresh %d: sidebar icon = %v, want 🚀", refresh, page["icon"])
				}
			}
		}
		if !found {
			t.Fatal("page missing from list")
		}
	}
}

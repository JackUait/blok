package cloud

import (
	"net"
	"strings"
	"testing"
	"time"

	"golang.org/x/net/websocket"
)

func TestDeletePageTrashesSubtreeAndCanBeRestored(t *testing.T) {
	w := newReadsWorld(t)
	w.page(t, "grandchild", "enfant", visInherit)
	before := w.send(t, "GET", tokenBob, "/api/workspaces/equipe/index", nil, 200)
	result := w.send(t, "DELETE", tokenBob, "/api/workspaces/equipe/pages/prive", nil, 200)
	if result["id"] != "prive" || result["trashed"] != true || result["affectedPages"] != float64(3) || result["revision"] != float64(1) {
		t.Fatal(result)
	}
	for _, id := range []string{"prive", "enfant", "grandchild"} {
		var retained bool
		if err := w.service.DB.QueryRow(w.ctx, `SELECT trashed AND NOT deleted AND content='{"blocks":[]}'::jsonb FROM pages WHERE id=$1`, id).Scan(&retained); err != nil || !retained {
			t.Fatalf("page %s was not retained in trash: %v", id, err)
		}
		w.assertMCPPage(t, "bob", id, false, false)
		w.send(t, "GET", tokenBob, "/api/blok-ticket?doc="+id, nil, 403)
	}
	w.assertMCPPage(t, "alice", "public", true, true)
	index := w.send(t, "GET", tokenBob, "/api/workspaces/equipe/index", nil, 200)
	if len(index["pages"].([]any)) != 1 || len(index["trash"].([]any)) != 3 {
		t.Fatal(index)
	}
	// A stale client cannot accidentally restore the pages by saving its old tree.
	w.send(t, "PUT", tokenBob, "/api/workspaces/equipe/index", before, 409)
	again := w.send(t, "DELETE", tokenBob, "/api/workspaces/equipe/pages/prive", nil, 200)
	if again["affectedPages"] != float64(0) || again["revision"] != float64(1) {
		t.Fatal("retry changed workspace", again)
	}
	// Restore through the existing trash/index workflow, preserving hierarchy and access.
	index["pages"] = append(index["pages"].([]any), index["trash"].([]any)...)
	index["trash"] = []any{}
	w.send(t, "PUT", tokenBob, "/api/workspaces/equipe/index", index, 200)
	w.assertMCPPage(t, "bob", "grandchild", true, true)
	w.assertMCPPage(t, "alice", "prive", false, false)
	var parent string
	if err := w.service.DB.QueryRow(w.ctx, `SELECT metadata->>'parentId' FROM pages WHERE id='grandchild'`).Scan(&parent); err != nil || parent != "enfant" {
		t.Fatalf("restore lost hierarchy: %q %v", parent, err)
	}
}

func TestDeletePageAuthorization(t *testing.T) {
	cases := []struct {
		name, token, path, setup string
		status                   int
	}{
		{"anonymous", "", "equipe/pages/public", "", 401},
		{"private", tokenAlice, "equipe/pages/prive", "", 404},
		{"admin-private", tokenZoe, "equipe/pages/prive", "", 404},
		{"missing", tokenBob, "equipe/pages/missing", "", 404},
		{"deleted", tokenBob, "equipe/pages/prive", `UPDATE pages SET deleted=true WHERE id='prive'`, 404},
		{"viewer", tokenBob, "equipe/pages/prive", `UPDATE memberships SET role='viewer' WHERE user_id='bob'`, 403},
		{"read-share", tokenAlice, "equipe/pages/prive", `INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES('prive','alice','view','bob')`, 403},
		{"nonmember", tokenBob, "equipe/pages/prive", `DELETE FROM memberships WHERE user_id='bob'`, 403},
		{"foreign-workspace", tokenBob, "other/pages/prive", `INSERT INTO workspaces(id,slug,name) VALUES('other','other','Other'); INSERT INTO memberships VALUES('other','bob','admin')`, 404},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := newReadsWorld(t)
			if tc.setup != "" {
				if _, err := w.service.DB.Exec(w.ctx, tc.setup); err != nil {
					t.Fatal(err)
				}
			}
			w.send(t, "DELETE", tc.token, "/api/workspaces/"+tc.path, nil, tc.status)
			var changed bool
			if err := w.service.DB.QueryRow(w.ctx, `SELECT EXISTS(SELECT 1 FROM pages WHERE trashed) OR EXISTS(SELECT 1 FROM workspaces WHERE revision<>0)`).Scan(&changed); err != nil || changed {
				t.Fatalf("denied deletion changed data: %v", err)
			}
		})
	}
}

func TestDeletePageRequiresEditOnEveryDescendant(t *testing.T) {
	w := newReadsWorld(t)
	w.page(t, "restricted", "public", visPrivate)
	w.page(t, "writable", "public", visInherit)
	if _, err := w.service.DB.Exec(w.ctx, `INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES('restricted','bob','full','bob')`); err != nil {
		t.Fatal(err)
	}
	for _, share := range []string{"", "view"} {
		if share != "" {
			if _, err := w.service.DB.Exec(w.ctx, `INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES('restricted','alice','view','bob')`); err != nil {
				t.Fatal(err)
			}
		}
		w.send(t, "DELETE", tokenAlice, "/api/workspaces/equipe/pages/public", nil, 403)
		var changed bool
		if err := w.service.DB.QueryRow(w.ctx, `SELECT EXISTS(SELECT 1 FROM pages WHERE trashed)`).Scan(&changed); err != nil || changed {
			t.Fatal("partial deletion", err)
		}
	}
	if _, err := w.service.DB.Exec(w.ctx, `UPDATE page_shares SET level='edit' WHERE page_id='restricted' AND user_id='alice'`); err != nil {
		t.Fatal(err)
	}
	result := w.send(t, "DELETE", tokenAlice, "/api/workspaces/equipe/pages/public", nil, 200)
	if result["affectedPages"] != float64(3) {
		t.Fatal(result)
	}
}

func TestMCPDeletePageDiscoveryAndPermissions(t *testing.T) {
	w := newReadsWorld(t)
	cap := managementCall(t, w, "bob", "blok_capabilities", map[string]any{}, false)
	found := false
	for _, entry := range cap["management"].([]any) {
		op := entry.(map[string]any)
		if op["tool"] == "blok_delete_page" {
			found = true
			if op["readOnly"] != false {
				t.Fatal(op)
			}
		}
	}
	if !found {
		t.Fatal("delete tool missing from capabilities")
	}
	args := map[string]any{"workspace": "equipe", "pageId": "prive"}
	for _, user := range []string{"alice", "zoe"} {
		out := managementCall(t, w, user, "blok_delete_page", args, true)
		if out["status"] != float64(404) {
			t.Fatal(out)
		}
	}
	out := managementCall(t, w, "bob", "blok_delete_page", args, false)
	if out["trashed"] != true || out["affectedPages"] != float64(2) {
		t.Fatal(out)
	}
	again := managementCall(t, w, "bob", "blok_delete_page", args, false)
	if again["affectedPages"] != float64(0) || again["revision"] != out["revision"] {
		t.Fatal(again)
	}
	// MCP credentials still cannot be used as REST sessions.
	w.send(t, "DELETE", "management-bob", "/api/workspaces/equipe/pages/public", nil, 401)
	if _, err := w.service.DB.Exec(w.ctx, `UPDATE memberships SET role='viewer' WHERE user_id='bob'`); err != nil {
		t.Fatal(err)
	}
	denied := managementCall(t, w, "bob", "blok_delete_page", map[string]any{"workspace": "equipe", "pageId": "public"}, true)
	if denied["status"] != float64(403) {
		t.Fatal(denied)
	}
}

func TestDeletePageClosesDescendantSocket(t *testing.T) {
	w := newReadsWorld(t)
	pass := w.send(t, "GET", tokenBob, "/api/blok-ticket?doc=enfant", nil, 200)["ticket"].(string)
	cfg, err := websocket.NewConfig(strings.Replace(w.server.URL, "http://", "ws://", 1)+"/api/blok/sync/enfant", w.service.Config.PublicURL)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Protocol = []string{"blok-sync.v2", pass}
	conn, err := websocket.DialConfig(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	var initial []byte
	if err = websocket.Message.Receive(conn, &initial); err != nil {
		t.Fatal(err)
	}
	w.send(t, "DELETE", tokenBob, "/api/workspaces/equipe/pages/prive", nil, 200)
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		var frame []byte
		if err = websocket.Message.Receive(conn, &frame); err != nil {
			if timeout, ok := err.(net.Error); ok && timeout.Timeout() {
				t.Fatal("deleted descendant socket remained open")
			}
			break
		}
	}
}

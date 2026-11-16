package cloud

import (
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/net/websocket"
)

func TestMovePagePreservesSubtreeAndRejectsStaleIndex(t *testing.T) {
	w := newReadsWorld(t)
	before := w.send(t, "GET", tokenBob, "/api/workspaces/equipe/index", nil, 200)
	result := w.send(t, "POST", tokenBob, "/api/workspaces/equipe/pages/prive/move", map[string]any{"parentId": "public"}, 200)
	if result["id"] != "prive" || result["parentId"] != "public" || result["revision"] != float64(1) {
		t.Fatal(result)
	}
	var intact bool
	if err := w.service.DB.QueryRow(w.ctx, `SELECT metadata->>'parentId'='public' AND visibility='private' AND content='{"blocks":[]}'::jsonb AND NOT trashed AND NOT deleted FROM pages WHERE id='prive'`).Scan(&intact); err != nil || !intact {
		t.Fatal("move lost page data", err)
	}
	if err := w.service.DB.QueryRow(w.ctx, `SELECT metadata->>'parentId'='prive' FROM pages WHERE id='enfant'`).Scan(&intact); err != nil || !intact {
		t.Fatal("move lost child", err)
	}
	w.assertMCPPage(t, "alice", "prive", false, false)
	w.send(t, "PUT", tokenBob, "/api/workspaces/equipe/index", before, 409)
	again := w.send(t, "POST", tokenBob, "/api/workspaces/equipe/pages/prive/move", map[string]any{"parentId": "public"}, 200)
	if again["revision"] != result["revision"] {
		t.Fatal("retry changed revision", again)
	}
	// Detaching an inherited private child must not publish it or strand its mover.
	w.send(t, "POST", tokenBob, "/api/workspaces/equipe/pages/enfant/move", map[string]any{"parentId": nil}, 200)
	w.assertMCPPage(t, "bob", "enfant", true, true)
	w.assertMCPPage(t, "alice", "enfant", false, false)
}

func TestMovePageRefusesInvalidHierarchyAndPermissions(t *testing.T) {
	cases := []struct {
		name, token, page string
		input             map[string]any
		setup             string
		status            int
	}{
		{"missing-parent-field", tokenBob, "prive", map[string]any{}, "", 400},
		{"empty-parent", tokenBob, "prive", map[string]any{"parentId": ""}, "", 400},
		{"invalid-parent-type", tokenBob, "prive", map[string]any{"parentId": 12}, "", 400},
		{"self", tokenBob, "prive", map[string]any{"parentId": "prive"}, "", 409},
		{"descendant", tokenBob, "prive", map[string]any{"parentId": "enfant"}, "", 409},
		{"missing-parent", tokenBob, "prive", map[string]any{"parentId": "absent"}, "", 404},
		{"hidden-source", tokenAlice, "prive", map[string]any{"parentId": "public"}, "", 404},
		{"edit-only-source", tokenAlice, "public", map[string]any{"parentId": nil}, "", 403},
		{"viewer", tokenBob, "prive", map[string]any{"parentId": "public"}, `UPDATE memberships SET role='viewer' WHERE user_id='bob'`, 403},
		{"trashed-source", tokenBob, "prive", map[string]any{"parentId": "public"}, `UPDATE pages SET trashed=true WHERE id='prive'`, 404},
		{"trashed-parent", tokenBob, "prive", map[string]any{"parentId": "public"}, `UPDATE pages SET trashed=true WHERE id='public'`, 404},
		{"anonymous", "", "prive", map[string]any{"parentId": "public"}, "", 401},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := newReadsWorld(t)
			if tc.setup != "" {
				if _, err := w.service.DB.Exec(w.ctx, tc.setup); err != nil {
					t.Fatal(err)
				}
			}
			w.send(t, "POST", tc.token, "/api/workspaces/equipe/pages/"+tc.page+"/move", tc.input, tc.status)
			var rev int
			if err := w.service.DB.QueryRow(w.ctx, `SELECT revision FROM workspaces WHERE id='w'`).Scan(&rev); err != nil || rev != 0 {
				t.Fatal("rejected move changed workspace", rev, err)
			}
		})
	}
}

func TestMovePageRequiresFullDescendantsAndEditableParent(t *testing.T) {
	w := newReadsWorld(t)
	w.page(t, "restricted", "prive", visPrivate)
	if _, err := w.service.DB.Exec(w.ctx, `DELETE FROM page_shares WHERE page_id='restricted'; INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES('restricted','alice','full','alice'); UPDATE pages SET metadata=jsonb_set(metadata,'{parentId}','null') WHERE id='restricted'`); err != nil {
		t.Fatal(err)
	}
	// A destination visible only through a read share cannot receive pages.
	if _, err := w.service.DB.Exec(w.ctx, `INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES('restricted','bob','view','alice')`); err != nil {
		t.Fatal(err)
	}
	w.send(t, "POST", tokenBob, "/api/workspaces/equipe/pages/prive/move", map[string]any{"parentId": "restricted"}, 403)
	// Descendant rights can be narrower than those on a workspace-visible root.
	if _, err := w.service.DB.Exec(w.ctx, `UPDATE pages SET metadata=jsonb_set(metadata,'{parentId}','"public"') WHERE id='restricted'`); err != nil {
		t.Fatal(err)
	}
	w.send(t, "POST", tokenZoe, "/api/workspaces/equipe/pages/public/move", map[string]any{"parentId": nil}, 403)
}

func TestMCPMovePage(t *testing.T) {
	w := newReadsWorld(t)
	args := map[string]any{"workspace": "equipe", "pageId": "prive", "parentId": "public"}
	out := managementCall(t, w, "bob", "blok_move_page", args, false)
	if out["parentId"] != "public" || out["revision"] != float64(1) {
		t.Fatal(out)
	}
	args["parentId"] = nil
	out = managementCall(t, w, "bob", "blok_move_page", args, false)
	if out["parentId"] != nil || out["revision"] != float64(2) {
		t.Fatal(out)
	}
	w.send(t, "POST", "management-bob", "/api/workspaces/equipe/pages/prive/move", map[string]any{"parentId": "public"}, 401)
}

func TestMovePageTeamspaceBoundaries(t *testing.T) {
	w := newReadsWorld(t)
	source := w.newTeamspace(t, "Source")
	target := w.newTeamspace(t, "Destination")
	root := w.tsPage(t, source, "Root", "")
	child := w.tsPage(t, source, "Child", root)
	destination := w.tsPage(t, target, "Destination", "")
	w.tsMember(t, source, "bob", "member")
	w.tsMember(t, target, "bob", "member")
	if _, err := w.service.DB.Exec(w.ctx, `INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES($1,'bob','full','zoe')`, root); err != nil {
		t.Fatal(err)
	}
	// Full page access alone does not authorize exporting a closed team's subtree.
	w.send(t, "POST", tokenBob, "/api/workspaces/equipe/pages/"+root+"/move", map[string]any{"parentId": destination}, 403)
	w.tsMember(t, source, "bob", "owner")
	out := w.send(t, "POST", tokenBob, "/api/workspaces/equipe/pages/"+root+"/move", map[string]any{"parentId": destination}, 200)
	if out["teamspaceId"] != target {
		t.Fatal(out)
	}
	var binding *string
	if err := w.service.DB.QueryRow(w.ctx, `SELECT teamspace_id FROM pages WHERE id=$1`, root).Scan(&binding); err != nil || binding != nil {
		t.Fatal("nested page kept old teamspace", err)
	}
	if actual, err := w.service.pageTeamspace(w.ctx, w.service.DB, "bob", child); err != nil || actual != target {
		t.Fatal("child did not follow", actual, err)
	}
	// Root detachment keeps the current teamspace even when it was inherited.
	out = w.send(t, "POST", tokenBob, "/api/workspaces/equipe/pages/"+root+"/move", map[string]any{"parentId": nil}, 200)
	if out["teamspaceId"] != target {
		t.Fatal(out)
	}
	w.send(t, "POST", tokenBob, "/api/workspaces/equipe/pages/"+root+"/move", map[string]any{"parentId": nil, "teamspaceId": nil}, 403)
	w.send(t, "POST", tokenZoe, "/api/workspaces/equipe/pages/"+root+"/move", map[string]any{"parentId": nil, "teamspaceId": nil}, 200)
	if actual, err := w.service.pageTeamspace(w.ctx, w.service.DB, "zoe", child); err != nil || actual != "" {
		t.Fatal("child retained teamspace", actual, err)
	}
}

func TestMovePageChecksWholeSubtreeDepth(t *testing.T) {
	w := newReadsWorld(t)
	if _, err := w.service.DB.Exec(w.ctx, `INSERT INTO pages(id,workspace_id,visibility,metadata) SELECT 'depth-'||i,'w','workspace',jsonb_build_object('id','depth-'||i,'parentId',CASE WHEN i=0 THEN NULL ELSE 'depth-'||(i-1) END) FROM generate_series(0,62) i`); err != nil {
		t.Fatal(err)
	}
	w.send(t, "POST", tokenBob, "/api/workspaces/equipe/pages/prive/move", map[string]any{"parentId": "depth-62"}, 409)
	w.send(t, "POST", tokenBob, "/api/workspaces/equipe/pages/prive/move", map[string]any{"parentId": "depth-61"}, 200)
	w.assertMCPPage(t, "bob", "enfant", true, true)
}

func TestMovePageSerializesConcurrentRetries(t *testing.T) {
	w := newReadsWorld(t)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out := w.send(t, "POST", tokenBob, "/api/workspaces/equipe/pages/prive/move", map[string]any{"parentId": "public"}, 200)
			if out["revision"] != float64(1) {
				t.Error(out)
			}
		}()
	}
	wg.Wait()
}

func TestMovePageRechecksLiveAccess(t *testing.T) {
	w := newReadsWorld(t)
	w.page(t, "moving", "public", visInherit)
	if _, err := w.service.DB.Exec(w.ctx, `INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES('moving','bob','full','bob')`); err != nil {
		t.Fatal(err)
	}
	pass := w.send(t, "GET", tokenAlice, "/api/blok-ticket?doc=moving", nil, 200)["ticket"].(string)
	cfg, err := websocket.NewConfig(strings.Replace(w.server.URL, "http://", "ws://", 1)+"/api/blok/sync/moving", w.service.Config.PublicURL)
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
	var frame []byte
	if err = websocket.Message.Receive(conn, &frame); err != nil {
		t.Fatal(err)
	}
	w.send(t, "POST", tokenBob, "/api/workspaces/equipe/pages/moving/move", map[string]any{"parentId": "prive"}, 200)
	w.assertMCPPage(t, "alice", "moving", false, false)
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		if err = websocket.Message.Receive(conn, &frame); err != nil {
			if timeout, ok := err.(net.Error); ok && timeout.Timeout() {
				t.Fatal("revoked page socket remained open")
			}
			break
		}
	}
}

package cloud

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"golang.org/x/net/websocket"
)

func (w *readsWorld) newTeamspace(t *testing.T, name string) string {
	t.Helper()
	return w.send(t, "POST", tokenZoe, "/api/workspaces/equipe/teamspaces", map[string]any{"name": name, "icon": "👩🏽‍💻", "description": "Équipe dédiée", "mode": "closed"}, 201)["id"].(string)
}
func (w *readsWorld) tsMember(t *testing.T, ts, user, role string) {
	t.Helper()
	w.send(t, "PUT", tokenZoe, "/api/workspaces/equipe/teamspaces/"+ts+"/members/"+user, map[string]any{"role": role}, 200)
}
func (w *readsWorld) tsPage(t *testing.T, ts, title, parent string) string {
	t.Helper()
	return w.send(t, "POST", tokenZoe, "/api/workspaces/equipe/teamspaces/"+ts+"/pages", map[string]any{"title": title, "parentId": parent}, 201)["id"].(string)
}
func (w *readsWorld) assertMCPPage(t *testing.T, user, page string, read, write bool) {
	t.Helper()
	for _, c := range []struct{ write, want bool }{{false, read}, {true, write}} {
		got, e := w.service.authorizeMCPDocument(w.ctx, user, page, c.write)
		if e != nil || got != c.want {
			t.Fatalf("MCP %s %s write=%v got=%v want=%v err=%v", user, page, c.write, got, c.want, e)
		}
	}
}
func (w *readsWorld) mcpPages(t *testing.T, user string) map[string]bool {
	t.Helper()
	ctx := context.WithValue(w.ctx, mcpUserKey{}, identity{User: User{ID: user}})
	out, e := w.service.mcpListPages(ctx, mcpRequestFor(t, map[string]any{"workspace": "equipe"}))
	if e != nil || out.IsError {
		t.Fatalf("list: %v %v", out, e)
	}
	var payload map[string]any
	if e = json.Unmarshal([]byte(out.Content[0].(*mcp.TextContent).Text), &payload); e != nil {
		t.Fatal(e)
	}
	result := map[string]bool{}
	for _, p := range payload["pages"].([]any) {
		result[p.(map[string]any)["id"].(string)] = true
	}
	return result
}

func TestTeamspacesAreRealNestedBoundaries(t *testing.T) {
	w := newReadsWorld(t)
	a := w.newTeamspace(t, "Produit")
	b := w.newTeamspace(t, "RH")
	w.tsMember(t, a, "alice", "member")
	w.tsMember(t, b, "bob", "member")
	root := w.tsPage(t, a, "Document produit", "")
	child := w.tsPage(t, a, "Sous-page", root)
	other := w.tsPage(t, b, "Document RH", "")
	for _, p := range []string{root, child} {
		if w.levelOf(t, "alice", p) != levelEdit || w.levelOf(t, "bob", p) != levelNone || w.levelOf(t, "zoe", p) != levelFull {
			t.Fatalf("wrong levels for %s", p)
		}
		w.send(t, "GET", tokenAlice, "/api/workspaces/equipe/pages/"+p, nil, 200)
		w.send(t, "GET", tokenBob, "/api/workspaces/equipe/pages/"+p, nil, 404)
		w.send(t, "GET", tokenBob, "/api/blok-ticket?doc="+p, nil, 403)
		w.assertMCPPage(t, "bob", p, false, false)
		w.assertMCPPage(t, "alice", p, true, true)
	}
	if w.levelOf(t, "bob", other) != levelEdit || w.levelOf(t, "alice", other) != levelNone {
		t.Fatal("teamspaces share membership")
	}
	idx := w.send(t, "GET", tokenAlice, "/api/workspaces/equipe/index", nil, 200)
	ids := listedIDs(t, idx)
	if !ids[root] || !ids[child] || ids[other] {
		t.Fatal("index leaks", idx)
	}
	if idx["access"].(map[string]any)[child].(map[string]any)["teamspaceId"] != a {
		t.Fatal("missing inherited teamspace")
	}
	if got := w.mcpPages(t, "alice"); !got[root] || got[other] {
		t.Fatal("MCP list leaks", got)
	}
	// Removing a TS owner membership does not make workspace admin a content bypass.
	w.tsMember(t, a, "alice", "owner")
	w.send(t, "DELETE", tokenZoe, "/api/workspaces/equipe/teamspaces/"+a+"/members/zoe", nil, 200)
	if w.levelOf(t, "zoe", root) != levelNone {
		t.Fatal("workspace admin bypassed teamspace")
	}
	// Closed discovery exposes only metadata; roster is restricted to members/admins.
	list := w.send(t, "GET", tokenBob, "/api/workspaces/equipe/teamspaces", nil, 200)["teamspaces"].([]any)
	if len(list) != 2 {
		t.Fatal(list)
	}
	w.send(t, "GET", tokenBob, "/api/workspaces/equipe/teamspaces/"+a+"/members", nil, 403)
}

func TestTeamspacesIdentityAndCreationPolicy(t *testing.T) {
	w := newReadsWorld(t)
	path := "/api/workspaces/equipe/teamspaces"
	w.send(t, "POST", tokenAlice, path, map[string]any{"name": "No"}, 403)
	w.send(t, "POST", tokenZoe, path, map[string]any{"name": "Invalid", "mode": "open"}, 400)
	w.send(t, "POST", tokenZoe, path, map[string]any{"name": "Invalid", "mode": "private"}, 400)
	id := w.newTeamspace(t, "Marketing")
	base := path + "/" + id
	w.send(t, "PATCH", tokenBob, base, map[string]any{"name": "No"}, 403)
	w.send(t, "PATCH", tokenZoe, base, map[string]any{"name": "  Communication  ", "icon": "👨‍👩‍👧‍👦", "description": "Nouvelle description"}, 200)
	if got := w.send(t, "GET", tokenBob, base, nil, 200); got["name"] != "Communication" || got["icon"] != "👨‍👩‍👧‍👦" || got["myRole"] != nil || got["canManage"] != false {
		t.Fatal(got)
	}
	w.send(t, "PATCH", tokenZoe, base, map[string]any{"icon": "<svg/>"}, 400)
	w.send(t, "PATCH", tokenZoe, base, map[string]any{"mode": "open"}, 400)
	w.send(t, "PATCH", tokenZoe, base, map[string]any{"icon": nil}, 200)
	cfg := w.service.Config
	cfg.DataDirectory = t.TempDir()
	restarted, e := New(w.ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer restarted.Close()
	ts, e := restarted.teamspace(w.ctx, restarted.DB, "zoe", "w", id)
	if e != nil || ts.Name != "Communication" || ts.Icon != nil || ts.Description != "Nouvelle description" {
		t.Fatalf("not persisted %+v %v", ts, e)
	}
	if _, e = w.service.DB.Exec(w.ctx, `INSERT INTO workspaces(id,slug,name) VALUES('other','other','Other');INSERT INTO memberships VALUES('other','zoe','admin')`); e != nil {
		t.Fatal(e)
	}
	w.send(t, "GET", tokenZoe, "/api/workspaces/other/teamspaces/"+id, nil, 404)
	w.send(t, "PATCH", tokenZoe, "/api/workspaces/other/teamspaces/"+id, map[string]any{"name": "Hacked"}, 404)
	w.send(t, "PUT", tokenZoe, base+"/members/outsider", map[string]any{"role": "member"}, 404)
}

func TestTeamspacesArchiveRestoresSameAccess(t *testing.T) {
	w := newReadsWorld(t)
	id := w.newTeamspace(t, "Équipe")
	w.tsMember(t, id, "alice", "member")
	page := w.tsPage(t, id, "Durable", "")
	child := w.tsPage(t, id, "Enfant", page)
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO assets(name,workspace_id,document_id) VALUES('teamspace-secret.png','w',$1)`, page); e != nil {
		t.Fatal(e)
	}
	w.send(t, "GET", tokenBob, "/api/assets/url?url=/files/teamspace-secret.png", nil, 403)
	w.send(t, "GET", tokenAlice, "/api/assets/url?url=/files/teamspace-secret.png", nil, 200)
	w.send(t, "POST", tokenAlice, "/api/workspaces/equipe/teamspaces/"+id+"/archive", map[string]any{}, 403)
	w.send(t, "POST", tokenZoe, "/api/workspaces/equipe/teamspaces/"+id+"/archive", map[string]any{}, 200)
	for _, p := range []string{page, child} {
		for _, user := range []string{"alice", "zoe"} {
			if w.levelOf(t, user, p) != levelNone {
				t.Fatal("archive remained readable", user, p)
			}
			w.assertMCPPage(t, user, p, false, false)
		}
	}
	if len(w.send(t, "GET", tokenZoe, "/api/workspaces/equipe/teamspaces", nil, 200)["teamspaces"].([]any)) != 0 {
		t.Fatal("archive still active")
	}
	if len(w.send(t, "GET", tokenZoe, "/api/workspaces/equipe/teamspaces?archived=true", nil, 200)["teamspaces"].([]any)) != 1 {
		t.Fatal("archive missing")
	}
	w.send(t, "POST", tokenZoe, "/api/workspaces/equipe/teamspaces/"+id+"/pages", map[string]any{"title": "No"}, 409)
	w.send(t, "GET", tokenAlice, "/api/assets/url?url=/files/teamspace-secret.png", nil, 403)
	w.send(t, "POST", tokenZoe, "/api/workspaces/equipe/teamspaces/"+id+"/restore", map[string]any{}, 200)
	if w.levelOf(t, "alice", child) != levelEdit || w.levelOf(t, "zoe", page) != levelFull {
		t.Fatal("restore changed ACLs")
	}
}

func TestTeamspacesPreservePrivatePagesAndLegacyMigration(t *testing.T) {
	w := newReadsWorld(t)
	id := w.newTeamspace(t, "Privé")
	w.tsMember(t, id, "bob", "member")
	// Bob's pre-existing private root stays private when explicitly attached.
	w.send(t, "PUT", tokenBob, "/api/workspaces/equipe/pages/prive/teamspace", map[string]any{"teamspaceId": id}, 200)
	if w.levelOf(t, "bob", "enfant") != levelFull || w.levelOf(t, "zoe", "prive") != levelNone {
		t.Fatal("assignment opened a private page")
	}
	w.tsMember(t, id, "alice", "member")
	if w.levelOf(t, "alice", "prive") != levelNone {
		t.Fatal("membership opened private page")
	}
	w.send(t, "PUT", tokenBob, "/api/workspaces/equipe/pages/prive/shares/alice", map[string]any{"level": "view"}, 200)
	if w.levelOf(t, "alice", "enfant") != levelView {
		t.Fatal("named ACL lost")
	}
	w.send(t, "DELETE", tokenZoe, "/api/workspaces/equipe/teamspaces/"+id+"/members/alice", nil, 200)
	if w.levelOf(t, "alice", "prive") != levelNone {
		t.Fatal("named share bypasses teamspace")
	}
	w.send(t, "PUT", tokenBob, "/api/workspaces/equipe/pages/prive/shares/alice", map[string]any{"level": "view"}, 404)
	if w.levelOf(t, "alice", "public") != levelEdit {
		t.Fatal("legacy common page changed")
	}
	var assigned int
	if e := w.service.DB.QueryRow(w.ctx, `SELECT count(*) FROM pages WHERE id='public' AND teamspace_id IS NOT NULL`).Scan(&assigned); e != nil || assigned != 0 {
		t.Fatal("migration assigned legacy page", assigned, e)
	}
}

func TestTeamspaceLastOwnerAndRoleEscalationProtected(t *testing.T) {
	w := newReadsWorld(t)
	id := w.newTeamspace(t, "Projet")
	base := "/api/workspaces/equipe/teamspaces/" + id
	w.send(t, "DELETE", tokenZoe, base+"/members/zoe", nil, 409)
	w.send(t, "PUT", tokenZoe, base+"/members/zoe", map[string]any{"role": "member"}, 409)
	w.tsMember(t, id, "bob", "member")
	w.send(t, "PUT", tokenBob, base+"/members/bob", map[string]any{"role": "owner"}, 403)
	w.tsMember(t, id, "bob", "owner")
	w.send(t, "DELETE", tokenZoe, base+"/members/zoe", nil, 200)
	w.send(t, "PATCH", tokenZoe, "/api/workspaces/equipe/members/bob", map[string]any{"role": "viewer"}, 409)
	w.send(t, "DELETE", tokenZoe, "/api/workspaces/equipe/members/bob", nil, 409)
	w.tsMember(t, id, "alice", "owner")
	w.send(t, "PATCH", tokenZoe, "/api/workspaces/equipe/members/bob", map[string]any{"role": "viewer"}, 200)
	w.send(t, "PUT", tokenZoe, base+"/members/bob", map[string]any{"role": "owner"}, 400)
}

func TestTeamspaceMCPAndDuplicationCannotEscape(t *testing.T) {
	w := newReadsWorld(t)
	id := w.newTeamspace(t, "Source")
	other := w.newTeamspace(t, "Cible")
	w.tsMember(t, id, "alice", "member")
	ctx := context.WithValue(w.ctx, mcpUserKey{}, identity{User: User{ID: "alice"}})
	out, e := w.service.mcpCreatePage(ctx, mcpRequestFor(t, map[string]any{"workspace": "equipe", "teamspaceId": id, "title": "MCP TS"}))
	if e != nil || out.IsError {
		t.Fatalf("MCP %v %v", out, e)
	}
	var created createdScopedPage
	if e = json.Unmarshal([]byte(out.Content[0].(*mcp.TextContent).Text), &created); e != nil {
		t.Fatal(e)
	}
	if w.levelOf(t, "bob", created.ID) != levelNone || w.levelOf(t, "alice", created.ID) != levelFull {
		t.Fatal("MCP root leaked")
	}
	out, _ = w.service.mcpCreatePage(ctx, mcpRequestFor(t, map[string]any{"workspace": "equipe", "teamspaceId": other, "title": "No"}))
	if !out.IsError {
		t.Fatal("MCP ignored membership")
	}
	target := w.tsPage(t, other, "Target", "")
	w.send(t, "POST", tokenZoe, "/api/workspaces/equipe/pages/"+created.ID+"/duplicate", map[string]any{"id": "copy-ts", "title": "Copy"}, 201)
	if w.levelOf(t, "bob", "copy-ts") != levelNone {
		t.Fatal("duplicate escaped to workspace")
	}
	w.send(t, "POST", tokenZoe, "/api/workspaces/equipe/pages/"+created.ID+"/duplicate", map[string]any{"id": "copy-cross", "title": "Copy", "parentId": target}, 409)
}

func TestTeamspaceIndexCannotMoveSubtreeAcrossBoundary(t *testing.T) {
	w := newReadsWorld(t)
	id := w.newTeamspace(t, "Équipe")
	root := w.tsPage(t, id, "Root", "")
	child := w.tsPage(t, id, "Child", root)
	idx := w.send(t, "GET", tokenZoe, "/api/workspaces/equipe/index", nil, 200)
	pages := []map[string]any{}
	for _, raw := range idx["pages"].([]any) {
		pages = append(pages, raw.(map[string]any))
	}
	for _, p := range pages {
		if p["id"] == child {
			p["parentId"] = nil
		}
	}
	w.putIndex(t, tokenZoe, pages, int(idx["revision"].(float64)), 409)
	for _, p := range pages {
		if p["id"] == child {
			p["parentId"] = root
		}
	}
	pages = append(pages, entry("new-in-ts", root))
	w.putIndex(t, tokenZoe, pages, int(idx["revision"].(float64)), 200)
	if w.levelOf(t, "bob", "new-in-ts") != levelNone {
		t.Fatal("index child escaped TS")
	}
	w.send(t, "PUT", tokenZoe, "/api/workspaces/equipe/pages/"+child+"/teamspace", map[string]any{"teamspaceId": nil}, 409)
	w.send(t, "PUT", tokenZoe, "/api/workspaces/equipe/pages/"+root+"/teamspace", map[string]any{"teamspaceId": nil}, 200)
	if w.levelOf(t, "bob", child) != levelEdit {
		t.Fatal("explicit detach did not change scope")
	}
}

func TestTeamspaceDepthLimitFailsClosed(t *testing.T) {
	w := newReadsWorld(t)
	id := w.newTeamspace(t, "Deep")
	root := w.tsPage(t, id, "Root", "")
	parent := root
	for i := 0; i < 65; i++ {
		next := fmt.Sprintf("deep-%d", i)
		w.page(t, next, parent, visInherit)
		parent = next
	}
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO page_shares VALUES($1,'bob','full','zoe',now())`, parent); e != nil {
		t.Fatal(e)
	}
	if w.levelOf(t, "bob", parent) != levelNone {
		t.Fatal("truncated ancestry bypassed teamspace")
	}
}

func TestTeamspaceMembershipChangesInvalidateStaleIndex(t *testing.T) {
	w := newReadsWorld(t)
	id := w.newTeamspace(t, "Équipe")
	page := w.tsPage(t, id, "Keep", "")
	old := w.send(t, "GET", tokenAlice, "/api/workspaces/equipe/index", nil, 200)
	pages := []map[string]any{}
	for _, raw := range old["pages"].([]any) {
		pages = append(pages, raw.(map[string]any))
	}
	w.tsMember(t, id, "alice", "member")
	w.putIndex(t, tokenAlice, pages, int(old["revision"].(float64)), 409)
	if !w.alive(t, page) {
		t.Fatal("stale save deleted newly visible page")
	}
}

func TestTeamspaceOwnerAccountDeletionProtected(t *testing.T) {
	w := newReadsWorld(t)
	id := w.newTeamspace(t, "Équipe")
	w.tsMember(t, id, "bob", "owner")
	w.send(t, "DELETE", tokenZoe, "/api/workspaces/equipe/teamspaces/"+id+"/members/zoe", nil, 200)
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO instance_admins(user_id) VALUES('zoe')`); e != nil {
		t.Fatal(e)
	}
	w.send(t, "DELETE", tokenZoe, "/api/admin/users/bob", nil, 409)
	w.tsMember(t, id, "alice", "owner")
	w.send(t, "DELETE", tokenZoe, "/api/admin/users/bob", nil, 200)
	var count int
	if e := w.service.DB.QueryRow(w.ctx, `SELECT count(*) FROM teamspace_memberships WHERE user_id='bob'`).Scan(&count); e != nil || count != 0 {
		t.Fatal("membership survived account deletion", count, e)
	}
}

func TestTeamspaceArchiveAndMembershipCloseAdmittedSockets(t *testing.T) {
	w := newReadsWorld(t)
	id := w.newTeamspace(t, "Live")
	w.tsMember(t, id, "alice", "member")
	page := w.tsPage(t, id, "Live page", "")
	open := func() *websocket.Conn {
		t.Helper()
		pass := w.send(t, "GET", tokenAlice, "/api/blok-ticket?doc="+page, nil, 200)["ticket"].(string)
		cfg, e := websocket.NewConfig(strings.Replace(w.server.URL, "http://", "ws://", 1)+"/api/blok/sync/"+page, w.service.Config.PublicURL)
		if e != nil {
			t.Fatal(e)
		}
		cfg.Protocol = []string{"blok-sync.v2", pass}
		conn, e := websocket.DialConfig(cfg)
		if e != nil {
			t.Fatal(e)
		}
		conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		var initial []byte
		if e = websocket.Message.Receive(conn, &initial); e != nil {
			t.Fatal(e)
		}
		return conn
	}
	closed := func(conn *websocket.Conn) {
		t.Helper()
		defer conn.Close()
		conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		for {
			var frame []byte
			e := websocket.Message.Receive(conn, &frame)
			if e != nil {
				if n, ok := e.(net.Error); ok && n.Timeout() {
					t.Fatal("teamspace revocation left admitted socket open")
				}
				return
			}
		}
	}
	conn := open()
	w.send(t, "POST", tokenZoe, "/api/workspaces/equipe/teamspaces/"+id+"/archive", map[string]any{}, 200)
	closed(conn)
	w.send(t, "POST", tokenZoe, "/api/workspaces/equipe/teamspaces/"+id+"/restore", map[string]any{}, 200)
	conn = open()
	w.send(t, "DELETE", tokenZoe, "/api/workspaces/equipe/teamspaces/"+id+"/members/alice", nil, 200)
	closed(conn)
}

func TestTeamspaceWorkspaceViewerRemainsReadOnly(t *testing.T) {
	w := newReadsWorld(t)
	id := w.newTeamspace(t, "Read-only")
	w.tsMember(t, id, "bob", "member")
	page := w.tsPage(t, id, "Read", "")
	w.send(t, "PATCH", tokenZoe, "/api/workspaces/equipe/members/bob", map[string]any{"role": "viewer"}, 200)
	if w.levelOf(t, "bob", page) != levelView {
		t.Fatal("workspace viewer not capped")
	}
	w.assertMCPPage(t, "bob", page, true, false)
	w.send(t, "POST", tokenBob, "/api/workspaces/equipe/teamspaces/"+id+"/pages", map[string]any{"title": "No"}, 403)
}

func TestTeamspaceForeignWorkspaceAssignmentsFail(t *testing.T) {
	w := newReadsWorld(t)
	id := w.newTeamspace(t, "Here")
	page := w.tsPage(t, id, "Root", "")
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO workspaces(id,slug,name) VALUES('other','other','Other');INSERT INTO memberships VALUES('other','zoe','admin');INSERT INTO teamspaces(id,workspace_id,name) VALUES('foreign-ts','other','Foreign');INSERT INTO teamspace_memberships VALUES('foreign-ts','other','zoe','owner')`); e != nil {
		t.Fatal(e)
	}
	w.send(t, "PUT", tokenZoe, "/api/workspaces/equipe/pages/"+page+"/teamspace", map[string]any{"teamspaceId": "foreign-ts"}, 403)
	if _, e := w.service.DB.Exec(w.ctx, `UPDATE pages SET teamspace_id='foreign-ts' WHERE id=$1`, page); e == nil {
		t.Fatal("DB accepted cross-workspace teamspace")
	}
	w.send(t, "POST", tokenZoe, "/api/workspaces/other/teamspaces/"+id+"/pages", map[string]any{"title": "No"}, 404)
}

func TestTeamspaceDeletedIDsCannotBeClaimedAsNewPages(t *testing.T) {
	w := newReadsWorld(t)
	ts := w.newTeamspace(t, "Deleted")
	page := w.tsPage(t, ts, "Retained", "")
	if _, e := w.service.DB.Exec(w.ctx, `UPDATE pages SET deleted=true WHERE id=$1`, page); e != nil {
		t.Fatal(e)
	}
	idx := w.send(t, "GET", tokenBob, "/api/workspaces/equipe/index", nil, 200)
	pages := []map[string]any{}
	for _, raw := range idx["pages"].([]any) {
		pages = append(pages, raw.(map[string]any))
	}
	pages = append(pages, entry(page, nil))
	w.putIndex(t, tokenBob, pages, int(idx["revision"].(float64)), 409)
	if w.alive(t, page) {
		t.Fatal("deleted TS ID was reclaimed as new page")
	}
}

func TestTeamspaceEditGrantCannotReparentPrivateChild(t *testing.T) {
	w := newReadsWorld(t)
	ts := w.newTeamspace(t, "Private tree")
	w.tsMember(t, ts, "bob", "member")
	common := w.tsPage(t, ts, "Common", "")
	ws, e := w.service.lookupWorkspace(w.ctx, "equipe", "zoe")
	if e != nil {
		t.Fatal(e)
	}
	private, e := w.service.createScopedPage(w.ctx, identity{User: User{ID: "zoe"}}, ws, "Private root", "", ts, visPrivate)
	if e != nil {
		t.Fatal(e)
	}
	child := w.tsPage(t, ts, "Private child", private.ID)
	w.send(t, "PUT", tokenZoe, "/api/workspaces/equipe/pages/"+child+"/shares/bob", map[string]any{"level": "edit"}, 200)
	idx := w.send(t, "GET", tokenBob, "/api/workspaces/equipe/index", nil, 200)
	pages := []map[string]any{}
	for _, raw := range idx["pages"].([]any) {
		p := raw.(map[string]any)
		if p["id"] == child {
			p["parentId"] = common
		}
		pages = append(pages, p)
	}
	w.putIndex(t, tokenBob, pages, int(idx["revision"].(float64)), 409)
	if w.levelOf(t, "alice", child) != levelNone {
		t.Fatal("private child was widened")
	}
}

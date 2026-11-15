package cloud

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestWorkspaceIdentityPersistenceAndAuthorization(t *testing.T) {
	w := newReadsWorld(t)
	path := "/api/workspaces/equipe"
	if got := w.send(t, "GET", tokenZoe, path, nil, 200); got["icon"] != nil {
		t.Fatal(got)
	}
	for _, token := range []string{tokenAlice, tokenBob} {
		w.send(t, "PATCH", token, path, map[string]any{"icon": "👨‍👩‍👧‍👦"}, 403)
	}
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO instance_admins(user_id) VALUES('alice')`); e != nil {
		t.Fatal(e)
	}
	w.send(t, "PATCH", tokenAlice, path, map[string]any{"icon": "🦊"}, 403)
	for _, icon := range []string{"👨‍👩‍👧‍👦", "👩🏽‍💻", "🇫🇷", "1️⃣", "🦊"} {
		got := w.send(t, "PATCH", tokenZoe, path, map[string]any{"icon": icon}, 200)
		if got["icon"] != icon || got["name"] != "Equipe" || got["slug"] != "equipe" {
			t.Fatal(got)
		}
	}
	w.send(t, "PATCH", tokenZoe, path, map[string]any{"name": "  Équipe projet  "}, 200)
	if got := w.send(t, "GET", tokenZoe, "/api/workspaces", nil, 200)["workspaces"].([]any)[0].(map[string]any); got["icon"] != "🦊" || got["name"] != "Équipe projet" {
		t.Fatal(got)
	}
	if got := w.send(t, "GET", tokenZoe, "/api/session", nil, 200)["workspaces"].([]any)[0].(map[string]any); got["icon"] != "🦊" {
		t.Fatal("session omitted icon", got)
	}
	for _, payload := range []map[string]any{{"icon": ""}, {"icon": "<svg/>"}, {"icon": "https://x.test/a.png"}, {"icon": "hello"}, {"icon": 2}, {"icon": strings.Repeat("🦊", 65)}, {"name": nil}, {"name": "Valid", "icon": "invalid"}} {
		w.send(t, "PATCH", tokenZoe, path, payload, 400)
	}
	var name, icon, slug string
	var rev int
	if e := w.service.DB.QueryRow(w.ctx, `SELECT name,icon,slug,revision FROM workspaces WHERE id='w'`).Scan(&name, &icon, &slug, &rev); e != nil {
		t.Fatal(e)
	}
	if name != "Équipe projet" || icon != "🦊" || slug != "equipe" || rev != 0 {
		t.Fatalf("identity: %q %q %q %d", name, icon, slug, rev)
	}
	// A second service replays migrations against the same isolated schema.
	cfg := w.service.Config
	cfg.DataDirectory = t.TempDir()
	restarted, e := New(w.ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer restarted.Close()
	ws, e := restarted.lookupWorkspace(w.ctx, "equipe", "zoe")
	if e != nil || ws.Icon == nil || *ws.Icon != "🦊" {
		t.Fatalf("restart: %+v %v", ws, e)
	}
	w.send(t, "PATCH", tokenZoe, path, map[string]any{"icon": nil}, 200)
	if got := w.send(t, "GET", tokenZoe, path, nil, 200); got["icon"] != nil || got["name"] != name {
		t.Fatal(got)
	}
}

func TestPageActionsCannotUseAnotherWorkspaceURL(t *testing.T) {
	w := newReadsWorld(t)
	for _, q := range []string{`INSERT INTO workspaces(id,slug,name) VALUES('other','other','Other')`, `INSERT INTO memberships VALUES('other','bob','admin'),('other','alice','member')`} {
		if _, e := w.service.DB.Exec(w.ctx, q); e != nil {
			t.Fatal(e)
		}
	}
	base := "/api/workspaces/other/pages/prive"
	w.send(t, "GET", tokenBob, base+"/access", nil, 404)
	w.send(t, "PUT", tokenBob, base+"/access", map[string]any{"visibility": "workspace"}, 404)
	w.send(t, "PUT", tokenBob, base+"/shares/alice", map[string]any{"level": "full"}, 404)
	w.send(t, "DELETE", tokenBob, base+"/shares/bob", nil, 404)
	if got := w.levelOf(t, "alice", "prive"); got != levelNone {
		t.Fatal("alternate workspace granted access", got)
	}
}

func TestCorruptCrossWorkspaceParentCannotGrantAccess(t *testing.T) {
	w := newReadsWorld(t)
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO workspaces(id,slug,name) VALUES('other','other','Other')`); e != nil {
		t.Fatal(e)
	}
	seedPage(t, w.ctx, w.service, "foreign", "other", "", visWorkspace)
	seedPage(t, w.ctx, w.service, "corrupt", "w", "foreign", visInherit)
	if got := w.levelOf(t, "alice", "corrupt"); got != levelNone {
		t.Fatal("inherited foreign visibility", got)
	}
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO page_shares VALUES('foreign','alice','full','zoe',now())`); e != nil {
		t.Fatal(e)
	}
	if got := w.levelOf(t, "alice", "corrupt"); got != levelNone {
		t.Fatal("inherited foreign share", got)
	}
}

func TestStandingUsesNearestExplicitVisibility(t *testing.T) {
	w := newReadsWorld(t)
	w.page(t, "restricted", "public", visPrivate)
	standings, _, e := w.service.workspaceStandings(w.ctx, w.service.DB, "bob", "w")
	if e != nil {
		t.Fatal(e)
	}
	if standings["restricted"].Visibility != visPrivate {
		t.Fatalf("private child misclassified: %+v", standings["restricted"])
	}
}

func TestMCPPageCreationIsPrivateUnlessExplicitlyShared(t *testing.T) {
	w := newReadsWorld(t)
	ctx := context.WithValue(w.ctx, mcpUserKey{}, identity{User: User{ID: "bob"}})
	create := func(args map[string]any) string {
		t.Helper()
		raw, _ := json.Marshal(args)
		out, e := w.service.mcpCreatePage(ctx, &mcp.CallToolRequest{Params: &mcp.CallToolParamsRaw{Arguments: raw}})
		if e != nil || out.IsError {
			t.Fatalf("create: %+v %v", out, e)
		}
		var result struct{ ID string }
		if e = json.Unmarshal([]byte(out.Content[0].(*mcp.TextContent).Text), &result); e != nil {
			t.Fatal(e)
		}
		return result.ID
	}
	private := create(map[string]any{"workspace": "equipe", "title": "AI personal draft"})
	if w.levelOf(t, "bob", private) != levelFull || w.levelOf(t, "alice", private) != levelNone || w.levelOf(t, "zoe", private) != levelNone {
		t.Fatal("MCP root exposed personal draft")
	}
	child := create(map[string]any{"workspace": "equipe", "title": "Child", "parentId": private})
	if w.levelOf(t, "alice", child) != levelNone {
		t.Fatal("MCP child escaped private parent")
	}
	public := create(map[string]any{"workspace": "equipe", "title": "Shared", "visibility": "workspace"})
	if w.levelOf(t, "alice", public) != levelEdit {
		t.Fatal("explicit MCP publication ignored")
	}
}

func TestInvitationsAreBoundedRevocableAndNeverElevate(t *testing.T) {
	w := newReadsWorld(t)
	path := "/api/workspaces/equipe/invites"
	w.send(t, "POST", tokenBob, path, map[string]any{"email": "new@example.test", "role": "member"}, 403)
	w.send(t, "POST", tokenZoe, path, map[string]any{"email": "new@example.test", "role": "admin"}, 400)
	invite := func(email, role string) string {
		t.Helper()
		w.send(t, "POST", tokenZoe, path, map[string]any{"email": email, "role": role}, 201)
		var id string
		if e := w.service.DB.QueryRow(w.ctx, `SELECT id FROM invites WHERE email=$1 ORDER BY created_at DESC LIMIT 1`, email).Scan(&id); e != nil {
			t.Fatal(e)
		}
		return id
	}
	login := func(email string) {
		t.Helper()
		code := "123456"
		if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO login_codes(email,digest,expires_at) VALUES($1,$2,now()+interval '10 minutes')`, email, hash(email+":"+code+":"+w.service.Config.InternalSecret)); e != nil {
			t.Fatal(e)
		}
		w.send(t, "POST", tokenZoe, "/api/auth/verify-code", map[string]any{"email": email, "code": code, "client": "desktop"}, 200)
	}
	expired := invite("expired@example.test", "member")
	revoked := invite("revoked@example.test", "member")
	live := invite("live@example.test", "viewer")
	for _, email := range []string{"expired@example.test", "revoked@example.test"} {
		if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO users(id,email) VALUES($1,$1)`, email); e != nil {
			t.Fatal(e)
		}
	}
	var bounded bool
	if e := w.service.DB.QueryRow(w.ctx, `SELECT expires_at>now()+interval '6 days' AND expires_at<=now()+interval '7 days' FROM invites WHERE id=$1`, live).Scan(&bounded); e != nil || !bounded {
		t.Fatalf("expiry not bounded: %v %v", bounded, e)
	}
	if _, e := w.service.DB.Exec(w.ctx, `UPDATE invites SET expires_at=now()-interval '1 second' WHERE id=$1`, expired); e != nil {
		t.Fatal(e)
	}
	w.send(t, "DELETE", tokenZoe, path+"/"+revoked, nil, 200)
	for _, email := range []string{"expired@example.test", "revoked@example.test", "live@example.test"} {
		login(email)
	}
	var n int
	if e := w.service.DB.QueryRow(w.ctx, `SELECT count(*) FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email IN ('expired@example.test','revoked@example.test')`).Scan(&n); e != nil || n != 0 {
		t.Fatalf("invalid invitation granted membership: %d %v", n, e)
	}
	var role string
	if e := w.service.DB.QueryRow(w.ctx, `SELECT role FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email='live@example.test'`).Scan(&role); e != nil || role != "viewer" {
		t.Fatalf("wrong accepted role %s %v", role, e)
	}
	// A later invitation cannot silently promote an existing viewer.
	invite("live@example.test", "member")
	login("live@example.test")
	if e := w.service.DB.QueryRow(w.ctx, `SELECT role FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email='live@example.test'`).Scan(&role); e != nil || role != "viewer" {
		t.Fatalf("invite elevated existing viewer %s %v", role, e)
	}
	if _, e := w.service.DB.Exec(w.ctx, `UPDATE email_rate_limits SET count=30 WHERE key='invite:zoe'`); e != nil {
		t.Fatal(e)
	}
	w.send(t, "POST", tokenZoe, path, map[string]any{"email": "quota@example.test", "role": "member"}, 429)
	if e := w.service.DB.QueryRow(w.ctx, `SELECT count(*) FROM invites WHERE email='quota@example.test'`).Scan(&n); e != nil || n != 0 {
		t.Fatalf("rate limited invite was created: %d %v", n, e)
	}
	w.send(t, "PATCH", tokenBob, "/api/workspaces/equipe/members/bob", map[string]any{"role": "admin"}, 403)
	w.send(t, "DELETE", tokenZoe, "/api/workspaces/equipe/members/zoe", nil, 409)
}

func TestPrivatePageLastGovernorCannotBeDowngraded(t *testing.T) {
	w := newReadsWorld(t)
	w.send(t, "PUT", tokenBob, "/api/workspaces/equipe/pages/prive/shares/bob", map[string]any{"level": "view"}, 409)
	if got := w.levelOf(t, "bob", "prive"); got != levelFull {
		t.Fatal("last governor lost access", got)
	}
}

func TestClosingWorkspacePageRetainsGovernor(t *testing.T) {
	w := newReadsWorld(t)
	w.send(t, "PUT", tokenZoe, "/api/workspaces/equipe/pages/public/access", map[string]any{"visibility": "private"}, 200)
	if got := w.levelOf(t, "zoe", "public"); got != levelFull {
		t.Fatal("closing orphaned page", got)
	}
	if got := w.levelOf(t, "alice", "public"); got != levelNone {
		t.Fatal("closing did not restrict page", got)
	}
}

func TestSharingChangesInvalidateStaleIndex(t *testing.T) {
	w := newReadsWorld(t)
	old := w.send(t, "GET", tokenAlice, "/api/workspaces/equipe/index", nil, 200)
	pages := []map[string]any{}
	for _, raw := range old["pages"].([]any) {
		pages = append(pages, raw.(map[string]any))
	}
	w.send(t, "PUT", tokenBob, "/api/workspaces/equipe/pages/prive/shares/alice", map[string]any{"level": "edit"}, 200)
	w.putIndex(t, tokenAlice, pages, int(old["revision"].(float64)), 409)
	if !w.alive(t, "prive") {
		t.Fatal("stale save deleted a newly shared page")
	}
}

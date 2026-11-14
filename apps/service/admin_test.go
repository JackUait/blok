package cloud

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// Forbidden keys that would leak page content into the admin surface (§7.1).
var adminForbiddenPageKeys = []string{
	"pageId", "pageID", "pageIds", "pageTitle", "title", "pages", "pageCount",
	"parentId", "documentId", "content",
}

func assertNoPageKeys(t *testing.T, label string, v any) {
	t.Helper()
	raw, e := json.Marshal(v)
	if e != nil {
		t.Fatal(e)
	}
	var walk func(any, string)
	walk = func(node any, path string) {
		switch n := node.(type) {
		case map[string]any:
			for k, child := range n {
				for _, bad := range adminForbiddenPageKeys {
					if k == bad {
						t.Fatalf("%s: forbidden page key %q at %s", label, k, path)
					}
				}
				// Case-insensitive catch for pageId / PageTitle variants.
				lower := strings.ToLower(k)
				if strings.Contains(lower, "page") && (strings.Contains(lower, "id") || strings.Contains(lower, "title") || lower == "pages" || lower == "pagecount") {
					t.Fatalf("%s: forbidden page-related key %q at %s", label, k, path)
				}
				walk(child, path+"."+k)
			}
		case []any:
			for i, child := range n {
				walk(child, path)
				_ = i
			}
		}
	}
	var parsed any
	if e := json.Unmarshal(raw, &parsed); e != nil {
		t.Fatal(e)
	}
	walk(parsed, label)
}

func TestAdminUsersListPayloadHasNoPageFields(t *testing.T) {
	ctx, s, _, request := instanceWorld(t)
	adminTok := seedSession(t, ctx, s, "admin1", "admin1@example.test", true)
	memberTok := seedSession(t, ctx, s, "member1", "member1@example.test", false)
	_ = memberTok

	wsID := opaque()
	if _, e := s.DB.Exec(ctx, `INSERT INTO workspaces(id,slug,name) VALUES($1,'equipe','Équipe')`, wsID); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DB.Exec(ctx, `INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,'member1','member') ON CONFLICT DO NOTHING`, wsID); e != nil {
		t.Fatal(e)
	}
	// A page exists in the DB — the admin list must still never surface it.
	if _, e := s.DB.Exec(ctx, `INSERT INTO pages(id,workspace_id,metadata) VALUES('page-secret',$1,'{"title":"Secret"}')`, wsID); e != nil {
		t.Fatal(e)
	}

	out := request("GET", "/api/admin/users", adminTok, nil, 200)
	assertNoPageKeys(t, "GET /api/admin/users", out)
	users, ok := out["users"].([]any)
	if !ok || len(users) < 2 {
		t.Fatalf("expected users list, got %#v", out)
	}
	found := map[string]bool{}
	for _, raw := range users {
		u := raw.(map[string]any)
		for _, key := range []string{"id", "email", "name", "createdAt", "workspaceCount", "instanceAdmin"} {
			if _, ok := u[key]; !ok {
				t.Fatalf("user missing %q: %#v", key, u)
			}
		}
		found[u["email"].(string)] = true
		if u["email"] == "member1@example.test" {
			if u["workspaceCount"].(float64) < 1 {
				t.Fatalf("member workspaceCount = %v", u["workspaceCount"])
			}
			if u["instanceAdmin"] != false {
				t.Fatalf("member instanceAdmin = %v", u["instanceAdmin"])
			}
		}
		if u["email"] == "admin1@example.test" && u["instanceAdmin"] != true {
			t.Fatalf("admin instanceAdmin = %v", u["instanceAdmin"])
		}
	}
	if !found["admin1@example.test"] || !found["member1@example.test"] {
		t.Fatalf("missing seeded users: %#v", found)
	}
}

func TestAdminWorkspacesListPayloadHasNoPageFields(t *testing.T) {
	ctx, s, _, request := instanceWorld(t)
	adminTok := seedSession(t, ctx, s, "admin1", "admin1@example.test", true)

	wsID := opaque()
	if _, e := s.DB.Exec(ctx, `INSERT INTO workspaces(id,slug,name) VALUES($1,'equipe','Équipe')`, wsID); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DB.Exec(ctx, `INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,'admin1','admin') ON CONFLICT DO NOTHING`, wsID); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DB.Exec(ctx, `INSERT INTO pages(id,workspace_id,metadata) VALUES('page-ws',$1,'{"title":"Hidden"}')`, wsID); e != nil {
		t.Fatal(e)
	}

	out := request("GET", "/api/admin/workspaces", adminTok, nil, 200)
	assertNoPageKeys(t, "GET /api/admin/workspaces", out)
	list, ok := out["workspaces"].([]any)
	if !ok || len(list) < 1 {
		t.Fatalf("expected workspaces list, got %#v", out)
	}
	ws := list[0].(map[string]any)
	for _, key := range []string{"id", "slug", "name", "memberCount"} {
		if _, ok := ws[key]; !ok {
			t.Fatalf("workspace missing %q: %#v", key, ws)
		}
	}
	if _, has := ws["pageCount"]; has {
		t.Fatal("pageCount must not appear in admin workspace list")
	}
	if ws["memberCount"].(float64) < 1 {
		t.Fatalf("memberCount = %v", ws["memberCount"])
	}
}

func TestAdminRoutesForbiddenForNonAdmin(t *testing.T) {
	ctx, s, _, request := instanceWorld(t)
	memberTok := seedSession(t, ctx, s, "member1", "member1@example.test", false)
	paths := []struct {
		method, path string
		body         any
	}{
		{"GET", "/api/admin/users", nil},
		{"POST", "/api/admin/users", map[string]any{"email": "x@example.test"}},
		{"GET", "/api/admin/workspaces", nil},
		{"POST", "/api/admin/email-test", map[string]any{"email": "x@example.test"}},
	}
	for _, p := range paths {
		request(p.method, p.path, memberTok, p.body, 403)
		request(p.method, p.path, "", p.body, 401)
	}
}

func TestAdminCreateUserWithoutWorkspace(t *testing.T) {
	ctx, s, _, request := instanceWorld(t)
	adminTok := seedSession(t, ctx, s, "admin1", "admin1@example.test", true)

	out := request("POST", "/api/admin/users", adminTok, map[string]any{
		"email": "newbie@example.test",
		"name":  "Newbie",
	}, 201)
	if out["email"] != "newbie@example.test" || out["name"] != "Newbie" {
		t.Fatalf("create user response: %#v", out)
	}
	var n int
	if e := s.DB.QueryRow(ctx, `SELECT count(*) FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email='newbie@example.test'`).Scan(&n); e != nil {
		t.Fatal(e)
	}
	if n != 0 {
		t.Fatalf("created user should have no workspace membership, got %d", n)
	}
	request("POST", "/api/admin/users", adminTok, map[string]any{"email": "newbie@example.test"}, 409)
}

func TestAdminPatchAndDeleteLastAdminConflicts(t *testing.T) {
	ctx, s, _, request := instanceWorld(t)
	adminTok := seedSession(t, ctx, s, "only-admin", "only@example.test", true)

	out := request("PATCH", "/api/admin/users/only-admin", adminTok, map[string]any{
		"instanceAdmin": false,
	}, 409)
	if err, _ := out["error"].(string); !strings.Contains(err, "Keep at least one instance administrator") {
		t.Fatalf("PATCH last admin error: %#v", out)
	}

	out = request("DELETE", "/api/admin/users/only-admin", adminTok, nil, 409)
	if err, _ := out["error"].(string); !strings.Contains(err, "Keep at least one instance administrator") {
		t.Fatalf("DELETE last admin error: %#v", out)
	}
}

func TestAdminPatchPromoteDemoteAndRename(t *testing.T) {
	ctx, s, _, request := instanceWorld(t)
	adminTok := seedSession(t, ctx, s, "admin1", "admin1@example.test", true)
	_ = seedSession(t, ctx, s, "member1", "member1@example.test", false)

	out := request("PATCH", "/api/admin/users/member1", adminTok, map[string]any{
		"instanceAdmin": true,
		"name":          "Promoted",
	}, 200)
	if out["instanceAdmin"] != true || out["name"] != "Promoted" {
		t.Fatalf("promote: %#v", out)
	}
	out = request("PATCH", "/api/admin/users/member1", adminTok, map[string]any{
		"instanceAdmin": false,
	}, 200)
	if out["instanceAdmin"] != false {
		t.Fatalf("demote: %#v", out)
	}
}

func TestAdminDeleteUserTransactionally(t *testing.T) {
	ctx, s, _, request := instanceWorld(t)
	adminTok := seedSession(t, ctx, s, "admin1", "admin1@example.test", true)
	_ = seedSession(t, ctx, s, "gone", "gone@example.test", false)

	wsID := opaque()
	if _, e := s.DB.Exec(ctx, `INSERT INTO workspaces(id,slug,name) VALUES($1,'equipe','Équipe')`, wsID); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DB.Exec(ctx, `INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,'gone','member')`, wsID); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DB.Exec(ctx, `INSERT INTO pages(id,workspace_id,metadata) VALUES('p1',$1,'{}')`, wsID); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DB.Exec(ctx, `INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES('p1','gone','view','gone')`); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DB.Exec(ctx, `INSERT INTO workspace_emojis(id,workspace_id,name,url,created_by) VALUES('e1',$1,'wave','/files/x','gone')`, wsID); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DB.Exec(ctx, `INSERT INTO mcp_tokens(id,user_id,label,expires_at) VALUES('tok1','gone','t',now()+interval '1 day')`); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DB.Exec(ctx, `INSERT INTO ai_credentials(scope,owner_id,encrypted_key) VALUES('personal','gone',$1)`, []byte{0}); e != nil {
		t.Fatal(e)
	}

	request("DELETE", "/api/admin/users/gone", adminTok, nil, 200)

	var exists bool
	if e := s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id='gone')`).Scan(&exists); e != nil {
		t.Fatal(e)
	}
	if exists {
		t.Fatal("user still present after delete")
	}
	var emojiBy string
	if e := s.DB.QueryRow(ctx, `SELECT created_by FROM workspace_emojis WHERE id='e1'`).Scan(&emojiBy); e != nil {
		t.Fatal(e)
	}
	if emojiBy != "admin1" {
		t.Fatalf("emoji created_by = %q, want reassigned to admin1", emojiBy)
	}
	var shareCount int
	if e := s.DB.QueryRow(ctx, `SELECT count(*) FROM page_shares WHERE user_id='gone'`).Scan(&shareCount); e != nil {
		t.Fatal(e)
	}
	if shareCount != 0 {
		t.Fatalf("page_shares for deleted user remain: %d", shareCount)
	}
}

func TestAdminEmailTestReturnsBackend(t *testing.T) {
	ctx, s, _, request := instanceWorld(t)
	adminTok := seedSession(t, ctx, s, "admin1", "admin1@example.test", true)

	out := request("POST", "/api/admin/email-test", adminTok, map[string]any{
		"email": "probe@example.test",
	}, 200)
	if out["ok"] != true {
		t.Fatalf("email-test ok: %#v", out)
	}
	backend, _ := out["backend"].(string)
	if backend != "injected" {
		t.Fatalf("backend = %q, want injected (test Deliver hook)", backend)
	}

	// Force a delivery failure path and still get backend in the 503 body.
	s.Config.Deliver = func(string, string, string) error {
		return context.DeadlineExceeded
	}
	out = request("POST", "/api/admin/email-test", adminTok, map[string]any{
		"email": "probe2@example.test",
	}, 503)
	if _, ok := out["error"]; !ok {
		t.Fatalf("503 missing error: %#v", out)
	}
	if out["backend"] != "injected" {
		t.Fatalf("503 backend = %v", out["backend"])
	}
}

func TestMailBackendMatchesSendSelection(t *testing.T) {
	cases := []struct {
		name string
		cfg  Config
		want string
	}{
		{"injected wins over everything", Config{
			Deliver: func(string, string, string) error { return nil },
			Development: true, DevelopmentMailDirectory: "/tmp",
			SMTPHost: "smtp.test", ResendAPIKey: "re_x",
		}, "injected"},
		{"development before smtp", Config{
			Development: true, DevelopmentMailDirectory: "/tmp",
			SMTPHost: "smtp.test", ResendAPIKey: "re_x",
		}, "development"},
		{"smtp wins over residual resend", Config{
			SMTPHost: "smtp.test", ResendAPIKey: "re_legacy",
		}, "smtp"},
		{"resend when no smtp", Config{ResendAPIKey: "re_x"}, "resend"},
		{"empty when nothing configured", Config{}, ""},
		{"development without directory falls through to smtp", Config{
			Development: true, SMTPHost: "smtp.test",
		}, "smtp"},
		{"development without directory falls through to resend", Config{
			Development: true, ResendAPIKey: "re_x",
		}, "resend"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.cfg.mailBackend(); got != tc.want {
				t.Fatalf("mailBackend() = %q, want %q", got, tc.want)
			}
		})
	}
}

package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func instanceWorld(t *testing.T) (context.Context, *Service, *httptest.Server, func(method, path, token string, payload any, status int) map[string]any) {
	t.Helper()
	ctx, _, open := permissionsFixture(t)
	s := open()
	server := httptest.NewServer(s.Handler())
	t.Cleanup(server.Close)
	request := func(method, path, token string, payload any, status int) map[string]any {
		t.Helper()
		var b io.Reader
		if payload != nil {
			encoded, _ := json.Marshal(payload)
			b = bytes.NewReader(encoded)
		}
		req, _ := http.NewRequest(method, server.URL+path, b)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", s.Config.PublicURL)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != status {
			t.Fatalf("%s %s: got %d expected %d: %s", method, path, resp.StatusCode, status, body)
		}
		var out map[string]any
		_ = json.Unmarshal(body, &out)
		return out
	}
	return ctx, s, server, request
}

func seedSession(t *testing.T, ctx context.Context, s *Service, userID, email string, admin bool) string {
	t.Helper()
	if _, e := s.DB.Exec(ctx, `INSERT INTO users(id,email) VALUES($1,$2) ON CONFLICT(email) DO NOTHING`, userID, email); e != nil {
		t.Fatal(e)
	}
	if admin {
		if _, e := s.DB.Exec(ctx, `INSERT INTO instance_admins(user_id) VALUES($1) ON CONFLICT DO NOTHING`, userID); e != nil {
			t.Fatal(e)
		}
	}
	token := opaque()
	if _, e := s.DB.Exec(ctx, `INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')`, hash(token), userID); e != nil {
		t.Fatal(e)
	}
	return token
}

func TestInstanceAdminFlagInSession(t *testing.T) {
	ctx, s, _, request := instanceWorld(t)
	adminTok := seedSession(t, ctx, s, "admin1", "admin1@example.test", true)
	memberTok := seedSession(t, ctx, s, "member1", "member1@example.test", false)

	adminSession := request("GET", "/api/session", adminTok, nil, 200)
	user := adminSession["user"].(map[string]any)
	if user["instanceAdmin"] != true {
		t.Fatalf("admin instanceAdmin = %v, want true", user["instanceAdmin"])
	}

	memberSession := request("GET", "/api/session", memberTok, nil, 200)
	member := memberSession["user"].(map[string]any)
	if member["instanceAdmin"] != false {
		t.Fatalf("member instanceAdmin = %v, want false", member["instanceAdmin"])
	}
}

func TestAdminSettingsForbiddenForNonAdmin(t *testing.T) {
	ctx, s, _, request := instanceWorld(t)
	memberTok := seedSession(t, ctx, s, "member1", "member1@example.test", false)
	request("GET", "/api/admin/settings", memberTok, nil, 403)
	request("PATCH", "/api/admin/settings", memberTok, map[string]any{"signupPolicy": "open"}, 403)
	request("GET", "/api/admin/settings", "", nil, 401)
}

func TestAdminSettingsPatchRequiresAdminAndUpdatesCache(t *testing.T) {
	ctx, s, _, request := instanceWorld(t)
	adminTok := seedSession(t, ctx, s, "admin1", "admin1@example.test", true)
	out := request("PATCH", "/api/admin/settings", adminTok, map[string]any{
		"name":              "Acme",
		"signupPolicy":      "open",
		"workspaceCreation": "anyone",
	}, 200)
	if out["name"] != "Acme" || out["signupPolicy"] != "open" || out["workspaceCreation"] != "anyone" {
		t.Fatalf("unexpected PATCH response: %#v", out)
	}
	if s.settings().Name != "Acme" || s.settings().SignupPolicy != "open" {
		t.Fatalf("cache not updated: %+v", s.settings())
	}
	got := request("GET", "/api/admin/settings", adminTok, nil, 200)
	if got["name"] != "Acme" {
		t.Fatalf("GET settings name = %v", got["name"])
	}
}

func TestRevokeLastInstanceAdminConflicts(t *testing.T) {
	ctx, s, _, _ := instanceWorld(t)
	if _, e := s.DB.Exec(ctx, `INSERT INTO users(id,email) VALUES('only','only@example.test')`); e != nil {
		t.Fatal(e)
	}
	if _, e := s.GrantInstanceAdmin(ctx, "only@example.test"); e != nil {
		t.Fatal(e)
	}
	e := s.RevokeInstanceAdmin(ctx, "only@example.test")
	if e == nil || !strings.Contains(e.Error(), "Keep at least one instance administrator") {
		t.Fatalf("revoke last admin: %v", e)
	}
}

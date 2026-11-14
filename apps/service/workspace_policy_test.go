package cloud

import (
	"testing"
)

func TestWorkspacePolicyAnyoneAllowsSignedInUser(t *testing.T) {
	ctx, s, _, request := instanceWorld(t)
	if _, e := s.applySettings(ctx, SettingsPatch{WorkspaceCreation: strPtr("anyone")}); e != nil {
		t.Fatal(e)
	}
	tok := seedSession(t, ctx, s, "user1", "user1@example.test", false)
	out := request("POST", "/api/workspaces", tok, map[string]any{"name": "Mine", "slug": "mine-ws"}, 201)
	if out["slug"] != "mine-ws" || out["name"] != "Mine" || out["role"] != "admin" {
		t.Fatalf("unexpected workspace: %#v", out)
	}
}

func TestWorkspacePolicyAdminsOnly(t *testing.T) {
	ctx, s, _, request := instanceWorld(t)
	if s.settings().WorkspaceCreation != "admins_only" {
		t.Fatalf("fixture workspaceCreation = %q, want admins_only", s.settings().WorkspaceCreation)
	}
	member := seedSession(t, ctx, s, "member1", "member1@example.test", false)
	admin := seedSession(t, ctx, s, "admin1", "admin1@example.test", true)

	denied := request("POST", "/api/workspaces", member, map[string]any{"name": "Nope", "slug": "nope-ws"}, 403)
	if denied["error"] != "Instance administrator required" {
		t.Fatalf("non-admin error = %v", denied["error"])
	}

	out := request("POST", "/api/workspaces", admin, map[string]any{"name": "Admin Space", "slug": "admin-ws"}, 201)
	if out["slug"] != "admin-ws" || out["role"] != "admin" {
		t.Fatalf("admin create: %#v", out)
	}
}

func TestWorkspacePolicyDisabledBlocksEveryone(t *testing.T) {
	ctx, s, _, request := instanceWorld(t)
	if _, e := s.applySettings(ctx, SettingsPatch{WorkspaceCreation: strPtr("disabled")}); e != nil {
		t.Fatal(e)
	}
	member := seedSession(t, ctx, s, "member1", "member1@example.test", false)
	admin := seedSession(t, ctx, s, "admin1", "admin1@example.test", true)

	for _, tok := range []string{member, admin} {
		denied := request("POST", "/api/workspaces", tok, map[string]any{"name": "Nope", "slug": "disabled-ws"}, 403)
		if denied["error"] != "Workspace creation is disabled on this instance" {
			t.Fatalf("disabled error = %v", denied["error"])
		}
	}
}

func TestWorkspacePolicyAdminRouteBypassesDisabled(t *testing.T) {
	ctx, s, _, request := instanceWorld(t)
	if _, e := s.applySettings(ctx, SettingsPatch{WorkspaceCreation: strPtr("disabled")}); e != nil {
		t.Fatal(e)
	}
	member := seedSession(t, ctx, s, "member1", "member1@example.test", false)
	admin := seedSession(t, ctx, s, "admin1", "admin1@example.test", true)

	request("POST", "/api/admin/workspaces", member, map[string]any{"name": "Nope", "slug": "admin-bypass-no"}, 403)

	out := request("POST", "/api/admin/workspaces", admin, map[string]any{"name": "Rescue", "slug": "admin-bypass"}, 201)
	if out["slug"] != "admin-bypass" || out["name"] != "Rescue" || out["role"] != "admin" {
		t.Fatalf("admin bypass create: %#v", out)
	}
}

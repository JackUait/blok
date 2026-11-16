package cloud

import "testing"

func TestWorkspaceMembersIncludeProfileIdentity(t *testing.T) {
	w := newReadsWorld(t)
	if _, err := w.service.DB.Exec(w.ctx, `UPDATE users SET name='Camille',avatar_url='https://example.test/avatar.png' WHERE id='bob'`); err != nil {
		t.Fatal(err)
	}
	status, payload := w.get(t, tokenAlice, "/api/workspaces/equipe/members")
	if status != 200 {
		t.Fatalf("members status: %d", status)
	}
	members, _ := payload["members"].([]any)
	for _, entry := range members {
		member, _ := entry.(map[string]any)
		if member["id"] == "bob" {
			if member["name"] != "Camille" || member["avatarUrl"] != "https://example.test/avatar.png" {
				t.Fatal("member directory drops the profile identity")
			}
			return
		}
	}
	t.Fatal("workspace member missing")
}

func TestMemberProfilesStayInsideTheAuthorizedWorkspace(t *testing.T) {
	w := newReadsWorld(t)
	for _, query := range []string{
		`INSERT INTO workspaces(id,slug,name) VALUES('other','other','Other')`,
		`INSERT INTO users(id,email,name) VALUES('outsider','outside@example.test','Outside')`,
		`INSERT INTO memberships(workspace_id,user_id,role) VALUES('other','outsider','member')`,
	} {
		if _, err := w.service.DB.Exec(w.ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	status, payload := w.get(t, tokenAlice, "/api/workspaces/equipe/members")
	if status != 200 {
		t.Fatalf("members status: %d", status)
	}
	members, _ := payload["members"].([]any)
	for _, entry := range members {
		member, _ := entry.(map[string]any)
		if member["id"] == "outsider" {
			t.Fatal("other workspace profile leaked")
		}
	}
	if status, _ := w.get(t, tokenAlice, "/api/workspaces/other/members"); status != 403 {
		t.Fatalf("other workspace status: %d", status)
	}
}

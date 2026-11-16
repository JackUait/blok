package cloud

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

// Exercise the public MCP transport with real MCP credentials, not session cookies.
func managementCall(t *testing.T, w *readsWorld, user, tool string, args map[string]any, wantError bool) map[string]any {
	t.Helper()
	token := "management-" + user
	if _, err := w.service.DB.Exec(w.ctx, `INSERT INTO mcp_tokens(id,user_id,label,expires_at) VALUES($1,$2,'test',now()+interval '1 hour') ON CONFLICT(id) DO NOTHING`, hash(token), user); err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": tool, "arguments": args}})
	req, _ := http.NewRequest("POST", w.server.URL+"/mcp", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		t.Fatalf("%s: HTTP %d: %s", tool, resp.StatusCode, data)
	}
	if strings.Contains(string(data), "data: ") {
		data = []byte(strings.SplitN(strings.SplitN(string(data), "data: ", 2)[1], "\n", 2)[0])
	}
	var envelope struct {
		Error  json.RawMessage `json:"error"`
		Result struct {
			IsError bool `json:"isError"`
			Content []struct {
				Text string `json:"text"`
			} `json:"content"`
		} `json:"result"`
	}
	if json.Unmarshal(data, &envelope) != nil || len(envelope.Error) > 0 {
		t.Fatalf("%s protocol: %s", tool, data)
	}
	if envelope.Result.IsError != wantError || len(envelope.Result.Content) == 0 {
		t.Fatalf("%s want error=%v: %s", tool, wantError, data)
	}
	var out map[string]any
	if json.Unmarshal([]byte(envelope.Result.Content[0].Text), &out) != nil {
		t.Fatalf("%s not structured JSON: %s", tool, data)
	}
	return out
}

func TestMCPManagementTeamspaceLifecycle(t *testing.T) {
	w := newReadsWorld(t)
	call := func(user, tool string, args map[string]any, fail bool) map[string]any {
		return managementCall(t, w, user, tool, args, fail)
	}
	denied := call("alice", "blok_create_teamspace", map[string]any{"workspace": "equipe", "name": "Forbidden"}, true)
	if denied["status"] != float64(403) {
		t.Fatal(denied)
	}
	created := call("zoe", "blok_create_teamspace", map[string]any{"workspace": "equipe", "name": "Docs", "icon": "📚"}, false)
	id := created["id"].(string)
	call("bob", "blok_list_teamspace_members", map[string]any{"workspace": "equipe", "teamspaceId": id}, true)
	call("zoe", "blok_set_teamspace_member", map[string]any{"workspace": "equipe", "teamspaceId": id, "userId": "alice", "role": "owner"}, false)
	updated := call("alice", "blok_update_teamspace", map[string]any{"workspace": "equipe", "teamspaceId": id, "name": "Knowledge", "icon": nil}, false)
	if updated["name"] != "Knowledge" || updated["icon"] != nil {
		t.Fatal(updated)
	}
	call("alice", "blok_remove_teamspace_member", map[string]any{"workspace": "equipe", "teamspaceId": id, "userId": "zoe"}, false)
	last := call("alice", "blok_remove_teamspace_member", map[string]any{"workspace": "equipe", "teamspaceId": id, "userId": "alice"}, true)
	if last["status"] != float64(409) {
		t.Fatal(last)
	}
	page := call("alice", "blok_create_page", map[string]any{"workspace": "equipe", "teamspaceId": id, "title": "Guide"}, false)["id"].(string)
	w.assertMCPPage(t, "alice", page, true, true)
	call("alice", "blok_archive_teamspace", map[string]any{"workspace": "equipe", "teamspaceId": id}, false)
	w.assertMCPPage(t, "alice", page, false, false)
	call("alice", "blok_restore_teamspace", map[string]any{"workspace": "equipe", "teamspaceId": id}, false)
	w.assertMCPPage(t, "alice", page, true, true)
	// A token remains confined to MCP; enabling management must not turn it into a session.
	w.send(t, "POST", "management-zoe", "/api/workspaces/equipe/teamspaces", map[string]any{"name": "No REST bypass"}, 401)
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO workspaces(id,slug,name) VALUES('other','other','Other'); INSERT INTO memberships VALUES('other','zoe','admin')`); e != nil {
		t.Fatal(e)
	}
	call("zoe", "blok_update_teamspace", map[string]any{"workspace": "other", "teamspaceId": id, "name": "Wrong workspace"}, true)
}

func TestMCPManagementAdminBoundaries(t *testing.T) {
	w := newReadsWorld(t)
	call := func(user, tool string, args map[string]any, fail bool) map[string]any {
		return managementCall(t, w, user, tool, args, fail)
	}
	call("alice", "blok_update_workspace", map[string]any{"workspace": "equipe", "name": "No"}, true)
	ws := call("zoe", "blok_update_workspace", map[string]any{"workspace": "equipe", "name": "Docs", "icon": "📚"}, false)
	if ws["name"] != "Docs" {
		t.Fatal(ws)
	}
	call("zoe", "blok_set_workspace_member_role", map[string]any{"workspace": "equipe", "userId": "bob", "role": "viewer"}, false)
	call("bob", "blok_create_teamspace", map[string]any{"workspace": "equipe", "name": "No"}, true)
	call("zoe", "blok_remove_workspace_member", map[string]any{"workspace": "equipe", "userId": "zoe"}, true)
	// Workspace administration never implies instance administration.
	call("zoe", "blok_get_instance_settings", map[string]any{}, true)
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO instance_admins(user_id) VALUES('zoe')`); e != nil {
		t.Fatal(e)
	}
	call("zoe", "blok_get_instance_settings", map[string]any{}, false)
	call("zoe", "blok_update_instance_settings", map[string]any{"workspaceCreation": "admins_only"}, false)
	call("alice", "blok_create_workspace", map[string]any{"slug": "forbidden", "name": "No"}, true)
	call("zoe", "blok_create_workspace", map[string]any{"slug": "new-workspace", "name": "New"}, false)
	call("zoe", "blok_update_instance_user", map[string]any{"userId": "zoe", "instanceAdmin": false}, true)
	// Reusing the same MCP token after demotion cannot retain authority.
	if _, e := w.service.DB.Exec(w.ctx, `DELETE FROM instance_admins WHERE user_id='zoe'; UPDATE memberships SET role='member' WHERE user_id='zoe'`); e != nil {
		t.Fatal(e)
	}
	call("zoe", "blok_get_instance_settings", map[string]any{}, true)
	call("zoe", "blok_update_workspace", map[string]any{"workspace": "equipe", "name": "No stale admin"}, true)
}

func TestMCPManagementPageAccessAndBinding(t *testing.T) {
	w := newReadsWorld(t)
	call := func(user, tool string, args map[string]any, fail bool) map[string]any {
		return managementCall(t, w, user, tool, args, fail)
	}
	// Admin must not gain visibility into another member's private page.
	call("zoe", "blok_get_page_access", map[string]any{"workspace": "equipe", "pageId": "prive"}, true)
	call("bob", "blok_set_page_share", map[string]any{"workspace": "equipe", "pageId": "prive", "userId": "alice", "level": "view"}, false)
	access := call("alice", "blok_get_page_access", map[string]any{"workspace": "equipe", "pageId": "prive"}, false)
	if access["myLevel"] != "view" {
		t.Fatal(access)
	}
	call("alice", "blok_set_page_share", map[string]any{"workspace": "equipe", "pageId": "prive", "userId": "zoe", "level": "full"}, true)
	call("bob", "blok_remove_page_share", map[string]any{"workspace": "equipe", "pageId": "prive", "userId": "alice"}, false)
	w.assertMCPPage(t, "alice", "prive", false, false)
	call("bob", "blok_set_page_visibility", map[string]any{"workspace": "equipe", "pageId": "prive", "visibility": "workspace"}, false)
	w.assertMCPPage(t, "alice", "prive", true, true)
	id := w.newTeamspace(t, "Restricted")
	w.tsMember(t, id, "bob", "owner")
	call("bob", "blok_set_page_teamspace", map[string]any{"workspace": "equipe", "pageId": "prive", "teamspaceId": id}, false)
	w.assertMCPPage(t, "alice", "prive", false, false)
	w.assertMCPPage(t, "alice", "enfant", false, false)
	call("bob", "blok_set_page_teamspace", map[string]any{"workspace": "equipe", "pageId": "prive", "teamspaceId": nil}, false)
	w.assertMCPPage(t, "alice", "enfant", true, true)
}

func TestMCPManagementDiscoveryAndAccounts(t *testing.T) {
	w := newReadsWorld(t)
	call := func(user, tool string, args map[string]any, fail bool) map[string]any {
		return managementCall(t, w, user, tool, args, fail)
	}
	cap := call("alice", "blok_capabilities", map[string]any{}, false)
	if cap["user"].(map[string]any)["instanceAdmin"] != false {
		t.Fatal(cap)
	}
	call("alice", "blok_list_instance_users", map[string]any{}, true)
	call("alice", "blok_list_workspace_invites", map[string]any{"workspace": "equipe"}, true)
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO instance_admins(user_id) VALUES('zoe')`); e != nil {
		t.Fatal(e)
	}
	created := call("zoe", "blok_create_instance_user", map[string]any{"email": "new@example.test", "name": "New account"}, false)
	id := created["id"].(string)
	call("zoe", "blok_update_instance_user", map[string]any{"userId": id, "name": "Renamed"}, false)
	users := call("zoe", "blok_list_instance_users", map[string]any{"limit": 1, "offset": 1}, false)
	if len(users["users"].([]any)) != 1 || users["total"] != float64(4) {
		t.Fatal(users)
	}
	call("zoe", "blok_list_instance_workspaces", map[string]any{"limit": 1}, false)
	call("zoe", "blok_invite_workspace_member", map[string]any{"workspace": "equipe", "email": "new@example.test", "role": "member"}, false)
	invites := call("zoe", "blok_list_workspace_invites", map[string]any{"workspace": "equipe"}, false)["invites"].([]any)
	call("zoe", "blok_revoke_workspace_invite", map[string]any{"workspace": "equipe", "inviteId": invites[0].(map[string]any)["id"]}, false)
	call("zoe", "blok_list_workspace_members", map[string]any{"workspace": "equipe"}, false)
	for _, request := range []string{"approve-me", "reject-me"} {
		if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO join_requests(id,workspace_id,user_id,message) VALUES($1,'w',$2,'Please')`, request, id); e != nil {
			t.Fatal(e)
		}
		call("zoe", "blok_list_join_requests", map[string]any{"workspace": "equipe"}, false)
		tool := "blok_approve_join_request"
		if request == "reject-me" {
			tool = "blok_reject_join_request"
		}
		call("zoe", tool, map[string]any{"workspace": "equipe", "requestId": request}, false)
		if _, e := w.service.DB.Exec(w.ctx, `DELETE FROM join_requests WHERE id=$1`, request); e != nil {
			t.Fatal(e)
		}
	}
	call("zoe", "blok_delete_instance_user", map[string]any{"userId": id}, false)
	// No handler can receive fields the tool did not declare, or request an arbitrary endpoint.
	call("zoe", "blok_update_workspace", map[string]any{"workspace": "equipe", "name": "No", "instanceAdmin": true}, true)
}

func TestMCPManagementCustomEmojis(t *testing.T) {
	w := newReadsWorld(t)
	call := func(user, tool string, args map[string]any, fail bool) map[string]any {
		return managementCall(t, w, user, tool, args, fail)
	}
	created := call("alice", "blok_create_custom_emoji", map[string]any{"workspace": "equipe", "name": "My_Logo", "dataUrl": tinyPNG}, false)
	id, imageURL := created["id"].(string), created["url"].(string)
	if created["name"] != "my_logo" || !strings.HasPrefix(imageURL, "/files/") {
		t.Fatal(created)
	}
	call("bob", "blok_rename_custom_emoji", map[string]any{"workspace": "equipe", "emojiId": id, "name": "No"}, true)
	renamed := call("alice", "blok_rename_custom_emoji", map[string]any{"workspace": "equipe", "emojiId": id, "name": "brand"}, false)
	if renamed["id"] != id || renamed["url"] != imageURL || renamed["name"] != "brand" {
		t.Fatal(renamed)
	}
	call("alice", "blok_create_custom_emoji", map[string]any{"workspace": "equipe", "name": "brand", "url": imageURL}, true)
	call("alice", "blok_create_custom_emoji", map[string]any{"workspace": "equipe", "name": "second", "url": imageURL}, false)
	call("alice", "blok_create_custom_emoji", map[string]any{"workspace": "equipe", "name": "private", "url": "/files/secret.png"}, true)
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO workspaces(id,slug,name) VALUES('elsewhere','elsewhere','Elsewhere');INSERT INTO memberships VALUES('elsewhere','alice','admin'); UPDATE memberships SET role='viewer' WHERE user_id='bob'`); e != nil {
		t.Fatal(e)
	}
	call("alice", "blok_create_custom_emoji", map[string]any{"workspace": "elsewhere", "name": "foreign", "url": imageURL}, true)
	call("bob", "blok_list_custom_emojis", map[string]any{"workspace": "equipe"}, false)
	call("bob", "blok_create_custom_emoji", map[string]any{"workspace": "equipe", "name": "viewer", "dataUrl": tinyPNG}, true)
	call("bob", "blok_delete_custom_emoji", map[string]any{"workspace": "equipe", "emojiId": id}, true)
	call("zoe", "blok_rename_custom_emoji", map[string]any{"workspace": "equipe", "emojiId": id, "name": "official"}, false)
	call("zoe", "blok_delete_custom_emoji", map[string]any{"workspace": "equipe", "emojiId": id}, false)
	// Removing a registry entry must not break icons already using the uploaded image.
	fetch := func(raw, token string, want int) {
		t.Helper()
		req, _ := http.NewRequest("GET", raw, nil)
		if token != "" {
			req.AddCookie(&http.Cookie{Name: "blok_session", Value: token})
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		data, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != want {
			t.Fatalf("asset: %d want %d", resp.StatusCode, want)
		}
		if want == 200 && (!bytes.HasPrefix(data, []byte{137, 80, 78, 71}) || !strings.HasPrefix(resp.Header.Get("Content-Type"), "image/png")) {
			t.Fatal("not a rendered PNG response")
		}
	}
	fetch(w.server.URL+imageURL, "", 401)
	fetch(w.server.URL+imageURL, tokenAlice, 200)
	signed := w.send(t, "GET", tokenAlice, "/api/assets/url?url="+imageURL, nil, 200)["url"].(string)
	fetch(signed, "", 200)
}

package cloud

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
)

const sidebarPresetsJSON = `{"presets":[{"id":"work","name":"Work","default":true,"tab":{"id":"work-tab","name":"Work","icon":"home","shortcuts":[{"id":"create","kind":"new-page","visible":true}],"sections":[{"id":"recents","visible":true,"limit":5,"sort":"updated"},{"id":"favorites","visible":true,"limit":0,"sort":"manual"},{"id":"teamspaces","visible":true,"limit":10,"sort":"manual"},{"id":"shared","visible":false,"limit":20,"sort":"updated"},{"id":"private","visible":true,"limit":50,"sort":"manual"}]}}]}`

func TestSidebarPresetsValidation(t *testing.T) {
	cases := []struct {
		name, raw string
		valid     bool
	}{
		{"valid", sidebarPresetsJSON, true},
		{"lucide icon", strings.Replace(sidebarPresetsJSON, `"icon":"home"`, `"icon":"rocket"`, 1), true},
		{"empty", `{"presets":[]}`, false},
		{"no default", strings.Replace(sidebarPresetsJSON, `"default":true`, `"default":false`, 1), false},
		{"private page pointer", strings.Replace(sidebarPresetsJSON, `"kind":"new-page"`, `"kind":"page","pageId":"private-page"`, 1), false},
		{"hidden page pointer", strings.Replace(sidebarPresetsJSON, `"kind":"new-page"`, `"kind":"new-page","pageId":"private-page"`, 1), false},
		{"unknown icon", strings.Replace(sidebarPresetsJSON, `"icon":"home"`, `"icon":"script"`, 1), false},
		{"blank name", strings.Replace(sidebarPresetsJSON, `"name":"Work"`, `"name":" "`, 1), false},
		{"duplicate section", strings.Replace(sidebarPresetsJSON, `"id":"recents"`, `"id":"favorites"`, 1), false},
		{"invalid limit", strings.Replace(sidebarPresetsJSON, `"limit":5`, `"limit":100`, 1), false},
		{"invalid sort", strings.Replace(sidebarPresetsJSON, `"sort":"updated"`, `"sort":"random"`, 1), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var in sidebarPresetsPayload
			if err := json.Unmarshal([]byte(c.raw), &in); err != nil {
				t.Fatal(err)
			}
			if err := validateSidebarPresets(in); (err == nil) != c.valid {
				t.Fatalf("valid=%v error=%v", c.valid, err)
			}
		})
	}
}

func TestSidebarPresetsWorkspaceIsolation(t *testing.T) {
	ctx, _, open := permissionsFixture(t)
	s := open()
	seedWorld(t, ctx, s)
	for _, query := range []string{
		`INSERT INTO workspaces(id,slug,name) VALUES('other','other','Other')`,
		`INSERT INTO users(id,email) VALUES('guest','guest@example.test'),('viewer','viewer@example.test')`,
		`INSERT INTO memberships VALUES('other','alice','admin'),('w','viewer','viewer')`,
	} {
		if _, err := s.DB.Exec(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	tokens := map[string]string{}
	for _, user := range []string{"alice", "zoe", "guest", "viewer"} {
		tokens[user] = opaque()
		if _, err := s.DB.Exec(ctx, `INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')`, hash(tokens[user]), user); err != nil {
			t.Fatal(err)
		}
	}
	request := func(service *Service, method, slug, user, raw string, status int) string {
		t.Helper()
		req := httptest.NewRequest(method, "/api/workspaces/"+slug+"/sidebar-presets", strings.NewReader(raw))
		req.Header.Set("Origin", service.Config.PublicURL)
		if user != "" {
			req.Header.Set("Authorization", "Bearer "+tokens[user])
		}
		rec := httptest.NewRecorder()
		service.Handler().ServeHTTP(rec, req)
		if rec.Code != status {
			t.Fatalf("%s %s %s: %d want %d: %s", method, slug, user, rec.Code, status, rec.Body.String())
		}
		return strings.TrimSpace(rec.Body.String())
	}
	if got := request(s, "GET", "w", "alice", "", 200); got != `{"presets":[]}` {
		t.Fatalf("fresh defaults: %s", got)
	}
	request(s, "PUT", "w", "zoe", sidebarPresetsJSON, 200)
	got := request(s, "GET", "w", "alice", "", 200)
	var saved sidebarPresetsPayload
	if err := json.Unmarshal([]byte(got), &saved); err != nil || len(saved.Presets) != 1 || saved.Presets[0].Name != "Work" {
		t.Fatalf("saved defaults: %s %v", got, err)
	}
	request(s, "GET", "w", "viewer", "", 200)
	for _, user := range []string{"alice", "viewer", "guest"} {
		request(s, "PUT", "w", user, sidebarPresetsJSON, 403)
	}
	request(s, "GET", "w", "guest", "", 403)
	request(s, "GET", "w", "", "", 401)
	request(s, "PUT", "other", "zoe", sidebarPresetsJSON, 403)
	if got := request(s, "GET", "other", "alice", "", 200); got != `{"presets":[]}` {
		t.Fatalf("cross-workspace leak: %s", got)
	}
	request(s, "PUT", "w", "zoe", strings.Replace(sidebarPresetsJSON, `"kind":"new-page"`, `"kind":"page","pageId":"private"`, 1), 400)
	request(s, "PUT", "w", "zoe", strings.Replace(sidebarPresetsJSON, `"name":"Work"`, `"unknown":true,"name":"Work"`, 1), 400)
	request(s, "PUT", "w", "zoe", sidebarPresetsJSON+` {}`, 400)
	request(s, "PUT", "w", "zoe", strings.Repeat(" ", 65537)+sidebarPresetsJSON, 400)
	restarted := open()
	if after := request(restarted, "GET", "w", "alice", "", 200); after != got {
		t.Fatalf("restart changed stored configuration: %s", after)
	}
}

func TestSidebarPresetsBounds(t *testing.T) {
	fresh := func() sidebarPresetsPayload {
		var in sidebarPresetsPayload
		if err := json.Unmarshal([]byte(sidebarPresetsJSON), &in); err != nil {
			t.Fatal(err)
		}
		return in
	}
	in := fresh()
	for i := 1; i < 6; i++ {
		preset := fresh().Presets[0]
		preset.ID = fmt.Sprint("preset-", i)
		preset.Tab.ID = fmt.Sprint("tab-", i)
		in.Presets = append(in.Presets, preset)
	}
	if err := validateSidebarPresets(in); err != nil {
		t.Fatalf("six presets rejected: %v", err)
	}
	in.Presets = append(in.Presets, fresh().Presets[0])
	if validateSidebarPresets(in) == nil {
		t.Fatal("accepted seven presets")
	}
	in = fresh()
	in.Presets = append(in.Presets, in.Presets[0])
	if validateSidebarPresets(in) == nil {
		t.Fatal("accepted duplicate preset IDs")
	}
	in = fresh()
	for i := 1; i < 25; i++ {
		in.Presets[0].Tab.Shortcuts = append(in.Presets[0].Tab.Shortcuts, sidebarPresetShortcut{ID: fmt.Sprint("shortcut-", i), Kind: "library", Visible: true})
	}
	if err := validateSidebarPresets(in); err != nil {
		t.Fatalf("25 shortcuts rejected: %v", err)
	}
	in.Presets[0].Tab.Shortcuts = append(in.Presets[0].Tab.Shortcuts, sidebarPresetShortcut{ID: "overflow", Kind: "library"})
	if validateSidebarPresets(in) == nil {
		t.Fatal("accepted 26 shortcuts")
	}
	in = fresh()
	in.Presets[0].Name = strings.Repeat("é", 80)
	if err := validateSidebarPresets(in); err != nil {
		t.Fatalf("80 Unicode characters rejected: %v", err)
	}
	in.Presets[0].Name += "é"
	if validateSidebarPresets(in) == nil {
		t.Fatal("accepted long name")
	}
}

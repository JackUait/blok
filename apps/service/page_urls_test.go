package cloud

import (
	"strings"
	"testing"
)

func (w *readsWorld) publicID(t *testing.T, page string) string {
	t.Helper()
	var id string
	if e := w.service.DB.QueryRow(w.ctx, `SELECT public_id::text FROM pages WHERE id=$1`, page).Scan(&id); e != nil {
		t.Fatal(e)
	}
	return id
}
func TestPagePublicIDsBackfillWithoutChangingInternalIDs(t *testing.T) {
	ctx, _, open := permissionsFixture(t)
	s := open()
	seedWorld(t, ctx, s)
	seedPage(t, ctx, s, "welcome-old-workspace", "w", "", visWorkspace)
	// Reproduce the pre-alias schema in this disposable schema only.
	if _, e := s.DB.Exec(ctx, `ALTER TABLE pages DROP COLUMN public_id;DELETE FROM schema_migrations WHERE version=8`); e != nil {
		t.Fatal(e)
	}
	s.Close()
	migrated := open()
	var alias, id, title string
	if e := migrated.DB.QueryRow(ctx, `SELECT id,public_id::text,metadata->>'title' FROM pages`).Scan(&id, &alias, &title); e != nil {
		t.Fatal(e)
	}
	if id != "welcome-old-workspace" || title != id || !publicPageIDPattern.MatchString(alias) {
		t.Fatalf("migration changed identity: %q %q %q", id, alias, title)
	}
	migrated.Close()
	again := open()
	var persisted string
	if e := again.DB.QueryRow(ctx, `SELECT public_id::text FROM pages WHERE id=$1`, id).Scan(&persisted); e != nil || persisted != alias {
		t.Fatalf("alias changed on restart %s %s %v", alias, persisted, e)
	}
}
func TestPageURLAliasesRespectPermissionsAndLegacyLinks(t *testing.T) {
	w := newReadsWorld(t)
	private := w.publicID(t, "prive")
	public := w.publicID(t, "public")
	for _, path := range []string{"/api/pages/resolve/" + private, "/api/pages/resolve-id/prive"} {
		w.send(t, "GET", tokenAlice, path, nil, 404)
		w.send(t, "GET", tokenZoe, path, nil, 404)
		got := w.send(t, "GET", tokenBob, path, nil, 200)
		if got["pageId"] != "prive" || got["publicId"] != private {
			t.Fatal(got)
		}
	}
	w.send(t, "GET", "", "/api/pages/resolve/"+public, nil, 401)
	w.send(t, "GET", tokenBob, "/api/pages/resolve/00000000-0000-0000-0000-000000000000", nil, 404)
	w.send(t, "GET", tokenBob, "/api/pages/resolve/not-a-uuid", nil, 404)
	w.send(t, "GET", tokenBob, "/api/pages/resolve-id/missing", nil, 404)
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO users(id,email) VALUES('outside','outside@example.test');INSERT INTO sessions(id,user_id,expires_at) VALUES('outside-session','outside',now()+interval '1 day')`); e != nil {
		t.Fatal(e)
	}
	// Bob loses workspace membership: a valid UUID no longer resolves.
	w.send(t, "DELETE", tokenZoe, "/api/workspaces/equipe/members/bob", nil, 200)
	w.send(t, "GET", tokenBob, "/api/pages/resolve/"+public, nil, 404)
}
func TestPageURLsPersistAcrossRenameTrashRestoreAndDuplication(t *testing.T) {
	w := newReadsWorld(t)
	alias := w.publicID(t, "public")
	w.send(t, "PATCH", tokenZoe, "/api/workspaces/equipe", map[string]any{"name": "Nouveau nom", "icon": "🦊"}, 200)
	if _, e := w.service.DB.Exec(w.ctx, `UPDATE pages SET metadata=jsonb_set(metadata,'{title}','"Titre renommé"') WHERE id='public'`); e != nil {
		t.Fatal(e)
	}
	resolved := w.send(t, "GET", tokenAlice, "/api/pages/resolve/"+strings.ToUpper(alias), nil, 200)
	if resolved["title"] != "Titre renommé" || resolved["workspace"].(map[string]any)["name"] != "Nouveau nom" || resolved["publicId"] != alias {
		t.Fatal(resolved)
	}
	w.send(t, "POST", tokenZoe, "/api/workspaces/equipe/pages/public/duplicate", map[string]any{"id": "different-internal", "title": "Copie"}, 201)
	if duplicate := w.publicID(t, "different-internal"); duplicate == alias || !publicPageIDPattern.MatchString(duplicate) {
		t.Fatal("duplicate reused public alias", duplicate)
	}
	if _, e := w.service.DB.Exec(w.ctx, `UPDATE pages SET trashed=true WHERE id='public'`); e != nil {
		t.Fatal(e)
	}
	w.send(t, "GET", tokenAlice, "/api/pages/resolve/"+alias, nil, 404)
	w.send(t, "GET", tokenAlice, "/api/pages/resolve-id/public", nil, 404)
	if _, e := w.service.DB.Exec(w.ctx, `UPDATE pages SET trashed=false WHERE id='public'`); e != nil {
		t.Fatal(e)
	}
	if got := w.send(t, "GET", tokenAlice, "/api/pages/resolve/"+alias, nil, 200); got["publicId"] != alias {
		t.Fatal(got)
	}
	if _, e := w.service.DB.Exec(w.ctx, `UPDATE pages SET deleted=true WHERE id='public'`); e != nil {
		t.Fatal(e)
	}
	w.send(t, "GET", tokenAlice, "/api/pages/resolve/"+alias, nil, 404)
}
func TestPageURLTeamspacesArchiveAndCrossWorkspaceIsolation(t *testing.T) {
	w := newReadsWorld(t)
	ts := w.newTeamspace(t, "Secret")
	page := w.tsPage(t, ts, "Secret document", "")
	alias := w.publicID(t, page)
	w.send(t, "GET", tokenAlice, "/api/pages/resolve/"+alias, nil, 404)
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO workspaces(id,slug,name) VALUES('other','other','Other');INSERT INTO memberships VALUES('other','alice','admin')`); e != nil {
		t.Fatal(e)
	}
	w.send(t, "GET", tokenAlice, "/api/pages/resolve/"+alias, nil, 404)
	w.tsMember(t, ts, "alice", "member")
	if got := w.send(t, "GET", tokenAlice, "/api/pages/resolve/"+alias, nil, 200); got["teamspaceId"] != ts || got["workspace"].(map[string]any)["id"] != "w" {
		t.Fatal(got)
	}
	w.send(t, "POST", tokenZoe, "/api/workspaces/equipe/teamspaces/"+ts+"/archive", map[string]any{}, 200)
	w.send(t, "GET", tokenAlice, "/api/pages/resolve/"+alias, nil, 404)
	w.send(t, "POST", tokenZoe, "/api/workspaces/equipe/teamspaces/"+ts+"/restore", map[string]any{}, 200)
	if got := w.send(t, "GET", tokenAlice, "/api/pages/resolve/"+alias, nil, 200); got["publicId"] != alias {
		t.Fatal(got)
	}
}
func TestPagePublicIDCannotBeChangedByIndexMetadata(t *testing.T) {
	w := newReadsWorld(t)
	alias := w.publicID(t, "public")
	page := entry("public", nil)
	page["publicId"] = "00000000-0000-0000-0000-000000000000"
	page["teamspaceId"] = "fake-ts"
	w.putIndex(t, tokenAlice, []map[string]any{page}, 0, 200)
	got := w.send(t, "GET", tokenAlice, "/api/workspaces/equipe/index", nil, 200)
	if got["access"].(map[string]any)["public"].(map[string]any)["publicId"] != alias || w.publicID(t, "public") != alias {
		t.Fatal("client rewrote public ID", got)
	}
	raw := got["pages"].([]any)[0].(map[string]any)
	if _, ok := raw["publicId"]; ok {
		t.Fatal("spoofed publicId persisted in editable metadata", raw)
	}
}

package cloud

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"
)

// L'enregistrement de l'index est un remplacement global : le client relit tout,
// fusionne et réécrit tout. Dès qu'une page est invisible pour l'appelant, elle
// n'est pas dans son corps de requête — et c'est là que les pages des autres
// disparaissent.
func (w *readsWorld) putIndex(t *testing.T, token string, pages []map[string]any, revision int, status int) map[string]any {
	t.Helper()
	payload, _ := json.Marshal(map[string]any{"pages": pages, "trash": []any{}, "revision": revision})
	req, _ := http.NewRequest("PUT", w.server.URL+"/api/workspaces/equipe/index", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", w.service.Config.PublicURL)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, e := http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != status {
		t.Fatalf("PUT index: %d attendu %d: %s", resp.StatusCode, status, body)
	}
	var out map[string]any
	json.Unmarshal(body, &out)
	return out
}

func entry(id string, parent any) map[string]any {
	return map[string]any{"id": id, "title": id, "parentId": parent}
}

func (w *readsWorld) alive(t *testing.T, id string) bool {
	t.Helper()
	var alive bool
	if e := w.service.DB.QueryRow(w.ctx, `SELECT EXISTS(SELECT 1 FROM pages WHERE id=$1 AND NOT deleted)`, id).Scan(&alive); e != nil {
		t.Fatal(e)
	}
	return alive
}

func (w *readsWorld) order(t *testing.T) []string {
	t.Helper()
	rows, e := w.service.DB.Query(w.ctx, `SELECT id FROM pages WHERE workspace_id='w' AND NOT deleted ORDER BY (metadata->>'position')::numeric NULLS LAST,id`)
	if e != nil {
		t.Fatal(e)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if e := rows.Scan(&id); e != nil {
			t.Fatal(e)
		}
		ids = append(ids, id)
	}
	return ids
}

// La perte de données la plus probable de tout ce chantier.
func TestIndexSaveKeepsPagesItCannotSee(t *testing.T) {
	w := newReadsWorld(t)
	w.putIndex(t, tokenAlice, []map[string]any{entry("public", nil)}, 0, 200)
	for _, id := range []string{"prive", "enfant"} {
		if !w.alive(t, id) {
			t.Fatalf("l'enregistrement d'Alice a supprimé %s, qu'elle ne voyait même pas", id)
		}
	}
}

// Renuméroter sur une liste partielle ferait diverger les deux vues en silence.
func TestIndexSavePreservesRelativeOrderOfHiddenPages(t *testing.T) {
	w := newReadsWorld(t)
	w.page(t, "alpha", "", visWorkspace)
	w.page(t, "omega", "", visWorkspace)
	// Ordre de départ voulu : alpha, prive, enfant, public, omega.
	for position, id := range []string{"alpha", "prive", "enfant", "public", "omega"} {
		if _, e := w.service.DB.Exec(w.ctx, `UPDATE pages SET metadata=jsonb_set(metadata,'{position}',to_jsonb($2::int)) WHERE id=$1`, id, position); e != nil {
			t.Fatal(e)
		}
	}
	// Alice ne voit ni prive ni enfant, et réordonne ce qu'elle voit.
	w.putIndex(t, tokenAlice, []map[string]any{entry("omega", nil), entry("alpha", nil), entry("public", nil)}, 0, 200)

	got := w.order(t)
	rank := map[string]int{}
	for i, id := range got {
		rank[id] = i
	}
	if rank["prive"] >= rank["enfant"] {
		t.Fatalf("les pages cachées ont perdu leur ordre relatif: %v", got)
	}
	if rank["omega"] >= rank["alpha"] || rank["alpha"] >= rank["public"] {
		t.Fatalf("l'ordre demandé par Alice n'a pas été appliqué: %v", got)
	}
	if len(got) != 5 {
		t.Fatalf("des pages ont disparu: %v", got)
	}
}

// Un corps qui nomme une page qu'on n'a pas le droit de voir n'est pas un
// enregistrement : c'est une tentative de prise de contrôle.
func TestIndexSaveRefusesAPageItCannotSee(t *testing.T) {
	w := newReadsWorld(t)
	w.putIndex(t, tokenAlice, []map[string]any{entry("public", nil), entry("prive", nil)}, 0, 403)
	var visibility string
	if e := w.service.DB.QueryRow(w.ctx, `SELECT visibility FROM pages WHERE id='prive'`).Scan(&visibility); e != nil {
		t.Fatal(e)
	}
	if visibility != visPrivate {
		t.Fatalf("la page privée a été reprise: visibilité %q", visibility)
	}
}

// Le piège laissé par le lot précédent : l'index détache une page de son parent
// caché pour pouvoir l'afficher. Le réenregistrer ne doit pas la déplacer.
func TestIndexSaveKeepsHiddenParent(t *testing.T) {
	w := newReadsWorld(t)
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES('enfant','alice','edit','bob')`); e != nil {
		t.Fatal(e)
	}
	// C'est exactement ce que le GET lui a renvoyé : parentId à null.
	w.putIndex(t, tokenAlice, []map[string]any{entry("public", nil), entry("enfant", nil)}, 0, 200)

	var parent *string
	if e := w.service.DB.QueryRow(w.ctx, `SELECT metadata->>'parentId' FROM pages WHERE id='enfant'`).Scan(&parent); e != nil {
		t.Fatal(e)
	}
	if parent == nil || *parent != "prive" {
		t.Fatalf("l'enfant a été déraciné de son parent caché: %v", parent)
	}
}

// Un déplacement délibéré reste un déplacement.
func TestIndexSaveStillMovesPagesOnPurpose(t *testing.T) {
	w := newReadsWorld(t)
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES('enfant','alice','edit','bob')`); e != nil {
		t.Fatal(e)
	}
	w.putIndex(t, tokenAlice, []map[string]any{entry("public", nil), entry("enfant", "public")}, 0, 200)
	var parent *string
	if e := w.service.DB.QueryRow(w.ctx, `SELECT metadata->>'parentId' FROM pages WHERE id='enfant'`).Scan(&parent); e != nil {
		t.Fatal(e)
	}
	if parent == nil || *parent != "public" {
		t.Fatalf("le déplacement demandé n'a pas eu lieu: %v", parent)
	}
}

// L'ordre est une vue, le titre est un contenu : on peut ranger une page qu'on
// lit sans pouvoir la réécrire.
func TestIndexSaveDoesNotRewriteAReadOnlyPage(t *testing.T) {
	w := newReadsWorld(t)
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES('enfant','alice','view','bob')`); e != nil {
		t.Fatal(e)
	}
	renamed := entry("enfant", nil)
	renamed["title"] = "titre volé"
	w.putIndex(t, tokenAlice, []map[string]any{entry("public", nil), renamed}, 0, 200)

	var title string
	if e := w.service.DB.QueryRow(w.ctx, `SELECT metadata->>'title' FROM pages WHERE id='enfant'`).Scan(&title); e != nil {
		t.Fatal(e)
	}
	if title != "enfant" {
		t.Fatalf("une page en lecture seule a été réécrite: %q", title)
	}
	if !w.alive(t, "enfant") {
		t.Fatal("une page en lecture seule omise plus tard serait perdue")
	}
}

// Le compteur de révision reste global à l'espace : deux enregistrements
// concurrents se refusent, ils ne se perdent pas.
func TestIndexSaveStillRefusesStaleRevision(t *testing.T) {
	w := newReadsWorld(t)
	w.putIndex(t, tokenAlice, []map[string]any{entry("public", nil)}, 0, 200)
	w.putIndex(t, tokenAlice, []map[string]any{entry("public", nil)}, 0, 409)
}

func TestIndexCreatesPrivatePageAtomically(t *testing.T) {
	w := newReadsWorld(t)
	private := entry("new-private", nil)
	private["initialVisibility"] = "private"
	w.putIndex(t, tokenAlice, []map[string]any{entry("public", nil), private}, 0, 200)
	own := w.send(t, "GET", tokenAlice, "/api/workspaces/equipe/pages/new-private/access", nil, 200)
	if own["visibility"] != visPrivate || own["myLevel"] != "full" {
		t.Fatalf("unexpected private access: %v", own)
	}
	w.send(t, "GET", tokenBob, "/api/workspaces/equipe/pages/new-private/access", nil, 404)
	w.send(t, "GET", tokenZoe, "/api/workspaces/equipe/pages/new-private/access", nil, 404)
}

func TestIndexInitialVisibilityCannotChangeExistingAccess(t *testing.T) {
	w := newReadsWorld(t)
	public := entry("public", nil)
	public["initialVisibility"] = "private"
	w.putIndex(t, tokenAlice, []map[string]any{public}, 0, 200)
	own := w.send(t, "GET", tokenBob, "/api/workspaces/equipe/pages/public/access", nil, 200)
	if own["visibility"] != visWorkspace {
		t.Fatalf("index changed existing access: %v", own)
	}
}

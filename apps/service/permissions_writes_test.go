package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type mcpResult struct {
	isError bool
	result  *mcp.CallToolResult
}

func (w *readsWorld) post(t *testing.T, token, path string, payload any, status int) map[string]any {
	t.Helper()
	encoded, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", w.server.URL+path, bytes.NewReader(encoded))
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
		t.Fatalf("POST %s: %d attendu %d: %s", path, resp.StatusCode, status, body)
	}
	var out map[string]any
	json.Unmarshal(body, &out)
	return out
}

func (w *readsWorld) levelOf(t *testing.T, user, page string) level {
	t.Helper()
	granted, e := w.service.effectiveLevel(w.ctx, w.service.DB, user, page)
	if e != nil {
		t.Fatal(e)
	}
	return granted
}

// Dupliquer traverse deux pages aux droits différents : c'est la seule opération
// du service qui le fasse, et la plus facile à ne vérifier qu'à moitié.
func TestDuplicateNeedsAccessToItsSource(t *testing.T) {
	w := newReadsWorld(t)
	w.post(t, tokenAlice, "/api/workspaces/equipe/pages/prive/duplicate",
		map[string]any{"id": "copie", "title": "Copie"}, 404)
	if w.alive(t, "copie") {
		t.Fatal("une page privée a été copiée par quelqu'un qui ne la voit pas")
	}
}

func TestDuplicateNeedsWriteOnItsTargetParent(t *testing.T) {
	w := newReadsWorld(t)
	parent := "prive"
	w.post(t, tokenAlice, "/api/workspaces/equipe/pages/public/duplicate",
		map[string]any{"id": "copie", "title": "Copie", "parentId": &parent}, 404)
	if w.alive(t, "copie") {
		t.Fatal("une copie a été déposée sous un parent inaccessible")
	}
}

// Une copie ne doit jamais élargir un accès, et son auteur doit pouvoir la gérer.
func TestDuplicateKeepsVisibilityAndGivesControl(t *testing.T) {
	w := newReadsWorld(t)
	w.post(t, tokenBob, "/api/workspaces/equipe/pages/prive/duplicate",
		map[string]any{"id": "copie", "title": "Copie"}, 201)
	var visibility string
	if e := w.service.DB.QueryRow(w.ctx, `SELECT visibility FROM pages WHERE id='copie'`).Scan(&visibility); e != nil {
		t.Fatal(e)
	}
	if visibility != visPrivate {
		t.Fatalf("la copie d'une page privée est %q", visibility)
	}
	if got := w.levelOf(t, "alice", "copie"); got != levelNone {
		t.Fatalf("la copie a élargi l'accès: Alice a %v", got)
	}
	if got := w.levelOf(t, "bob", "copie"); got != levelFull {
		t.Fatalf("l'auteur de la copie ne la maîtrise pas: %v", got)
	}
}

// Le contenu initial d'une page est du contenu : il demande le droit d'écrire.
func TestSeedNeedsWriteOnThePage(t *testing.T) {
	w := newReadsWorld(t)
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES('enfant','alice','view','bob')`); e != nil {
		t.Fatal(e)
	}
	// Semer n'est possible que sur un document encore vide.
	if _, e := w.service.DB.Exec(w.ctx, `UPDATE pages SET content=NULL WHERE id IN ('enfant','prive')`); e != nil {
		t.Fatal(e)
	}
	document := map[string]any{"document": map[string]any{"blocks": []any{}}}
	w.post(t, tokenAlice, "/api/workspaces/equipe/pages/enfant/seed", document, 403)
	w.post(t, tokenAlice, "/api/workspaces/equipe/pages/prive/seed", document, 404)
	w.post(t, tokenBob, "/api/workspaces/equipe/pages/enfant/seed", document, 200)
}

// Créer une page sans pouvoir la partager ensuite rendrait le partage réservé aux
// administrateurs — y compris sur une page qu'on vient d'écrire soi-même.
func TestCreatorControlsWhatTheyCreate(t *testing.T) {
	w := newReadsWorld(t)
	w.putIndex(t, tokenAlice, []map[string]any{entry("public", nil), entry("neuve", nil)}, 0, 200)
	if got := w.levelOf(t, "alice", "neuve"); got != levelFull {
		t.Fatalf("l'auteure d'une page neuve y a %v", got)
	}
	// La page reste ouverte à l'espace : la maîtrise n'est pas la confidentialité.
	if got := w.levelOf(t, "bob", "neuve"); got != levelEdit {
		t.Fatalf("une page neuve à la racine n'est plus commune: Bob a %v", got)
	}
}

// Le MCP crée des pages comme les autres chemins, avec les mêmes conditions.
func TestMCPCreatePageNeedsWriteOnItsParent(t *testing.T) {
	w := newReadsWorld(t)
	create := func(user, parent string) *mcpResult {
		ctx := context.WithValue(w.ctx, mcpUserKey{}, identity{ID: user})
		args := map[string]any{"workspace": "equipe", "title": "Neuve"}
		if parent != "" {
			args["parentId"] = parent
		}
		result, e := w.service.mcpCreatePage(ctx, mcpRequestFor(t, args))
		if e != nil {
			t.Fatal(e)
		}
		return &mcpResult{isError: result.IsError, result: result}
	}
	if !create("alice", "prive").isError {
		t.Fatal("le MCP a créé une page sous un parent inaccessible")
	}
	if create("alice", "").isError {
		t.Fatal("le MCP refuse une page à la racine à un membre")
	}
	created := create("bob", "prive")
	if created.isError {
		t.Fatal("le propriétaire ne peut plus créer sous sa propre page privée")
	}
	var id struct {
		ID string `json:"id"`
	}
	if e := json.Unmarshal([]byte(mcpResultText(t, created.result)), &id); e != nil {
		t.Fatal(e)
	}
	// Une sous-page hérite, donc elle reste privée, et son auteur la maîtrise.
	if got := w.levelOf(t, "alice", id.ID); got != levelNone {
		t.Fatalf("une sous-page d'une page privée est visible d'Alice: %v", got)
	}
	if got := w.levelOf(t, "bob", id.ID); got != levelFull {
		t.Fatalf("l'auteur ne maîtrise pas la page qu'il vient de créer: %v", got)
	}
}

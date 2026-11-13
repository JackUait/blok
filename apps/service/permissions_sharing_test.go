package cloud

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	blokserver "github.com/JackUait/blok/packages/server/go/v2/blokserver"
)

func (w *readsWorld) send(t *testing.T, method, token, path string, payload any, status int) map[string]any {
	t.Helper()
	var reader *bytes.Reader
	if payload != nil {
		encoded, _ := json.Marshal(payload)
		reader = bytes.NewReader(encoded)
	} else {
		reader = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, w.server.URL+path, reader)
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
		t.Fatalf("%s %s: %d attendu %d: %s", method, path, resp.StatusCode, status, body)
	}
	var out map[string]any
	json.Unmarshal(body, &out)
	return out
}

// La feuille d'accès doit distinguer ce qui se décide ici de ce qui vient d'un
// ancêtre : sans cela personne ne comprend d'où vient un droit, ni pourquoi il ne
// peut pas le retirer depuis cette page.
func TestAccessSheetSeparatesOwnAndInheritedShares(t *testing.T) {
	sheet := func() map[string]any {
		w := newReadsWorld(t)
		return w.send(t, "GET", tokenBob, "/api/workspaces/equipe/pages/enfant/access", nil, 200)
	}()
	if sheet["visibility"] != visInherit || sheet["myLevel"] != "full" {
		t.Fatalf("feuille d'accès inattendue: %v", sheet)
	}
	own, _ := sheet["shares"].([]any)
	if len(own) != 0 {
		t.Fatalf("la sous-page n'a pas de partage propre: %v", own)
	}
	inherited, _ := sheet["inherited"].([]any)
	if len(inherited) != 1 {
		t.Fatalf("le partage hérité du parent manque: %v", inherited)
	}
	entry, _ := inherited[0].(map[string]any)
	if entry["email"] != "bob@example.test" || entry["level"] != "full" || entry["from"] != "prive" {
		t.Fatalf("l'origine du droit hérité est mal décrite: %v", entry)
	}
}

// Une page qu'on ne voit pas n'a pas de feuille d'accès à montrer.
func TestAccessSheetHiddenLikeThePage(t *testing.T) {
	w := newReadsWorld(t)
	w.send(t, "GET", tokenAlice, "/api/workspaces/equipe/pages/prive/access", nil, 404)
}

// Modifier le contenu et gouverner les accès sont deux droits différents.
func TestOnlyFullAccessMayShare(t *testing.T) {
	w := newReadsWorld(t)
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES('enfant','alice','edit','bob')`); e != nil {
		t.Fatal(e)
	}
	w.send(t, "PUT", tokenAlice, "/api/workspaces/equipe/pages/enfant/shares/zoe", map[string]any{"level": "view"}, 403)
	w.send(t, "PUT", tokenAlice, "/api/workspaces/equipe/pages/enfant/access", map[string]any{"visibility": visWorkspace}, 403)
}

func TestSharingOpensThePage(t *testing.T) {
	w := newReadsWorld(t)
	if got := w.levelOf(t, "alice", "prive"); got != levelNone {
		t.Fatalf("Alice voit déjà la page: %v", got)
	}
	w.send(t, "PUT", tokenBob, "/api/workspaces/equipe/pages/prive/shares/alice", map[string]any{"level": "view"}, 200)
	if got := w.levelOf(t, "alice", "prive"); got != levelView {
		t.Fatalf("le partage n'a rien ouvert: %v", got)
	}
	// Et il porte sur la descendance.
	if got := w.levelOf(t, "alice", "enfant"); got != levelView {
		t.Fatalf("le partage ne descend pas: %v", got)
	}
	w.send(t, "DELETE", tokenBob, "/api/workspaces/equipe/pages/prive/shares/alice", nil, 200)
	if got := w.levelOf(t, "alice", "prive"); got != levelNone {
		t.Fatalf("le retrait n'a rien fermé: %v", got)
	}
}

// Partager avec quelqu'un qui n'est pas de l'espace donnerait une ligne qui ne
// veut rien dire : son plafond est nul, donc son accès aussi.
func TestSharingNeedsAWorkspaceMember(t *testing.T) {
	w := newReadsWorld(t)
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO users(id,email) VALUES('etranger','etranger@example.test')`); e != nil {
		t.Fatal(e)
	}
	w.send(t, "PUT", tokenBob, "/api/workspaces/equipe/pages/prive/shares/etranger", map[string]any{"level": "view"}, 404)
	w.send(t, "PUT", tokenBob, "/api/workspaces/equipe/pages/prive/shares/alice", map[string]any{"level": "owner"}, 400)
}

// Retirer le dernier accès complet rendrait la page inatteignable pour tout le
// monde, définitivement, administrateur compris.
func TestLastFullAccessIsProtected(t *testing.T) {
	w := newReadsWorld(t)
	w.send(t, "DELETE", tokenBob, "/api/workspaces/equipe/pages/prive/shares/bob", nil, 409)
	if got := w.levelOf(t, "bob", "prive"); got != levelFull {
		t.Fatalf("le dernier accès complet a sauté: %v", got)
	}
	// Avec deux, le retrait redevient possible.
	w.send(t, "PUT", tokenBob, "/api/workspaces/equipe/pages/prive/shares/alice", map[string]any{"level": "full"}, 200)
	w.send(t, "DELETE", tokenBob, "/api/workspaces/equipe/pages/prive/shares/bob", nil, 200)
}

// Une page ouverte à l'espace n'a pas besoin d'un gardien nommé : la protection
// ne vaut que là où le retrait rendrait la page orpheline.
func TestLastFullAccessUnprotectedOnAWorkspacePage(t *testing.T) {
	w := newReadsWorld(t)
	// Un membre ne gouverne pas les accès d'une page commune qu'il n'a pas créée :
	// sa base y est l'édition. C'est l'administratrice qui accorde.
	w.send(t, "PUT", tokenBob, "/api/workspaces/equipe/pages/public/shares/bob", map[string]any{"level": "full"}, 403)
	w.send(t, "PUT", tokenZoe, "/api/workspaces/equipe/pages/public/shares/bob", map[string]any{"level": "full"}, 200)
	w.send(t, "DELETE", tokenZoe, "/api/workspaces/equipe/pages/public/shares/bob", nil, 200)
}

func TestVisibilityCanBeOpenedAndClosed(t *testing.T) {
	w := newReadsWorld(t)
	w.send(t, "PUT", tokenBob, "/api/workspaces/equipe/pages/prive/access", map[string]any{"visibility": visWorkspace}, 200)
	if got := w.levelOf(t, "alice", "prive"); got != levelEdit {
		t.Fatalf("l'ouverture à l'espace n'a pas pris: %v", got)
	}
	w.send(t, "PUT", tokenBob, "/api/workspaces/equipe/pages/prive/access", map[string]any{"visibility": visPrivate}, 200)
	if got := w.levelOf(t, "alice", "prive"); got != levelNone {
		t.Fatalf("la refermeture n'a pas pris: %v", got)
	}
	w.send(t, "PUT", tokenBob, "/api/workspaces/equipe/pages/prive/access", map[string]any{"visibility": "public"}, 400)
}

// « Qui a accès » doit dire la vérité : un partage laissé derrière quelqu'un qui
// a quitté l'espace ressusciterait à son retour.
func TestRemovingAMemberRemovesTheirShares(t *testing.T) {
	w := newReadsWorld(t)
	w.send(t, "PUT", tokenBob, "/api/workspaces/equipe/pages/prive/shares/alice", map[string]any{"level": "view"}, 200)
	w.send(t, "DELETE", tokenZoe, "/api/workspaces/equipe/members/alice", nil, 200)
	var remaining int
	if e := w.service.DB.QueryRow(w.ctx, `SELECT count(*) FROM page_shares WHERE user_id='alice'`).Scan(&remaining); e != nil {
		t.Fatal(e)
	}
	if remaining != 0 {
		t.Fatalf("%d partage(s) survivent au départ d'Alice", remaining)
	}
}

// Retirer un partage doit refermer une session déjà ouverte, pas attendre un
// rechargement. Le balayage des documents observés rappelle l'autorisation du
// document : c'est elle qui doit basculer dans la foulée du retrait.
func TestRevocationIsImmediateForAnOpenSession(t *testing.T) {
	w := newReadsWorld(t)
	user := blokserver.User{ID: hash(tokenAlice)}
	w.send(t, "PUT", tokenBob, "/api/workspaces/equipe/pages/prive/shares/alice", map[string]any{"level": "edit"}, 200)
	can, e := w.service.CanWriteDocument(w.ctx, user, "prive")
	if e != nil {
		t.Fatal(e)
	}
	if !can {
		t.Fatal("le partage n'a pas ouvert l'écriture")
	}
	w.send(t, "DELETE", tokenBob, "/api/workspaces/equipe/pages/prive/shares/alice", nil, 200)
	can, e = w.service.CanWriteDocument(w.ctx, user, "prive")
	if e != nil {
		t.Fatal(e)
	}
	if can {
		t.Fatal("l'autorisation du document survit au retrait du partage")
	}
	read, e := w.service.CanReadDocument(w.ctx, user, "prive")
	if e != nil {
		t.Fatal(e)
	}
	if read {
		t.Fatal("la lecture survit au retrait du partage")
	}
}

package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Un espace porte le nom que son administrateur lui donne. Sans renommage, le
// nom bootstrap reste celui choisi au déploiement — à corriger dans l'UI.
func TestWorkspaceRename(t *testing.T) {
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("set TEST_DATABASE_URL for real PostgreSQL integration test")
	}
	ctx := context.Background()
	adminDB, e := pgxpool.New(ctx, raw)
	if e != nil {
		t.Fatal(e)
	}
	defer adminDB.Close()
	schemaName := "rename_test_" + fmt.Sprint(time.Now().UnixNano())
	if _, e = adminDB.Exec(ctx, "CREATE SCHEMA "+schemaName); e != nil {
		t.Fatal(e)
	}
	defer adminDB.Exec(ctx, "DROP SCHEMA "+schemaName+" CASCADE")
	parsed, e := url.Parse(raw)
	if e != nil {
		t.Fatal(e)
	}
	q := parsed.Query()
	q.Set("search_path", schemaName)
	parsed.RawQuery = q.Encode()

	cfg := Config{DatabaseURL: parsed.String(), PublicURL: "http://localhost:8080", InternalURL: "http://localhost:8080", DataDirectory: t.TempDir(), AdminEmail: "admin@example.test", BootstrapWorkspaceSlug: "acme", BootstrapWorkspaceName: "Acme", Development: true, TicketSecret: strings.Repeat("t", 40), InternalSecret: strings.Repeat("i", 40), Deliver: func(string, string, string) error { return nil }}
	s, e := New(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	server := httptest.NewServer(s.Handler())
	defer server.Close()

	var wsID, adminID string
	if e = s.DB.QueryRow(ctx, "SELECT id FROM workspaces WHERE slug='acme'").Scan(&wsID); e != nil {
		t.Fatal(e)
	}
	if e = s.DB.QueryRow(ctx, "SELECT id FROM users WHERE email='admin@example.test'").Scan(&adminID); e != nil {
		t.Fatal(e)
	}
	// AdminEmail grants instance admin only; seed workspace membership for this suite.
	if _, e = s.DB.Exec(ctx, `INSERT INTO memberships VALUES($1,$2,'admin') ON CONFLICT DO NOTHING`, wsID, adminID); e != nil {
		t.Fatal(e)
	}
	newSession := func(uid string) string {
		token := opaque()
		if _, e = s.DB.Exec(ctx, "INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", hash(token), uid); e != nil {
			t.Fatal(e)
		}
		return token
	}
	newUser := func(email, role string) string {
		id := opaque()
		if _, e = s.DB.Exec(ctx, "INSERT INTO users(id,email) VALUES($1,$2)", id, email); e != nil {
			t.Fatal(e)
		}
		if role != "" {
			if _, e = s.DB.Exec(ctx, "INSERT INTO memberships VALUES($1,$2,$3)", wsID, id, role); e != nil {
				t.Fatal(e)
			}
		}
		return newSession(id)
	}
	admin := newSession(adminID)
	member := newUser("member@example.test", "member")
	viewer := newUser("viewer@example.test", "viewer")
	stranger := newUser("stranger@example.test", "")

	request := func(method, path, token string, payload any, status int) map[string]any {
		t.Helper()
		var body io.Reader
		if payload != nil {
			encoded, _ := json.Marshal(payload)
			body = bytes.NewReader(encoded)
		}
		req, _ := http.NewRequest(method, server.URL+path, body)
		req.Header.Set("Origin", cfg.PublicURL)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer resp.Body.Close()
		encoded, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != status {
			t.Fatalf("%s %s status %d want %d: %s", method, path, resp.StatusCode, status, encoded)
		}
		out := map[string]any{}
		json.Unmarshal(encoded, &out)
		return out
	}

	const path = "/api/workspaces/acme"

	// Le defaut d'abord : un administrateur renomme son espace.
	renamed := request("PATCH", path, admin, map[string]any{"name": "Jocehome"}, 200)
	if renamed["name"] != "Jocehome" {
		t.Fatalf("reponse du renommage: name=%v want Jocehome", renamed["name"])
	}
	var stored, slug string
	if e = s.DB.QueryRow(ctx, "SELECT name,slug FROM workspaces WHERE id=$1", wsID).Scan(&stored, &slug); e != nil {
		t.Fatal(e)
	}
	if stored != "Jocehome" {
		t.Fatalf("nom en base: %q want Jocehome", stored)
	}
	// Le slug est l'URL de l'espace et la cible du bootstrap : renommer ne le touche pas.
	if slug != "acme" {
		t.Fatalf("slug modifie: %q want acme", slug)
	}
	if got := request("GET", path, admin, nil, 200); got["name"] != "Jocehome" {
		t.Fatalf("GET apres renommage: name=%v want Jocehome", got["name"])
	}

	// Seul un administrateur renomme.
	request("PATCH", path, member, map[string]any{"name": "Pris par un membre"}, 403)
	request("PATCH", path, viewer, map[string]any{"name": "Pris par un lecteur"}, 403)
	request("PATCH", path, stranger, map[string]any{"name": "Pris par un inconnu"}, 403)
	request("PATCH", path, "", map[string]any{"name": "Pris sans session"}, 401)

	// Memes bornes qu'a la creation : 1 a 120 caracteres.
	request("PATCH", path, admin, map[string]any{"name": ""}, 400)
	request("PATCH", path, admin, map[string]any{"name": strings.Repeat("a", 121)}, 400)

	// Aucun refus n'a altere le nom.
	if e = s.DB.QueryRow(ctx, "SELECT name FROM workspaces WHERE id=$1", wsID).Scan(&stored); e != nil {
		t.Fatal(e)
	}
	if stored != "Jocehome" {
		t.Fatalf("nom altere par une requete refusee: %q want Jocehome", stored)
	}
}

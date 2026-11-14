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
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// setupFixture opens a disposable schema with no BOOTSTRAP_ADMIN_EMAIL so the
// first-run setup window stays open.
func setupFixture(t *testing.T) (context.Context, string, func(dataDir string) *Service) {
	t.Helper()
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("set TEST_DATABASE_URL for real PostgreSQL integration test")
	}
	ctx := context.Background()
	adminDB, e := pgxpool.New(ctx, raw)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(adminDB.Close)
	schemaName := "setup_test_" + fmt.Sprint(time.Now().UnixNano())
	if _, e = adminDB.Exec(ctx, "CREATE SCHEMA "+schemaName); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { adminDB.Exec(context.Background(), "DROP SCHEMA "+schemaName+" CASCADE") })
	parsed, e := url.Parse(raw)
	if e != nil {
		t.Fatal(e)
	}
	q := parsed.Query()
	q.Set("search_path", schemaName)
	parsed.RawQuery = q.Encode()
	open := func(dataDir string) *Service {
		t.Helper()
		if dataDir == "" {
			dataDir = t.TempDir()
		}
		cfg := Config{
			DatabaseURL: parsed.String(), PublicURL: "http://localhost:8080",
			InternalURL: "http://localhost:8080", DataDirectory: dataDir,
			Development: true, TicketSecret: strings.Repeat("t", 40),
			InternalSecret: strings.Repeat("i", 40),
			Deliver:        func(string, string, string) error { return nil },
		}
		s, e := New(ctx, cfg)
		if e != nil {
			t.Fatal(e)
		}
		t.Cleanup(s.Close)
		return s
	}
	return ctx, parsed.String(), open
}

func setupRequest(t *testing.T, server *httptest.Server, publicURL, method, path string, payload any) (int, map[string]any) {
	t.Helper()
	var b io.Reader
	if payload != nil {
		encoded, _ := json.Marshal(payload)
		b = bytes.NewReader(encoded)
	}
	req, _ := http.NewRequest(method, server.URL+path, b)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", publicURL)
	resp, e := http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var out map[string]any
	_ = json.Unmarshal(body, &out)
	return resp.StatusCode, out
}

func readSetupToken(t *testing.T, dataDir string) string {
	t.Helper()
	path := filepath.Join(dataDir, "setup-token")
	info, e := os.Stat(path)
	if e != nil {
		t.Fatalf("setup-token missing: %v", e)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("setup-token mode = %o, want 0600", info.Mode().Perm())
	}
	raw, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	token := strings.TrimSpace(string(raw))
	if token == "" {
		t.Fatal("setup-token is empty")
	}
	return token
}

// Base neuve sans AdminEmail ⇒ setupRequired et fichier jeton mode 0600.
func TestSetupFreshDatabaseMintsToken(t *testing.T) {
	_, _, open := setupFixture(t)
	dataDir := t.TempDir()
	s := open(dataDir)

	server := httptest.NewServer(s.Handler())
	t.Cleanup(server.Close)
	status, out := setupRequest(t, server, s.Config.PublicURL, "GET", "/api/instance", nil)
	if status != 200 {
		t.Fatalf("GET /api/instance status %d", status)
	}
	if out["setupRequired"] != true {
		t.Fatalf("setupRequired = %v, want true", out["setupRequired"])
	}
	_ = readSetupToken(t, dataDir)
}

// Jeton faux ⇒ 403.
func TestSetupClaimBadTokenForbidden(t *testing.T) {
	_, _, open := setupFixture(t)
	dataDir := t.TempDir()
	s := open(dataDir)
	_ = readSetupToken(t, dataDir)

	server := httptest.NewServer(s.Handler())
	t.Cleanup(server.Close)
	status, out := setupRequest(t, server, s.Config.PublicURL, "POST", "/api/setup/claim", map[string]any{
		"token": "not-the-real-token",
		"email": "owner@example.test",
		"name":  "Owner",
	})
	if status != 403 {
		t.Fatalf("claim bad token status %d body %#v, want 403", status, out)
	}
}

// Double revendication ⇒ 409.
func TestSetupClaimTwiceConflicts(t *testing.T) {
	_, _, open := setupFixture(t)
	dataDir := t.TempDir()
	s := open(dataDir)
	token := readSetupToken(t, dataDir)

	server := httptest.NewServer(s.Handler())
	t.Cleanup(server.Close)
	payload := map[string]any{
		"token": token,
		"email": "owner@example.test",
		"name":  "Owner",
		"workspace": map[string]string{
			"slug": "equipe",
			"name": "Équipe",
		},
	}
	status, out := setupRequest(t, server, s.Config.PublicURL, "POST", "/api/setup/claim", payload)
	if status != 200 {
		t.Fatalf("first claim status %d body %#v, want 200", status, out)
	}
	status, out = setupRequest(t, server, s.Config.PublicURL, "POST", "/api/setup/claim", payload)
	if status != 409 {
		t.Fatalf("second claim status %d body %#v, want 409", status, out)
	}
}

// L'assistant envoie les politiques choisies à l'étape 4 ; le claim doit les
// persister, sinon l'instance reste sur invite/admins_only quoi qu'on ait dit.
func TestSetupClaimPersistsPolicies(t *testing.T) {
	_, _, open := setupFixture(t)
	dataDir := t.TempDir()
	s := open(dataDir)
	token := readSetupToken(t, dataDir)

	server := httptest.NewServer(s.Handler())
	t.Cleanup(server.Close)
	status, out := setupRequest(t, server, s.Config.PublicURL, "POST", "/api/setup/claim", map[string]any{
		"token":              token,
		"email":              "owner@example.test",
		"name":               "Owner",
		"instanceName":       "Acme",
		"signupPolicy":       "open",
		"workspaceCreation":  "disabled",
		"workspace":          map[string]string{"slug": "equipe", "name": "Équipe"},
	})
	if status != 200 {
		t.Fatalf("claim status %d body %#v, want 200", status, out)
	}
	got := s.settings()
	if got.SignupPolicy != "open" {
		t.Fatalf("signupPolicy = %q, want open", got.SignupPolicy)
	}
	if got.WorkspaceCreation != "disabled" {
		t.Fatalf("workspaceCreation = %q, want disabled", got.WorkspaceCreation)
	}
	if got.Name != "Acme" {
		t.Fatalf("name = %q, want Acme", got.Name)
	}
}

// Instance héritée (membres avant redémarrage) ⇒ setupRequired:false et
// promotion des admins de l'espace par défaut.
func TestSetupInheritedInstanceSkipsAssistant(t *testing.T) {
	ctx, _, open := setupFixture(t)
	dataDir := t.TempDir()
	s := open(dataDir)

	wsID := opaque()
	if _, e := s.DB.Exec(ctx, `INSERT INTO workspaces(id,slug,name) VALUES($1,'equipe','Équipe')`, wsID); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DB.Exec(ctx, `UPDATE instance_settings SET default_workspace_id=$1 WHERE id`, wsID); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DB.Exec(ctx, `INSERT INTO users(id,email) VALUES('heir','heir@example.test')`); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DB.Exec(ctx, `INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,'heir','admin')`, wsID); e != nil {
		t.Fatal(e)
	}
	s.Close()

	restarted := open(dataDir)
	if restarted.settings().SetupCompletedAt == nil {
		t.Fatal("inherited restart left setup open")
	}
	var isAdmin bool
	if e := restarted.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM instance_admins ia JOIN users u ON u.id=ia.user_id WHERE u.email='heir@example.test')`).Scan(&isAdmin); e != nil {
		t.Fatal(e)
	}
	if !isAdmin {
		t.Fatal("default-workspace admin was not promoted to instance admin")
	}

	server := httptest.NewServer(restarted.Handler())
	t.Cleanup(server.Close)
	status, out := setupRequest(t, server, restarted.Config.PublicURL, "GET", "/api/instance", nil)
	if status != 200 {
		t.Fatalf("GET /api/instance status %d", status)
	}
	if out["setupRequired"] != false {
		t.Fatalf("setupRequired = %v, want false for inherited instance", out["setupRequired"])
	}
}

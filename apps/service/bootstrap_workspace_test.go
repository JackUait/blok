package cloud

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Fresh instance with no BOOTSTRAP_WORKSPACE_* ⇒ zero workspaces after New.
// The product must not invent a branded default space.
func TestFreshInstanceHasZeroWorkspaces(t *testing.T) {
	ctx, _, open := permissionsFixture(t)
	s := open()
	var n int
	if e := s.DB.QueryRow(ctx, `SELECT count(*) FROM workspaces`).Scan(&n); e != nil {
		t.Fatal(e)
	}
	if n != 0 {
		t.Fatalf("workspace count = %d, want 0 on a fresh instance without BOOTSTRAP_WORKSPACE_*", n)
	}
	if s.settings().DefaultWorkspaceID != nil {
		t.Fatalf("defaultWorkspaceId = %v, want nil", s.settings().DefaultWorkspaceID)
	}
}

// AdminEmail + BOOTSTRAP_WORKSPACE_SLUG/NAME reproduces today's deploy: one
// workspace exists after New, and the admin gains membership once
// (ON CONFLICT DO NOTHING — demotion survives restart).
func TestBootstrapWorkspaceCoupleCreatesWorkspace(t *testing.T) {
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
	schemaName := "boot_ws_" + fmt.Sprint(time.Now().UnixNano())
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

	cfg := Config{
		DatabaseURL: parsed.String(), PublicURL: "http://localhost:8080",
		InternalURL: "http://localhost:8080", DataDirectory: t.TempDir(),
		Development: true, TicketSecret: strings.Repeat("t", 40),
		InternalSecret:         strings.Repeat("i", 40),
		AdminEmail:             "admin@example.test",
		BootstrapWorkspaceSlug: "acme",
		BootstrapWorkspaceName: "Acme",
		Deliver:                func(string, string, string) error { return nil },
	}
	s, e := New(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(s.Close)

	var slug, name string
	if e = s.DB.QueryRow(ctx, `SELECT slug, name FROM workspaces`).Scan(&slug, &name); e != nil {
		t.Fatal(e)
	}
	if slug != "acme" || name != "Acme" {
		t.Fatalf("workspace = {%q,%q}, want {acme,Acme}", slug, name)
	}
	var role string
	if e = s.DB.QueryRow(ctx, `
		SELECT m.role FROM memberships m
		  JOIN users u ON u.id=m.user_id
		 WHERE u.email=$1`, cfg.AdminEmail).Scan(&role); e != nil || role != "admin" {
		t.Fatalf("bootstrap membership role=%q err=%v, want admin", role, e)
	}
	if s.settings().DefaultWorkspaceID == nil {
		t.Fatal("single bootstrap workspace should become the default")
	}

	// Demotion must survive a second New with the same couple (§5.1).
	if _, e = s.DB.Exec(ctx, `UPDATE memberships SET role='viewer'`); e != nil {
		t.Fatal(e)
	}
	second, e := New(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(second.Close)
	if e = second.DB.QueryRow(ctx, `
		SELECT m.role FROM memberships m
		  JOIN users u ON u.id=m.user_id
		 WHERE u.email=$1`, cfg.AdminEmail).Scan(&role); e != nil || role != "viewer" {
		t.Fatalf("restart rewrote membership to %q err=%v, want viewer", role, e)
	}
}

func TestConfigRejectsPartialBootstrapWorkspace(t *testing.T) {
	base := Config{
		DatabaseURL: "postgres://unused", PublicURL: "https://example.test",
		TicketSecret: strings.Repeat("t", 32), InternalSecret: strings.Repeat("i", 32),
		Development: true, DevelopmentMailDirectory: t.TempDir(),
	}
	onlySlug := base
	onlySlug.BootstrapWorkspaceSlug = "acme"
	if e := onlySlug.validate(); e == nil || !strings.Contains(e.Error(), "BOOTSTRAP_WORKSPACE") {
		t.Fatalf("slug alone: %v", e)
	}
	onlyName := base
	onlyName.BootstrapWorkspaceName = "Acme"
	if e := onlyName.validate(); e == nil || !strings.Contains(e.Error(), "BOOTSTRAP_WORKSPACE") {
		t.Fatalf("name alone: %v", e)
	}
	badSlug := base
	badSlug.BootstrapWorkspaceSlug = "BAD"
	badSlug.BootstrapWorkspaceName = "Acme"
	if e := badSlug.validate(); e == nil || !strings.Contains(e.Error(), "BOOTSTRAP_WORKSPACE_SLUG") {
		t.Fatalf("bad slug: %v", e)
	}
	badEmail := base
	badEmail.AdminEmail = "not-an-email"
	if e := badEmail.validate(); e == nil || !strings.Contains(e.Error(), "BOOTSTRAP_ADMIN_EMAIL") {
		t.Fatalf("bad admin email: %v", e)
	}
}

// Production Go sources under apps/service must not hardcode the former brand.
func TestNoHardcodedBrandInServiceSources(t *testing.T) {
	entries, e := os.ReadDir(".")
	if e != nil {
		t.Fatal(e)
	}
	needle := "tousambassadeurs"
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		raw, e := os.ReadFile(name)
		if e != nil {
			t.Fatal(e)
		}
		if strings.Contains(strings.ToLower(string(raw)), needle) {
			t.Errorf("%s still contains %q", filepath.Base(name), needle)
		}
	}
}

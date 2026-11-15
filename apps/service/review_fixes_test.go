package cloud

import (
	"context"
	"errors"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// isolatedConfig gives each restart test its own schema, so a second New() in
// the same process sees the first one's rows and nothing else. DataDirectory is
// a temp dir.
func isolatedConfig(t *testing.T, prefix string) Config {
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
	schemaName := prefix + "_" + fmt.Sprint(time.Now().UnixNano())
	if _, e = adminDB.Exec(ctx, "CREATE SCHEMA "+schemaName); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		adminDB.Exec(context.Background(), "DROP SCHEMA "+schemaName+" CASCADE")
	})
	parsed, e := url.Parse(raw)
	if e != nil {
		t.Fatal(e)
	}
	q := parsed.Query()
	q.Set("search_path", schemaName)
	parsed.RawQuery = q.Encode()
	return Config{
		DatabaseURL: parsed.String(), PublicURL: "http://localhost:8080",
		InternalURL: "http://localhost:8080", DataDirectory: t.TempDir(),
		Development: true, TicketSecret: strings.Repeat("t", 40),
		InternalSecret: strings.Repeat("i", 40),
		Deliver:        func(string, string, string) error { return nil },
	}
}

func isInstanceAdmin(t *testing.T, ctx context.Context, s *Service, email string) bool {
	t.Helper()
	var yes bool
	if e := s.DB.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM instance_admins ia
		  JOIN users u ON u.id=ia.user_id WHERE u.email=$1)`, email).Scan(&yes); e != nil {
		t.Fatal(e)
	}
	return yes
}

// A revocation is a deliberate act. BOOTSTRAP_ADMIN_EMAIL exists so an instance
// is never left without an administrator — not so the .env can quietly reinstate
// someone an operator removed. The membership path survives a restart because
// ON CONFLICT DO NOTHING keeps the existing row; instance_admins has no row left
// to conflict with, so it needs its own guard.
func TestRestartDoesNotResurrectRevokedInstanceAdmin(t *testing.T) {
	ctx := context.Background()
	cfg := isolatedConfig(t, "revoke_restart")
	cfg.AdminEmail = "admin@example.test"

	first, e := New(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(first.Close)
	if !isInstanceAdmin(t, ctx, first, cfg.AdminEmail) {
		t.Fatal("bootstrap did not grant instance admin on a fresh instance")
	}

	// A second administrator, so the revocation is not refused as the last one.
	if _, e = first.GrantInstanceAdmin(ctx, "ops@example.test"); e != nil {
		t.Fatal(e)
	}
	if e = first.RevokeInstanceAdmin(ctx, cfg.AdminEmail); e != nil {
		t.Fatal(e)
	}
	if isInstanceAdmin(t, ctx, first, cfg.AdminEmail) {
		t.Fatal("revoke left the administrator in place")
	}

	second, e := New(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(second.Close)
	if isInstanceAdmin(t, ctx, second, cfg.AdminEmail) {
		t.Fatal("restart reinstated a revoked instance administrator")
	}
	if !isInstanceAdmin(t, ctx, second, "ops@example.test") {
		t.Fatal("restart dropped the remaining administrator")
	}
}

// The rescue path still has to work: an instance with no administrator left
// gets the .env address back on the next start.
func TestRestartRestoresAdminWhenNoneRemain(t *testing.T) {
	ctx := context.Background()
	cfg := isolatedConfig(t, "rescue_restart")
	cfg.AdminEmail = "admin@example.test"

	first, e := New(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(first.Close)
	if _, e = first.DB.Exec(ctx, `DELETE FROM instance_admins`); e != nil {
		t.Fatal(e)
	}

	second, e := New(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(second.Close)
	if !isInstanceAdmin(t, ctx, second, cfg.AdminEmail) {
		t.Fatal("an instance with no administrator was not rescued by BOOTSTRAP_ADMIN_EMAIL")
	}
}

// Deleting your own account reassigns page_shares.granted_by to yourself, which
// is a no-op, and the final DELETE then violates a NOT NULL foreign key. Refuse
// it by name rather than answering an opaque 500.
func TestAdminCannotDeleteTheirOwnAccount(t *testing.T) {
	ctx, s, _, request := instanceWorld(t)
	actorID := opaque()
	token := seedSession(t, ctx, s, actorID, "actor@example.test", true)
	otherID := opaque()
	seedSession(t, ctx, s, otherID, "other@example.test", true)

	// A share granted by the actor is what makes the foreign key bite.
	workspaceID, pageID := opaque(), opaque()
	if _, e := s.DB.Exec(ctx, `INSERT INTO workspaces(id,slug,name) VALUES($1,'acme','Acme')`, workspaceID); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DB.Exec(ctx, `INSERT INTO pages(id,workspace_id,metadata) VALUES($1,$2,'{}'::jsonb)`, pageID, workspaceID); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DB.Exec(ctx, `
		INSERT INTO page_shares(page_id,user_id,level,granted_by)
		VALUES($1,$2,'view',$3)`, pageID, otherID, actorID); e != nil {
		t.Fatal(e)
	}

	out := request("DELETE", "/api/admin/users/"+actorID, token, nil, 409)
	if msg, _ := out["error"].(string); !strings.Contains(strings.ToLower(msg), "own account") {
		t.Fatalf("error = %q, want it to name self-deletion", msg)
	}
	var alive bool
	if e := s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1)`, actorID).Scan(&alive); e != nil {
		t.Fatal(e)
	}
	if !alive {
		t.Fatal("the account was deleted despite the refusal")
	}
}

// Setup must not be spent before the address is proven reachable. A typo or a
// dead relay would otherwise complete the instance and leave the only
// administrator unreachable.
func TestClaimSetupRollsBackWhenDeliveryFails(t *testing.T) {
	ctx := context.Background()
	cfg := isolatedConfig(t, "claim_mail")
	cfg.Deliver = func(string, string, string) error { return errors.New("relay refused") }

	s, e := New(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(s.Close)

	server := httptest.NewServer(s.Handler())
	t.Cleanup(server.Close)
	status, _ := setupRequest(t, server, s.Config.PublicURL, "POST", "/api/setup/claim", map[string]any{
		"email": "typo@example.test", "name": "Ops",
		"instanceName": "Acme",
		"workspace":    map[string]string{"name": "Acme", "slug": "acme"},
	})
	if status != 503 {
		t.Fatalf("claim status = %d, want 503 when delivery fails", status)
	}

	var completed *time.Time
	if e = s.DB.QueryRow(ctx, `SELECT setup_completed_at FROM instance_settings WHERE id`).Scan(&completed); e != nil {
		t.Fatal(e)
	}
	if completed != nil {
		t.Fatal("setup was marked complete even though the code could not be delivered")
	}
	// The assistant must still be claimable, so the operator can retry with a
	// corrected address.
	var stillRequired bool
	if e = s.DB.QueryRow(ctx, `SELECT setup_completed_at IS NULL FROM instance_settings WHERE id`).Scan(&stillRequired); e != nil {
		t.Fatal(e)
	}
	if !stillRequired {
		t.Fatal("the instance stopped being claimable, leaving no way to retry")
	}
	var users int
	if e = s.DB.QueryRow(ctx, `SELECT count(*) FROM users WHERE email='typo@example.test'`).Scan(&users); e != nil {
		t.Fatal(e)
	}
	if users != 0 {
		t.Fatal("a half-finished setup left the mistyped account behind")
	}
}

// defaultWorkspaceId is the only settings field that reaches SQL unvalidated.
// An unknown id must answer 400 like its siblings, not 500 from the foreign key.
func TestPatchSettingsRejectsUnknownDefaultWorkspace(t *testing.T) {
	ctx, s, _, request := instanceWorld(t)
	token := seedSession(t, ctx, s, opaque(), "admin@example.test", true)
	request("PATCH", "/api/admin/settings", token, map[string]any{"defaultWorkspaceId": "nope"}, 400)
}

// The client type advertises string | null, so null has to mean "clear it".
// coalesce() silently turns that into a no-op.
func TestPatchSettingsClearsDefaultWorkspace(t *testing.T) {
	ctx, s, _, request := instanceWorld(t)
	token := seedSession(t, ctx, s, opaque(), "admin@example.test", true)
	workspaceID := opaque()
	if _, e := s.DB.Exec(ctx, `INSERT INTO workspaces(id,slug,name) VALUES($1,'acme','Acme')`, workspaceID); e != nil {
		t.Fatal(e)
	}
	request("PATCH", "/api/admin/settings", token, map[string]any{"defaultWorkspaceId": workspaceID}, 200)
	if s.settings().DefaultWorkspaceID == nil {
		t.Fatal("setting the default workspace did not take")
	}
	out := request("PATCH", "/api/admin/settings", token, map[string]any{"defaultWorkspaceId": nil}, 200)
	if out["defaultWorkspaceId"] != nil {
		t.Fatalf("defaultWorkspaceId = %v, want null after clearing", out["defaultWorkspaceId"])
	}
	if s.settings().DefaultWorkspaceID != nil {
		t.Fatal("the cache still holds a default workspace after it was cleared")
	}
}

// The delivery probe is unauthenticated while setup is open, so the quota is
// the only thing standing between it and an open mail relay.
func TestSetupEmailTestIsRateLimited(t *testing.T) {
	ctx := context.Background()
	cfg := isolatedConfig(t, "probe_rate")
	s, e := New(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(s.Close)
	_ = ctx
	server := httptest.NewServer(s.Handler())
	t.Cleanup(server.Close)
	body := map[string]any{"email": "ops@example.test"}
	for i := 0; i < 10; i++ {
		if status, _ := setupRequest(t, server, s.Config.PublicURL, "POST", "/api/setup/email-test", body); status >= 500 {
			t.Fatalf("probe %d status = %d, want a non-server status", i, status)
		}
	}
	status, _ := setupRequest(t, server, s.Config.PublicURL, "POST", "/api/setup/email-test", body)
	if status != 429 {
		t.Fatalf("11th probe status = %d, want 429 — the probe must stay bounded", status)
	}
}

// A duplicate address is a 409; anything else is a server fault and must not be
// dressed up as one, or an administrator stops retrying a transient failure.
func TestUniqueViolationIsDistinguished(t *testing.T) {
	if !isUniqueViolation(&pgconn.PgError{Code: "23505"}) {
		t.Fatal("23505 should be recognised as a unique violation")
	}
	if isUniqueViolation(&pgconn.PgError{Code: "08006"}) {
		t.Fatal("a connection failure must not be reported as a duplicate address")
	}
	if isUniqueViolation(errors.New("context deadline exceeded")) {
		t.Fatal("a non-PgError must not be reported as a duplicate address")
	}
	if isUniqueViolation(nil) {
		t.Fatal("nil is not a unique violation")
	}
}

// The health panel exists to catch an unmounted or read-only uploads volume.
// /healthz only answers {"ok":true} — it never touches DATA_DIRECTORY — so a
// green "Fichiers" pill derived from it is a claim nobody checked.
func TestAdminHealthProbesTheUploadsVolume(t *testing.T) {
	ctx, s, _, request := instanceWorld(t)
	token := seedSession(t, ctx, s, opaque(), "admin@example.test", true)
	memberToken := seedSession(t, ctx, s, opaque(), "member@example.test", false)

	request("GET", "/api/admin/health", memberToken, nil, 403)

	out := request("GET", "/api/admin/health", token, nil, 200)
	files, _ := out["files"].(map[string]any)
	if files == nil {
		t.Fatalf("health payload has no files section: %#v", out)
	}
	if ok, _ := files["ok"].(bool); !ok {
		t.Fatalf("files.ok = %v on a writable data directory, want true", files["ok"])
	}
	database, _ := out["database"].(map[string]any)
	if ok, _ := database["ok"].(bool); !ok {
		t.Fatal("database.ok should be true while the pool answers")
	}
	mail, _ := out["mail"].(map[string]any)
	if mail["backend"] == nil {
		t.Fatal("mail section must name the configured backend")
	}

	// Point the service at a path it cannot write, as an unmounted volume would.
	s.Config.DataDirectory = filepath.Join(t.TempDir(), "definitely", "not", "there")
	out = request("GET", "/api/admin/health", token, nil, 200)
	files, _ = out["files"].(map[string]any)
	if ok, _ := files["ok"].(bool); ok {
		t.Fatal("files.ok stayed true with an unreachable data directory")
	}
}

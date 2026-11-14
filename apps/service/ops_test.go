package cloud

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func opsFixture(t *testing.T) (context.Context, string, Config) {
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
	schemaName := "ops_test_" + fmt.Sprint(time.Now().UnixNano())
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
		InternalSecret: strings.Repeat("i", 40),
		Deliver:        func(string, string, string) error { return nil },
	}
	return ctx, schemaName, cfg
}

func migrateThenOperate(t *testing.T, ctx context.Context, cfg Config) *Ops {
	t.Helper()
	s, e := New(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	s.Close()
	ops, e := Operate(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(ops.Close)
	return ops
}

func TestOpsGrantCreatesAndPromotes(t *testing.T) {
	ctx, _, cfg := opsFixture(t)
	ops := migrateThenOperate(t, ctx, cfg)

	created, e := ops.GrantInstanceAdmin(ctx, "fresh@example.test")
	if e != nil {
		t.Fatal(e)
	}
	if !created {
		t.Fatal("expected created=true for new email")
	}
	var isAdmin bool
	if e = ops.DB.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM instance_admins ia
			  JOIN users u ON u.id=ia.user_id
			 WHERE u.email='fresh@example.test')`).Scan(&isAdmin); e != nil {
		t.Fatal(e)
	}
	if !isAdmin {
		t.Fatal("user was not promoted to instance admin")
	}

	createdAgain, e := ops.GrantInstanceAdmin(ctx, "fresh@example.test")
	if e != nil {
		t.Fatal(e)
	}
	if createdAgain {
		t.Fatal("expected created=false for existing email")
	}
}

func TestOpsRevokeRefusesLastAdmin(t *testing.T) {
	ctx, _, cfg := opsFixture(t)
	ops := migrateThenOperate(t, ctx, cfg)

	if _, e := ops.GrantInstanceAdmin(ctx, "only@example.test"); e != nil {
		t.Fatal(e)
	}
	e := ops.RevokeInstanceAdmin(ctx, "only@example.test")
	if e == nil || !strings.Contains(e.Error(), "Keep at least one instance administrator") {
		t.Fatalf("revoke last admin: %v", e)
	}
	if !errors.Is(e, errLastInstanceAdmin) {
		t.Fatalf("want errLastInstanceAdmin, got %v", e)
	}
}

func TestOpsOperateRefusesStaleSchema(t *testing.T) {
	ctx, schemaName, cfg := opsFixture(t)
	adminRaw := os.Getenv("TEST_DATABASE_URL")
	adminDB, e := pgxpool.New(ctx, adminRaw)
	if e != nil {
		t.Fatal(e)
	}
	defer adminDB.Close()
	if _, e = adminDB.Exec(ctx, `
		CREATE TABLE `+schemaName+`.schema_migrations(version int PRIMARY KEY);
		INSERT INTO `+schemaName+`.schema_migrations(version) VALUES(4)`); e != nil {
		t.Fatal(e)
	}
	_, e = Operate(ctx, cfg)
	if e == nil {
		t.Fatal("Operate must refuse schema version < 5")
	}
	if !errors.Is(e, ErrSchemaStale) {
		t.Fatalf("want ErrSchemaStale, got %v", e)
	}
}

func TestOpsOperateDoesNotStartBlokOrMCP(t *testing.T) {
	ctx, _, cfg := opsFixture(t)
	// Migrate once via New, then Operate on a fresh DataDirectory so we can
	// prove Operate itself never creates Blok/MCP side effects.
	s, e := New(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	s.Close()

	opsCfg := cfg
	opsCfg.DataDirectory = t.TempDir()
	ops, e := Operate(ctx, opsCfg)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(ops.Close)

	v := reflect.ValueOf(ops).Elem()
	if f := v.FieldByName("Blok"); f.IsValid() {
		t.Fatal("Ops must not carry a Blok field (would imply cloud.New)")
	}
	if f := v.FieldByName("MCP"); f.IsValid() {
		t.Fatal("Ops must not carry an MCP field (would imply cloud.New)")
	}
	if ops.DB == nil {
		t.Fatal("Ops must open a pool")
	}
	if _, e := os.Stat(filepath.Join(opsCfg.DataDirectory, "collab")); !os.IsNotExist(e) {
		t.Fatalf("Operate must not create collab directory: %v", e)
	}
	if _, e := os.Stat(filepath.Join(opsCfg.DataDirectory, "uploads")); !os.IsNotExist(e) {
		t.Fatalf("Operate must not create uploads directory: %v", e)
	}
}

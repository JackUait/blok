package cloud

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Un service neuf sur un schéma PostgreSQL jetable. open() peut être rappelé sur
// le même schéma pour rejouer la migration, ce qui est le seul moyen de prouver
// qu'un redémarrage ne réécrit rien.
func permissionsFixture(t *testing.T) (context.Context, string, func() *Service) {
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
	schemaName := "perm_test_" + fmt.Sprint(time.Now().UnixNano())
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
	open := func() *Service {
		t.Helper()
		cfg := Config{
			DatabaseURL: parsed.String(), PublicURL: "http://localhost:8080",
			InternalURL: "http://localhost:8080", DataDirectory: t.TempDir(),
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
	return ctx, schemaName, open
}

func seedPage(t *testing.T, ctx context.Context, s *Service, id, workspace, parent, visibility string) {
	t.Helper()
	var parentValue any
	if parent != "" {
		parentValue = parent
	}
	meta := fmt.Sprintf(`{"id":%q,"title":%q,"parentId":%s}`, id, id, quoteOrNull(parentValue))
	if _, e := s.DB.Exec(ctx, `INSERT INTO pages(id,workspace_id,metadata,visibility) VALUES($1,$2,$3,$4)`, id, workspace, meta, visibility); e != nil {
		t.Fatal(e)
	}
}

func quoteOrNull(v any) string {
	if v == nil {
		return "null"
	}
	return fmt.Sprintf("%q", v)
}

func seedWorld(t *testing.T, ctx context.Context, s *Service) {
	t.Helper()
	for _, q := range []string{
		`INSERT INTO workspaces(id,slug,name) VALUES('w','w','W')`,
		`INSERT INTO users(id,email) VALUES('alice','alice@example.test'),('bob','bob@example.test'),('zoe','zoe@example.test')`,
		`INSERT INTO memberships(workspace_id,user_id,role) VALUES('w','alice','member'),('w','bob','member'),('w','zoe','admin')`,
	} {
		if _, e := s.DB.Exec(ctx, q); e != nil {
			t.Fatal(e)
		}
	}
}

// La résolution doit tenir contre un vrai PostgreSQL : la remontée récursive, le
// parent lu dans le JSON des métadonnées, et la jointure sur les partages.
func TestEffectiveLevelAgainstPostgres(t *testing.T) {
	ctx, _, open := permissionsFixture(t)
	s := open()
	seedWorld(t, ctx, s)
	seedPage(t, ctx, s, "public", "w", "", visWorkspace)
	seedPage(t, ctx, s, "prive", "w", "", visPrivate)
	seedPage(t, ctx, s, "enfant", "w", "prive", visInherit)
	seedPage(t, ctx, s, "petit", "w", "enfant", visInherit)
	if _, e := s.DB.Exec(ctx, `INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES('prive','bob','view','alice')`); e != nil {
		t.Fatal(e)
	}

	for _, c := range []struct {
		user, page string
		want       level
	}{
		{"alice", "public", levelEdit},
		{"zoe", "public", levelFull},
		{"alice", "prive", levelNone},
		{"zoe", "prive", levelNone},
		{"bob", "prive", levelView},
		{"bob", "enfant", levelView},
		{"bob", "petit", levelView},
		{"alice", "petit", levelNone},
		{"alice", "inexistante", levelNone},
	} {
		got, e := s.effectiveLevel(ctx, s.DB, c.user, c.page)
		if e != nil {
			t.Fatal(e)
		}
		if got != c.want {
			t.Errorf("effectiveLevel(%s,%s) = %v, attendu %v", c.user, c.page, got, c.want)
		}
	}
}

// Le rattrapage de compatibilité ouvre les pages racines existantes à l'espace.
// Il ne doit s'exécuter qu'une fois : le schéma est rejoué à chaque démarrage, et
// une page délibérément remise en héritage ne doit pas être rouverte.
func TestBackfillRunsOnceOnly(t *testing.T) {
	ctx, _, open := permissionsFixture(t)
	s := open()
	seedWorld(t, ctx, s)
	seedPage(t, ctx, s, "racine", "w", "", visInherit)

	s.Close()
	restarted := open()

	var visibility string
	if e := restarted.DB.QueryRow(ctx, `SELECT visibility FROM pages WHERE id='racine'`).Scan(&visibility); e != nil {
		t.Fatal(e)
	}
	if visibility != visInherit {
		t.Fatalf("un redémarrage a réécrit la visibilité en %q", visibility)
	}
}

// Le schéma doit refuser les valeurs qui n'appartiennent pas au modèle, sinon une
// donnée aberrante devient une permission silencieuse.
func TestSchemaRefusesUnknownValues(t *testing.T) {
	ctx, _, open := permissionsFixture(t)
	s := open()
	seedWorld(t, ctx, s)
	seedPage(t, ctx, s, "p", "w", "", visWorkspace)

	if _, e := s.DB.Exec(ctx, `UPDATE pages SET visibility='public' WHERE id='p'`); e == nil {
		t.Fatal("une visibilité inconnue a été acceptée")
	}
	if _, e := s.DB.Exec(ctx, `INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES('p','alice','owner','alice')`); e == nil {
		t.Fatal("un niveau de partage inconnu a été accepté")
	}
	if _, e := s.DB.Exec(ctx, `INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES('p','alice','none','alice')`); e == nil {
		t.Fatal("un partage sans accès a été accepté ; une absence est une ligne absente")
	}
}

package cloud

import (
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

	blokserver "github.com/JackUait/blok/packages/server/go/v2/blokserver"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Le monde du scénario négatif : Bob a une page privée, Alice est membre du même
// espace sans aucun partage, Zoé en est administratrice. Tout ce que ce fichier
// vérifie, c'est qu'Alice et Zoé ne trouvent la page par aucun chemin.
type readsWorld struct {
	service *Service
	server  *httptest.Server
	ctx     context.Context
}

const (
	tokenAlice = "token-alice"
	tokenBob   = "token-bob"
	tokenZoe   = "token-zoe"
)

func newReadsWorld(t *testing.T) *readsWorld {
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
	schemaName := "reads_test_" + fmt.Sprint(time.Now().UnixNano())
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

	server := httptest.NewUnstartedServer(nil)
	cfg := Config{
		DatabaseURL: parsed.String(), PublicURL: "http://" + server.Listener.Addr().String(),
		InternalURL: "http://" + server.Listener.Addr().String(), DataDirectory: t.TempDir(),
		Development: true, TicketSecret: strings.Repeat("t", 40),
		InternalSecret: strings.Repeat("i", 40),
		Deliver:        func(string, string, string) error { return nil },
	}
	s, e := New(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(s.Close)
	server.Config.Handler = s.Handler()
	server.Start()
	t.Cleanup(server.Close)

	for _, q := range []string{
		`INSERT INTO workspaces(id,slug,name) VALUES('w','equipe','Equipe')`,
		`INSERT INTO users(id,email) VALUES('alice','alice@example.test'),('bob','bob@example.test'),('zoe','zoe@example.test')`,
		`INSERT INTO memberships(workspace_id,user_id,role) VALUES('w','alice','member'),('w','bob','member'),('w','zoe','admin')`,
	} {
		if _, e := s.DB.Exec(ctx, q); e != nil {
			t.Fatal(e)
		}
	}
	for user, token := range map[string]string{"alice": tokenAlice, "bob": tokenBob, "zoe": tokenZoe} {
		if _, e := s.DB.Exec(ctx, `INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')`, hash(token), user); e != nil {
			t.Fatal(e)
		}
	}
	w := &readsWorld{service: s, server: server, ctx: ctx}
	w.page(t, "public", "", visWorkspace)
	w.page(t, "prive", "", visPrivate)
	w.page(t, "enfant", "prive", visInherit)
	if _, e := s.DB.Exec(ctx, `INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES('prive','bob','full','bob')`); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DB.Exec(ctx, `INSERT INTO assets(name,workspace_id,document_id) VALUES('secret.png','w','prive'),('commun.png','w','public')`); e != nil {
		t.Fatal(e)
	}
	return w
}

func (w *readsWorld) page(t *testing.T, id, parent, visibility string) {
	t.Helper()
	parentValue := "null"
	if parent != "" {
		parentValue = fmt.Sprintf("%q", parent)
	}
	meta := fmt.Sprintf(`{"id":%q,"title":%q,"parentId":%s}`, id, id, parentValue)
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO pages(id,workspace_id,metadata,content,visibility) VALUES($1,'w',$2,'{"blocks":[]}',$3)`, id, meta, visibility); e != nil {
		t.Fatal(e)
	}
}

func (w *readsWorld) get(t *testing.T, token, path string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest("GET", w.server.URL+path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, e := http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var out map[string]any
	json.Unmarshal(body, &out)
	return resp.StatusCode, out
}

func listedIDs(t *testing.T, payload map[string]any) map[string]bool {
	t.Helper()
	ids := map[string]bool{}
	for _, key := range []string{"pages", "trash"} {
		raw, _ := payload[key].([]any)
		for _, entry := range raw {
			page, _ := entry.(map[string]any)
			if id, ok := page["id"].(string); ok {
				ids[id] = true
			}
		}
	}
	return ids
}

// L'index ne montre que ce que l'appelant peut voir.
func TestIndexHidesPrivatePages(t *testing.T) {
	w := newReadsWorld(t)
	status, payload := w.get(t, tokenAlice, "/api/workspaces/equipe/index")
	if status != 200 {
		t.Fatalf("index pour Alice: %d", status)
	}
	ids := listedIDs(t, payload)
	if ids["prive"] || ids["enfant"] {
		t.Fatal("l'index a exposé une page privée d'autrui")
	}
	if !ids["public"] {
		t.Fatal("l'index a caché une page de l'espace")
	}
	_, bobIndex := w.get(t, tokenBob, "/api/workspaces/equipe/index")
	if !listedIDs(t, bobIndex)["prive"] {
		t.Fatal("le propriétaire ne voit plus sa propre page privée")
	}
	// Un administrateur n'est pas un passe-partout.
	_, zoeIndex := w.get(t, tokenZoe, "/api/workspaces/equipe/index")
	if listedIDs(t, zoeIndex)["prive"] {
		t.Fatal("l'index a exposé une page privée à une administratrice")
	}
}

// L'index annonce le niveau de chaque page : c'est ce qui permettra à l'interface
// de passer une page en lecture seule sans aller-retour supplémentaire.
func TestIndexReportsLevels(t *testing.T) {
	w := newReadsWorld(t)
	_, payload := w.get(t, tokenBob, "/api/workspaces/equipe/index")
	access, _ := payload["access"].(map[string]any)
	if access == nil {
		t.Fatal("l'index n'annonce aucun niveau")
	}
	for page, want := range map[string]string{"public": "edit", "prive": "full", "enfant": "full"} {
		entry, _ := access[page].(map[string]any)
		if entry == nil || entry["level"] != want {
			t.Errorf("niveau de %s = %v, attendu %s", page, entry, want)
		}
	}
}

// Une page accessible dont le parent ne l'est pas ne peut pas s'afficher sous un
// nœud que l'appelant ne connaît pas : elle remonte, signalée.
func TestSharedChildDetachesFromHiddenParent(t *testing.T) {
	w := newReadsWorld(t)
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES('enfant','alice','view','bob')`); e != nil {
		t.Fatal(e)
	}
	_, payload := w.get(t, tokenAlice, "/api/workspaces/equipe/index")
	ids := listedIDs(t, payload)
	if !ids["enfant"] || ids["prive"] {
		t.Fatal("l'enfant partagé doit apparaître sans son parent privé")
	}
	pages, _ := payload["pages"].([]any)
	for _, entry := range pages {
		page, _ := entry.(map[string]any)
		if page["id"] == "enfant" && page["parentId"] != nil {
			t.Fatalf("l'enfant pointe encore vers un parent inaccessible: %v", page["parentId"])
		}
	}
	access, _ := payload["access"].(map[string]any)
	entry, _ := access["enfant"].(map[string]any)
	if entry == nil || entry["sharedRoot"] != true {
		t.Fatal("le détachement n'est pas signalé ; le PUT le prendrait pour un déplacement")
	}
}

// Une page qu'on n'a pas le droit de voir n'existe pas : 404, jamais 403, sinon
// la réponse confirme son existence.
func TestPageReadRefusedAsNotFound(t *testing.T) {
	w := newReadsWorld(t)
	if status, _ := w.get(t, tokenAlice, "/api/workspaces/equipe/pages/prive"); status != 404 {
		t.Fatalf("lecture d'une page privée par Alice: %d", status)
	}
	if status, _ := w.get(t, tokenZoe, "/api/workspaces/equipe/pages/enfant"); status != 404 {
		t.Fatalf("lecture d'une sous-page privée par l'administratrice: %d", status)
	}
	if status, _ := w.get(t, tokenBob, "/api/workspaces/equipe/pages/prive"); status != 200 {
		t.Fatalf("le propriétaire ne lit plus sa page: %d", status)
	}
}

// Le billet de collaboration est la porte du temps réel.
func TestTicketRefusedForPrivatePage(t *testing.T) {
	w := newReadsWorld(t)
	if status, _ := w.get(t, tokenAlice, "/api/workspaces/equipe/ticket?doc=prive"); status != 404 {
		t.Fatalf("billet d'espace pour une page privée: %d", status)
	}
	if status, _ := w.get(t, tokenAlice, "/api/blok-ticket?doc=prive"); status == 200 {
		t.Fatal("le billet direct a été délivré pour une page privée")
	}
	if status, _ := w.get(t, tokenBob, "/api/workspaces/equipe/ticket?doc=prive"); status != 200 {
		t.Fatalf("le propriétaire n'obtient plus de billet: %d", status)
	}
}

// Les autorisations que la collaboration interroge directement.
func TestDocumentAuthorizationFollowsPermissions(t *testing.T) {
	w := newReadsWorld(t)
	for _, c := range []struct {
		token, doc        string
		canRead, canWrite bool
	}{
		{tokenAlice, "public", true, true},
		{tokenAlice, "prive", false, false},
		{tokenAlice, "enfant", false, false},
		{tokenZoe, "prive", false, false},
		{tokenBob, "prive", true, true},
	} {
		user := blokserver.User{ID: hash(c.token)}
		read, e := w.service.CanReadDocument(w.ctx, user, c.doc)
		if e != nil {
			t.Fatal(e)
		}
		write, e := w.service.CanWriteDocument(w.ctx, user, c.doc)
		if e != nil {
			t.Fatal(e)
		}
		if read != c.canRead || write != c.canWrite {
			t.Errorf("%s sur %s: lecture=%v écriture=%v, attendu %v/%v", c.token, c.doc, read, write, c.canRead, c.canWrite)
		}
	}
}

// Masquer une page ne protège pas ses fichiers : l'URL d'un fichier est devinable
// et sa route ne passait par aucune vérification de page.
func TestAssetFollowsItsPage(t *testing.T) {
	w := newReadsWorld(t)
	assetURL := func(token, name string) int {
		target := url.QueryEscape(w.server.URL + "/files/" + name)
		status, _ := w.get(t, token, "/api/assets/url?url="+target)
		return status
	}
	if status := assetURL(tokenAlice, "secret.png"); status != 403 {
		t.Fatalf("Alice a obtenu une URL signée pour le fichier d'une page privée: %d", status)
	}
	if status := assetURL(tokenZoe, "secret.png"); status != 403 {
		t.Fatalf("l'administratrice a obtenu le fichier d'une page privée: %d", status)
	}
	if status := assetURL(tokenBob, "secret.png"); status != 200 {
		t.Fatalf("le propriétaire n'accède plus à son fichier: %d", status)
	}
	if status := assetURL(tokenAlice, "commun.png"); status != 200 {
		t.Fatalf("un fichier de page commune a été refusé: %d", status)
	}
	req, _ := http.NewRequest("GET", w.server.URL+"/files/secret.png", nil)
	req.Header.Set("Authorization", "Bearer "+tokenAlice)
	resp, e := http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatalf("le service de fichiers a servi un fichier privé: %d", resp.StatusCode)
	}
}

// Une ressource d'espace — emoji, couverture — n'appartient à aucune page et
// reste accessible à tout membre.
func TestWorkspaceAssetStaysShared(t *testing.T) {
	w := newReadsWorld(t)
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO assets(name,workspace_id,document_id) VALUES('emoji.png','w',NULL)`); e != nil {
		t.Fatal(e)
	}
	target := url.QueryEscape(w.server.URL + "/files/emoji.png")
	if status, _ := w.get(t, tokenAlice, "/api/assets/url?url="+target); status != 200 {
		t.Fatalf("une ressource d'espace a été refusée à un membre: %d", status)
	}
}

func mcpRequestFor(t *testing.T, args map[string]any) *mcp.CallToolRequest {
	t.Helper()
	encoded, e := json.Marshal(args)
	if e != nil {
		t.Fatal(e)
	}
	return &mcp.CallToolRequest{Params: &mcp.CallToolParamsRaw{Arguments: encoded}}
}

func mcpResultText(t *testing.T, result *mcp.CallToolResult) string {
	t.Helper()
	if result.IsError {
		t.Fatalf("le MCP a refusé: %v", result.Content)
	}
	out := ""
	for _, content := range result.Content {
		if text, ok := content.(*mcp.TextContent); ok {
			out += text.Text
		}
	}
	return out
}

// Le MCP est une porte comme une autre, et un jeton n'est pas un contournement.
func TestMCPListPagesFiltersPrivate(t *testing.T) {
	w := newReadsWorld(t)
	listFor := func(user string) map[string]bool {
		ctx := context.WithValue(w.ctx, mcpUserKey{}, identity{ID: user})
		result, e := w.service.mcpListPages(ctx, mcpRequestFor(t, map[string]any{"workspace": "equipe"}))
		if e != nil {
			t.Fatal(e)
		}
		var listed struct {
			Pages []struct {
				ID string `json:"id"`
			} `json:"pages"`
		}
		if e := json.Unmarshal([]byte(mcpResultText(t, result)), &listed); e != nil {
			t.Fatal(e)
		}
		ids := map[string]bool{}
		for _, page := range listed.Pages {
			ids[page.ID] = true
		}
		return ids
	}
	if listFor("alice")["prive"] {
		t.Fatal("le MCP a listé une page privée d'autrui")
	}
	if !listFor("alice")["public"] {
		t.Fatal("le MCP a caché une page de l'espace")
	}
	if !listFor("bob")["prive"] {
		t.Fatal("le propriétaire ne voit plus sa page par le MCP")
	}
}

// Les outils d'édition MCP ont leur propre porte, distincte de celle du temps
// réel et de celle des routes HTTP. Un jeton n'est pas un contournement.
func TestMCPDocumentAuthorizationFollowsPermissions(t *testing.T) {
	w := newReadsWorld(t)
	for _, c := range []struct {
		user, doc         string
		canRead, canWrite bool
	}{
		{"alice", "public", true, true},
		{"alice", "prive", false, false},
		{"alice", "enfant", false, false},
		{"zoe", "prive", false, false},
		{"bob", "prive", true, true},
	} {
		read, e := w.service.authorizeMCPDocument(w.ctx, c.user, c.doc, false)
		if e != nil {
			t.Fatal(e)
		}
		write, e := w.service.authorizeMCPDocument(w.ctx, c.user, c.doc, true)
		if e != nil {
			t.Fatal(e)
		}
		if read != c.canRead || write != c.canWrite {
			t.Errorf("%s sur %s: lecture=%v écriture=%v, attendu %v/%v", c.user, c.doc, read, write, c.canRead, c.canWrite)
		}
	}
}

// La barre latérale doit pouvoir ranger chaque page sous « Privé », « Partagé »
// ou « Espace ». Le niveau ne suffit pas à le dire : il faut la visibilité
// effective, et savoir si quelqu'un d'autre a un droit dessus.
func TestIndexReportsVisibilityAndSharing(t *testing.T) {
	w := newReadsWorld(t)
	w.page(t, "mienne", "", visPrivate)
	if _, e := w.service.DB.Exec(w.ctx, `INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES('mienne','bob','full','bob'),('prive','zoe','view','bob')`); e != nil {
		t.Fatal(e)
	}
	_, payload := w.get(t, tokenBob, "/api/workspaces/equipe/index")
	access, _ := payload["access"].(map[string]any)
	for page, want := range map[string]struct {
		visibility string
		shared     bool
	}{
		"public": {visWorkspace, false},
		"prive":  {visPrivate, true},  // partagée avec Zoé
		"enfant": {visPrivate, true},  // hérite du partage de son parent
		"mienne": {visPrivate, false}, // privée, personne d'autre
	} {
		entry, _ := access[page].(map[string]any)
		if entry == nil {
			t.Fatalf("%s absente de la feuille d'accès", page)
		}
		if entry["visibility"] != want.visibility {
			t.Errorf("visibilité de %s = %v, attendu %s", page, entry["visibility"], want.visibility)
		}
		if (entry["shared"] == true) != want.shared {
			t.Errorf("partage de %s = %v, attendu %v", page, entry["shared"], want.shared)
		}
	}
}

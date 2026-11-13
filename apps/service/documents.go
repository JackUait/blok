package cloud

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/blokserver/ticket"
	"github.com/jackc/pgx/v5"
)

func (s *Service) index(w http.ResponseWriter, r *http.Request, u identity, ws Workspace) {
	if r.Method == "GET" {
		tx, e := s.DB.Begin(r.Context())
		if e != nil {
			problem(w, 503, "Database unavailable")
			return
		}
		defer tx.Rollback(r.Context())
		var revision int64
		if e = tx.QueryRow(r.Context(), "SELECT revision FROM workspaces WHERE id=$1 FOR SHARE", ws.ID).Scan(&revision); e != nil {
			problem(w, 500, "Read failed")
			return
		}
		standings, parents, e := s.workspaceStandings(r.Context(), tx, u.ID, ws.ID)
		if e != nil {
			problem(w, 500, "Read failed")
			return
		}
		rows, e := tx.Query(r.Context(), "SELECT id,metadata,trashed FROM pages WHERE workspace_id=$1 AND NOT deleted ORDER BY (metadata->>'position')::numeric NULLS LAST,id", ws.ID)
		if e != nil {
			problem(w, 500, "Read failed")
			return
		}
		pages := []json.RawMessage{}
		trash := []json.RawMessage{}
		access := map[string]any{}
		for rows.Next() {
			var id string
			var meta []byte
			var tr bool
			if e = rows.Scan(&id, &meta, &tr); e != nil {
				rows.Close()
				problem(w, 500, "Read failed")
				return
			}
			standing := standings[id]
			if standing.Level < levelView {
				continue
			}
			// La barre latérale range une page sous « Privé », « Partagé » ou
			// « Espace » ; le niveau seul ne permet pas de les distinguer.
			entry := map[string]any{"level": standing.Level.String(), "visibility": standing.Visibility, "shared": standing.Shared}
			// Une page accessible sous un parent qui ne l'est pas ne peut pas
			// s'afficher sous un nœud que l'appelant ne reçoit pas. Elle remonte,
			// et le signalement empêche l'enregistrement de lire ce détachement
			// comme un déplacement vers la racine.
			if parent := parents[id]; parent != "" && standings[parent].Level < levelView {
				detached, failure := detachParent(meta)
				if failure != nil {
					rows.Close()
					problem(w, 500, "Read failed")
					return
				}
				meta = detached
				entry["sharedRoot"] = true
			}
			access[id] = entry
			if tr {
				trash = append(trash, json.RawMessage(meta))
			} else {
				pages = append(pages, json.RawMessage(meta))
			}
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			problem(w, 500, "Read failed")
			return
		}
		jsonOut(w, 200, map[string]any{"pages": pages, "trash": trash, "revision": revision, "access": access})
		return
	}
	if r.Method != "PUT" {
		problem(w, 405, "Method not allowed")
		return
	}
	if ws.Role == "viewer" {
		problem(w, 403, "Write access required")
		return
	}
	var in struct {
		Pages    []map[string]any `json:"pages"`
		Trash    []map[string]any `json:"trash"`
		Revision *int64           `json:"revision"`
	}
	if !body(w, r, &in) {
		return
	}
	if in.Revision == nil || in.Pages == nil || len(in.Pages)+len(in.Trash) > 10000 {
		problem(w, 400, "Pages and revision required")
		return
	}
	ids := map[string]bool{}
	parents := map[string]string{}
	all := []incomingPage{}
	for _, p := range in.Pages {
		all = append(all, incomingPage{page: p, trashed: false})
	}
	for _, p := range in.Trash {
		all = append(all, incomingPage{page: p, trashed: true})
	}
	for _, entry := range all {
		p := entry.page
		id, _ := p["id"].(string)
		parent, _ := p["parentId"].(string)
		if !validPageMetadata(p) || ids[id] {
			problem(w, 400, "Invalid page metadata")
			return
		}
		ids[id] = true
		parents[id] = parent
	}
	if !validParents(parents) {
		problem(w, 400, "Invalid parent hierarchy (missing parent or cycle)")
		return
	}
	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	var rev int64
	if e = tx.QueryRow(r.Context(), "SELECT revision FROM workspaces WHERE id=$1 FOR UPDATE", ws.ID).Scan(&rev); e != nil {
		problem(w, 500, "Save failed")
		return
	}
	var role string
	if e = tx.QueryRow(r.Context(), "SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2", ws.ID, u.ID).Scan(&role); e != nil || role == "viewer" {
		problem(w, 403, "Write access required")
		return
	}
	if rev != *in.Revision {
		problem(w, 409, "Workspace changed; reload before saving")
		return
	}
	levels, realParents, e := s.workspaceLevels(r.Context(), tx, u.ID, ws.ID)
	if e != nil {
		problem(w, 500, "Save failed")
		return
	}
	known, order, e := currentIndex(r.Context(), tx, ws.ID)
	if e != nil {
		problem(w, 500, "Save failed")
		return
	}
	// Nommer une page qu'on ne voit pas n'est pas un enregistrement : c'est une
	// tentative de reprise. Un identifiant inconnu, lui, reste une création.
	for _, entry := range all {
		id := entry.id()
		if known[id] && levels[id] < levelView {
			problem(w, 403, "Page access refused")
			return
		}
	}
	// L'appelant n'a pu envoyer que ce qu'il voit. Tombstoner sur cette seule
	// base effacerait les pages des autres ; la suppression ne porte donc que sur
	// ce qu'il peut écrire.
	removable := []string{}
	for _, id := range order {
		if levels[id] >= levelEdit && !ids[id] {
			removable = append(removable, id)
		}
	}
	if _, e = tx.Exec(r.Context(), "UPDATE pages SET deleted=true WHERE workspace_id=$1 AND id=ANY($2)", ws.ID, removable); e != nil {
		problem(w, 500, "Save failed")
		return
	}
	for position, slot := range mergeIndexOrder(order, all, levels, known) {
		if slot.page == nil {
			// Page invisible ou en lecture seule : elle garde son contenu et sa
			// place relative. Seul son rang bouge, parce qu'un ordre global ne
			// peut pas se renuméroter à moitié.
			if _, e = tx.Exec(r.Context(), `UPDATE pages SET metadata=jsonb_set(metadata,'{position}',to_jsonb($2::int)) WHERE id=$1 AND NOT deleted`, slot.id, position); e != nil {
				problem(w, 500, "Save failed")
				return
			}
			continue
		}
		p := slot.page
		p["position"] = position
		// L'index détache une page de son parent caché pour pouvoir l'afficher.
		// La réécrire telle quelle la déracinerait. Un parent explicitement
		// différent reste un déplacement voulu.
		if parent, sent := p["parentId"].(string); !sent || parent == "" {
			if real := realParents[slot.id]; real != "" && levels[real] < levelView {
				p["parentId"] = real
			}
		}
		// Une page naît ouverte à l'espace quand elle est à la racine, et héritière
		// sinon. Sans cela une page neuve naîtrait privée sans que personne ne
		// l'ait demandé — invisible y compris pour son auteur, qui ne détient
		// encore aucun partage. La visibilité d'une page existante n'est jamais
		// réécrite ici : l'index transporte l'arborescence, pas les accès.
		visibility := visInherit
		if parent, _ := p["parentId"].(string); parent == "" {
			visibility = visWorkspace
		}
		// Creation-only intent: private visibility and the author's full access
		// are committed together. Never publish first and restrict in a second call.
		if requested, present := p["initialVisibility"]; present {
			if requested != visPrivate {
				problem(w, 400, "Invalid initial visibility")
				return
			}
			if !known[slot.id] {
				if parent, _ := p["parentId"].(string); parent != "" {
					problem(w, 400, "Private creation requires a root page")
					return
				}
				visibility = visPrivate
			}
			delete(p, "initialVisibility")
		}
		encoded, _ := json.Marshal(p)
		tag, e := tx.Exec(r.Context(), `INSERT INTO pages(id,workspace_id,metadata,trashed,visibility) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET metadata=$3,trashed=$4,deleted=false WHERE pages.workspace_id=$2`, slot.id, ws.ID, encoded, slot.trashed, visibility)
		if e != nil {
			problem(w, 500, "Save failed")
			return
		}
		if tag.RowsAffected() != 1 {
			problem(w, 409, "Page ID already belongs to another workspace")
			return
		}
		// Sans cela, partager serait réservé aux administrateurs — y compris la
		// page qu'on vient d'écrire soi-même. Maîtriser n'est pas fermer : la
		// page reste ouverte à l'espace si elle est à la racine.
		if !known[slot.id] {
			if _, e = tx.Exec(r.Context(), "INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES($1,$2,'full',$2) ON CONFLICT DO NOTHING", slot.id, u.ID); e != nil {
				problem(w, 500, "Save failed")
				return
			}
		}
	}
	if _, e = tx.Exec(r.Context(), "UPDATE workspaces SET revision=revision+1 WHERE id=$1", ws.ID); e != nil {
		problem(w, 500, "Save failed")
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		problem(w, 500, "Save failed")
		return
	}
	s.recheckWorkspace(r.Context(), ws.ID)
	jsonOut(w, 200, map[string]any{"revision": rev + 1})
}
func (s *Service) page(w http.ResponseWriter, r *http.Request, u identity, ws Workspace) {
	if r.Method == "POST" && r.PathValue("action") == "seed" {
		s.seed(w, r, u, ws)
		return
	}
	if r.Method == "POST" && r.PathValue("action") == "duplicate" {
		s.duplicate(w, r, u, ws)
		return
	}
	switch r.PathValue("action") {
	case "access":
		s.pageAccess(w, r, u, ws)
		return
	case "shares":
		s.pageShare(w, r, u, ws)
		return
	}
	if r.Method != "GET" {
		problem(w, 405, "Use Blok collaboration to edit document content")
		return
	}
	// Refuser par 404 : un 403 confirmerait l'existence de la page, ce qui est
	// déjà une fuite quand elle est privée.
	granted, e := s.effectiveLevel(r.Context(), s.DB, u.ID, r.PathValue("id"))
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	if granted < levelView {
		problem(w, 404, "Page not found")
		return
	}
	var content []byte
	e = s.DB.QueryRow(r.Context(), "SELECT content FROM pages WHERE id=$1 AND workspace_id=$2 AND NOT deleted", r.PathValue("id"), ws.ID).Scan(&content)
	if e != nil {
		problem(w, 404, "Page not found")
		return
	}
	if len(content) == 0 {
		content = []byte("null")
	}
	jsonOut(w, 200, json.RawMessage(content))
}
func (s *Service) ticket(w http.ResponseWriter, r *http.Request, u identity, ws Workspace, _ string) {
	if r.Method != "GET" {
		problem(w, 405, "Method not allowed")
		return
	}
	doc := r.URL.Query().Get("doc")
	var owner string
	e := s.DB.QueryRow(r.Context(), "SELECT workspace_id FROM pages WHERE id=$1 AND NOT deleted AND NOT trashed", doc).Scan(&owner)
	if e != nil || owner != ws.ID {
		problem(w, 404, "Page not found")
		return
	}
	granted, e := s.effectiveLevel(r.Context(), s.DB, u.ID, doc)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	if granted < levelView {
		problem(w, 404, "Page not found")
		return
	}
	s.mintTicket(w, r, u, doc, granted >= levelEdit)
}
func (s *Service) getTicket(w http.ResponseWriter, r *http.Request) {
	u, ok := s.require(w, r)
	if !ok {
		return
	}
	doc := r.URL.Query().Get("doc")
	can, e := s.authorizeDoc(r.Context(), u.Session, doc, false)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	if !can {
		problem(w, 403, "Document access refused")
		return
	}
	write, e := s.authorizeDoc(r.Context(), u.Session, doc, true)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	s.mintTicket(w, r, u, doc, write)
}
func (s *Service) mintTicket(w http.ResponseWriter, r *http.Request, u identity, doc string, write bool) {
	if _, e := s.DB.Exec(r.Context(), "UPDATE pages SET admission_started=true WHERE id=$1", doc); e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	ttl := int64(60)
	t, e := ticket.Mint(s.Config.TicketSecret, ticket.Claims{User: u.Session, Doc: &doc, Write: write, TTLSeconds: &ttl}, time.Now())
	if e != nil {
		problem(w, 500, "Ticket creation failed")
		return
	}
	jsonOut(w, 200, map[string]any{"ticket": t})
}
func (s *Service) document(w http.ResponseWriter, r *http.Request) {
	if !internalAuth(r, s.Config.InternalSecret) {
		problem(w, 401, "Internal authorization required")
		return
	}
	id := r.PathValue("id")
	switch r.Method {
	case "GET":
		var content []byte
		var version int64
		var lineage *string
		var seq *string
		e := s.DB.QueryRow(r.Context(), "SELECT content,version,lineage,sequence::text FROM pages WHERE id=$1", id).Scan(&content, &version, &lineage, &seq)
		if e != nil {
			problem(w, 404, "Document not found")
			return
		}
		if len(content) == 0 {
			content = []byte("null")
		}
		jsonOut(w, 200, map[string]any{"data": json.RawMessage(content), "version": strconv.FormatInt(version, 10)})
	case "PUT":
		raw, e := io.ReadAll(io.LimitReader(r.Body, 64<<20+1))
		if e != nil || len(raw) > 64<<20 || !json.Valid(raw) {
			problem(w, 400, "Invalid document")
			return
		}
		lineage := r.Header.Get("Blok-Doc-Lineage")
		sequence := r.Header.Get("Blok-Doc-Sequence")
		if sequence == "" {
			sequence = "0"
		}
		if _, e = strconv.ParseUint(sequence, 10, 64); e != nil {
			problem(w, 400, "Invalid sequence")
			return
		}
		var version int64
		e = s.DB.QueryRow(r.Context(), `UPDATE pages SET content=$2,version=version+1,lineage=$3,sequence=$4 WHERE id=$1 AND (lineage IS NULL OR lineage<>$3 OR sequence IS NULL OR sequence<=$4::numeric) RETURNING version`, id, raw, lineage, sequence).Scan(&version)
		if e != nil {
			problem(w, 409, "Document missing or projection stale")
			return
		}
		jsonOut(w, 200, map[string]string{"version": fmt.Sprint(version)})
	default:
		problem(w, 405, "Method not allowed")
	}
}

func (s *Service) duplicate(w http.ResponseWriter, r *http.Request, u identity, ws Workspace) {
	if ws.Role == "viewer" {
		problem(w, 403, "Write access required")
		return
	}
	var in struct {
		ID       string  `json:"id"`
		Title    string  `json:"title"`
		ParentID *string `json:"parentId"`
	}
	if !body(w, r, &in) {
		return
	}
	if !pageIDPattern.MatchString(in.ID) || len(in.Title) > 4096 {
		problem(w, 400, "Invalid duplicate metadata")
		return
	}
	source := r.PathValue("id")
	var owner string
	if e := s.DB.QueryRow(r.Context(), "SELECT workspace_id FROM pages WHERE id=$1 AND NOT deleted AND NOT trashed", source).Scan(&owner); e != nil || owner != ws.ID {
		problem(w, 404, "Source page not found")
		return
	}
	// Dupliquer traverse deux pages aux droits différents : on lit la source, on
	// écrit sous le parent. Les deux se vérifient, et par 404 — un 403 dirait que
	// la page existe.
	granted, e := s.effectiveLevel(r.Context(), s.DB, u.ID, source)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	if granted < levelView {
		problem(w, 404, "Source page not found")
		return
	}
	if in.ParentID != nil && *in.ParentID != "" {
		target, e := s.effectiveLevel(r.Context(), s.DB, u.ID, *in.ParentID)
		if e != nil {
			problem(w, 503, "Database unavailable")
			return
		}
		if target < levelEdit {
			problem(w, 404, "Parent page not found")
			return
		}
	}
	if _, e := s.DB.Exec(r.Context(), "UPDATE pages SET admission_started=true WHERE id=$1", source); e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	ttl := int64(60)
	pass, e := ticket.Mint(s.Config.TicketSecret, ticket.Claims{User: u.Session, Doc: &source, Write: true, TTLSeconds: &ttl}, time.Now())
	if e != nil {
		problem(w, 500, "Ticket creation failed")
		return
	}
	req := httptest.NewRequest("GET", "/api/blok/sync/"+url.PathEscape(source)+"/state?ticket="+url.QueryEscape(pass), nil).WithContext(r.Context())
	req.Header.Set("Origin", s.Config.PublicURL)
	req.Header.Set("Authorization", "Bearer "+pass)
	rec := httptest.NewRecorder()
	s.Blok.Handler("/api/blok").ServeHTTP(rec, req)
	if rec.Code != 200 {
		problem(w, 503, "Could not snapshot the live source document")
		return
	}
	var content map[string]any
	if json.Unmarshal(rec.Body.Bytes(), &content) != nil {
		problem(w, 500, "Invalid source state")
		return
	}
	content["title"] = in.Title
	encoded, _ := json.Marshal(content)
	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	var revision int64
	if e = tx.QueryRow(r.Context(), "SELECT revision FROM workspaces WHERE id=$1 FOR UPDATE", ws.ID).Scan(&revision); e != nil {
		problem(w, 500, "Duplicate failed")
		return
	}
	var role string
	if e = tx.QueryRow(r.Context(), "SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2", ws.ID, u.ID).Scan(&role); e != nil || role == "viewer" {
		problem(w, 403, "Write access required")
		return
	}
	if in.ParentID != nil {
		var valid bool
		if e = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM pages WHERE id=$1 AND workspace_id=$2 AND NOT deleted AND NOT trashed)", *in.ParentID, ws.ID).Scan(&valid); e != nil || !valid {
			problem(w, 400, "Invalid parent page")
			return
		}
	}
	var meta []byte
	var sourceVisibility string
	if e = tx.QueryRow(r.Context(), "SELECT metadata,visibility FROM pages WHERE id=$1 AND workspace_id=$2 AND NOT deleted AND NOT trashed", source, ws.ID).Scan(&meta, &sourceVisibility); e != nil {
		problem(w, 404, "Source page not found")
		return
	}
	var metadata map[string]any
	json.Unmarshal(meta, &metadata)
	metadata["id"] = in.ID
	metadata["title"] = in.Title
	metadata["parentId"] = in.ParentID
	var position int
	if e = tx.QueryRow(r.Context(), "SELECT count(*) FROM pages WHERE workspace_id=$1", ws.ID).Scan(&position); e != nil {
		problem(w, 500, "Duplicate failed")
		return
	}
	metadata["position"] = position
	meta, _ = json.Marshal(metadata)
	// La copie reprend la visibilité de la source : dupliquer ne doit jamais
	// élargir un accès. Le duplicateur en reçoit la maîtrise, faute de quoi la
	// copie d'une page privée naîtrait hors d'atteinte de qui l'a demandée.
	if _, e = tx.Exec(r.Context(), "INSERT INTO pages(id,workspace_id,metadata,content,visibility) VALUES($1,$2,$3,$4,$5)", in.ID, ws.ID, meta, encoded, sourceVisibility); e != nil {
		problem(w, 409, "Duplicate page ID already exists")
		return
	}
	if _, e = tx.Exec(r.Context(), "INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES($1,$2,'full',$2) ON CONFLICT DO NOTHING", in.ID, u.ID); e != nil {
		problem(w, 500, "Duplicate failed")
		return
	}
	if _, e = tx.Exec(r.Context(), "UPDATE workspaces SET revision=revision+1 WHERE id=$1", ws.ID); e != nil {
		problem(w, 500, "Duplicate failed")
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		problem(w, 500, "Duplicate failed")
		return
	}
	jsonOut(w, 201, map[string]any{"id": in.ID, "revision": revision + 1})
}

func (s *Service) seed(w http.ResponseWriter, r *http.Request, u identity, ws Workspace) {
	if ws.Role == "viewer" {
		problem(w, 403, "Write access required")
		return
	}
	var in struct {
		Document json.RawMessage `json:"document"`
	}
	if !body(w, r, &in) {
		return
	}
	granted, e := s.effectiveLevel(r.Context(), s.DB, u.ID, r.PathValue("id"))
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	if granted < levelView {
		problem(w, 404, "Page not found")
		return
	}
	if granted < levelEdit {
		problem(w, 403, "Write access required")
		return
	}
	var doc map[string]any
	if json.Unmarshal(in.Document, &doc) != nil || doc == nil {
		problem(w, 400, "Document object required")
		return
	}
	if blocks, ok := doc["blocks"].([]any); !ok || blocks == nil {
		problem(w, 400, "Document blocks required")
		return
	}
	tag, e := s.DB.Exec(r.Context(), `UPDATE pages p SET content=$1 WHERE p.id=$2 AND p.workspace_id=$3 AND NOT p.deleted AND NOT p.trashed AND p.content IS NULL AND NOT p.admission_started AND p.version=0 AND EXISTS(SELECT 1 FROM memberships m WHERE m.workspace_id=p.workspace_id AND m.user_id=$4 AND m.role IN ('admin','member'))`, []byte(in.Document), r.PathValue("id"), ws.ID, u.ID)
	if e != nil {
		problem(w, 500, "Seeding failed")
		return
	}
	if tag.RowsAffected() != 1 {
		problem(w, 409, "Document already initialized or collaboration started")
		return
	}
	jsonOut(w, 200, map[string]bool{"ok": true})
}

// detachParent retire le lien de parenté d'une métadonnée de page sans toucher au
// reste : l'appelant reçoit la page, pas l'existence de son parent.
func detachParent(meta []byte) ([]byte, error) {
	var page map[string]any
	if e := json.Unmarshal(meta, &page); e != nil {
		return nil, e
	}
	page["parentId"] = nil
	return json.Marshal(page)
}

// Une page telle que le client l'envoie, avec la liste dont elle vient.
type incomingPage struct {
	page    map[string]any
	trashed bool
}

// Un emplacement de l'index fusionné. Une page dont le client n'a pas la main
// n'a pas de contenu à réécrire : seul son rang est connu.
type indexSlot struct {
	id      string
	page    map[string]any
	trashed bool
}

func (p incomingPage) id() string { v, _ := p.page["id"].(string); return v }

// currentIndex rend les pages vivantes de l'espace et leur ordre actuel.
func currentIndex(ctx context.Context, tx pgx.Tx, workspace string) (map[string]bool, []string, error) {
	rows, e := tx.Query(ctx, "SELECT id FROM pages WHERE workspace_id=$1 AND NOT deleted ORDER BY (metadata->>'position')::numeric NULLS LAST,id", workspace)
	if e != nil {
		return nil, nil, e
	}
	defer rows.Close()
	known := map[string]bool{}
	order := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			return nil, nil, e
		}
		known[id] = true
		order = append(order, id)
	}
	return known, order, rows.Err()
}

// mergeIndexOrder reconstruit un ordre global à partir d'un ordre partiel.
//
// Le client ne connaît que les pages qu'il peut voir, et les renumérote de zéro.
// Appliquer tel quel ferait diverger les deux vues en silence. Chaque page que
// l'appelant ne maîtrise pas est donc rattachée à la page maîtrisée qui la
// précédait, et replacée derrière elle. Si cette ancre disparaît de
// l'enregistrement, la page suit à la fin plutôt que de se perdre.
func mergeIndexOrder(previous []string, incoming []incomingPage, levels map[string]level, known map[string]bool) []indexSlot {
	anchored := map[string][]string{}
	anchor := ""
	for _, id := range previous {
		if levels[id] >= levelEdit {
			anchor = id
			continue
		}
		anchored[anchor] = append(anchored[anchor], id)
	}
	merged := []indexSlot{}
	placed := map[string]bool{}
	follow := func(key string) {
		for _, id := range anchored[key] {
			merged = append(merged, indexSlot{id: id})
			placed[id] = true
		}
	}
	follow("")
	for _, entry := range incoming {
		id := entry.id()
		// Une page inconnue est une création. Une page connue n'est réécrite que
		// si l'appelant peut l'écrire ; sinon elle garde sa place d'origine, que
		// `follow` lui rend.
		if !known[id] || levels[id] >= levelEdit {
			merged = append(merged, indexSlot{id: id, page: entry.page, trashed: entry.trashed})
		}
		follow(id)
	}
	for _, id := range previous {
		if !placed[id] && levels[id] < levelEdit {
			merged = append(merged, indexSlot{id: id})
			placed[id] = true
		}
	}
	return merged
}

package cloud

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/blokserver/ticket"
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
		rows, e := tx.Query(r.Context(), "SELECT metadata,trashed FROM pages WHERE workspace_id=$1 AND NOT deleted ORDER BY (metadata->>'position')::numeric NULLS LAST,id", ws.ID)
		if e != nil {
			problem(w, 500, "Read failed")
			return
		}
		pages := []json.RawMessage{}
		trash := []json.RawMessage{}
		for rows.Next() {
			var meta []byte
			var tr bool
			if e = rows.Scan(&meta, &tr); e != nil {
				rows.Close()
				problem(w, 500, "Read failed")
				return
			}
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
		jsonOut(w, 200, map[string]any{"pages": pages, "trash": trash, "revision": revision})
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
	all := append(append([]map[string]any{}, in.Pages...), in.Trash...)
	for i, p := range all {
		id, _ := p["id"].(string)
		parent, _ := p["parentId"].(string)
		if !validPageMetadata(p) || ids[id] {
			problem(w, 400, "Invalid page metadata")
			return
		}
		ids[id] = true
		parents[id] = parent
		p["position"] = i
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
	if _, e = tx.Exec(r.Context(), "UPDATE pages SET deleted=true WHERE workspace_id=$1", ws.ID); e != nil {
		problem(w, 500, "Save failed")
		return
	}
	for i, p := range all {
		encoded, _ := json.Marshal(p)
		id := p["id"].(string)
		tag, e := tx.Exec(r.Context(), `INSERT INTO pages(id,workspace_id,metadata,trashed) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET metadata=$3,trashed=$4,deleted=false WHERE pages.workspace_id=$2`, id, ws.ID, encoded, i >= len(in.Pages))
		if e != nil {
			problem(w, 500, "Save failed")
			return
		}
		if tag.RowsAffected() != 1 {
			problem(w, 409, "Page ID already belongs to another workspace")
			return
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
	if r.Method != "GET" {
		problem(w, 405, "Use Blok collaboration to edit document content")
		return
	}
	var content []byte
	e := s.DB.QueryRow(r.Context(), "SELECT content FROM pages WHERE id=$1 AND workspace_id=$2 AND NOT deleted", r.PathValue("id"), ws.ID).Scan(&content)
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
	s.mintTicket(w, r, u, doc, ws.Role != "viewer")
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
	if e = tx.QueryRow(r.Context(), "SELECT metadata FROM pages WHERE id=$1 AND workspace_id=$2 AND NOT deleted AND NOT trashed", source, ws.ID).Scan(&meta); e != nil {
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
	if _, e = tx.Exec(r.Context(), "INSERT INTO pages(id,workspace_id,metadata,content) VALUES($1,$2,$3,$4)", in.ID, ws.ID, meta, encoded); e != nil {
		problem(w, 409, "Duplicate page ID already exists")
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

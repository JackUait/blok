package cloud

import (
	"context"
	"net/http"
)

// L'API de partage : la feuille d'accès d'une page, sa visibilité, et les droits
// nommés qu'on y accorde. Conception :
// docs/plans/2026-11-13-page-permissions-design.md

const ancestryQuery = `WITH RECURSIVE chain AS (
  SELECT p.id, p.visibility, nullif(p.metadata->>'parentId','') AS parent, 0 AS depth
    FROM pages p WHERE p.id=$1 AND NOT p.deleted
  UNION ALL
  SELECT p.id, p.visibility, nullif(p.metadata->>'parentId',''), c.depth+1
    FROM pages p JOIN chain c ON p.id=c.parent
   WHERE c.depth+1 < $2 AND NOT p.deleted)
SELECT id, visibility FROM chain ORDER BY depth`

// ancestry rend la chaîne d'une page vers sa racine et la visibilité qui s'y
// applique. Une chaîne sans visibilité explicite est incomplète : on se referme,
// comme la résolution elle-même.
func ancestry(ctx context.Context, q querier, pageID string) ([]string, string, error) {
	rows, e := q.Query(ctx, ancestryQuery, pageID, maxPageDepth)
	if e != nil {
		return nil, visPrivate, e
	}
	defer rows.Close()
	chain := []string{}
	visibility := ""
	for rows.Next() {
		var id, own string
		if e = rows.Scan(&id, &own); e != nil {
			return nil, visPrivate, e
		}
		chain = append(chain, id)
		if visibility == "" && own != visInherit {
			visibility = own
		}
	}
	if e = rows.Err(); e != nil {
		return nil, visPrivate, e
	}
	if visibility == "" {
		visibility = visPrivate
	}
	return chain, visibility, nil
}

type sharedWith struct {
	UserID string `json:"userId"`
	Email  string `json:"email"`
	Level  string `json:"level"`
	From   string `json:"from,omitempty"`
}

// pageAccess lit ou change la feuille d'accès d'une page.
func (s *Service) pageAccess(w http.ResponseWriter, r *http.Request, u identity, ws Workspace) {
	page := r.PathValue("id")
	granted, e := s.effectiveLevel(r.Context(), s.DB, u.ID, page)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	if granted < levelView {
		problem(w, 404, "Page not found")
		return
	}
	if r.Method == "PUT" {
		s.setPageVisibility(w, r, u, ws, page)
		return
	}
	if r.Method != "GET" {
		problem(w, 405, "Method not allowed")
		return
	}
	chain, visibility, e := ancestry(r.Context(), s.DB, page)
	if e != nil || len(chain) == 0 {
		problem(w, 503, "Database unavailable")
		return
	}
	rows, e := s.DB.Query(r.Context(), `SELECT sh.page_id,u.id,u.email,sh.level
	  FROM page_shares sh JOIN users u ON u.id=sh.user_id
	 WHERE sh.page_id=ANY($1) ORDER BY u.email`, chain)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer rows.Close()
	// Un droit propre se retire ici ; un droit hérité se retire sur la page qui
	// l'accorde. Les mélanger rendrait la feuille incompréhensible.
	own := []sharedWith{}
	inherited := []sharedWith{}
	for rows.Next() {
		var from string
		var entry sharedWith
		if e = rows.Scan(&from, &entry.UserID, &entry.Email, &entry.Level); e != nil {
			problem(w, 500, "Read failed")
			return
		}
		if from == page {
			own = append(own, entry)
			continue
		}
		entry.From = from
		inherited = append(inherited, entry)
	}
	if rows.Err() != nil {
		problem(w, 500, "Read failed")
		return
	}
	var ownVisibility string
	if e = s.DB.QueryRow(r.Context(), "SELECT visibility FROM pages WHERE id=$1", page).Scan(&ownVisibility); e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	jsonOut(w, 200, map[string]any{
		"visibility":          ownVisibility,
		"effectiveVisibility": visibility,
		"myLevel":             granted.String(),
		"shares":              own,
		"inherited":           inherited,
	})
}

// La vérification est refaite ici plutôt qu'héritée de l'appelant : une garantie
// locale se relit, et la loi d'architecture peut la constater.
func (s *Service) setPageVisibility(w http.ResponseWriter, r *http.Request, u identity, ws Workspace, page string) {
	granted, e := s.effectiveLevel(r.Context(), s.DB, u.ID, page)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	if granted < levelFull {
		problem(w, 403, "Full access required")
		return
	}
	var in struct {
		Visibility string `json:"visibility"`
	}
	if !body(w, r, &in) {
		return
	}
	if in.Visibility != visInherit && in.Visibility != visPrivate && in.Visibility != visWorkspace {
		problem(w, 400, "Invalid visibility")
		return
	}
	if _, e = s.DB.Exec(r.Context(), "UPDATE pages SET visibility=$2 WHERE id=$1 AND workspace_id=$3", page, in.Visibility, ws.ID); e != nil {
		problem(w, 500, "Update failed")
		return
	}
	s.recheckWorkspace(r.Context(), ws.ID)
	jsonOut(w, 200, map[string]bool{"ok": true})
}

// pageShare accorde ou retire le droit d'une personne sur une page.
func (s *Service) pageShare(w http.ResponseWriter, r *http.Request, u identity, ws Workspace) {
	if r.Method != "PUT" && r.Method != "DELETE" {
		problem(w, 405, "Method not allowed")
		return
	}
	page := r.PathValue("id")
	target := r.PathValue("target")
	granted, e := s.effectiveLevel(r.Context(), s.DB, u.ID, page)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	if granted < levelView {
		problem(w, 404, "Page not found")
		return
	}
	// Modifier le contenu et gouverner les accès sont deux droits différents.
	if granted < levelFull {
		problem(w, 403, "Full access required")
		return
	}
	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	if r.Method == "DELETE" {
		if e = s.refuseOrphaningThePage(r.Context(), tx, page, target); e != nil {
			problem(w, 409, e.Error())
			return
		}
		if _, e = tx.Exec(r.Context(), "DELETE FROM page_shares WHERE page_id=$1 AND user_id=$2", page, target); e != nil {
			problem(w, 500, "Update failed")
			return
		}
	} else {
		var in struct {
			Level string `json:"level"`
		}
		if !body(w, r, &in) {
			return
		}
		if parseLevel(in.Level) == levelNone {
			problem(w, 400, "Invalid level")
			return
		}
		// Partager avec quelqu'un qui n'est pas de l'espace écrirait une ligne
		// sans effet : son plafond est nul, donc son accès aussi.
		var member bool
		if e = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2)", ws.ID, target).Scan(&member); e != nil {
			problem(w, 503, "Database unavailable")
			return
		}
		if !member {
			problem(w, 404, "Member not found")
			return
		}
		if _, e = tx.Exec(r.Context(), `INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES($1,$2,$3,$4)
		  ON CONFLICT(page_id,user_id) DO UPDATE SET level=$3,granted_by=$4`, page, target, in.Level, u.ID); e != nil {
			problem(w, 500, "Update failed")
			return
		}
	}
	if e = tx.Commit(r.Context()); e != nil {
		problem(w, 500, "Update failed")
		return
	}
	// Une session déjà ouverte sur la page doit se refermer, pas attendre un
	// rechargement : le balayage des documents observés s'en charge.
	s.recheckWorkspace(r.Context(), ws.ID)
	jsonOut(w, 200, map[string]bool{"ok": true})
}

// refuseOrphaningThePage empêche le retrait qui laisserait une page privée sans
// personne pour la gouverner. Une page ouverte à l'espace n'a pas ce besoin : ses
// administrateurs y ont déjà l'accès complet.
func (s *Service) refuseOrphaningThePage(ctx context.Context, q querier, page, target string) error {
	chain, visibility, e := ancestry(ctx, q, page)
	if e != nil {
		return e
	}
	if visibility == visWorkspace {
		return nil
	}
	var remaining int
	if e = q.QueryRow(ctx, `SELECT count(*) FROM page_shares WHERE page_id=ANY($1) AND level='full' AND user_id<>$2`, chain, target).Scan(&remaining); e != nil {
		return e
	}
	if remaining > 0 {
		return nil
	}
	return errLastFullAccess
}

var errLastFullAccess = &accessError{"Keep at least one full access on a private page"}

type accessError struct{ message string }

func (e *accessError) Error() string { return e.message }

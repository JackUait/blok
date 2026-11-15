package cloud

import (
	"errors"
	"net/http"
	"regexp"

	"github.com/jackc/pgx/v5"
)

var publicPageIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// Both aliases resolve only for the signed-in user. No distinction between a
// missing, private, trashed, archived or foreign-workspace page is exposed.
func (s *Service) resolvePageURL(w http.ResponseWriter, r *http.Request) {
	u, ok := s.require(w, r)
	if !ok {
		return
	}
	if r.PathValue("kind") != "resolve" && r.PathValue("kind") != "resolve-id" {
		problem(w, 404, "Page not found")
		return
	}
	value := r.PathValue("id")
	legacy := r.PathValue("kind") == "resolve-id"
	if (!legacy && !publicPageIDPattern.MatchString(value)) || (legacy && !pageIDPattern.MatchString(value)) {
		problem(w, 404, "Page not found")
		return
	}
	ctx := r.Context()
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback(ctx)
	var pageID, publicID, title string
	var ws Workspace
	predicate := "p.public_id=$1::uuid"
	if legacy {
		predicate = "p.id=$1"
	}
	e = tx.QueryRow(ctx, `SELECT p.id,p.public_id::text,coalesce(p.metadata->>'title',''),w.id,w.slug,w.name,m.role,w.icon
 FROM pages p JOIN workspaces w ON w.id=p.workspace_id
 JOIN memberships m ON m.workspace_id=w.id AND m.user_id=$2
 WHERE `+predicate+` AND NOT p.deleted AND NOT p.trashed FOR SHARE OF w`, value, u.ID).Scan(&pageID, &publicID, &title, &ws.ID, &ws.Slug, &ws.Name, &ws.Role, &ws.Icon)
	if errors.Is(e, pgx.ErrNoRows) {
		problem(w, 404, "Page not found")
		return
	}
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	granted, e := s.effectiveLevel(ctx, tx, u.ID, pageID)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	if granted < levelView {
		problem(w, 404, "Page not found")
		return
	}
	tsID, e := s.pageTeamspace(ctx, tx, u.ID, pageID)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	var teamspaceID any
	if tsID != "" {
		teamspaceID = tsID
	}
	jsonOut(w, 200, map[string]any{"pageId": pageID, "publicId": publicID, "title": title, "workspace": ws, "teamspaceId": teamspaceID})
}

package cloud

import (
	"context"
	"net/http"
	"regexp"
	"time"
)

var slugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,62}$`)

func (s *Service) listWorkspaces(w http.ResponseWriter, r *http.Request) {
	u, ok := s.require(w, r)
	if !ok {
		return
	}
	list, e := s.workspaces(r.Context(), u.ID)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	jsonOut(w, 200, map[string]any{"workspaces": list})
}
func (s *Service) createWorkspace(w http.ResponseWriter, r *http.Request) {
	u, ok := s.require(w, r)
	if !ok {
		return
	}
	var in struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if !body(w, r, &in) {
		return
	}
	if !slugPattern.MatchString(in.Slug) || len(in.Name) < 1 || len(in.Name) > 120 {
		problem(w, 400, "Invalid workspace name or slug")
		return
	}
	if !s.rate(r.Context(), "workspace:"+u.ID, 10) {
		problem(w, 429, "Too many workspaces")
		return
	}
	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	out := Workspace{opaque(), in.Slug, in.Name, "admin"}
	if _, e = tx.Exec(r.Context(), "INSERT INTO workspaces(id,slug,name) VALUES($1,$2,$3)", out.ID, out.Slug, out.Name); e != nil {
		problem(w, 409, "Slug already used")
		return
	}
	if _, e = tx.Exec(r.Context(), "INSERT INTO memberships VALUES($1,$2,'admin')", out.ID, u.ID); e != nil {
		problem(w, 500, "Creation failed")
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		problem(w, 500, "Creation failed")
		return
	}
	jsonOut(w, 201, out)
}
func (s *Service) lookupWorkspace(ctx context.Context, slug, user string) (Workspace, error) {
	var out Workspace
	e := s.DB.QueryRow(ctx, `SELECT w.id,w.slug,w.name,coalesce(m.role,'') FROM workspaces w LEFT JOIN memberships m ON m.workspace_id=w.id AND m.user_id=$2 WHERE w.slug=$1 OR w.id=$1`, slug, user).Scan(&out.ID, &out.Slug, &out.Name, &out.Role)
	return out, e
}
func (s *Service) workspace(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		problem(w, 405, "Method not allowed")
		return
	}
	u, _ := s.session(r)
	ws, e := s.lookupWorkspace(r.Context(), r.PathValue("slug"), u.ID)
	if e != nil {
		problem(w, 404, "Workspace not found")
		return
	}
	var status *string
	if u.ID != "" {
		var st string
		if s.DB.QueryRow(r.Context(), "SELECT status FROM join_requests WHERE workspace_id=$1 AND user_id=$2", ws.ID, u.ID).Scan(&st) == nil {
			status = &st
		}
	}
	var role *string
	if ws.Role != "" {
		role = &ws.Role
	}
	jsonOut(w, 200, map[string]any{"id": ws.ID, "slug": ws.Slug, "name": ws.Name, "role": role, "joinStatus": status})
}
func (s *Service) workspaceResource(w http.ResponseWriter, r *http.Request) {
	u, ok := s.require(w, r)
	if !ok {
		return
	}
	ws, e := s.lookupWorkspace(r.Context(), r.PathValue("slug"), u.ID)
	if e != nil {
		problem(w, 404, "Workspace not found")
		return
	}
	resource := r.PathValue("resource")
	id := r.PathValue("id")
	action := r.PathValue("action")
	if resource == "join-requests" && r.Method == "POST" && id == "" {
		if ws.Role != "" {
			jsonOut(w, 200, map[string]any{"ok": true, "status": "approved"})
			return
		}
		var in struct {
			Message string `json:"message"`
		}
		if !body(w, r, &in) {
			return
		}
		if len(in.Message) > 2000 {
			problem(w, 400, "Message too long")
			return
		}
		_, e = s.DB.Exec(r.Context(), `INSERT INTO join_requests(id,workspace_id,user_id,message) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id,user_id) DO UPDATE SET message=$4,status='pending',created_at=now()`, opaque(), ws.ID, u.ID, in.Message)
		if e != nil {
			problem(w, 500, "Request failed")
			return
		}
		jsonOut(w, 200, map[string]any{"ok": true, "status": "pending"})
		return
	}
	if ws.Role == "" {
		problem(w, 403, "Workspace membership required")
		return
	}
	switch resource {
	case "index":
		s.index(w, r, u, ws)
		return
	case "pages":
		s.page(w, r, u, ws)
		return
	case "ticket":
		s.ticket(w, r, u, ws, id)
		return
	case "members":
		if r.Method == "GET" && id == "" {
			s.members(w, r, ws)
			return
		}
	}
	if ws.Role != "admin" {
		problem(w, 403, "Administrator required")
		return
	}
	switch resource {
	case "members":
		s.mutateMember(w, r, u, ws, id)
	case "join-requests":
		s.joinRequests(w, r, ws, id, action)
	case "invites":
		s.invites(w, r, u, ws, id)
	default:
		problem(w, 404, "Not found")
	}
}
func (s *Service) members(w http.ResponseWriter, r *http.Request, ws Workspace) {
	rows, e := s.DB.Query(r.Context(), "SELECT u.id,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY u.email", ws.ID)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, email, role string
		if e = rows.Scan(&id, &email, &role); e != nil {
			problem(w, 500, "Read failed")
			return
		}
		out = append(out, map[string]any{"id": id, "email": email, "role": role})
	}
	if rows.Err() != nil {
		problem(w, 500, "Read failed")
		return
	}
	jsonOut(w, 200, map[string]any{"members": out})
}
func (s *Service) mutateMember(w http.ResponseWriter, r *http.Request, u identity, ws Workspace, id string) {
	if (r.Method != "PATCH" && r.Method != "DELETE") || id == "" {
		problem(w, 405, "Method not allowed")
		return
	}
	var in struct {
		Role string `json:"role"`
	}
	if r.Method == "PATCH" {
		if !body(w, r, &in) {
			return
		}
		if in.Role != "admin" && in.Role != "member" && in.Role != "viewer" {
			problem(w, 400, "Invalid role")
			return
		}
	}
	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	if _, e = tx.Exec(r.Context(), "SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", ws.ID); e != nil {
		problem(w, 500, "Update failed")
		return
	}
	var caller string
	if e = tx.QueryRow(r.Context(), "SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2", ws.ID, u.ID).Scan(&caller); e != nil || caller != "admin" {
		problem(w, 403, "Administrator required")
		return
	}
	var old string
	if e = tx.QueryRow(r.Context(), "SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2", ws.ID, id).Scan(&old); e != nil {
		problem(w, 404, "Member not found")
		return
	}
	if old == "admin" && in.Role != "admin" {
		var count int
		if e = tx.QueryRow(r.Context(), "SELECT count(*) FROM memberships WHERE workspace_id=$1 AND role='admin'", ws.ID).Scan(&count); e != nil {
			problem(w, 500, "Update failed")
			return
		}
		if count <= 1 {
			problem(w, 409, "Keep at least one administrator")
			return
		}
	}
	if r.Method == "DELETE" {
		_, e = tx.Exec(r.Context(), "DELETE FROM memberships WHERE workspace_id=$1 AND user_id=$2", ws.ID, id)
	} else {
		_, e = tx.Exec(r.Context(), "UPDATE memberships SET role=$3 WHERE workspace_id=$1 AND user_id=$2", ws.ID, id, in.Role)
	}
	if e != nil {
		problem(w, 500, "Update failed")
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		problem(w, 500, "Update failed")
		return
	}
	s.recheckWorkspace(r.Context(), ws.ID)
	jsonOut(w, 200, map[string]bool{"ok": true})
}
func (s *Service) joinRequests(w http.ResponseWriter, r *http.Request, ws Workspace, id, action string) {
	if r.Method == "GET" && id == "" {
		rows, e := s.DB.Query(r.Context(), "SELECT j.id,j.user_id,u.email,j.message,j.status,j.created_at FROM join_requests j JOIN users u ON u.id=j.user_id WHERE j.workspace_id=$1 ORDER BY j.created_at DESC", ws.ID)
		if e != nil {
			problem(w, 503, "Database unavailable")
			return
		}
		defer rows.Close()
		out := []map[string]any{}
		for rows.Next() {
			var id, uid, email, msg, status string
			var created time.Time
			if e = rows.Scan(&id, &uid, &email, &msg, &status, &created); e != nil {
				problem(w, 500, "Read failed")
				return
			}
			out = append(out, map[string]any{"id": id, "userId": uid, "email": email, "message": msg, "status": status, "createdAt": created})
		}
		if rows.Err() != nil {
			problem(w, 500, "Read failed")
			return
		}
		jsonOut(w, 200, map[string]any{"requests": out})
		return
	}
	if r.Method != "POST" || id == "" || (action != "approve" && action != "reject") {
		problem(w, 405, "Method not allowed")
		return
	}
	var in struct {
		Role string `json:"role"`
	}
	if !body(w, r, &in) {
		return
	}
	if in.Role == "" {
		in.Role = "member"
	}
	if in.Role != "member" && in.Role != "viewer" {
		problem(w, 400, "Invalid role")
		return
	}
	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	var uid string
	e = tx.QueryRow(r.Context(), "SELECT user_id FROM join_requests WHERE id=$1 AND workspace_id=$2 AND status='pending' FOR UPDATE", id, ws.ID).Scan(&uid)
	if e != nil {
		problem(w, 404, "Pending request not found")
		return
	}
	status := "rejected"
	if action == "approve" {
		status = "approved"
		if _, e = tx.Exec(r.Context(), "INSERT INTO memberships VALUES($1,$2,$3) ON CONFLICT(workspace_id,user_id) DO NOTHING", ws.ID, uid, in.Role); e != nil {
			problem(w, 500, "Approval failed")
			return
		}
	}
	if _, e = tx.Exec(r.Context(), "UPDATE join_requests SET status=$2 WHERE id=$1", id, status); e != nil {
		problem(w, 500, "Update failed")
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		problem(w, 500, "Update failed")
		return
	}
	jsonOut(w, 200, map[string]bool{"ok": true})
}
func (s *Service) invites(w http.ResponseWriter, r *http.Request, u identity, ws Workspace, id string) {
	if r.Method == "GET" && id == "" {
		rows, e := s.DB.Query(r.Context(), "SELECT id,email,role,status,expires_at FROM invites WHERE workspace_id=$1 ORDER BY created_at DESC", ws.ID)
		if e != nil {
			problem(w, 503, "Database unavailable")
			return
		}
		defer rows.Close()
		out := []map[string]any{}
		for rows.Next() {
			var id, email, role, status string
			var expiry time.Time
			if rows.Scan(&id, &email, &role, &status, &expiry) != nil {
				problem(w, 500, "Read failed")
				return
			}
			out = append(out, map[string]any{"id": id, "email": email, "role": role, "status": status, "expiresAt": expiry})
		}
		if rows.Err() != nil {
			problem(w, 500, "Read failed")
			return
		}
		jsonOut(w, 200, map[string]any{"invites": out})
		return
	}
	if r.Method == "DELETE" && id != "" {
		tag, e := s.DB.Exec(r.Context(), "UPDATE invites SET status='revoked' WHERE id=$1 AND workspace_id=$2 AND status='pending'", id, ws.ID)
		if e != nil {
			problem(w, 500, "Revocation failed")
			return
		}
		if tag.RowsAffected() == 0 {
			problem(w, 404, "Pending invitation not found")
			return
		}
		jsonOut(w, 200, map[string]bool{"ok": true})
		return
	}
	if r.Method != "POST" || id != "" {
		problem(w, 405, "Method not allowed")
		return
	}
	var in struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if !body(w, r, &in) {
		return
	}
	email, e := normalizeEmail(in.Email)
	if e != nil {
		problem(w, 400, "Invalid email")
		return
	}
	if in.Role == "" {
		in.Role = "member"
	}
	if in.Role != "member" && in.Role != "viewer" {
		problem(w, 400, "Invalid role")
		return
	}
	if !s.rate(r.Context(), "invite:"+u.ID, 30) {
		problem(w, 429, "Too many invitations")
		return
	}
	inviteID := opaque()
	_, e = s.DB.Exec(r.Context(), "INSERT INTO invites(id,workspace_id,email,role,expires_at) VALUES($1,$2,$3,$4,now()+interval '7 days')", inviteID, ws.ID, email, in.Role)
	if e != nil {
		problem(w, 500, "Invitation failed")
		return
	}
	if e = s.send(email, "Invitation Blok — "+ws.Name, "Vous êtes invité à rejoindre "+ws.Name+".\nConnectez-vous avec cette adresse email sur "+s.Config.PublicURL+" pour accepter cette invitation.\nCette invitation expire dans 7 jours."); e != nil {
		s.DB.Exec(r.Context(), "UPDATE invites SET status='delivery-failed' WHERE id=$1", inviteID)
		problem(w, 503, "Invitation email delivery failed")
		return
	}
	jsonOut(w, 201, map[string]bool{"ok": true})
}

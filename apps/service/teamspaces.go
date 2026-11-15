package cloud

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// A teamspace is an authorization boundary nested in a workspace. The MVP only
// supports closed: discoverable metadata, membership-gated page content.
type Teamspace struct {
	ID          string  `json:"id"`
	WorkspaceID string  `json:"workspaceId"`
	Name        string  `json:"name"`
	Icon        *string `json:"icon"`
	Description string  `json:"description"`
	Mode        string  `json:"mode"`
	Archived    bool    `json:"archived"`
	MyRole      *string `json:"myRole"`
	CanManage   bool    `json:"canManage"`
}

const teamspaceSelect = `SELECT t.id,t.workspace_id,t.name,t.icon,t.description,t.mode,t.archived,tm.role,
 (wm.role='admin' OR (coalesce(tm.role='owner',false) AND wm.role='member'))
 FROM teamspaces t JOIN memberships wm ON wm.workspace_id=t.workspace_id AND wm.user_id=$2
 LEFT JOIN teamspace_memberships tm ON tm.teamspace_id=t.id AND tm.user_id=$2`

func readTeamspace(row pgx.Row) (Teamspace, error) {
	var t Teamspace
	e := row.Scan(&t.ID, &t.WorkspaceID, &t.Name, &t.Icon, &t.Description, &t.Mode, &t.Archived, &t.MyRole, &t.CanManage)
	return t, e
}
func (s *Service) teamspace(ctx context.Context, q querier, user, workspace, id string) (Teamspace, error) {
	return readTeamspace(q.QueryRow(ctx, teamspaceSelect+` WHERE t.workspace_id=$1 AND t.id=$3`, workspace, user, id))
}
func (s *Service) listTeamspaces(ctx context.Context, q querier, user, workspace string, archived bool) ([]Teamspace, error) {
	rows, e := q.Query(ctx, teamspaceSelect+` WHERE t.workspace_id=$1 AND ($3 OR NOT t.archived) ORDER BY t.name,t.id`, workspace, user, archived)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	list := []Teamspace{}
	for rows.Next() {
		t, e := readTeamspace(rows)
		if e != nil {
			return nil, e
		}
		list = append(list, t)
	}
	return list, rows.Err()
}
func (s *Service) teamspaceWritable(ctx context.Context, q querier, user, workspace, id string) bool {
	var ok bool
	e := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM teamspaces t JOIN teamspace_memberships tm ON tm.teamspace_id=t.id JOIN memberships m ON m.workspace_id=t.workspace_id AND m.user_id=tm.user_id WHERE t.id=$1 AND t.workspace_id=$2 AND tm.user_id=$3 AND NOT t.archived AND m.role IN ('admin','member'))`, id, workspace, user).Scan(&ok)
	return e == nil && ok
}
func (s *Service) pageTeamspace(ctx context.Context, q querier, user, page string) (string, error) {
	chain, e := s.chainOf(ctx, q, user, page)
	if e != nil {
		return "", e
	}
	for _, node := range chain {
		if node.TeamspaceID != "" {
			return node.TeamspaceID, nil
		}
	}
	return "", nil
}

func (s *Service) teamspacesRoute(w http.ResponseWriter, r *http.Request, u identity, ws Workspace, id string) {
	ctx := r.Context()
	action := r.PathValue("action")
	if r.Method == "GET" && id == "" {
		list, e := s.listTeamspaces(ctx, s.DB, u.ID, ws.ID, r.URL.Query().Get("archived") == "true")
		if e != nil {
			problem(w, 503, "Database unavailable")
			return
		}
		jsonOut(w, 200, map[string]any{"teamspaces": list})
		return
	}
	if r.Method == "POST" && id != "" && action == "pages" {
		s.createTeamspacePage(w, r, u, ws, id)
		return
	}
	if r.Method == "GET" && id != "" {
		t, e := s.teamspace(ctx, s.DB, u.ID, ws.ID, id)
		if e != nil {
			problem(w, 404, "Teamspace not found")
			return
		}
		if action == "" {
			jsonOut(w, 200, t)
			return
		}
		if action == "members" {
			if t.MyRole == nil && !t.CanManage {
				problem(w, 403, "Teamspace membership required")
				return
			}
			rows, e := s.DB.Query(ctx, `SELECT tm.user_id,u.email,tm.role FROM teamspace_memberships tm JOIN users u ON u.id=tm.user_id WHERE tm.teamspace_id=$1 ORDER BY u.email`, id)
			if e != nil {
				problem(w, 503, "Database unavailable")
				return
			}
			defer rows.Close()
			list := []map[string]string{}
			for rows.Next() {
				var uid, email, role string
				if e = rows.Scan(&uid, &email, &role); e != nil {
					problem(w, 503, "Read failed")
					return
				}
				list = append(list, map[string]string{"userId": uid, "email": email, "role": role})
			}
			if rows.Err() != nil {
				problem(w, 503, "Read failed")
				return
			}
			jsonOut(w, 200, map[string]any{"members": list})
			return
		}
		problem(w, 404, "Not found")
		return
	}
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `SELECT id FROM workspaces WHERE id=$1 FOR UPDATE`, ws.ID); e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	var role string
	if e = tx.QueryRow(ctx, `SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2`, ws.ID, u.ID).Scan(&role); e != nil {
		problem(w, 403, "Workspace membership required")
		return
	}
	if id == "" && r.Method == "POST" {
		if role != "admin" {
			problem(w, 403, "Workspace administrator required")
			return
		}
		var in struct {
			Name        string  `json:"name"`
			Icon        *string `json:"icon"`
			Description string  `json:"description"`
			Mode        string  `json:"mode"`
		}
		if !body(w, r, &in) {
			return
		}
		in.Name = strings.TrimSpace(in.Name)
		if in.Name == "" || utf8.RuneCountInString(in.Name) > 120 || utf8.RuneCountInString(in.Description) > 2000 || (in.Icon != nil && !validWorkspaceEmoji(*in.Icon)) || (in.Mode != "" && in.Mode != "closed") {
			problem(w, 400, "Invalid teamspace identity or mode")
			return
		}
		id = opaque()
		if _, e = tx.Exec(ctx, `INSERT INTO teamspaces(id,workspace_id,name,icon,description) VALUES($1,$2,$3,$4,$5)`, id, ws.ID, in.Name, in.Icon, in.Description); e != nil {
			problem(w, 500, "Creation failed")
			return
		}
		if _, e = tx.Exec(ctx, `INSERT INTO teamspace_memberships VALUES($1,$2,$3,'owner')`, id, ws.ID, u.ID); e != nil {
			problem(w, 500, "Creation failed")
			return
		}
	} else {
		t, e := s.teamspace(ctx, tx, u.ID, ws.ID, id)
		if e != nil {
			problem(w, 404, "Teamspace not found")
			return
		}
		if !t.CanManage {
			problem(w, 403, "Teamspace owner or workspace administrator required")
			return
		}
		switch {
		case r.Method == "PATCH" && action == "":
			var in struct {
				Name        json.RawMessage `json:"name"`
				Icon        json.RawMessage `json:"icon"`
				Description json.RawMessage `json:"description"`
				Mode        json.RawMessage `json:"mode"`
			}
			if !body(w, r, &in) {
				return
			}
			if len(in.Mode) > 0 || len(in.Name)+len(in.Icon)+len(in.Description) == 0 {
				problem(w, 400, "Invalid teamspace patch")
				return
			}
			name, description, icon := t.Name, t.Description, t.Icon
			if len(in.Name) > 0 {
				if string(in.Name) == "null" || json.Unmarshal(in.Name, &name) != nil {
					problem(w, 400, "Invalid name")
					return
				}
				name = strings.TrimSpace(name)
			}
			if len(in.Description) > 0 {
				if string(in.Description) == "null" || json.Unmarshal(in.Description, &description) != nil {
					problem(w, 400, "Invalid description")
					return
				}
			}
			if len(in.Icon) > 0 {
				if json.Unmarshal(in.Icon, &icon) != nil {
					problem(w, 400, "Invalid icon")
					return
				}
			}
			if name == "" || utf8.RuneCountInString(name) > 120 || utf8.RuneCountInString(description) > 2000 || (icon != nil && !validWorkspaceEmoji(*icon)) {
				problem(w, 400, "Invalid teamspace identity")
				return
			}
			_, e = tx.Exec(ctx, `UPDATE teamspaces SET name=$2,icon=$3,description=$4 WHERE id=$1`, id, name, icon, description)
		case r.Method == "POST" && (action == "archive" || action == "restore"):
			_, e = tx.Exec(ctx, `UPDATE teamspaces SET archived=$2 WHERE id=$1`, id, action == "archive")
		case (r.Method == "PUT" || r.Method == "DELETE") && action == "members" && r.PathValue("target") != "":
			if t.Archived {
				problem(w, 409, "Restore teamspace before changing memberships")
				return
			}
			target := r.PathValue("target")
			next := ""
			if r.Method == "PUT" {
				var in struct {
					Role string `json:"role"`
				}
				if !body(w, r, &in) {
					return
				}
				next = in.Role
				if next != "owner" && next != "member" {
					problem(w, 400, "Invalid teamspace role")
					return
				}
			}
			var targetRole string
			if e = tx.QueryRow(ctx, `SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2`, ws.ID, target).Scan(&targetRole); e != nil {
				problem(w, 404, "Workspace member not found")
				return
			}
			if next == "owner" && targetRole == "viewer" {
				problem(w, 400, "Viewer cannot own a teamspace")
				return
			}
			if next != "owner" && s.lastTeamspaceOwner(ctx, tx, id, target) {
				problem(w, 409, "Keep at least one teamspace owner")
				return
			}
			if r.Method == "PUT" {
				_, e = tx.Exec(ctx, `INSERT INTO teamspace_memberships VALUES($1,$2,$3,$4) ON CONFLICT(teamspace_id,user_id) DO UPDATE SET role=$4`, id, ws.ID, target, next)
			} else {
				_, e = tx.Exec(ctx, `DELETE FROM teamspace_memberships WHERE teamspace_id=$1 AND user_id=$2`, id, target)
			}
		default:
			problem(w, 405, "Method not allowed")
			return
		}
		if e != nil {
			problem(w, 500, "Teamspace update failed")
			return
		}
	}
	// An index saved before a membership/archive change must conflict rather
	// than tombstone pages newly visible to that caller.
	if _, e = tx.Exec(ctx, `UPDATE workspaces SET revision=revision+1 WHERE id=$1`, ws.ID); e != nil {
		problem(w, 500, "Update failed")
		return
	}
	t, e := s.teamspace(ctx, tx, u.ID, ws.ID, id)
	if e != nil {
		problem(w, 500, "Read failed")
		return
	}
	if e = tx.Commit(ctx); e != nil {
		problem(w, 500, "Teamspace update failed")
		return
	}
	s.recheckWorkspace(ctx, ws.ID)
	if action == "members" {
		jsonOut(w, 200, map[string]bool{"ok": true})
		return
	}
	status := 200
	if r.Method == "POST" && action == "" {
		status = 201
	}
	jsonOut(w, status, t)
}
func (s *Service) lastTeamspaceOwner(ctx context.Context, q querier, id, user string) bool {
	var last bool
	e := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM teamspace_memberships WHERE teamspace_id=$1 AND user_id=$2 AND role='owner') AND NOT EXISTS(SELECT 1 FROM teamspace_memberships tm JOIN memberships m ON m.workspace_id=tm.workspace_id AND m.user_id=tm.user_id WHERE tm.teamspace_id=$1 AND tm.user_id<>$2 AND tm.role='owner' AND m.role IN ('admin','member'))`, id, user).Scan(&last)
	return e != nil || last
}

// Reuse one creation transaction for HTTP and MCP. Root teamspace assignment is
// a column, never a caller-controlled field in arbitrary page metadata.
type createdScopedPage struct {
	ID          string  `json:"id"`
	PublicID    string  `json:"publicId"`
	Title       string  `json:"title"`
	Workspace   string  `json:"workspace"`
	TeamspaceID *string `json:"teamspaceId"`
	Revision    int64   `json:"revision"`
}

func (s *Service) createScopedPage(ctx context.Context, u identity, ws Workspace, title, parent, tsID, visibility string) (createdScopedPage, error) {
	out := createdScopedPage{Title: title, Workspace: ws.Slug}
	if title == "" || len(title) > 4096 || (parent != "" && !pageIDPattern.MatchString(parent)) {
		return out, errors.New("invalid title or parent")
	}
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return out, e
	}
	defer tx.Rollback(ctx)
	if e = tx.QueryRow(ctx, `SELECT revision FROM workspaces WHERE id=$1 FOR UPDATE`, ws.ID).Scan(&out.Revision); e != nil {
		return out, e
	}
	var role string
	if e = tx.QueryRow(ctx, `SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2`, ws.ID, u.ID).Scan(&role); e != nil || capOf(role) < levelEdit {
		return out, errors.New("write access required")
	}
	var rootTS *string
	if parent != "" {
		var exists bool
		if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pages WHERE id=$1 AND workspace_id=$2 AND NOT deleted AND NOT trashed)`, parent, ws.ID).Scan(&exists); e != nil || !exists {
			return out, errors.New("parent unavailable")
		}
		chain, e := s.chainOf(ctx, tx, u.ID, parent)
		if e != nil {
			return out, e
		}
		if len(chain) >= maxPageDepth {
			return out, errors.New("maximum page depth reached")
		}
		granted, e := s.effectiveLevel(ctx, tx, u.ID, parent)
		if e != nil || granted < levelEdit {
			return out, errors.New("parent unavailable")
		}
		inherited, e := s.pageTeamspace(ctx, tx, u.ID, parent)
		if e != nil {
			return out, e
		}
		if tsID != "" && tsID != inherited {
			return out, errors.New("parent belongs to another teamspace")
		}
		tsID = inherited
		if visibility == "" {
			visibility = visInherit
		}
		if visibility != visInherit {
			return out, errors.New("children must inherit")
		}
	} else {
		if tsID != "" {
			if !s.teamspaceWritable(ctx, tx, u.ID, ws.ID, tsID) {
				return out, errors.New("teamspace write access required")
			}
			rootTS = &tsID
		}
		if visibility == "" {
			visibility = visPrivate
			if tsID != "" {
				visibility = visWorkspace
			}
		}
		if visibility != visPrivate && visibility != visWorkspace {
			return out, errors.New("invalid root visibility")
		}
	}
	if tsID != "" {
		out.TeamspaceID = &tsID
	}
	var position int
	if e = tx.QueryRow(ctx, `SELECT count(*) FROM pages WHERE workspace_id=$1 AND NOT deleted`, ws.ID).Scan(&position); e != nil {
		return out, e
	}
	out.ID = opaque()
	var parentValue any
	if parent != "" {
		parentValue = parent
	}
	meta, _ := json.Marshal(map[string]any{"id": out.ID, "title": title, "parentId": parentValue, "position": position})
	if e = tx.QueryRow(ctx, `INSERT INTO pages(id,workspace_id,metadata,content,visibility,teamspace_id) VALUES($1,$2,$3,'{"blocks":[]}',$4,$5) RETURNING public_id::text`, out.ID, ws.ID, meta, visibility, rootTS).Scan(&out.PublicID); e != nil {
		return out, e
	}
	if _, e = tx.Exec(ctx, `INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES($1,$2,'full',$2)`, out.ID, u.ID); e != nil {
		return out, e
	}
	if _, e = tx.Exec(ctx, `UPDATE workspaces SET revision=revision+1 WHERE id=$1`, ws.ID); e != nil {
		return out, e
	}
	if e = tx.Commit(ctx); e != nil {
		return out, e
	}
	out.Revision++
	return out, nil
}
func (s *Service) createTeamspacePage(w http.ResponseWriter, r *http.Request, u identity, ws Workspace, id string) {
	t, e := s.teamspace(r.Context(), s.DB, u.ID, ws.ID, id)
	if e != nil {
		problem(w, 404, "Teamspace not found")
		return
	}
	if t.Archived {
		problem(w, 409, "Teamspace archived")
		return
	}
	var in struct {
		Title    string `json:"title"`
		ParentID string `json:"parentId"`
	}
	if !body(w, r, &in) {
		return
	}
	if in.Title == "" || len(in.Title) > 4096 || (in.ParentID != "" && !pageIDPattern.MatchString(in.ParentID)) {
		problem(w, 400, "Invalid page title or parent")
		return
	}
	out, e := s.createScopedPage(r.Context(), u, ws, in.Title, in.ParentID, id, "")
	if e != nil {
		problem(w, 403, e.Error())
		return
	}
	jsonOut(w, 201, out)
}

func (s *Service) bindPageTeamspace(w http.ResponseWriter, r *http.Request, u identity, ws Workspace, page string) {
	if r.Method != "PUT" {
		problem(w, 405, "Method not allowed")
		return
	}
	var in struct {
		TeamspaceID json.RawMessage `json:"teamspaceId"`
	}
	if !body(w, r, &in) {
		return
	}
	var target *string
	if len(in.TeamspaceID) == 0 || json.Unmarshal(in.TeamspaceID, &target) != nil || (target != nil && *target == "") {
		problem(w, 400, "teamspaceId string or null required")
		return
	}
	ctx := r.Context()
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `SELECT id FROM workspaces WHERE id=$1 FOR UPDATE`, ws.ID); e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	granted, e := s.effectiveLevel(ctx, tx, u.ID, page)
	if e != nil || granted < levelFull {
		problem(w, 403, "Full access required")
		return
	}
	var parent string
	var source *string
	if e = tx.QueryRow(ctx, `SELECT coalesce(metadata->>'parentId',''),teamspace_id FROM pages WHERE id=$1 AND workspace_id=$2 AND NOT deleted AND NOT trashed`, page, ws.ID).Scan(&parent, &source); e != nil {
		problem(w, 404, "Page not found")
		return
	}
	if parent != "" {
		problem(w, 409, "Only root pages can change teamspace")
		return
	}
	if source != nil {
		t, e := s.teamspace(ctx, tx, u.ID, ws.ID, *source)
		if e != nil || !t.CanManage || t.Archived {
			problem(w, 403, "Source teamspace management required")
			return
		}
	}
	if target != nil && !s.teamspaceWritable(ctx, tx, u.ID, ws.ID, *target) {
		problem(w, 403, "Target teamspace write access required")
		return
	}
	// The entire subtree changes audience. A partial share on its root cannot
	// authorize moving descendants over which the caller has no full access.
	rows, e := tx.Query(ctx, `WITH RECURSIVE tree AS (
 SELECT id,0 AS depth FROM pages WHERE id=$1 AND workspace_id=$2 AND NOT deleted
 UNION ALL SELECT p.id,t.depth+1 FROM pages p JOIN tree t ON p.metadata->>'parentId'=t.id WHERE p.workspace_id=$2 AND NOT p.deleted AND t.depth<64)
 SELECT id FROM tree`, page, ws.ID)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			problem(w, 503, "Read failed")
			return
		}
		ids = append(ids, id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		problem(w, 503, "Read failed")
		return
	}
	for _, id := range ids {
		granted, e = s.effectiveLevel(ctx, tx, u.ID, id)
		if e != nil || granted < levelFull {
			problem(w, 403, "Full access to every descendant required")
			return
		}
	}
	if _, e = tx.Exec(ctx, `UPDATE pages SET teamspace_id=$2 WHERE id=$1`, page, target); e != nil {
		problem(w, 500, "Assignment failed")
		return
	}
	// Root audience changes are revisioned so stale full-index saves cannot undo them.
	if _, e = tx.Exec(ctx, `UPDATE workspaces SET revision=revision+1 WHERE id=$1`, ws.ID); e != nil {
		problem(w, 500, "Assignment failed")
		return
	}
	if e = tx.Commit(ctx); e != nil {
		problem(w, 500, "Assignment failed")
		return
	}
	s.recheckWorkspace(ctx, ws.ID)
	jsonOut(w, 200, map[string]bool{"ok": true})
}

// Apply the same teamspace boundary to all proposed parent changes before any
// index write. Detached shared children keep their actual hidden parent.
func (s *Service) validateTeamspaceIndex(ctx context.Context, q querier, user, workspace string, all []incomingPage, known map[string]bool, parents map[string]string, levels map[string]level) error {
	_, _, nodes, e := s.workspaceChains(ctx, q, user, workspace)
	if e != nil {
		return e
	}
	next := map[string]string{}
	for id, parent := range parents {
		next[id] = parent
	}
	for _, entry := range all {
		id := entry.id()
		parent, _ := entry.page["parentId"].(string)
		if parent == "" && parents[id] != "" && levels[parents[id]] < levelView {
			parent = parents[id]
		}
		next[id] = parent
		if parent != "" && known[parent] && levels[parent] < levelEdit && (!known[id] || parent != parents[id]) {
			return errors.New("parent write access required")
		}
		if nodes[id].TeamspaceID != "" && parent != "" {
			return errors.New("teamspace root cannot be reparented")
		}
	}
	find := func(id string, tree map[string]string) (string, error) {
		visited := map[string]bool{}
		for depth := 0; id != ""; depth++ {
			if depth >= maxPageDepth || visited[id] {
				return "", errors.New("invalid page hierarchy")
			}
			visited[id] = true
			if node := nodes[id]; node.TeamspaceID != "" {
				return node.TeamspaceID, nil
			}
			id = tree[id]
		}
		return "", nil
	}
	for id := range next {
		old, e := find(id, parents)
		if e != nil {
			return e
		}
		to, e := find(id, next)
		if e != nil {
			return e
		}
		if known[id] && old != "" && next[id] != parents[id] && levels[id] < levelFull {
			return errors.New("full access required to reparent a teamspace page")
		}
		if known[id] && old != to {
			return errors.New("change teamspace with explicit page assignment")
		}
	}
	return nil
}

var errLastTeamspaceOwner = errors.New("Keep at least one teamspace owner before removing or downgrading this workspace member")

func (s *Service) protectTeamspaceOwnerMembership(ctx context.Context, q querier, user, workspace string) error {
	var blocked bool
	e := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM teamspace_memberships own WHERE own.user_id=$1 AND ($2='' OR own.workspace_id=$2) AND own.role='owner' AND NOT EXISTS(SELECT 1 FROM teamspace_memberships other JOIN memberships m ON m.workspace_id=other.workspace_id AND m.user_id=other.user_id WHERE other.teamspace_id=own.teamspace_id AND other.user_id<>$1 AND other.role='owner' AND m.role IN ('admin','member')))`, user, workspace).Scan(&blocked)
	if e != nil {
		return e
	}
	if blocked {
		return errLastTeamspaceOwner
	}
	return nil
}

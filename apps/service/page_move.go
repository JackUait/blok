package cloud

import (
	"encoding/json"
	"net/http"
)

// Reparent one existing page atomically; descendants keep their IDs and links.
func (s *Service) movePage(w http.ResponseWriter, r *http.Request, u identity, ws Workspace) {
	var in struct {
		ParentID    json.RawMessage `json:"parentId"`
		TeamspaceID json.RawMessage `json:"teamspaceId"`
	}
	if !body(w, r, &in) {
		return
	}
	var parent, requestedTeamspace *string
	if len(in.ParentID) == 0 || json.Unmarshal(in.ParentID, &parent) != nil || (parent != nil && !pageIDPattern.MatchString(*parent)) {
		problem(w, 400, "parentId string or null required")
		return
	}
	if len(in.TeamspaceID) > 0 && (parent != nil || json.Unmarshal(in.TeamspaceID, &requestedTeamspace) != nil || (requestedTeamspace != nil && *requestedTeamspace == "")) {
		problem(w, 400, "teamspaceId is only supported with a null parentId")
		return
	}
	ctx := r.Context()
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback(ctx)
	var revision int64
	if err = tx.QueryRow(ctx, `SELECT revision FROM workspaces WHERE id=$1 FOR UPDATE`, ws.ID).Scan(&revision); err != nil {
		problem(w, 500, "Move failed")
		return
	}
	levels, parents, nodes, err := s.workspaceChains(ctx, tx, u.ID, ws.ID)
	if err != nil {
		problem(w, 500, "Move failed")
		return
	}
	id := r.PathValue("id")
	var live bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pages WHERE id=$1 AND workspace_id=$2 AND NOT deleted AND NOT trashed)`, id, ws.ID).Scan(&live); err != nil {
		problem(w, 500, "Move failed")
		return
	}
	if !live || levels[id] < levelView {
		problem(w, 404, "Page not found")
		return
	}
	if levels[id] < levelFull {
		problem(w, 403, "Full access required to move a page")
		return
	}
	children := map[string][]string{}
	for child, p := range parents {
		children[p] = append(children[p], child)
	}
	subtree := []string{id}
	seen := map[string]bool{id: true}
	for i := 0; i < len(subtree); i++ {
		page := subtree[i]
		if levels[page] < levelFull {
			problem(w, 403, "Full access to every descendant required")
			return
		}
		for _, child := range children[page] {
			if seen[child] {
				problem(w, 409, "Invalid page hierarchy")
				return
			}
			seen[child] = true
			subtree = append(subtree, child)
		}
	}
	newParent := ""
	if parent != nil {
		newParent = *parent
		if seen[newParent] {
			problem(w, 409, "Cannot move a page into itself or its descendants")
			return
		}
		if levels[newParent] < levelView {
			problem(w, 404, "Destination not found")
			return
		}
		if levels[newParent] < levelEdit {
			problem(w, 403, "Destination write access required")
			return
		}
		// A direct share can grant access below a hidden ancestor, but a trashed
		// ancestor is never a valid destination for a live page.
		chain := []string{}
		for p := newParent; p != ""; p = parents[p] {
			if len(chain) >= maxPageDepth {
				problem(w, 409, "Invalid destination hierarchy")
				return
			}
			chain = append(chain, p)
		}
		var unavailable bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pages WHERE id=ANY($1) AND (trashed OR deleted))`, chain).Scan(&unavailable); err != nil {
			problem(w, 500, "Move failed")
			return
		}
		if unavailable {
			problem(w, 404, "Destination not found")
			return
		}
	}
	sourceTS, err := s.pageTeamspace(ctx, tx, u.ID, id)
	if err != nil {
		problem(w, 500, "Move failed")
		return
	}
	targetTS := sourceTS
	if parent != nil {
		targetTS, err = s.pageTeamspace(ctx, tx, u.ID, newParent)
		if err != nil {
			problem(w, 500, "Move failed")
			return
		}
	} else if len(in.TeamspaceID) > 0 {
		targetTS = ""
		if requestedTeamspace != nil {
			targetTS = *requestedTeamspace
		}
	}
	if sourceTS != targetTS {
		if sourceTS != "" {
			t, err := s.teamspace(ctx, tx, u.ID, ws.ID, sourceTS)
			if err != nil || !t.CanManage || t.Archived {
				problem(w, 403, "Source teamspace management required")
				return
			}
		}
		if targetTS != "" && !s.teamspaceWritable(ctx, tx, u.ID, ws.ID, targetTS) {
			problem(w, 403, "Destination teamspace write access required")
			return
		}
	}
	var resultTS *string
	if targetTS != "" {
		resultTS = &targetTS
	}
	if parents[id] == newParent && sourceTS == targetTS {
		jsonOut(w, 200, map[string]any{"id": id, "parentId": parent, "teamspaceId": resultTS, "revision": revision})
		return
	}
	// Validate the deepest descendant too, so moving a whole branch cannot
	// exceed the permission resolver's depth bound and silently lose access.
	parents[id] = newParent
	for _, page := range subtree {
		visited := map[string]bool{}
		for p := page; p != ""; p = parents[p] {
			if visited[p] || len(visited) >= maxPageDepth {
				problem(w, 409, "Maximum page depth exceeded")
				return
			}
			visited[p] = true
		}
	}
	visibility := nodes[id].Visibility
	if parent == nil && visibility == visInherit {
		// A detached inherited page needs an explicit root visibility. Keep the
		// former effective visibility instead of publishing private content.
		visibility = visPrivate
		for p := nodes[id].ParentID; p != ""; p = nodes[p].ParentID {
			if nodes[p].Visibility != visInherit {
				visibility = nodes[p].Visibility
				break
			}
		}
	}
	var rootTS *string
	if parent == nil {
		rootTS = resultTS
	}
	if _, err = tx.Exec(ctx, `UPDATE pages SET metadata=metadata || jsonb_build_object('parentId',$3::text,'position',(SELECT coalesce(max((metadata->>'position')::numeric),-1)+1 FROM pages WHERE workspace_id=$2 AND NOT deleted)),teamspace_id=$4,visibility=$5 WHERE id=$1 AND workspace_id=$2`, id, ws.ID, parent, rootTS, visibility); err != nil {
		problem(w, 500, "Move failed")
		return
	}
	// The mover already has full access; retain it when the old parent grant
	// disappears, so they can still access and undo their move.
	if _, err = tx.Exec(ctx, `INSERT INTO page_shares(page_id,user_id,level,granted_by) VALUES($1,$2,'full',$2) ON CONFLICT(page_id,user_id) DO UPDATE SET level='full'`, id, u.ID); err != nil {
		problem(w, 500, "Move failed")
		return
	}
	if err = tx.QueryRow(ctx, `UPDATE workspaces SET revision=revision+1 WHERE id=$1 RETURNING revision`, ws.ID).Scan(&revision); err != nil {
		problem(w, 500, "Move failed")
		return
	}
	if err = tx.Commit(ctx); err != nil {
		problem(w, 500, "Move failed")
		return
	}
	s.recheckWorkspace(ctx, ws.ID)
	jsonOut(w, 200, map[string]any{"id": id, "parentId": parent, "teamspaceId": resultTS, "revision": revision})
}

package cloud

import "net/http"

// Trash a subtree without replacing the caller's (possibly stale or partial)
// workspace index. Keep content, shares and parent links available for restore.
func (s *Service) trashPage(w http.ResponseWriter, r *http.Request, u identity, ws Workspace) {
	ctx := r.Context()
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback(ctx)

	// Index writes, page creation and permission changes take the same lock.
	var revision int64
	if err = tx.QueryRow(ctx, `SELECT revision FROM workspaces WHERE id=$1 FOR UPDATE`, ws.ID).Scan(&revision); err != nil {
		problem(w, 500, "Delete failed")
		return
	}
	levels, parents, err := s.workspaceLevels(ctx, tx, u.ID, ws.ID)
	if err != nil {
		problem(w, 500, "Delete failed")
		return
	}
	pageID := r.PathValue("id")
	if levels[pageID] < levelView {
		problem(w, 404, "Page not found")
		return
	}
	children := make(map[string][]string)
	for id, parent := range parents {
		children[parent] = append(children[parent], id)
	}
	ids := []string{pageID}
	seen := map[string]bool{pageID: true}
	for i := 0; i < len(ids); i++ {
		id := ids[i]
		if levels[id] < levelEdit {
			problem(w, 403, "Edit access to the entire page subtree required")
			return
		}
		for _, child := range children[id] {
			if !seen[child] {
				seen[child] = true
				ids = append(ids, child)
			}
		}
	}
	tag, err := tx.Exec(ctx, `UPDATE pages SET trashed=true WHERE workspace_id=$1 AND id=ANY($2) AND NOT deleted AND NOT trashed`, ws.ID, ids)
	if err != nil {
		problem(w, 500, "Delete failed")
		return
	}
	if tag.RowsAffected() > 0 {
		if err = tx.QueryRow(ctx, `UPDATE workspaces SET revision=revision+1 WHERE id=$1 RETURNING revision`, ws.ID).Scan(&revision); err != nil {
			problem(w, 500, "Delete failed")
			return
		}
	}
	if err = tx.Commit(ctx); err != nil {
		problem(w, 500, "Delete failed")
		return
	}
	s.recheckWorkspace(ctx, ws.ID)
	jsonOut(w, 200, map[string]any{"id": pageID, "trashed": true, "affectedPages": tag.RowsAffected(), "revision": revision})
}

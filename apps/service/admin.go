package cloud

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type adminUser struct {
	ID             string    `json:"id"`
	Email          string    `json:"email"`
	Name           string    `json:"name"`
	CreatedAt      time.Time `json:"createdAt"`
	WorkspaceCount int       `json:"workspaceCount"`
	InstanceAdmin  bool      `json:"instanceAdmin"`
}

type adminWorkspace struct {
	ID          string     `json:"id"`
	Slug        string     `json:"slug"`
	Name        string     `json:"name"`
	MemberCount int        `json:"memberCount"`
	CreatedAt   *time.Time `json:"createdAt,omitempty"`
}

func (s *Service) listAdminUsers(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireInstanceAdmin(w, r); !ok {
		return
	}
	limit, offset := adminPage(r, 50, 100)
	ctx := r.Context()
	var total int
	if e := s.DB.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&total); e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	rows, e := s.DB.Query(ctx, `
		SELECT u.id, u.email, u.name, u.created_at,
		       (SELECT count(*) FROM memberships m WHERE m.user_id=u.id),
		       EXISTS(SELECT 1 FROM instance_admins ia WHERE ia.user_id=u.id)
		  FROM users u
		 ORDER BY u.created_at ASC, u.email ASC
		 LIMIT $1 OFFSET $2`, limit, offset)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer rows.Close()
	users := []adminUser{}
	for rows.Next() {
		var u adminUser
		if e = rows.Scan(&u.ID, &u.Email, &u.Name, &u.CreatedAt, &u.WorkspaceCount, &u.InstanceAdmin); e != nil {
			problem(w, 500, "Could not list users")
			return
		}
		users = append(users, u)
	}
	if e = rows.Err(); e != nil {
		problem(w, 500, "Could not list users")
		return
	}
	jsonOut(w, 200, map[string]any{"users": users, "total": total, "limit": limit, "offset": offset})
}

func (s *Service) createAdminUser(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireInstanceAdmin(w, r); !ok {
		return
	}
	var in struct {
		Email string  `json:"email"`
		Name  *string `json:"name"`
	}
	if !body(w, r, &in) {
		return
	}
	email, e := normalizeEmail(in.Email)
	if e != nil {
		problem(w, 400, "Invalid email")
		return
	}
	name := ""
	if in.Name != nil {
		name = strings.TrimSpace(*in.Name)
		if utf8.RuneCountInString(name) > 120 {
			problem(w, 400, "Invalid name")
			return
		}
	}
	id := opaque()
	var created adminUser
	e = s.DB.QueryRow(r.Context(), `
		INSERT INTO users(id,email,name) VALUES($1,$2,$3)
		RETURNING id,email,name,created_at`, id, email, name,
	).Scan(&created.ID, &created.Email, &created.Name, &created.CreatedAt)
	if e != nil {
		problem(w, 409, "Email already used")
		return
	}
	created.WorkspaceCount = 0
	created.InstanceAdmin = false
	jsonOut(w, 201, created)
}

func (s *Service) patchAdminUser(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.requireInstanceAdmin(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if id == "" {
		problem(w, 400, "Invalid user")
		return
	}
	var in struct {
		InstanceAdmin *bool   `json:"instanceAdmin"`
		Name          *string `json:"name"`
	}
	if !body(w, r, &in) {
		return
	}
	ctx := r.Context()
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback(ctx)

	var u adminUser
	e = tx.QueryRow(ctx, `
		SELECT u.id, u.email, u.name, u.created_at,
		       (SELECT count(*) FROM memberships m WHERE m.user_id=u.id),
		       EXISTS(SELECT 1 FROM instance_admins ia WHERE ia.user_id=u.id)
		  FROM users u WHERE u.id=$1 FOR UPDATE`, id,
	).Scan(&u.ID, &u.Email, &u.Name, &u.CreatedAt, &u.WorkspaceCount, &u.InstanceAdmin)
	if errors.Is(e, pgx.ErrNoRows) {
		problem(w, 404, "User not found")
		return
	}
	if e != nil {
		problem(w, 500, "Could not update user")
		return
	}

	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if utf8.RuneCountInString(name) > 120 {
			problem(w, 400, "Invalid name")
			return
		}
		if _, e = tx.Exec(ctx, `UPDATE users SET name=$2 WHERE id=$1`, id, name); e != nil {
			problem(w, 500, "Could not update user")
			return
		}
		u.Name = name
	}

	if in.InstanceAdmin != nil {
		if *in.InstanceAdmin && !u.InstanceAdmin {
			if _, e = tx.Exec(ctx, `INSERT INTO instance_admins(user_id,granted_by) VALUES($1,$2) ON CONFLICT DO NOTHING`, id, actor.ID); e != nil {
				problem(w, 500, "Could not update user")
				return
			}
			u.InstanceAdmin = true
		} else if !*in.InstanceAdmin && u.InstanceAdmin {
			var count int
			if e = tx.QueryRow(ctx, `SELECT count(*) FROM instance_admins`).Scan(&count); e != nil {
				problem(w, 500, "Could not update user")
				return
			}
			if count <= 1 {
				problem(w, 409, errLastInstanceAdmin.Error())
				return
			}
			if _, e = tx.Exec(ctx, `DELETE FROM instance_admins WHERE user_id=$1`, id); e != nil {
				problem(w, 500, "Could not update user")
				return
			}
			u.InstanceAdmin = false
		}
	}

	if e = tx.Commit(ctx); e != nil {
		problem(w, 500, "Could not update user")
		return
	}
	jsonOut(w, 200, u)
}

func (s *Service) deleteAdminUser(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.requireInstanceAdmin(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if id == "" {
		problem(w, 400, "Invalid user")
		return
	}
	ctx := r.Context()
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback(ctx)

	var email string
	var isAdmin bool
	e = tx.QueryRow(ctx, `
		SELECT u.email, EXISTS(SELECT 1 FROM instance_admins ia WHERE ia.user_id=u.id)
		  FROM users u WHERE u.id=$1 FOR UPDATE`, id,
	).Scan(&email, &isAdmin)
	if errors.Is(e, pgx.ErrNoRows) {
		problem(w, 404, "User not found")
		return
	}
	if e != nil {
		problem(w, 500, "Could not delete user")
		return
	}
	if isAdmin {
		var count int
		if e = tx.QueryRow(ctx, `SELECT count(*) FROM instance_admins`).Scan(&count); e != nil {
			problem(w, 500, "Could not delete user")
			return
		}
		if count <= 1 {
			problem(w, 409, errLastInstanceAdmin.Error())
			return
		}
	}

	if e = s.deleteUserTx(ctx, tx, id, email, actor.ID); e != nil {
		problem(w, 500, "Could not delete user")
		return
	}
	if e = tx.Commit(ctx); e != nil {
		problem(w, 500, "Could not delete user")
		return
	}
	jsonOut(w, 200, map[string]bool{"ok": true})
}

// deleteUserTx removes a user and every row that would block the FK. Shares and
// emojis that name the user as grantor/creator are reassigned to the deleting
// administrator (§7.3). Does not query pages.
func (s *Service) deleteUserTx(ctx context.Context, tx pgx.Tx, id, email, actorID string) error {
	if _, e := tx.Exec(ctx, `UPDATE page_shares SET granted_by=$2 WHERE granted_by=$1`, id, actorID); e != nil {
		return e
	}
	if _, e := tx.Exec(ctx, `UPDATE workspace_emojis SET created_by=$2 WHERE created_by=$1`, id, actorID); e != nil {
		return e
	}
	if _, e := tx.Exec(ctx, `UPDATE instance_admins SET granted_by=NULL WHERE granted_by=$1`, id); e != nil {
		return e
	}
	if _, e := tx.Exec(ctx, `UPDATE instance_settings SET updated_by=NULL WHERE updated_by=$1`, id); e != nil {
		return e
	}
	for _, q := range []string{
		`DELETE FROM sessions WHERE user_id=$1`,
		`DELETE FROM mcp_tokens WHERE user_id=$1`,
		`DELETE FROM memberships WHERE user_id=$1`,
		`DELETE FROM join_requests WHERE user_id=$1`,
		`DELETE FROM page_shares WHERE user_id=$1`,
		`DELETE FROM ai_credentials WHERE owner_id=$1`,
		`DELETE FROM instance_admins WHERE user_id=$1`,
	} {
		if _, e := tx.Exec(ctx, q, id); e != nil {
			return e
		}
	}
	if _, e := tx.Exec(ctx, `DELETE FROM login_codes WHERE email=$1`, email); e != nil {
		return e
	}
	_, e := tx.Exec(ctx, `DELETE FROM users WHERE id=$1`, id)
	return e
}

func (s *Service) listAdminWorkspaces(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireInstanceAdmin(w, r); !ok {
		return
	}
	rows, e := s.DB.Query(r.Context(), `
		SELECT w.id, w.slug, w.name,
		       (SELECT count(*) FROM memberships m WHERE m.workspace_id=w.id),
		       w.created_at
		  FROM workspaces w
		 ORDER BY w.name ASC, w.slug ASC`)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer rows.Close()
	list := []adminWorkspace{}
	for rows.Next() {
		var ws adminWorkspace
		var created pgtype.Timestamptz
		if e = rows.Scan(&ws.ID, &ws.Slug, &ws.Name, &ws.MemberCount, &created); e != nil {
			problem(w, 500, "Could not list workspaces")
			return
		}
		if created.Valid {
			t := created.Time
			ws.CreatedAt = &t
		}
		list = append(list, ws)
	}
	if e = rows.Err(); e != nil {
		problem(w, 500, "Could not list workspaces")
		return
	}
	jsonOut(w, 200, map[string]any{"workspaces": list})
}

func (s *Service) adminEmailTest(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireInstanceAdmin(w, r)
	if !ok {
		return
	}
	var in struct {
		Email string `json:"email"`
	}
	if !body(w, r, &in) {
		return
	}
	email, e := normalizeEmail(in.Email)
	if e != nil {
		problem(w, 400, "Invalid email")
		return
	}
	backend := s.Config.mailBackend()
	if !s.rate(r.Context(), "admin-email-test:"+u.ID, 10) {
		problem(w, 429, "Too many attempts; try again later")
		return
	}
	if e = s.send(email, "Test de livraison Blok", fmt.Sprintf("Ceci est un e-mail de test depuis %s.\nSi vous le recevez, la livraison fonctionne.", s.Config.PublicURL)); e != nil {
		jsonOut(w, 503, map[string]any{"error": e.Error(), "backend": backend})
		return
	}
	jsonOut(w, 200, map[string]any{"ok": true, "backend": backend})
}

func adminPage(r *http.Request, def, max int) (limit, offset int) {
	limit = def
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, e := strconv.Atoi(raw); e == nil && n > 0 {
			limit = n
		}
	}
	if limit > max {
		limit = max
	}
	if raw := r.URL.Query().Get("offset"); raw != "" {
		if n, e := strconv.Atoi(raw); e == nil && n > 0 {
			offset = n
		}
	}
	return limit, offset
}

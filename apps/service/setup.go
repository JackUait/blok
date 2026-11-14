package cloud

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/binary"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const setupTokenFile = "setup-token"

// bootstrapInstance applies §5.1 after the schema (and optional bootstrap
// workspace) exist. AdminEmail never touches memberships. Returns whether a
// setup token must be minted or kept on disk after the surrounding transaction
// commits.
func (s *Service) bootstrapInstance(ctx context.Context, tx pgx.Tx) (needSetupToken bool, err error) {
	if _, err = tx.Exec(ctx, `
		UPDATE instance_settings SET default_workspace_id=(SELECT id FROM workspaces)
		 WHERE default_workspace_id IS NULL AND (SELECT count(*) FROM workspaces)=1`); err != nil {
		return false, err
	}
	if s.Config.AdminEmail != "" {
		email := s.Config.AdminEmail
		if _, err = normalizeEmail(email); err != nil {
			return false, err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO users(id,email) VALUES($1,$2) ON CONFLICT(email) DO NOTHING`, opaque(), email); err != nil {
			return false, err
		}
		if _, err = tx.Exec(ctx, `
			INSERT INTO instance_admins(user_id)
			SELECT id FROM users WHERE email=$1
			ON CONFLICT DO NOTHING`, email); err != nil {
			return false, err
		}
		// Workspace couple (§5.3): seed admin membership without rewriting an
		// existing role — demotion must survive New() (§5.1).
		if s.Config.BootstrapWorkspaceSlug != "" {
			if _, err = tx.Exec(ctx, `
				INSERT INTO memberships(workspace_id,user_id,role)
				SELECT w.id, u.id, 'admin'
				  FROM workspaces w, users u
				 WHERE w.slug=$1 AND u.email=$2
				ON CONFLICT DO NOTHING`, s.Config.BootstrapWorkspaceSlug, email); err != nil {
				return false, err
			}
		}
		if _, err = tx.Exec(ctx, `
			UPDATE instance_settings SET setup_completed_at=coalesce(setup_completed_at, now()) WHERE id`); err != nil {
			return false, err
		}
		return false, nil
	}

	var adminCount int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM instance_admins`).Scan(&adminCount); err != nil {
		return false, err
	}
	if adminCount > 0 {
		return false, nil
	}

	var setupCompleted pgtype.Timestamptz
	var hasMembers bool
	if err = tx.QueryRow(ctx, `
		SELECT setup_completed_at, EXISTS(SELECT 1 FROM memberships)
		  FROM instance_settings WHERE id`).Scan(&setupCompleted, &hasMembers); err != nil {
		return false, err
	}
	inherited := setupCompleted.Valid || hasMembers
	if !inherited {
		return true, nil
	}

	rows, err := tx.Query(ctx, `
		SELECT u.id, u.email FROM memberships m
		  JOIN users u ON u.id=m.user_id
		  JOIN instance_settings s ON s.default_workspace_id=m.workspace_id
		 WHERE m.role='admin'`)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	type heir struct{ id, email string }
	var heirs []heir
	for rows.Next() {
		var h heir
		if err = rows.Scan(&h.id, &h.email); err != nil {
			return false, err
		}
		heirs = append(heirs, h)
	}
	if err = rows.Err(); err != nil {
		return false, err
	}
	for _, h := range heirs {
		if _, err = tx.Exec(ctx, `INSERT INTO instance_admins(user_id) VALUES($1) ON CONFLICT DO NOTHING`, h.id); err != nil {
			return false, err
		}
		slog.Info("promoted inherited workspace admin to instance admin", "email", h.email)
	}
	if _, err = tx.Exec(ctx, `
		UPDATE instance_settings SET setup_completed_at=coalesce(setup_completed_at, now()) WHERE id`); err != nil {
		return false, err
	}
	return false, nil
}

func (s *Service) ensureSetupToken(ctx context.Context) error {
	if _, e := s.SetupToken(ctx, false); e != nil {
		return e
	}
	slog.Info("setup required", "url", strings.TrimRight(s.Config.PublicURL, "/"))
	return nil
}

// SetupToken returns the first-run setup token. When regenerate is false it
// reuses the on-disk token if still valid; otherwise it mints a new one.
// Fails once setup has completed.
func (s *Service) SetupToken(ctx context.Context, regenerate bool) (string, error) {
	var completed pgtype.Timestamptz
	if e := s.DB.QueryRow(ctx, `SELECT setup_completed_at FROM instance_settings WHERE id`).Scan(&completed); e != nil {
		return "", e
	}
	if completed.Valid {
		return "", errors.New("setup already completed")
	}
	path := filepath.Join(s.Config.DataDirectory, setupTokenFile)
	if !regenerate {
		if raw, e := os.ReadFile(path); e == nil {
			token := strings.TrimSpace(string(raw))
			if token != "" {
				var ok bool
				if e = s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM setup_tokens WHERE digest=$1)`, hash(token)).Scan(&ok); e != nil {
					return "", e
				}
				if ok {
					return token, nil
				}
			}
		}
	}
	if e := os.MkdirAll(s.Config.DataDirectory, 0700); e != nil {
		return "", e
	}
	token := opaque()
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return "", e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `DELETE FROM setup_tokens`); e != nil {
		return "", e
	}
	if _, e = tx.Exec(ctx, `INSERT INTO setup_tokens(digest) VALUES($1)`, hash(token)); e != nil {
		return "", e
	}
	if e = tx.Commit(ctx); e != nil {
		return "", e
	}
	if e = os.WriteFile(path, []byte(token+"\n"), 0600); e != nil {
		return "", e
	}
	_ = os.Chmod(path, 0600)
	return token, nil
}

// EmailTest sends a delivery probe and returns the mail backend name.
func (s *Service) EmailTest(ctx context.Context, email string) (string, error) {
	_ = ctx
	email, e := normalizeEmail(email)
	if e != nil {
		return "", e
	}
	backend := s.Config.mailBackend()
	if e = s.send(email, "Test de livraison Blok", fmt.Sprintf("Ceci est un e-mail de test depuis %s.\nSi vous le recevez, la livraison fonctionne.", s.Config.PublicURL)); e != nil {
		return backend, e
	}
	return backend, nil
}

func (s *Service) setupTokenValid(ctx context.Context, tx pgx.Tx, token string) (bool, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return false, nil
	}
	digest := hash(token)
	rows, e := tx.Query(ctx, `SELECT digest FROM setup_tokens`)
	if e != nil {
		return false, e
	}
	defer rows.Close()
	matched := false
	for rows.Next() {
		var stored string
		if e = rows.Scan(&stored); e != nil {
			return false, e
		}
		if subtle.ConstantTimeCompare([]byte(stored), []byte(digest)) == 1 {
			matched = true
		}
	}
	return matched, rows.Err()
}

func (s *Service) claimSetup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token        string `json:"token"`
		Email        string `json:"email"`
		Name         string `json:"name"`
		InstanceName string `json:"instanceName"`
		Workspace    *struct {
			Slug string `json:"slug"`
			Name string `json:"name"`
		} `json:"workspace"`
	}
	if !body(w, r, &in) {
		return
	}
	email, e := normalizeEmail(in.Email)
	if e != nil {
		problem(w, 400, "Invalid email")
		return
	}
	name := strings.TrimSpace(in.Name)
	if name == "" || utf8.RuneCountInString(name) > 120 {
		problem(w, 400, "Invalid name")
		return
	}
	instanceName := strings.TrimSpace(in.InstanceName)
	if instanceName != "" && (utf8.RuneCountInString(instanceName) < 1 || utf8.RuneCountInString(instanceName) > 120) {
		problem(w, 400, "Invalid instanceName")
		return
	}
	if in.Workspace != nil {
		if !slugPattern.MatchString(in.Workspace.Slug) || len(strings.TrimSpace(in.Workspace.Name)) < 1 || utf8.RuneCountInString(in.Workspace.Name) > 120 {
			problem(w, 400, "Invalid workspace")
			return
		}
	}
	ip := s.clientIP(r)
	if !s.rate(r.Context(), "setup-claim:"+ip, 20) {
		problem(w, 429, "Too many attempts; try again later")
		return
	}

	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback(r.Context())

	var completed pgtype.Timestamptz
	e = tx.QueryRow(r.Context(), `SELECT setup_completed_at FROM instance_settings WHERE id FOR UPDATE`).Scan(&completed)
	if e != nil {
		problem(w, 500, "Setup unavailable")
		return
	}
	if completed.Valid {
		problem(w, 409, "Setup already completed")
		return
	}
	ok, e := s.setupTokenValid(r.Context(), tx, in.Token)
	if e != nil {
		problem(w, 500, "Setup unavailable")
		return
	}
	if !ok {
		problem(w, 403, "Invalid setup token")
		return
	}

	userID := opaque()
	e = tx.QueryRow(r.Context(), `
		INSERT INTO users(id,email,name) VALUES($1,$2,$3)
		ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name
		RETURNING id`, userID, email, name).Scan(&userID)
	if e != nil {
		problem(w, 500, "Could not create administrator")
		return
	}
	if _, e = tx.Exec(r.Context(), `INSERT INTO instance_admins(user_id) VALUES($1) ON CONFLICT DO NOTHING`, userID); e != nil {
		problem(w, 500, "Could not create administrator")
		return
	}

	var workspaceID *string
	if in.Workspace != nil {
		wsName := strings.TrimSpace(in.Workspace.Name)
		id := opaque()
		if _, e = tx.Exec(r.Context(), `INSERT INTO workspaces(id,slug,name) VALUES($1,$2,$3)`, id, in.Workspace.Slug, wsName); e != nil {
			problem(w, 409, "Slug already used")
			return
		}
		if _, e = tx.Exec(r.Context(), `INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'admin')`, id, userID); e != nil {
			problem(w, 500, "Could not create workspace")
			return
		}
		workspaceID = &id
	}

	if instanceName == "" {
		instanceName = s.settings().Name
		if instanceName == "" {
			instanceName = "Blok"
		}
	}
	if _, e = tx.Exec(r.Context(), `
		UPDATE instance_settings SET
		  name=$1,
		  default_workspace_id=coalesce($2, default_workspace_id),
		  setup_completed_at=now(),
		  updated_at=now(),
		  updated_by=$3
		WHERE id`, instanceName, workspaceID, userID); e != nil {
		problem(w, 500, "Could not complete setup")
		return
	}
	if _, e = tx.Exec(r.Context(), `DELETE FROM setup_tokens`); e != nil {
		problem(w, 500, "Could not complete setup")
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		problem(w, 500, "Could not complete setup")
		return
	}
	_ = os.Remove(filepath.Join(s.Config.DataDirectory, setupTokenFile))
	_ = s.refreshSettings(r.Context())

	// Possession of the mailbox still has to be proved — no session here.
	if e = s.issueLoginCode(r.Context(), email, ip); e != nil {
		if errors.Is(e, errLoginRateLimited) {
			problem(w, 429, "Too many attempts; try again later")
			return
		}
		problem(w, 503, "Email delivery unavailable")
		return
	}
	jsonOut(w, 200, map[string]any{"ok": true})
}

var errLoginRateLimited = errors.New("login rate limited")

func (s *Service) issueLoginCode(ctx context.Context, email, ip string) error {
	if !s.rate(ctx, "login-ip:"+ip, 30) || !s.rate(ctx, "login-email:"+email, 8) {
		return errLoginRateLimited
	}
	return s.deliverLoginCode(ctx, email)
}

// deliverLoginCode writes the OTP row and sends the mail. Callers that already
// consumed the login rate quota (requestCode) use this directly.
func (s *Service) deliverLoginCode(ctx context.Context, email string) error {
	b := make([]byte, 4)
	if _, e := rand.Read(b); e != nil {
		return e
	}
	code := fmt.Sprintf("%06d", binary.BigEndian.Uint32(b)%1000000)
	var sent string
	e := s.DB.QueryRow(ctx, `INSERT INTO login_codes(email,digest,expires_at) VALUES($1,$2,now()+interval '10 minutes') ON CONFLICT(email) DO UPDATE SET digest=$2,expires_at=now()+interval '10 minutes',attempts=0,sent_at=now() WHERE login_codes.sent_at<now()-interval '45 seconds' RETURNING email`, email, hash(email+":"+code+":"+s.Config.InternalSecret)).Scan(&sent)
	if e != nil {
		return errLoginRateLimited
	}
	if e = s.send(email, "Votre code de connexion Blok", fmt.Sprintf("Votre code de connexion : %s\n\nIl expire dans 10 minutes. Si vous n’avez pas demandé ce code, ignorez cet email.\n%s", code, s.Config.PublicURL)); e != nil {
		s.DB.Exec(ctx, "DELETE FROM login_codes WHERE email=$1 AND digest=$2", email, hash(email+":"+code+":"+s.Config.InternalSecret))
		return e
	}
	return nil
}

func (s *Service) setupEmailTest(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token string `json:"token"`
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

	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback(r.Context())

	var completed pgtype.Timestamptz
	e = tx.QueryRow(r.Context(), `SELECT setup_completed_at FROM instance_settings WHERE id FOR UPDATE`).Scan(&completed)
	if e != nil {
		problem(w, 500, "Setup unavailable")
		return
	}
	if completed.Valid {
		problem(w, 403, "Setup already completed")
		return
	}
	ok, e := s.setupTokenValid(r.Context(), tx, in.Token)
	if e != nil {
		problem(w, 500, "Setup unavailable")
		return
	}
	if !ok {
		problem(w, 403, "Invalid setup token")
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		problem(w, 500, "Setup unavailable")
		return
	}

	ip := s.clientIP(r)
	if !s.rate(r.Context(), "setup-email-test:"+ip, 10) {
		problem(w, 429, "Too many attempts; try again later")
		return
	}
	if e = s.send(email, "Test de livraison Blok", fmt.Sprintf("Ceci est un e-mail de test depuis %s.\nSi vous le recevez, la livraison fonctionne.", s.Config.PublicURL)); e != nil {
		jsonOut(w, 503, map[string]any{"error": e.Error(), "backend": backend})
		return
	}
	jsonOut(w, 200, map[string]any{"ok": true, "backend": backend})
}

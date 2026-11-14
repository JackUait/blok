package cloud

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var errLastInstanceAdmin = errors.New("Keep at least one instance administrator")

// InstanceSettings is the singleton row that governs signup, workspace
// creation and the first-run setup window for a self-hosted deployment.
type InstanceSettings struct {
	Name              string
	SignupPolicy      string
	SignupDomains     []string
	WorkspaceCreation string
	DefaultWorkspaceID *string
	SetupCompletedAt  *time.Time
	UpdatedAt         time.Time
	UpdatedBy         *string
}

// SettingsPatch carries optional fields for an atomic UPDATE … COALESCE.
// A nil pointer means "leave unchanged"; an empty string pointer clears a
// text field where that is meaningful (name).
type SettingsPatch struct {
	Name              *string
	SignupPolicy      *string
	SignupDomains     *[]string
	WorkspaceCreation *string
	DefaultWorkspaceID *string
	UpdatedBy         *string
}

func (s *Service) settings() InstanceSettings {
	p := s.settingsValue.Load()
	if p == nil {
		return InstanceSettings{}
	}
	return *p
}

func (s *Service) storeSettings(v InstanceSettings) {
	cp := v
	if cp.SignupDomains == nil {
		cp.SignupDomains = []string{}
	}
	s.settingsValue.Store(&cp)
}

func (s *Service) loadSettings(ctx context.Context) (InstanceSettings, error) {
	var (
		out               InstanceSettings
		defaultWorkspaceID pgtype.Text
		setupCompletedAt  pgtype.Timestamptz
		updatedBy         pgtype.Text
		domains           []string
	)
	e := s.DB.QueryRow(ctx, `
		SELECT name, signup_policy, coalesce(signup_domains,'{}'), workspace_creation,
		       default_workspace_id, setup_completed_at, updated_at, updated_by
		  FROM instance_settings WHERE id`).Scan(
		&out.Name, &out.SignupPolicy, &domains, &out.WorkspaceCreation,
		&defaultWorkspaceID, &setupCompletedAt, &out.UpdatedAt, &updatedBy,
	)
	if e != nil {
		return out, e
	}
	out.SignupDomains = domains
	if out.SignupDomains == nil {
		out.SignupDomains = []string{}
	}
	if defaultWorkspaceID.Valid {
		v := defaultWorkspaceID.String
		out.DefaultWorkspaceID = &v
	}
	if setupCompletedAt.Valid {
		t := setupCompletedAt.Time
		out.SetupCompletedAt = &t
	}
	if updatedBy.Valid {
		v := updatedBy.String
		out.UpdatedBy = &v
	}
	return out, nil
}

func (s *Service) refreshSettings(ctx context.Context) error {
	v, e := s.loadSettings(ctx)
	if e != nil {
		return e
	}
	s.storeSettings(v)
	return nil
}

func (s *Service) applySettings(ctx context.Context, patch SettingsPatch) (InstanceSettings, error) {
	var (
		out               InstanceSettings
		defaultWorkspaceID pgtype.Text
		setupCompletedAt  pgtype.Timestamptz
		updatedBy         pgtype.Text
		domains           []string
	)
	var domainsArg any
	if patch.SignupDomains != nil {
		domainsArg = *patch.SignupDomains
	}
	e := s.DB.QueryRow(ctx, `
		UPDATE instance_settings SET
		  name = coalesce($1, name),
		  signup_policy = coalesce($2, signup_policy),
		  signup_domains = coalesce($3, signup_domains),
		  workspace_creation = coalesce($4, workspace_creation),
		  default_workspace_id = coalesce($5, default_workspace_id),
		  updated_by = coalesce($6, updated_by),
		  updated_at = now()
		WHERE id
		RETURNING name, signup_policy, coalesce(signup_domains,'{}'), workspace_creation,
		          default_workspace_id, setup_completed_at, updated_at, updated_by`,
		patch.Name, patch.SignupPolicy, domainsArg, patch.WorkspaceCreation,
		patch.DefaultWorkspaceID, patch.UpdatedBy,
	).Scan(
		&out.Name, &out.SignupPolicy, &domains, &out.WorkspaceCreation,
		&defaultWorkspaceID, &setupCompletedAt, &out.UpdatedAt, &updatedBy,
	)
	if e != nil {
		return out, e
	}
	out.SignupDomains = domains
	if out.SignupDomains == nil {
		out.SignupDomains = []string{}
	}
	if defaultWorkspaceID.Valid {
		v := defaultWorkspaceID.String
		out.DefaultWorkspaceID = &v
	}
	if setupCompletedAt.Valid {
		t := setupCompletedAt.Time
		out.SetupCompletedAt = &t
	}
	if updatedBy.Valid {
		v := updatedBy.String
		out.UpdatedBy = &v
	}
	s.storeSettings(out)
	return out, nil
}

func (s *Service) startSettingsSweep() {
	ctx, cancel := context.WithCancel(context.Background())
	s.settingsCancel = cancel
	s.settingsDone = make(chan struct{})
	go func() {
		defer close(s.settingsDone)
		tick := time.NewTicker(5 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
				_ = s.refreshSettings(ctx)
			}
		}
	}()
}

func (s *Service) stopSettingsSweep() {
	if s.settingsCancel != nil {
		s.settingsCancel()
		<-s.settingsDone
		s.settingsCancel = nil
	}
}

func (s *Service) getInstance(w http.ResponseWriter, r *http.Request) {
	cfg := s.settings()
	out := map[string]any{
		"name":              cfg.Name,
		"setupRequired":     cfg.SetupCompletedAt == nil,
		"signupPolicy":      cfg.SignupPolicy,
		"workspaceCreation": cfg.WorkspaceCreation,
		"defaultWorkspace":  nil,
	}
	if cfg.DefaultWorkspaceID != nil {
		var slug, name string
		e := s.DB.QueryRow(r.Context(),
			`SELECT slug, name FROM workspaces WHERE id=$1`, *cfg.DefaultWorkspaceID,
		).Scan(&slug, &name)
		if e == nil {
			out["defaultWorkspace"] = map[string]string{"slug": slug, "name": name}
		} else if e != pgx.ErrNoRows {
			problem(w, 500, "Instance unavailable")
			return
		}
	}
	jsonOut(w, 200, out)
}

func (s *Service) requireInstanceAdmin(w http.ResponseWriter, r *http.Request) (identity, bool) {
	u, ok := s.require(w, r)
	if !ok {
		return u, false
	}
	if !u.InstanceAdmin {
		problem(w, 403, "Instance administrator required")
		return u, false
	}
	return u, true
}

func settingsJSON(cfg InstanceSettings) map[string]any {
	domains := cfg.SignupDomains
	if domains == nil {
		domains = []string{}
	}
	return map[string]any{
		"name":              cfg.Name,
		"signupPolicy":      cfg.SignupPolicy,
		"signupDomains":     domains,
		"workspaceCreation": cfg.WorkspaceCreation,
		"defaultWorkspaceId": cfg.DefaultWorkspaceID,
		"setupCompletedAt":  cfg.SetupCompletedAt,
		"updatedAt":         cfg.UpdatedAt,
	}
}

func (s *Service) getAdminSettings(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireInstanceAdmin(w, r); !ok {
		return
	}
	jsonOut(w, 200, settingsJSON(s.settings()))
}

func (s *Service) patchAdminSettings(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireInstanceAdmin(w, r)
	if !ok {
		return
	}
	var in struct {
		Name              *string   `json:"name"`
		SignupPolicy      *string   `json:"signupPolicy"`
		SignupDomains     *[]string `json:"signupDomains"`
		WorkspaceCreation *string   `json:"workspaceCreation"`
		DefaultWorkspaceID *string  `json:"defaultWorkspaceId"`
	}
	if !body(w, r, &in) {
		return
	}
	if in.SignupPolicy != nil {
		switch *in.SignupPolicy {
		case "invite", "domain", "open":
		default:
			problem(w, 400, "Invalid signupPolicy")
			return
		}
	}
	if in.WorkspaceCreation != nil {
		switch *in.WorkspaceCreation {
		case "anyone", "admins_only", "disabled":
		default:
			problem(w, 400, "Invalid workspaceCreation")
			return
		}
	}
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if len(name) < 1 || len(name) > 120 {
			problem(w, 400, "Invalid name")
			return
		}
		in.Name = &name
	}
	updated, e := s.applySettings(r.Context(), SettingsPatch{
		Name: in.Name, SignupPolicy: in.SignupPolicy, SignupDomains: in.SignupDomains,
		WorkspaceCreation: in.WorkspaceCreation, DefaultWorkspaceID: in.DefaultWorkspaceID,
		UpdatedBy: &u.ID,
	})
	if e != nil {
		problem(w, 500, "Could not update settings")
		return
	}
	jsonOut(w, 200, settingsJSON(updated))
}

// GrantInstanceAdmin creates the account if needed and promotes it. Shared by
// HTTP admin routes and blokctl.
func (s *Service) GrantInstanceAdmin(ctx context.Context, email string) (created bool, err error) {
	email, err = normalizeEmail(email)
	if err != nil {
		return false, err
	}
	var id string
	var existed bool
	err = s.DB.QueryRow(ctx, `SELECT id FROM users WHERE email=$1`, email).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		id = opaque()
		if _, err = s.DB.Exec(ctx, `INSERT INTO users(id,email) VALUES($1,$2)`, id, email); err != nil {
			return false, err
		}
		created = true
	} else if err != nil {
		return false, err
	} else {
		existed = true
		_ = existed
	}
	tag, err := s.DB.Exec(ctx, `INSERT INTO instance_admins(user_id) VALUES($1) ON CONFLICT DO NOTHING`, id)
	if err != nil {
		return created, err
	}
	_ = tag
	return created, nil
}

// RevokeInstanceAdmin removes instance admin rights. Refuses to remove the last one.
func (s *Service) RevokeInstanceAdmin(ctx context.Context, email string) error {
	email, err := normalizeEmail(email)
	if err != nil {
		return err
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var userID string
	err = tx.QueryRow(ctx, `SELECT u.id FROM users u JOIN instance_admins ia ON ia.user_id=u.id WHERE u.email=$1 FOR UPDATE`, email).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM instance_admins`).Scan(&count); err != nil {
		return err
	}
	if count <= 1 {
		return errLastInstanceAdmin
	}
	if _, err = tx.Exec(ctx, `DELETE FROM instance_admins WHERE user_id=$1`, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

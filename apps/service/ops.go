package cloud

import (
	"context"
	"errors"
	"net/netip"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// expectedSchemaVersion is the highest version schema.sql inserts. Operate
// refuses to open a database that has not been migrated that far.
const expectedSchemaVersion = 5

// ErrSchemaStale is returned by Operate when schema_migrations is behind.
var ErrSchemaStale = errors.New("database schema is behind this blokctl; start the server to migrate first")

// Ops is the narrow recovery surface for blokctl. It opens a pool and never
// starts Blok, MCP, or the access/settings sweeps.
type Ops struct {
	DB     *pgxpool.Pool
	Config Config
}

// Operate opens a database pool for recovery commands. It does not migrate.
func Operate(ctx context.Context, c Config) (*Ops, error) {
	if e := c.validateOps(); e != nil {
		return nil, e
	}
	db, e := pgxpool.New(ctx, c.DatabaseURL)
	if e != nil {
		return nil, e
	}
	var max pgtype.Int4
	e = db.QueryRow(ctx, `SELECT max(version) FROM schema_migrations`).Scan(&max)
	if e != nil {
		db.Close()
		if errors.Is(e, pgx.ErrNoRows) {
			return nil, ErrSchemaStale
		}
		return nil, e
	}
	if !max.Valid || int(max.Int32) < expectedSchemaVersion {
		db.Close()
		return nil, ErrSchemaStale
	}
	return &Ops{DB: db, Config: c}, nil
}

func (o *Ops) Close() {
	if o != nil && o.DB != nil {
		o.DB.Close()
	}
}

func (o *Ops) asService() *Service {
	return &Service{DB: o.DB, Config: o.Config}
}

func (o *Ops) GrantInstanceAdmin(ctx context.Context, email string) (bool, error) {
	return o.asService().GrantInstanceAdmin(ctx, email)
}

func (o *Ops) RevokeInstanceAdmin(ctx context.Context, email string) error {
	return o.asService().RevokeInstanceAdmin(ctx, email)
}

func (o *Ops) Settings(ctx context.Context) (InstanceSettings, error) {
	return o.asService().loadSettings(ctx)
}

func (o *Ops) SetSettings(ctx context.Context, patch SettingsPatch) (InstanceSettings, error) {
	return o.asService().applySettings(ctx, patch)
}

func (o *Ops) SetupToken(ctx context.Context, regenerate bool) (string, error) {
	return o.asService().SetupToken(ctx, regenerate)
}

func (o *Ops) EmailTest(ctx context.Context, email string) (string, error) {
	return o.asService().EmailTest(ctx, email)
}

// ListInstanceAdmins returns emails of current instance administrators.
func (o *Ops) ListInstanceAdmins(ctx context.Context) ([]string, error) {
	rows, e := o.DB.Query(ctx, `
		SELECT u.email FROM instance_admins ia
		  JOIN users u ON u.id=ia.user_id
		 ORDER BY u.email ASC`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	var emails []string
	for rows.Next() {
		var email string
		if e = rows.Scan(&email); e != nil {
			return nil, e
		}
		emails = append(emails, email)
	}
	return emails, rows.Err()
}

// validateOps is the lighter gate for blokctl: enough to open the database.
func (c Config) validateOps() error {
	if c.DatabaseURL == "" {
		return errors.New("DATABASE_URL required")
	}
	for _, raw := range c.TrustedProxyCIDRs {
		if _, e := netip.ParsePrefix(strings.TrimSpace(raw)); e != nil {
			return errors.New("invalid TRUSTED_PROXY_CIDRS")
		}
	}
	return nil
}

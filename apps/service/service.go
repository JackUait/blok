package cloud

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/mail"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/JackUait/blok/packages/server/go/v2/blokserver"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schema string

type Service struct {
	DB           *pgxpool.Pool
	Config       Config
	Blok         *blokserver.Server
	mux          *http.ServeMux
	observed     map[string]int
	observedMu   sync.Mutex
	draining     atomic.Bool
	accessCancel context.CancelFunc
	accessDone   chan struct{}
}
type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}
type identity struct {
	User
	Session string
}
type Workspace struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
	Role string `json:"role"`
}

func opaque() string {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func hash(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func New(ctx context.Context, c Config) (*Service, error) {
	if e := c.validate(); e != nil {
		return nil, e
	}
	db, e := pgxpool.New(ctx, c.DatabaseURL)
	if e != nil {
		return nil, e
	}
	s := &Service{DB: db, Config: c, mux: http.NewServeMux(), observed: map[string]int{}}
	var tx pgx.Tx
	fail := func(e error) (*Service, error) {
		if tx != nil {
			_ = tx.Rollback(ctx)
		}
		db.Close()
		return nil, e
	}
	tx, e = db.Begin(ctx)
	if e != nil {
		return fail(e)
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(774839102)"); e != nil {
		return fail(e)
	}
	if _, e = tx.Exec(ctx, schema); e != nil {
		return fail(e)
	}
	if _, e = tx.Exec(ctx, "INSERT INTO workspaces(id,slug,name) VALUES($1,'tousambassadeurs','Tousambassadeurs') ON CONFLICT(slug) DO NOTHING", opaque()); e != nil {
		return fail(e)
	}
	if c.AdminEmail != "" {
		marker, e := tx.Exec(ctx, "INSERT INTO bootstrap_markers(name) VALUES('default-admin') ON CONFLICT DO NOTHING")
		if e != nil {
			return fail(e)
		}
		if marker.RowsAffected() == 1 {
			if _, e = normalizeEmail(c.AdminEmail); e != nil {
				return fail(e)
			}
			if _, e = tx.Exec(ctx, "INSERT INTO users(id,email) VALUES($1,$2) ON CONFLICT(email) DO NOTHING", opaque(), c.AdminEmail); e != nil {
				return fail(e)
			}
			if _, e = tx.Exec(ctx, "INSERT INTO memberships SELECT w.id,u.id,'admin' FROM workspaces w,users u WHERE w.slug='tousambassadeurs' AND u.email=$1 ON CONFLICT(workspace_id,user_id) DO NOTHING", c.AdminEmail); e != nil {
				return fail(e)
			}
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return fail(e)
	}
	if e = os.MkdirAll(filepath.Join(c.DataDirectory, "uploads"), 0700); e != nil {
		return fail(e)
	}
	auth := "ticket"
	s.Blok, e = blokserver.New(blokserver.Options{Auth: &auth, Secret: c.TicketSecret, PublicURL: strings.TrimRight(c.PublicURL, "/") + "/files", AllowedOrigins: append([]string{c.PublicURL}, c.AllowedOrigins...), StorageDirectory: filepath.Join(c.DataDirectory, "uploads"), CollabEnabled: true, CollabJournal: true, CollabDirectory: filepath.Join(c.DataDirectory, "collab"), DocEndpoint: strings.TrimRight(c.InternalURL, "/") + "/internal/documents", DocEndpointAuth: "Bearer " + c.InternalSecret, Authorization: s, Logger: slog.Default(), RateLimitPerMinute: 600})
	if e != nil {
		return fail(e)
	}
	s.routes()
	s.startAccessSweep()
	return s, nil
}
func (s *Service) Close() { s.stopAccessSweep(); s.DB.Close() }
func (s *Service) Drain(ctx context.Context) error {
	s.draining.Store(true)
	s.stopAccessSweep()
	return s.Blok.Drain(ctx)
}
func jsonOut(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func problem(w http.ResponseWriter, status int, msg string) {
	jsonOut(w, status, map[string]any{"error": msg})
}
func body(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
	d := json.NewDecoder(r.Body)
	if e := d.Decode(v); e != nil {
		problem(w, 400, "Invalid JSON")
		return false
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		problem(w, 400, "Expected one JSON value")
		return false
	}
	return true
}
func (s *Service) session(r *http.Request) (identity, error) {
	token := ""
	if strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		token = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	} else if c, e := r.Cookie("blok_session"); e == nil {
		token = c.Value
	}
	var u identity
	if token == "" {
		return u, errors.New("missing session")
	}
	u.Session = hash(token)
	e := s.DB.QueryRow(r.Context(), "SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at>now()", u.Session).Scan(&u.ID, &u.Email)
	return u, e
}
func (s *Service) require(w http.ResponseWriter, r *http.Request) (identity, bool) {
	u, e := s.session(r)
	if e != nil {
		problem(w, 401, "Sign in required")
		return u, false
	}
	return u, true
}
func (s *Service) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.RemoteAddr = net.JoinHostPort(s.clientIP(r), "0")
		if s.draining.Load() && !strings.HasPrefix(r.URL.Path, "/internal/documents/") {
			problem(w, 503, "Service draining")
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		origin := r.Header.Get("Origin")
		allowed := origin == "" || origin == strings.TrimRight(s.Config.PublicURL, "/")
		for _, o := range s.Config.AllowedOrigins {
			if origin == o {
				allowed = true
			}
		}
		if !allowed {
			problem(w, 403, "Origin refused")
			return
		}
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == "OPTIONS" {
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.WriteHeader(204)
			return
		}
		// Cookie writes with omitted Origin must be same-origin browser fetches. Native uses bearer.
		if r.Method != "GET" && r.Method != "HEAD" && origin == "" && r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			problem(w, 403, "Cross-site write refused")
			return
		}
		s.mux.ServeHTTP(w, r)
	})
}
func (s *Service) routes() {
	s.mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if e := s.DB.Ping(r.Context()); e != nil {
			problem(w, 503, "Database unavailable")
			return
		}
		jsonOut(w, 200, map[string]bool{"ok": true})
	})
	s.mux.HandleFunc("POST /api/auth/request-code", s.requestCode)
	s.mux.HandleFunc("POST /api/auth/verify-code", s.verifyCode)
	s.mux.HandleFunc("GET /api/session", s.getSession)
	s.mux.HandleFunc("POST /api/auth/logout", s.logout)
	s.mux.HandleFunc("GET /api/workspaces", s.listWorkspaces)
	s.mux.HandleFunc("POST /api/workspaces", s.createWorkspace)
	s.mux.HandleFunc("/api/workspaces/{slug}", s.workspace)
	s.mux.HandleFunc("/api/workspaces/{slug}/{resource}", s.workspaceResource)
	s.mux.HandleFunc("/api/workspaces/{slug}/{resource}/{id}", s.workspaceResource)
	s.mux.HandleFunc("/api/workspaces/{slug}/{resource}/{id}/{action}", s.workspaceResource)
	s.mux.HandleFunc("GET /api/blok-ticket", s.getTicket)
	s.mux.HandleFunc("/internal/documents/{id}", s.document)
	// Blok's own local-file branch bypasses its auth wrapper; explicitly guard it here.
	blok := s.Blok.Handler("/api/blok")
	s.mux.Handle("/api/blok/", s.blokHandler(blok))
	s.mux.HandleFunc("GET /api/assets/url", s.assetURL)
	s.mux.Handle("/files/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.file(w, r, blok) }))
}
func normalizeEmail(v string) (string, error) {
	v = strings.ToLower(strings.TrimSpace(v))
	a, e := mail.ParseAddress(v)
	if e != nil || a.Address != v || len(v) > 254 {
		return "", errors.New("invalid email")
	}
	return v, nil
}
func (s *Service) workspaces(ctx context.Context, uid string) ([]Workspace, error) {
	rows, e := s.DB.Query(ctx, "SELECT w.id,w.slug,w.name,m.role FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.name", uid)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Workspace{}
	for rows.Next() {
		var w Workspace
		if e = rows.Scan(&w.ID, &w.Slug, &w.Name, &w.Role); e != nil {
			return nil, e
		}
		out = append(out, w)
	}
	return out, rows.Err()
}
func (s *Service) CanReadDocument(ctx context.Context, u blokserver.User, doc string) (bool, error) {
	return s.authorizeDoc(ctx, u.ID, doc, false)
}
func (s *Service) CanWriteDocument(ctx context.Context, u blokserver.User, doc string) (bool, error) {
	return s.authorizeDoc(ctx, u.ID, doc, true)
}
func (s *Service) authorizeDoc(ctx context.Context, session, doc string, write bool) (bool, error) {
	var ok bool
	e := s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions s JOIN memberships m ON m.user_id=s.user_id JOIN pages p ON p.workspace_id=m.workspace_id WHERE s.id=$1 AND s.expires_at>now() AND p.id=$2 AND NOT p.deleted AND NOT p.trashed AND (NOT $3 OR m.role IN ('admin','member')))`, session, doc, write).Scan(&ok)
	return ok, e
}
func internalAuth(r *http.Request, secret string) bool {
	return subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+secret)) == 1
}

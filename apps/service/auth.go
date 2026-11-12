package cloud

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/binary"
	"fmt"
	"net/http"
	"time"
)

func (s *Service) rate(ctx context.Context, key string, max int) bool {
	var count int
	e := s.DB.QueryRow(ctx, `INSERT INTO email_rate_limits(key,count) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN email_rate_limits.window_start < now()-interval '1 hour' THEN 1 ELSE email_rate_limits.count+1 END,window_start=CASE WHEN email_rate_limits.window_start < now()-interval '1 hour' THEN now() ELSE email_rate_limits.window_start END RETURNING count`, key).Scan(&count)
	return e == nil && count <= max
}
func (s *Service) requestCode(w http.ResponseWriter, r *http.Request) {
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
	ip := s.clientIP(r)
	if !s.rate(r.Context(), "login-ip:"+ip, 30) || !s.rate(r.Context(), "login-email:"+email, 8) {
		problem(w, 429, "Too many attempts; try again later")
		return
	}
	b := make([]byte, 4)
	if _, e = rand.Read(b); e != nil {
		problem(w, 500, "Could not generate code")
		return
	}
	code := fmt.Sprintf("%06d", binary.BigEndian.Uint32(b)%1000000)
	var sent string
	e = s.DB.QueryRow(r.Context(), `INSERT INTO login_codes(email,digest,expires_at) VALUES($1,$2,now()+interval '10 minutes') ON CONFLICT(email) DO UPDATE SET digest=$2,expires_at=now()+interval '10 minutes',attempts=0,sent_at=now() WHERE login_codes.sent_at<now()-interval '45 seconds' RETURNING email`, email, hash(email+":"+code+":"+s.Config.InternalSecret)).Scan(&sent)
	if e != nil {
		problem(w, 429, "Wait before requesting another code")
		return
	}
	if e = s.send(email, "Votre code de connexion Blok", fmt.Sprintf("Votre code de connexion : %s\n\nIl expire dans 10 minutes. Si vous n’avez pas demandé ce code, ignorez cet email.\n%s", code, s.Config.PublicURL)); e != nil {
		s.DB.Exec(r.Context(), "DELETE FROM login_codes WHERE email=$1 AND digest=$2", email, hash(email+":"+code+":"+s.Config.InternalSecret))
		problem(w, 503, "Email delivery unavailable")
		return
	}
	jsonOut(w, 200, map[string]bool{"ok": true})
}
func (s *Service) verifyCode(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email  string `json:"email"`
		Code   string `json:"code"`
		Client string `json:"client"`
	}
	if !body(w, r, &in) {
		return
	}
	email, e := normalizeEmail(in.Email)
	if e != nil || len(in.Code) != 6 {
		problem(w, 400, "Invalid code")
		return
	}
	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	var digest string
	var attempts int
	var expires time.Time
	e = tx.QueryRow(r.Context(), "SELECT digest,attempts,expires_at FROM login_codes WHERE email=$1 FOR UPDATE", email).Scan(&digest, &attempts, &expires)
	if e != nil || attempts >= 5 || time.Now().After(expires) {
		problem(w, 401, "Invalid or expired code")
		return
	}
	if subtle.ConstantTimeCompare([]byte(digest), []byte(hash(email+":"+in.Code+":"+s.Config.InternalSecret))) != 1 {
		tx.Exec(r.Context(), "UPDATE login_codes SET attempts=attempts+1 WHERE email=$1", email)
		tx.Commit(r.Context())
		problem(w, 401, "Invalid or expired code")
		return
	}
	if _, e = tx.Exec(r.Context(), "DELETE FROM login_codes WHERE email=$1", email); e != nil {
		problem(w, 500, "Sign in failed")
		return
	}
	var u User
	e = tx.QueryRow(r.Context(), "INSERT INTO users(id,email) VALUES($1,$2) ON CONFLICT(email) DO UPDATE SET email=excluded.email RETURNING id,email", opaque(), email).Scan(&u.ID, &u.Email)
	if e != nil {
		problem(w, 500, "Sign in failed")
		return
	}
	if _, e = tx.Exec(r.Context(), `INSERT INTO memberships(workspace_id,user_id,role) SELECT workspace_id,$1,role FROM (SELECT DISTINCT ON (workspace_id) workspace_id,role FROM invites WHERE email=$2 AND status='pending' AND expires_at>now() ORDER BY workspace_id,created_at DESC,id DESC) pending ON CONFLICT(workspace_id,user_id) DO NOTHING`, u.ID, email); e != nil {
		problem(w, 500, "Invitation acceptance failed")
		return
	}
	if _, e = tx.Exec(r.Context(), "UPDATE invites SET status='accepted' WHERE email=$1 AND status='pending' AND expires_at>now()", email); e != nil {
		problem(w, 500, "Invitation acceptance failed")
		return
	}
	token := opaque()
	if _, e = tx.Exec(r.Context(), "INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')", hash(token), u.ID); e != nil {
		problem(w, 500, "Sign in failed")
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		problem(w, 500, "Sign in failed")
		return
	}
	workspaces, e := s.workspaces(r.Context(), u.ID)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	out := map[string]any{"user": u, "workspaces": workspaces}
	if in.Client == "desktop" {
		out["token"] = token
	} else {
		http.SetCookie(w, &http.Cookie{Name: "blok_session", Value: token, Path: "/", HttpOnly: true, Secure: !s.Config.Development, SameSite: http.SameSiteLaxMode, MaxAge: 30 * 86400})
	}
	jsonOut(w, 200, out)
}
func (s *Service) getSession(w http.ResponseWriter, r *http.Request) {
	u, ok := s.require(w, r)
	if !ok {
		return
	}
	list, e := s.workspaces(r.Context(), u.ID)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	jsonOut(w, 200, map[string]any{"user": u.User, "workspaces": list})
}
func (s *Service) logout(w http.ResponseWriter, r *http.Request) {
	u, e := s.session(r)
	if e == nil {
		if _, e = s.DB.Exec(r.Context(), "DELETE FROM sessions WHERE id=$1", u.Session); e != nil {
			problem(w, 503, "Database unavailable")
			return
		}
	}
	s.recheckObserved(r.Context())
	http.SetCookie(w, &http.Cookie{Name: "blok_session", Value: "", Path: "/", HttpOnly: true, Secure: !s.Config.Development, SameSite: http.SameSiteLaxMode, MaxAge: -1})
	jsonOut(w, 200, map[string]bool{"ok": true})
}

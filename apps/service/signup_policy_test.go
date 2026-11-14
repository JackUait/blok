package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sync"
	"testing"
)

// signupWorld opens an invite-policy instance with a capturing mail sink.
func signupWorld(t *testing.T) (
	ctx context.Context,
	s *Service,
	request func(method, path string, payload any, status int) map[string]any,
	lock *sync.Mutex,
	codes map[string]string,
	delivered map[string]string,
) {
	t.Helper()
	ctx, _, open := permissionsFixture(t)
	lock = &sync.Mutex{}
	codes = map[string]string{}
	delivered = map[string]string{}
	s = open()
	s.Config.Deliver = func(to, subject, text string) error {
		lock.Lock()
		defer lock.Unlock()
		delivered[to] = text
		if m := regexp.MustCompile(`[0-9]{6}`).FindString(text); m != "" {
			codes[to] = m
		}
		return nil
	}
	// Fresh schema with no memberships keeps the strict invite default.
	if s.settings().SignupPolicy != "invite" {
		t.Fatalf("fixture signupPolicy = %q, want invite", s.settings().SignupPolicy)
	}
	server := httptest.NewServer(s.Handler())
	t.Cleanup(server.Close)
	request = func(method, path string, payload any, status int) map[string]any {
		t.Helper()
		var b io.Reader
		if payload != nil {
			encoded, _ := json.Marshal(payload)
			b = bytes.NewReader(encoded)
		}
		req, _ := http.NewRequest(method, server.URL+path, b)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", s.Config.PublicURL)
		resp, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != status {
			t.Fatalf("%s %s: got %d expected %d: %s", method, path, resp.StatusCode, status, body)
		}
		var out map[string]any
		_ = json.Unmarshal(body, &out)
		return out
	}
	return ctx, s, request, lock, codes, delivered
}

func countLoginCodes(t *testing.T, ctx context.Context, s *Service, email string) int {
	t.Helper()
	var n int
	if e := s.DB.QueryRow(ctx, `SELECT count(*) FROM login_codes WHERE email=$1`, email).Scan(&n); e != nil {
		t.Fatal(e)
	}
	return n
}

func emailRateCount(t *testing.T, ctx context.Context, s *Service, email string) int {
	t.Helper()
	var n int
	e := s.DB.QueryRow(ctx, `SELECT count FROM email_rate_limits WHERE key=$1`, "login-email:"+email).Scan(&n)
	if e != nil {
		return 0
	}
	return n
}

// Unknown address under invite ⇒ 200 AND no mail delivered AND no login_codes row.
func TestSignupPolicyInviteUnknownNoMailNoCode(t *testing.T) {
	ctx, s, request, lock, _, delivered := signupWorld(t)
	email := "stranger@example.test"

	out := request("POST", "/api/auth/request-code", map[string]any{"email": email}, 200)
	if out["ok"] != true {
		t.Fatalf("response = %v, want ok:true", out)
	}
	lock.Lock()
	_, mailed := delivered[email]
	lock.Unlock()
	if mailed {
		t.Fatal("invite policy delivered mail for an unknown address")
	}
	if countLoginCodes(t, ctx, s, email) != 0 {
		t.Fatal("invite policy wrote a login_codes row for an unknown address")
	}
}

// Policy flipped to invite while a code issued under open is still valid ⇒ 401.
func TestSignupPolicyFlipInvalidatesPendingCode(t *testing.T) {
	ctx, s, request, lock, codes, _ := signupWorld(t)
	email := "newbie@example.test"

	if _, e := s.applySettings(ctx, SettingsPatch{SignupPolicy: strPtr("open")}); e != nil {
		t.Fatal(e)
	}
	request("POST", "/api/auth/request-code", map[string]any{"email": email}, 200)
	lock.Lock()
	code := codes[email]
	lock.Unlock()
	if code == "" {
		t.Fatal("expected a login code under open policy")
	}

	if _, e := s.applySettings(ctx, SettingsPatch{SignupPolicy: strPtr("invite")}); e != nil {
		t.Fatal(e)
	}
	out := request("POST", "/api/auth/verify-code", map[string]any{"email": email, "code": code, "client": "desktop"}, 401)
	if out["error"] != "Invalid or expired code" {
		t.Fatalf("error = %v, want Invalid or expired code", out["error"])
	}
}

// Allowed and refused paths share the same per-email rate quota.
func TestSignupPolicyRateQuotaShared(t *testing.T) {
	ctx, s, request, lock, codes, _ := signupWorld(t)
	email := "quota@example.test"

	// Seven refuses under invite — each must bump the email rate counter.
	for i := 0; i < 7; i++ {
		request("POST", "/api/auth/request-code", map[string]any{"email": email}, 200)
	}
	if countLoginCodes(t, ctx, s, email) != 0 {
		t.Fatal("refused requests must not create login_codes")
	}
	if got := emailRateCount(t, ctx, s, email); got != 7 {
		t.Fatalf("after 7 refuses rate count = %d, want 7", got)
	}

	// Flip to open: the eighth attempt is allowed and still within the limit of 8.
	if _, e := s.applySettings(ctx, SettingsPatch{SignupPolicy: strPtr("open")}); e != nil {
		t.Fatal(e)
	}
	request("POST", "/api/auth/request-code", map[string]any{"email": email}, 200)
	lock.Lock()
	code := codes[email]
	lock.Unlock()
	if code == "" {
		t.Fatal("eighth (allowed) attempt should have delivered a code")
	}
	if got := emailRateCount(t, ctx, s, email); got != 8 {
		t.Fatalf("after mixed refuse+allow rate count = %d, want 8", got)
	}

	// Ninth attempt — whether allowed or not — hits the shared limit.
	request("POST", "/api/auth/request-code", map[string]any{"email": email}, 429)
}

// Existing accounts and pending invites still receive codes under invite policy.
func TestSignupPolicyInviteAllowsExistingAndPendingInvite(t *testing.T) {
	ctx, s, request, lock, codes, _ := signupWorld(t)

	if _, e := s.DB.Exec(ctx, `INSERT INTO users(id,email) VALUES($1,$2)`, opaque(), "member@example.test"); e != nil {
		t.Fatal(e)
	}
	wsID := opaque()
	if _, e := s.DB.Exec(ctx, `INSERT INTO workspaces(id,slug,name) VALUES($1,'equipe','Équipe')`, wsID); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DB.Exec(ctx, `INSERT INTO invites(id,workspace_id,email,role,expires_at) VALUES($1,$2,$3,'member',now()+interval '7 days')`, opaque(), wsID, "invited@example.test"); e != nil {
		t.Fatal(e)
	}

	request("POST", "/api/auth/request-code", map[string]any{"email": "member@example.test"}, 200)
	request("POST", "/api/auth/request-code", map[string]any{"email": "invited@example.test"}, 200)

	lock.Lock()
	memberCode := codes["member@example.test"]
	invitedCode := codes["invited@example.test"]
	lock.Unlock()
	if memberCode == "" {
		t.Fatal("existing account did not receive a code under invite policy")
	}
	if invitedCode == "" {
		t.Fatal("pending invite did not receive a code under invite policy")
	}
	if countLoginCodes(t, ctx, s, "member@example.test") != 1 {
		t.Fatal("expected login_codes row for existing account")
	}
	if countLoginCodes(t, ctx, s, "invited@example.test") != 1 {
		t.Fatal("expected login_codes row for pending invite")
	}
}

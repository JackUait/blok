package cloud

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type aiTestTransport func(*http.Request) (*http.Response, error)

func (f aiTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestAIEncryptionFileAndEnvironment(t *testing.T) {
	dir := t.TempDir()
	c := Config{DataDirectory: dir}
	a, e := loadAIEncryptionKey(c)
	if e != nil {
		t.Fatal(e)
	}
	b, e := loadAIEncryptionKey(c)
	if e != nil {
		t.Fatal(e)
	}
	s := &Service{aiCipher: a}
	encrypted, e := s.encryptAI("mock-private-key", "personal:owner")
	if e != nil {
		t.Fatal(e)
	}
	s.aiCipher = b
	if value, e := s.decryptAI(encrypted, "personal:owner"); e != nil || value != "mock-private-key" {
		t.Fatal("restart decryption failed")
	}
	if _, e = s.decryptAI(encrypted, "personal:someone-else"); e == nil {
		t.Fatal("ciphertext not bound to credential owner")
	}
	info, e := os.Stat(filepath.Join(dir, "ai-key"))
	if e != nil || info.Mode().Perm() != 0600 {
		t.Fatal("AI encryption key permissions are not0600")
	}
	if _, e = loadAIEncryptionKey(Config{AIEncryptionKey: "bad"}); e == nil {
		t.Fatal("invalid environment key accepted")
	}
	encoded := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{17}, 32))
	symlinkDir := t.TempDir()
	if e = os.Symlink(filepath.Join(dir, "ai-key"), filepath.Join(symlinkDir, "ai-key")); e != nil {
		t.Fatal(e)
	}
	if _, e = loadAIEncryptionKey(Config{DataDirectory: symlinkDir}); e == nil {
		t.Fatal("symlink AI key accepted")
	}
	if _, e = loadAIEncryptionKey(Config{AIEncryptionKey: encoded}); e != nil {
		t.Fatal(e)
	}
}
func TestAIIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL for real PostgreSQL integration test")
	}
	ctx := context.Background()
	db, e := pgxpool.New(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	schemaName := "ai_test_" + fmt.Sprint(time.Now().UnixNano())
	if _, e = db.Exec(ctx, "CREATE SCHEMA "+schemaName); e != nil {
		t.Fatal(e)
	}
	defer db.Exec(ctx, "DROP SCHEMA "+schemaName+" CASCADE")
	parsed, _ := url.Parse(dsn)
	q := parsed.Query()
	q.Set("search_path", schemaName)
	parsed.RawQuery = q.Encode()
	var mu sync.Mutex
	calls := []string{}
	lastPayload := map[string]any{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		mu.Lock()
		calls = append(calls, key)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if key == "mock-invalid-personal" {
			w.WriteHeader(401)
			io.WriteString(w, `{"error":{"message":"provider-secret-body-and-key"}}`)
			return
		}
		if key == "mock-incomplete-key" {
			json.NewEncoder(w).Encode(map[string]any{"status": "incomplete", "incomplete_details": map[string]string{"reason": "max_output_tokens"}})
			return
		}
		if key == "mock-limited-key" {
			w.WriteHeader(429)
			io.WriteString(w, `{"error":{"message":"provider-secret-quota"}}`)
			return
		}
		if r.URL.Path == "/v1/models" {
			io.WriteString(w, `{"data":[{"id":"gpt-z-test"},{"id":"gpt-a-test"},{"id":"gpt-a-test"},{"id":"gpt-image-1"},{"id":"text-embedding-3-small"},{"id":"o3-test"},{"id":"gpt-realtime"},{"id":"gpt-transcription-example"},{"id":"bad<script>"}]}`)
			return
		}
		if r.URL.Path != "/v1/responses" {
			t.Error("unexpected upstream path")
			w.WriteHeader(404)
			return
		}
		var payload map[string]any
		if e := json.NewDecoder(r.Body).Decode(&payload); e != nil {
			t.Error(e)
		}
		mu.Lock()
		lastPayload = payload
		mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"status": "completed", "model": payload["model"], "output": []any{map[string]any{"type": "reasoning", "content": []any{}}, map[string]any{"type": "message", "content": []any{map[string]any{"type": "output_text", "text": "Réponse de test"}}}}})
	}))
	defer upstream.Close()
	target, _ := url.Parse(upstream.URL)
	transport := aiTestTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Scheme != "https" || r.URL.Host != "api.openai.com" {
			t.Error("arbitrary provider endpoint allowed")
			return nil, fmt.Errorf("wrong endpoint")
		}
		clone := r.Clone(r.Context())
		copyURL := *r.URL
		copyURL.Scheme = target.Scheme
		copyURL.Host = target.Host
		clone.URL = &copyURL
		return http.DefaultTransport.RoundTrip(clone)
	})
	cfg := Config{DatabaseURL: parsed.String(), PublicURL: "http://localhost:8080", InternalURL: "http://localhost:8080", DataDirectory: t.TempDir(), AdminEmail: "admin@example.test", BootstrapWorkspaceSlug: "acme", BootstrapWorkspaceName: "Acme", Development: true, TicketSecret: strings.Repeat("t", 40), InternalSecret: strings.Repeat("i", 40), Deliver: func(string, string, string) error { return nil }, AITransport: transport}
	s, e := New(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	server := httptest.NewServer(s.Handler())
	defer server.Close()
	var wsID, adminID string
	if e = s.DB.QueryRow(ctx, "SELECT id FROM workspaces WHERE slug='acme'").Scan(&wsID); e != nil {
		t.Fatal(e)
	}
	if e = s.DB.QueryRow(ctx, "SELECT id FROM users WHERE email='admin@example.test'").Scan(&adminID); e != nil {
		t.Fatal(e)
	}
	// AdminEmail grants instance admin only; seed workspace membership for this suite.
	if _, e = s.DB.Exec(ctx, `INSERT INTO memberships VALUES($1,$2,'admin') ON CONFLICT DO NOTHING`, wsID, adminID); e != nil {
		t.Fatal(e)
	}
	if _, e = s.applySettings(ctx, SettingsPatch{WorkspaceCreation: strPtr("anyone")}); e != nil {
		t.Fatal(e)
	}
	newSession := func(uid string) string {
		token := opaque()
		if _, e = s.DB.Exec(ctx, "INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", hash(token), uid); e != nil {
			t.Fatal(e)
		}
		return token
	}
	admin := newSession(adminID)
	newUser := func(email, role string) (string, string) {
		id := opaque()
		if _, e = s.DB.Exec(ctx, "INSERT INTO users(id,email) VALUES($1,$2)", id, email); e != nil {
			t.Fatal(e)
		}
		if role != "" {
			if _, e = s.DB.Exec(ctx, "INSERT INTO memberships VALUES($1,$2,$3)", wsID, id, role); e != nil {
				t.Fatal(e)
			}
		}
		return id, newSession(id)
	}
	memberID, member := newUser("member@example.test", "member")
	_, viewer := newUser("viewer@example.test", "viewer")
	_, other := newUser("other@example.test", "")
	request := func(method, path, token string, payload any, status int) map[string]any {
		t.Helper()
		var body io.Reader
		if payload != nil {
			raw, _ := json.Marshal(payload)
			body = bytes.NewReader(raw)
		}
		req, _ := http.NewRequest(method, server.URL+path, body)
		req.Header.Set("Origin", cfg.PublicURL)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer resp.Body.Close()
		raw, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != status {
			t.Fatalf("%s %s status%d want%d: %s", method, path, resp.StatusCode, status, raw)
		}
		if bytes.Contains(raw, []byte("mock-workspace-key")) || bytes.Contains(raw, []byte("mock-personal-key")) || bytes.Contains(raw, []byte("provider-secret")) {
			t.Fatal("AI response exposed credentials or provider error")
		}
		var out map[string]any
		json.Unmarshal(raw, &out)
		return out
	}
	base := "/api/workspaces/acme/ai"
	request("GET", base, "", nil, 401)
	request("GET", base, other, nil, 403)
	config := request("GET", base, member, nil, 200)
	if config["canManageWorkspace"] != false || config["effective"].(map[string]any)["source"] != "none" {
		t.Fatal("initial AI configuration wrong")
	}
	request("PUT", base+"/credentials", member, map[string]any{"scope": "workspace", "apiKey": "mock-workspace-key"}, 403)
	request("PUT", base+"/credentials", admin, map[string]any{"scope": "workspace", "apiKey": "mock-workspace-key", "model": "gpt-shared-test"}, 200)
	config = request("GET", base, member, nil, 200)
	if config["effective"].(map[string]any)["source"] != "workspace" {
		t.Fatal("shared key not effective")
	}
	request("GET", base+"/models?scope=workspace", member, nil, 403)
	models := request("GET", base+"/models", member, nil, 200)["models"].([]any)
	if len(models) != 3 || models[0].(map[string]any)["id"] != "gpt-a-test" {
		t.Fatal("model catalog not filtered/sorted/deduplicated")
	}
	respond := map[string]any{"system": "Aide à rédiger.", "messages": []any{map[string]any{"role": "user", "content": "Bonjour"}}}
	out := request("POST", base+"/respond", member, respond, 200)
	if out["source"] != "workspace" || out["text"] != "Réponse de test" {
		t.Fatal("shared response wrong")
	}
	mu.Lock()
	payload := lastPayload
	mu.Unlock()
	if payload["store"] != false || payload["max_output_tokens"] != float64(aiMaxOutputTokens) {
		t.Fatal("OpenAI storage or token budget not bounded")
	}
	request("PUT", base+"/credentials", member, map[string]any{"scope": "personal", "apiKey": "mock-personal-key", "model": "gpt-personal-test"}, 200)
	request("PUT", base+"/credentials", member, map[string]any{"scope": "personal", "model": "gpt-personal-new"}, 200)
	out = request("POST", base+"/respond", member, respond, 200)
	if out["source"] != "personal" || out["model"] != "gpt-personal-new" {
		t.Fatal("personal precedence or model-only update wrong")
	}
	mu.Lock()
	lastKey := calls[len(calls)-1]
	mu.Unlock()
	if lastKey != "mock-personal-key" {
		t.Fatal("model-only update lost personal key")
	}
	config = request("GET", base, viewer, nil, 200)
	if config["personal"].(map[string]any)["configured"] != false || config["effective"].(map[string]any)["source"] != "workspace" {
		t.Fatal("personal key leaked across accounts")
	}
	var encrypted []byte
	if e = s.DB.QueryRow(ctx, "SELECT encrypted_key FROM ai_credentials WHERE scope='personal' AND owner_id=$1", memberID).Scan(&encrypted); e != nil {
		t.Fatal(e)
	}
	if bytes.Contains(encrypted, []byte("mock-personal-key")) {
		t.Fatal("plaintext API key stored in database")
	}
	if _, e = s.decryptAI(encrypted, "personal:"+adminID); e == nil {
		t.Fatal("encrypted credential could be moved to another account")
	}
	request("POST", "/api/workspaces", member, map[string]any{"slug": "second-space", "name": "Second"}, 201)
	otherConfig := request("GET", "/api/workspaces/second-space/ai", member, nil, 200)
	if otherConfig["effective"].(map[string]any)["source"] != "personal" || otherConfig["workspace"].(map[string]any)["configured"] != false {
		t.Fatal("personal account scope/shared workspace isolation wrong")
	}
	request("PUT", base+"/credentials", member, map[string]any{"scope": "personal", "apiKey": "mock-invalid-personal"}, 200)
	mu.Lock()
	before := len(calls)
	mu.Unlock()
	request("POST", base+"/respond", member, respond, 422)
	mu.Lock()
	delta := len(calls) - before
	lastKey = calls[len(calls)-1]
	mu.Unlock()
	if delta != 1 || lastKey != "mock-invalid-personal" {
		t.Fatal("invalid personal key fell back to paid shared key")
	}
	request("DELETE", base+"/credentials?scope=personal", member, nil, 200)
	out = request("POST", base+"/respond", member, respond, 200)
	if out["source"] != "workspace" {
		t.Fatal("deleting personal key did not restore shared selection")
	}
	request("DELETE", base+"/credentials?scope=workspace", member, nil, 403)
	request("DELETE", base+"/credentials?scope=workspace", admin, nil, 200)
	request("POST", base+"/respond", member, respond, 409)
	request("PUT", base+"/credentials", member, map[string]any{"scope": "personal", "model": "gpt-model-only"}, 200)
	config = request("GET", base, member, nil, 200)
	if config["personal"].(map[string]any)["configured"] != false || config["effective"].(map[string]any)["source"] != "none" {
		t.Fatal("model-only row treated as usable credential")
	}
	request("PUT", base+"/credentials", admin, map[string]any{"scope": "workspace", "apiKey": "mock-workspace-key", "model": "gpt-shared-test"}, 200)
	request("POST", base+"/respond", member, map[string]any{"messages": []any{map[string]any{"role": "system", "content": "bad role"}}}, 400)
	request("POST", base+"/respond", member, map[string]any{"messages": []any{map[string]any{"role": "user", "content": strings.Repeat("a", aiMaxInputBytes+1)}}}, 400)
	request("PUT", base+"/credentials", member, map[string]any{"scope": "personal", "apiKey": ""}, 400)
	request("PUT", base+"/credentials", member, map[string]any{"scope": "personal", "apiKey": "mock-incomplete-key", "model": "gpt-test"}, 200)
	incomplete := request("POST", base+"/respond", member, respond, 502)
	if !strings.Contains(incomplete["error"].(string), "limite de génération") {
		t.Fatal("incomplete token budget not explained")
	}
	request("DELETE", base+"/credentials?scope=personal", member, nil, 200)
	// A restart uses the persisted encryption key and existing credential state.
	server.Close()
	s.Close()
	restarted, e := New(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer restarted.Close()
	server = httptest.NewServer(restarted.Handler())
	defer server.Close()
	out = request("POST", base+"/respond", member, respond, 200)
	if out["source"] != "workspace" {
		t.Fatal("encrypted credential did not survive restart")
	}
	keyPath := filepath.Join(cfg.DataDirectory, "ai-key")
	if e = os.Rename(keyPath, keyPath+".backup"); e != nil {
		t.Fatal(e)
	}
	if lost, e := New(ctx, cfg); e == nil {
		lost.Close()
		t.Fatal("missing encryption key regenerated over encrypted credentials")
	}
	if e = os.Rename(keyPath+".backup", keyPath); e != nil {
		t.Fatal(e)
	}
	// Exhaustion is account-scoped, not bypassed by another bearer session.
	if _, e = restarted.DB.Exec(ctx, "UPDATE email_rate_limits SET count=30,window_start=now() WHERE key=$1", "ai:"+memberID); e != nil {
		t.Fatal(e)
	}
	request("POST", base+"/respond", member, respond, 429)
}
func TestAIUpstreamCancellationAndSanitizedFailure(t *testing.T) {
	cipher, e := loadAIEncryptionKey(Config{DataDirectory: t.TempDir()})
	if e != nil {
		t.Fatal(e)
	}
	s := &Service{aiCipher: cipher}
	encrypted, e := s.encryptAI("mock-cancellation-key", "personal:u")
	if e != nil {
		t.Fatal(e)
	}
	credential := aiCredential{Scope: "personal", Owner: "u", Encrypted: encrypted}
	s.aiClient = newAIClient(aiTestTransport(func(r *http.Request) (*http.Response, error) { <-r.Context().Done(); return nil, r.Context().Err() }))
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, status := s.aiUpstream(ctx, credential, "GET", "models", nil); status != 504 {
		t.Fatal("cancellation did not stop provider request")
	}
	s.aiClient = newAIClient(aiTestTransport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 429, Body: io.NopCloser(strings.NewReader(`{"error":"secret-provider-body"}`)), Header: make(http.Header)}, nil
	}))
	if raw, status := s.aiUpstream(context.Background(), credential, "GET", "models", nil); status != 429 || raw != nil {
		t.Fatal("provider error body not discarded")
	}
}

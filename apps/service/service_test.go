package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"golang.org/x/net/websocket"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestConfigFailsClosed(t *testing.T) {
	c := Config{DatabaseURL: "postgres://unused", PublicURL: "https://example.test", TicketSecret: strings.Repeat("t", 32), InternalSecret: strings.Repeat("i", 32)}
	if c.validate() == nil {
		t.Fatal("missing mail must fail startup")
	}
	c.DevelopmentMailDirectory = t.TempDir()
	if c.validate() == nil {
		t.Fatal("production mail sink permitted")
	}
	c.Development = true
	if e := c.validate(); e != nil {
		t.Fatal(e)
	}
}
func TestCloudIntegration(t *testing.T) {
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("set TEST_DATABASE_URL for real PostgreSQL integration test")
	}
	ctx := context.Background()
	adminDB, e := pgxpool.New(ctx, raw)
	if e != nil {
		t.Fatal(e)
	}
	defer adminDB.Close()
	schemaName := "cloud_test_" + fmt.Sprint(time.Now().UnixNano())
	if _, e = adminDB.Exec(ctx, "CREATE SCHEMA "+schemaName); e != nil {
		t.Fatal(e)
	}
	defer adminDB.Exec(ctx, "DROP SCHEMA "+schemaName+" CASCADE")
	parsed, e := url.Parse(raw)
	if e != nil {
		t.Fatal(e)
	}
	q := parsed.Query()
	q.Set("search_path", schemaName)
	parsed.RawQuery = q.Encode()
	var lock sync.Mutex
	codes := map[string]string{}
	deliveredMessages := map[string]string{}
	deliver := func(to, subject, text string) error {
		lock.Lock()
		deliveredMessages[to] = text
		lock.Unlock()
		if m := regexp.MustCompile(`[0-9]{6}`).FindString(text); m != "" {
			lock.Lock()
			codes[to] = m
			lock.Unlock()
		}
		return nil
	}
	cfg := Config{DatabaseURL: parsed.String(), PublicURL: "http://localhost:8080", InternalURL: "http://localhost:8080", DataDirectory: t.TempDir(), AdminEmail: "admin@example.test", Development: true, TicketSecret: strings.Repeat("t", 40), InternalSecret: strings.Repeat("i", 40), Deliver: deliver}
	server := httptest.NewUnstartedServer(nil)
	cfg.InternalURL = "http://" + server.Listener.Addr().String()
	s, e := New(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	server.Config.Handler = s.Handler()
	server.Start()
	defer server.Close()
	defer func() {
		drain, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if e := s.Drain(drain); e != nil {
			t.Errorf("drain: %v", e)
		}
	}()

	request := func(method, path, token string, payload any, status int) map[string]any {
		t.Helper()
		var b io.Reader
		if payload != nil {
			encoded, _ := json.Marshal(payload)
			b = bytes.NewReader(encoded)
		}
		req, _ := http.NewRequest(method, server.URL+path, b)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", cfg.PublicURL)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
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
		json.Unmarshal(body, &out)
		return out
	}
	login := func(email string) string {
		t.Helper()
		request("POST", "/api/auth/request-code", "", map[string]any{"email": email}, 200)
		lock.Lock()
		code := codes[email]
		lock.Unlock()
		if code == "" {
			t.Fatal("missing test code")
		}
		out := request("POST", "/api/auth/verify-code", "", map[string]any{"email": email, "code": code, "client": "desktop"}, 200)
		return out["token"].(string)
	}
	public := request("GET", "/api/workspaces/tousambassadeurs", "", nil, 200)
	if public["role"] != nil {
		t.Fatal("anonymous role leaked")
	}
	request("GET", "/api/workspaces/tousambassadeurs/index", "", nil, 401)
	admin := login("admin@example.test")
	applicant := login("applicant@example.test")
	other := login("other@example.test")
	viewer := login("viewer@example.test")
	request("GET", "/api/workspaces/tousambassadeurs/index", applicant, nil, 403)
	request("POST", "/api/workspaces/tousambassadeurs/join-requests", applicant, map[string]string{"message": "Please approve"}, 200)
	requests := request("GET", "/api/workspaces/tousambassadeurs/join-requests", admin, nil, 200)["requests"].([]any)
	rid := requests[0].(map[string]any)["id"].(string)
	request("POST", "/api/workspaces/tousambassadeurs/join-requests/"+rid+"/approve", applicant, map[string]any{}, 403)
	request("POST", "/api/workspaces/tousambassadeurs/join-requests/"+rid+"/approve", admin, map[string]any{}, 200)
	note := "Bienvenue dans l’équipe !\nNous avons hâte de collaborer."
	request("POST", "/api/workspaces/tousambassadeurs/invites", admin, map[string]any{"email": "invited@example.test", "role": "viewer", "message": note}, 201)
	lock.Lock()
	invitationBody := deliveredMessages["invited@example.test"]
	lock.Unlock()
	if !strings.Contains(invitationBody, note) {
		t.Fatal("Invitation delivery omitted the optional note")
	}
	request("POST", "/api/workspaces/tousambassadeurs/invites", admin, map[string]any{"email": "long-note@example.test", "message": strings.Repeat("é", 2001)}, 400)
	request("POST", "/api/workspaces/tousambassadeurs/invites", admin, map[string]any{"email": "wrong-note@example.test", "message": []string{"invalid"}}, 400)
	lock.Lock()
	_, longDelivered := deliveredMessages["long-note@example.test"]
	_, wrongDelivered := deliveredMessages["wrong-note@example.test"]
	lock.Unlock()
	if longDelivered || wrongDelivered {
		t.Fatal("Invalid invitation note was delivered")
	}
	request("POST", "/api/workspaces/tousambassadeurs/invites", admin, map[string]any{"email": "boundary-note@example.test", "message": strings.Repeat("é", 2000)}, 201)
	invited := login("invited@example.test")
	request("GET", "/api/workspaces/tousambassadeurs/index", invited, nil, 200)
	request("POST", "/api/workspaces/tousambassadeurs/join-requests", viewer, map[string]any{}, 200)
	requests = request("GET", "/api/workspaces/tousambassadeurs/join-requests", admin, nil, 200)["requests"].([]any)
	for _, v := range requests {
		r := v.(map[string]any)
		if r["email"] == "viewer@example.test" {
			request("POST", "/api/workspaces/tousambassadeurs/join-requests/"+r["id"].(string)+"/approve", admin, map[string]any{"role": "viewer"}, 200)
		}
	}
	page := map[string]any{"id": "test-page-1", "title": "Title", "parentId": nil, "cover": "ocean", "titleDate": "2026-11-12", "fullWidth": true}
	index := map[string]any{"pages": []any{page}, "trash": []any{}, "revision": 0}
	request("PUT", "/api/workspaces/tousambassadeurs/index", viewer, index, 403)
	// Untrusted indexes cannot poison navigation or escape workspace ownership.
	request("PUT", "/api/workspaces/tousambassadeurs/index", applicant, map[string]any{"pages": []any{map[string]any{"id": "cycle-a", "title": "a", "parentId": "cycle-b"}, map[string]any{"id": "cycle-b", "title": "b", "parentId": "cycle-a"}}, "revision": 0}, 400)
	request("PUT", "/api/workspaces/tousambassadeurs/index", applicant, map[string]any{"pages": []any{page, page}, "revision": 0}, 400)
	request("PUT", "/api/workspaces/tousambassadeurs/index", applicant, map[string]any{"pages": []any{map[string]any{"id": "../escape", "title": "a", "parentId": nil}}, "revision": 0}, 400)
	request("PUT", "/api/workspaces/tousambassadeurs/index", applicant, map[string]any{"pages": []any{map[string]any{"id": "bad-type", "title": "a", "parentId": nil, "fullWidth": []any{}}}, "revision": 0}, 400)
	request("PUT", "/api/workspaces/tousambassadeurs/index", applicant, index, 200)
	request("POST", "/api/workspaces", other, map[string]any{"name": "Other", "slug": "other-workspace"}, 201)
	request("PUT", "/api/workspaces/other-workspace/index", other, index, 409)
	request("GET", "/api/workspaces/other-workspace/pages/test-page-1", other, nil, 404)

	request("PUT", "/api/workspaces/tousambassadeurs/index", admin, index, 409)
	loaded := request("GET", "/api/workspaces/tousambassadeurs/index", viewer, nil, 200)
	if loaded["pages"].([]any)[0].(map[string]any)["titleDate"] != "2026-11-12" {
		t.Fatal("page metadata lost")
	}
	request("GET", "/api/workspaces/tousambassadeurs/pages/test-page-1", other, nil, 403)
	readTicket := request("GET", "/api/blok-ticket?doc=test-page-1", viewer, nil, 200)["ticket"].(string)
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Sec-WebSocket-Protocol", "blok-sync.v2, "+readTicket)
	session, doc, write, ok := s.ticketIdentity(req)
	if !ok || write || doc != "test-page-1" || session != hash(viewer) {
		t.Fatal("WebSocket ticket parsing wrong")
	}
	can, e := s.authorizeDoc(ctx, hash(applicant), "test-page-1", true)
	if e != nil || !can {
		t.Fatal("member authorization failed", e)
	}
	can, e = s.authorizeDoc(ctx, hash(viewer), "test-page-1", true)
	if e != nil || can {
		t.Fatal("viewer can write")
	}
	// Internal route never accepts a user's session; a known empty doc is 200 null.
	request("GET", "/internal/documents/test-page-1", admin, nil, 401)
	empty := request("GET", "/internal/documents/test-page-1", cfg.InternalSecret, nil, 200)
	if empty["data"] != nil {
		t.Fatal("empty document not null")
	}
	request("PUT", "/internal/documents/test-page-1", cfg.InternalSecret, map[string]any{"blocks": []any{map[string]any{"id": "p", "type": "paragraph", "data": map[string]any{"text": "durable"}}}}, 200)
	docState := request("GET", "/api/workspaces/tousambassadeurs/pages/test-page-1", applicant, nil, 200)
	if len(docState["blocks"].([]any)) != 1 {
		t.Fatal("projection missing")
	}
	// The real Blok room loads from PostgreSQL; duplicate snapshots the live room.
	request("GET", "/api/blok/sync/test-page-1/state", readTicket, nil, 200)
	duplicate := request("POST", "/api/workspaces/tousambassadeurs/pages/test-page-1/duplicate", admin, map[string]any{"id": "duplicate-page", "title": "Copy", "parentId": nil}, 201)
	if duplicate["id"] != "duplicate-page" {
		t.Fatal("duplicate response wrong")
	}
	copied := request("GET", "/api/workspaces/tousambassadeurs/pages/duplicate-page", admin, nil, 200)
	if len(copied["blocks"].([]any)) != 1 {
		t.Fatal("live duplicate lost content")
	}
	// Seed is allowed only before admission, never after a room may exist.
	request("PUT", "/api/workspaces/tousambassadeurs/index", admin, map[string]any{"pages": []any{page, map[string]any{"id": "duplicate-page", "title": "Copy", "parentId": nil}, map[string]any{"id": "seed-page", "title": "Seed", "parentId": nil}}, "trash": []any{}, "revision": 2}, 200)
	request("POST", "/api/workspaces/tousambassadeurs/pages/seed-page/seed", admin, map[string]any{"document": map[string]any{"blocks": []any{}}}, 200)
	request("POST", "/api/workspaces/tousambassadeurs/pages/seed-page/seed", admin, map[string]any{"document": map[string]any{"blocks": []any{}}}, 409)
	request("GET", "/api/blok-ticket?doc=seed-page", admin, nil, 200)
	request("POST", "/api/workspaces/tousambassadeurs/pages/seed-page/seed", admin, map[string]any{"document": map[string]any{"blocks": []any{}}}, 409)
	// Private assets check workspace membership and session revocation even with signed grants.
	if e = os.WriteFile(cfg.DataDirectory+"/uploads/0123456789abcdef0123456789abcdef.txt", []byte("private asset"), 0600); e != nil {
		t.Fatal(e)
	}
	if _, e = s.DB.Exec(ctx, "INSERT INTO assets VALUES('0123456789abcdef0123456789abcdef.txt',$1,'test-page-1',now())", public["id"]); e != nil {
		t.Fatal(e)
	}
	request("GET", "/api/assets/url?url=/files/0123456789abcdef0123456789abcdef.txt", other, nil, 403)
	asset := request("GET", "/api/assets/url?url=/files/0123456789abcdef0123456789abcdef.txt", applicant, nil, 200)["url"].(string)
	assetParsed, _ := url.Parse(asset)
	assetReq, _ := http.NewRequest("GET", server.URL+assetParsed.RequestURI(), nil)
	resp, e := http.DefaultClient.Do(assetReq)
	if e != nil {
		t.Fatal(e)
	}
	rawAsset, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || string(rawAsset) != "private asset" {
		t.Fatalf("private asset failed %d %s", resp.StatusCode, rawAsset)
	}
	openSocket := func(token string) *websocket.Conn {
		t.Helper()
		pass := request("GET", "/api/blok-ticket?doc=test-page-1", token, nil, 200)["ticket"].(string)
		wc, e := websocket.NewConfig(strings.Replace(server.URL, "http://", "ws://", 1)+"/api/blok/sync/test-page-1", cfg.PublicURL)
		if e != nil {
			t.Fatal(e)
		}
		wc.Protocol = []string{"blok-sync.v2", pass}
		conn, e := websocket.DialConfig(wc)
		if e != nil {
			t.Fatal("WebSocket dial", e)
		}
		conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		var initial []byte
		if e = websocket.Message.Receive(conn, &initial); e != nil {
			t.Fatal("initial room frame", e)
		}
		return conn
	}
	assertClosed := func(conn *websocket.Conn) {
		t.Helper()
		defer conn.Close()
		conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		for {
			var frame []byte
			e := websocket.Message.Receive(conn, &frame)
			if e != nil {
				if n, ok := e.(net.Error); ok && n.Timeout() {
					t.Fatal("revoked socket remained open")
				}
				return
			}
		}
	}
	writingSocket := openSocket(applicant)
	// Last admin protected, role changes remove writes immediately.
	members := request("GET", "/api/workspaces/tousambassadeurs/members", admin, nil, 200)["members"].([]any)
	var adminID, applicantID string
	for _, m := range members {
		v := m.(map[string]any)
		if v["email"] == "admin@example.test" {
			adminID = v["id"].(string)
		}
		if v["email"] == "applicant@example.test" {
			applicantID = v["id"].(string)
		}
	}
	request("DELETE", "/api/workspaces/tousambassadeurs/members/"+adminID, admin, nil, 409)
	request("PATCH", "/api/workspaces/tousambassadeurs/members/"+applicantID, admin, map[string]any{"role": "viewer"}, 200)
	assertClosed(writingSocket)
	can, _ = s.authorizeDoc(ctx, hash(applicant), "test-page-1", true)
	if can {
		t.Fatal("role downgrade did not revoke existing ticket writes")
	}
	logoutSocket := openSocket(applicant)
	request("POST", "/api/auth/logout", applicant, map[string]any{}, 200)
	assertClosed(logoutSocket)
	request("GET", "/api/session", applicant, nil, 401)
	can, _ = s.authorizeDoc(ctx, hash(applicant), "test-page-1", false)
	if can {
		t.Fatal("logged out ticket still valid")
	}
	resp, e = http.DefaultClient.Do(assetReq)
	if e != nil {
		t.Fatal(e)
	}
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatal("signed grant survives revoked session", resp.StatusCode)
	}
	// Expiry sweep closes an already admitted socket without another HTTP request.
	expiredSocket := openSocket(invited)
	if _, e = s.DB.Exec(ctx, "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=$1", hash(invited)); e != nil {
		t.Fatal(e)
	}
	s.recheckObserved(ctx)
	assertClosed(expiredSocket)
	// Login OTP consumed once and brute-force attempts bounded.
	lock.Lock()
	consumed := codes["admin@example.test"]
	lock.Unlock()
	request("POST", "/api/auth/verify-code", "", map[string]any{"email": "admin@example.test", "code": consumed}, 401)
	request("POST", "/api/auth/request-code", "", map[string]any{"email": "brute@example.test"}, 200)
	for i := 0; i < 5; i++ {
		request("POST", "/api/auth/verify-code", "", map[string]any{"email": "brute@example.test", "code": "abcdef"}, 401)
	}
	lock.Lock()
	valid := codes["brute@example.test"]
	lock.Unlock()
	request("POST", "/api/auth/verify-code", "", map[string]any{"email": "brute@example.test", "code": valid}, 401)
	// Tombstoning closes live access, but retained internal projections must
	// still flush; otherwise a normal deletion would break graceful shutdown.
	tombstoneSocket := openSocket(admin)
	request("PUT", "/api/workspaces/tousambassadeurs/index", admin, map[string]any{"pages": []any{map[string]any{"id": "duplicate-page", "title": "Copy", "parentId": nil}, map[string]any{"id": "seed-page", "title": "Seed", "parentId": nil}}, "trash": []any{}, "revision": 3}, 200)
	assertClosed(tombstoneSocket)
	request("GET", "/api/blok-ticket?doc=test-page-1", admin, nil, 403)
	request("GET", "/api/workspaces/tousambassadeurs/pages/test-page-1", admin, nil, 404)
	request("GET", "/internal/documents/test-page-1", cfg.InternalSecret, nil, 200)
	request("PUT", "/internal/documents/test-page-1", cfg.InternalSecret, map[string]any{"blocks": []any{}}, 200)
	// Hosted MCP uses each caller's own bearer session and workspace role.
	mcpCall := func(token, name string, args map[string]any, status int) map[string]any {
		t.Helper()
		payload, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": name, "arguments": args}})
		req, _ := http.NewRequest("POST", server.URL+"/mcp", bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json, text/event-stream")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		data, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != status {
			t.Fatalf("MCP %s: %d expected %d: %s", name, resp.StatusCode, status, data)
		}
		if bytes.HasPrefix(data, []byte("event: message\n")) {
			line := strings.SplitN(string(data), "data: ", 2)
			if len(line) != 2 {
				t.Fatalf("invalid MCP event: %s", data)
			}
			data = []byte(strings.SplitN(line[1], "\n", 2)[0])
		}
		var out map[string]any
		if status == 200 && json.Unmarshal(data, &out) != nil {
			t.Fatalf("invalid MCP response: %s", data)
		}
		return out
	}
	mcpCall("", "blok_list_workspaces", map[string]any{}, 401)
	created := mcpCall(admin, "blok_create_page", map[string]any{"workspace": "tousambassadeurs", "title": "Created through MCP"}, 200)
	if created["error"] != nil || created["result"].(map[string]any)["isError"] == true {
		t.Fatal("MCP create failed", created)
	}
	var pageCreated struct {
		ID string `json:"id"`
	}
	content := created["result"].(map[string]any)["content"].([]any)[0].(map[string]any)["text"].(string)
	if json.Unmarshal([]byte(content), &pageCreated) != nil || pageCreated.ID == "" {
		t.Fatal("MCP missing created page", created)
	}
	opened := mcpCall(admin, "blok_open", map[string]any{"documentId": pageCreated.ID, "write": true}, 200)
	if opened["error"] != nil || opened["result"].(map[string]any)["isError"] == true {
		t.Fatal("MCP could not open created page", opened)
	}
	mcpCall(admin, "blok_list_pages", map[string]any{"workspace": "tousambassadeurs"}, 200)
	denied := mcpCall(other, "blok_create_page", map[string]any{"workspace": "tousambassadeurs", "title": "Forbidden"}, 200)
	if denied["result"].(map[string]any)["isError"] != true {
		t.Fatal("MCP non-member created page", denied)
	}
	mcpCall(applicant, "blok_list_workspaces", map[string]any{}, 401)
	// A second service run must not restore an intentionally downgraded bootstrap admin.
	if _, e = s.DB.Exec(ctx, "UPDATE memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2", public["id"], adminID); e != nil {
		t.Fatal(e)
	}
	denied = mcpCall(admin, "blok_create_page", map[string]any{"workspace": "tousambassadeurs", "title": "Viewer cannot write"}, 200)
	if denied["result"].(map[string]any)["isError"] != true {
		t.Fatal("MCP viewer created page", denied)
	}
	second, e := New(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	second.Close()
	var role string
	if e = s.DB.QueryRow(ctx, "SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2", public["id"], adminID).Scan(&role); e != nil || role != "viewer" {
		t.Fatal("bootstrap re-promoted admin", e)
	}
}

func TestTrustedProxyClientIP(t *testing.T) {
	s := &Service{Config: Config{TrustedProxyCIDRs: []string{"172.30.87.3/32"}}}
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "172.30.87.3:1234"
	r.Header.Set("X-Forwarded-For", "6.6.6.6, 203.0.113.7")
	if actual := s.clientIP(r); actual != "203.0.113.7" {
		t.Fatal("wrong trusted client", actual)
	}
	r.RemoteAddr = "203.0.113.9:1234"
	if actual := s.clientIP(r); actual != "203.0.113.9" {
		t.Fatal("accepted spoofed forwarded IP", actual)
	}
	r.RemoteAddr = "172.30.87.3:1234"
	r.Header.Set("X-Forwarded-For", "malformed")
	if actual := s.clientIP(r); actual != "172.30.87.3" {
		t.Fatal("malformed forwarded header accepted", actual)
	}
}

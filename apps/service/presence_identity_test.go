package cloud

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	blokserver "github.com/JackUait/blok/packages/server/go/v2/blokserver"
	"github.com/JackUait/blok/packages/server/go/v2/blokserver/ticket"
	"golang.org/x/net/websocket"
)

// Two independent logins must be one person, while logout still revokes only
// the corresponding session. Exercise the real signed tickets and room frames.
func TestPresenceUsesAccountAcrossSessions(t *testing.T) {
	w := newReadsWorld(t)
	const otherAlice = "alice-another-browser"
	if _, err := w.service.DB.Exec(w.ctx, `INSERT INTO sessions(id,user_id,expires_at) VALUES($1,'alice',now()+interval '1 day')`, hash(otherAlice)); err != nil {
		t.Fatal(err)
	}
	stateStatus := func(pass string) int {
		t.Helper()
		req, _ := http.NewRequest("GET", w.server.URL+"/api/blok/sync/public/state", nil)
		req.Header.Set("Authorization", "Bearer "+pass)
		req.Header.Set("Origin", w.service.Config.PublicURL)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		return resp.StatusCode
	}
	tickets := make(map[string]string)
	for token, account := range map[string]string{tokenAlice: "alice", otherAlice: "alice", tokenBob: "bob"} {
		status, payload := w.get(t, token, "/api/blok-ticket?doc=public")
		pass, ok := payload["ticket"].(string)
		if status != http.StatusOK || !ok {
			t.Fatalf("ticket request failed: %d", status)
		}
		tickets[token] = pass
		parts := strings.Split(pass, ".")
		if len(parts) != 3 {
			t.Fatal("invalid ticket format")
		}
		raw, err := base64.RawURLEncoding.DecodeString(parts[1])
		if err != nil {
			t.Fatal(err)
		}
		var claims struct {
			User string `json:"user"`
		}
		if err = json.Unmarshal(raw, &claims); err != nil {
			t.Fatal(err)
		}
		if claims.User != account {
			t.Errorf("presence actor must be the account, not a login session (account %s)", account)
		}
		if status = stateStatus(pass); status != http.StatusOK {
			t.Fatalf("ticket cannot read document: %d", status)
		}
	}
	// Old tickets keep working during their short expiry window.
	doc := "public"
	legacy, err := ticket.Mint(w.service.Config.TicketSecret, ticket.Claims{User: hash(tokenAlice), Doc: &doc, Write: true}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if status := stateStatus(legacy); status != http.StatusOK {
		t.Fatalf("legacy ticket status: %d", status)
	}

	// The request-scoped session must never authorize a different actor or doc.
	w.page(t, "other-public", "", visWorkspace)
	bound := httptest.NewRequest("GET", "/api/blok/sync/public/state", nil)
	bound.Header.Set("Authorization", "Bearer "+tickets[tokenAlice])
	called := false
	w.service.blokHandler(http.HandlerFunc(func(wr http.ResponseWriter, r *http.Request) {
		called = true
		for _, check := range []struct {
			actor, doc string
			want       bool
		}{
			{"alice", "public", true}, {"bob", "public", false}, {"alice", "other-public", false},
		} {
			can, err := w.service.CanReadDocument(r.Context(), blokserver.User{ID: check.actor}, check.doc)
			if err != nil || can != check.want {
				t.Errorf("request session escaped actor/document binding: %s/%s: %v %v", check.actor, check.doc, can, err)
			}
		}
	})).ServeHTTP(httptest.NewRecorder(), bound)
	if !called {
		t.Fatal("valid ticket did not reach bound handler")
	}

	open := func(token string, clientID byte) *websocket.Conn {
		t.Helper()
		cfg, err := websocket.NewConfig(strings.Replace(w.server.URL, "http://", "ws://", 1)+"/api/blok/sync/public", w.service.Config.PublicURL)
		if err != nil {
			t.Fatal(err)
		}
		cfg.Protocol = []string{"blok-sync.v2", tickets[token]}
		conn, err := websocket.DialConfig(cfg)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { conn.Close() })
		// y-protocols awareness: one client, clock 1, empty JSON state.
		if err = websocket.Message.Send(conn, []byte{1, 6, 1, clientID, 1, 2, '{', '}'}); err != nil {
			t.Fatal(err)
		}
		return conn
	}
	first := open(tokenAlice, 11)
	second := open(otherAlice, 12)
	bob := open(tokenBob, 13)
	readIdentities := func(conn *websocket.Conn, clients ...uint64) map[uint64]string {
		t.Helper()
		conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		for {
			var frame []byte
			if err := websocket.Message.Receive(conn, &frame); err != nil {
				t.Fatal(err)
			}
			r := bytes.NewReader(frame)
			kind, err := binary.ReadUvarint(r)
			if err != nil || kind != 107 {
				continue
			}
			size, err := binary.ReadUvarint(r)
			if err != nil || size != uint64(r.Len()) {
				t.Fatal("invalid identities frame")
			}
			raw, _ := io.ReadAll(r)
			var payload struct {
				Identities []struct {
					ClientID uint64 `json:"clientId"`
					ActorID  string `json:"actorId"`
				} `json:"identities"`
			}
			if err = json.Unmarshal(raw, &payload); err != nil {
				t.Fatal(err)
			}
			if len(payload.Identities) != len(clients) {
				continue
			}
			result := make(map[uint64]string)
			for _, identity := range payload.Identities {
				result[identity.ClientID] = identity.ActorID
			}
			matches := true
			for _, id := range clients {
				if _, ok := result[id]; !ok {
					matches = false
				}
			}
			if matches {
				return result
			}
		}
	}
	actors := readIdentities(bob, 11, 12, 13)
	if actors[11] != "alice" || actors[12] != "alice" || actors[13] != "bob" {
		t.Error("verified presence must group both Alice sessions and keep Bob separate")
	}
	// Logout rechecks already admitted sockets, not just the next HTTP request.
	req, _ := http.NewRequest("POST", w.server.URL+"/api/auth/logout", nil)
	req.Header.Set("Authorization", "Bearer "+tokenAlice)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("logout: %d", resp.StatusCode)
	}
	first.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		var frame []byte
		if err = websocket.Message.Receive(first, &frame); err != nil {
			if n, ok := err.(net.Error); ok && n.Timeout() {
				t.Fatal("logged-out socket stayed open")
			}
			break
		}
	}
	remaining := readIdentities(second, 12, 13)
	if remaining[12] != "alice" || remaining[13] != "bob" {
		t.Error("logout affected the wrong presence identities")
	}
	if status := stateStatus(tickets[tokenAlice]); status != http.StatusForbidden {
		t.Fatalf("revoked session status: %d", status)
	}
	if status := stateStatus(tickets[otherAlice]); status != http.StatusOK {
		t.Fatalf("other session was revoked: %d", status)
	}
}

func TestDocumentTicketRejectsSessionTampering(t *testing.T) {
	s := &Service{Config: Config{TicketSecret: strings.Repeat("s", 40)}}
	pass, err := s.mintSessionTicket(identity{User: User{ID: "alice"}, Session: "alice-session"}, "page", true)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(pass, ".")
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, session string
		resign        bool
	}{
		{"altered session", `"bob-session"`, false},
		{"removed session", "", false},
		{"empty session", `""`, true},
		{"null session", "null", true},
		{"numeric session", "12", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var claims map[string]json.RawMessage
			if err := json.Unmarshal(payload, &claims); err != nil {
				t.Fatal(err)
			}
			if tc.session == "" {
				delete(claims, "session")
			} else {
				claims["session"] = json.RawMessage(tc.session)
			}
			raw, err := json.Marshal(claims)
			if err != nil {
				t.Fatal(err)
			}
			input := parts[0] + "." + base64.RawURLEncoding.EncodeToString(raw)
			signature := parts[2]
			if tc.resign {
				mac := hmac.New(sha256.New, []byte(s.Config.TicketSecret))
				mac.Write([]byte(input))
				signature = base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
			}
			req := httptest.NewRequest("GET", "/api/blok/sync/page/state", nil)
			req.Header.Set("Authorization", "Bearer "+input+"."+signature)
			rec := httptest.NewRecorder()
			s.blokHandler(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("invalid ticket reached backend") })).ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("invalid session ticket status: %d", rec.Code)
			}
		})
	}
}

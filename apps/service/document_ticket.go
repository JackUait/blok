package cloud

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/blokserver/ticket"
)

type documentTicketKey struct{}

type documentTicketIdentity struct {
	actor, session, doc string
	write               bool
}

// Presence identifies an account, while authorization remains tied to the
// individual login. Never put the long-lived bearer token in a document ticket.
func (s *Service) mintSessionTicket(u identity, doc string, write bool) (string, error) {
	if u.ID == "" || u.Session == "" {
		return "", errors.New("a document ticket requires an account and session")
	}
	ttl := int64(60)
	pass, err := ticket.Mint(s.Config.TicketSecret, ticket.Claims{User: u.ID, Doc: &doc, Write: write, TTLSeconds: &ttl}, time.Now())
	if err != nil {
		return "", err
	}
	parts := strings.Split(pass, ".")
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", err
	}
	var claims map[string]json.RawMessage
	if err = json.Unmarshal(raw, &claims); err != nil {
		return "", err
	}
	claims["session"], err = json.Marshal(u.Session)
	if err != nil {
		return "", err
	}
	raw, err = json.Marshal(claims)
	if err != nil {
		return "", err
	}
	input := parts[0] + "." + base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, []byte(s.Config.TicketSecret))
	mac.Write([]byte(input))
	return input + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func (s *Service) documentTicket(r *http.Request) (out documentTicketIdentity, ok bool) {
	raw := r.URL.Query().Get("ticket")
	if raw == "" {
		raw = r.Header.Get("X-Blok-Ticket")
	}
	if raw == "" {
		raw = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	}
	if raw == "" {
		for _, p := range strings.Split(r.Header.Get("Sec-WebSocket-Protocol"), ",") {
			p = strings.TrimSpace(p)
			if len(strings.Split(p, ".")) == 3 {
				raw = p
				break
			}
		}
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return
	}
	mac := hmac.New(sha256.New, []byte(s.Config.TicketSecret))
	mac.Write([]byte(parts[0] + "." + parts[1]))
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(sig, mac.Sum(nil)) {
		return
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return
	}
	var claims struct {
		User    string          `json:"user"`
		Session json.RawMessage `json:"session"`
		Doc     string          `json:"doc"`
		Write   bool            `json:"write"`
		Exp     int64           `json:"exp"`
	}
	if json.Unmarshal(payload, &claims) != nil || claims.Exp <= time.Now().Unix() || claims.User == "" {
		return
	}
	// Tickets issued before the account/session split expire within a minute.
	session := claims.User
	if len(claims.Session) != 0 {
		session = ""
		if json.Unmarshal(claims.Session, &session) != nil || session == "" {
			return
		}
	}
	return documentTicketIdentity{actor: claims.User, session: session, doc: claims.Doc, write: claims.Write}, true
}

func (s *Service) ticketIdentity(r *http.Request) (session, doc string, write bool, ok bool) {
	claims, ok := s.documentTicket(r)
	return claims.session, claims.doc, claims.write, ok
}

func documentSession(ctx context.Context, actor, doc string) string {
	if claims, ok := ctx.Value(documentTicketKey{}).(documentTicketIdentity); ok {
		if claims.actor != actor || claims.doc != doc {
			return ""
		}
		return claims.session
	}
	// Existing internal callers and old tickets use the session as the user ID.
	return actor
}

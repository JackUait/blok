package blokmcp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/blokserver/ticket"
)

const (
	// ticketTTLSeconds is the ceiling a collaboration pass should have; it is
	// checked at the handshake only.
	ticketTTLSeconds   = 1800
	ticketFetchTimeout = 10 * time.Second
	roomSyncTimeout    = 15 * time.Second
	roomRetryEvery     = time.Second
	syncSubprotocolV2  = "blok-sync.v2"
	syncSubprotocolV1  = "blok-sync.v1"
)

// syncURLFor is Node's syncUrlFor: "", "." and ".." would name another
// route.
func syncURLFor(base, documentID string) (string, error) {
	return urlFor(base, documentID)
}

type ticketRequest struct {
	Doc        string `json:"doc"`
	Write      bool   `json:"write"`
	Principal  string `json:"principal"`
	ClientName string `json:"clientName"`
	ActorID    string `json:"actorId"`
}

// readTicketClaims decodes a pass's payload as UTF-8 JSON; nil when it
// cannot.
func readTicketClaims(token string) map[string]any {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return nil
	}
	payload := strings.NewReplacer("-", "+", "_", "/").Replace(parts[1])
	payload = strings.Map(func(r rune) rune {
		if r == ' ' || r == '\t' || r == '\n' || r == '\f' || r == '\r' {
			return -1
		}
		return r
	}, payload)
	payload = strings.TrimRight(payload, "=")
	bytes, err := base64.RawStdEncoding.DecodeString(payload)
	if err != nil {
		return nil
	}
	var claims map[string]any
	if json.Unmarshal([]byte(decodeUTF8(bytes)), &claims) != nil {
		return nil
	}
	return claims
}

// ticketSource is the open's ticket provider: a fresh mint in secret
// mode; in URL mode the host's ticket, fetched again 30 s before it expires
// or when the room refused it. The first ticket is made eagerly, so a
// refusal shows at blok_open. Only the server's own host token is sent.
func (s *Server) ticketSource(ctx context.Context, documentID string, write bool, who *caller, actorID string) (func(force bool) (string, error), error) {
	tickets := s.options.Tickets
	if tickets == nil {
		return nil, surfaceError("INVALID_ARGS", "Live mode needs blok-mcp to run with --sync-url.")
	}
	if tickets.Kind == "secret" {
		mint := func(bool) (string, error) {
			ttl := int64(ticketTTLSeconds)
			return ticket.Mint(tickets.Secret, ticket.Claims{User: actorID, Doc: &documentID, Write: write, TTLSeconds: &ttl}, time.Now())
		}
		if _, err := mint(false); err != nil {
			return nil, err
		}
		return mint, nil
	}
	fetchTicket := func(ctx context.Context) (string, time.Time, error) {
		return s.fetchTicket(ctx, tickets, documentID, write, who, actorID)
	}
	pass, expires, err := fetchTicket(ctx)
	if err != nil {
		return nil, err
	}
	var mu sync.Mutex
	return func(force bool) (string, error) {
		mu.Lock()
		defer mu.Unlock()
		if force || time.Until(expires) < ticketRefreshMargin {
			fresh, at, err := fetchTicket(context.Background())
			if err != nil {
				return "", err
			}
			pass, expires = fresh, at
		}
		return pass, nil
	}, nil
}

const ticketRefreshMargin = 30 * time.Second

func (s *Server) fetchTicket(ctx context.Context, tickets *Tickets, documentID string, write bool, who *caller, actorID string) (string, time.Time, error) {
	body, _ := marshal(ticketRequest{Doc: documentID, Write: write, Principal: who.principal, ClientName: who.clientName, ActorID: actorID})
	answer, err := fetch(ctx, ticketFetchTimeout, http.MethodPost, tickets.URL,
		http.Header{"Authorization": {"Bearer " + tickets.HostToken}, "Content-Type": {"application/json"}}, body)
	if err != nil {
		return "", time.Time{}, surfaceError("SOURCE_UNAVAILABLE", "The ticket endpoint could not be reached.")
	}
	switch {
	// A 401 refuses the host token, not the agent, so a rotation never ends
	// live handles.
	case answer.status == http.StatusUnauthorized:
		return "", time.Time{}, surfaceError("SOURCE_UNAVAILABLE", "The ticket endpoint refused the host token.")
	case answer.status == http.StatusForbidden:
		return "", time.Time{}, surfaceError("FORBIDDEN", "The host did not grant this document to this agent.")
	case answer.status < 200 || answer.status > 299:
		return "", time.Time{}, surfaceError("SOURCE_UNAVAILABLE", fmt.Sprintf("The ticket endpoint answered %d.", answer.status))
	}
	var field struct {
		Ticket json.RawMessage `json:"ticket"`
	}
	var pass string
	if json.Unmarshal([]byte(decodeUTF8(answer.body)), &field) != nil || !isStringJSON(field.Ticket) || json.Unmarshal(field.Ticket, &pass) != nil {
		return "", time.Time{}, surfaceError("SOURCE_UNAVAILABLE", `The ticket endpoint answered without a "ticket" field.`)
	}
	claims := readTicketClaims(pass)
	user, userIsString := claims["user"].(string)
	doc, docIsString := claims["doc"].(string)
	// The journal names the ticket's user, so it must be the agent.
	if claims == nil || !userIsString || user != actorID || !docIsString || doc != documentID {
		return "", time.Time{}, surfaceError("FORBIDDEN", `The host minted a ticket for another user or document. Its "user" must equal actorId.`)
	}
	if claims["write"] == true && !write {
		return "", time.Time{}, surfaceError("FORBIDDEN", "The host minted a write ticket for a read-only open.")
	}
	expires := time.Now()
	if exp, ok := claims["exp"].(float64); ok {
		expires = time.UnixMilli(int64(exp * 1000))
	}
	return pass, expires, nil
}

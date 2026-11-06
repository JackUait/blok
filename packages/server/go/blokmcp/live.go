package blokmcp

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
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

// ticketFor mints or fetches the open's first ticket, so a refusal shows at
// blok_open. Only the server's own host token is sent, never the caller's.
func (s *Server) ticketFor(ctx context.Context, documentID string, write bool, who *caller, actorID string) (func() (string, error), error) {
	tickets := s.options.Tickets
	if tickets == nil {
		return nil, surfaceError("INVALID_ARGS", "Live mode needs blok-mcp to run with --sync-url.")
	}
	if tickets.Kind == "secret" {
		mint := func() (string, error) {
			ttl := int64(ticketTTLSeconds)
			return ticket.Mint(tickets.Secret, ticket.Claims{User: actorID, Doc: &documentID, Write: write, TTLSeconds: &ttl}, time.Now())
		}
		if _, err := mint(); err != nil {
			return nil, err
		}
		return mint, nil
	}
	body, _ := marshal(ticketRequest{Doc: documentID, Write: write, Principal: who.principal, ClientName: who.clientName, ActorID: actorID})
	answer, err := fetch(ctx, ticketFetchTimeout, http.MethodPost, tickets.URL,
		http.Header{"Authorization": {"Bearer " + tickets.HostToken}, "Content-Type": {"application/json"}}, body)
	if err != nil {
		return nil, surfaceError("SOURCE_UNAVAILABLE", "The ticket endpoint could not be reached.")
	}
	switch {
	// A 401 refuses the host token, not the agent, so a rotation never ends
	// live handles.
	case answer.status == http.StatusUnauthorized:
		return nil, surfaceError("SOURCE_UNAVAILABLE", "The ticket endpoint refused the host token.")
	case answer.status == http.StatusForbidden:
		return nil, surfaceError("FORBIDDEN", "The host did not grant this document to this agent.")
	case answer.status < 200 || answer.status > 299:
		return nil, surfaceError("SOURCE_UNAVAILABLE", fmt.Sprintf("The ticket endpoint answered %d.", answer.status))
	}
	var field struct {
		Ticket json.RawMessage `json:"ticket"`
	}
	var pass string
	if json.Unmarshal([]byte(decodeUTF8(answer.body)), &field) != nil || !isStringJSON(field.Ticket) || json.Unmarshal(field.Ticket, &pass) != nil {
		return nil, surfaceError("SOURCE_UNAVAILABLE", `The ticket endpoint answered without a "ticket" field.`)
	}
	claims := readTicketClaims(pass)
	user, _ := claims["user"].(string)
	doc, _ := claims["doc"].(string)
	_, userIsString := claims["user"].(string)
	_, docIsString := claims["doc"].(string)
	// The journal names the ticket's user, so it must be the agent.
	if claims == nil || !userIsString || user != actorID || !docIsString || doc != documentID {
		return nil, surfaceError("FORBIDDEN", `The host minted a ticket for another user or document. Its "user" must equal actorId.`)
	}
	if claims["write"] == true && !write {
		return nil, surfaceError("FORBIDDEN", "The host minted a write ticket for a read-only open.")
	}
	return func() (string, error) { return pass, nil }, nil
}

func secWebSocketKey() string {
	key := make([]byte, 16)
	_, _ = rand.Read(key)
	return base64.StdEncoding.EncodeToString(key)
}

// openLive mints the ticket, then knocks on the room until it answers or
// the sync timeout passes. Syncing a room is not ported yet, so a room
// that accepts is refused here.
func (s *Server) openLive(ctx context.Context, documentID string, write bool, who *caller) (session, error) {
	if s.options.Sync == nil {
		return nil, surfaceError("INVALID_ARGS", "Live mode needs blok-mcp to run with --sync-url.")
	}
	url, err := syncURLFor(s.options.Sync.URL, documentID)
	if err != nil {
		return nil, err
	}
	var actor struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(who.actor, &actor)
	next, err := s.ticketFor(ctx, documentID, write, who, actor.ID)
	if err != nil {
		return nil, err
	}
	url = strings.Replace(strings.Replace(url, "ws://", "http://", 1), "wss://", "https://", 1)
	deadline := time.Now().Add(roomSyncTimeout)
	for {
		pass, err := next()
		if err != nil {
			return nil, err
		}
		header := http.Header{
			"Connection":             {"Upgrade"},
			"Upgrade":                {"websocket"},
			"Sec-Websocket-Version":  {"13"},
			"Sec-Websocket-Key":      {secWebSocketKey()},
			"Sec-Websocket-Protocol": {syncSubprotocolV2 + ", " + syncSubprotocolV1 + ", " + pass},
		}
		if s.options.Sync.Origin != nil {
			header["Origin"] = []string{*s.options.Sync.Origin}
		}
		attempt, cancel := context.WithDeadline(ctx, deadline)
		status, err := upgrade(attempt, url, header)
		cancel()
		if err == nil && status == http.StatusSwitchingProtocols {
			return nil, surfaceError("SOURCE_UNAVAILABLE", "This blok-mcp build cannot join live rooms yet. Open the document with mode \"stored\".")
		}
		wait := min(roomRetryEvery, time.Until(deadline))
		if wait <= 0 {
			return nil, surfaceError("ROOM_SYNC_TIMEOUT", "The room did not finish loading in time. Try again.")
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(wait):
		}
	}
}

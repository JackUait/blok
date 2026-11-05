package synchttp

import (
	"net"
	"net/http"
	"strings"
	"unicode"

	"github.com/JackUait/blok/packages/server/go/v2/internal/auth"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab"
	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/v2/internal/ticket"
	"github.com/JackUait/blok/packages/server/go/v2/internal/ws"
)

// The two subprotocol tokens. Matched ordinally, never by case.
const (
	ProtocolV1 = "blok-sync.v1"
	ProtocolV2 = "blok-sync.v2"
)

// handshakeResult is one of refused, rejected or accepted.
type handshakeResult interface{ isHandshakeResult() }

// refused answers before the upgrade with a plain status.
type refused struct {
	status int
	body   string
}

// rejected accepts, echoing the subprotocol, and closes at once: refusing
// the subprotocol would leave a browser with no code at all.
type rejected struct {
	subProtocol string
	close       CloseFrame
}

// accepted is past the door. principal "" is uncapped; actor "" is none.
type accepted struct {
	subProtocol string
	canWrite    bool
	principal   string
	actor       string
	source      collab.OperationSource
	user        auth.User
	// hasUser is false when no user reached the request at all.
	hasUser bool
}

func (refused) isHandshakeResult()  {}
func (rejected) isHandshakeResult() {}
func (accepted) isHandshakeResult() {}

// negotiate is SyncHandshake.NegotiateAsync. Order: plumbing, origin, ticket,
// doc claim, rate limit, the application's hook. A refusal costs nothing; a
// rejection costs a socket, so it spends the rate limit too.
func (e *Endpoint) negotiate(r *http.Request, doc string) handshakeResult {
	admission, key := e.admit(r, doc)
	if _, ok := admission.(refused); ok {
		return admission
	}
	if !e.config.RateLimit(key) {
		return refused{http.StatusTooManyRequests, "rate limit exceeded\n"}
	}
	if candidate, ok := admission.(accepted); ok {
		return e.authorize(r, doc, candidate)
	}
	return admission
}

func (e *Endpoint) admit(r *http.Request, doc string) (handshakeResult, string) {
	key := "addr:" + remoteAddress(r)
	if !ws.IsWebSocketRequest(r) {
		return refused{http.StatusUpgradeRequired, "WebSocket upgrade required\n"}, key
	}
	_, hasOrigin := r.Header["Origin"]
	originRequired := e.config.Auth == "ticket" || hasOrigin ||
		dotnet.EqualsOrdinalIgnoreCase(firstValue(r.Header, "Sec-Fetch-Site"), "cross-site")
	if originRequired && !e.config.OriginAllowed(firstValue(r.Header, "Origin")) {
		return refused{http.StatusForbidden, "origin not allowed\n"}, key
	}

	offers := protocolOffers(r.Header)
	subProtocol := e.selectSubProtocol(offers)
	if !isSingleSegment(doc) {
		return rejected{subProtocol, CloseBadDocument}, key
	}

	user, hasUser := auth.UserFrom(r.Context())
	principal, ticketUser := "", ""
	canWrite := true
	if e.config.Auth == "ticket" {
		// A 101 echoing none of the offers is failed by every browser before
		// any close code arrives: a plain refusal instead.
		if subProtocol == "" {
			return refused{http.StatusBadRequest, "blok-sync.v1 must be offered in Sec-WebSocket-Protocol\n"}, key
		}
		var candidates []string
		for _, offer := range offers {
			if offer != ProtocolV1 && offer != ProtocolV2 {
				candidates = append(candidates, offer)
			}
		}
		if len(candidates) == 0 {
			return rejected{subProtocol, CloseMissingPass}, key
		}
		claims, ok := e.verifyAny(candidates)
		switch {
		case !ok:
			return rejected{subProtocol, CloseInvalidPass}, key
		case claims.Doc != doc:
			return rejected{subProtocol, CloseOtherDocument}, key
		case claims.User == "":
			return rejected{subProtocol, CloseUserlessPass}, key
		}
		canWrite = claims.Write
		principal = "user:" + claims.User
		key = principal
		user, hasUser = auth.User{ID: claims.User, Name: claims.User, Doc: claims.Doc, Write: claims.Write, Authenticated: true}, true
		ticketUser = claims.User
	}
	if principal == "" {
		principal = signedInPrincipal(user, hasUser)
	}
	source := collab.SourceClientV1
	if subProtocol == ProtocolV2 {
		source = collab.SourceClientV2
	}
	return accepted{
		subProtocol: subProtocol,
		canWrite:    canWrite,
		principal:   principal,
		actor:       deriveActor(ticketUser, user, hasUser),
		source:      source,
		user:        user,
		hasUser:     hasUser,
	}, key
}

// authorize runs the application's hook: a denied read is closed 4403, a
// denied write makes the member read-only. A hook error fails closed.
func (e *Endpoint) authorize(r *http.Request, doc string, candidate accepted) handshakeResult {
	hook := e.config.Authorization
	if hook == nil {
		return candidate
	}
	if ok, err := hook.CanReadDocument(r.Context(), candidate.user, doc); err != nil || !ok {
		if err != nil {
			return hookFailed{err}
		}
		return rejected{candidate.subProtocol, CloseForbidden}
	}
	if candidate.canWrite {
		ok, err := hook.CanWriteDocument(r.Context(), candidate.user, doc)
		if err != nil {
			return hookFailed{err}
		}
		candidate.canWrite = ok
	}
	return candidate
}

// hookFailed is an error the hook raised; C# lets it escape to the host,
// which answers an empty 500.
type hookFailed struct{ err error }

func (hookFailed) isHandshakeResult() {}

// signedInPrincipal is the application's signed-in user: Name, else the id.
// Go cannot tell a null name from an empty one; both fall back to the id.
func signedInPrincipal(u auth.User, has bool) string {
	if !has || !u.Authenticated {
		return ""
	}
	name := u.Name
	if name == "" {
		name = u.ID
	}
	if name == "" {
		return ""
	}
	return "app:" + name
}

// deriveActor is the ticket's user, else the stable id, else the name: the
// opposite order from signedInPrincipal, because a name can change.
func deriveActor(ticketUser string, u auth.User, has bool) string {
	if ticketUser != "" {
		return ticketUser
	}
	if !has || !u.Authenticated {
		return ""
	}
	if u.ID != "" {
		return u.ID
	}
	return u.Name
}

// selectSubProtocol picks v2 only with an operation store, else v1, else "".
func (e *Endpoint) selectSubProtocol(offers []string) string {
	has := func(want string) bool {
		for _, offer := range offers {
			if offer == want {
				return true
			}
		}
		return false
	}
	switch {
	case e.config.HasOperationStore && has(ProtocolV2):
		return ProtocolV2
	case has(ProtocolV1):
		return ProtocolV1
	}
	return ""
}

// protocolOffers reads both header shapes: one comma-joined value and
// repeated lines. Kestrel decodes the head as UTF-8, and String.Trim drops
// exactly what unicode.IsSpace calls space.
func protocolOffers(h http.Header) []string {
	var offers []string
	for _, value := range h.Values("Sec-WebSocket-Protocol") {
		for _, token := range strings.Split(value, ",") {
			if token = strings.TrimFunc(token, unicode.IsSpace); token != "" {
				offers = append(offers, token)
			}
		}
	}
	return offers
}

func (e *Endpoint) verifyAny(candidates []string) (ticket.Claims, bool) {
	now := e.config.Clock()
	for _, candidate := range candidates {
		if claims, ok := ticket.Verify(e.config.Secret, candidate, now); ok {
			return claims, true
		}
	}
	return ticket.Claims{}, false
}

// isSingleSegment: a route value keeps an encoded slash encoded, so "a/b"
// arrives as "a%2Fb" and would never match its ticket's doc claim.
func isSingleSegment(doc string) bool {
	lower := strings.ToLower(doc)
	return doc != "" && !strings.ContainsAny(doc, `/\`) &&
		!strings.Contains(lower, "%2f") && !strings.Contains(lower, "%5c")
}

func firstValue(h http.Header, name string) string {
	if values := h.Values(name); len(values) > 0 {
		return values[0]
	}
	return ""
}

// remoteAddress is Connection.RemoteIpAddress: the peer IP without the port.
func remoteAddress(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

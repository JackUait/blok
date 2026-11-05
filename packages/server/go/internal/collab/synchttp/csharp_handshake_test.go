package synchttp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/auth"
	"github.com/JackUait/blok/packages/server/go/internal/collab"
	"github.com/JackUait/blok/packages/server/go/internal/collab/room"
	"github.com/JackUait/blok/packages/server/go/internal/collab/wire"
	"github.com/JackUait/blok/packages/server/go/internal/collab/workingset"
)

// Twins of C# SyncHandshakeTests and SyncSocketMemberTests cases that had no Go twin.

// Tokens stay in tickets.json: gitleaks allows them there only.
const hsTicketsPath = "../../../../../../test/unit/server-conformance/fixtures/tickets.json"

func hsTicket(t *testing.T, name string) string {
	t.Helper()
	data, err := os.ReadFile(hsTicketsPath)
	if err != nil {
		t.Fatal(err)
	}
	var tickets map[string]string
	if err := json.Unmarshal(data, &tickets); err != nil {
		t.Fatal(err)
	}
	if tickets["secret"] != testSecret {
		t.Fatal("tickets.json is signed with another secret")
	}
	value, ok := tickets[name]
	if !ok {
		t.Fatalf("no ticket %q", name)
	}
	return value
}

// --- C# RecordingAuthorization: allow switches and every call ---

type hsCall struct{ method, user, doc string }

type hsHook struct {
	mu                  sync.Mutex
	denyRead, denyWrite bool
	calls               []hsCall
	principals          []auth.User
}

func (h *hsHook) record(method string, u auth.User, doc string) {
	h.calls = append(h.calls, hsCall{method, synUserID(u), doc})
	h.principals = append(h.principals, u)
}

func (h *hsHook) CanReadDocument(_ context.Context, u auth.User, doc string) (bool, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.record("read", u, doc)
	return !h.denyRead, nil
}

func (h *hsHook) CanWriteDocument(_ context.Context, u auth.User, doc string) (bool, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.record("write", u, doc)
	return !h.denyWrite, nil
}

func (h *hsHook) saw(want hsCall) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, call := range h.calls {
		if call == want {
			return true
		}
	}
	return false
}

func (h *hsHook) callList() []hsCall {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]hsCall(nil), h.calls...)
}

func (h *hsHook) seen() []auth.User {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]auth.User(nil), h.principals...)
}

// --- C# SyncApp.StartAsync with its configure, services and configureApp ---

type hsOptions struct {
	ticket bool
	hook   auth.Authorization
	edit   func(*Config)
	wrap   func(http.Handler) http.Handler
}

func hsStart(t *testing.T, o hsOptions) *synApp {
	t.Helper()
	app := &synApp{endpoint: &synEndpoint{docs: map[string]string{synDoc: "seeded"}}}
	app.store = workingset.NewLocalStore(t.TempDir(), nil)
	app.manager = room.NewManager(room.ManagerOptions{
		Store: app.store, Endpoint: app.endpoint, Converter: synConverter{},
	})
	app.harness = startEndpoint(t, func(c *Config) {
		c.Rooms = app.manager
		c.Connections = NewConnectionTable(0, 8)
		if o.ticket {
			c.Auth = "ticket"
		}
		if o.hook != nil {
			c.Authorization = o.hook
		}
		if o.edit != nil {
			o.edit(c)
		}
	}, o.wrap)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = app.manager.Drain(ctx)
	})
	return app
}

// hsConnect is C# ConnectAsync: each protocol on its own header line, as
// ClientWebSocket sends them. origin "" sends no Origin.
func hsConnect(t *testing.T, app *synApp, doc, origin string, protocols []string, extra ...string) *synClient {
	t.Helper()
	var headers []string
	if origin != "" {
		headers = append(headers, "Origin", origin)
	}
	for _, protocol := range protocols {
		headers = append(headers, "Sec-WebSocket-Protocol", protocol)
	}
	return &synClient{app.dial(t, "/sync/"+doc, append(headers, extra...)...)}
}

func hsOpen(t *testing.T, app *synApp, protocols ...string) *synClient {
	t.Helper()
	c := hsConnect(t, app, synDoc, synOrigin, protocols)
	if c.response.StatusCode != 101 {
		t.Fatalf("upgrade refused: %d %q", c.response.StatusCode, c.body)
	}
	return c
}

func hsWithTicket(t *testing.T, app *synApp, pass string) *synClient {
	t.Helper()
	return hsOpen(t, app, synProtocol, pass)
}

func hsAssertStatus(t *testing.T, c *synClient, status int) {
	t.Helper()
	if c.response.StatusCode != status {
		t.Fatalf("got %d %q, want %d", c.response.StatusCode, c.body, status)
	}
}

func hsAssertJoinedWith(t *testing.T, c *synClient, protocol string) {
	t.Helper()
	if got := c.subProtocol(); got != protocol {
		t.Fatalf("subprotocol %q, want %q", got, protocol)
	}
}

// hsWindowOfOne is FixedWindowRateLimiter at RateLimitPerMinute = 1 with a
// clock that never moves: one hit per key.
func hsWindowOfOne(c *Config) {
	var mu sync.Mutex
	seen := map[string]bool{}
	c.RateLimit = func(key string) bool {
		mu.Lock()
		defer mu.Unlock()
		if seen[key] {
			return false
		}
		seen[key] = true
		return true
	}
}

// --- SyncHandshakeTests ---

func TestAcceptsTheTicketBeforeTheProtocolInTheOffer(t *testing.T) {
	app := hsStart(t, hsOptions{ticket: true})
	client := hsOpen(t, app, hsTicket(t, "compatible"), synProtocol)

	hsAssertJoinedWith(t, client, synProtocol)
	synAssertFreshTag(t, synNext[wire.BlokControl](t, client).Tag)
}

func TestAnInvalidTicketIsAcceptedThenClosed4401(t *testing.T) {
	for _, name := range []string{"expired", "tampered", "noncanonicalHeaderTicket", "malformed"} {
		t.Run(name, func(t *testing.T) {
			app := hsStart(t, hsOptions{ticket: true})
			client := hsWithTicket(t, app, hsTicket(t, name))

			// Refusing the subprotocol would leave the browser with no readable code.
			hsAssertJoinedWith(t, client, synProtocol)
			if got := client.closeFrame(t); got != (CloseFrame{4401, "invalid pass"}) {
				t.Fatalf("closed %+v", got)
			}
		})
	}
}

func TestAMissingTicketIsAcceptedThenClosed4401(t *testing.T) {
	app := hsStart(t, hsOptions{ticket: true})
	client := hsOpen(t, app, synProtocol)

	hsAssertJoinedWith(t, client, synProtocol)
	if got := client.closeFrame(t); got != (CloseFrame{4401, "missing pass"}) {
		t.Fatalf("closed %+v", got)
	}
}

func TestATicketForAnotherDocumentIsClosed4401(t *testing.T) {
	app := hsStart(t, hsOptions{ticket: true})
	client := hsWithTicket(t, app, hsTicket(t, "docMismatch"))

	hsAssertJoinedWith(t, client, synProtocol)
	if got := client.closeFrame(t); got != (CloseFrame{4401, "pass is for another document"}) {
		t.Fatalf("closed %+v", got)
	}
}

// A 101 echoing none of the offers is failed by every browser before any
// close code arrives, so this is a plain refusal.
func TestTicketModeRequiresTheSyncProtocolInTheOffer(t *testing.T) {
	app := hsStart(t, hsOptions{ticket: true})

	hsAssertStatus(t, hsConnect(t, app, synDoc, synOrigin, []string{hsTicket(t, "compatible")}), 400)
}

func TestOffersV2ThenV1ThenTicketJoinAtV1WhenNoOperationStoreIsRegistered(t *testing.T) {
	app := hsStart(t, hsOptions{ticket: true})
	client := hsOpen(t, app, synProtocolV2, synProtocol, hsTicket(t, "compatible"))

	hsAssertJoinedWith(t, client, synProtocol)
	synAssertFreshTag(t, synNext[wire.BlokControl](t, client).Tag)
}

// The same store sits behind the door and the room: synStart wires both.
func TestOffersV2ThenV1ThenTicketJoinAtV2WithAnOperationStoreRegistered(t *testing.T) {
	app := synStart(t, synOptions{ticket: true, journal: true})
	client := hsOpen(t, app, synProtocolV2, synProtocol, hsTicket(t, "compatible"))

	hsAssertJoinedWith(t, client, synProtocolV2)
	synAssertFreshTag(t, synNext[wire.BlokControl](t, client).Tag)
}

func TestTicketSearchExcludesBothProtocolTokensSoTwoProtocolsWithNoTicketIsAMissingPassNotAnInvalidOne(t *testing.T) {
	app := hsStart(t, hsOptions{ticket: true})
	client := hsOpen(t, app, synProtocol, synProtocolV2)

	hsAssertJoinedWith(t, client, synProtocol)
	if got := client.closeFrame(t); got != (CloseFrame{4401, "missing pass"}) {
		t.Fatalf("closed %+v", got)
	}
}

func TestAnInvalidTicketBetweenTheTwoProtocolTokensIsStillFoundAndRejected(t *testing.T) {
	app := hsStart(t, hsOptions{ticket: true})
	client := hsOpen(t, app, synProtocol, hsTicket(t, "expired"), synProtocolV2)

	hsAssertJoinedWith(t, client, synProtocol)
	if got := client.closeFrame(t); got != (CloseFrame{4401, "invalid pass"}) {
		t.Fatalf("closed %+v", got)
	}
}

func TestADocumentIdWithAnEncodedSlashIsClosed4400InsteadOfLookingLikeAPassMismatch(t *testing.T) {
	pass := mint(`{"user":"u1","doc":"a/b","write":true,"exp":4102444800}`)
	app := hsStart(t, hsOptions{ticket: true})
	// C# Uri.EscapeDataString("a/b").
	client := hsConnect(t, app, "a%2Fb", synOrigin, []string{synProtocol, pass})

	hsAssertStatus(t, client, 101)
	hsAssertJoinedWith(t, client, synProtocol)
	if got := client.closeFrame(t); got != (CloseFrame{4400, "document ids must be a single path segment"}) {
		t.Fatalf("closed %+v", got)
	}
}

func TestStockClientsJoinWithoutASubprotocolAndNeverSeeTheControlFrame(t *testing.T) {
	for _, mode := range []string{"none", "proxy"} {
		t.Run(mode, func(t *testing.T) {
			app := hsStart(t, hsOptions{edit: func(c *Config) { c.Auth = mode }})
			client := hsConnect(t, app, synDoc, "", nil)
			hsAssertStatus(t, client, 101)

			hsAssertJoinedWith(t, client, "")
			// synNext fails on any frame but the one asked for, so a control
			// frame here would fail the test.
			doc := synNewDoc()
			client.send(t, wire.SyncStep1{StateVector: doc.EncodeStateVector()})
			synApply(t, doc, synNext[wire.SyncStep2](t, client).Update)
			if got := synText(doc); got != "seeded" {
				t.Fatalf("text %q", got)
			}
			synNext[wire.SyncStep1](t, client)
		})
	}
}

func TestNoAuthModeEchoesTheProtocolWhenOfferedAndSendsTheControlFrame(t *testing.T) {
	app := hsStart(t, hsOptions{})
	client := hsOpen(t, app, synProtocol)

	hsAssertJoinedWith(t, client, synProtocol)
	synAssertFreshTag(t, synNext[wire.BlokControl](t, client).Tag)
}

func TestARejectedHandshakeSpendsTheRateLimitOnItsAddressSoAuthFailuresCannotFlood(t *testing.T) {
	app := hsStart(t, hsOptions{ticket: true, edit: hsWindowOfOne})
	expired := hsTicket(t, "expired")

	rejected := hsWithTicket(t, app, expired)
	if got := rejected.closeFrame(t); got != (CloseFrame{4401, "invalid pass"}) {
		t.Fatalf("closed %+v", got)
	}

	// The address spent its window on the rejection: no socket this time.
	hsAssertStatus(t, hsConnect(t, app, synDoc, synOrigin, []string{synProtocol, expired}), 429)
}

func TestRejectionsDoNotSpendTheWindowOfAValidPassHolder(t *testing.T) {
	app := hsStart(t, hsOptions{ticket: true, edit: hsWindowOfOne})

	rejected := hsWithTicket(t, app, hsTicket(t, "expired"))
	if got := rejected.closeFrame(t); got != (CloseFrame{4401, "invalid pass"}) {
		t.Fatalf("closed %+v", got)
	}

	// Rejections key on the address, an accepted handshake on its user.
	compatible := hsTicket(t, "compatible")
	accepted := hsWithTicket(t, app, compatible)
	synAssertFreshTag(t, synNext[wire.BlokControl](t, accepted).Tag)

	hsAssertStatus(t, hsConnect(t, app, synDoc, synOrigin, []string{synProtocol, compatible}), 429)

	otherUser := hsWithTicket(t, app, hsTicket(t, "userTwo"))
	synAssertFreshTag(t, synNext[wire.BlokControl](t, otherUser).Tag)
}

func TestARejectedHandshakeIsTornDownWithoutWaitingOutAPeerThatNeverAnswers(t *testing.T) {
	served := make(chan struct{}, 1)
	app := hsStart(t, hsOptions{ticket: true, wrap: func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() { served <- struct{}{} }()
			next.ServeHTTP(w, r)
		})
	}})
	client := hsWithTicket(t, app, hsTicket(t, "expired"))

	// clientConn.closeFrame reads the close without answering it, and the
	// socket stays open: only the server's own grace can end the request.
	if got := client.clientConn.closeFrame(t); got != (CloseFrame{4401, "invalid pass"}) {
		t.Fatalf("closed %+v", got)
	}
	select {
	case <-served:
	case <-time.After(3 * time.Second):
		t.Fatal("the rejected socket was held open for the peer's answer")
	}
}

func TestApplicationAuthorizationDeniedReadIsClosed4403(t *testing.T) {
	hook := &hsHook{denyRead: true}
	app := hsStart(t, hsOptions{ticket: true, hook: hook})
	client := hsWithTicket(t, app, hsTicket(t, "compatible"))

	hsAssertJoinedWith(t, client, synProtocol)
	if got := client.closeFrame(t); got != (CloseFrame{4403, "forbidden"}) {
		t.Fatalf("closed %+v", got)
	}
	if !hook.saw(hsCall{"read", "u1", synDoc}) {
		t.Fatalf("hook calls %+v", hook.callList())
	}
}

func TestApplicationAuthorizationDeniedWriteMakesAWriteTicketReadOnly(t *testing.T) {
	hook := &hsHook{denyWrite: true}
	app := hsStart(t, hsOptions{ticket: true, hook: hook})
	client := hsWithTicket(t, app, hsTicket(t, "compatible"))
	synAssertFreshTag(t, synNext[wire.BlokControl](t, client).Tag)
	doc := synSynced(t, client)

	client.send(t, wire.SyncUpdate{Update: synAppend(doc, " stolen")})

	if got := synSyncedText(t, client); got != "seeded" {
		t.Fatalf("text %q", got)
	}
	if !hook.saw(hsCall{"write", "u1", synDoc}) {
		t.Fatalf("hook calls %+v", hook.callList())
	}
}

func TestTheAuthorizationHookSeesTheTicketsUserDocumentAndWriteClaims(t *testing.T) {
	hook := &hsHook{}
	app := hsStart(t, hsOptions{ticket: true, hook: hook})
	writer := hsWithTicket(t, app, hsTicket(t, "compatible"))
	synAssertFreshTag(t, synNext[wire.BlokControl](t, writer).Tag)

	principal := hook.seen()[0]
	if !principal.Authenticated || principal.ID != "u1" || principal.Doc != synDoc || !principal.Write {
		t.Fatalf("writer principal %+v", principal)
	}

	reader := hsWithTicket(t, app, hsTicket(t, "readOnly"))
	synAssertFreshTag(t, synNext[wire.BlokControl](t, reader).Tag)

	if seen := hook.seen(); seen[len(seen)-1].Write {
		t.Fatalf("reader principal %+v", seen[len(seen)-1])
	}
}

// Go has no RequireAuthorization: the host's middleware signs the user in,
// as C#'s HeaderAuthenticationHandler does with a NameIdentifier only.
// Refusing an anonymous caller (C#'s 401) is the host's, not the door's.
func TestRequireAuthorizationOnTheGroupProtectsTheSyncRouteAndTheSignedInUserIsThePrincipal(t *testing.T) {
	hook := &hsHook{}
	app := hsStart(t, hsOptions{
		hook: hook,
		edit: func(c *Config) { c.Connections = NewConnectionTable(0, 1) },
		wrap: func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if id := r.Header.Get("X-Test-User"); id != "" {
					r = r.WithContext(auth.WithUser(r.Context(), auth.User{ID: id, Authenticated: true}))
				}
				next.ServeHTTP(w, r)
			})
		},
	})
	signedInAs := func(user string) *synClient {
		return hsConnect(t, app, synDoc, synOrigin, nil, "X-Test-User", user)
	}

	alice := signedInAs("alice")
	hsAssertStatus(t, alice, 101)
	if got := synSyncedText(t, alice); got != "seeded" {
		t.Fatalf("alice: %q", got)
	}
	if !hook.saw(hsCall{"read", "alice", synDoc}) || !hook.saw(hsCall{"write", "alice", synDoc}) {
		t.Fatalf("hook calls %+v", hook.callList())
	}

	// The cap keys on the signed-in identity, not on the shared address.
	hsAssertStatus(t, signedInAs("alice"), 429)
	bob := signedInAs("bob")
	hsAssertStatus(t, bob, 101)
	if got := synSyncedText(t, bob); got != "seeded" {
		t.Fatalf("bob: %q", got)
	}
}

// --- actor attribution, at the handshake as C# NegotiateAsync runs it ---

func hsNegotiate(t *testing.T, config Config, user *auth.User) accepted {
	t.Helper()
	request := httptest.NewRequest("GET", "/sync/"+synDoc, nil)
	request.Header.Set("Connection", "Upgrade")
	request.Header.Set("Upgrade", "websocket")
	request.Header.Set("Sec-WebSocket-Version", "13")
	request.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	if user != nil {
		request = request.WithContext(auth.WithUser(request.Context(), *user))
	}
	result, ok := NewEndpoint(config).negotiate(request, synDoc).(accepted)
	if !ok {
		t.Fatalf("not accepted: %+v", result)
	}
	return result
}

func TestApplicationNameIdentifierBecomesJournalActor(t *testing.T) {
	config := Config{
		Auth:          "none",
		OriginAllowed: func(string) bool { return false },
		RateLimit:     func(string) bool { return true },
		Clock:         time.Now,
	}

	got := hsNegotiate(t, config, &auth.User{ID: "alice", Authenticated: true})

	if got.actor != "alice" {
		t.Fatalf("actor %q", got.actor)
	}
}

// A verified ticket never names an empty user (the userless close comes
// first); this pins the derivation itself.
func TestTicketWithoutAUserClaimHasNullJournalActor(t *testing.T) {
	ticketUser := auth.User{Doc: synDoc, Write: true, Authenticated: true}

	if got := deriveActor("", ticketUser, true); got != "" {
		t.Fatalf("actor %q", got)
	}
}

// --- SyncSocketMemberTests ---

func hsBareMember(acceptsControlFrames bool) *SocketMember {
	return NewSocketMember(MemberOptions{CanWrite: false, AcceptsControlFrames: acceptsControlFrames, MaxQueuedBytes: 10})
}

func TestTheFirstNonForbiddenCloseWinsAndMapsTheRoomReasons(t *testing.T) {
	reset := hsBareMember(false)
	draining := hsBareMember(false)

	reset.Close(collab.CloseReset)
	reset.Close(collab.CloseDraining)
	draining.Close(collab.CloseDraining)
	draining.Send([]byte{1})

	if got := reset.RequestedClose(); got == nil || *got != (CloseFrame{4409, "document reset"}) {
		t.Fatalf("reset: %v", got)
	}
	if got := draining.RequestedClose(); got == nil || *got != (CloseFrame{1001, "server shutting down"}) {
		t.Fatalf("draining: %v", got)
	}
}

func TestRepeatedBadAwarenessClosesAsAPolicyViolation(t *testing.T) {
	member := hsBareMember(true)

	member.Close(collab.CloseBadAwareness)

	if got := member.RequestedClose(); got == nil || *got != (CloseFrame{1008, "malformed awareness"}) {
		t.Fatalf("got %v", got)
	}
}

// A value outside the set still closes 1011 instead of panicking in the room's lane.
func TestAnUnmappedReasonClosesAsAnInternalError(t *testing.T) {
	member := hsBareMember(true)

	member.Close(collab.CloseReason(99))

	if got := member.RequestedClose(); got == nil || got.Status != 1011 {
		t.Fatalf("got %v", got)
	}
}

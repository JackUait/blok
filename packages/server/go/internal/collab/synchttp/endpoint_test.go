package synchttp

import (
	"bufio"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/auth"
	"github.com/JackUait/blok/packages/server/go/internal/collab"
	"github.com/JackUait/blok/packages/server/go/internal/route"
	"github.com/JackUait/blok/packages/server/go/internal/ticket"
)

const testSecret = "s3cret-value-at-least-32-chars-long!"

func mint(payload string) string {
	body := base64.RawURLEncoding.EncodeToString([]byte(payload))
	mac := hmac.New(sha256.New, []byte(testSecret))
	mac.Write([]byte(ticket.HeaderSegment + "." + body))
	return ticket.HeaderSegment + "." + body + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

var (
	writeTicket    = mint(`{"user":"u1","doc":"doc-42","write":true,"exp":4102444800}`)
	readTicket     = mint(`{"user":"u1","doc":"doc-42","write":false,"exp":4102444800}`)
	userlessTicket = mint(`{"doc":"doc-42","write":true,"exp":4102444800}`)
)

// fakeRooms records joins and answers with a fixed status.
type fakeRooms struct {
	mu      sync.Mutex
	status  collab.JoinStatus
	err     error
	members []collab.Member
	joined  []*recordingMembership
}

func (f *fakeRooms) Join(_ context.Context, _ string, member collab.Member) (collab.JoinResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.members = append(f.members, member)
	if f.err != nil {
		return collab.JoinResult{}, f.err
	}
	if f.status != collab.JoinJoined {
		return collab.JoinResult{Status: f.status}, nil
	}
	membership := newRecordingMembership()
	f.joined = append(f.joined, membership)
	return collab.JoinResult{Status: collab.JoinJoined, Membership: membership}, nil
}

func (f *fakeRooms) joins() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.members)
}

func (f *fakeRooms) membership(i int) *recordingMembership {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.joined[i]
}

func (f *fakeRooms) answer(status collab.JoinStatus, err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.status, f.err = status, err
}

func (f *fakeRooms) lastMember(t *testing.T) collab.Member {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.members) == 0 {
		t.Fatal("no join")
	}
	return f.members[len(f.members)-1]
}

type fakeAuthorization struct {
	read, write bool
	err         error
	mu          sync.Mutex
	seen        []auth.User
}

func (a *fakeAuthorization) CanReadDocument(_ context.Context, u auth.User, _ string) (bool, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.seen = append(a.seen, u)
	return a.read, a.err
}

func (a *fakeAuthorization) CanWriteDocument(_ context.Context, _ auth.User, _ string) (bool, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.write, a.err
}

func (a *fakeAuthorization) set(edit func(*fakeAuthorization)) {
	a.mu.Lock()
	defer a.mu.Unlock()
	edit(a)
}

func (a *fakeAuthorization) calls() []auth.User {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]auth.User(nil), a.seen...)
}

type harness struct {
	server *httptest.Server
	rooms  *fakeRooms
}

func startEndpoint(t *testing.T, edit func(*Config), wrap func(http.Handler) http.Handler) *harness {
	t.Helper()
	rooms := &fakeRooms{}
	config := Config{
		Auth:            "none",
		Secret:          testSecret,
		OriginAllowed:   func(origin string) bool { return origin == "https://app.example.com" },
		RateLimit:       func(string) bool { return true },
		Clock:           time.Now,
		Rooms:           rooms,
		MaxMessageBytes: 1 << 20,
		Connections:     NewConnectionTable(0, 8),
		Budget:          BudgetOptions{FramesPerSecond: 50, BurstFrames: 100, ResyncsPerMinute: 60, AwarenessBytesPerSecond: 128 << 10},
	}
	if edit != nil {
		edit(&config)
	}
	router := &route.Router{}
	router.Handle("/sync/{doc}", []string{"GET"}, NewEndpoint(config))
	var handler http.Handler = router
	if wrap != nil {
		handler = wrap(handler)
	}
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return &harness{server: server, rooms: rooms}
}

type clientConn struct {
	conn     net.Conn
	reader   *bufio.Reader
	response *http.Response
	body     string
}

func (h *harness) dial(t *testing.T, path string, headers ...string) *clientConn {
	t.Helper()
	conn, err := net.Dial("tcp", h.server.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	request := "GET " + path + " HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n" +
		"Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
	for i := 0; i+1 < len(headers); i += 2 {
		request += headers[i] + ": " + headers[i+1] + "\r\n"
	}
	if _, err := io.WriteString(conn, request+"\r\n"); err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &clientConn{conn: conn, reader: reader, response: response}
	if response.StatusCode != http.StatusSwitchingProtocols {
		body, _ := io.ReadAll(response.Body)
		client.body = string(body)
	}
	return client
}

func (c *clientConn) closeFrame(t *testing.T) CloseFrame {
	t.Helper()
	_ = c.conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	return readClose(t, c.reader)
}

func ticketOffer(offers ...string) []string {
	return []string{"Origin", "https://app.example.com", "Sec-WebSocket-Protocol", strings.Join(offers, ", ")}
}

func ticketMode(c *Config) { c.Auth = "ticket" }

func TestTheTicketUserIsThePrincipalAndTheJournalActor(t *testing.T) {
	h := startEndpoint(t, ticketMode, nil)
	client := h.dial(t, "/sync/doc-42", ticketOffer("blok-sync.v1", writeTicket)...)
	if client.response.StatusCode != 101 || client.response.Header.Get("Sec-WebSocket-Protocol") != "blok-sync.v1" {
		t.Fatalf("status %d protocol %q", client.response.StatusCode, client.response.Header.Get("Sec-WebSocket-Protocol"))
	}
	member := h.rooms.lastMember(t)
	if member.ActorID() != "u1" || !member.CanWrite() || !member.AcceptsControlFrames() || member.ProtocolSource() != collab.SourceClientV1 {
		t.Fatalf("actor %q write %v control %v source %d", member.ActorID(), member.CanWrite(), member.AcceptsControlFrames(), member.ProtocolSource())
	}
}

func TestAReadOnlyTicketJoinsAsAReadOnlyMember(t *testing.T) {
	h := startEndpoint(t, ticketMode, nil)
	h.dial(t, "/sync/doc-42", ticketOffer("blok-sync.v1", readTicket)...)
	if h.rooms.lastMember(t).CanWrite() {
		t.Fatal("a read-only pass joined as a writer")
	}
}

func TestV2IsSelectedOnlyWithAnOperationStore(t *testing.T) {
	without := startEndpoint(t, ticketMode, nil)
	if got := without.dial(t, "/sync/doc-42", ticketOffer("blok-sync.v2", "blok-sync.v1", writeTicket)...).response.Header.Get("Sec-WebSocket-Protocol"); got != "blok-sync.v1" {
		t.Fatalf("without a store: %q", got)
	}
	if got := without.dial(t, "/sync/doc-42", ticketOffer("blok-sync.v2", writeTicket)...); got.response.StatusCode != 400 {
		t.Fatalf("a v2-only offer with no store: %d", got.response.StatusCode)
	}
	with := startEndpoint(t, func(c *Config) { c.Auth = "ticket"; c.HasOperationStore = true }, nil)
	if got := with.dial(t, "/sync/doc-42", ticketOffer("blok-sync.v1", "blok-sync.v2", writeTicket)...).response.Header.Get("Sec-WebSocket-Protocol"); got != "blok-sync.v2" {
		t.Fatalf("with a store: %q", got)
	}
	if with.rooms.lastMember(t).ProtocolSource() != collab.SourceClientV2 {
		t.Fatal("a v2 selection must carry the ClientV2 source")
	}
}

func TestANoAuthConnectionHasNoActorAndNoPrincipal(t *testing.T) {
	h := startEndpoint(t, func(c *Config) { c.Connections = NewConnectionTable(0, 1) }, nil)
	h.dial(t, "/sync/doc")
	h.dial(t, "/sync/doc")
	if h.rooms.joins() != 2 {
		t.Fatalf("an anonymous connection was capped: %d joins", h.rooms.joins())
	}
	if h.rooms.lastMember(t).ActorID() != "" || h.rooms.lastMember(t).AcceptsControlFrames() {
		t.Fatal("an anonymous stock client got an actor or control frames")
	}
}

// signedIn sets the host's own signed-in user, like RequireAuthorization.
func signedIn(u auth.User) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(auth.WithUser(r.Context(), u)))
		})
	}
}

func TestASignedInUserIsCappedByNameAndJournalledByID(t *testing.T) {
	h := startEndpoint(t, func(c *Config) { c.Connections = NewConnectionTable(0, 1) },
		signedIn(auth.User{ID: "id-7", Name: "Ada", Authenticated: true}))
	h.dial(t, "/sync/doc")
	if got := h.rooms.lastMember(t).ActorID(); got != "id-7" {
		t.Fatalf("actor %q, want the stable id", got)
	}
	if second := h.dial(t, "/sync/doc"); second.response.StatusCode != 429 || second.body != "too many connections\n" {
		t.Fatalf("second: %d %q", second.response.StatusCode, second.body)
	}
}

// An empty name falls back to the id, or the user would have no cap.
func TestASignedInUserWithAnEmptyNameIsCappedByID(t *testing.T) {
	h := startEndpoint(t, func(c *Config) { c.Connections = NewConnectionTable(0, 1) },
		signedIn(auth.User{ID: "id-7", Authenticated: true}))
	h.dial(t, "/sync/doc")
	if second := h.dial(t, "/sync/doc"); second.response.StatusCode != 429 || second.body != "too many connections\n" {
		t.Fatalf("second: %d %q", second.response.StatusCode, second.body)
	}
}

func TestTheHookIsAskedWithTheTicketsClaims(t *testing.T) {
	hook := &fakeAuthorization{read: true, write: true}
	h := startEndpoint(t, func(c *Config) { c.Auth = "ticket"; c.Authorization = hook }, nil)
	h.dial(t, "/sync/doc-42", ticketOffer("blok-sync.v1", readTicket)...)
	want := auth.User{ID: "u1", Name: "u1", Doc: "doc-42", Write: false, Authenticated: true}
	if len(hook.calls()) != 1 || hook.calls()[0] != want {
		t.Fatalf("hook saw %+v", hook.calls())
	}
}

func TestADeniedReadIsAcceptedThenClosed4403(t *testing.T) {
	hook := &fakeAuthorization{read: false}
	h := startEndpoint(t, func(c *Config) { c.Auth = "ticket"; c.Authorization = hook }, nil)
	client := h.dial(t, "/sync/doc-42", ticketOffer("blok-sync.v1", writeTicket)...)
	if got := client.closeFrame(t); got != CloseForbidden {
		t.Fatalf("closed %+v", got)
	}
	if h.rooms.joins() != 0 {
		t.Fatal("a denied reader joined the room")
	}
}

func TestADeniedWriteMakesAWriteTicketReadOnly(t *testing.T) {
	hook := &fakeAuthorization{read: true, write: false}
	h := startEndpoint(t, func(c *Config) { c.Auth = "ticket"; c.Authorization = hook }, nil)
	h.dial(t, "/sync/doc-42", ticketOffer("blok-sync.v1", writeTicket)...)
	if h.rooms.lastMember(t).CanWrite() {
		t.Fatal("joined as a writer")
	}
}

func TestASpentWindowIsRefusedBeforeTheHookRuns(t *testing.T) {
	hook := &fakeAuthorization{read: true, write: true}
	h := startEndpoint(t, func(c *Config) {
		c.Auth = "ticket"
		c.Authorization = hook
		c.RateLimit = func(string) bool { return false }
	}, nil)
	client := h.dial(t, "/sync/doc-42", ticketOffer("blok-sync.v1", writeTicket)...)
	if client.response.StatusCode != 429 || client.body != "rate limit exceeded\n" || len(hook.calls()) != 0 {
		t.Fatalf("status %d body %q hook calls %d", client.response.StatusCode, client.body, len(hook.calls()))
	}
}

// The window is billed to the address until a pass verifies, then to its user.
func TestTheRateLimitKeyFollowsTheVerifiedPass(t *testing.T) {
	var mu sync.Mutex
	var keys []string
	h := startEndpoint(t, func(c *Config) {
		c.Auth = "ticket"
		c.RateLimit = func(key string) bool { mu.Lock(); keys = append(keys, key); mu.Unlock(); return true }
	}, nil)
	h.dial(t, "/sync/doc-42", ticketOffer("blok-sync.v1")...).closeFrame(t)
	h.dial(t, "/sync/doc-42", ticketOffer("blok-sync.v1", writeTicket)...)
	h.dial(t, "/sync/doc-42", "Origin", "https://evil.example")
	if strings.Join(keys, " ") != "addr:127.0.0.1 user:u1" {
		t.Fatalf("keys %q", keys)
	}
	if h.rooms.lastMember(t).ActorID() != "u1" {
		t.Fatal("the actor is not the ticket's user")
	}
}

func TestAUserlessPassIsClosed4401(t *testing.T) {
	h := startEndpoint(t, ticketMode, nil)
	if got := h.dial(t, "/sync/doc-42", ticketOffer("blok-sync.v1", userlessTicket)...).closeFrame(t); got != CloseUserlessPass {
		t.Fatalf("closed %+v", got)
	}
}

func TestJoinStatusesAnswerBeforeOrAfterTheUpgrade(t *testing.T) {
	cases := []struct {
		status collab.JoinStatus
		code   int
		body   string
		close  CloseFrame
	}{
		{collab.JoinDraining, 503, "shutting down\n", CloseFrame{}},
		{collab.JoinForbidden, 403, "forbidden\n", CloseFrame{}},
		{collab.JoinPurged, 403, "forbidden\n", CloseFrame{}},
		{collab.JoinSeedFailed, 101, "", CloseSeedFailed},
		{collab.JoinUnavailable, 101, "", CloseSeedFailed},
	}
	for _, c := range cases {
		h := startEndpoint(t, nil, nil)
		h.rooms.answer(c.status, nil)
		client := h.dial(t, "/sync/doc")
		if client.response.StatusCode != c.code || client.body != c.body {
			t.Fatalf("status %d: got %d %q", c.status, client.response.StatusCode, client.body)
		}
		if c.code == 101 {
			if got := client.closeFrame(t); got != c.close {
				t.Fatalf("status %d: closed %+v", c.status, got)
			}
		} else if ct := client.response.Header.Get("Content-Type"); ct != "text/plain; charset=utf-8" {
			t.Fatalf("status %d: content type %q", c.status, ct)
		}
	}
}

func TestAtTheProcessCeilingAnUpgradeIs503BeforeTheRoomIsJoined(t *testing.T) {
	h := startEndpoint(t, func(c *Config) { c.Connections = NewConnectionTable(1, 8) }, nil)
	h.dial(t, "/sync/doc")
	client := h.dial(t, "/sync/doc")
	if client.response.StatusCode != 503 || client.body != "too many connections on this server\n" {
		t.Fatalf("got %d %q", client.response.StatusCode, client.body)
	}
	if h.rooms.joins() != 1 {
		t.Fatalf("%d joins", h.rooms.joins())
	}
}

func TestAJoinErrorLeavesNoSocket(t *testing.T) {
	h := startEndpoint(t, nil, nil)
	h.rooms.answer(collab.JoinJoined, errors.New("boom"))
	if client := h.dial(t, "/sync/doc"); client.response.StatusCode != 500 {
		t.Fatalf("got %d", client.response.StatusCode)
	}
}

func TestRecheckAsksTheHookForReadAndForWriteOnlyForAWriter(t *testing.T) {
	hook := &fakeAuthorization{read: true, write: true}
	h := startEndpoint(t, func(c *Config) { c.Auth = "ticket"; c.Authorization = hook }, nil)
	h.dial(t, "/sync/doc-42", ticketOffer("blok-sync.v1", writeTicket)...)
	writer := h.rooms.lastMember(t)
	h.dial(t, "/sync/doc-42", ticketOffer("blok-sync.v1", readTicket)...)
	reader := h.rooms.lastMember(t)

	hook.set(func(a *fakeAuthorization) { a.write = false })
	if ok, _ := writer.RecheckAccess(context.Background()); ok {
		t.Fatal("a writer that lost write kept access")
	}
	if ok, _ := reader.RecheckAccess(context.Background()); !ok {
		t.Fatal("a reader lost access over write")
	}
	hook.set(func(a *fakeAuthorization) { a.read = false })
	if ok, _ := reader.RecheckAccess(context.Background()); ok {
		t.Fatal("a revoked reader kept access")
	}
	hook.set(func(a *fakeAuthorization) { a.err = errors.New("db down") })
	if _, err := reader.RecheckAccess(context.Background()); err == nil {
		t.Fatal("a hook error was swallowed")
	}
}

func TestFramesReachTheRoomAndRoomFramesReachThePeer(t *testing.T) {
	h := startEndpoint(t, nil, nil)
	client := h.dial(t, "/sync/doc")
	member := h.rooms.lastMember(t)
	member.Send([]byte{100, 1})
	_ = client.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if frame := readServerFrame(t, client.reader); frame.opcode != 0x2 || string(frame.payload) != string([]byte{100, 1}) {
		t.Fatalf("got %+v", frame)
	}
	if _, err := client.conn.Write(clientFrame(0x82, []byte{105, 7})); err != nil {
		t.Fatal(err)
	}
	membership := h.rooms.membership(0)
	deadline := time.Now().Add(5 * time.Second)
	for membership.count() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if membership.count() != 1 {
		t.Fatal("the frame never reached the room")
	}
	member.Close(collab.CloseReset)
	if got := client.closeFrame(t); got != CloseReset {
		t.Fatalf("closed %+v", got)
	}
}

// drain reads frames until the close and returns the binary count and the close.
func drain(t *testing.T, c *clientConn) (int, CloseFrame) {
	t.Helper()
	_ = c.conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	binaries := 0
	for {
		frame := readServerFrame(t, c.reader)
		switch frame.opcode {
		case 0x2:
			binaries++
		case 0x8:
			return binaries, CloseFrame{uint16(frame.payload[0])<<8 | uint16(frame.payload[1]), string(frame.payload[2:])}
		}
	}
}

// APeerThatStopsReadingIsClosed1008WhileTheOthersKeepReceiving, over a real
// socket: the stalled peer gets every admitted frame, then 1008.
func TestAPeerThatStopsReadingIsClosed1008WhileTheOthersKeepReceiving(t *testing.T) {
	const frames = 96
	h := startEndpoint(t, func(c *Config) { c.MaxMessageBytes = 256 * 1024 }, nil)
	stalled := h.dial(t, "/sync/doc")
	stalledMember := h.rooms.lastMember(t).(*SocketMember)
	healthy := h.dial(t, "/sync/doc")
	healthyMember := h.rooms.lastMember(t)

	presence := make([]byte, 200*1024)
	presence[0] = 1
	admitted := 0
	for range frames {
		if stalledMember.RequestedClose() == nil {
			admitted++
		}
		stalledMember.Send(presence)
		healthyMember.Send(presence)
		_ = healthy.conn.SetReadDeadline(time.Now().Add(10 * time.Second))
		if frame := readServerFrame(t, healthy.reader); frame.opcode != 0x2 || len(frame.payload) != len(presence) {
			t.Fatalf("the healthy peer got %x, %d bytes", frame.opcode, len(frame.payload))
		}
	}
	if got := stalledMember.RequestedClose(); got == nil || *got != CloseSlowConsumer {
		t.Fatalf("19 MiB at a stalled peer: close %v", got)
	}
	received, close := drain(t, stalled)
	if close != CloseSlowConsumer {
		t.Fatalf("closed %+v", close)
	}
	// The frame that tripped the cap was not admitted; every other one was sent.
	if received != admitted-1 {
		t.Fatalf("received %d of %d admitted frames before the close", received, admitted-1)
	}
	if healthyMember.(*SocketMember).RequestedClose() != nil {
		t.Fatal("the healthy peer was closed")
	}
}

// ARevokedReaderDropsQueuedFramesBeforeTheForbiddenClose, over a real socket.
func TestARevokedReaderDropsQueuedFramesBeforeTheForbiddenClose(t *testing.T) {
	const frames = 64
	h := startEndpoint(t, func(c *Config) { c.MaxMessageBytes = 4 * 1024 * 1024 }, nil)
	revoked := h.dial(t, "/sync/doc")
	member := h.rooms.lastMember(t)
	update := make([]byte, 400*1024)
	update[1] = 2
	for range frames {
		member.Send(update)
	}
	member.Close(collab.CloseForbidden)
	received, close := drain(t, revoked)
	if close != CloseForbidden {
		t.Fatalf("closed %+v", close)
	}
	if received >= frames {
		t.Fatalf("received all %d queued frames after revocation", received)
	}
}

// Measured on Kestrel: "500", Content-Length: 0, no body, and the
// connection stays open.
func TestAHookErrorBeforeTheUpgradeIsAnEmpty500ThatKeepsTheConnection(t *testing.T) {
	hook := &fakeAuthorization{err: errors.New("authorization unavailable")}
	h := startEndpoint(t, func(c *Config) { c.Auth = "ticket"; c.Authorization = hook }, nil)
	conn, err := net.Dial("tcp", h.server.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	request := "GET /sync/doc-42 HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n" +
		"Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
		"Origin: https://app.example.com\r\nSec-WebSocket-Protocol: blok-sync.v1, " + writeTicket + "\r\n\r\n"
	if _, err := io.WriteString(conn, request); err != nil {
		t.Fatal(err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	var got []byte
	buffer := make([]byte, 4096)
	for {
		n, err := conn.Read(buffer)
		got = append(got, buffer[:n]...)
		if err != nil {
			var timeout net.Error
			if !errors.As(err, &timeout) || !timeout.Timeout() {
				t.Fatalf("connection ended: %v after %q", err, got)
			}
			break
		}
	}
	head, body, _ := strings.Cut(string(got), "\r\n\r\n")
	lines := strings.Split(head, "\r\n")
	var names []string
	for _, line := range lines[1:] {
		name, _, _ := strings.Cut(line, ":")
		names = append(names, name)
	}
	if lines[0] != "HTTP/1.1 500 Internal Server Error" || body != "" ||
		strings.Join(names, ",") != "Content-Length,Date" || lines[1] != "Content-Length: 0" {
		t.Fatalf("got %q", got)
	}
}

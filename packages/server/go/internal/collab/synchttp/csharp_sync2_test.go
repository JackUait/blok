package synchttp

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/auth"
	"github.com/JackUait/blok/packages/server/go/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/internal/collab/room"
	"github.com/JackUait/blok/packages/server/go/internal/collab/wire"
	"github.com/JackUait/blok/packages/server/go/internal/collab/workingset"
)

// Twins of the rest of C# SyncEndpointTests: caps, frame limits and the
// inbound budget over a real socket and a real room manager.

type syn2Options struct {
	ticket bool
	auth   string
	hook   auth.Authorization
	// journalDir non-empty runs the built-in journal there.
	journalDir string
	operations room.OperationStore
	perUser    int
	maxMessage int
	budget     *BudgetOptions
	clock      func() time.Time
}

// syn2Start is synStart with the options these cases set.
func syn2Start(t *testing.T, o syn2Options) *synApp {
	t.Helper()
	app := &synApp{endpoint: &synEndpoint{docs: map[string]string{synDoc: "seeded"}}}
	app.store = workingset.NewLocalStore(t.TempDir(), nil)
	operations := o.operations
	var roomOptions room.Options
	if o.journalDir != "" {
		store, err := journal.NewStore(o.journalDir, journal.StoreOptions{})
		if err != nil {
			t.Fatal(err)
		}
		app.journal = &synJournal{LocalJournal: room.LocalJournal{Store: store}}
		operations = app.journal
		roomOptions.MaxUpdateBytes = store.MaxUpdateBytes()
	}
	app.manager = room.NewManager(room.ManagerOptions{
		Store: app.store, Endpoint: app.endpoint, Converter: synConverter{}, Room: roomOptions, Operations: operations,
	})
	perUser := o.perUser
	if perUser == 0 {
		perUser = 8
	}
	app.harness = startEndpoint(t, func(c *Config) {
		c.Rooms = app.manager
		c.HasOperationStore = operations != nil
		c.Connections = NewConnectionTable(0, perUser)
		if o.ticket {
			c.Auth = "ticket"
		} else if o.auth != "" {
			c.Auth = o.auth
		}
		if o.hook != nil {
			c.Authorization = o.hook
		}
		if o.maxMessage != 0 {
			c.MaxMessageBytes = o.maxMessage
		}
		if o.budget != nil {
			c.Budget = *o.budget
		}
		c.BudgetClock = o.clock
	}, nil)
	t.Cleanup(func() { syn2Drain(app) })
	return app
}

func syn2Drain(app *synApp) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = app.manager.Drain(ctx)
}

// syn2Clock is C# FakeClock: it moves only when told to.
type syn2Clock struct {
	mu  sync.Mutex
	now time.Time
}

func newSyn2Clock() *syn2Clock {
	return &syn2Clock{now: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
}

func (c *syn2Clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *syn2Clock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// syn2Sign is C# TicketFixture.Sign with the fixture header.
func syn2Sign(payload string) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	input := header + "." + base64.RawURLEncoding.EncodeToString([]byte(payload))
	mac := hmac.New(sha256.New, []byte(testSecret))
	mac.Write([]byte(input))
	return input + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (c *synClient) sendRaw(t *testing.T, first byte, payload []byte) {
	t.Helper()
	if _, err := c.conn.Write(clientFrame(first, payload)); err != nil {
		t.Fatal(err)
	}
}

// openNoOrigin connects with no Origin header, as C# ConnectAsync(origin: null).
func (a *synApp) openNoOrigin(t *testing.T) *synClient {
	t.Helper()
	c := &synClient{a.dial(t, "/sync/"+synDoc)}
	if c.response.StatusCode != 101 {
		t.Fatalf("upgrade refused: %d %q", c.response.StatusCode, c.body)
	}
	return c
}

// syn2PresenceOfLength is one client (id 1000, clock 1) whose JSON string
// state makes the payload exactly length bytes.
func syn2PresenceOfLength(length int) []byte {
	const head = 4
	for prefix := 1; prefix <= 4; prefix++ {
		stateLength := length - head - prefix
		if stateLength >= 2 && syn2VarUintLength(stateLength) == prefix {
			payload := []byte{1, 0xe8, 0x07, 1}
			for value := stateLength; ; {
				current := byte(value & 0x7f)
				value >>= 7
				if value == 0 {
					payload = append(payload, current)
					break
				}
				payload = append(payload, current|0x80)
			}
			payload = append(payload, '"')
			payload = append(payload, []byte(strings.Repeat("x", stateLength-2))...)
			return append(payload, '"')
		}
	}
	panic("no presence of that length")
}

func syn2VarUintLength(value int) int {
	bytes := 1
	for value >>= 7; value != 0; value >>= 7 {
		bytes++
	}
	return bytes
}

func syn2ExpectClose(t *testing.T, c *synClient, want CloseFrame) {
	t.Helper()
	if got := c.closeFrame(t); got != want {
		t.Fatalf("closed %+v, want %+v", got, want)
	}
}

// --- connections and identity ---

// Client 2 at the clock bob holds it at, with a null state: the removal a
// stock y-protocols client applies.
func TestWithdrawsThePresenceOfAConnectionThatJustDisappears(t *testing.T) {
	app := syn2Start(t, syn2Options{})
	alice := app.open(t)
	bob := app.open(t)

	synNext[wire.QueryAwareness](t, alice)
	alice.send(t, wire.Awareness{Update: synPresence(2)})
	if got := synNext[wire.Awareness](t, bob); !synEqual(got.Update, synPresence(2)) {
		t.Fatalf("bob got %x", got.Update)
	}

	alice.conn.Close()

	if got := synNext[wire.Awareness](t, bob); !synEqual(got.Update, []byte{1, 2, 1, 4, 'n', 'u', 'l', 'l'}) {
		t.Fatalf("bob got %x", got.Update)
	}
}

func TestTheNinthConnectionForOneUserAndDocIsRefusedWhileAnotherUserStillJoins(t *testing.T) {
	app := syn2Start(t, syn2Options{ticket: true})
	for range 8 {
		synNext[wire.BlokControl](t, app.openTicket(t, writeTicket))
	}

	if refused := app.connect(t, synDoc, synProtocol, writeTicket); refused.response.StatusCode != 429 {
		t.Fatalf("ninth: %d %q", refused.response.StatusCode, refused.body)
	}
	synNext[wire.BlokControl](t, app.openTicket(t, synUserTwoTicket))
}

func TestClosingAConnectionFreesItsSlot(t *testing.T) {
	app := syn2Start(t, syn2Options{ticket: true, perUser: 1})
	first := app.openTicket(t, writeTicket)
	synNext[wire.BlokControl](t, first)
	if refused := app.connect(t, synDoc, synProtocol, writeTicket); refused.response.StatusCode != 429 {
		t.Fatalf("second while held: %d %q", refused.response.StatusCode, refused.body)
	}

	first.sendRaw(t, 0x88, []byte{0x03, 0xe8})
	if close := readClose(t, first.reader); close != CloseNormal {
		t.Fatalf("first closed %+v", close)
	}

	synNext[wire.BlokControl](t, app.openTicket(t, writeTicket))
}

func TestATicketWithoutAUserIsClosed4401(t *testing.T) {
	for name, payload := range map[string]string{
		"empty user": `{"user":"","doc":"doc-42","write":true,"exp":4102444800}`,
		"no user":    `{"doc":"doc-42","write":true,"exp":4102444800}`,
	} {
		t.Run(name, func(t *testing.T) {
			app := syn2Start(t, syn2Options{ticket: true})
			client := app.openTicket(t, syn2Sign(payload))
			if got := client.subProtocol(); got != synProtocol {
				t.Fatalf("subprotocol %q", got)
			}
			syn2ExpectClose(t, client, CloseUserlessPass)

			synNext[wire.BlokControl](t, app.openTicket(t, writeTicket))
		})
	}
}

// Behind a proxy or on loopback every socket shares one address; a cap
// keyed on it would be a per-doc cap for everyone.
func TestConnectionsWithoutAUserIdentityAreNotCapped(t *testing.T) {
	for _, mode := range []string{"none", "proxy"} {
		t.Run(mode, func(t *testing.T) {
			app := syn2Start(t, syn2Options{auth: mode, perUser: 1})
			first := app.openNoOrigin(t)
			second := app.openNoOrigin(t)
			if got := synSyncedText(t, first); got != "seeded" {
				t.Fatalf("first: %q", got)
			}
			if got := synSyncedText(t, second); got != "seeded" {
				t.Fatalf("second: %q", got)
			}
		})
	}
}

// --- frames ---

func TestAnOversizedFrameCloses1009(t *testing.T) {
	app := syn2Start(t, syn2Options{maxMessage: 1024})
	client := app.open(t)

	client.sendRaw(t, 0x82, make([]byte, 1025))

	syn2ExpectClose(t, client, CloseTooBig)
}

func TestAFrameAtTheLimitStillReachesTheRoom(t *testing.T) {
	app := syn2Start(t, syn2Options{maxMessage: 1024})
	alice := app.open(t)
	bob := app.open(t)
	frame, err := wire.Encode(wire.Awareness{Update: syn2PresenceOfLength(1021)})
	if err != nil || len(frame) != 1024 {
		t.Fatalf("frame of %d bytes, %v", len(frame), err)
	}

	alice.sendRaw(t, 0x82, frame)

	if got := synNext[wire.Awareness](t, bob); len(got.Update) != 1021 {
		t.Fatalf("bob got %d bytes", len(got.Update))
	}
}

// C# runs this on TestServer and on Kestrel; Go has only the real socket.
func TestATextFrameIsClosed1003BeforeItIsParsed(t *testing.T) {
	app := syn2Start(t, syn2Options{})
	client := app.open(t)

	client.sendRaw(t, 0x81, []byte("hello"))

	syn2ExpectClose(t, client, CloseTextFrame)
}

// One message as thousands of empty continuation frames: the budget only
// sees a message once it ends, so the frames themselves must be metered.
func TestAFloodOfEmptyContinuationFramesCloses1008(t *testing.T) {
	app := syn2Start(t, syn2Options{})
	client := app.open(t)

	var flood []byte
	flood = append(flood, clientFrame(0x02, []byte{1})...)
	for range 10_000 {
		flood = append(flood, clientFrame(0x00, nil)...)
	}
	flood = append(flood, clientFrame(0x80, []byte{0})...)
	// The server may close part way; a write error after that is expected.
	go func() { _, _ = client.conn.Write(flood) }()

	syn2ExpectClose(t, client, CloseInboundRateExceeded)
}

// --- the inbound budget ---

var syn2TenASecond = BudgetOptions{FramesPerSecond: 10, BurstFrames: 10, ResyncsPerMinute: 60, AwarenessBytesPerSecond: 128 << 10}

// The clock never moves, so nothing refills: the eleventh frame is over.
func TestAnInboundBurstOverTheBudgetCloses1008(t *testing.T) {
	budget := syn2TenASecond
	app := syn2Start(t, syn2Options{budget: &budget, clock: newSyn2Clock().Now})
	client := app.open(t)

	for i := range 12 {
		client.send(t, wire.Awareness{Update: synPresence(byte(i))})
	}

	syn2ExpectClose(t, client, CloseInboundRateExceeded)
}

// Ten frames a second for three seconds: three times the burst, never over
// the rate. Bob's copy proves each one reached the room.
func TestASustainedLegitimateCadenceRefillsTheBudgetAndStaysOpen(t *testing.T) {
	budget := syn2TenASecond
	clock := newSyn2Clock()
	app := syn2Start(t, syn2Options{budget: &budget, clock: clock.Now})
	alice := app.open(t)
	bob := app.open(t)

	for i := range 30 {
		alice.send(t, wire.Awareness{Update: synPresence(byte(i))})
		if got := synNext[wire.Awareness](t, bob); !synEqual(got.Update, synPresence(byte(i))) {
			t.Fatalf("frame %d: bob got %x", i, got.Update)
		}
		clock.Advance(100 * time.Millisecond)
	}

	alice.send(t, wire.Awareness{Update: synPresence(0x7f)})
	if got := synNext[wire.Awareness](t, bob); !synEqual(got.Update, synPresence(0x7f)) {
		t.Fatalf("bob got %x", got.Update)
	}
}

func syn2Storm(t *testing.T, frame []byte, count int) {
	t.Helper()
	app := syn2Start(t, syn2Options{clock: newSyn2Clock().Now})
	client := app.open(t)
	for range count {
		client.sendRaw(t, 0x82, frame)
	}
	syn2ExpectClose(t, client, CloseInboundRateExceeded)
}

func syn2Encode(t *testing.T, message wire.Message) []byte {
	t.Helper()
	frame, err := wire.Encode(message)
	if err != nil {
		t.Fatal(err)
	}
	return frame
}

// Twelve frames are nothing to the 100-frame burst; each asks for the whole document.
func TestAResyncStormCloses1008WhileTheFrameBudgetStillHasRoom(t *testing.T) {
	syn2Storm(t, syn2Encode(t, wire.SyncStep1{StateVector: synNewDoc().EncodeStateVector()}), 12)
}

func TestAQueryAwarenessStormCloses1008LikeAResyncStorm(t *testing.T) {
	syn2Storm(t, syn2Encode(t, wire.QueryAwareness{}), 12)
}

// [type 0][sub-type 0][len 1][empty state vector], type and sub-type as
// two-byte varuints: the room still reads it as SyncStep1.
func TestAResyncStormEncodedWithOverlongVarUintsIsStillAResyncStorm(t *testing.T) {
	syn2Storm(t, []byte{0x80, 0x00, 0x80, 0x00, 0x01, 0x00}, 12)
}

// Six legal frames, 600 KB of presence in one instant.
func TestAPresenceFloodOverTheAwarenessByteBudgetCloses1008(t *testing.T) {
	syn2Storm(t, syn2Encode(t, wire.Awareness{Update: syn2PresenceOfLength(100_000)}), 6)
}

func TestADocumentPasteOfTheSameSizeIsNotMeteredAsPresence(t *testing.T) {
	app := syn2Start(t, syn2Options{clock: newSyn2Clock().Now})
	client := app.open(t)
	doc := synSynced(t, client)
	paste := synAppend(doc, strings.Repeat("x", 100_000))

	for range 6 {
		client.send(t, wire.SyncUpdate{Update: paste})
	}

	if got := synSyncedText(t, client); !strings.HasPrefix(got, "seeded") {
		t.Fatalf("text %q", got)
	}
}

func TestAnUpdateStormOfTheSameSizeIsNotAResyncStorm(t *testing.T) {
	app := syn2Start(t, syn2Options{clock: newSyn2Clock().Now})
	client := app.open(t)
	doc := synSynced(t, client)
	update := synAppend(doc, " once")

	for range 12 {
		client.send(t, wire.SyncUpdate{Update: update})
	}

	if got := synSyncedText(t, client); got != "seeded once" {
		t.Fatalf("text %q", got)
	}
}

// --- purge, restart and drain ---

// syn2Hook is synHook with C# RecordingAuthorization.AllowRead.
type syn2Hook struct {
	*synHook
	denyAllReads atomic.Bool
}

func (h *syn2Hook) CanReadDocument(ctx context.Context, u auth.User, doc string) (bool, error) {
	allowed, err := h.synHook.CanReadDocument(ctx, u, doc)
	if err != nil {
		return false, err
	}
	return allowed && !h.denyAllReads.Load(), nil
}

func TestTwoUsersKeepRestoredContentButCannotReopenAfterPermanentPurge(t *testing.T) {
	directory := t.TempDir()
	hook := &syn2Hook{synHook: newSynHook()}
	app := syn2Start(t, syn2Options{ticket: true, hook: hook, journalDir: directory})

	alice := app.openTicket(t, writeTicket)
	synNext[wire.BlokControl](t, alice)
	if got := synSyncedText(t, alice); got != "seeded" {
		t.Fatalf("alice: %q", got)
	}
	bob := app.open(t, synProtocolV2, synUserTwoTicket)
	bobDoc := synNewDoc()
	lineage := synHandshakeV2(t, bob, bobDoc)
	if got := synText(bobDoc); got != "seeded" {
		t.Fatalf("bob: %q", got)
	}
	synNext[wire.QueryAwareness](t, alice)

	hook.edit(func(h *synHook) { h.deniedRead["u1"] = true })
	if closed, err := app.manager.RecheckAccess(context.Background(), synDoc); err != nil || closed != 1 {
		t.Fatalf("first recheck = %d, %v", closed, err)
	}
	update := synAppend(bobDoc, " kept")
	bob.send(t, wire.Operation{Lineage: lineage, OperationID: synOpOne, Update: update})
	if got := synNext[wire.SyncUpdate](t, bob); !synEqual(got.Update, update) {
		t.Fatalf("relayed %x", got.Update)
	}
	if ack := synNext[wire.Acknowledgement](t, bob); ack.OperationID != synOpOne {
		t.Fatalf("ack %+v", ack)
	}
	if message, close := alice.receiveOrClose(t); close == nil || *close != CloseForbidden {
		t.Fatalf("alice got %T %+v, close %v", message, message, close)
	}

	// The host trashes the page: every read is denied.
	hook.denyAllReads.Store(true)
	if closed, err := app.manager.RecheckAccess(context.Background(), synDoc); err != nil || closed != 1 {
		t.Fatalf("second recheck = %d, %v", closed, err)
	}
	syn2ExpectClose(t, bob, CloseForbidden)

	// Restored from the trash.
	hook.denyAllReads.Store(false)
	restored := app.openTicket(t, synUserTwoTicket)
	synNext[wire.BlokControl](t, restored)
	if got := synSyncedText(t, restored); got != "seeded kept" {
		t.Fatalf("restored: %q", got)
	}

	// The host commits its tombstone, then purges.
	hook.denyAllReads.Store(true)
	outcome, err := app.manager.Purge(context.Background(), synDoc, func(context.Context) (bool, error) { return true, nil })
	if err != nil || outcome != journal.Purged {
		t.Fatalf("Purge = %v, %v", outcome, err)
	}
	syn2ExpectClose(t, restored, CloseForbidden)
	syn2Drain(app)

	restarted := syn2Start(t, syn2Options{journalDir: directory})
	if refused := restarted.connect(t, synDoc); refused.response.StatusCode != 403 {
		t.Fatalf("after restart: %d %q", refused.response.StatusCode, refused.body)
	}
	if gets := restarted.endpoint.getCount(); gets != 0 {
		t.Fatalf("%d seed GETs after restart", gets)
	}
}

func TestRestartedJournalTombstoneRefusesAnOldConsumerDocument(t *testing.T) {
	directory := t.TempDir()
	original := syn2Start(t, syn2Options{journalDir: directory})
	outcome, err := original.manager.Purge(context.Background(), synDoc, func(context.Context) (bool, error) { return true, nil })
	if err != nil || outcome != journal.Purged {
		t.Fatalf("Purge = %v, %v", outcome, err)
	}
	syn2Drain(original)

	restarted := syn2Start(t, syn2Options{journalDir: directory})
	if refused := restarted.connect(t, synDoc); refused.response.StatusCode != 403 {
		t.Fatalf("after restart: %d %q", refused.response.StatusCode, refused.body)
	}
	if gets := restarted.endpoint.getCount(); gets != 0 {
		t.Fatalf("%d seed GETs", gets)
	}
	if live := restarted.manager.LiveRoomCount(); live != 0 {
		t.Fatalf("%d live rooms", live)
	}
}

// syn2Purged is an operation store whose document is already purged.
type syn2Purged struct{}

func (syn2Purged) Open(context.Context, string) (journal.OpenOutcome, room.OperationSession, error) {
	return journal.DocumentPurged, nil, nil
}

func TestAPurgedDocumentRefusesSyncBeforeUpgrade(t *testing.T) {
	app := syn2Start(t, syn2Options{operations: syn2Purged{}})

	if refused := app.connect(t, synDoc); refused.response.StatusCode != 403 {
		t.Fatalf("got %d %q", refused.response.StatusCode, refused.body)
	}
	if gets := app.endpoint.getCount(); gets != 0 {
		t.Fatalf("%d seed GETs", gets)
	}
}

func TestDrainingRefusesNewUpgradesWith503AndCloses1001(t *testing.T) {
	app := syn2Start(t, syn2Options{})
	client := app.open(t)
	if got := synSyncedText(t, client); got != "seeded" {
		t.Fatalf("client: %q", got)
	}

	if err := app.manager.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}

	syn2ExpectClose(t, client, CloseDraining)
	if refused := app.connect(t, synDoc); refused.response.StatusCode != 503 {
		t.Fatalf("after drain: %d %q", refused.response.StatusCode, refused.body)
	}
}

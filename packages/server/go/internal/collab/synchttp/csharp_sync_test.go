package synchttp

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/auth"
	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/internal/collab/docendpoint"
	"github.com/JackUait/blok/packages/server/go/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/internal/collab/room"
	"github.com/JackUait/blok/packages/server/go/internal/collab/wire"
	"github.com/JackUait/blok/packages/server/go/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// Twins of C# SyncEndpointTests and SyncHandshakeTests cases that had no Go
// twin: the endpoint over a real room manager, as C# SyncApp runs it.

const (
	synDoc        = "doc-42"
	synProtocol   = "blok-sync.v1"
	synProtocolV2 = "blok-sync.v2"
	synOrigin     = "https://app.example.com"
	synOpOne      = "0123456789abcdef0123456789abcdef"
)

var synUserTwoTicket = mint(`{"user":"u2","doc":"doc-42","write":true,"exp":4102444800}`)

// --- C# FakeDocEndpoint: holds doc-42 as "seeded" and counts GETs ---

type synEndpoint struct {
	mu      sync.Mutex
	docs    map[string]string
	gets    int
	loadErr error
}

func (e *synEndpoint) Load(_ context.Context, docID string) (*docendpoint.Loaded, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.gets++
	if e.loadErr != nil {
		return nil, e.loadErr
	}
	text, ok := e.docs[docID]
	if !ok {
		return &docendpoint.Loaded{}, nil
	}
	body, _ := json.Marshal(map[string]string{"text": text})
	data, err := jsjson.ParseNode(body, jsjson.Options{})
	return &docendpoint.Loaded{Data: data}, err
}

func (e *synEndpoint) Save(context.Context, string, any, *string, *docendpoint.Projection) (*string, error) {
	return nil, nil
}

func (e *synEndpoint) getCount() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.gets
}

func (e *synEndpoint) failLoads(err error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.loadErr = err
}

// --- C# FakeDocConverter: one "content" text root, {"text": ...} ---

type synConverter struct{}

var synContent = jsjson.FromString("content")

func synDataText(n *jsjson.Node) string {
	if n == nil || n.Kind != jsjson.KindObject {
		return ""
	}
	value, err := n.Lookup("text")
	if err != nil || value == nil || value.Kind != jsjson.KindString {
		return ""
	}
	text, err := value.Text()
	if err != nil {
		return ""
	}
	return text.String()
}

func synReplace(tx *yjs.Transaction, text *yjs.Text, value string) {
	if length := len(text.String()); length > 0 {
		text.Delete(tx, 0, length)
	}
	if value != "" {
		text.Insert(tx, 0, jsjson.FromString(value), nil)
	}
}

func (synConverter) Seed(_ context.Context, doc *yjs.Doc, outputData *jsjson.Node) error {
	text := doc.GetText(synContent)
	doc.Transact(func(tx *yjs.Transaction) {
		if value := synDataText(outputData); value != "" {
			text.Insert(tx, 0, jsjson.FromString(value), nil)
		}
	})
	return nil
}

func (synConverter) Export(_ context.Context, doc *yjs.Doc) (*jsjson.Object, error) {
	object := &jsjson.Object{}
	object.Set(jsjson.FromString("text"), jsjson.FromString(doc.GetText(synContent).String()))
	return object, nil
}

func (synConverter) ApplyOps(_ context.Context, doc *yjs.Doc, ops []convert.EditOp) error {
	text := doc.GetText(synContent)
	doc.Transact(func(tx *yjs.Transaction) {
		for _, op := range ops {
			switch op := op.(type) {
			case convert.Insert:
				var data *jsjson.Node
				if op.Block != nil {
					data, _ = op.Block.Lookup("data")
				}
				if value := synDataText(data); value != "" {
					text.Insert(tx, len(text.String()), jsjson.FromString(value), nil)
				}
			case convert.Update:
				synReplace(tx, text, synDataText(op.Data))
			default:
				synReplace(tx, text, "")
			}
		}
	})
	return nil
}

func (synConverter) MigrateRichText(context.Context, *yjs.Doc) (int, error) { return 0, nil }

// --- C# RecordingAuthorization, keyed by user ---

type synHook struct {
	mu                    sync.Mutex
	deniedRead            map[string]bool
	deniedWrite           map[string]bool
	failedRead            map[string]bool
	revokeReadAfterWriteU string
}

func newSynHook() *synHook {
	return &synHook{deniedRead: map[string]bool{}, deniedWrite: map[string]bool{}, failedRead: map[string]bool{}}
}

// synUserID is C# UserId: the name, else the id.
func synUserID(u auth.User) string {
	if u.Name != "" {
		return u.Name
	}
	return u.ID
}

func (h *synHook) CanReadDocument(_ context.Context, u auth.User, _ string) (bool, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	id := synUserID(u)
	if h.failedRead[id] {
		return false, errors.New("authorization unavailable")
	}
	return !h.deniedRead[id], nil
}

func (h *synHook) CanWriteDocument(_ context.Context, u auth.User, _ string) (bool, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	id := synUserID(u)
	allowed := !h.deniedWrite[id]
	if id == h.revokeReadAfterWriteU {
		h.deniedRead[id] = true
	}
	return allowed, nil
}

func (h *synHook) edit(change func(*synHook)) {
	h.mu.Lock()
	defer h.mu.Unlock()
	change(h)
}

// --- C# FakeCollabOperationStore's Committed, over the real journal ---

type synJournal struct {
	room.LocalJournal
	mu        sync.Mutex
	committed []operation.Candidate
}

type synSession struct {
	room.OperationSession
	owner *synJournal
}

func (j *synJournal) Open(ctx context.Context, docID string) (journal.OpenOutcome, room.OperationSession, error) {
	outcome, session, err := j.LocalJournal.Open(ctx, docID)
	if session == nil {
		return outcome, nil, err
	}
	return outcome, &synSession{OperationSession: session, owner: j}, err
}

func (s *synSession) Append(ctx context.Context, candidate operation.Candidate) (operation.AppendResult, error) {
	result, err := s.OperationSession.Append(ctx, candidate)
	if err == nil && result.Outcome == operation.Committed {
		s.owner.mu.Lock()
		s.owner.committed = append(s.owner.committed, candidate)
		s.owner.mu.Unlock()
	}
	return result, err
}

func (j *synJournal) commits() []operation.Candidate {
	j.mu.Lock()
	defer j.mu.Unlock()
	return append([]operation.Candidate(nil), j.committed...)
}

// synOpenElsewhere is an operation store whose document is held by another process.
type synOpenElsewhere struct{}

func (synOpenElsewhere) Open(context.Context, string) (journal.OpenOutcome, room.OperationSession, error) {
	return journal.DocumentOpenElsewhere, nil, nil
}

// --- C# SyncApp ---

type synOptions struct {
	ticket     bool
	hook       *synHook
	journal    bool
	operations room.OperationStore
	ceiling    int64
	policy     auth.Authorization
	wrap       func(http.Handler) http.Handler
}

type synApp struct {
	*harness
	manager  *room.Manager
	endpoint *synEndpoint
	store    *workingset.LocalStore
	journal  *synJournal
}

func synStart(t *testing.T, o synOptions) *synApp {
	t.Helper()
	app := &synApp{endpoint: &synEndpoint{docs: map[string]string{synDoc: "seeded"}}}
	app.store = workingset.NewLocalStore(t.TempDir(), nil)
	operations := o.operations
	var roomOptions room.Options
	if o.journal {
		store, err := journal.NewStore(t.TempDir(), journal.StoreOptions{})
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
	app.harness = startEndpoint(t, func(c *Config) {
		c.Rooms = app.manager
		c.HasOperationStore = operations != nil
		c.Connections = NewConnectionTable(o.ceiling, 8)
		if o.ticket {
			c.Auth = "ticket"
		}
		if o.hook != nil {
			c.Authorization = o.hook
		}
		if o.policy != nil {
			c.Authorization = o.policy
		}
	}, o.wrap)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = app.manager.Drain(ctx)
	})
	return app
}

// --- C# SyncClient ---

type synClient struct{ *clientConn }

func (a *synApp) connect(t *testing.T, doc string, protocols ...string) *synClient {
	t.Helper()
	headers := []string{"Origin", synOrigin}
	if len(protocols) > 0 {
		headers = append(headers, "Sec-WebSocket-Protocol", strings.Join(protocols, ", "))
	}
	return &synClient{a.dial(t, "/sync/"+doc, headers...)}
}

// open connects and fails unless the upgrade was accepted.
func (a *synApp) open(t *testing.T, protocols ...string) *synClient {
	t.Helper()
	c := a.connect(t, synDoc, protocols...)
	if c.response.StatusCode != 101 {
		t.Fatalf("upgrade refused: %d %q", c.response.StatusCode, c.body)
	}
	return c
}

func (a *synApp) openTicket(t *testing.T, ticket string) *synClient {
	t.Helper()
	return a.open(t, synProtocol, ticket)
}

func (c *synClient) subProtocol() string { return c.response.Header.Get("Sec-WebSocket-Protocol") }

func (c *synClient) send(t *testing.T, message wire.Message) {
	t.Helper()
	frame, err := wire.Encode(message)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.conn.Write(clientFrame(0x82, frame)); err != nil {
		t.Fatal(err)
	}
}

// receiveOrClose is the next decoded frame, or the close the server sent.
func (c *synClient) receiveOrClose(t *testing.T) (wire.Message, *CloseFrame) {
	t.Helper()
	_ = c.conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	for {
		frame := readServerFrame(t, c.reader)
		switch frame.opcode {
		case 0x2:
			message, failure := wire.Decode(frame.payload)
			if failure != nil {
				t.Fatalf("undecodable frame %x: %v", frame.payload, failure)
			}
			return message, nil
		case 0x8:
			close := CloseFrame{uint16(frame.payload[0])<<8 | uint16(frame.payload[1]), string(frame.payload[2:])}
			return nil, &close
		}
	}
}

func (c *synClient) receive(t *testing.T) wire.Message {
	t.Helper()
	message, close := c.receiveOrClose(t)
	if close != nil {
		t.Fatalf("expected a frame but the socket closed with %+v", *close)
	}
	return message
}

// synNext is C# ReceiveAsync<T>: join-time queryAwareness and identities
// frames are skipped unless they are what is asked for.
func synNext[T wire.Message](t *testing.T, c *synClient) T {
	t.Helper()
	var zero T
	_, wantQuery := any(zero).(wire.QueryAwareness)
	_, wantIdentities := any(zero).(wire.Identities)
	for {
		message := c.receive(t)
		if _, ok := message.(wire.QueryAwareness); ok && !wantQuery {
			continue
		}
		if _, ok := message.(wire.Identities); ok && !wantIdentities {
			continue
		}
		typed, ok := message.(T)
		if !ok {
			t.Fatalf("got %T %+v, want %T", message, message, zero)
		}
		return typed
	}
}

// closeFrame skips data frames, answers the server's close and returns it.
func (c *synClient) closeFrame(t *testing.T) CloseFrame {
	t.Helper()
	for {
		if _, close := c.receiveOrClose(t); close != nil {
			_, _ = c.conn.Write(clientFrame(0x88, []byte{0x03, 0xe8}))
			return *close
		}
	}
}

// --- C# YDocs ---

var synClientIDs atomic.Uint32

func init() { synClientIDs.Store(2_000_000) }

func synNewDoc() *yjs.Doc {
	id := synClientIDs.Add(1)
	return yjs.NewDoc(yjs.Options{ClientID: &id})
}

func synAppend(doc *yjs.Doc, value string) []byte {
	text := doc.GetText(synContent)
	return doc.Transact(func(tx *yjs.Transaction) {
		text.Insert(tx, len(text.String()), jsjson.FromString(value), nil)
	})
}

func synApply(t *testing.T, doc *yjs.Doc, update []byte) {
	t.Helper()
	if result, err := doc.ApplyUpdate(update); err != nil || result.Outcome != yjs.Applied {
		t.Fatalf("apply: %+v, %v", result, err)
	}
}

func synText(doc *yjs.Doc) string { return doc.GetText(synContent).String() }

// synSynced is C# SyncedAsync: one SyncStep1 from an empty client.
func synSynced(t *testing.T, c *synClient) *yjs.Doc {
	t.Helper()
	doc := synNewDoc()
	c.send(t, wire.SyncStep1{StateVector: doc.EncodeStateVector()})
	synApply(t, doc, synNext[wire.SyncStep2](t, c).Update)
	synNext[wire.SyncStep1](t, c)
	return doc
}

func synSyncedText(t *testing.T, c *synClient) string {
	t.Helper()
	return synText(synSynced(t, c))
}

// synPresence is a well-formed one-client awareness payload.
func synPresence(clientID byte) []byte { return []byte{1, clientID, 1, 2, '{', '}'} }

func synEqual(a, b []byte) bool { return string(a) == string(b) }

// --- SyncEndpointTests ---

func TestAtTheProcessCeilingAnUpgradeIs503BeforeTheRoomIsSeeded(t *testing.T) {
	app := synStart(t, synOptions{ceiling: 1})
	held := app.open(t)
	if got := synSyncedText(t, held); got != "seeded" {
		t.Fatalf("held: %q", got)
	}
	getsWhileHeld := app.endpoint.getCount()

	// Another document, so a join would have to seed it.
	if refused := app.connect(t, "doc-43"); refused.response.StatusCode != 503 {
		t.Fatalf("at the ceiling: %d %q", refused.response.StatusCode, refused.body)
	}
	if got := app.endpoint.getCount(); got != getsWhileHeld {
		t.Fatalf("the consumer was asked %d times, want %d", got, getsWhileHeld)
	}

	if _, err := held.conn.Write(clientFrame(0x88, []byte{0x03, 0xe8})); err != nil {
		t.Fatal(err)
	}
	if close := readClose(t, held.reader); close != CloseNormal {
		t.Fatalf("held closed %+v", close)
	}

	// The slot is freed once the request ends, a moment after the close.
	deadline := time.Now().Add(5 * time.Second)
	for {
		admitted := app.connect(t, synDoc)
		if admitted.response.StatusCode == 101 {
			if got := synSyncedText(t, admitted); got != "seeded" {
				t.Fatalf("admitted: %q", got)
			}
			return
		}
		if admitted.response.StatusCode != 503 || time.Now().After(deadline) {
			t.Fatalf("after the close: %d %q", admitted.response.StatusCode, admitted.body)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestRecheckRevokesOneReaderWith4403AndKeepsTheOtherConnected(t *testing.T) {
	hook := newSynHook()
	app := synStart(t, synOptions{ticket: true, hook: hook})
	revoked := app.openTicket(t, writeTicket)
	synNext[wire.BlokControl](t, revoked)
	allowed := app.openTicket(t, synUserTwoTicket)
	synNext[wire.BlokControl](t, allowed)
	hook.edit(func(h *synHook) { h.deniedRead["u1"] = true })

	closed, err := app.manager.RecheckAccess(context.Background(), synDoc)
	if err != nil || closed != 1 {
		t.Fatalf("RecheckAccess = %d, %v", closed, err)
	}
	if close := revoked.closeFrame(t); close != CloseForbidden {
		t.Fatalf("revoked closed %+v", close)
	}
	if got := synSyncedText(t, allowed); got != "seeded" {
		t.Fatalf("allowed: %q", got)
	}
	refused := app.openTicket(t, writeTicket)
	if close := refused.closeFrame(t); close != CloseForbidden {
		t.Fatalf("a revoked reader's reconnect closed %+v", close)
	}
}

func TestRecheckExpelsAWriterWhoLostWriteButKeepsAReadOnlyTicket(t *testing.T) {
	hook := newSynHook()
	app := synStart(t, synOptions{ticket: true, hook: hook})
	writer := app.openTicket(t, writeTicket)
	synNext[wire.BlokControl](t, writer)
	reader := app.openTicket(t, readTicket)
	synNext[wire.BlokControl](t, reader)
	peer := app.openTicket(t, synUserTwoTicket)
	synNext[wire.BlokControl](t, peer)
	hook.edit(func(h *synHook) { h.deniedWrite["u1"] = true })

	closed, err := app.manager.RecheckAccess(context.Background(), synDoc)
	if err != nil || closed != 1 {
		t.Fatalf("RecheckAccess = %d, %v", closed, err)
	}
	if close := writer.closeFrame(t); close != CloseForbidden {
		t.Fatalf("writer closed %+v", close)
	}
	if got := synSyncedText(t, reader); got != "seeded" {
		t.Fatalf("reader: %q", got)
	}
	if got := synSyncedText(t, peer); got != "seeded" {
		t.Fatalf("peer: %q", got)
	}
}

func TestRecheckFailsClosedWhenAuthorizationThrows(t *testing.T) {
	hook := newSynHook()
	app := synStart(t, synOptions{ticket: true, hook: hook})
	revoked := app.openTicket(t, writeTicket)
	synNext[wire.BlokControl](t, revoked)
	allowed := app.openTicket(t, synUserTwoTicket)
	synNext[wire.BlokControl](t, allowed)
	hook.edit(func(h *synHook) { h.failedRead["u1"] = true })

	closed, err := app.manager.RecheckAccess(context.Background(), synDoc)
	if err != nil || closed != 1 {
		t.Fatalf("RecheckAccess = %d, %v", closed, err)
	}
	if close := revoked.closeFrame(t); close != CloseForbidden {
		t.Fatalf("revoked closed %+v", close)
	}
	if got := synSyncedText(t, allowed); got != "seeded" {
		t.Fatalf("allowed: %q", got)
	}
}

// The handshake's write check revokes read; the room's admission check
// sees it and refuses before anything is loaded.
func TestRoomAdmissionRefusesARevocationAfterTheHandshakeWithoutLoading(t *testing.T) {
	hook := newSynHook()
	hook.revokeReadAfterWriteU = "u1"
	app := synStart(t, synOptions{ticket: true, hook: hook})

	if refused := app.connect(t, synDoc, synProtocol, writeTicket); refused.response.StatusCode != 403 {
		t.Fatalf("got %d %q", refused.response.StatusCode, refused.body)
	}
	if gets := app.endpoint.getCount(); gets != 0 {
		t.Fatalf("%d seed GETs", gets)
	}
	if live := app.manager.LiveRoomCount(); live != 0 {
		t.Fatalf("%d live rooms", live)
	}
}

func TestTwoClientsConvergeThroughTheRoom(t *testing.T) {
	app := synStart(t, synOptions{})
	alice := app.open(t)
	bob := app.open(t)
	aliceDoc := synSynced(t, alice)
	bobDoc := synSynced(t, bob)

	update := synAppend(aliceDoc, " from alice")
	alice.send(t, wire.SyncUpdate{Update: update})
	relayed := synNext[wire.SyncUpdate](t, bob)

	if !synEqual(relayed.Update, update) {
		t.Fatalf("relayed %x, sent %x", relayed.Update, update)
	}
	synApply(t, bobDoc, relayed.Update)
	if synText(bobDoc) != "seeded from alice" || synText(aliceDoc) != synText(bobDoc) {
		t.Fatalf("alice %q, bob %q", synText(aliceDoc), synText(bobDoc))
	}
}

func TestALateJoinerGetsSyncStep2ThenSyncStep1ForItsSyncStep1(t *testing.T) {
	app := synStart(t, synOptions{})
	alice := app.open(t)
	aliceDoc := synSynced(t, alice)
	alice.send(t, wire.SyncUpdate{Update: synAppend(aliceDoc, " early")})
	if got := synSyncedText(t, alice); got != "seeded early" {
		t.Fatalf("alice: %q", got)
	}

	late := app.open(t)
	lateDoc := synNewDoc()
	late.send(t, wire.SyncStep1{StateVector: lateDoc.EncodeStateVector()})

	step2 := synNext[wire.SyncStep2](t, late)
	step1 := synNext[wire.SyncStep1](t, late)
	synApply(t, lateDoc, step2.Update)
	if got := synText(lateDoc); got != "seeded early" {
		t.Fatalf("late: %q", got)
	}
	if !synEqual(step1.StateVector, lateDoc.EncodeStateVector()) {
		t.Fatalf("server state vector %x, client %x", step1.StateVector, lateDoc.EncodeStateVector())
	}
}

func TestAwarenessIsRelayedVerbatimAndAJoinQueriesTheOthers(t *testing.T) {
	app := synStart(t, synOptions{})
	alice := app.open(t)
	bob := app.open(t)

	synNext[wire.QueryAwareness](t, alice)

	awareness := synPresence(2)
	alice.send(t, wire.Awareness{Update: awareness})
	if got := synNext[wire.Awareness](t, bob); !synEqual(got.Update, awareness) {
		t.Fatalf("bob got %x", got.Update)
	}

	bob.send(t, wire.QueryAwareness{})
	synNext[wire.QueryAwareness](t, alice)
}

func TestAJoinSendsAnIdentitiesFrame(t *testing.T) {
	app := synStart(t, synOptions{})
	client := app.open(t, synProtocol)

	if message := client.receive(t); !synIsType[wire.BlokControl](message) {
		t.Fatalf("first frame %T", message)
	}
	if message := client.receive(t); !synIsType[wire.Identities](message) {
		t.Fatalf("second frame %T", message)
	}
}

func synIsType[T wire.Message](message wire.Message) bool {
	_, ok := message.(T)
	return ok
}

// synHandshakeV2 is C# HandshakeV2Async: it answers the doc's lineage.
func synHandshakeV2(t *testing.T, c *synClient, doc *yjs.Doc) string {
	t.Helper()
	lineage := synNext[wire.BlokControl](t, c).Tag.Lineage
	c.send(t, wire.SyncStep1{StateVector: doc.EncodeStateVector()})
	synApply(t, doc, synNext[wire.SyncStep2](t, c).Update)
	synNext[wire.SyncStep1](t, c)
	return lineage
}

func TestAV2OperationIsRelayedAcknowledgedAndJournalledAsAClientV2Write(t *testing.T) {
	app := synStart(t, synOptions{journal: true})
	client := app.open(t, synProtocolV2)
	doc := synNewDoc()
	lineage := synHandshakeV2(t, client, doc)
	update := synAppend(doc, "!")

	client.send(t, wire.Operation{Lineage: lineage, OperationID: synOpOne, Update: update})

	// On a v2 session the relay is how a writer sees what was accepted.
	if got := synNext[wire.SyncUpdate](t, client); !synEqual(got.Update, update) {
		t.Fatalf("relayed %x, sent %x", got.Update, update)
	}
	ack := synNext[wire.Acknowledgement](t, client)
	if ack.Lineage != lineage || ack.OperationID != synOpOne || ack.ServerSequence != 1 {
		t.Fatalf("ack %+v", ack)
	}
	commits := app.journal.commits()
	if len(commits) != 1 || commits[0].OperationID != synOpOne || commits[0].Source != operation.SourceClientV2 {
		t.Fatalf("committed %+v", commits)
	}
}

// Presence is not a write, so v2 relays it, before its sync exchange too.
func TestAwarenessFromAV2SessionIsRelayed(t *testing.T) {
	app := synStart(t, synOptions{journal: true})
	peer := app.open(t)
	if got := synSyncedText(t, peer); got != "seeded" {
		t.Fatalf("peer: %q", got)
	}
	writer := app.open(t, synProtocolV2)
	if got := writer.subProtocol(); got != synProtocolV2 {
		t.Fatalf("subprotocol %q", got)
	}

	writer.send(t, wire.Awareness{Update: synPresence(7)})

	if got := synNext[wire.Awareness](t, peer); !synEqual(got.Update, synPresence(7)) {
		t.Fatalf("peer got %x", got.Update)
	}
}

// A raw write on a v2 socket carries no operation id: nothing is applied,
// journalled or relayed, and the socket goes.
func TestARawWriteOnAV2SessionIsClosed1008WithoutReachingAPeer(t *testing.T) {
	for _, asSyncStep2 := range []bool{false, true} {
		name := "update"
		if asSyncStep2 {
			name = "syncStep2"
		}
		t.Run(name, func(t *testing.T) {
			app := synStart(t, synOptions{journal: true})
			writer := app.open(t, synProtocolV2)
			doc := synNewDoc()
			synHandshakeV2(t, writer, doc)
			peer := app.open(t)
			if got := synSyncedText(t, peer); got != "seeded" {
				t.Fatalf("peer: %q", got)
			}
			// The peer's join queued this at the writer.
			synNext[wire.QueryAwareness](t, writer)
			update := synAppend(doc, "!")

			if asSyncStep2 {
				writer.send(t, wire.SyncStep2{Update: update})
			} else {
				writer.send(t, wire.SyncUpdate{Update: update})
			}

			message, close := writer.receiveOrClose(t)
			if close == nil {
				t.Fatalf("expected the close first, got %T %+v", message, message)
			}
			if *close != CloseRawWriteOnV2 {
				t.Fatalf("closed %+v", *close)
			}
			// The writer is excluded from a raw relay, so a leak shows only at the peer.
			_ = peer.conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
			if frame, err := peer.reader.Peek(1); err == nil {
				t.Fatalf("the peer received a frame: %x", frame)
			} else if timeout, ok := err.(net.Error); !ok || !timeout.Timeout() {
				t.Fatalf("the peer's socket ended: %v", err)
			}
			if commits := app.journal.commits(); len(commits) != 0 {
				t.Fatalf("committed %+v", commits)
			}
		})
	}
}

// not-synced is transient: the socket stays up and the same id is accepted later.
func TestAnOperationBeforeTheSyncExchangeIsRejectedAsNotSyncedAndAcceptedAfterIt(t *testing.T) {
	app := synStart(t, synOptions{journal: true})
	client := app.open(t, synProtocolV2)
	doc := synNewDoc()
	lineage := synNext[wire.BlokControl](t, client).Tag.Lineage
	update := synAppend(doc, "!")

	client.send(t, wire.Operation{Lineage: lineage, OperationID: synOpOne, Update: update})

	rejection := synNext[wire.Rejection](t, client)
	if rejection.Code != "not-synced" || rejection.OperationID != synOpOne {
		t.Fatalf("rejection %+v", rejection)
	}
	if commits := app.journal.commits(); len(commits) != 0 {
		t.Fatalf("committed %+v", commits)
	}

	client.send(t, wire.SyncStep1{StateVector: doc.EncodeStateVector()})
	synNext[wire.SyncStep2](t, client)
	synNext[wire.SyncStep1](t, client)
	client.send(t, wire.Operation{Lineage: lineage, OperationID: synOpOne, Update: update})

	synNext[wire.SyncUpdate](t, client)
	if ack := synNext[wire.Acknowledgement](t, client); ack.OperationID != synOpOne {
		t.Fatalf("ack %+v", ack)
	}
	if commits := app.journal.commits(); len(commits) != 1 {
		t.Fatalf("committed %+v", commits)
	}
}

func TestADocumentOpenElsewhereCloses4503(t *testing.T) {
	app := synStart(t, synOptions{operations: synOpenElsewhere{}})
	client := app.open(t, synProtocol)

	if close := client.closeFrame(t); close != CloseSeedFailed {
		t.Fatalf("closed %+v", close)
	}
}

// The HTTP doors map EditPurged and ResetPurged to 403
// (blokserver TestAPurgedDocumentAnswersForbiddenOnEveryDoor); here the
// manager answers them directly, as collabhttp cannot be imported from here.
func TestPurgeClosesTheSocketAndForbidsNewSyncEditAndReset(t *testing.T) {
	app := synStart(t, synOptions{})
	member := app.open(t)
	if got := synSyncedText(t, member); got != "seeded" {
		t.Fatalf("member: %q", got)
	}

	outcome, err := app.manager.Purge(context.Background(), synDoc, func(context.Context) (bool, error) { return true, nil })
	if err != nil || outcome != journal.Purged {
		t.Fatalf("Purge = %v, %v", outcome, err)
	}

	if close := member.closeFrame(t); close != CloseForbidden {
		t.Fatalf("member closed %+v", close)
	}
	if set, err := app.store.Read(context.Background(), synDoc); err != nil || set != nil {
		t.Fatalf("the store still holds the doc: %+v, %v", set, err)
	}
	if live := app.manager.LiveRoomCount(); live != 0 {
		t.Fatalf("%d live rooms", live)
	}
	if refused := app.connect(t, synDoc); refused.response.StatusCode != 403 {
		t.Fatalf("sync after purge: %d %q", refused.response.StatusCode, refused.body)
	}
	block, err := jsjson.ParseNode([]byte(`{"type":"p","data":{"text":"!"}}`), jsjson.Options{})
	if err != nil {
		t.Fatal(err)
	}
	edit, err := app.manager.Edit(context.Background(), synDoc,
		[]convert.EditOp{convert.Insert{ID: "late", Block: block}}, "late", nil, "", nil)
	if err != nil || edit.Status != room.EditPurged {
		t.Fatalf("edit after purge: %+v, %v", edit, err)
	}
	reset, err := app.manager.Reset(context.Background(), synDoc)
	if err != nil || reset.Status != room.ResetPurged {
		t.Fatalf("reset after purge: %+v, %v", reset, err)
	}
	if live := app.manager.LiveRoomCount(); live != 0 {
		t.Fatalf("%d live rooms after edit and reset", live)
	}
	if gets := app.endpoint.getCount(); gets != 1 {
		t.Fatalf("%d seed GETs", gets)
	}
}

func TestASeedFailureIsAcceptedThenClosed4503(t *testing.T) {
	app := synStart(t, synOptions{})
	app.endpoint.failLoads(&docendpoint.Error{Message: "collab: the doc endpoint GET returned 503.", StatusCode: 503})
	client := app.open(t, synProtocol)

	if got := client.subProtocol(); got != synProtocol {
		t.Fatalf("subprotocol %q", got)
	}
	if close := client.closeFrame(t); close != CloseSeedFailed {
		t.Fatalf("closed %+v", close)
	}

	app.endpoint.failLoads(nil)
	retry := app.open(t)
	if got := synSyncedText(t, retry); got != "seeded" {
		t.Fatalf("retry: %q", got)
	}
}

// --- SyncHandshakeTests ---

var synLineage = regexp.MustCompile(`^[0-9a-f]{32}$`)

func synAssertFreshTag(t *testing.T, tag wire.Tag) {
	t.Helper()
	if tag.Format != workingset.CurrentFormat || tag.Epoch != 0 || !synLineage.MatchString(tag.Lineage) {
		t.Fatalf("tag %+v", tag)
	}
}

func TestACompatibleTicketJoinsWithTheProtocolEchoedAndTheEpochFrameFirst(t *testing.T) {
	app := synStart(t, synOptions{ticket: true})
	client := app.openTicket(t, writeTicket)

	if got := client.subProtocol(); got != synProtocol {
		t.Fatalf("subprotocol %q", got)
	}
	synAssertFreshTag(t, synNext[wire.BlokControl](t, client).Tag)
	if got := synSyncedText(t, client); got != "seeded" {
		t.Fatalf("text %q", got)
	}
}

func TestAReadOnlyTicketJoinsButItsWritesAreDropped(t *testing.T) {
	app := synStart(t, synOptions{ticket: true})
	reader := app.openTicket(t, readTicket)
	writer := app.openTicket(t, writeTicket)
	synAssertFreshTag(t, synNext[wire.BlokControl](t, reader).Tag)
	synAssertFreshTag(t, synNext[wire.BlokControl](t, writer).Tag)
	readerDoc := synSynced(t, reader)

	reader.send(t, wire.SyncUpdate{Update: synAppend(readerDoc, " stolen")})
	// The reader's frames are handled in order, so this answer proves the
	// update above was already dropped.
	if got := synSyncedText(t, reader); got != "seeded" {
		t.Fatalf("reader: %q", got)
	}

	writerDoc := synSynced(t, writer)
	update := synAppend(writerDoc, " ok")
	writer.send(t, wire.SyncUpdate{Update: update})
	if relayed := synNext[wire.SyncUpdate](t, reader); !synEqual(relayed.Update, update) {
		t.Fatalf("relayed %x, sent %x", relayed.Update, update)
	}
	if got := synSyncedText(t, writer); got != "seeded ok" {
		t.Fatalf("writer: %q", got)
	}
}

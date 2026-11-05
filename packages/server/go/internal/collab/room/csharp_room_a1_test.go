package room

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab"
	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/internal/collab/docendpoint"
	"github.com/JackUait/blok/packages/server/go/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/internal/collab/wire"
	"github.com/JackUait/blok/packages/server/go/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// Twins of C# CollabRoomTests cases that had no Go twin. C# moves a manual
// clock to fire timers; here they run on short wall-time windows.

const (
	ra1OpOne = "0123456789abcdef0123456789abcdef"
	ra1OpTwo = "fedcba9876543210fedcba9876543210"
)

// ra1Pause is a hook a fake stops in until it is opened. It gives up when
// the store call's context ends: Go bounds a store call through its ctx,
// where C# abandons the awaited task.
type ra1Pause struct {
	entered chan struct{}
	once    sync.Once
	release chan struct{}
}

func ra1NewPause() *ra1Pause {
	return &ra1Pause{entered: make(chan struct{}), release: make(chan struct{})}
}

func (p *ra1Pause) pass(ctx context.Context) error {
	p.once.Do(func() { close(p.entered) })
	select {
	case <-p.release:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (p *ra1Pause) open() { close(p.release) }

func (p *ra1Pause) waitEntered(t *testing.T) {
	t.Helper()
	select {
	case <-p.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("the pause was never entered")
	}
}

type ra1Hook struct {
	mu    sync.Mutex
	pause *ra1Pause
}

func (h *ra1Hook) get() *ra1Pause {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.pause
}

func (h *ra1Hook) set(p *ra1Pause) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.pause = p
}

// ra1Store adds C# BeforeWrite and the write sizes to the working set.
type ra1Store struct {
	*fakeWorkingSet
	beforeWrite ra1Hook

	mu                                     sync.Mutex
	mostFrames, largestWrite, writtenBytes int
}

func (s *ra1Store) Write(ctx context.Context, doc string, updates []byte, tag workingset.Tag) error {
	frames, ok := workingset.DecodeFrames(updates)
	if !ok {
		return errors.New("the room wrote unframed updates")
	}
	s.mu.Lock()
	s.mostFrames = max(s.mostFrames, len(frames))
	s.largestWrite = max(s.largestWrite, len(updates))
	s.writtenBytes += len(updates)
	s.mu.Unlock()
	if pause := s.beforeWrite.get(); pause != nil {
		if err := pause.pass(ctx); err != nil {
			return err
		}
	}
	return s.fakeWorkingSet.Write(ctx, doc, updates, tag)
}

func (s *ra1Store) sizes() (mostFrames, largestWrite, writtenBytes int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.mostFrames, s.largestWrite, s.writtenBytes
}

// frameCount is C# FramesOf(doc).Count: 0 with no working set.
func (s *ra1Store) frameCount(t *testing.T) int {
	t.Helper()
	if !s.Holds(testDoc) {
		return 0
	}
	return len(s.Frames(t, testDoc))
}

// ra1Endpoint adds C# NextSaveFailure: the save is recorded, then fails.
type ra1Endpoint struct {
	*fakeEndpoint
	failMu          sync.Mutex
	nextSaveFailure error
}

func (e *ra1Endpoint) Save(ctx context.Context, doc string, outputData any, version *string, projection *docendpoint.Projection) (*string, error) {
	answer, err := e.fakeEndpoint.Save(ctx, doc, outputData, version, projection)
	e.failMu.Lock()
	failure := e.nextSaveFailure
	e.nextSaveFailure = nil
	e.failMu.Unlock()
	if failure != nil {
		return nil, failure
	}
	return answer, err
}

func (e *ra1Endpoint) savedTexts(t *testing.T) []string {
	t.Helper()
	var texts []string
	for _, save := range e.Saves() {
		texts = append(texts, dataText(node(t, save.data)))
	}
	return texts
}

// ra1Converter adds the C# FakeDocConverter seed and export knobs.
type ra1Converter struct {
	*textConverter
	mu                sync.Mutex
	seeds             int
	seededIDs         []uint64
	nextExportFailure error
}

func (c *ra1Converter) Seed(ctx context.Context, doc *yjs.Doc, outputData *jsjson.Node) error {
	c.mu.Lock()
	c.seeds++
	c.seededIDs = append(c.seededIDs, doc.ClientID())
	c.mu.Unlock()
	return c.textConverter.Seed(ctx, doc, outputData)
}

func (c *ra1Converter) Export(ctx context.Context, doc *yjs.Doc) (*jsjson.Object, error) {
	c.mu.Lock()
	failure := c.nextExportFailure
	c.nextExportFailure = nil
	c.mu.Unlock()
	if failure != nil {
		c.exports.Add(1)
		return nil, failure
	}
	return c.textConverter.Export(ctx, doc)
}

func (c *ra1Converter) seeded() (int, []uint64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.seeds, append([]uint64(nil), c.seededIDs...)
}

// ra1Journal adds the C# FakeCollabOperationStore knobs: Opens,
// FailAppends, CommitBeforeFailing and BeforeAppend.
type ra1Journal struct {
	*fakeJournal
	opens        atomic.Int32
	beforeAppend ra1Hook

	mu                  sync.Mutex
	failAppends         error
	commitBeforeFailing bool
}

func (j *ra1Journal) Open(ctx context.Context, id string) (journal.OpenOutcome, OperationSession, error) {
	j.opens.Add(1)
	outcome, session, err := j.fakeJournal.Open(ctx, id)
	if session == nil {
		return outcome, nil, err
	}
	return outcome, &ra1Session{fakeSession: session.(*fakeSession), journal: j}, err
}

func (j *ra1Journal) setFailAppends(failure error, commitFirst bool) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.failAppends, j.commitBeforeFailing = failure, commitFirst
}

type ra1Session struct {
	*fakeSession
	journal *ra1Journal
}

func (s *ra1Session) Append(ctx context.Context, candidate operation.Candidate) (operation.AppendResult, error) {
	if pause := s.journal.beforeAppend.get(); pause != nil {
		if err := pause.pass(ctx); err != nil {
			return operation.AppendResult{}, err
		}
	}
	s.journal.mu.Lock()
	failure, commitFirst := s.journal.failAppends, s.journal.commitBeforeFailing
	s.journal.mu.Unlock()
	if failure == nil {
		return s.fakeSession.Append(ctx, candidate)
	}
	existing, err := s.fakeSession.FindCommitted(ctx, candidate.OperationID, candidate.Digest)
	if err != nil {
		return operation.AppendResult{}, err
	}
	switch existing.Outcome {
	case operation.LookupDuplicate:
		return operation.AppendResult{Outcome: operation.AppendDuplicate, Sequence: existing.Sequence}, nil
	case operation.LookupConflict:
		return operation.AppendResult{Outcome: operation.AppendConflict, Sequence: existing.Sequence}, nil
	}
	if commitFirst {
		if _, err := s.fakeSession.Append(ctx, candidate); err != nil {
			return operation.AppendResult{}, err
		}
	}
	return operation.AppendResult{}, failure
}

// ra1Room is the C# test class's fields: one store, endpoint, converter and
// journal shared by every manager a test makes.
type ra1Room struct {
	*textRoom
	ws   *ra1Store
	ep   *ra1Endpoint
	conv *ra1Converter
	ops  *ra1Journal
}

func ra1NewRoom() *ra1Room {
	r := newTextRoom()
	return &ra1Room{
		textRoom: r,
		ws:       &ra1Store{fakeWorkingSet: r.store},
		ep:       &ra1Endpoint{fakeEndpoint: r.endpoint},
		conv:     &ra1Converter{textConverter: r.converter},
		ops:      &ra1Journal{fakeJournal: r.operations},
	}
}

// manager is C# CreateManager, or CreateJournalManager when journalled.
func (r *ra1Room) manager(t *testing.T, o Options, journalled bool) *Manager {
	t.Helper()
	if o.Now == nil {
		o.Now = r.clock.Now
	}
	var operations OperationStore
	if journalled {
		operations = r.ops
	}
	manager := NewManager(ManagerOptions{
		Store: r.ws, Endpoint: r.ep, Converter: r.conv, Room: o, Log: r.logf, Operations: operations,
	})
	t.Cleanup(func() { _ = manager.Drain(context.Background()) })
	return manager
}

func (r *ra1Room) logLines() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.log...)
}

func (r *ra1Room) committed() []operation.Record { return r.operations.Committed(testDoc) }

// ra1Quiet: no timer fires unless a test asks for one.
func ra1Quiet() Options {
	return Options{ExportDebounce: time.Hour, ExportMaxDelay: time.Hour, EvictionLinger: time.Hour}
}

// ra1Brisk: every room timer fires within milliseconds.
func ra1Brisk() Options {
	ms := 10 * time.Millisecond
	return Options{ExportDebounce: ms, ExportMaxDelay: ms, EvictionLinger: ms, RetryBackoff: ms, RetryBackoffCap: ms}
}

// ra1Stock is C#'s default FakeMember: it negotiated no blok-sync
// subprotocol, so it gets no control frame.
type ra1Stock struct{ *fakeMember }

func (ra1Stock) AcceptsControlFrames() bool { return false }

func ra1Writer() *fakeMember { return &fakeMember{source: collab.SourceClientV1, write: true} }

func ra1Reader() *fakeMember { return &fakeMember{source: collab.SourceClientV1} }

func ra1V2(actor string) *fakeMember {
	return &fakeMember{actor: actor, source: collab.SourceClientV2, write: true}
}

// ra1Join is C# Join: a v1 member joins stock; a v2 member also syncs.
func ra1Join(t *testing.T, manager *Manager, member *fakeMember) collab.Membership {
	t.Helper()
	if member.source == collab.SourceClientV2 {
		return joinSynced(t, manager, testDoc, member)
	}
	return join(t, manager, testDoc, ra1Stock{member})
}

func ra1Send(t *testing.T, membership collab.Membership, message wire.Message) {
	t.Helper()
	if err := membership.Receive(context.Background(), syncFrame(t, message)); err != nil {
		t.Fatal(err)
	}
}

// ra1ReceiveAsync runs a receive off the test goroutine.
func ra1ReceiveAsync(t *testing.T, membership collab.Membership, message wire.Message) <-chan error {
	t.Helper()
	frame := syncFrame(t, message)
	done := make(chan error, 1)
	go func() { done <- membership.Receive(context.Background(), frame) }()
	return done
}

func ra1Await(t *testing.T, what string, done <-chan error) {
	t.Helper()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("%s: %v", what, err)
		}
	case <-time.After(5 * time.Second):
		t.Fatalf("timed out waiting for %s", what)
	}
}

// ra1Edit is C# Edit: a client synced to the room appends value.
func ra1Edit(t *testing.T, manager *Manager, membership collab.Membership, value string) {
	t.Helper()
	client := syncedClient(t, manager, testDoc, exportedText(t, manager, testDoc))
	ra1Send(t, membership, wire.SyncUpdate{Update: updateAppending(client, value)})
}

func ra1Op(lineage, operationID string, update []byte) wire.Operation {
	return wire.Operation{Lineage: lineage, OperationID: operationID, Update: update}
}

// ra1JoinLineage joins a v2 member and answers the lineage it was told.
func ra1JoinLineage(t *testing.T, manager *Manager, member *fakeMember) (collab.Membership, string) {
	t.Helper()
	membership := ra1Join(t, manager, member)
	return membership, controlTag(t, member).Lineage
}

func ra1Replay(t *testing.T, frames [][]byte) string {
	t.Helper()
	replica := newClient()
	for _, frame := range frames {
		if _, err := replica.ApplyUpdate(frame); err != nil {
			t.Fatal(err)
		}
	}
	return docText(replica)
}

// ra1AwarenessClaiming is C# AwarenessClaiming.
func ra1AwarenessClaiming(clients uint64) []byte {
	payload := ra1VarUint(nil, clients)
	for client := uint64(0); client < clients; client++ {
		payload = ra1VarUint(payload, 1000+client)
		payload = append(payload, 0x01, 0x02, '{', '}')
	}
	return payload
}

func ra1VarUint(payload []byte, value uint64) []byte {
	for {
		current := byte(value & 0x7f)
		value >>= 7
		if value == 0 {
			return append(payload, current)
		}
		payload = append(payload, current|0x80)
	}
}

// ra1FixturePayload is C# SyncFrames.Payload: a frame from the shared
// sync-frames fixture.
func ra1FixturePayload(t *testing.T, name string) []byte {
	t.Helper()
	fixture := readRepoJSON(t, "test", "unit", "server-conformance", "fixtures", "sync-frames.json")
	for _, frame := range objects(t, member(t, fixture, "frames")) {
		if text(t, frame, "name") == name {
			payload, err := hex.DecodeString(text(t, frame, "payloadHex"))
			if err != nil {
				t.Fatal(err)
			}
			return payload
		}
	}
	t.Fatalf("sync-frames.json has no frame named %s", name)
	return nil
}

func ra1SyncUpdates(t *testing.T, m *fakeMember) [][]byte {
	t.Helper()
	var updates [][]byte
	for _, message := range m.messages(t) {
		if update, ok := message.(wire.SyncUpdate); ok {
			updates = append(updates, update.Update)
		}
	}
	return updates
}

func ra1Awareness(t *testing.T, m *fakeMember) [][]byte {
	t.Helper()
	var updates [][]byte
	for _, message := range m.messages(t) {
		if update, ok := message.(wire.Awareness); ok {
			updates = append(updates, update.Update)
		}
	}
	return updates
}

func ra1Has(t *testing.T, m *fakeMember, is func(wire.Message) bool) int {
	t.Helper()
	count := 0
	for _, message := range m.messages(t) {
		if is(message) {
			count++
		}
	}
	return count
}

func ra1Empty(t *testing.T, who string, m *fakeMember) {
	t.Helper()
	if got := m.messages(t); len(got) != 0 {
		t.Fatalf("%s got %#v, want nothing", who, got)
	}
}

func ra1NotClosed(t *testing.T, who string, m *fakeMember) {
	t.Helper()
	if got := m.closed(); len(got) != 0 {
		t.Fatalf("%s was closed: %v", who, got)
	}
}

func ra1ClosedOnce(t *testing.T, who string, m *fakeMember, want collab.CloseReason) {
	t.Helper()
	if got := m.closed(); len(got) != 1 || got[0] != want {
		t.Fatalf("%s closes = %v, want one %v", who, got, want)
	}
}

func ra1OnlyUpdate(t *testing.T, who string, m *fakeMember, want []byte) {
	t.Helper()
	got := m.messages(t)
	if len(got) != 1 {
		t.Fatalf("%s got %#v, want one SyncUpdate", who, got)
	}
	if update, ok := got[0].(wire.SyncUpdate); !ok || !bytes.Equal(update.Update, want) {
		t.Fatalf("%s got %#v, want the SyncUpdate", who, got[0])
	}
}

func ra1OnlyAck(t *testing.T, m *fakeMember, lineage, operationID string, sequence uint64) {
	t.Helper()
	got := m.messages(t)
	want := wire.Acknowledgement{Lineage: lineage, OperationID: operationID, ServerSequence: sequence}
	if len(got) != 1 || got[0] != wire.Message(want) {
		t.Fatalf("got %#v, want only %#v", got, want)
	}
}

// ra1LaneWaiters counts the callers waiting on the live rooms' lanes.
func ra1LaneWaiters(manager *Manager) int {
	waiting := 0
	for _, r := range manager.liveRooms() {
		r.lane.mu.Lock()
		waiting += len(r.lane.waiters)
		r.lane.mu.Unlock()
	}
	return waiting
}

func TestAnswersSyncStep1WithTheDiffAndItsOwnSyncStep1(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), false)
	member := ra1Writer()
	membership := ra1Join(t, manager, member)
	client := newClient()
	member.clear()

	ra1Send(t, membership, wire.SyncStep1{StateVector: client.EncodeStateVector()})

	got := member.messages(t)
	if len(got) != 2 {
		t.Fatalf("frames %#v, want SyncStep2 then SyncStep1", got)
	}
	step2, ok := got[0].(wire.SyncStep2)
	if !ok {
		t.Fatalf("first frame %#v", got[0])
	}
	if _, err := client.ApplyUpdate(step2.Update); err != nil {
		t.Fatal(err)
	}
	step1, ok := got[1].(wire.SyncStep1)
	if !ok || !bytes.Equal(step1.StateVector, client.EncodeStateVector()) {
		t.Fatalf("second frame %#v, want the room's SyncStep1", got[1])
	}
	if got := docText(client); got != "hello" {
		t.Fatalf("the client reads %q", got)
	}
}

func TestAppliesAWriterUpdateAppendsItOnceAndBroadcastsToOthersOnly(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), false)
	writer, other := ra1Writer(), ra1Writer()
	membership := ra1Join(t, manager, writer)
	ra1Join(t, manager, other)
	framesBefore := r.ws.frameCount(t)
	client := syncedClient(t, manager, testDoc, "hello")
	update := updateAppending(client, " world")
	writer.clear()
	other.clear()

	ra1Send(t, membership, wire.SyncUpdate{Update: update})

	ra1Empty(t, "the writer", writer)
	ra1OnlyUpdate(t, "the other", other, update)
	waitUntil(t, "the working set to catch up", func() bool { return r.ws.frameCount(t) == framesBefore+1 })
	frames := r.store.Frames(t, testDoc)
	if !bytes.Equal(frames[len(frames)-1], update) {
		t.Fatal("the last stored frame is not the update")
	}
	if got := exportedText(t, manager, testDoc); got != "hello world" {
		t.Fatalf("the room reads %q", got)
	}
}

func TestAppliesAWriterSyncStep2ForALateJoinerWithOfflineEdits(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), false)
	early, late := ra1Writer(), ra1Writer()
	ra1Join(t, manager, early)
	membership := ra1Join(t, manager, late)
	offline := syncedClient(t, manager, testDoc, "hello")
	edit := updateAppending(offline, "!")
	early.clear()

	ra1Send(t, membership, wire.SyncStep2{Update: edit})

	ra1OnlyUpdate(t, "the early member", early, edit)
	if got := exportedText(t, manager, testDoc); got != "hello!" {
		t.Fatalf("the room reads %q", got)
	}
}

func TestDropsSyncStep2AndUpdatesFromReadOnlyMembersButAnswersTheirSyncStep1(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), false)
	reader, writer := ra1Reader(), ra1Writer()
	membership := ra1Join(t, manager, reader)
	ra1Join(t, manager, writer)
	framesBefore := r.ws.frameCount(t)
	client := syncedClient(t, manager, testDoc, "hello")
	edit := updateAppending(client, " hacked")
	reader.clear()
	writer.clear()

	ra1Send(t, membership, wire.SyncUpdate{Update: edit})
	ra1Send(t, membership, wire.SyncStep2{Update: edit})
	ra1Send(t, membership, wire.SyncStep1{StateVector: []byte{0}})

	ra1Empty(t, "the writer", writer)
	if got := r.ws.frameCount(t); got != framesBefore {
		t.Fatalf("%d frames, want %d", got, framesBefore)
	}
	got := reader.messages(t)
	if len(got) != 2 {
		t.Fatalf("the reader got %#v, want SyncStep2 then SyncStep1", got)
	}
	if _, ok := got[0].(wire.SyncStep2); !ok {
		t.Fatalf("first frame %#v", got[0])
	}
	if _, ok := got[1].(wire.SyncStep1); !ok {
		t.Fatalf("second frame %#v", got[1])
	}
	if got := exportedText(t, manager, testDoc); got != "hello" {
		t.Fatalf("the room reads %q", got)
	}
}

func TestRelaysAwarenessAndQueryAwarenessToOthersEvenFromReadOnlyMembers(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), false)
	reader, other := ra1Reader(), ra1Writer()
	membership := ra1Join(t, manager, reader)
	ra1Join(t, manager, other)
	reader.clear()
	other.clear()
	stock := ra1FixturePayload(t, "awareness")

	ra1Send(t, membership, wire.Awareness{Update: stock})
	ra1Send(t, membership, wire.QueryAwareness{})

	ra1Empty(t, "the reader", reader)
	got := other.messages(t)
	if len(got) != 2 {
		t.Fatalf("the other got %#v, want Awareness then QueryAwareness", got)
	}
	if awareness, ok := got[0].(wire.Awareness); !ok || !bytes.Equal(awareness.Update, stock) {
		t.Fatalf("first frame %#v", got[0])
	}
	if _, ok := got[1].(wire.QueryAwareness); !ok {
		t.Fatalf("second frame %#v", got[1])
	}
}

func TestDropsAMalformedAwarenessFrameAndClosesTheSenderOnTheThird(t *testing.T) {
	for _, payload := range [][]byte{{0x01, 0x02, 0x03}, {0x01, 0x02, 0x03, 0x01, '{'}} {
		t.Run(hex.EncodeToString(payload), func(t *testing.T) {
			r := ra1NewRoom()
			r.endpoint.Holds(t, testDoc, "hello", nil)
			manager := r.manager(t, ra1Quiet(), false)
			sender, other := ra1Writer(), ra1Writer()
			membership := ra1Join(t, manager, sender)
			ra1Join(t, manager, other)
			other.clear()
			frame := wire.Awareness{Update: payload}

			ra1Send(t, membership, frame)
			ra1Send(t, membership, frame)
			ra1NotClosed(t, "the sender", sender)
			ra1Send(t, membership, frame)
			ra1Send(t, membership, wire.Awareness{Update: ra1FixturePayload(t, "awareness")})

			ra1ClosedOnce(t, "the sender", sender, collab.CloseBadAwareness)
			ra1Empty(t, "the other", other)
			if !r.logged("malformed awareness") {
				t.Fatalf("log %q", r.logLines())
			}
		})
	}
}

func TestDropsAnAwarenessFrameThatClaimsMoreClientsThanTheRoomRelays(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), false)
	flooder, victim := ra1Writer(), ra1Writer()
	membership := ra1Join(t, manager, flooder)
	ra1Join(t, manager, victim)
	victim.clear()

	ra1Send(t, membership, wire.Awareness{Update: ra1AwarenessClaiming(100_000)})

	ra1Empty(t, "the victim", victim)
	if !r.logged("100000") {
		t.Fatalf("log %q", r.logLines())
	}
}

func TestRelaysAwarenessAtTheClientCapAndDropsTheFrameAboveIt(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	o := ra1Quiet()
	o.MaxAwarenessClients = 4
	manager := r.manager(t, o, false)
	sender, other := ra1Writer(), ra1Writer()
	membership := ra1Join(t, manager, sender)
	ra1Join(t, manager, other)
	other.clear()

	ra1Send(t, membership, wire.Awareness{Update: ra1AwarenessClaiming(4)})
	// Over the cap is a drop, never a strike.
	for attempt := 0; attempt < 3; attempt++ {
		ra1Send(t, membership, wire.Awareness{Update: ra1AwarenessClaiming(5)})
	}

	if got := other.messages(t); len(got) != 1 {
		t.Fatalf("the other got %#v, want the frame at the cap", got)
	}
	if got := ra1Awareness(t, other); len(got) != 1 || !bytes.Equal(got[0], ra1AwarenessClaiming(4)) {
		t.Fatal("the relayed frame is not the one at the cap")
	}
	ra1NotClosed(t, "the sender", sender)
}

func TestHoldsAReadOnlyMembersPresenceToTheSameClientCap(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	o := ra1Quiet()
	o.MaxAwarenessClients = 4
	manager := r.manager(t, o, false)
	reader, other := ra1Reader(), ra1Writer()
	membership := ra1Join(t, manager, reader)
	ra1Join(t, manager, other)
	other.clear()

	ra1Send(t, membership, wire.Awareness{Update: ra1AwarenessClaiming(4)})
	ra1Send(t, membership, wire.Awareness{Update: ra1AwarenessClaiming(5)})

	if got := other.messages(t); len(got) != 1 {
		t.Fatalf("the other got %#v, want the frame at the cap", got)
	}
	if got := ra1Awareness(t, other); len(got) != 1 || !bytes.Equal(got[0], ra1AwarenessClaiming(4)) {
		t.Fatal("the relayed frame is not the one at the cap")
	}
}

func TestDropsAnAwarenessFrameWhoseClientCountCannotBeRead(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), false)
	sender, other := ra1Writer(), ra1Writer()
	membership := ra1Join(t, manager, sender)
	ra1Join(t, manager, other)
	other.clear()

	// An unterminated varuint: no count to hold to the cap.
	ra1Send(t, membership, wire.Awareness{Update: []byte{0x80}})

	ra1Empty(t, "the other", other)
}

func TestBroadcastsQueryAwarenessToTheOthersWhenSomeoneJoins(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), false)
	first, second := ra1Writer(), ra1Writer()
	ra1Join(t, manager, first)

	ra1Join(t, manager, second)

	isQuery := func(m wire.Message) bool { _, ok := m.(wire.QueryAwareness); return ok }
	if got := ra1Has(t, first, isQuery); got != 1 {
		t.Fatalf("the first member got %d QueryAwareness, want 1: %#v", got, first.messages(t))
	}
	if got := ra1Has(t, second, isQuery); got != 0 {
		t.Fatalf("the joiner got %d QueryAwareness, want 0", got)
	}
}

func TestSendsTheEpochControlFrameFirstOnlyToMembersThatNegotiatedIt(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	r.store.Seed(t, testDoc, [][]byte{fullState(t, docWith("hello"))}, tagAt(6))
	manager := r.manager(t, ra1Quiet(), false)
	negotiated, stock := ra1Writer(), ra1Writer()
	join(t, manager, testDoc, negotiated)
	ra1Join(t, manager, stock)

	got := negotiated.messages(t)
	control, ok := got[0].(wire.BlokControl)
	want := tagAt(6)
	if !ok || control.Tag != (wire.Tag{Format: want.Format, Epoch: want.Epoch, Lineage: want.Lineage}) {
		t.Fatalf("first frame %#v, want the control frame at epoch 6", got[0])
	}
	if ra1Has(t, stock, func(m wire.Message) bool { _, ok := m.(wire.BlokControl); return ok }) != 0 {
		t.Fatal("the stock member got a control frame")
	}
	// Default options announce no cap.
	if ra1Has(t, negotiated, func(m wire.Message) bool { _, ok := m.(wire.BlokLimits); return ok }) != 0 {
		t.Fatal("a limits frame was sent")
	}
}

func TestAnnouncesTheMessageCapRightAfterTheControlFrame(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	o := ra1Quiet()
	o.AnnouncedMaxMessageBytes = 1 << 20
	manager := r.manager(t, o, false)
	negotiated, stock := ra1Writer(), ra1Writer()
	join(t, manager, testDoc, negotiated)
	ra1Join(t, manager, stock)

	got := negotiated.messages(t)
	if _, ok := got[0].(wire.BlokControl); !ok {
		t.Fatalf("first frame %#v", got[0])
	}
	if got[1] != wire.Message(wire.BlokLimits{MaxMessageBytes: 1 << 20}) {
		t.Fatalf("second frame %#v, want limits of 1 MiB", got[1])
	}
	if ra1Has(t, stock, func(m wire.Message) bool { _, ok := m.(wire.BlokLimits); return ok }) != 0 {
		t.Fatal("the stock member got a limits frame")
	}
}

func TestIgnoresMalformedFramesAndUnusableUpdates(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), false)
	writer, other := ra1Writer(), ra1Writer()
	membership := ra1Join(t, manager, writer)
	ra1Join(t, manager, other)
	framesBefore := r.ws.frameCount(t)
	other.clear()

	if err := membership.Receive(context.Background(), []byte{0xff, 0xff, 0xff}); err != nil {
		t.Fatal(err)
	}
	ra1Send(t, membership, wire.SyncUpdate{Update: []byte{0xde, 0xad, 0xbe, 0xef, 0x01}})
	ra1Send(t, membership, wire.PermissionDenied{Reason: "nope"})

	ra1Empty(t, "the other", other)
	if got := r.ws.frameCount(t); got != framesBefore {
		t.Fatalf("%d frames, want %d", got, framesBefore)
	}
	if got := exportedText(t, manager, testDoc); got != "hello" {
		t.Fatalf("the room reads %q", got)
	}
}

func TestAMalformedUpdateIsDroppedWithoutClosingTheMember(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), false)
	writer, other := ra1Writer(), ra1Writer()
	membership := ra1Join(t, manager, writer)
	ra1Join(t, manager, other)
	framesBefore := r.ws.frameCount(t)
	other.clear()

	ra1Send(t, membership, wire.SyncUpdate{Update: []byte{0xde, 0xad, 0xbe, 0xef, 0x01}})

	ra1NotClosed(t, "the writer", writer)
	ra1NotClosed(t, "the other", other)
	ra1Empty(t, "the other", other)
	if got := r.ws.frameCount(t); got != framesBefore {
		t.Fatalf("%d frames, want %d", got, framesBefore)
	}
}

func TestARoomAppliesANulBearingUpdateAndExportsItIntact(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), false)
	writer, other := ra1Writer(), ra1Writer()
	membership := ra1Join(t, manager, writer)
	ra1Join(t, manager, other)
	client := syncedClient(t, manager, testDoc, "hello")
	framesBefore := r.ws.frameCount(t)
	other.clear()

	ra1Send(t, membership, wire.SyncUpdate{Update: updateAppending(client, "a\x00b")})

	ra1NotClosed(t, "the writer", writer)
	if len(ra1SyncUpdates(t, other)) == 0 {
		t.Fatalf("the other got %#v, want the update", other.messages(t))
	}
	waitUntil(t, "the working set to catch up", func() bool { return r.ws.frameCount(t) == framesBefore+1 })
	if got := exportedText(t, manager, testDoc); got != "helloa\x00b" {
		t.Fatalf("the room reads %q", got)
	}
}

func TestExportsAfterTheDebounceAndNotBefore(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", strPtr("v7"))
	o := ra1Quiet()
	o.ExportDebounce = 400 * time.Millisecond
	manager := r.manager(t, o, false)
	membership := ra1Join(t, manager, ra1Writer())
	ra1Edit(t, manager, membership, " world")

	time.Sleep(250 * time.Millisecond)
	manager.Settle()
	if saves := r.endpoint.Saves(); len(saves) != 0 {
		t.Fatal("exported before the debounce")
	}

	waitUntil(t, "the debounced export", func() bool { return len(r.endpoint.Saves()) == 1 })

	saves := r.endpoint.Saves()
	if len(saves) != 1 {
		t.Fatalf("%d saves", len(saves))
	}
	if saves[0].doc != testDoc || dataText(node(t, saves[0].data)) != "hello world" || versionOf(saves[0]) != "v7" {
		t.Fatalf("save %+v", saves[0])
	}
}

func TestExportsNoLaterThanTheMaxDelayUnderContinuousEdits(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "", nil)
	const spacing, maxDelay = 300 * time.Millisecond, time.Second
	o := ra1Quiet()
	// The debounce outlasts the edit spacing, so only the max delay fires.
	o.ExportDebounce, o.ExportMaxDelay, o.Now = 700*time.Millisecond, maxDelay, time.Now
	manager := r.manager(t, o, false)
	membership := ra1Join(t, manager, ra1Writer())

	started := time.Now()
	for edit := 0; edit < 4; edit++ {
		time.Sleep(time.Until(started.Add(time.Duration(edit) * spacing)))
		if saves := r.endpoint.Saves(); len(saves) != 0 {
			t.Fatalf("exported %v after the first edit, before the max delay", time.Since(started))
		}
		ra1Edit(t, manager, membership, "x")
	}
	waitUntil(t, "the max-delay export", func() bool { return len(r.endpoint.Saves()) == 1 })

	// The debounce after the last edit would land at 1.6 s.
	if elapsed := time.Since(started); elapsed < maxDelay || elapsed > 1450*time.Millisecond {
		t.Fatalf("the export came %v after the first edit, want the max delay", elapsed)
	}
	if got := r.ep.savedTexts(t)[0]; got != "xxxx" {
		t.Fatalf("the export %q", got)
	}
}

func TestRetriesAFailedExportOnTheNextTickAndKeepsTheBlob(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	r.ep.nextSaveFailure = &docendpoint.Error{Message: "collab: the doc endpoint PUT returned 502.", StatusCode: 502}
	o := ra1Brisk()
	o.EvictionLinger = time.Hour
	manager := r.manager(t, o, false)
	membership := ra1Join(t, manager, ra1Writer())
	ra1Edit(t, manager, membership, "!")

	waitUntil(t, "the failing export", func() bool { return len(r.endpoint.Saves()) >= 1 })
	waitUntil(t, "the retried export", func() bool { return len(r.endpoint.Saves()) == 2 })

	if got := r.ep.savedTexts(t)[1]; got != "hello!" {
		t.Fatalf("the retried export %q", got)
	}
	waitUntil(t, "the working set to keep both frames", func() bool { return r.ws.frameCount(t) == 2 })
}

func TestRetriesAnExportTheConverterRefusedWithBackoff(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	r.conv.nextExportFailure = &convert.DataError{Message: `collab: block "b-1" has data that is not a map.`}
	o := ra1Quiet()
	o.ExportDebounce, o.ExportMaxDelay = 10*time.Millisecond, 10*time.Millisecond
	o.RetryBackoff, o.RetryBackoffCap = 300*time.Millisecond, 300*time.Millisecond
	manager := r.manager(t, o, false)
	membership := ra1Join(t, manager, ra1Writer())
	ra1Edit(t, manager, membership, "!")

	waitUntil(t, "the refused export", func() bool { return r.conv.exports.Load() >= 1 })
	manager.Settle()

	if got := r.conv.exports.Load(); got != 1 {
		t.Fatalf("%d exports, want 1 inside the backoff", got)
	}
	if len(r.endpoint.Saves()) != 0 {
		t.Fatal("a save was sent")
	}
	if !r.logged("b-1") || r.logged("background work failed") {
		t.Fatalf("log %q", r.logLines())
	}

	waitUntil(t, "the retried export", func() bool { return len(r.endpoint.Saves()) == 1 })
	if got := r.ep.savedTexts(t)[0]; got != "hello!" {
		t.Fatalf("the retried export %q", got)
	}
}

func TestCoalescesEditsMadeDuringAnInFlightExportIntoTheNextOne(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "a", nil)
	gate := make(chan struct{})
	r.endpoint.setSaveGate(gate)
	o := ra1Brisk()
	o.EvictionLinger = time.Hour
	manager := r.manager(t, o, false)
	membership := ra1Join(t, manager, ra1Writer())
	ra1Edit(t, manager, membership, "b")
	waitUntil(t, "the first export", func() bool { return len(r.endpoint.Saves()) == 1 })

	ra1Edit(t, manager, membership, "c")
	time.Sleep(100 * time.Millisecond)
	manager.Settle()
	if got := len(r.endpoint.Saves()); got != 1 {
		t.Fatalf("%d saves while the first was in flight, want 1", got)
	}

	r.endpoint.setSaveGate(nil)
	close(gate)
	waitUntil(t, "the coalesced export", func() bool { return len(r.endpoint.Saves()) == 2 })
	time.Sleep(50 * time.Millisecond)

	if got := r.ep.savedTexts(t); len(got) != 2 || got[0] != "ab" || got[1] != "abc" {
		t.Fatalf("saves %q, want ab then abc", got)
	}
}

func TestCarriesTheVersionEachSaveAnswersWithIntoTheNextSave(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "a", strPtr("v1"))
	r.endpoint.setNextSaveVersion(strPtr("v2"))
	o := ra1Brisk()
	o.EvictionLinger = time.Hour
	manager := r.manager(t, o, false)
	membership := ra1Join(t, manager, ra1Writer())

	ra1Edit(t, manager, membership, "b")
	waitUntil(t, "the first export", func() bool { return len(r.endpoint.Saves()) == 1 })
	manager.Settle()
	ra1Edit(t, manager, membership, "c")
	waitUntil(t, "the second export", func() bool { return len(r.endpoint.Saves()) == 2 })

	saves := r.endpoint.Saves()
	if versionOf(saves[0]) != "v1" || versionOf(saves[1]) != "v2" {
		t.Fatalf("versions %s, %s; want v1, v2", versionOf(saves[0]), versionOf(saves[1]))
	}
}

func TestSeedsEveryRoomUnderItsOwnRandomClientId(t *testing.T) {
	r := ra1NewRoom()
	manager := r.manager(t, ra1Quiet(), false)

	for index := 0; index < 40; index++ {
		doc := "doc-" + itoa(index)
		r.endpoint.Holds(t, doc, "seed", nil)
		result, err := manager.Join(context.Background(), doc, ra1Stock{ra1Writer()})
		if err != nil || result.Status != collab.JoinJoined {
			t.Fatalf("join %s = %v, %v", doc, result.Status, err)
		}
	}

	_, ids := r.conv.seeded()
	distinct := map[uint64]bool{}
	for _, id := range ids {
		if id > 1<<32-1 {
			t.Fatalf("client id %d is past uint32", id)
		}
		distinct[id] = true
	}
	if len(distinct) != 40 {
		t.Fatalf("%d distinct client ids over 40 seeds: %v", len(distinct), ids)
	}
}

func TestAJoinerCancellingMidSeedDoesNotPoisonTheSeedForTheOthers(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	gate := make(chan struct{})
	r.endpoint.setLoadGate(gate)
	manager := r.manager(t, ra1Quiet(), false)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	type joined struct {
		result collab.JoinResult
		err    error
	}
	first, second := make(chan joined, 1), make(chan joined, 1)
	go func() {
		result, err := manager.Join(ctx, testDoc, ra1Stock{ra1Writer()})
		first <- joined{result, err}
	}()
	waitUntil(t, "the seed load to start", func() bool { return r.endpoint.Loads() == 1 })
	go func() {
		result, err := manager.Join(context.Background(), testDoc, ra1Stock{ra1Writer()})
		second <- joined{result, err}
	}()
	waitUntil(t, "the second join to queue", func() bool { return ra1LaneWaiters(manager) >= 1 })
	cancel()
	r.endpoint.setLoadGate(nil)
	close(gate)

	got := <-first
	if !errors.Is(got.err, context.Canceled) {
		t.Fatalf("the cancelled join = %v, %v; want a cancellation", got.result.Status, got.err)
	}
	got = <-second
	if got.err != nil || got.result.Status != collab.JoinJoined {
		t.Fatalf("the second join = %v, %v", got.result.Status, got.err)
	}
	if seeds, _ := r.conv.seeded(); r.endpoint.Loads() != 1 || seeds != 1 {
		t.Fatalf("%d loads, %d seeds; want 1 and 1", r.endpoint.Loads(), seeds)
	}
	if text := exportedText(t, manager, testDoc); text != "hello" {
		t.Fatalf("the room reads %q", text)
	}
}

func TestAStoreTimeoutDuringAnApplyIsLoggedRetriedAndStillExports(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	o := ra1Brisk()
	o.EvictionLinger = time.Hour
	manager := r.manager(t, o, false)
	writer, other := ra1Writer(), ra1Writer()
	membership := ra1Join(t, manager, writer)
	ra1Join(t, manager, other)
	client := syncedClient(t, manager, testDoc, "hello")
	update := updateAppending(client, "!")
	other.clear()
	r.store.setFailWrites(func(string) error { return context.DeadlineExceeded })

	ra1Send(t, membership, wire.SyncUpdate{Update: update})

	ra1OnlyUpdate(t, "the other", other, update)
	waitUntil(t, "the failed write to be reported", func() bool { return r.logged("could not persist") })
	waitUntil(t, "the export the failed persist must not cancel", func() bool { return len(r.endpoint.Saves()) >= 1 })
	if got := r.ep.savedTexts(t)[0]; got != "hello!" {
		t.Fatalf("the export %q", got)
	}

	r.store.setFailWrites(nil)
	waitUntil(t, "the retried persist", func() bool { return r.store.Holds(testDoc) && r.ws.frameCount(t) == 2 })
}

func TestASlowStoreDoesNotStallTheLane(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), false)
	writer, other := ra1Writer(), ra1Writer()
	membership := ra1Join(t, manager, writer)
	ra1Join(t, manager, other)
	client := syncedClient(t, manager, testDoc, "hello")
	other.clear()
	stuck := ra1NewPause()
	r.ws.beforeWrite.set(stuck)

	received := ra1ReceiveAsync(t, membership, wire.SyncUpdate{Update: updateAppending(client, "!")})
	select {
	case err := <-received:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the receive waited on the stuck store")
	}

	if got := other.messages(t); len(got) != 1 {
		t.Fatalf("the other got %#v, want the update", got)
	}
	if got := exportedText(t, manager, testDoc); got != "hello!" {
		t.Fatalf("the room reads %q", got)
	}

	r.ws.beforeWrite.set(nil)
	stuck.open()
	waitUntil(t, "the released write", func() bool { return r.store.Holds(testDoc) && r.ws.frameCount(t) == 2 })
}

func TestNoWriteCarriesMoreFramesThanTheCompactionThreshold(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "", nil)
	o := ra1Quiet()
	o.CompactionFrameThreshold = 4
	manager := r.manager(t, o, false)
	membership := ra1Join(t, manager, ra1Writer())
	client := syncedClient(t, manager, testDoc, "")

	for edit := 0; edit < 60; edit++ {
		ra1Send(t, membership, wire.SyncUpdate{Update: updateAppending(client, "x")})
	}

	manager.Settle()
	want := strings.Repeat("x", 60)
	waitUntil(t, "the last write", func() bool {
		return r.ws.frameCount(t) > 0 && ra1Replay(t, r.store.Frames(t, testDoc)) == want
	})
	most, largest, written := r.ws.sizes()
	if most > 4 {
		t.Fatalf("a write carried %d frames", most)
	}
	// Bounded by the doc, never by the history.
	if largest >= 600 {
		t.Fatalf("the largest write was %d bytes", largest)
	}
	if written >= 60*400 {
		t.Fatalf("%d bytes written for 60 updates", written)
	}
}

func TestMeasuresTheLogWithoutItsCompactedBaseWhenDecidingToCompact(t *testing.T) {
	r := ra1NewRoom()
	seed := strings.Repeat("a", 300)
	r.store.Seed(t, testDoc, [][]byte{fullState(t, docWith(seed))}, tagAt(0))
	o := ra1Quiet()
	o.CompactionByteThreshold = 256
	manager := r.manager(t, o, false)
	membership := ra1Join(t, manager, ra1Writer())
	client := syncedClient(t, manager, testDoc, seed)

	for _, piece := range []string{"b", "c", "d"} {
		ra1Send(t, membership, wire.SyncUpdate{Update: updateAppending(client, piece)})
	}

	manager.Settle()
	waitUntil(t, "the working set to catch up", func() bool {
		return ra1Replay(t, r.store.Frames(t, testDoc)) == seed+"bcd"
	})
	if got := r.ws.frameCount(t); got != 3 {
		t.Fatalf("%d frames, want 3", got)
	}

	tail := strings.Repeat("e", 300)
	ra1Send(t, membership, wire.SyncUpdate{Update: updateAppending(client, tail)})

	waitUntil(t, "the compaction the tail earned", func() bool { return r.ws.frameCount(t) == 1 })
	if got := ra1Replay(t, r.store.Frames(t, testDoc)); got != seed+"bcd"+tail {
		t.Fatalf("the compacted frame reads %q", got)
	}
}

func TestCompactionKeepsAnUpdateThatIsStillPending(t *testing.T) {
	source := newClient()
	first := updateAppending(source, "a")
	second := updateAppending(source, "b")
	server := newClient()

	if _, err := server.ApplyUpdate(second); err != nil {
		t.Fatal(err)
	}
	compacted := fullState(t, server)
	replica := newClient()
	if _, err := replica.ApplyUpdate(compacted); err != nil {
		t.Fatal(err)
	}
	if _, err := replica.ApplyUpdate(first); err != nil {
		t.Fatal(err)
	}

	if !server.HasPending() {
		t.Fatal("the server holds nothing pending")
	}
	if got := docText(server); got != "" {
		t.Fatalf("the server reads %q", got)
	}
	if got := docText(replica); got != "ab" {
		t.Fatalf("the replica reads %q", got)
	}
}

func TestDoesNotAckOrBroadcastBeforeAppendCompletes(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), true)
	writer, other := ra1V2(""), ra1Writer()
	membership, lineage := ra1JoinLineage(t, manager, writer)
	ra1Join(t, manager, other)
	client := syncedClient(t, manager, testDoc, "hello")
	update := updateAppending(client, "!")
	writer.clear()
	other.clear()
	pause := ra1NewPause()
	r.ops.beforeAppend.set(pause)
	writesBefore, _ := r.store.counts()

	received := ra1ReceiveAsync(t, membership, ra1Op(lineage, ra1OpOne, update))
	pause.waitEntered(t)

	ra1Empty(t, "the other", other)
	ra1Empty(t, "the writer", writer)
	if len(r.committed()) != 0 {
		t.Fatal("committed before the append finished")
	}
	if writes, _ := r.store.counts(); writes != writesBefore {
		t.Fatalf("%d working-set writes", writes-writesBefore)
	}

	pause.open()
	ra1Await(t, "the receive", received)

	if len(ra1SyncUpdates(t, other)) == 0 {
		t.Fatal("the other never got the update")
	}
	if ra1Has(t, writer, func(m wire.Message) bool { _, ok := m.(wire.Acknowledgement); return ok }) == 0 {
		t.Fatalf("the writer got %#v, want an acknowledgement", writer.messages(t))
	}
	if len(r.committed()) != 1 {
		t.Fatalf("%d committed, want 1", len(r.committed()))
	}
	// A journal room writes no working set at all.
	if writes, _ := r.store.counts(); writes != 0 {
		t.Fatalf("%d working-set writes, want 0", writes)
	}
}

func TestAcknowledgesAndBroadcastsToEveryV2MemberIncludingTheSubmitterAfterCommit(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), true)
	writer, other := ra1V2("user-7"), ra1V2("user-9")
	membership, lineage := ra1JoinLineage(t, manager, writer)
	ra1Join(t, manager, other)
	client := syncedClient(t, manager, testDoc, "hello")
	update := updateAppending(client, "!")
	writer.clear()
	other.clear()

	ra1Send(t, membership, ra1Op(lineage, ra1OpOne, update))

	ra1OnlyUpdate(t, "the other", other, update)
	got := writer.messages(t)
	if len(got) != 2 {
		t.Fatalf("the writer got %#v, want the update then the acknowledgement", got)
	}
	if relay, ok := got[0].(wire.SyncUpdate); !ok || !bytes.Equal(relay.Update, update) {
		t.Fatalf("first frame %#v", got[0])
	}
	if got[1] != wire.Message(wire.Acknowledgement{Lineage: lineage, OperationID: ra1OpOne, ServerSequence: 1}) {
		t.Fatalf("second frame %#v", got[1])
	}
	committed := r.committed()
	if len(committed) != 1 {
		t.Fatalf("%d committed, want 1", len(committed))
	}
	record := committed[0]
	if record.OperationID != ra1OpOne || record.Sequence != 1 || record.ActorID == nil || *record.ActorID != "user-7" ||
		record.Source != operation.SourceClientV2 || !bytes.Equal(record.Update, update) {
		t.Fatalf("record %+v", record)
	}
}

func TestAppendFailureClosesEveryMemberWithCommitUnavailable(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), true)
	writer, other := ra1V2(""), ra1Writer()
	membership, lineage := ra1JoinLineage(t, manager, writer)
	ra1Join(t, manager, other)
	client := syncedClient(t, manager, testDoc, "hello")
	update := updateAppending(client, "!")
	r.ops.setFailAppends(errors.New("the journal is down"), false)

	ra1Send(t, membership, ra1Op(lineage, ra1OpOne, update))

	ra1ClosedOnce(t, "the writer", writer, collab.CloseCommitUnavailable)
	ra1ClosedOnce(t, "the other", other, collab.CloseCommitUnavailable)
}

func TestAppendFailureClosesAndDiscardsTheRoomWithoutObservation(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), true)
	writer, other := ra1V2(""), ra1Writer()
	membership, lineage := ra1JoinLineage(t, manager, writer)
	ra1Join(t, manager, other)
	client := syncedClient(t, manager, testDoc, "hello")
	update := updateAppending(client, "!")
	writer.clear()
	other.clear()
	r.ops.setFailAppends(errors.New("the journal is down"), false)

	ra1Send(t, membership, ra1Op(lineage, ra1OpOne, update))

	ra1Empty(t, "the other", other)
	ra1Empty(t, "the writer", writer)
	if len(r.committed()) != 0 {
		t.Fatal("the failed append committed")
	}
	if manager.LiveRoomCount() != 0 {
		t.Fatal("the room stayed loaded")
	}
	// The fence goes with the room.
	outcome, session, err := r.operations.Open(context.Background(), testDoc)
	if err != nil || outcome != journal.Opened {
		t.Fatalf("reopen = %v, %v", outcome, err)
	}
	_ = session.Close()
}

func TestUnknownCommitOutcomeClosesAndRetryResolvesById(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), true)
	writer, other := ra1V2(""), ra1Writer()
	membership, lineage := ra1JoinLineage(t, manager, writer)
	ra1Join(t, manager, other)
	client := syncedClient(t, manager, testDoc, "hello")
	update := updateAppending(client, "!")
	writer.clear()
	other.clear()
	r.ops.setFailAppends(errors.New("the journal could not answer"), true)

	ra1Send(t, membership, ra1Op(lineage, ra1OpOne, update))

	ra1ClosedOnce(t, "the writer", writer, collab.CloseCommitUnavailable)
	ra1Empty(t, "the other", other)
	ra1Empty(t, "the writer", writer)
	if len(r.committed()) != 1 {
		t.Fatalf("%d committed, want 1", len(r.committed()))
	}

	r.ops.setFailAppends(nil, false)
	r.clock.Advance(2 * time.Second)
	retryMember := ra1V2("")
	retry, retryLineage := ra1JoinLineage(t, manager, retryMember)
	retryMember.clear()

	ra1Send(t, retry, ra1Op(retryLineage, ra1OpOne, update))

	ra1OnlyAck(t, retryMember, retryLineage, ra1OpOne, 1)
	if len(r.committed()) != 1 {
		t.Fatalf("%d committed, want 1", len(r.committed()))
	}
	if got := exportedText(t, manager, testDoc); got != "hello!" {
		t.Fatalf("the room reads %q", got)
	}
}

func TestRepeatedAppendFailureDoesNotReloadTheDocumentPerRetry(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), true)
	membership, lineage := ra1JoinLineage(t, manager, ra1V2(""))
	client := syncedClient(t, manager, testDoc, "hello")
	update := updateAppending(client, "!")
	r.ops.setFailAppends(errors.New("the journal is down"), false)

	ra1Send(t, membership, ra1Op(lineage, ra1OpOne, update))
	opensAfterFailure := r.ops.opens.Load()

	status := func() collab.JoinStatus {
		t.Helper()
		result, err := manager.Join(context.Background(), testDoc, ra1V2(""))
		if err != nil {
			t.Fatal(err)
		}
		return result.Status
	}
	for attempt := 0; attempt < 4; attempt++ {
		if got := status(); got != collab.JoinUnavailable {
			t.Fatalf("join %d = %v, want unavailable", attempt, got)
		}
	}
	if r.ops.opens.Load() != opensAfterFailure || r.endpoint.Loads() != 1 {
		t.Fatalf("%d opens (want %d), %d loads (want 1)", r.ops.opens.Load(), opensAfterFailure, r.endpoint.Loads())
	}

	// One join gets through when the cooldown ends; failing again doubles it.
	r.clock.Advance(2 * time.Second)
	second, secondLineage := ra1JoinLineage(t, manager, ra1V2(""))
	ra1Send(t, second, ra1Op(secondLineage, ra1OpTwo, update))

	r.clock.Advance(2 * time.Second)
	if got := status(); got != collab.JoinUnavailable {
		t.Fatalf("join inside the doubled wait = %v", got)
	}
	r.clock.Advance(2 * time.Second)
	if got := status(); got != collab.JoinJoined {
		t.Fatalf("join after the doubled wait = %v", got)
	}

	// One GET per room that loaded, none for a refused join. Go starts the
	// version GET on a goroutine, where C# counts it inline at the join.
	waitUntil(t, "a GET per opened room", func() bool { return int(r.ops.opens.Load()) == r.endpoint.Loads() })
	time.Sleep(20 * time.Millisecond)
	if int(r.ops.opens.Load()) != r.endpoint.Loads() {
		t.Fatalf("%d opens, %d loads", r.ops.opens.Load(), r.endpoint.Loads())
	}
}

func TestAnAppendPastTheStoreTimeoutIsCommitUnavailable(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	o := ra1Quiet()
	o.CommitTimeout = 300 * time.Millisecond
	manager := r.manager(t, o, true)
	writer, other := ra1V2(""), ra1Writer()
	membership, lineage := ra1JoinLineage(t, manager, writer)
	ra1Join(t, manager, other)
	client := syncedClient(t, manager, testDoc, "hello")
	update := updateAppending(client, "!")
	writer.clear()
	other.clear()
	never := ra1NewPause()
	r.ops.beforeAppend.set(never)

	received := ra1ReceiveAsync(t, membership, ra1Op(lineage, ra1OpOne, update))
	never.waitEntered(t)
	ra1Await(t, "the receive", received)

	ra1ClosedOnce(t, "the writer", writer, collab.CloseCommitUnavailable)
	ra1ClosedOnce(t, "the other", other, collab.CloseCommitUnavailable)
	ra1Empty(t, "the other", other)
	ra1Empty(t, "the writer", writer)
	if manager.LiveRoomCount() != 0 {
		t.Fatal("the room stayed loaded")
	}
}

func TestOpenElsewhereRefusesTheJoinAsUnavailable(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	outcome, held, err := r.operations.Open(context.Background(), testDoc)
	if err != nil || outcome != journal.Opened {
		t.Fatalf("open = %v, %v", outcome, err)
	}
	manager := r.manager(t, ra1Quiet(), true)

	refused, err := manager.Join(context.Background(), testDoc, ra1V2(""))

	if err != nil || refused.Status != collab.JoinUnavailable || refused.Membership != nil {
		t.Fatalf("join = %+v, %v; want unavailable with no membership", refused, err)
	}
	// Nothing was seeded behind the holder's back.
	if r.endpoint.Loads() != 0 || manager.LiveRoomCount() != 0 {
		t.Fatalf("%d loads, %d rooms", r.endpoint.Loads(), manager.LiveRoomCount())
	}

	_ = held.Close()

	joined, err := manager.Join(context.Background(), testDoc, ra1V2(""))
	if err != nil || joined.Status != collab.JoinJoined {
		t.Fatalf("join after the holder left = %v, %v", joined.Status, err)
	}
}

func TestLostAckRetryReturnsTheSameCommitWithoutRebroadcast(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), true)
	writer, other := ra1V2(""), ra1Writer()
	membership, lineage := ra1JoinLineage(t, manager, writer)
	ra1Join(t, manager, other)
	client := syncedClient(t, manager, testDoc, "hello")
	update := updateAppending(client, "!")
	ra1Send(t, membership, ra1Op(lineage, ra1OpOne, update))
	writer.clear()
	other.clear()

	ra1Send(t, membership, ra1Op(lineage, ra1OpOne, update))

	ra1OnlyAck(t, writer, lineage, ra1OpOne, 1)
	ra1Empty(t, "the other", other)
	if len(r.committed()) != 1 {
		t.Fatalf("%d committed, want 1", len(r.committed()))
	}
}

func TestSameIdDifferentBytesRejectsWithoutApply(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), true)
	writer, other := ra1V2(""), ra1Writer()
	membership, lineage := ra1JoinLineage(t, manager, writer)
	ra1Join(t, manager, other)
	client := syncedClient(t, manager, testDoc, "hello")
	ra1Send(t, membership, ra1Op(lineage, ra1OpOne, updateAppending(client, "!")))
	different := updateAppending(client, "?")
	writer.clear()
	other.clear()

	ra1Send(t, membership, ra1Op(lineage, ra1OpOne, different))

	got := writer.messages(t)
	want := wire.Rejection{Lineage: lineage, OperationID: ra1OpOne, Code: "operation-id-conflict"}
	if len(got) != 1 || got[0] != wire.Message(want) {
		t.Fatalf("the writer got %#v, want only %#v", got, want)
	}
	ra1Empty(t, "the other", other)
	ra1NotClosed(t, "the writer", writer)
	ra1NotClosed(t, "the other", other)
	if manager.LiveRoomCount() != 1 || len(r.committed()) != 1 {
		t.Fatalf("%d rooms, %d committed; want 1 and 1", manager.LiveRoomCount(), len(r.committed()))
	}
	if got := exportedText(t, manager, testDoc); got != "hello!" {
		t.Fatalf("the room reads %q", got)
	}
}

func TestCommittedOperationsBroadcastInServerSequenceOrder(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), true)
	first, second, observer := ra1V2(""), ra1V2(""), ra1Reader()
	firstMembership, firstLineage := ra1JoinLineage(t, manager, first)
	secondMembership, secondLineage := ra1JoinLineage(t, manager, second)
	ra1Join(t, manager, observer)
	client := syncedClient(t, manager, testDoc, "hello")
	firstUpdate := updateAppending(client, "a")
	secondUpdate := updateAppending(client, "b")
	observer.clear()
	pause := ra1NewPause()
	r.ops.beforeAppend.set(pause)

	slow := ra1ReceiveAsync(t, firstMembership, ra1Op(firstLineage, ra1OpOne, firstUpdate))
	pause.waitEntered(t)
	r.ops.beforeAppend.set(nil)
	overtaking := ra1ReceiveAsync(t, secondMembership, ra1Op(secondLineage, ra1OpTwo, secondUpdate))
	waitUntil(t, "the overtaking receive to queue", func() bool { return ra1LaneWaiters(manager) >= 1 })
	pause.open()
	ra1Await(t, "the slow receive", slow)
	ra1Await(t, "the overtaking receive", overtaking)

	submitted := [][]byte{firstUpdate, secondUpdate}
	var committed [][]byte
	for _, record := range r.committed() {
		committed = append(committed, record.Update)
	}
	same := func(got [][]byte) bool {
		return len(got) == 2 && bytes.Equal(got[0], submitted[0]) && bytes.Equal(got[1], submitted[1])
	}
	if !same(committed) {
		t.Fatal("the journal does not hold the operations in submission order")
	}
	if !same(ra1SyncUpdates(t, observer)) {
		t.Fatal("the observer did not see the operations in journal order")
	}
}

func TestReloadReplaysEveryAcknowledgedOperationAfterTheCheckpoint(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	o := ra1Quiet()
	o.EvictionLinger = 20 * time.Millisecond
	manager := r.manager(t, o, true)
	membership, lineage := ra1JoinLineage(t, manager, ra1V2(""))
	client := syncedClient(t, manager, testDoc, "hello")
	ra1Send(t, membership, ra1Op(lineage, ra1OpOne, updateAppending(client, "!")))
	ra1Send(t, membership, ra1Op(lineage, ra1OpTwo, updateAppending(client, "?")))
	membership.Leave()
	manager.Settle()

	waitUntil(t, "the room to be evicted", func() bool { return manager.LiveRoomCount() == 0 })

	// Through sequence 1, so operation one is reachable only via the
	// checkpoint: the open no longer returns it in the tail.
	outcome, session, err := r.operations.Open(context.Background(), testDoc)
	if err != nil || outcome != journal.Opened {
		t.Fatalf("open = %v, %v", outcome, err)
	}
	opened := session.OpenResult()
	replica := newClient()
	for _, frame := range opened.Baseline {
		if _, err := replica.ApplyUpdate(frame); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := replica.ApplyUpdate(opened.Tail[0].Update); err != nil {
		t.Fatal(err)
	}
	if err := session.WriteCheckpoint(context.Background(), operation.Checkpoint{Through: 1, State: fullState(t, replica)}); err != nil {
		t.Fatal(err)
	}
	_ = session.Close()

	if got := exportedText(t, manager, testDoc); got != "hello!?" {
		t.Fatalf("the reloaded room reads %q", got)
	}
	// The seed's GET and the reload's version GET, which Go runs on a goroutine.
	waitUntil(t, "the reload's version GET", func() bool { return r.endpoint.Loads() >= 2 })
	time.Sleep(20 * time.Millisecond)
	if got := r.endpoint.Loads(); got != 2 {
		t.Fatalf("%d loads, want 2", got)
	}
}

func TestUnjournalledProvisionalStateNeverExportsOrCheckpoints(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	o := ra1Brisk()
	o.EvictionLinger = 20 * time.Millisecond
	manager := r.manager(t, o, true)
	membership, lineage := ra1JoinLineage(t, manager, ra1V2(""))
	client := syncedClient(t, manager, testDoc, "hello")
	update := updateAppending(client, "!")
	r.ops.setFailAppends(errors.New("the journal is down"), false)

	ra1Send(t, membership, ra1Op(lineage, ra1OpOne, update))
	time.Sleep(100 * time.Millisecond)
	manager.Settle()

	if saves := r.endpoint.Saves(); len(saves) != 0 {
		t.Fatalf("saves %+v", saves)
	}
	if len(r.committed()) != 0 || r.operations.Checkpoint(testDoc) != nil {
		t.Fatal("the provisional state was journalled or checkpointed")
	}

	r.ops.setFailAppends(nil, false)
	r.clock.Advance(2 * time.Second)
	if got := exportedText(t, manager, testDoc); got != "hello" {
		t.Fatalf("the room reads %q", got)
	}
}

func TestWorkingSetOnlyRoomKeepsTheLegacyRelayPath(t *testing.T) {
	r := ra1NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.manager(t, ra1Quiet(), false)
	writer, other := ra1Writer(), ra1Writer()
	membership := ra1Join(t, manager, writer)
	ra1Join(t, manager, other)
	framesBefore := r.ws.frameCount(t)
	client := syncedClient(t, manager, testDoc, "hello")
	update := updateAppending(client, "!")
	writer.clear()
	other.clear()

	ra1Send(t, membership, wire.SyncUpdate{Update: update})

	ra1Empty(t, "the writer", writer)
	ra1OnlyUpdate(t, "the other", other, update)
	waitUntil(t, "the working set to catch up", func() bool { return r.ws.frameCount(t) == framesBefore+1 })

	// A v2 member, so the protocol gate lets the frame through and the
	// room's "no journal" guard is what stops it.
	negotiated := ra1V2("")
	negotiatedMembership, lineage := ra1JoinLineage(t, manager, negotiated)
	negotiated.clear()
	writer.clear()
	other.clear()

	ra1Send(t, negotiatedMembership, ra1Op(lineage, ra1OpOne, updateAppending(client, "?")))

	ra1Empty(t, "the v2 member", negotiated)
	ra1Empty(t, "the writer", writer)
	ra1Empty(t, "the other", other)
	if len(r.committed()) != 0 {
		t.Fatal("a working-set-only room committed")
	}
	if got := exportedText(t, manager, testDoc); got != "hello!" {
		t.Fatalf("the room reads %q", got)
	}
}

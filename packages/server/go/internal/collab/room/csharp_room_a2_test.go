package room

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/wire"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

// Twins of C# CollabRoomTests cases, plus four cases from three endpoint
// test classes, that had no Go twin. C# advances a manual clock to fire
// timers; here they run on short wall-time windows.

// ra2Pause is a hook a fake stops in until released: C# BeforeAppend and
// friends.
type ra2Pause struct {
	entered     chan struct{}
	release     chan struct{}
	enterOnce   sync.Once
	releaseOnce sync.Once
}

// ra2NewPause is released at cleanup, so an abandoned call ends before the
// manager's Drain (cleanups run last-in first-out).
func ra2NewPause(t *testing.T) *ra2Pause {
	p := &ra2Pause{entered: make(chan struct{}), release: make(chan struct{})}
	t.Cleanup(p.open)
	return p
}

func ra2OpenPause(t *testing.T) *ra2Pause {
	p := ra2NewPause(t)
	p.open()
	return p
}

func (p *ra2Pause) open() { p.releaseOnce.Do(func() { close(p.release) }) }

func (p *ra2Pause) wasEntered() bool {
	select {
	case <-p.entered:
		return true
	default:
		return false
	}
}

func (p *ra2Pause) waitEntered(t *testing.T, what string) {
	t.Helper()
	select {
	case <-p.entered:
	case <-time.After(10 * time.Second):
		t.Fatalf("timed out waiting for %s", what)
	}
}

// pass honours ctx when it is not nil, as the C# fake's token-aware hooks do.
func (p *ra2Pause) pass(ctx context.Context) error {
	p.enterOnce.Do(func() { close(p.entered) })
	if ctx == nil {
		<-p.release
		return nil
	}
	select {
	case <-p.release:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// --- the journal, with the C# FakeCollabOperationStore hooks ---

type ra2Journal struct {
	inner *fakeJournal

	mu            sync.Mutex
	opens         int
	beforeLookup  *ra2Pause
	beforeAppend  *ra2Pause
	beforeDispose *ra2Pause
	beforeReset   *ra2Pause
}

func (j *ra2Journal) hook(h **ra2Pause) *ra2Pause {
	j.mu.Lock()
	defer j.mu.Unlock()
	return *h
}

func (j *ra2Journal) set(h **ra2Pause, p *ra2Pause) {
	j.mu.Lock()
	defer j.mu.Unlock()
	*h = p
}

func (j *ra2Journal) openCount() int {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.opens
}

// failAppends is C# FailAppends = _ => new IOException(message); "" clears it.
func (j *ra2Journal) failAppends(message string) {
	j.inner.mu.Lock()
	defer j.inner.mu.Unlock()
	if message == "" {
		j.inner.failAppends = nil
		return
	}
	j.inner.failAppends = func(string) error { return errors.New(message) }
}

func (j *ra2Journal) Open(ctx context.Context, id string) (journal.OpenOutcome, OperationSession, error) {
	j.mu.Lock()
	j.opens++
	j.mu.Unlock()
	outcome, session, err := j.inner.Open(ctx, id)
	if session != nil {
		session = &ra2Session{fakeSession: session.(*fakeSession), journal: j}
	}
	return outcome, session, err
}

func (j *ra2Journal) Purge(_ context.Context, id string) (journal.PurgeOutcome, error) {
	j.inner.mu.Lock()
	defer j.inner.mu.Unlock()
	d := j.inner.doc(id)
	if d.open {
		return journal.PurgeOpenElsewhere, nil
	}
	d.baseline, d.records, d.checkpoint, d.head = nil, nil, nil, nil
	return journal.Purged, nil
}

type ra2Session struct {
	*fakeSession
	journal *ra2Journal
}

func (s *ra2Session) FindCommitted(ctx context.Context, operationID string, digest []byte) (operation.Lookup, error) {
	if p := s.journal.hook(&s.journal.beforeLookup); p != nil {
		if err := p.pass(ctx); err != nil {
			return operation.Lookup{}, err
		}
	}
	return s.fakeSession.FindCommitted(ctx, operationID, digest)
}

func (s *ra2Session) Append(ctx context.Context, candidate operation.Candidate) (operation.AppendResult, error) {
	if p := s.journal.hook(&s.journal.beforeAppend); p != nil {
		if err := p.pass(ctx); err != nil {
			return operation.AppendResult{}, err
		}
	}
	return s.fakeSession.Append(ctx, candidate)
}

func (s *ra2Session) Reset(ctx context.Context, reset operation.Reset) (operation.Head, error) {
	if p := s.journal.hook(&s.journal.beforeReset); p != nil {
		if err := p.pass(ctx); err != nil {
			return operation.Head{}, err
		}
	}
	return s.fakeSession.Reset(ctx, reset)
}

// Close ignores any context: C# DisposeAsync carries no token.
func (s *ra2Session) Close() error {
	if p := s.journal.hook(&s.journal.beforeDispose); p != nil {
		_ = p.pass(nil)
	}
	return s.fakeSession.Close()
}

// --- the working set, counting reads (C# store.Reads) ---

type ra2Store struct {
	*fakeWorkingSet
	mu    sync.Mutex
	reads int
}

func (s *ra2Store) Read(ctx context.Context, doc string) (*workingset.Set, error) {
	s.mu.Lock()
	s.reads++
	s.mu.Unlock()
	return s.fakeWorkingSet.Read(ctx, doc)
}

func (s *ra2Store) readCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.reads
}

// --- the converter, with the C# FakeDocConverter knobs ---

type ra2Conv struct {
	*textConverter

	mu                    sync.Mutex
	nextExportFailure     error
	editFailureAfterApply error
	editWritesNothing     bool
	editMovesTheDocUnseen bool
	emitSecondEditUpdate  bool
}

func (c *ra2Conv) knobs(set func(c *ra2Conv)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	set(c)
}

func (c *ra2Conv) Export(ctx context.Context, doc *yjs.Doc) (*jsjson.Object, error) {
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

func (c *ra2Conv) ApplyOps(ctx context.Context, doc *yjs.Doc, ops []convert.EditOp) error {
	c.mu.Lock()
	writesNothing, movesUnseen, second, failure := c.editWritesNothing, c.editMovesTheDocUnseen, c.emitSecondEditUpdate, c.editFailureAfterApply
	c.mu.Unlock()
	if writesNothing {
		return nil
	}
	if movesUnseen {
		foreign := newClient()
		updateAppending(foreign, "unseen")
		state, err := foreign.EncodeStateAsUpdate(nil)
		if err != nil {
			return err
		}
		_, err = doc.ApplyUpdate(state)
		return err
	}
	if err := c.textConverter.ApplyOps(ctx, doc, ops); err != nil {
		return err
	}
	if second {
		updateAppending(doc, ".")
	}
	return failure
}

// --- the room: the C# test class's fields ---

type ra2Room struct {
	*textRoom
	ws      *ra2Store
	journal *ra2Journal
	conv    *ra2Conv
}

func ra2NewRoom() *ra2Room {
	r := newTextRoom()
	return &ra2Room{
		textRoom: r,
		ws:       &ra2Store{fakeWorkingSet: r.store},
		journal:  &ra2Journal{inner: r.operations},
		conv:     &ra2Conv{textConverter: r.converter},
	}
}

func (r *ra2Room) managerWith(t *testing.T, o Options, journalled bool, converter Converter) *Manager {
	t.Helper()
	if o.Now == nil {
		o.Now = r.clock.Now
	}
	var operations OperationStore
	if journalled {
		operations = r.journal
	}
	manager := NewManager(ManagerOptions{
		Store: r.ws, Endpoint: r.endpoint, Converter: converter, Room: o, Log: r.logf, Operations: operations,
	})
	t.Cleanup(func() { _ = manager.Drain(context.Background()) })
	return manager
}

// journalManager is C# CreateJournalManager.
func (r *ra2Room) journalManager(t *testing.T, o Options) *Manager {
	t.Helper()
	return r.managerWith(t, o, true, r.conv)
}

func (r *ra2Room) writes() int {
	writes, _ := r.store.counts()
	return writes
}

func (r *ra2Room) workingSetResets() int {
	_, resets := r.store.counts()
	return resets
}

func (r *ra2Room) committed() []operation.Record { return r.operations.Committed(testDoc) }

// ra2Quiet: no timer fires during a test unless it asks for one.
func ra2Quiet() Options {
	return OptionsWith(func(ro *Options) {
		ro.ExportDebounce = time.Hour
		ro.ExportMaxDelay = time.Hour
		ro.EvictionLinger = time.Hour
	})
}

// ra2Brisk: every room timer fires within milliseconds.
func ra2Brisk() Options {
	return OptionsWith(func(ro *Options) {
		ro.ExportDebounce = 10 * time.Millisecond
		ro.ExportMaxDelay = 10 * time.Millisecond
		ro.EvictionLinger = 10 * time.Millisecond
		ro.RetryBackoff = 10 * time.Millisecond
		ro.RetryBackoffCap = 10 * time.Millisecond
	})
}

// ra2Stock is C# new FakeMember(): v1, may write.
func ra2Stock(actor string) *fakeMember {
	return &fakeMember{actor: actor, source: collab.SourceClientV1, write: true}
}

func ra2Reader() *fakeMember { return &fakeMember{source: collab.SourceClientV1} }

// ra2Enter is C# Join: a v2 member also completes the sync exchange.
func ra2Enter(t *testing.T, manager *Manager, member *fakeMember) collab.Membership {
	t.Helper()
	if member.source == collab.SourceClientV2 {
		return joinSynced(t, manager, testDoc, member)
	}
	return join(t, manager, testDoc, member)
}

func ra2Joined(t *testing.T, manager *Manager, member *fakeMember) (collab.Membership, string) {
	t.Helper()
	membership := ra2Enter(t, manager, member)
	return membership, controlTag(t, member).Lineage
}

func ra2Send(t *testing.T, membership collab.Membership, message wire.Message) {
	t.Helper()
	if err := membership.Receive(context.Background(), syncFrame(t, message)); err != nil {
		t.Fatal(err)
	}
}

// ra2Receive runs a receive off the test goroutine.
func ra2Receive(t *testing.T, membership collab.Membership, message wire.Message) <-chan error {
	frame := syncFrame(t, message)
	done := make(chan error, 1)
	go func() { done <- membership.Receive(context.Background(), frame) }()
	return done
}

func ra2Await(t *testing.T, what string, done <-chan error) {
	t.Helper()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("%s: %v", what, err)
		}
	case <-time.After(10 * time.Second):
		t.Fatalf("timed out waiting for %s", what)
	}
}

func ra2Op(lineage, operationID string, update []byte) wire.Operation {
	return wire.Operation{Lineage: lineage, OperationID: operationID, Update: update}
}

func ra2Closed(member *fakeMember, want ...collab.CloseReason) bool {
	return slices.Equal(member.closed(), want)
}

func ra2NoMessages(t *testing.T, who string, member *fakeMember) {
	t.Helper()
	if got := member.messages(t); len(got) != 0 {
		t.Fatalf("%s got %#v, want nothing", who, got)
	}
}

func ra2SyncUpdates(t *testing.T, member *fakeMember) [][]byte {
	t.Helper()
	var out [][]byte
	for _, message := range member.messages(t) {
		if update, ok := message.(wire.SyncUpdate); ok {
			out = append(out, update.Update)
		}
	}
	return out
}

// ra2OnlySyncUpdate: member got exactly one frame, a SyncUpdate carrying want.
func ra2OnlySyncUpdate(t *testing.T, who string, member *fakeMember, want []byte) {
	t.Helper()
	got := member.messages(t)
	if len(got) != 1 {
		t.Fatalf("%s got %#v, want one SyncUpdate", who, got)
	}
	if update, ok := got[0].(wire.SyncUpdate); !ok || !slices.Equal(update.Update, want) {
		t.Fatalf("%s got %#v, want SyncUpdate %v", who, got[0], want)
	}
}

func ra2AwarenessClaiming(clients uint64) []byte {
	var payload []byte
	payload = ra2VarUint(payload, clients)
	for client := range clients {
		payload = ra2VarUint(payload, 1000+client)
		payload = append(payload, 0x01, 0x02, '{', '}')
	}
	return payload
}

func ra2VarUint(payload []byte, value uint64) []byte {
	for value >= 0x80 {
		payload = append(payload, byte(value)|0x80)
		value >>= 7
	}
	return append(payload, byte(value))
}

// ra2ServerStateVector is C# ServerStateVectorAsync: the room's own state
// vector.
func ra2ServerStateVector(t *testing.T, manager *Manager, client *yjs.Doc) []byte {
	t.Helper()
	probe := ra2Reader()
	membership := join(t, manager, testDoc, probe)
	ra2Send(t, membership, wire.SyncStep1{StateVector: client.EncodeStateVector()})
	membership.Leave()
	for _, message := range probe.messages(t) {
		if step1, ok := message.(wire.SyncStep1); ok {
			return step1.StateVector
		}
	}
	t.Fatal("the probe got no SyncStep1")
	return nil
}

func ra2Diff(t *testing.T, client *yjs.Doc, vector []byte) []byte {
	t.Helper()
	diff, err := client.EncodeStateAsUpdate(vector)
	if err != nil {
		t.Fatal(err)
	}
	return diff
}

// ra2Appending is C# Appending: an insert of a paragraph holding text.
func ra2Appending(t *testing.T, id, text string) convert.EditOp {
	t.Helper()
	return convert.Insert{ID: id, Block: node(t, `{"id":"`+id+`","type":"paragraph","data":`+textJSON(t, text)+`}`)}
}

// ra2PlainEdit is C# EditAsync with no key of its own: a fresh id per call.
func ra2PlainEdit(t *testing.T, manager *Manager, ops ...convert.EditOp) EditResult {
	t.Helper()
	var id [16]byte
	_, _ = rand.Read(id[:])
	digest := make([]byte, 32)
	copy(digest, id[:])
	result, err := manager.Edit(context.Background(), testDoc, ops, hex.EncodeToString(id[:]), digest, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

// --- the cases ---

// DisposeAsync carries no token: the close is bounded and the session is
// abandoned, still holding the fence.
func TestASessionThatHangsInDisposeDoesNotWedgeTheRoom(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	o := ra2Quiet()
	o.CommitTimeout = 300 * time.Millisecond
	manager := r.journalManager(t, o)
	writer := v2Member()
	membership, lineage := ra2Joined(t, manager, writer)
	client := syncedClient(t, manager, testDoc, "hello")
	edit := updateAppending(client, "!")
	never := ra2NewPause(t)
	r.journal.set(&r.journal.beforeDispose, never)
	r.journal.failAppends("the journal is down")

	received := ra2Receive(t, membership, ra2Op(lineage, opOne, edit))
	never.waitEntered(t, "the dispose")
	ra2Await(t, "the receive", received)

	if !ra2Closed(writer, collab.CloseCommitUnavailable) {
		t.Fatalf("writer closes = %v, want [CommitUnavailable]", writer.closed())
	}
	if n := manager.LiveRoomCount(); n != 0 {
		t.Fatalf("live rooms = %d, want 0", n)
	}
	outcome, reopened, err := r.operations.Open(context.Background(), testDoc)
	if reopened != nil {
		_ = reopened.Close()
	}
	if err != nil || outcome != journal.DocumentOpenElsewhere {
		t.Fatalf("reopen = %v, %v; want DocumentOpenElsewhere (the abandoned session keeps the fence)", outcome, err)
	}
}

// A lookup runs in the lane too, so it is bounded like the append.
func TestALookupPastTheStoreTimeoutIsCommitUnavailable(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	o := ra2Quiet()
	o.CommitTimeout = 300 * time.Millisecond
	manager := r.journalManager(t, o)
	writer, other := v2Member(), ra2Stock("")
	membership, lineage := ra2Joined(t, manager, writer)
	ra2Enter(t, manager, other)
	client := syncedClient(t, manager, testDoc, "hello")
	edit := updateAppending(client, "!")
	writer.clear()
	other.clear()
	never := ra2NewPause(t)
	r.journal.set(&r.journal.beforeLookup, never)

	received := ra2Receive(t, membership, ra2Op(lineage, opOne, edit))
	never.waitEntered(t, "the lookup")
	ra2Await(t, "the receive", received)

	if !ra2Closed(writer, collab.CloseCommitUnavailable) {
		t.Fatalf("writer closes = %v, want [CommitUnavailable]", writer.closed())
	}
	ra2NoMessages(t, "other", other)
	if len(r.committed()) != 0 {
		t.Fatalf("committed = %v", r.committed())
	}
	if n := manager.LiveRoomCount(); n != 0 {
		t.Fatalf("live rooms = %d, want 0", n)
	}
}

func TestResettingAnOperationStoreRoomResetsTheJournalAndClosesMembers(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	writer := v2Member()
	ra2Enter(t, manager, writer)
	joined := controlTag(t, writer)

	reset, err := manager.Reset(context.Background(), testDoc)
	if err != nil || reset.Tag == nil {
		t.Fatalf("reset = %+v, %v", reset, err)
	}

	tag := *reset.Tag
	if tag.Format != joined.Format || tag.Epoch != joined.Epoch+1 || tag.Lineage == joined.Lineage {
		t.Fatalf("reset tag %+v after joined %+v", tag, joined)
	}
	if !ra2Closed(writer, collab.CloseReset) {
		t.Fatalf("writer closes = %v, want [Reset]", writer.closed())
	}
	if n := r.workingSetResets(); n != 0 {
		t.Fatalf("working-set resets = %d, want 0", n)
	}
	head := r.operations.Head(testDoc)
	if head == nil || head.Format != tag.Format || head.Epoch != tag.Epoch || head.Lineage != tag.Lineage {
		t.Fatalf("head = %+v, want the reset tag %+v", head, tag)
	}
}

// v1 on purpose: a v2 member's raw write is dropped on its own, so the test
// would pass without the reset fencing anything.
func TestAQueuedOldLineageReceiveCannotAppendAfterJournalReset(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	writer := ra2Stock("")
	membership := ra2Enter(t, manager, writer)
	joined := controlTag(t, writer)
	client := syncedClient(t, manager, testDoc, "hello")
	oldUpdate := updateAppending(client, "late")
	releaseLoad := make(chan struct{})
	r.endpoint.setLoadGate(releaseLoad)
	writer.clear()
	type outcome struct {
		result ResetResult
		err    error
	}
	resetDone := make(chan outcome, 1)
	go func() {
		result, err := manager.Reset(context.Background(), testDoc)
		resetDone <- outcome{result, err}
	}()
	waitUntil(t, "the reset endpoint load", func() bool { return r.endpoint.Loads() == 2 })
	appendHook := ra2OpenPause(t)
	r.journal.set(&r.journal.beforeAppend, appendHook)
	manager.mu.Lock()
	room := manager.rooms[testDoc]
	manager.mu.Unlock()

	queued := ra2Receive(t, membership, wire.SyncUpdate{Update: oldUpdate})
	// The reset holds the lane at the gated load, so the write queues behind it.
	waitForWaiters(t, &room.lane, 1)

	close(releaseLoad)
	var reset outcome
	select {
	case reset = <-resetDone:
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for the reset")
	}
	r.endpoint.setLoadGate(nil)
	ra2Await(t, "the queued receive", queued)

	if reset.err != nil || reset.result.Tag == nil {
		t.Fatalf("reset = %+v, %v", reset.result, reset.err)
	}
	if tag := *reset.result.Tag; tag.Epoch != joined.Epoch+1 || tag.Lineage == joined.Lineage {
		t.Fatalf("reset tag %+v after joined %+v", tag, joined)
	}
	if !ra2Closed(writer, collab.CloseReset) {
		t.Fatalf("writer closes = %v, want [Reset]", writer.closed())
	}
	ra2NoMessages(t, "writer", writer)
	if appendHook.wasEntered() {
		t.Fatal("the old-lineage write reached the append")
	}
	if len(r.committed()) != 0 {
		t.Fatalf("committed = %v", r.committed())
	}
	if n := manager.LiveRoomCount(); n != 0 {
		t.Fatalf("live rooms = %d, want 0", n)
	}
}

// One read, after the open: the journal's tombstone always wins first.
func TestResettingANewOperationStoreRoomOpensTheJournalBeforeTheWorkingSet(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())

	reset, err := manager.Reset(context.Background(), testDoc)
	if err != nil || reset.Tag == nil {
		t.Fatalf("reset = %+v, %v", reset, err)
	}

	if n := r.journal.openCount(); n != 1 {
		t.Fatalf("opens = %d, want 1", n)
	}
	if n := r.endpoint.Loads(); n != 1 {
		t.Fatalf("loads = %d, want 1", n)
	}
	if n := r.ws.readCount(); n != 1 {
		t.Fatalf("working-set reads = %d, want 1", n)
	}
	if reset.Tag.Epoch != 1 {
		t.Fatalf("epoch = %d, want 1", reset.Tag.Epoch)
	}
	if n := manager.LiveRoomCount(); n != 0 {
		t.Fatalf("live rooms = %d, want 0", n)
	}
}

func TestAJournalRoomResetDoesNotWriteTheWorkingSet(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())

	reset, err := manager.Reset(context.Background(), testDoc)
	if err != nil {
		t.Fatal(err)
	}

	if reset.Status != ResetDone {
		t.Fatalf("status = %v, want ResetDone", reset.Status)
	}
	if n := r.workingSetResets(); n != 0 {
		t.Fatalf("working-set resets = %d, want 0", n)
	}
	if n := r.writes(); n != 0 {
		t.Fatalf("working-set writes = %d, want 0", n)
	}
	head := r.operations.Head(testDoc)
	if reset.Tag == nil || head == nil || reset.Tag.Lineage != head.Lineage {
		t.Fatalf("reset tag %+v, head %+v", reset.Tag, head)
	}
}

// Frame 102 is a v2 frame: a v1 member gets no answer to one.
func TestAnOperationFrameFromAV1MemberIsDroppedWithoutJournalling(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	stock, other := ra2Stock(""), v2Member()
	membership, lineage := ra2Joined(t, manager, stock)
	ra2Enter(t, manager, other)
	client := syncedClient(t, manager, testDoc, "hello")
	edit := updateAppending(client, "!")
	stock.clear()
	other.clear()

	ra2Send(t, membership, ra2Op(lineage, opOne, edit))

	ra2NoMessages(t, "stock", stock)
	ra2NoMessages(t, "other", other)
	if got := stock.closed(); len(got) != 0 {
		t.Fatalf("stock closes = %v", got)
	}
	if len(r.committed()) != 0 {
		t.Fatalf("committed = %v", r.committed())
	}
	if got := exportedText(t, manager, testDoc); got != "hello" {
		t.Fatalf("exported %q, want hello", got)
	}
}

// Protocol §7: a raw write from a v2 member carries no operation id.
func TestARawWriteFromAV2MemberIsDroppedAndTheMemberIsClosed(t *testing.T) {
	for _, asSyncStep2 := range []bool{false, true} {
		name := "asSyncStep2=false"
		if asSyncStep2 {
			name = "asSyncStep2=true"
		}
		t.Run(name, func(t *testing.T) {
			r := ra2NewRoom()
			r.endpoint.Holds(t, testDoc, "hello", nil)
			manager := r.journalManager(t, ra2Quiet())
			writer, other := v2Member(), v2Member()
			membership := ra2Enter(t, manager, writer)
			ra2Enter(t, manager, other)
			client := syncedClient(t, manager, testDoc, "hello")
			edit := updateAppending(client, "!")
			writer.clear()
			other.clear()

			var raw wire.Message = wire.SyncUpdate{Update: edit}
			if asSyncStep2 {
				raw = wire.SyncStep2{Update: edit}
			}
			ra2Send(t, membership, raw)

			ra2NoMessages(t, "other", other)
			ra2NoMessages(t, "writer", writer)
			if !ra2Closed(writer, collab.CloseRawWriteOnV2) {
				t.Fatalf("writer closes = %v, want [RawWriteOnV2]", writer.closed())
			}
			if len(r.committed()) != 0 {
				t.Fatalf("committed = %v", r.committed())
			}
			if got := exportedText(t, manager, testDoc); got != "hello" {
				t.Fatalf("exported %q, want hello", got)
			}

			// The probe's join asked other for presence; clear that.
			other.clear()
			ra2Send(t, membership, wire.Awareness{Update: ra2AwarenessClaiming(1)})

			ra2NoMessages(t, "other", other)
			if !ra2Closed(writer, collab.CloseRawWriteOnV2) {
				t.Fatalf("writer closes = %v, want [RawWriteOnV2]", writer.closed())
			}
		})
	}
}

func TestARawWriteFromAV1MemberIsStillAppliedOnTheSameRoom(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	stock := ra2Stock("")
	membership := ra2Enter(t, manager, stock)
	client := syncedClient(t, manager, testDoc, "hello")

	ra2Send(t, membership, wire.SyncUpdate{Update: updateAppending(client, "!")})

	if got := stock.closed(); len(got) != 0 {
		t.Fatalf("stock closes = %v", got)
	}
	if n := len(r.committed()); n != 1 {
		t.Fatalf("committed %d, want 1", n)
	}
	if got := exportedText(t, manager, testDoc); got != "hello!" {
		t.Fatalf("exported %q, want hello!", got)
	}
}

func ra2OnlyRejection(t *testing.T, member *fakeMember) wire.Rejection {
	t.Helper()
	got := member.messages(t)
	if len(got) != 1 {
		t.Fatalf("got %#v, want one rejection", got)
	}
	rejection, ok := got[0].(wire.Rejection)
	if !ok {
		t.Fatalf("got %#v, want a rejection", got[0])
	}
	return rejection
}

func ra2HasAck(t *testing.T, member *fakeMember) bool {
	t.Helper()
	for _, message := range member.messages(t) {
		if _, ok := message.(wire.Acknowledgement); ok {
			return true
		}
	}
	return false
}

// Readiness is per membership: refused transiently, the socket stays open.
func TestAnOperationBeforeTheRoomAnsweredSyncStep1IsRejectedAsNotSynced(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	writer := v2Member()
	membership := join(t, manager, testDoc, writer)
	lineage := controlTag(t, writer).Lineage
	client := syncedClient(t, manager, testDoc, "hello")
	edit := updateAppending(client, "!")
	writer.clear()

	ra2Send(t, membership, ra2Op(lineage, opOne, edit))

	if rejection := ra2OnlyRejection(t, writer); rejection.Code != "not-synced" || rejection.OperationID != opOne {
		t.Fatalf("rejection = %+v, want not-synced for %s", rejection, opOne)
	}
	if len(r.committed()) != 0 {
		t.Fatalf("committed = %v", r.committed())
	}
	if got := writer.closed(); len(got) != 0 {
		t.Fatalf("writer closes = %v", got)
	}

	ra2Send(t, membership, wire.SyncStep1{StateVector: newClient().EncodeStateVector()})
	writer.clear()

	ra2Send(t, membership, ra2Op(lineage, opOne, edit))

	if !ra2HasAck(t, writer) {
		t.Fatalf("writer got %#v, want an acknowledgement", writer.messages(t))
	}
	if n := len(r.committed()); n != 1 {
		t.Fatalf("committed %d, want 1", n)
	}
}

func TestASyncStep1TheRoomCouldNotAnswerDoesNotMakeTheMemberSynced(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	writer := v2Member()
	membership := join(t, manager, testDoc, writer)
	lineage := controlTag(t, writer).Lineage
	client := syncedClient(t, manager, testDoc, "hello")
	edit := updateAppending(client, "!")

	// Not a state vector yjs can read: the answer fails and is dropped.
	ra2Send(t, membership, wire.SyncStep1{StateVector: []byte{0xff, 0xff, 0xff}})
	writer.clear()

	ra2Send(t, membership, ra2Op(lineage, opOne, edit))

	if rejection := ra2OnlyRejection(t, writer); rejection.Code != "not-synced" {
		t.Fatalf("rejection = %+v, want not-synced", rejection)
	}
	if len(r.committed()) != 0 {
		t.Fatalf("committed = %v", r.committed())
	}
}

func ra2AwarenessRelayed(t *testing.T, synced bool) {
	t.Helper()
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	writer, other := v2Member(), v2Member()
	var membership collab.Membership
	if synced {
		membership = ra2Enter(t, manager, writer)
		ra2Enter(t, manager, other)
	} else {
		membership = join(t, manager, testDoc, writer)
		join(t, manager, testDoc, other)
	}
	other.clear()

	ra2Send(t, membership, wire.Awareness{Update: ra2AwarenessClaiming(1)})

	got := other.messages(t)
	if len(got) != 1 {
		t.Fatalf("other got %#v, want one awareness frame", got)
	}
	if awareness, ok := got[0].(wire.Awareness); !ok || !slices.Equal(awareness.Update, ra2AwarenessClaiming(1)) {
		t.Fatalf("other got %#v, want the relayed awareness", got[0])
	}
	if got := writer.closed(); len(got) != 0 {
		t.Fatalf("writer closes = %v", got)
	}
}

// Presence is not a write.
func TestAwarenessBeforeTheSyncExchangeIsStillRelayed(t *testing.T) {
	ra2AwarenessRelayed(t, false)
}

func TestAwarenessAfterTheSyncExchangeIsStillRelayed(t *testing.T) {
	ra2AwarenessRelayed(t, true)
}

func TestV1UpdateIsJournalledBeforeBroadcastWithAServerGeneratedId(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	stock, other := ra2Stock("user-3"), ra2Stock("")
	membership := ra2Enter(t, manager, stock)
	ra2Enter(t, manager, other)
	client := syncedClient(t, manager, testDoc, "hello")
	edit := updateAppending(client, "!")
	stock.clear()
	other.clear()
	pause := ra2NewPause(t)
	r.journal.set(&r.journal.beforeAppend, pause)

	received := ra2Receive(t, membership, wire.SyncUpdate{Update: edit})
	pause.waitEntered(t, "the append")

	ra2NoMessages(t, "other", other)
	ra2NoMessages(t, "stock", stock)
	if len(r.committed()) != 0 {
		t.Fatalf("committed before the append returned: %v", r.committed())
	}
	if n := r.writes(); n != 0 {
		t.Fatalf("working-set writes = %d, want 0", n)
	}

	pause.open()
	ra2Await(t, "the receive", received)

	ra2OnlySyncUpdate(t, "other", other, edit)
	ra2NoMessages(t, "stock", stock)
	committed := r.committed()
	if len(committed) != 1 {
		t.Fatalf("committed %d, want 1", len(committed))
	}
	record := committed[0]
	if record.Source != operation.SourceClientV1 {
		t.Fatalf("source = %v, want ClientV1", record.Source)
	}
	if record.ActorID == nil || *record.ActorID != "user-3" {
		t.Fatalf("actor = %v, want user-3", record.ActorID)
	}
	if !slices.Equal(record.Update, edit) || record.Sequence != 1 {
		t.Fatalf("record = %+v", record)
	}
	if id, err := hex.DecodeString(record.OperationID); err != nil || len(id) != 16 || hex.EncodeToString(id) != record.OperationID {
		t.Fatalf("operation id %q is not 32 lowercase hex digits", record.OperationID)
	}
	if n := r.writes(); n != 0 {
		t.Fatalf("working-set writes = %d, want 0", n)
	}
}

// The same bytes as a SyncUpdate and then a SyncStep2: one row, no receipt.
func TestV1DuplicateStateConvergesButHasNoClientReceipt(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	stock, other := ra2Stock(""), ra2Stock("")
	membership := ra2Enter(t, manager, stock)
	ra2Enter(t, manager, other)
	client := syncedClient(t, manager, testDoc, "hello")
	edit := updateAppending(client, "!")
	stock.clear()
	other.clear()

	ra2Send(t, membership, wire.SyncUpdate{Update: edit})
	ra2Send(t, membership, wire.SyncStep2{Update: edit})

	ra2NoMessages(t, "stock", stock)
	committed := r.committed()
	if len(committed) != 1 || !slices.Equal(committed[0].Update, edit) {
		t.Fatalf("committed = %+v, want the one edit", committed)
	}
	ra2OnlySyncUpdate(t, "other", other, edit)
	if got := exportedText(t, manager, testDoc); got != "hello!" {
		t.Fatalf("exported %q, want hello!", got)
	}
}

// ra2Window gives an owed projection its window, then drains the lane: the
// stand-in for C# time.Advance followed by SettleAsync.
func ra2Window(manager *Manager) {
	time.Sleep(100 * time.Millisecond)
	manager.Settle()
}

func ra2IdleResyncRoom(t *testing.T) (*ra2Room, *Manager, *fakeMember, *fakeMember, collab.Membership) {
	t.Helper()
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	o := ra2Brisk()
	o.EvictionLinger = time.Hour
	manager := r.journalManager(t, o)
	stock, other := ra2Stock(""), ra2Stock("")
	membership := ra2Enter(t, manager, stock)
	ra2Enter(t, manager, other)
	return r, manager, stock, other, membership
}

// yjs writes the delete set whole, so an in-sync answer grows with the
// document's deletion history.
func TestAnIdleV1ResyncIsNotJournalledEvenWithDeletionHistory(t *testing.T) {
	r, manager, stock, other, membership := ra2IdleResyncRoom(t)
	pristine := syncedClient(t, manager, testDoc, "hello")
	twoBytes := ra2Diff(t, pristine, ra2ServerStateVector(t, manager, pristine))
	if !slices.Equal(twoBytes, []byte{0, 0}) {
		t.Fatalf("pristine answer = %v, want [0 0]", twoBytes)
	}
	stock.clear()
	other.clear()

	ra2Send(t, membership, wire.SyncStep2{Update: twoBytes})

	if len(r.committed()) != 0 {
		t.Fatalf("committed = %v", r.committed())
	}
	ra2NoMessages(t, "other", other)

	ra2Send(t, membership, wire.SyncUpdate{Update: updateDeleting(pristine, 4, 1)})
	synced := syncedClient(t, manager, testDoc, "hell")
	answer := ra2Diff(t, synced, ra2ServerStateVector(t, manager, synced))
	if len(answer) <= 2 {
		t.Fatalf("expected a carried delete set, got %d bytes", len(answer))
	}

	ra2Window(manager)
	committed := len(r.committed())
	writes := r.writes()
	stock.clear()
	other.clear()

	for range 3 {
		ra2Send(t, membership, wire.SyncStep2{Update: answer})
	}

	if n := len(r.committed()); n != committed {
		t.Fatalf("committed %d, want %d", n, committed)
	}
	ra2NoMessages(t, "stock", stock)
	ra2NoMessages(t, "other", other)
	if got := exportedText(t, manager, testDoc); got != "hell" {
		t.Fatalf("exported %q, want hell", got)
	}

	ra2Window(manager)
	if n := r.writes(); n != writes {
		t.Fatalf("working-set writes %d, want %d", n, writes)
	}
	if saves := r.endpoint.Saves(); len(saves) != 0 {
		t.Fatalf("endpoint saves = %+v", saves)
	}
}

// Summing parked lengths instead of unioning them reads the second update
// as nothing new.
func TestADeletionThatOnlyWidensParkedRangesIsStillJournalled(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	stock, other := ra2Stock(""), ra2Stock("")
	membership := ra2Enter(t, manager, stock)
	ra2Enter(t, manager, other)
	// No structs; a delete set naming client 7 twice, which appends.
	overlapping := []byte{0x00, 0x02, 0x07, 0x01, 0x01, 0x04, 0x07, 0x01, 0x02, 0x04}
	// One range over their union: the same raw total, more clocks.
	widening := []byte{0x00, 0x01, 0x07, 0x01, 0x01, 0x08}
	stock.clear()
	other.clear()

	ra2Send(t, membership, wire.SyncUpdate{Update: overlapping})
	ra2Send(t, membership, wire.SyncUpdate{Update: widening})

	if n := len(r.committed()); n != 2 {
		t.Fatalf("committed %d, want 2", n)
	}
	var relayed [][]byte
	for _, update := range ra2SyncUpdates(t, other) {
		if len(update) == len(widening) {
			relayed = append(relayed, update)
		}
	}
	if len(relayed) != 1 || !slices.Equal(relayed[0], widening) {
		t.Fatalf("relayed %v, want just the widening update", relayed)
	}
	ra2NoMessages(t, "stock", stock)
	if got := stock.closed(); len(got) != 0 {
		t.Fatalf("stock closes = %v", got)
	}
}

// While a delete set is parked every apply rebuilds it, so a parked-state
// signal must measure how much is parked, not whether it was touched.
func TestAnIdleV1ResyncIsNotJournalledWhileADeleteIsParked(t *testing.T) {
	r, manager, stock, other, membership := ra2IdleResyncRoom(t)
	client := syncedClient(t, manager, testDoc, "hello")
	twoBytes := ra2Diff(t, client, ra2ServerStateVector(t, manager, client))
	if !slices.Equal(twoBytes, []byte{0, 0}) {
		t.Fatalf("pristine answer = %v, want [0 0]", twoBytes)
	}

	// A deletion of text the server never received: it parks.
	stray := newClient()
	updateAppending(stray, "zz")
	ra2Send(t, membership, wire.SyncUpdate{Update: updateDeleting(stray, 0, 2)})

	ra2Window(manager)
	committed := len(r.committed())
	writes := r.writes()
	stock.clear()
	other.clear()

	for range 3 {
		ra2Send(t, membership, wire.SyncStep2{Update: twoBytes})
	}

	if n := len(r.committed()); n != committed {
		t.Fatalf("committed %d, want %d", n, committed)
	}
	ra2NoMessages(t, "stock", stock)
	ra2NoMessages(t, "other", other)
	if got := exportedText(t, manager, testDoc); got != "hello" {
		t.Fatalf("exported %q, want hello", got)
	}

	ra2Window(manager)
	if n := r.writes(); n != writes {
		t.Fatalf("working-set writes %d, want %d", n, writes)
	}
	if saves := r.endpoint.Saves(); len(saves) != 0 {
		t.Fatalf("endpoint saves = %+v", saves)
	}
}

// A deletion makes no structs, so the state vector cannot see it.
func TestAV1DeletionIsJournalledAndRelayed(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	stock, other := ra2Stock(""), ra2Stock("")
	membership := ra2Enter(t, manager, stock)
	ra2Enter(t, manager, other)
	client := syncedClient(t, manager, testDoc, "hello")
	deletion := updateDeleting(client, 4, 1)
	vectorBefore := ra2ServerStateVector(t, manager, client)
	stock.clear()
	other.clear()

	ra2Send(t, membership, wire.SyncUpdate{Update: deletion})

	committed := r.committed()
	if len(committed) != 1 || !slices.Equal(committed[0].Update, deletion) || committed[0].Source != operation.SourceClientV1 {
		t.Fatalf("committed = %+v, want the v1 deletion", committed)
	}
	ra2OnlySyncUpdate(t, "other", other, deletion)
	ra2NoMessages(t, "stock", stock)
	if got := ra2ServerStateVector(t, manager, client); !slices.Equal(got, vectorBefore) {
		t.Fatalf("state vector %v, want unchanged %v", got, vectorBefore)
	}
	if got := exportedText(t, manager, testDoc); got != "hell" {
		t.Fatalf("exported %q, want hell", got)
	}
}

func TestAV1UpdateThatOnlyParksPendingIsStillJournalled(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	stock, other := ra2Stock(""), ra2Stock("")
	membership := ra2Enter(t, manager, stock)
	ra2Enter(t, manager, other)
	client := syncedClient(t, manager, testDoc, "hello")
	updateAppending(client, "a")
	second := updateAppending(client, "b")
	stock.clear()
	other.clear()

	ra2Send(t, membership, wire.SyncUpdate{Update: second})

	committed := r.committed()
	if len(committed) != 1 || !slices.Equal(committed[0].Update, second) {
		t.Fatalf("committed = %+v, want the parked update", committed)
	}
	ra2OnlySyncUpdate(t, "other", other, second)

	// Bytes the engine cannot read are still refused.
	ra2Send(t, membership, wire.SyncUpdate{Update: []byte{0xde, 0xad, 0xbe, 0xef, 0x01}})

	if n := len(r.committed()); n != 1 {
		t.Fatalf("committed %d, want 1", n)
	}
	if n := len(other.messages(t)); n != 1 {
		t.Fatalf("other got %d frames, want 1", n)
	}
	if got := stock.closed(); len(got) != 0 {
		t.Fatalf("stock closes = %v", got)
	}
	if got := exportedText(t, manager, testDoc); got != "hello" {
		t.Fatalf("exported %q, want hello (still parked)", got)
	}
}

// The write gate comes before the journal on the v1 path too.
func TestAReadOnlyV1UpdateIsDroppedWithoutJournalling(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	reader, writer := ra2Reader(), ra2Stock("")
	membership := ra2Enter(t, manager, reader)
	ra2Enter(t, manager, writer)
	client := syncedClient(t, manager, testDoc, "hello")
	edit := updateAppending(client, " hacked")
	reader.clear()
	writer.clear()

	ra2Send(t, membership, wire.SyncUpdate{Update: edit})
	ra2Send(t, membership, wire.SyncStep2{Update: edit})

	if len(r.committed()) != 0 {
		t.Fatalf("committed = %v", r.committed())
	}
	ra2NoMessages(t, "reader", reader)
	ra2NoMessages(t, "writer", writer)
	if got := exportedText(t, manager, testDoc); got != "hello" {
		t.Fatalf("exported %q, want hello", got)
	}
}

func TestAFailedV1AppendDiscardsTheRoomWithoutRelayingOrExporting(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	o := ra2Brisk()
	o.EvictionLinger = 20 * time.Millisecond
	manager := r.journalManager(t, o)
	stock, other := ra2Stock(""), ra2Stock("")
	membership := ra2Enter(t, manager, stock)
	ra2Enter(t, manager, other)
	client := syncedClient(t, manager, testDoc, "hello")
	edit := updateAppending(client, "!")
	stock.clear()
	other.clear()
	r.journal.failAppends("the journal is down")

	ra2Send(t, membership, wire.SyncUpdate{Update: edit})

	if !ra2Closed(stock, collab.CloseCommitUnavailable) || !ra2Closed(other, collab.CloseCommitUnavailable) {
		t.Fatalf("closes = %v, %v; want CommitUnavailable for both", stock.closed(), other.closed())
	}
	ra2NoMessages(t, "stock", stock)
	ra2NoMessages(t, "other", other)
	if len(r.committed()) != 0 {
		t.Fatalf("committed = %v", r.committed())
	}
	if n := manager.LiveRoomCount(); n != 0 {
		t.Fatalf("live rooms = %d, want 0", n)
	}

	r.journal.failAppends("")
	time.Sleep(100 * time.Millisecond)
	r.clock.Advance(30 * time.Second)

	if saves := r.endpoint.Saves(); len(saves) != 0 {
		t.Fatalf("endpoint saves = %+v", saves)
	}
	if got := exportedText(t, manager, testDoc); got != "hello" {
		t.Fatalf("exported %q, want hello", got)
	}
}

// A second append under a held id with other bytes would discard the room.
func TestConsecutiveV1UpdatesAreJournalledUnderDistinctIds(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	stock := ra2Stock("")
	membership := ra2Enter(t, manager, stock)
	client := syncedClient(t, manager, testDoc, "hello")
	stock.clear()

	ra2Send(t, membership, wire.SyncUpdate{Update: updateAppending(client, "!")})
	ra2Send(t, membership, wire.SyncUpdate{Update: updateAppending(client, "?")})

	committed := r.committed()
	if len(committed) != 2 || committed[0].OperationID == committed[1].OperationID {
		t.Fatalf("committed = %+v, want two rows under distinct ids", committed)
	}
	if committed[0].Sequence != 1 || committed[1].Sequence != 2 {
		t.Fatalf("sequences %d, %d; want 1, 2", committed[0].Sequence, committed[1].Sequence)
	}
	ra2NoMessages(t, "stock", stock)
	if got := stock.closed(); len(got) != 0 {
		t.Fatalf("stock closes = %v", got)
	}
	if got := exportedText(t, manager, testDoc); got != "hello!?" {
		t.Fatalf("exported %q, want hello!?", got)
	}
}

// The HTTP edit path goes through the same cooldown.
func TestAnEditIsRefusedWhileTheDocumentIsInItsCommitCooldown(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	writer := v2Member()
	membership, lineage := ra2Joined(t, manager, writer)
	client := syncedClient(t, manager, testDoc, "hello")
	edit := updateAppending(client, "!")
	r.journal.failAppends("the journal is down")
	ra2Send(t, membership, ra2Op(lineage, opOne, edit))
	opens := r.journal.openCount()

	refused := ra2PlainEdit(t, manager, ra2Appending(t, "b-1", "x"))

	if refused.Status != EditUnavailable {
		t.Fatalf("status = %v, want EditUnavailable", refused.Status)
	}
	if n := r.journal.openCount(); n != opens {
		t.Fatalf("opens = %d, want %d", n, opens)
	}
	if n := r.endpoint.Loads(); n != 1 {
		t.Fatalf("loads = %d, want 1", n)
	}
}

// ra2EditRoom: a journal room on "hello" with a v2 writer and a v1
// observer, their frames cleared.
func ra2EditRoom(t *testing.T) (*ra2Room, *Manager, *fakeMember, *fakeMember) {
	t.Helper()
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	writer, observer := v2Member(), ra2Stock("")
	ra2Enter(t, manager, writer)
	ra2Enter(t, manager, observer)
	writer.clear()
	observer.clear()
	return r, manager, writer, observer
}

func ra2ClosedWithoutObservation(t *testing.T, r *ra2Room, writer, observer *fakeMember, result EditResult) {
	t.Helper()
	if result.Status != EditUnavailable {
		t.Fatalf("status = %v, want EditUnavailable", result.Status)
	}
	if !ra2Closed(writer, collab.CloseCommitUnavailable) || !ra2Closed(observer, collab.CloseCommitUnavailable) {
		t.Fatalf("closes = %v, %v; want CommitUnavailable for both", writer.closed(), observer.closed())
	}
	ra2NoMessages(t, "writer", writer)
	ra2NoMessages(t, "observer", observer)
	if len(r.committed()) != 0 {
		t.Fatalf("committed = %v", r.committed())
	}
	if saves := r.endpoint.Saves(); len(saves) != 0 {
		t.Fatalf("endpoint saves = %+v", saves)
	}
}

func TestAPostApplyFailureClosesWithoutObservation(t *testing.T) {
	r, manager, writer, observer := ra2EditRoom(t)
	r.conv.knobs(func(c *ra2Conv) { c.editFailureAfterApply = errors.New("the converter failed after writing") })

	result := ra2PlainEdit(t, manager, ra2Appending(t, "b-1", "x"))

	ra2ClosedWithoutObservation(t, r, writer, observer, result)
	r.clock.Advance(2 * time.Second)
	r.conv.knobs(func(c *ra2Conv) { c.editFailureAfterApply = nil })
	if got := exportedText(t, manager, testDoc); got != "hello" {
		t.Fatalf("exported %q, want hello", got)
	}
}

// Zero local updates fails only when the doc moved.
func TestAnEditThatMovesTheDocWithoutALocalUpdateClosesWithoutObservation(t *testing.T) {
	r, manager, writer, observer := ra2EditRoom(t)
	r.conv.knobs(func(c *ra2Conv) { c.editMovesTheDocUnseen = true })

	result := ra2PlainEdit(t, manager, ra2Appending(t, "b-1", "x"))

	ra2ClosedWithoutObservation(t, r, writer, observer, result)
	r.clock.Advance(2 * time.Second)
	r.conv.knobs(func(c *ra2Conv) { c.editMovesTheDocUnseen = false })
	if got := exportedText(t, manager, testDoc); got != "hello" {
		t.Fatalf("exported %q, want hello", got)
	}
}

func TestAnEditThatWritesNothingIsAppliedWithoutAnAppend(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	writer := v2Member()
	ra2Enter(t, manager, writer)
	writer.clear()
	r.conv.knobs(func(c *ra2Conv) { c.editWritesNothing = true })

	result := ra2PlainEdit(t, manager, ra2Appending(t, "b-1", "x"))

	if result.Status != EditApplied {
		t.Fatalf("status = %v (%v), want EditApplied", result.Status, result.Err)
	}
	head := r.operations.Head(testDoc)
	if head == nil || result.Receipt == nil || head.DurableThrough != result.Receipt.ServerSequence {
		t.Fatalf("head %+v, receipt %+v; want the receipt at the durable head", head, result.Receipt)
	}
	if got := writer.closed(); len(got) != 0 {
		t.Fatalf("writer closes = %v", got)
	}
	ra2NoMessages(t, "writer", writer)
	if len(r.committed()) != 0 {
		t.Fatalf("committed = %v", r.committed())
	}
	if n := manager.LiveRoomCount(); n != 1 {
		t.Fatalf("live rooms = %d, want 1", n)
	}
}

// The real converter writes nothing for HTML that only changed spelling.
func TestUnderAJournalARespelledParagraphEditIsAppliedAndKeepsTheRoom(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.HoldsDocument(t, testDoc, `{"blocks":[{"id":"p","type":"paragraph","data":{"text":"<strong>x</strong>&nbsp;y"}}]}`, nil)
	converter := &convert.DocConverter{Now: r.clock.Now, HTML: runtimeReader(t)}
	manager := r.managerWith(t, ra2Quiet(), true, converter)
	writer := v2Member()
	ra2Enter(t, manager, writer)

	result := ra2PlainEdit(t, manager, convert.Update{ID: "p", Data: node(t, `{"text":"<b>x</b> y<br>"}`)})

	if result.Status != EditApplied {
		t.Fatalf("status = %v (%v), want EditApplied", result.Status, result.Err)
	}
	if got := writer.closed(); len(got) != 0 {
		t.Fatalf("writer closes = %v", got)
	}
	if len(r.committed()) != 0 {
		t.Fatalf("committed = %v", r.committed())
	}
	if n := manager.LiveRoomCount(); n != 1 {
		t.Fatalf("live rooms = %d, want 1", n)
	}
}

func TestAnEditWithMultipleLocalUpdatesClosesWithoutObservation(t *testing.T) {
	r, manager, writer, observer := ra2EditRoom(t)
	r.conv.knobs(func(c *ra2Conv) { c.emitSecondEditUpdate = true })

	result := ra2PlainEdit(t, manager, ra2Appending(t, "b-1", "x"))

	ra2ClosedWithoutObservation(t, r, writer, observer, result)
	r.clock.Advance(2 * time.Second)
	r.conv.knobs(func(c *ra2Conv) { c.emitSecondEditUpdate = false })
	if got := exportedText(t, manager, testDoc); got != "hello" {
		t.Fatalf("exported %q, want hello", got)
	}
}

func TestAWorkingSetInAnotherFormatFailsTheOpenAndIsKept(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "from-endpoint", nil)
	r.store.Seed(t, testDoc, [][]byte{fullState(t, docWith("from-ws"))},
		workingset.Tag{Format: workingset.CurrentFormat + 1, Epoch: 0, Lineage: tagLineage})
	manager := r.journalManager(t, ra2Quiet())

	state, err := manager.State(context.Background(), testDoc)
	if err != nil {
		t.Fatal(err)
	}

	if state.Status != StateSeedFailed {
		t.Fatalf("status = %v, want StateSeedFailed", state.Status)
	}
	if !r.store.Holds(testDoc) {
		t.Fatal("the working set was dropped")
	}
	if head := r.operations.Head(testDoc); head != nil {
		t.Fatalf("head = %+v, want none", head)
	}
}

func TestAFailedWorkingSetRetireStillOpensAndTheNextLoadRetriesIt(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "from-endpoint", nil)
	r.store.Seed(t, testDoc, [][]byte{fullState(t, docWith("from-ws"))}, tagAt(3))
	r.store.setFailRetires(func(string) error { return errors.New("the disk is busy") })
	manager := r.journalManager(t, ra2Quiet())

	state, json := stateText(t, manager, testDoc)

	if state.Status != StateReady || json != `{"text":"from-ws"}` {
		t.Fatalf("state = %v %s", state.Status, json)
	}
	if !r.store.Holds(testDoc) {
		t.Fatal("the working set is gone though its retire failed")
	}

	if err := manager.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}
	r.store.setFailRetires(nil)
	_, reloaded := stateText(t, r.journalManager(t, ra2Quiet()), testDoc)

	if reloaded != `{"text":"from-ws"}` {
		t.Fatalf("reloaded %s", reloaded)
	}
	if r.store.Holds(testDoc) {
		t.Fatal("the next load did not retire the working set")
	}
}

func TestAResetOfAHeadlessDocumentDropsItsWorkingSet(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "from-endpoint", nil)
	r.store.Seed(t, testDoc, [][]byte{fullState(t, docWith("from-ws"))}, tagAt(3))
	manager := r.journalManager(t, ra2Quiet())

	if _, err := manager.Reset(context.Background(), testDoc); err != nil {
		t.Fatal(err)
	}

	if r.store.Holds(testDoc) {
		t.Fatal("the working set survived the reset")
	}
	if _, json := stateText(t, manager, testDoc); json != `{"text":"from-endpoint"}` {
		t.Fatalf("state %s", json)
	}
}

func TestAJournalRoomNeverWritesTheWorkingSet(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	httpEdit(t, manager, testDoc, opOne, "!")

	if err := manager.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}

	if n := r.writes(); n != 0 {
		t.Fatalf("working-set writes = %d, want 0", n)
	}
	if r.store.Holds(testDoc) {
		t.Fatal("the journal room left a working set")
	}
}

func TestStateIsTheLiveExportAndTheHeadItReflects(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	edit := httpEdit(t, manager, testDoc, opOne, "!")

	state, json := stateText(t, manager, testDoc)

	if state.Status != StateReady || json != `{"text":"hello!"}` {
		t.Fatalf("state = %v %s", state.Status, json)
	}
	if edit.Receipt == nil || state.Head == nil || *state.Head != *edit.Receipt {
		t.Fatalf("head %+v, edit receipt %+v; want them equal", state.Head, edit.Receipt)
	}
}

func TestStateWithoutAJournalHasNoHead(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.managerWith(t, ra2Quiet(), false, r.conv)
	ra2PlainEdit(t, manager, ra2Appending(t, "b-1", "!"))

	state, json := stateText(t, manager, testDoc)

	if state.Status != StateReady || json != `{"text":"hello!"}` {
		t.Fatalf("state = %v %s", state.Status, json)
	}
	if state.Head != nil {
		t.Fatalf("head = %+v, want none", state.Head)
	}
}

func ra2Evicting() Options {
	o := ra2Quiet()
	o.EvictionLinger = 200 * time.Millisecond
	return o
}

func TestAColdRoomLoadedByStateIsEvicted(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Evicting())

	state, err := manager.State(context.Background(), testDoc)
	if err != nil {
		t.Fatal(err)
	}

	if state.Status != StateReady {
		t.Fatalf("status = %v, want StateReady", state.Status)
	}
	if n := manager.LiveRoomCount(); n != 1 {
		t.Fatalf("live rooms = %d, want 1", n)
	}
	waitUntil(t, "the room to be evicted", func() bool { return manager.LiveRoomCount() == 0 })
}

func TestStateOfAPurgedDocumentIsRefused(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	httpEdit(t, manager, testDoc, opOne, "!")
	allow := func(context.Context) (bool, error) { return true, nil }
	if _, err := manager.Purge(context.Background(), testDoc, allow); err != nil {
		t.Fatal(err)
	}
	loads := r.endpoint.Loads()

	state, err := manager.State(context.Background(), testDoc)
	if err != nil {
		t.Fatal(err)
	}

	if state.Status != StatePurged {
		t.Fatalf("status = %v, want StatePurged", state.Status)
	}
	if n := r.endpoint.Loads(); n != loads {
		t.Fatalf("loads = %d, want %d", n, loads)
	}
}

func TestStateIsRefusedWhileDraining(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	if err := manager.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}

	state, err := manager.State(context.Background(), testDoc)
	if err != nil {
		t.Fatal(err)
	}

	if state.Status != StateDraining {
		t.Fatalf("status = %v, want StateDraining", state.Status)
	}
}

func TestAnExportFailureIsReportedWithoutClosingTheRoom(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	httpEdit(t, manager, testDoc, opOne, "!")
	r.conv.knobs(func(c *ra2Conv) { c.nextExportFailure = errors.New("unreadable block") })

	state, err := manager.State(context.Background(), testDoc)
	if err != nil {
		t.Fatal(err)
	}

	if state.Status != StateExportFailed {
		t.Fatalf("status = %v, want StateExportFailed", state.Status)
	}
	if n := manager.LiveRoomCount(); n != 1 {
		t.Fatalf("live rooms = %d, want 1", n)
	}
}

func TestAColdRoomLoadedByACommittedKeyReplayIsStillEvicted(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Evicting())
	httpEdit(t, manager, testDoc, opOne, "!")
	waitUntil(t, "the first room to be evicted", func() bool { return manager.LiveRoomCount() == 0 })

	replay := httpEdit(t, manager, testDoc, opOne, "!")

	if replay.Status != EditApplied {
		t.Fatalf("status = %v, want EditApplied", replay.Status)
	}
	if n := manager.LiveRoomCount(); n != 1 {
		t.Fatalf("live rooms = %d, want 1", n)
	}
	waitUntil(t, "the replay's room to be evicted", func() bool { return manager.LiveRoomCount() == 0 })
}

// --- SyncEndpointTests, ResetEndpointTests and JournalFailureGateTests
// cases, driven through the manager instead of a socket ---

// ra2Handshake joins member, answers its SyncStep1 from an empty client and
// returns the raw frames of the whole handshake.
func ra2Handshake(t *testing.T, manager *Manager, member *fakeMember) [][]byte {
	t.Helper()
	joinSynced(t, manager, testDoc, member)
	manager.Settle()
	member.mu.Lock()
	defer member.mu.Unlock()
	return slices.Clone(member.frames)
}

func TestAV2JoinReceivesTheSameHandshakeBytesAsAV1Join(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	o := ra2Quiet()
	o.AnnouncedMaxMessageBytes = 1 << 20
	manager := r.journalManager(t, o)
	v1Frames := ra2Handshake(t, manager, ra2Stock(""))
	joiner := v2Member()
	v2Frames := ra2Handshake(t, manager, joiner)

	var kinds []string
	for _, message := range joiner.messages(t) {
		switch message.(type) {
		case wire.BlokControl:
			kinds = append(kinds, "BlokControl")
		case wire.BlokLimits:
			kinds = append(kinds, "BlokLimits")
		case wire.Identities:
			kinds = append(kinds, "Identities")
		case wire.SyncStep2:
			kinds = append(kinds, "SyncStep2")
		case wire.SyncStep1:
			kinds = append(kinds, "SyncStep1")
		default:
			kinds = append(kinds, "other")
		}
	}
	if want := []string{"BlokControl", "BlokLimits", "Identities", "SyncStep2", "SyncStep1"}; !slices.Equal(kinds, want) {
		t.Fatalf("v2 handshake %v, want %v", kinds, want)
	}
	if !slices.EqualFunc(v1Frames, v2Frames, func(a, b []byte) bool { return slices.Equal(a, b) }) {
		t.Fatalf("v1 handshake %v\nv2 handshake %v", v1Frames, v2Frames)
	}
}

func TestAResyncOnAV2SessionIsAnsweredWithSyncStep2ThenAFreshServerSyncStep1(t *testing.T) {
	r := ra2NewRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.journalManager(t, ra2Quiet())
	writer := v2Member()
	membership := join(t, manager, testDoc, writer)
	lineage := controlTag(t, writer).Lineage
	doc := newClient()
	ra2Send(t, membership, wire.SyncStep1{StateVector: doc.EncodeStateVector()})
	var atJoin []byte
	for _, message := range writer.messages(t) {
		switch m := message.(type) {
		case wire.SyncStep2:
			if _, err := doc.ApplyUpdate(m.Update); err != nil {
				t.Fatal(err)
			}
		case wire.SyncStep1:
			atJoin = m.StateVector
		}
	}
	if atJoin == nil || docText(doc) != "hello" {
		t.Fatalf("handshake left %q, server vector %v", docText(doc), atJoin)
	}
	writer.clear()
	ra2Send(t, membership, ra2Op(lineage, opOne, updateAppending(doc, "!")))
	got := writer.messages(t)
	if len(got) != 2 {
		t.Fatalf("writer got %#v, want the relay then the acknowledgement", got)
	}
	if _, ok := got[0].(wire.SyncUpdate); !ok {
		t.Fatalf("first frame %#v, want SyncUpdate", got[0])
	}
	if _, ok := got[1].(wire.Acknowledgement); !ok {
		t.Fatalf("second frame %#v, want Acknowledgement", got[1])
	}
	writer.clear()

	ra2Send(t, membership, wire.SyncStep1{StateVector: atJoin})

	got = writer.messages(t)
	if len(got) != 2 {
		t.Fatalf("writer got %#v, want SyncStep2 then SyncStep1", got)
	}
	if _, ok := got[0].(wire.SyncStep2); !ok {
		t.Fatalf("first frame %#v, want SyncStep2", got[0])
	}
	step1, ok := got[1].(wire.SyncStep1)
	if !ok {
		t.Fatalf("second frame %#v, want SyncStep1", got[1])
	}
	if slices.Equal(step1.StateVector, atJoin) {
		t.Fatal("the resync answered the state vector from the join")
	}
}

// C# SetHead: an empty baseline at epoch, no records.
func ra2SetHead(j *fakeJournal, doc string, epoch int64, lineage string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	d := j.doc(doc)
	d.baseline, d.records, d.checkpoint = nil, nil, nil
	d.head = &operation.Head{Format: workingset.CurrentFormat, Epoch: epoch, Lineage: lineage}
}

func TestResetCommitsTheCurrentEndpointDocumentAndANewLineageBeforeReturning(t *testing.T) {
	r := ra2NewRoom()
	ra2SetHead(r.operations, testDoc, 7, "77777777777777777777777777777777")
	r.endpoint.Holds(t, testDoc, "seeded", nil)
	manager := r.journalManager(t, ra2Quiet())
	open := ra2Stock("")
	join(t, manager, testDoc, open)
	before := controlTag(t, open)
	if edited := ra2PlainEdit(t, manager, ra2Appending(t, "before-reset", "journal")); edited.Status != EditApplied {
		t.Fatalf("edit status = %v (%v)", edited.Status, edited.Err)
	}
	if n := len(r.committed()); n != 1 {
		t.Fatalf("committed %d, want 1", n)
	}
	r.endpoint.Holds(t, testDoc, "endpoint reset", nil)
	pause := ra2NewPause(t)
	r.journal.set(&r.journal.beforeReset, pause)

	type outcome struct {
		result ResetResult
		err    error
	}
	pending := make(chan outcome, 1)
	go func() {
		result, err := manager.Reset(context.Background(), testDoc)
		pending <- outcome{result, err}
	}()
	pause.waitEntered(t, "the store reset")

	select {
	case <-pending:
		t.Fatal("the reset returned before the store reset finished")
	default:
	}
	if head := r.operations.Head(testDoc); head == nil || head.Lineage != before.Lineage {
		t.Fatalf("head = %+v, want the joined lineage %s", head, before.Lineage)
	}
	if got := open.closed(); len(got) != 0 {
		t.Fatalf("the open member closed before the reset returned: %v", got)
	}

	pause.open()
	var reset outcome
	select {
	case reset = <-pending:
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for the reset")
	}

	if reset.err != nil || reset.result.Status != ResetDone {
		t.Fatalf("reset = %+v, %v", reset.result, reset.err)
	}
	after := r.operations.Head(testDoc)
	if after == nil || after.Epoch != before.Epoch+1 || after.Lineage == before.Lineage || after.DurableThrough != 0 {
		t.Fatalf("head after = %+v, joined %+v", after, before)
	}
	if !ra2Closed(open, collab.CloseReset) {
		t.Fatalf("open closes = %v, want [Reset]", open.closed())
	}

	fresh := ra2Stock("")
	membership := join(t, manager, testDoc, fresh)
	if reopened := controlTag(t, fresh); reopened.Epoch != after.Epoch || reopened.Lineage != after.Lineage {
		t.Fatalf("reopened tag %+v, want head %+v", reopened, after)
	}
	mirror := newClient()
	ra2Send(t, membership, wire.SyncStep1{StateVector: mirror.EncodeStateVector()})
	for _, message := range fresh.messages(t) {
		if step2, ok := message.(wire.SyncStep2); ok {
			if _, err := mirror.ApplyUpdate(step2.Update); err != nil {
				t.Fatal(err)
			}
		}
	}
	if got := docText(mirror); got != "endpoint reset" {
		t.Fatalf("the fresh member reads %q, want endpoint reset", got)
	}
}

// ra2ExportWindow is C# ExportWindow: debounce, max delay and backoff of
// 100 ms. No room evicts, since eviction would flush a projection.
func ra2ExportWindow() Options {
	return OptionsWith(func(ro *Options) {
		ro.ExportDebounce = 100 * time.Millisecond
		ro.ExportMaxDelay = 100 * time.Millisecond
		ro.RetryBackoff = 100 * time.Millisecond
		ro.EvictionLinger = 5 * time.Minute
	})
}

// ra2SettleWindow gives an owed projection its whole window, then drains.
func ra2SettleWindow(manager *Manager) {
	time.Sleep(400 * time.Millisecond)
	manager.Settle()
}

func ra2Unobserved(t *testing.T, r *ra2Room) {
	t.Helper()
	if saves := r.endpoint.Saves(); len(saves) != 0 {
		t.Fatalf("endpoint saves = %+v", saves)
	}
	if n := r.writes(); n != 0 {
		t.Fatalf("working-set writes = %d, want 0", n)
	}
	if r.store.Holds(testDoc) {
		t.Fatal("a working set exists")
	}
}

func TestAJournalThatCannotCommitLetsNothingBecomeObservable(t *testing.T) {
	t.Run("the append fails on a v2 socket", func(t *testing.T) {
		r := ra2NewRoom()
		r.endpoint.Holds(t, testDoc, "seeded", nil)
		manager := r.journalManager(t, ra2ExportWindow())
		writer := v2Member()
		membership, lineage := ra2Joined(t, manager, writer)
		peer := ra2Stock("")
		joinSynced(t, manager, testDoc, peer)
		client := syncedClient(t, manager, testDoc, "seeded")
		writer.clear()
		peer.clear()
		r.journal.failAppends("the journal volume is gone")

		ra2Send(t, membership, ra2Op(lineage, opOne, updateAppending(client, "!")))

		ra2NoMessages(t, "peer", peer)
		ra2NoMessages(t, "writer", writer)
		if !ra2Closed(peer, collab.CloseCommitUnavailable) || !ra2Closed(writer, collab.CloseCommitUnavailable) {
			t.Fatalf("closes = %v, %v; want CommitUnavailable for both", peer.closed(), writer.closed())
		}
		if len(r.committed()) != 0 || r.operations.Checkpoint(testDoc) != nil {
			t.Fatalf("committed %v, checkpoint %+v", r.committed(), r.operations.Checkpoint(testDoc))
		}
		ra2SettleWindow(manager)
		ra2Unobserved(t, r)
		r.clock.Advance(30 * time.Second)
		if got := exportedText(t, manager, testDoc); got != "seeded" {
			t.Fatalf("a later reader reads %q, want seeded", got)
		}
	})

	t.Run("the append fails on an HTTP edit", func(t *testing.T) {
		r := ra2NewRoom()
		r.endpoint.Holds(t, testDoc, "seeded", nil)
		manager := r.journalManager(t, ra2ExportWindow())
		peer := ra2Stock("")
		joinSynced(t, manager, testDoc, peer)
		peer.clear()
		r.journal.failAppends("the journal volume is gone")

		refused := ra2PlainEdit(t, manager, ra2Appending(t, "new", "!"))

		if refused.Status != EditUnavailable {
			t.Fatalf("status = %v, want EditUnavailable", refused.Status)
		}
		ra2NoMessages(t, "peer", peer)
		if !ra2Closed(peer, collab.CloseCommitUnavailable) {
			t.Fatalf("peer closes = %v, want [CommitUnavailable]", peer.closed())
		}
		if len(r.committed()) != 0 || r.operations.Checkpoint(testDoc) != nil {
			t.Fatalf("committed %v, checkpoint %+v", r.committed(), r.operations.Checkpoint(testDoc))
		}
		ra2SettleWindow(manager)
		ra2Unobserved(t, r)
		r.clock.Advance(30 * time.Second)
		if got := exportedText(t, manager, testDoc); got != "seeded" {
			t.Fatalf("a later reader reads %q, want seeded", got)
		}
	})

	t.Run("the checkpoint fails", func(t *testing.T) {
		r := ra2NewRoom()
		r.endpoint.Holds(t, testDoc, "seeded", nil)
		manager := r.journalManager(t, ra2ExportWindow())
		writer := v2Member()
		membership, lineage := ra2Joined(t, manager, writer)
		peer := ra2Stock("")
		joinSynced(t, manager, testDoc, peer)
		client := syncedClient(t, manager, testDoc, "seeded")
		writer.clear()
		peer.clear()
		committed := updateAppending(client, "!")

		ra2Send(t, membership, ra2Op(lineage, opOne, committed))

		// The positive control: a journal that commits opens every route
		// asserted shut below.
		got := writer.messages(t)
		if len(got) != 2 {
			t.Fatalf("writer got %#v, want the relay then the acknowledgement", got)
		}
		if update, ok := got[0].(wire.SyncUpdate); !ok || !slices.Equal(update.Update, committed) {
			t.Fatalf("first frame %#v, want the relay", got[0])
		}
		if ack, ok := got[1].(wire.Acknowledgement); !ok || ack.ServerSequence != 1 || ack.OperationID != opOne || ack.Lineage != lineage {
			t.Fatalf("second frame %#v, want the acknowledgement at 1", got[1])
		}
		ra2OnlySyncUpdate(t, "peer", peer, committed)
		if n := len(r.committed()); n != 1 {
			t.Fatalf("committed %d, want 1", n)
		}
		r.operations.setFailCheckpoints(func(string) error { return errors.New("the journal volume is gone") })

		for attempt := 1; attempt <= 3; attempt++ {
			if checkpoint(t, manager) {
				t.Fatalf("attempt %d: the checkpoint published", attempt)
			}
			if r.operations.Checkpoint(testDoc) != nil {
				t.Fatalf("attempt %d: a checkpoint exists", attempt)
			}
			ra2SettleWindow(manager)
			if saves := r.endpoint.Saves(); len(saves) != 0 {
				t.Fatalf("attempt %d: endpoint saves = %+v", attempt, saves)
			}
			if attempt < 3 && len(peer.closed()) != 0 {
				t.Fatalf("attempt %d: peer closed %v", attempt, peer.closed())
			}
		}

		if !ra2Closed(peer, collab.CloseCommitUnavailable) {
			t.Fatalf("peer closes = %v, want [CommitUnavailable]", peer.closed())
		}
		if r.operations.Checkpoint(testDoc) != nil {
			t.Fatal("a checkpoint exists")
		}
		ra2Unobserved(t, r)
		r.clock.Advance(30 * time.Second)
		if got := exportedText(t, manager, testDoc); got != "seeded!" {
			t.Fatalf("a later reader reads %q, want seeded!", got)
		}
		if n := len(r.committed()); n != 1 {
			t.Fatalf("committed %d, want 1", n)
		}
	})
}

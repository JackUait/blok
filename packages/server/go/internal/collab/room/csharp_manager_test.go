package room

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab"
	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/internal/collab/docendpoint"
	"github.com/JackUait/blok/packages/server/go/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/internal/collab/wire"
	"github.com/JackUait/blok/packages/server/go/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// Twins of the C# CollabRoomManagerTests cases that had no Go twin. C#
// advances a manual clock to fire the room's timers; these run on wall time
// with short timers.

const mgrDoc = "doc-1"

// mgrStore is C# FakeWorkingSetStore: every call yields, so two callers
// the lane failed to serialise would overlap, and the most calls in flight
// at once is kept.
type mgrStore struct {
	mu      sync.Mutex
	sets    map[string]*workingset.Set
	journal []string

	beforeWrite  chan struct{}
	writeDelay   time.Duration
	failWrites   func(doc string) error
	failDeletes  func(doc string) error
	beforeDelete func()
	afterReset   func()

	inFlight, maxInFlight          atomic.Int32
	reads, writes, resets, deletes atomic.Int32
}

func newMgrStore() *mgrStore { return &mgrStore{sets: map[string]*workingset.Set{}} }

func (s *mgrStore) enter() func() {
	depth := s.inFlight.Add(1)
	for {
		most := s.maxInFlight.Load()
		if depth <= most || s.maxInFlight.CompareAndSwap(most, depth) {
			break
		}
	}
	return func() { s.inFlight.Add(-1) }
}

func (s *mgrStore) seed(t *testing.T, doc string, updates [][]byte, tag workingset.Tag) {
	t.Helper()
	framed, err := workingset.EncodeFrames(updates)
	if err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sets[doc] = &workingset.Set{Updates: framed, Tag: tag}
}

func (s *mgrStore) holds(doc string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sets[doc] != nil
}

func (s *mgrStore) stored(t *testing.T, doc string) workingset.Set {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	set := s.sets[doc]
	if set == nil {
		t.Fatalf("no working set for %q", doc)
	}
	return *set
}

func (s *mgrStore) frames(t *testing.T, doc string) [][]byte {
	t.Helper()
	frames, ok := workingset.DecodeFrames(s.stored(t, doc).Updates)
	if !ok {
		t.Fatal("the stored working set does not decode")
	}
	return frames
}

// frameCount is 0 for an absent or undecodable set, for polling.
func (s *mgrStore) frameCount(doc string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if set := s.sets[doc]; set != nil {
		frames, _ := workingset.DecodeFrames(set.Updates)
		return len(frames)
	}
	return 0
}

func (s *mgrStore) landed() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.journal...)
}

func (s *mgrStore) setBeforeWrite(gate chan struct{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.beforeWrite = gate
}

func (s *mgrStore) setFailWrites(f func(string) error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failWrites = f
}

func (s *mgrStore) setFailDeletes(f func(string) error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failDeletes = f
}

func (s *mgrStore) Read(_ context.Context, doc string) (*workingset.Set, error) {
	defer s.enter()()
	s.reads.Add(1)
	runtime.Gosched()
	s.mu.Lock()
	defer s.mu.Unlock()
	if set := s.sets[doc]; set != nil {
		return &workingset.Set{Updates: append([]byte(nil), set.Updates...), Tag: set.Tag}, nil
	}
	return nil, nil
}

func (s *mgrStore) Write(_ context.Context, doc string, updates []byte, tag workingset.Tag) error {
	defer s.enter()()
	s.writes.Add(1)
	s.mu.Lock()
	gate, delay := s.beforeWrite, s.writeDelay
	s.mu.Unlock()
	if gate != nil {
		<-gate
	}
	if delay > 0 {
		time.Sleep(delay)
	}
	runtime.Gosched()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failWrites != nil {
		if err := s.failWrites(doc); err != nil {
			return err
		}
	}
	s.sets[doc] = &workingset.Set{Updates: append([]byte(nil), updates...), Tag: tag}
	s.journal = append(s.journal, fmt.Sprintf("write:%d", tag.Epoch))
	return nil
}

// Reset runs afterReset once the reset is stored, then honours ctx: a PUT
// can land and the call still fail for a token that flipped meanwhile.
func (s *mgrStore) Reset(ctx context.Context, doc string, tag workingset.Tag) error {
	defer s.enter()()
	s.resets.Add(1)
	runtime.Gosched()
	s.mu.Lock()
	s.sets[doc] = &workingset.Set{Tag: tag}
	s.journal = append(s.journal, fmt.Sprintf("reset:%d", tag.Epoch))
	hook := s.afterReset
	s.mu.Unlock()
	if hook != nil {
		hook()
	}
	return ctx.Err()
}

func (s *mgrStore) Retire(_ context.Context, doc string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sets, doc)
	s.journal = append(s.journal, "retire")
	return nil
}

func (s *mgrStore) Delete(_ context.Context, doc string) error {
	defer s.enter()()
	s.deletes.Add(1)
	s.mu.Lock()
	hook := s.beforeDelete
	s.mu.Unlock()
	if hook != nil {
		hook()
	}
	runtime.Gosched()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failDeletes != nil {
		if err := s.failDeletes(doc); err != nil {
			return err
		}
	}
	delete(s.sets, doc)
	s.journal = append(s.journal, "delete")
	return nil
}

// mgrEndpoint is the harness endpoint plus C#'s LoadFailure, a save gate
// that honours cancellation, and NextSaveFailure thrown after the gate.
type mgrEndpoint struct {
	*fakeEndpoint
	mu              sync.Mutex
	loadFailure     error
	gate            chan struct{}
	nextSaveFailure error
}

func (e *mgrEndpoint) setLoadFailure(err error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.loadFailure = err
}

func (e *mgrEndpoint) setGate(gate chan struct{}) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.gate = gate
}

func (e *mgrEndpoint) setNextSaveFailure(err error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.nextSaveFailure = err
}

func (e *mgrEndpoint) Load(ctx context.Context, doc string) (*docendpoint.Loaded, error) {
	loaded, err := e.fakeEndpoint.Load(ctx, doc)
	e.mu.Lock()
	failure := e.loadFailure
	e.mu.Unlock()
	if failure != nil {
		return nil, failure
	}
	return loaded, err
}

func (e *mgrEndpoint) Save(ctx context.Context, doc string, outputData any, version *string, projection *docendpoint.Projection) (*string, error) {
	answer, err := e.fakeEndpoint.Save(ctx, doc, outputData, version, projection)
	e.mu.Lock()
	gate := e.gate
	e.mu.Unlock()
	if gate != nil {
		select {
		case <-gate:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	e.mu.Lock()
	failure := e.nextSaveFailure
	e.nextSaveFailure = nil
	e.mu.Unlock()
	if failure != nil {
		return nil, failure
	}
	return answer, err
}

// mgrConverter is the text converter plus C#'s Seeds count and EditFailure.
type mgrConverter struct {
	*textConverter
	seeds       atomic.Int32
	editFailure atomic.Pointer[convert.EditError]
}

func (c *mgrConverter) Seed(ctx context.Context, doc *yjs.Doc, outputData *jsjson.Node) error {
	c.seeds.Add(1)
	return c.textConverter.Seed(ctx, doc, outputData)
}

func (c *mgrConverter) ApplyOps(ctx context.Context, doc *yjs.Doc, ops []convert.EditOp) error {
	if failure := c.editFailure.Load(); failure != nil {
		return failure
	}
	return c.textConverter.ApplyOps(ctx, doc, ops)
}

// mgrPeer is C# FakeMember: Allowed, RecheckFailure, RecheckEntered and
// RecheckGate.
type mgrPeer struct {
	*fakeMember
	denied  atomic.Bool
	pmu     sync.Mutex
	failure error
	entered chan struct{}
	gate    chan struct{}
}

func newMgrPeer(actor string, write bool) *mgrPeer {
	return &mgrPeer{fakeMember: &fakeMember{actor: actor, source: collab.SourceClientV1, write: write}}
}

func (p *mgrPeer) deny() { p.denied.Store(true) }

func (p *mgrPeer) failRecheck(err error) {
	p.pmu.Lock()
	defer p.pmu.Unlock()
	p.failure = err
}

// holdRecheck: entered closes when a recheck starts; it waits for gate.
func (p *mgrPeer) holdRecheck() (entered, gate chan struct{}) {
	p.pmu.Lock()
	defer p.pmu.Unlock()
	p.entered, p.gate = make(chan struct{}), make(chan struct{})
	return p.entered, p.gate
}

func (p *mgrPeer) RecheckAccess(ctx context.Context) (bool, error) {
	p.pmu.Lock()
	if p.entered != nil {
		close(p.entered)
		p.entered = nil
	}
	gate := p.gate
	p.pmu.Unlock()
	if gate != nil {
		select {
		case <-gate:
		case <-ctx.Done():
			return false, ctx.Err()
		}
	}
	p.pmu.Lock()
	failure := p.failure
	p.pmu.Unlock()
	if failure != nil {
		return false, failure
	}
	return !p.denied.Load(), nil
}

type mgrBench struct {
	store     *mgrStore
	endpoint  *mgrEndpoint
	converter *mgrConverter

	mu  sync.Mutex
	log []string
	// panicOn makes the logger fail on lines holding it: C#'s throwing log
	// delegate. Only lines logged on the caller's goroutine may match, or
	// the panic kills the test binary.
	panicOn string
	panics  int
}

func newMgrBench() *mgrBench {
	return &mgrBench{
		store:     newMgrStore(),
		endpoint:  &mgrEndpoint{fakeEndpoint: newFakeEndpoint()},
		converter: &mgrConverter{textConverter: &textConverter{}},
	}
}

func (b *mgrBench) logf(message string) {
	b.mu.Lock()
	b.log = append(b.log, message)
	fail := b.panicOn != "" && strings.Contains(message, b.panicOn)
	if fail {
		b.panics++
	}
	b.mu.Unlock()
	if fail {
		panic("logger failed")
	}
}

func (b *mgrBench) failLogsWith(part string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.panicOn = part
}

func (b *mgrBench) failedLogs() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.panics
}

// mgrNoPanic fails the test, rather than the binary, when call panics.
func mgrNoPanic(t *testing.T, what string, call func()) {
	t.Helper()
	defer func() {
		if failure := recover(); failure != nil {
			t.Fatalf("%s panicked: %v", what, failure)
		}
	}()
	call()
}

func (b *mgrBench) logged(part string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, line := range b.log {
		if strings.Contains(line, part) {
			return true
		}
	}
	return false
}

func (b *mgrBench) lines() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]string(nil), b.log...)
}

func (b *mgrBench) manager(t *testing.T, o Options) *Manager {
	return b.managerWith(t, o, b.store, nil, nil)
}

func (b *mgrBench) managerWith(t *testing.T, o Options, store WorkingSetStore, operations OperationStore, activity ActivityObserver) *Manager {
	t.Helper()
	manager := NewManager(ManagerOptions{
		Store: store, Endpoint: b.endpoint, Converter: b.converter, Room: o, Log: b.logf,
		Operations: operations, Activity: activity,
	})
	t.Cleanup(func() { _ = manager.Drain(context.Background()) })
	return manager
}

func mgrFast() Options {
	return OptionsWith(func(ro *Options) {
		ro.ExportDebounce = 40 * time.Millisecond
		ro.ExportMaxDelay = 40 * time.Millisecond
		ro.EvictionLinger = 150 * time.Millisecond
		ro.RetryBackoff = 20 * time.Millisecond
		ro.RetryBackoffCap = 40 * time.Millisecond
		ro.Now = time.Now
	})
}

func mgrSlowExport() Options {
	o := mgrFast()
	o.ExportDebounce, o.ExportMaxDelay = time.Hour, time.Hour
	return o
}

func mgrTag(epoch int64, lineage string) workingset.Tag {
	return workingset.Tag{Format: workingset.CurrentFormat, Epoch: epoch, Lineage: lineage}
}

// mgrAssertMinted is C# Tags.AssertMinted: a fresh lineage at epoch.
func mgrAssertMinted(t *testing.T, epoch int64, tag workingset.Tag) string {
	t.Helper()
	if tag.Format != workingset.CurrentFormat || tag.Epoch != epoch || tag.Lineage == tagLineage || len(tag.Lineage) != 32 ||
		strings.Trim(tag.Lineage, "0123456789abcdef") != "" {
		t.Fatalf("tag %+v is not a lineage minted at epoch %d", tag, epoch)
	}
	return tag.Lineage
}

func mgrTagOf(membership collab.Membership) workingset.Tag { return membership.(*Membership).tag }

func mgrTryJoin(t *testing.T, manager *Manager, doc string, member collab.Member) collab.JoinResult {
	t.Helper()
	result, err := manager.Join(context.Background(), doc, member)
	if err != nil {
		t.Fatalf("join: %v", err)
	}
	return result
}

func mgrEnter(t *testing.T, manager *Manager, doc string, member collab.Member) collab.Membership {
	t.Helper()
	result := mgrTryJoin(t, manager, doc, member)
	if result.Status != collab.JoinJoined {
		t.Fatalf("join = %v (%v), want Joined", result.Status, result.Err)
	}
	return result.Membership
}

func mgrStep2(t *testing.T, member *fakeMember, last bool) []byte {
	t.Helper()
	var updates [][]byte
	for _, message := range member.messages(t) {
		if step2, ok := message.(wire.SyncStep2); ok {
			updates = append(updates, step2.Update)
		}
	}
	if len(updates) == 0 {
		t.Fatal("no SyncStep2")
	}
	if last {
		return updates[len(updates)-1]
	}
	return updates[0]
}

func mgrReceive(t *testing.T, membership collab.Membership, message wire.Message) {
	t.Helper()
	if err := membership.Receive(context.Background(), syncFrame(t, message)); err != nil {
		t.Fatal(err)
	}
}

// mgrSynced is C# SyncedAsync: a client synced through the member's own
// connection.
func mgrSynced(t *testing.T, membership collab.Membership, member *fakeMember) *yjs.Doc {
	t.Helper()
	client := newClient()
	mgrReceive(t, membership, wire.SyncStep1{StateVector: client.EncodeStateVector()})
	if _, err := client.ApplyUpdate(mgrStep2(t, member, true)); err != nil {
		t.Fatal(err)
	}
	return client
}

func mgrSend(t *testing.T, membership collab.Membership, client *yjs.Doc, text string) {
	t.Helper()
	mgrReceive(t, membership, wire.SyncUpdate{Update: updateAppending(client, text)})
}

func mgrReplay(t *testing.T, frames [][]byte) string {
	t.Helper()
	replica := newClient()
	for _, frame := range frames {
		if _, err := replica.ApplyUpdate(frame); err != nil {
			t.Fatal(err)
		}
	}
	return docText(replica)
}

func mgrWait(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

func mgrEvicted(t *testing.T, manager *Manager) {
	t.Helper()
	mgrWait(t, "the room to be evicted", func() bool { return manager.LiveRoomCount() == 0 })
}

// mgrLaneWaiters counts calls queued on every live room's lane.
func mgrLaneWaiters(manager *Manager) int {
	waiting := 0
	for _, r := range manager.liveRooms() {
		r.lane.mu.Lock()
		waiting += len(r.lane.waiters)
		r.lane.mu.Unlock()
	}
	return waiting
}

const mgrOperationID = "0123456789abcdef0123456789abcdef"

// mgrEdit is C# EditAsync with Insert(text); safe off the test goroutine.
func mgrEdit(manager *Manager, text string) (EditResult, error) {
	block, err := jsjson.ParseNode([]byte(`{"type":"paragraph","data":{"text":"`+text+`"}}`), jsjson.Options{MaxDepth: 64})
	if err != nil {
		return EditResult{}, err
	}
	digest := make([]byte, 32)
	copy(digest, mgrOperationID)
	return manager.Edit(context.Background(), mgrDoc, []convert.EditOp{convert.Insert{ID: "block-" + text, Block: block}},
		mgrOperationID, digest, "", nil)
}

func mgrPurge(manager *Manager, allow bool) (journal.PurgeOutcome, error) {
	return manager.Purge(context.Background(), mgrDoc, func(context.Context) (bool, error) { return allow, nil })
}

// mgrWithin runs call off the test goroutine and fails when it does not
// answer in time.
func mgrWithin(t *testing.T, what string, call func() error) {
	t.Helper()
	done := make(chan error, 1)
	go func() { done <- call() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("%s: %v", what, err)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("%s did not answer", what)
	}
}

func mgrClosedOnce(t *testing.T, member *fakeMember, want collab.CloseReason) {
	t.Helper()
	if got := member.closed(); len(got) != 1 || got[0] != want {
		t.Fatalf("closes = %v, want [%v]", got, want)
	}
}

func TestTheFirstJoinSeedsFromTheEndpointExactlyOnceEvenUnderConcurrentJoins(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "seeded", nil)
	gate := make(chan struct{})
	b.endpoint.setLoadGate(gate)
	manager := b.manager(t, mgrFast())

	results := make(chan collab.JoinResult, 8)
	for range 8 {
		go func() {
			result, err := manager.Join(context.Background(), mgrDoc, newMgrPeer("", true))
			if err != nil {
				t.Error(err)
			}
			results <- result
		}()
	}
	mgrWait(t, "the seed load to start", func() bool { return b.endpoint.Loads() == 1 })
	close(gate)
	for range 8 {
		if result := <-results; result.Status != collab.JoinJoined {
			t.Fatalf("join = %v, want Joined", result.Status)
		}
	}

	if b.endpoint.Loads() != 1 || b.converter.seeds.Load() != 1 || b.store.writes.Load() != 1 {
		t.Fatalf("loads %d, seeds %d, writes %d; want 1 each", b.endpoint.Loads(), b.converter.seeds.Load(), b.store.writes.Load())
	}
	frames := b.store.frames(t, mgrDoc)
	if len(frames) != 1 {
		t.Fatalf("%d frames, want 1", len(frames))
	}
	mgrAssertMinted(t, 0, b.store.stored(t, mgrDoc).Tag)
	if got := mgrReplay(t, frames); got != "seeded" {
		t.Fatalf("the seed frame reads %q", got)
	}
}

func TestAStoredWorkingSetHydratesTheRoomWithoutTouchingTheEndpoint(t *testing.T) {
	b := newMgrBench()
	source := newClient()
	b.store.seed(t, mgrDoc, [][]byte{updateAppending(source, "from "), updateAppending(source, "disk")}, tagAt(3))
	manager := b.manager(t, mgrFast())
	peer := newMgrPeer("", true)

	membership := mgrEnter(t, manager, mgrDoc, peer)
	mgrReceive(t, membership, wire.SyncStep1{StateVector: []byte{0}})

	if b.endpoint.Loads() != 0 || b.converter.seeds.Load() != 0 {
		t.Fatalf("loads %d, seeds %d; want none", b.endpoint.Loads(), b.converter.seeds.Load())
	}
	if got := mgrTagOf(membership); got != tagAt(3) {
		t.Fatalf("tag %+v, want %+v", got, tagAt(3))
	}
	if got := mgrReplay(t, [][]byte{mgrStep2(t, peer.fakeMember, false)}); got != "from disk" {
		t.Fatalf("the room reads %q", got)
	}
}

func TestAnEmptyStoredLogAfterAResetReseedsUnderTheStoredEpoch(t *testing.T) {
	b := newMgrBench()
	b.store.seed(t, mgrDoc, nil, tagAt(5))
	b.endpoint.Holds(t, mgrDoc, "fresh", nil)
	manager := b.manager(t, mgrFast())

	membership := mgrEnter(t, manager, mgrDoc, newMgrPeer("", true))

	if b.endpoint.Loads() != 1 {
		t.Fatalf("%d loads, want 1", b.endpoint.Loads())
	}
	lineage := mgrAssertMinted(t, 5, mgrTagOf(membership))
	if got := b.store.stored(t, mgrDoc).Tag; got != mgrTag(5, lineage) {
		t.Fatalf("stored tag %+v", got)
	}
	if got := len(b.store.frames(t, mgrDoc)); got != 1 {
		t.Fatalf("%d frames, want 1", got)
	}
}

func TestANullDocumentSeedsAnEmptyRoomWithoutFailingAndWithoutAConverterCall(t *testing.T) {
	b := newMgrBench()
	b.endpoint.HoldsNothing(mgrDoc, strPtr("v0"))
	manager := b.manager(t, mgrFast())
	peer := newMgrPeer("", true)

	membership := mgrEnter(t, manager, mgrDoc, peer)
	mgrReceive(t, membership, wire.SyncStep1{StateVector: []byte{0}})

	if b.converter.seeds.Load() != 0 {
		t.Fatalf("%d converter seeds, want 0", b.converter.seeds.Load())
	}
	if got := len(b.store.frames(t, mgrDoc)); got != 0 {
		t.Fatalf("%d frames, want 0", got)
	}
	mgrAssertMinted(t, 0, b.store.stored(t, mgrDoc).Tag)
	if got := mgrReplay(t, [][]byte{mgrStep2(t, peer.fakeMember, false)}); got != "" {
		t.Fatalf("the room reads %q", got)
	}
}

func TestAReSeedOfANullDocumentKeepsTheLineageItPersisted(t *testing.T) {
	b := newMgrBench()
	b.endpoint.HoldsNothing(mgrDoc, nil)
	manager := b.manager(t, mgrFast())
	first := mgrEnter(t, manager, mgrDoc, newMgrPeer("", true))
	lineage := mgrAssertMinted(t, 0, mgrTagOf(first))
	first.Leave()
	mgrEvicted(t, manager)

	second := mgrEnter(t, manager, mgrDoc, newMgrPeer("", true))

	if b.endpoint.Loads() != 2 {
		t.Fatalf("%d loads, want 2", b.endpoint.Loads())
	}
	if got := mgrTagOf(second); got != mgrTag(0, lineage) {
		t.Fatalf("second tag %+v, want lineage %s", got, lineage)
	}
	if got := b.store.stored(t, mgrDoc).Tag; got != mgrTag(0, lineage) {
		t.Fatalf("stored tag %+v, want lineage %s", got, lineage)
	}
}

func TestEveryDocAccessGoesThroughOneLane(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "", nil)
	b.store.writeDelay = time.Millisecond
	o := mgrFast()
	// C# sets both to TimeSpan.Zero; a zero now stays zero here too.
	o.ExportDebounce, o.ExportMaxDelay = 0, 0
	manager := b.manager(t, o)
	var memberships []collab.Membership
	for range 8 {
		memberships = append(memberships, mgrEnter(t, manager, mgrDoc, newMgrPeer("", true)))
	}

	var storm sync.WaitGroup
	for range 25 {
		for _, membership := range memberships {
			update := updateAppending(newClient(), "x")
			storm.Add(2)
			go func() {
				defer storm.Done()
				if err := membership.Receive(context.Background(), syncFrame(t, wire.SyncUpdate{Update: update})); err != nil {
					t.Error(err)
				}
			}()
			go func() {
				defer storm.Done()
				if err := membership.Receive(context.Background(), syncFrame(t, wire.SyncStep1{StateVector: []byte{0}})); err != nil {
					t.Error(err)
				}
			}()
		}
		storm.Add(1)
		go func() {
			defer storm.Done()
			if result, err := manager.Join(context.Background(), mgrDoc, newMgrPeer("", false)); err != nil || result.Status != collab.JoinJoined {
				t.Errorf("reader join = %v, %v", result.Status, err)
			}
		}()
	}
	storm.Wait()
	manager.Settle()

	if most := b.store.maxInFlight.Load(); most != 1 {
		t.Fatalf("%d store calls overlapped, want 1", most)
	}
	if got := exportedText(t, manager, mgrDoc); got != strings.Repeat("x", 200) {
		t.Fatalf("the room reads %q (%d chars), want 200 x", got, len(got))
	}
}

func TestTheLastLeaveStartsALingerAndAJoinDuringItKeepsTheRoom(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "hello", nil)
	o := mgrFast()
	o.EvictionLinger = 400 * time.Millisecond
	manager := b.manager(t, o)
	first := mgrEnter(t, manager, mgrDoc, newMgrPeer("", true))

	first.Leave()
	time.Sleep(100 * time.Millisecond)
	manager.Settle()
	if manager.LiveRoomCount() != 1 {
		t.Fatal("the room unloaded inside its linger")
	}

	second := mgrTryJoin(t, manager, mgrDoc, newMgrPeer("", true))
	time.Sleep(800 * time.Millisecond)
	manager.Settle()

	if second.Status != collab.JoinJoined || manager.LiveRoomCount() != 1 || b.endpoint.Loads() != 1 {
		t.Fatalf("join %v, rooms %d, loads %d; want Joined, 1, 1", second.Status, manager.LiveRoomCount(), b.endpoint.Loads())
	}
}

func TestACancelledFirstJoinLeavesARoomThatStillEvicts(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "hello", nil)
	gate := make(chan struct{})
	b.endpoint.setLoadGate(gate)
	manager := b.manager(t, mgrFast())
	ctx, cancel := context.WithCancel(context.Background())
	joined := make(chan error, 1)
	go func() {
		_, err := manager.Join(ctx, mgrDoc, newMgrPeer("", true))
		joined <- err
	}()

	mgrWait(t, "the seed load to start", func() bool { return b.endpoint.Loads() == 1 })
	cancel()
	close(gate)
	if err := <-joined; !errors.Is(err, context.Canceled) {
		t.Fatalf("join err = %v, want context.Canceled", err)
	}
	manager.Settle()

	if b.converter.seeds.Load() != 1 || manager.LiveRoomCount() != 1 {
		t.Fatalf("seeds %d, rooms %d; want 1, 1", b.converter.seeds.Load(), manager.LiveRoomCount())
	}
	mgrEvicted(t, manager)
}

func TestACancelledJoinDoesNotArmTheLingerWhileOthersAreStillInTheRoom(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "hello", nil)
	manager := b.manager(t, mgrFast())
	mgrEnter(t, manager, mgrDoc, newMgrPeer("", true))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := manager.Join(ctx, mgrDoc, newMgrPeer("", true)); !errors.Is(err, context.Canceled) {
		t.Fatalf("join err = %v, want context.Canceled", err)
	}
	time.Sleep(500 * time.Millisecond)
	manager.Settle()

	if manager.LiveRoomCount() != 1 {
		t.Fatal("the cancelled join armed the linger under a member")
	}
}

func TestTheLingerElapsingCompactsExportsAndDropsTheRoom(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "a", strPtr("v1"))
	manager := b.manager(t, mgrSlowExport())
	peer := newMgrPeer("", true)
	membership := mgrEnter(t, manager, mgrDoc, peer)
	client := mgrSynced(t, membership, peer.fakeMember)

	for _, piece := range []string{"b", "c", "d"} {
		mgrSend(t, membership, client, piece)
	}
	mgrWait(t, "the working set to catch up", func() bool { return b.store.frameCount(mgrDoc) == 4 })
	membership.Leave()
	mgrEvicted(t, manager)

	frames := b.store.frames(t, mgrDoc)
	if len(frames) != 1 || mgrReplay(t, frames) != "abcd" {
		t.Fatalf("%d frames reading %q, want one reading abcd", len(frames), mgrReplay(t, frames))
	}
	saves := b.endpoint.Saves()
	if len(saves) != 1 || saves[0].data != textJSON(t, "abcd") || versionOf(saves[0]) != "v1" {
		t.Fatalf("saves = %+v, want one abcd at v1", saves)
	}

	mgrEnter(t, manager, mgrDoc, newMgrPeer("", true))
	if b.endpoint.Loads() != 1 {
		t.Fatalf("%d loads, want 1: the rejoin hydrates from the blob", b.endpoint.Loads())
	}
	if got := exportedText(t, manager, mgrDoc); got != "abcd" {
		t.Fatalf("the rejoined room reads %q", got)
	}
}

func TestEvictionWaitsForAnInFlightExportBeforeFlushing(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "a", nil)
	gate := make(chan struct{})
	b.endpoint.setGate(gate)
	manager := b.manager(t, mgrFast())
	peer := newMgrPeer("", true)
	membership := mgrEnter(t, manager, mgrDoc, peer)
	client := mgrSynced(t, membership, peer.fakeMember)
	mgrSend(t, membership, client, "b")
	mgrWait(t, "the working set to catch up", func() bool { return b.store.frameCount(mgrDoc) == 2 })
	membership.Leave()

	mgrWait(t, "the export to start", func() bool { return len(b.endpoint.Saves()) == 1 })
	time.Sleep(400 * time.Millisecond)

	if manager.LiveRoomCount() != 1 || b.store.frameCount(mgrDoc) != 2 {
		t.Fatalf("rooms %d, frames %d; want the eviction parked: 1, 2", manager.LiveRoomCount(), b.store.frameCount(mgrDoc))
	}

	b.endpoint.setGate(nil)
	close(gate)
	mgrEvicted(t, manager)

	if got := len(b.endpoint.Saves()); got != 1 {
		t.Fatalf("%d saves, want 1", got)
	}
	frames := b.store.frames(t, mgrDoc)
	if len(frames) != 1 || mgrReplay(t, frames) != "ab" {
		t.Fatalf("%d frames reading %q, want one reading ab", len(frames), mgrReplay(t, frames))
	}
}

func TestMembershipCallsStaySafeAfterLeavingAndAfterTheRoomClosed(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "a", nil)
	o := mgrFast()
	o.EvictionLinger = time.Hour
	manager := b.manager(t, o)
	peer := newMgrPeer("", true)
	membership := mgrEnter(t, manager, mgrDoc, peer)
	client := mgrSynced(t, membership, peer.fakeMember)
	framesBefore := b.store.frameCount(mgrDoc)

	membership.Leave()
	membership.Leave()
	mgrSend(t, membership, client, "late")
	manager.Settle()

	if b.store.frameCount(mgrDoc) != framesBefore || manager.LiveRoomCount() != 1 {
		t.Fatalf("frames %d (was %d), rooms %d", b.store.frameCount(mgrDoc), framesBefore, manager.LiveRoomCount())
	}

	second := mgrEnter(t, manager, mgrDoc, newMgrPeer("", true))
	if err := manager.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}
	mgrReceive(t, second, wire.SyncStep1{StateVector: []byte{0}})
	second.Leave()
	membership.Leave()

	if manager.LiveRoomCount() != 0 || b.store.frameCount(mgrDoc) != framesBefore {
		t.Fatalf("rooms %d, frames %d (was %d)", manager.LiveRoomCount(), b.store.frameCount(mgrDoc), framesBefore)
	}
}

func TestAHeadlessEditIsInTheBlobBeforeItIsAnswered(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "a", nil)
	manager := b.manager(t, mgrFast())
	mgrEnter(t, manager, mgrDoc, newMgrPeer("", true)).Leave()
	stuck := make(chan struct{})
	b.store.setBeforeWrite(stuck)

	type answer struct {
		result EditResult
		err    error
	}
	pending := make(chan answer, 1)
	go func() {
		result, err := mgrEdit(manager, "b")
		pending <- answer{result, err}
	}()
	mgrWait(t, "the edit's blob write to start", func() bool { return b.store.writes.Load() == 2 })
	time.Sleep(50 * time.Millisecond)

	select {
	case <-pending:
		t.Fatal("the edit was answered before its blob write landed")
	default:
	}
	b.store.setBeforeWrite(nil)
	close(stuck)
	if got := <-pending; got.err != nil || got.result.Status != EditApplied {
		t.Fatalf("edit = %v, %v; want Applied", got.result.Status, got.err)
	}
	if got := mgrReplay(t, b.store.frames(t, mgrDoc)); got != "ab" {
		t.Fatalf("the blob reads %q", got)
	}
}

func TestAHeadlessEditPersistsExportsAfterTheDebounceAndEvictsAfterTheLinger(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "a", strPtr("v1"))
	o := mgrFast()
	o.EvictionLinger = 400 * time.Millisecond
	manager := b.manager(t, o)

	result, err := mgrEdit(manager, "b")

	if err != nil || result.Status != EditApplied {
		t.Fatalf("edit = %v, %v (%v); want Applied", result.Status, err, result.Err)
	}
	if b.endpoint.Loads() != 1 || mgrReplay(t, b.store.frames(t, mgrDoc)) != "ab" || manager.LiveRoomCount() != 1 {
		t.Fatalf("loads %d, rooms %d", b.endpoint.Loads(), manager.LiveRoomCount())
	}

	mgrWait(t, "the debounced export", func() bool { return len(b.endpoint.Saves()) == 1 })
	manager.Settle()

	saves := b.endpoint.Saves()
	if len(saves) != 1 || saves[0].data != textJSON(t, "ab") || versionOf(saves[0]) != "v1" {
		t.Fatalf("saves = %+v, want one ab at v1", saves)
	}
	if manager.LiveRoomCount() != 1 {
		t.Fatal("the room unloaded before its linger")
	}

	mgrEvicted(t, manager)
	if got := len(b.endpoint.Saves()); got != 1 {
		t.Fatalf("%d saves, want 1", got)
	}
	if got := mgrReplay(t, b.store.frames(t, mgrDoc)); got != "ab" {
		t.Fatalf("the blob reads %q", got)
	}
}

func TestARefusedEditWritesNothingAndTheRoomStillEvicts(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "a", nil)
	b.converter.editFailure.Store(&convert.EditError{Message: "collab: op 0: refused."})
	manager := b.manager(t, mgrFast())

	result, err := mgrEdit(manager, "b")

	if err != nil || result.Status != EditInvalid {
		t.Fatalf("edit = %v, %v; want Invalid", result.Status, err)
	}
	var refusal *convert.EditError
	if !errors.As(result.Err, &refusal) {
		t.Fatalf("edit error %v, want an EditError", result.Err)
	}
	if b.store.writes.Load() != 1 || mgrReplay(t, b.store.frames(t, mgrDoc)) != "a" || manager.LiveRoomCount() != 1 {
		t.Fatalf("writes %d, rooms %d", b.store.writes.Load(), manager.LiveRoomCount())
	}

	mgrEvicted(t, manager)
	if got := len(b.endpoint.Saves()); got != 0 {
		t.Fatalf("%d saves, want 0", got)
	}
}

func TestRecheckExpelsAMemberWhenPolicyAndLoggerThrow(t *testing.T) {
	b := newMgrBench()
	b.store.seed(t, mgrDoc, [][]byte{fullState(t, docWith("seeded"))}, tagAt(4))
	manager := b.manager(t, mgrFast())
	revoked, allowed := newMgrPeer("", true), newMgrPeer("", true)
	membership := mgrEnter(t, manager, mgrDoc, revoked)
	mgrEnter(t, manager, mgrDoc, allowed)
	revoked.failRecheck(errors.New("policy failed"))
	if manager.LiveRoomCount() != 1 {
		t.Fatalf("%d rooms, want 1", manager.LiveRoomCount())
	}
	b.failLogsWith("could not recheck member access")
	// Reset before cleanup: the drain logs on its own goroutines.
	defer b.failLogsWith("")

	var expelled int
	var err error
	mgrNoPanic(t, "the recheck", func() { expelled, err = manager.RecheckAccess(context.Background(), mgrDoc) })

	if err != nil || expelled != 1 {
		t.Fatalf("recheck = %d, %v; want 1", expelled, err)
	}
	mgrClosedOnce(t, revoked.fakeMember, collab.CloseForbidden)
	if got := allowed.closed(); len(got) != 0 {
		t.Fatalf("the allowed member was closed: %v", got)
	}
	_ = membership.Receive(context.Background(), syncFrame(t, wire.SyncUpdate{Update: updateAppending(newClient(), " stolen")}))
	if got := exportedText(t, manager, mgrDoc); got != "seeded" {
		t.Fatalf("the room reads %q", got)
	}
}

func TestFirstJoinIsRefusedWhenPolicyAndLoggerThrow(t *testing.T) {
	b := newMgrBench()
	manager := b.manager(t, mgrFast())
	peer := newMgrPeer("", true)
	peer.failRecheck(errors.New("policy failed"))
	b.failLogsWith("could not recheck member access")
	// Reset before cleanup: the drain logs on its own goroutines.
	defer b.failLogsWith("")

	var denied collab.JoinResult
	mgrNoPanic(t, "the join", func() { denied = mgrTryJoin(t, manager, mgrDoc, peer) })

	if denied.Status != collab.JoinForbidden || b.endpoint.Loads() != 0 || manager.LiveRoomCount() != 0 {
		t.Fatalf("join %v, loads %d, rooms %d; want Forbidden, 0, 0", denied.Status, b.endpoint.Loads(), manager.LiveRoomCount())
	}
}

func TestCancellingAnAccessRecheckDoesNotExpelAnAllowedMember(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "seeded", nil)
	manager := b.manager(t, mgrFast())
	peer := newMgrPeer("", true)
	mgrEnter(t, manager, mgrDoc, peer)
	entered, gate := peer.holdRecheck()
	defer close(gate)
	ctx, cancel := context.WithCancel(context.Background())
	recheck := make(chan error, 1)
	go func() {
		_, err := manager.RecheckAccess(ctx, mgrDoc)
		recheck <- err
	}()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("the recheck never started")
	}

	cancel()

	if err := <-recheck; !errors.Is(err, context.Canceled) {
		t.Fatalf("recheck err = %v, want context.Canceled", err)
	}
	if got := peer.closed(); len(got) != 0 {
		t.Fatalf("the allowed member was closed: %v", got)
	}
	if manager.LiveRoomCount() != 1 {
		t.Fatalf("%d rooms, want 1", manager.LiveRoomCount())
	}
}

// mgrSlowObserver is C# RecordingActivityObserver with Gate: a slow host.
type mgrSlowObserver struct {
	records atomic.Int32
	gate    chan struct{}
}

func (o *mgrSlowObserver) Record(context.Context, string, string, time.Time, ActivityKind) error {
	o.records.Add(1)
	<-o.gate
	return nil
}

func TestAThrowingActivityDropLoggerDoesNotStrandOtherRevokedMembers(t *testing.T) {
	b := newMgrBench()
	b.store.seed(t, mgrDoc, [][]byte{fullState(t, docWith("seeded"))}, tagAt(4))
	observer := &mgrSlowObserver{gate: make(chan struct{})}
	manager := b.managerWith(t, mgrFast(), b.store, nil, observer)
	opened := false
	open := func() {
		if !opened {
			opened = true
			close(observer.gate)
		}
	}
	defer open()
	mgrEnter(t, manager, mgrDoc, newMgrPeer("holder", true))
	mgrWait(t, "the first activity record", func() bool { return observer.records.Load() >= 1 })

	for index := range 127 {
		mgrEnter(t, manager, mgrDoc, newMgrPeer(fmt.Sprintf("visitor-%d", index), true)).Leave()
	}
	first, second := newMgrPeer("revoked-1", true), newMgrPeer("revoked-2", true)
	mgrEnter(t, manager, mgrDoc, first)
	mgrEnter(t, manager, mgrDoc, second)
	first.deny()
	second.deny()
	b.failLogsWith("dropped an activity record")
	// Reset before cleanup: the drain logs on its own goroutines.
	defer b.failLogsWith("")

	var expelled int
	var err error
	mgrNoPanic(t, "the recheck", func() { expelled, err = manager.RecheckAccess(context.Background(), mgrDoc) })
	open()

	if err != nil || expelled != 2 {
		t.Fatalf("recheck = %d, %v; want 2", expelled, err)
	}
	mgrClosedOnce(t, first.fakeMember, collab.CloseForbidden)
	mgrClosedOnce(t, second.fakeMember, collab.CloseForbidden)
	if b.failedLogs() == 0 {
		t.Fatal("no activity record was dropped, so the failing logger never ran")
	}
}

func TestRecheckKeepsQueuedWritesOutOfTheJournalAndRejectsAQueuedJoin(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "seeded", nil)
	operations := newFakeJournal()
	manager := b.managerWith(t, mgrFast(), b.store, operations, nil)
	revoked, allowed := newMgrPeer("", true), newMgrPeer("", true)
	membership := mgrEnter(t, manager, mgrDoc, revoked)
	mgrEnter(t, manager, mgrDoc, allowed)
	revoked.deny()
	entered, gate := revoked.holdRecheck()

	type recheckAnswer struct {
		expelled int
		err      error
	}
	recheck := make(chan recheckAnswer, 1)
	go func() {
		expelled, err := manager.RecheckAccess(context.Background(), mgrDoc)
		recheck <- recheckAnswer{expelled, err}
	}()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("the recheck never started")
	}
	update := updateAppending(newClient(), " stolen")
	written := make(chan struct{})
	go func() {
		defer close(written)
		_ = membership.Receive(context.Background(), syncFrame(t, wire.SyncUpdate{Update: update}))
	}()
	denied := make(chan collab.JoinStatus, 1)
	go func() {
		peer := newMgrPeer("", true)
		peer.deny()
		result, err := manager.Join(context.Background(), mgrDoc, peer)
		if err != nil {
			t.Error(err)
		}
		denied <- result.Status
	}()
	mgrWait(t, "the write and the join to queue", func() bool { return mgrLaneWaiters(manager) >= 2 })
	close(gate)

	if got := <-recheck; got.err != nil || got.expelled != 1 {
		t.Fatalf("recheck = %d, %v; want 1", got.expelled, got.err)
	}
	<-written
	if got := <-denied; got != collab.JoinForbidden {
		t.Fatalf("the queued join = %v, want Forbidden", got)
	}
	if got := operations.Committed(mgrDoc); len(got) != 0 {
		t.Fatalf("the journal committed %d records", len(got))
	}
	for _, message := range allowed.messages(t) {
		if _, relayed := message.(wire.SyncUpdate); relayed {
			t.Fatal("the expelled member's queued write was relayed")
		}
	}
	if got := exportedText(t, manager, mgrDoc); got != "seeded" {
		t.Fatalf("the room reads %q", got)
	}
}

func TestRecheckClosesAJoinThatPassedAccessBeforeTheAclChanged(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "seeded", nil)
	gate := make(chan struct{})
	b.endpoint.setLoadGate(gate)
	manager := b.manager(t, mgrFast())
	revoked := newMgrPeer("", true)
	joined := make(chan collab.JoinStatus, 1)
	go func() {
		result, err := manager.Join(context.Background(), mgrDoc, revoked)
		if err != nil {
			t.Error(err)
		}
		joined <- result.Status
	}()
	mgrWait(t, "the seed load to start", func() bool { return b.endpoint.Loads() == 1 })
	revoked.deny()
	type recheckAnswer struct {
		expelled int
		err      error
	}
	recheck := make(chan recheckAnswer, 1)
	go func() {
		expelled, err := manager.RecheckAccess(context.Background(), mgrDoc)
		recheck <- recheckAnswer{expelled, err}
	}()
	mgrWait(t, "the recheck to queue", func() bool { return mgrLaneWaiters(manager) >= 1 })
	close(gate)

	if got := <-joined; got != collab.JoinJoined {
		t.Fatalf("join = %v, want Joined", got)
	}
	if got := <-recheck; got.err != nil || got.expelled != 1 {
		t.Fatalf("recheck = %d, %v; want 1", got.expelled, got.err)
	}
	mgrClosedOnce(t, revoked.fakeMember, collab.CloseForbidden)
}

func TestResetRaisesTheEpochClosesEveryMemberAndReseedsOnTheNextJoin(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "old", nil)
	manager := b.manager(t, mgrFast())
	first, second := newMgrPeer("", true), newMgrPeer("", false)
	membership := mgrEnter(t, manager, mgrDoc, first)
	mgrEnter(t, manager, mgrDoc, second)
	seeded := mgrAssertMinted(t, 0, b.store.stored(t, mgrDoc).Tag)

	result, err := manager.Reset(context.Background(), mgrDoc)

	if err != nil || result.Status != ResetDone || result.Tag == nil {
		t.Fatalf("reset = %+v, %v", result, err)
	}
	reset := mgrAssertMinted(t, 1, *result.Tag)
	if reset == seeded {
		t.Fatal("the reset kept the seeded lineage")
	}
	if b.store.resets.Load() != 1 || b.store.stored(t, mgrDoc).Tag != mgrTag(1, reset) || len(b.store.frames(t, mgrDoc)) != 0 {
		t.Fatalf("resets %d, stored %+v", b.store.resets.Load(), b.store.stored(t, mgrDoc))
	}
	mgrClosedOnce(t, first.fakeMember, collab.CloseReset)
	mgrClosedOnce(t, second.fakeMember, collab.CloseReset)
	if manager.LiveRoomCount() != 0 {
		t.Fatalf("%d rooms, want 0", manager.LiveRoomCount())
	}

	_ = membership.Receive(context.Background(), syncFrame(t, wire.SyncUpdate{Update: updateAppending(newClient(), "late")}))
	if got := len(b.store.frames(t, mgrDoc)); got != 0 {
		t.Fatalf("a late write landed: %d frames", got)
	}

	b.endpoint.Holds(t, mgrDoc, "new", nil)
	rejoined := mgrEnter(t, manager, mgrDoc, newMgrPeer("", true))
	if b.endpoint.Loads() != 2 {
		t.Fatalf("%d loads, want 2", b.endpoint.Loads())
	}
	reseeded := mgrAssertMinted(t, 1, mgrTagOf(rejoined))
	if reseeded == reset {
		t.Fatal("the reseed kept the reset lineage")
	}
	if got := b.store.stored(t, mgrDoc).Tag; got != mgrTag(1, reseeded) {
		t.Fatalf("stored tag %+v", got)
	}
	if got := exportedText(t, manager, mgrDoc); got != "new" {
		t.Fatalf("the room reads %q", got)
	}
}

func TestResetWithoutALiveRoomStillRaisesTheStoredEpoch(t *testing.T) {
	rows := []struct {
		stored                bool
		storedEpoch, expected int64
	}{{true, 4, 5}, {false, 0, 1}}
	for _, row := range rows {
		t.Run(fmt.Sprintf("%v,%d,%d", row.stored, row.storedEpoch, row.expected), func(t *testing.T) {
			b := newMgrBench()
			if row.stored {
				b.store.seed(t, mgrDoc, [][]byte{fullState(t, docWith("x"))}, tagAt(row.storedEpoch))
			}
			manager := b.manager(t, mgrFast())

			result, err := manager.Reset(context.Background(), mgrDoc)

			if err != nil || result.Tag == nil {
				t.Fatalf("reset = %+v, %v", result, err)
			}
			mgrAssertMinted(t, row.expected, *result.Tag)
			if b.store.resets.Load() != 1 || b.endpoint.Loads() != 0 || manager.LiveRoomCount() != 0 {
				t.Fatalf("resets %d, loads %d, rooms %d; want 1, 0, 0", b.store.resets.Load(), b.endpoint.Loads(), manager.LiveRoomCount())
			}
		})
	}
}

func TestResetWaitsForAnInFlightBlobWriteInsteadOfRacingIt(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "a", nil)
	manager := b.manager(t, mgrFast())
	peer := newMgrPeer("", true)
	membership := mgrEnter(t, manager, mgrDoc, peer)
	client := mgrSynced(t, membership, peer.fakeMember)
	stuck := make(chan struct{})
	b.store.setBeforeWrite(stuck)
	mgrSend(t, membership, client, "b")
	mgrWait(t, "the blob write to start", func() bool { return b.store.writes.Load() == 2 })

	type answer struct {
		result ResetResult
		err    error
	}
	reset := make(chan answer, 1)
	go func() {
		result, err := manager.Reset(context.Background(), mgrDoc)
		reset <- answer{result, err}
	}()
	// The reset must reach the room before the write lands.
	time.Sleep(20 * time.Millisecond)
	b.store.setBeforeWrite(nil)
	close(stuck)
	got := <-reset

	if got.err != nil || got.result.Tag == nil {
		t.Fatalf("reset = %+v, %v", got.result, got.err)
	}
	minted := *got.result.Tag
	mgrAssertMinted(t, 1, minted)
	landed := b.store.landed()
	if len(landed) < 2 || landed[len(landed)-2] != "write:0" || landed[len(landed)-1] != "reset:1" {
		t.Fatalf("store calls landed as %q, want ... write:0, reset:1", landed)
	}
	if b.store.stored(t, mgrDoc).Tag != minted || len(b.store.frames(t, mgrDoc)) != 0 {
		t.Fatalf("stored %+v, want the empty reset under %+v", b.store.stored(t, mgrDoc), minted)
	}
}

func TestAStoredWorkingSetOfAnotherFormatFailsTheJoinClosed(t *testing.T) {
	b := newMgrBench()
	b.store.seed(t, mgrDoc, [][]byte{fullState(t, docWith("x"))},
		workingset.Tag{Format: workingset.CurrentFormat + 1, Epoch: 0, Lineage: tagLineage})
	manager := b.manager(t, mgrFast())

	result := mgrTryJoin(t, manager, mgrDoc, newMgrPeer("", true))

	if result.Status != collab.JoinSeedFailed || b.endpoint.Loads() != 0 {
		t.Fatalf("join %v, loads %d; want SeedFailed, 0", result.Status, b.endpoint.Loads())
	}
	if !b.logged("format") {
		t.Fatalf("no log names the format: %q", b.lines())
	}
}

func TestAStoreBlipDuringTheOnLoadCompactionStillJoinsAndRetriesTheWrite(t *testing.T) {
	b := newMgrBench()
	source := newClient()
	var updates [][]byte
	for _, piece := range []string{"a", "b", "c", "d", "e"} {
		updates = append(updates, updateAppending(source, piece))
	}
	b.store.seed(t, mgrDoc, updates, tagAt(2))
	b.store.setFailWrites(func(string) error { return errors.New("disk full") })
	o := mgrFast()
	o.CompactionFrameThreshold = 4
	manager := b.manager(t, o)

	mgrEnter(t, manager, mgrDoc, newMgrPeer("", true))

	if got := len(b.store.frames(t, mgrDoc)); got != 5 {
		t.Fatalf("%d frames, want the 5 stored", got)
	}
	if !b.logged("compacted") {
		t.Fatalf("no log names the compaction: %q", b.lines())
	}
	if got := exportedText(t, manager, mgrDoc); got != "abcde" {
		t.Fatalf("the room reads %q", got)
	}

	b.store.setFailWrites(nil)
	mgrWait(t, "the retried write of the compacted log", func() bool { return b.store.frameCount(mgrDoc) == 1 })
	if got := mgrReplay(t, b.store.frames(t, mgrDoc)); got != "abcde" {
		t.Fatalf("the compacted blob reads %q", got)
	}
}

func TestARequestAbortAfterTheStoreResetLandedStillClosesTheRoom(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "old", nil)
	manager := b.manager(t, mgrFast())
	peer := newMgrPeer("", true)
	mgrEnter(t, manager, mgrDoc, peer)
	request, abort := context.WithCancel(context.Background())
	defer abort()
	b.store.mu.Lock()
	b.store.afterReset = abort
	b.store.mu.Unlock()

	// Either answer is fine for the caller; the room must not stay open.
	_, _ = manager.Reset(request, mgrDoc)

	if b.store.resets.Load() != 1 || b.store.stored(t, mgrDoc).Tag.Epoch != 1 {
		t.Fatalf("resets %d, stored %+v; want one reset at epoch 1", b.store.resets.Load(), b.store.stored(t, mgrDoc).Tag)
	}
	mgrClosedOnce(t, peer.fakeMember, collab.CloseReset)
	if manager.LiveRoomCount() != 0 {
		t.Fatalf("%d rooms, want 0", manager.LiveRoomCount())
	}
}

func TestResetAbandonsAnInFlightExportInsteadOfLettingItLandAfterwards(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "a", nil)
	gate := make(chan struct{})
	b.endpoint.setGate(gate)
	manager := b.manager(t, mgrFast())
	peer := newMgrPeer("", true)
	membership := mgrEnter(t, manager, mgrDoc, peer)
	client := mgrSynced(t, membership, peer.fakeMember)
	mgrSend(t, membership, client, "b")
	mgrWait(t, "the export to start", func() bool { return len(b.endpoint.Saves()) == 1 })

	mgrWithin(t, "the reset beside a stuck export", func() error {
		_, err := manager.Reset(context.Background(), mgrDoc)
		return err
	})
	b.endpoint.setGate(nil)
	close(gate)
	time.Sleep(300 * time.Millisecond)
	manager.Settle()

	if got := len(b.endpoint.Saves()); got != 1 {
		t.Fatalf("%d saves, want 1", got)
	}
	if manager.LiveRoomCount() != 0 {
		t.Fatalf("%d rooms, want 0", manager.LiveRoomCount())
	}
}

func TestDrainFlushesEveryRoomClosesMembersAsDrainingAndRefusesNewJoins(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, "doc-a", "a", nil)
	b.endpoint.Holds(t, "doc-b", "b", nil)
	manager := b.manager(t, mgrSlowExport())
	memberA, memberB := newMgrPeer("", true), newMgrPeer("", false)
	membershipA := mgrEnter(t, manager, "doc-a", memberA)
	mgrEnter(t, manager, "doc-b", memberB)
	client := mgrSynced(t, membershipA, memberA.fakeMember)
	mgrSend(t, membershipA, client, "!")
	mgrSend(t, membershipA, client, "?")

	if err := manager.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}

	mgrClosedOnce(t, memberA.fakeMember, collab.CloseDraining)
	mgrClosedOnce(t, memberB.fakeMember, collab.CloseDraining)
	saves := b.endpoint.Saves()
	if len(saves) != 1 || saves[0].doc != "doc-a" || saves[0].data != textJSON(t, "a!?") {
		t.Fatalf("saves = %+v, want one doc-a a!?", saves)
	}
	if got := len(b.store.frames(t, "doc-a")); got != 1 || manager.LiveRoomCount() != 0 {
		t.Fatalf("doc-a frames %d, rooms %d; want 1, 0", got, manager.LiveRoomCount())
	}

	if refused := mgrTryJoin(t, manager, "doc-c", newMgrPeer("", true)); refused.Status != collab.JoinDraining {
		t.Fatalf("join = %v, want Draining", refused.Status)
	}
	if b.endpoint.Loads() != 2 {
		t.Fatalf("%d loads, want 2", b.endpoint.Loads())
	}
}

func mgrDiskWrite(t *testing.T, disk *workingset.LocalStore, text string, tag workingset.Tag) {
	t.Helper()
	frames, err := workingset.EncodeFrames([][]byte{fullState(t, docWith(text))})
	if err != nil {
		t.Fatal(err)
	}
	if err := disk.Write(context.Background(), mgrDoc, frames, tag); err != nil {
		t.Fatal(err)
	}
}

func mgrDiskRead(t *testing.T, disk *workingset.LocalStore) workingset.Set {
	t.Helper()
	set, err := disk.Read(context.Background(), mgrDoc)
	if err != nil || set == nil {
		t.Fatalf("disk read = %v, %v", set, err)
	}
	return *set
}

func TestAReSeedAfterAnUnreadableBlobMintsANewLineage(t *testing.T) {
	b := newMgrBench()
	dir := t.TempDir()
	disk := workingset.NewLocalStore(dir, nil)
	before := workingset.NewLineage()
	mgrDiskWrite(t, disk, "old", mgrTag(5, before))
	path := filepath.Join(dir, workingset.DocKey(mgrDoc))
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	raw[0] ^= 0xff
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	b.endpoint.Holds(t, mgrDoc, "fresh", nil)
	manager := b.managerWith(t, mgrFast(), disk, nil, nil)
	peer := newMgrPeer("", true)

	membership := mgrEnter(t, manager, mgrDoc, peer)

	announced := mgrTagOf(membership)
	if lineage := mgrAssertMinted(t, 0, announced); lineage == before {
		t.Fatal("the re-seed kept the unreadable blob's lineage")
	}
	messages := peer.messages(t)
	if control, ok := messages[0].(wire.BlokControl); !ok || control.Tag != wireTag(announced) {
		t.Fatalf("the first frame is %#v, want the control frame naming %+v", messages[0], announced)
	}
	if got := mgrDiskRead(t, disk).Tag; got != announced {
		t.Fatalf("stored tag %+v, want %+v", got, announced)
	}
}

func TestAReSeedAfterABlobWithCorruptFramesUnderAnIntactHeaderStillJoins(t *testing.T) {
	b := newMgrBench()
	dir := t.TempDir()
	disk := workingset.NewLocalStore(dir, nil)
	mgrDiskWrite(t, disk, "old", tagAt(3))
	path := filepath.Join(dir, workingset.DocKey(mgrDoc))
	written, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	damaged := append(append([]byte(nil), written[:workingset.HeaderLength]...), 0xff, 0xff)
	if err := os.WriteFile(path, damaged, 0o600); err != nil {
		t.Fatal(err)
	}
	b.endpoint.Holds(t, mgrDoc, "fresh", nil)
	manager := b.managerWith(t, mgrFast(), disk, nil, nil)

	membership := mgrEnter(t, manager, mgrDoc, newMgrPeer("", true))

	mgrAssertMinted(t, 0, mgrTagOf(membership))
	stored := mgrDiskRead(t, disk)
	if stored.Tag != mgrTagOf(membership) {
		t.Fatalf("stored tag %+v, want %+v", stored.Tag, mgrTagOf(membership))
	}
	frames, _ := workingset.DecodeFrames(stored.Updates)
	if got := mgrReplay(t, frames); got != "fresh" {
		t.Fatalf("the blob reads %q", got)
	}
}

func TestAReSeedAfterALostBlobMintsANewLineageUnderTheSameEpoch(t *testing.T) {
	b := newMgrBench()
	dir := t.TempDir()
	disk := workingset.NewLocalStore(dir, nil)
	b.endpoint.Holds(t, mgrDoc, "v1", nil)
	manager := b.managerWith(t, mgrFast(), disk, nil, nil)
	first := mgrEnter(t, manager, mgrDoc, newMgrPeer("", true))
	before := mgrAssertMinted(t, 0, mgrTagOf(first))
	first.Leave()
	mgrEvicted(t, manager)
	if err := os.Remove(filepath.Join(dir, workingset.DocKey(mgrDoc))); err != nil {
		t.Fatal(err)
	}

	second := mgrEnter(t, manager, mgrDoc, newMgrPeer("", true))

	if b.converter.seeds.Load() != 2 {
		t.Fatalf("%d seeds, want 2", b.converter.seeds.Load())
	}
	if mgrTagOf(first).Epoch != mgrTagOf(second).Epoch {
		t.Fatalf("epochs %d and %d differ", mgrTagOf(first).Epoch, mgrTagOf(second).Epoch)
	}
	if mgrAssertMinted(t, 0, mgrTagOf(second)) == before {
		t.Fatal("the re-seed kept the lost blob's lineage")
	}
}

func TestAStoreOutageKeepsTheRoomLoadedUntilTheWorkingSetCatchesUp(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "hello", nil)
	manager := b.manager(t, mgrFast())
	peer := newMgrPeer("", true)
	membership := mgrEnter(t, manager, mgrDoc, peer)
	client := mgrSynced(t, membership, peer.fakeMember)
	b.store.setFailWrites(func(string) error { return errors.New("disk full") })

	mgrSend(t, membership, client, "!")
	mgrWait(t, "the export", func() bool { return len(b.endpoint.Saves()) == 1 })
	if got := b.endpoint.Saves()[0].data; got != textJSON(t, "hello!") {
		t.Fatalf("the export carried %s", got)
	}

	membership.Leave()
	mgrWait(t, "the eviction's flush to fail", func() bool { return b.logged("could not flush the working set") })
	manager.Settle()

	if manager.LiveRoomCount() != 1 {
		t.Fatal("the room unloaded with its working set unwritten")
	}
	if !b.logged("could not") {
		t.Fatalf("no failure was logged: %q", b.lines())
	}

	b.store.setFailWrites(nil)
	mgrEvicted(t, manager)

	frames := b.store.frames(t, mgrDoc)
	if len(frames) != 1 || mgrReplay(t, frames) != "hello!" || len(b.endpoint.Saves()) != 1 {
		t.Fatalf("%d frames reading %q, %d saves", len(frames), mgrReplay(t, frames), len(b.endpoint.Saves()))
	}

	mgrEnter(t, manager, mgrDoc, newMgrPeer("", true))
	if b.endpoint.Loads() != 1 {
		t.Fatalf("%d loads, want 1", b.endpoint.Loads())
	}
	if got := exportedText(t, manager, mgrDoc); got != "hello!" {
		t.Fatalf("the room reads %q", got)
	}
}

func TestAnEndpointOutageAtEvictionKeepsTheRoomLoadedUntilTheExportLands(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "hello", nil)
	o := mgrSlowExport()
	// Long enough that the retry cannot land before the first check.
	o.RetryBackoff, o.RetryBackoffCap = 300*time.Millisecond, 300*time.Millisecond
	manager := b.manager(t, o)
	peer := newMgrPeer("", true)
	membership := mgrEnter(t, manager, mgrDoc, peer)
	client := mgrSynced(t, membership, peer.fakeMember)
	mgrSend(t, membership, client, "!")
	manager.Settle()
	b.endpoint.setNextSaveFailure(&docendpoint.Error{Message: "collab: the doc endpoint PUT returned 502.", StatusCode: 502})

	membership.Leave()
	mgrWait(t, "the eviction's export", func() bool { return len(b.endpoint.Saves()) == 1 })
	manager.Settle()

	if manager.LiveRoomCount() != 1 {
		t.Fatal("the room unloaded with its export unlanded")
	}
	if !b.logged("export") {
		t.Fatalf("no export failure was logged: %q", b.lines())
	}

	mgrEvicted(t, manager)

	saves := b.endpoint.Saves()
	if len(saves) != 2 || saves[1].data != textJSON(t, "hello!") {
		t.Fatalf("saves = %+v, want two ending hello!", saves)
	}
}

func TestDrainClosesARoomWhoseStoreFailsAndStillDrainsTheOthers(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, "doc-a", "a", nil)
	b.endpoint.Holds(t, "doc-b", "b", nil)
	manager := b.manager(t, mgrSlowExport())
	memberA, memberB := newMgrPeer("", true), newMgrPeer("", true)
	membershipA := mgrEnter(t, manager, "doc-a", memberA)
	membershipB := mgrEnter(t, manager, "doc-b", memberB)
	clientA := mgrSynced(t, membershipA, memberA.fakeMember)
	clientB := mgrSynced(t, membershipB, memberB.fakeMember)
	mgrSend(t, membershipA, clientA, "!")
	mgrSend(t, membershipB, clientB, "?")
	manager.Settle()
	// C# TaskCanceledException from an S3 timeout.
	b.store.setFailWrites(func(doc string) error {
		if doc == "doc-a" {
			return context.DeadlineExceeded
		}
		return nil
	})

	if err := manager.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}

	if manager.LiveRoomCount() != 0 {
		t.Fatalf("%d rooms, want 0", manager.LiveRoomCount())
	}
	mgrClosedOnce(t, memberA.fakeMember, collab.CloseDraining)
	mgrClosedOnce(t, memberB.fakeMember, collab.CloseDraining)
	if got := len(b.store.frames(t, "doc-b")); got != 1 {
		t.Fatalf("doc-b holds %d frames, want 1", got)
	}
	texts := map[string]string{}
	for _, save := range b.endpoint.Saves() {
		texts[save.doc] = save.data
	}
	if len(b.endpoint.Saves()) != 2 || texts["doc-a"] != textJSON(t, "a!") || texts["doc-b"] != textJSON(t, "b?") {
		t.Fatalf("saves = %+v, want a! and b?", b.endpoint.Saves())
	}
}

func TestPurgeRejectsInvalidDocumentIdsBeforeAuthorization(t *testing.T) {
	rows := []struct{ name, doc string }{
		{"empty", ""}, {"dot", "."}, {"dotdot", ".."}, {"slash", "a/b"}, {"backslash", `a\b`},
	}
	for _, row := range rows {
		t.Run(row.name, func(t *testing.T) {
			b := newMgrBench()
			manager := b.manager(t, mgrFast())
			authorized := false

			_, err := manager.Purge(context.Background(), row.doc, func(context.Context) (bool, error) {
				authorized = true
				return true, nil
			})

			if !errors.Is(err, ErrEmptyDocID) && !errors.Is(err, ErrNotSingleSegment) {
				t.Fatalf("purge err = %v, want an argument refusal", err)
			}
			if authorized || b.store.deletes.Load() != 0 || manager.LiveRoomCount() != 0 {
				t.Fatalf("authorized %v, deletes %d, rooms %d", authorized, b.store.deletes.Load(), manager.LiveRoomCount())
			}
		})
	}
}

func TestDeniedPurgeLeavesTheRoomAndWorkingSetUntouched(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "visible", nil)
	manager := b.manager(t, mgrFast())
	peer := newMgrPeer("", true)
	mgrEnter(t, manager, mgrDoc, peer)

	_, err := mgrPurge(manager, false)

	if !errors.Is(err, ErrPurgeNotAuthorized) {
		t.Fatalf("purge err = %v, want ErrPurgeNotAuthorized", err)
	}
	if got := peer.closed(); len(got) != 0 {
		t.Fatalf("closes = %v", got)
	}
	if !b.store.holds(mgrDoc) || b.store.deletes.Load() != 0 || manager.LiveRoomCount() != 1 {
		t.Fatalf("holds %v, deletes %d, rooms %d", b.store.holds(mgrDoc), b.store.deletes.Load(), manager.LiveRoomCount())
	}
	if got := mgrTryJoin(t, manager, mgrDoc, newMgrPeer("", true)).Status; got != collab.JoinJoined {
		t.Fatalf("join = %v, want Joined", got)
	}
}

func TestAJournalWithoutPurgeSupportFailsBeforeTheRoomIsClosed(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "visible", nil)
	// The harness journal has Open only, like C#'s OpenOnlyOperationStore.
	manager := b.managerWith(t, mgrFast(), b.store, newFakeJournal(), nil)
	peer := newMgrPeer("", true)
	mgrEnter(t, manager, mgrDoc, peer)
	b.store.seed(t, mgrDoc, [][]byte{fullState(t, docWith("legacy"))}, tagAt(1))

	_, err := mgrPurge(manager, true)

	if !errors.Is(err, ErrPurgeUnsupported) {
		t.Fatalf("purge err = %v, want ErrPurgeUnsupported", err)
	}
	if got := peer.closed(); len(got) != 0 {
		t.Fatalf("closes = %v", got)
	}
	if !b.store.holds(mgrDoc) || b.store.deletes.Load() != 0 || manager.LiveRoomCount() != 1 {
		t.Fatalf("holds %v, deletes %d, rooms %d", b.store.holds(mgrDoc), b.store.deletes.Load(), manager.LiveRoomCount())
	}
	if got := mgrTryJoin(t, manager, mgrDoc, newMgrPeer("", true)).Status; got != collab.JoinJoined {
		t.Fatalf("join = %v, want Joined", got)
	}
	if !strings.Contains(err.Error(), "PurgeStore") {
		t.Fatalf("the refusal %q does not name PurgeStore", err)
	}
}

// mgrEveryDoorPurged: join, edit, reset and checkpoint all answer purged.
func mgrEveryDoorPurged(t *testing.T, manager *Manager) {
	t.Helper()
	mgrWithin(t, "the join", func() error {
		result, err := manager.Join(context.Background(), mgrDoc, newMgrPeer("", true))
		if err == nil && result.Status != collab.JoinPurged {
			err = fmt.Errorf("join = %v, want Purged", result.Status)
		}
		return err
	})
	mgrWithin(t, "the edit", func() error {
		result, err := mgrEdit(manager, "late")
		if err == nil && result.Status != EditPurged {
			err = fmt.Errorf("edit = %v, want Purged", result.Status)
		}
		return err
	})
	mgrWithin(t, "the reset", func() error {
		result, err := manager.Reset(context.Background(), mgrDoc)
		if err == nil && result.Status != ResetPurged {
			err = fmt.Errorf("reset = %v, want Purged", result.Status)
		}
		return err
	})
	mgrWithin(t, "the checkpoint", func() error {
		ok, err := manager.Checkpoint(context.Background(), mgrDoc)
		if err == nil && ok {
			err = errors.New("the checkpoint ran")
		}
		return err
	})
}

func TestPurgeClosesMembersWithoutFlushingAndBarsEveryEntryPoint(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "old", nil)
	b.endpoint.Holds(t, "doc-2", "other", nil)
	manager := b.manager(t, mgrFast())
	peer := newMgrPeer("", true)
	membership := mgrEnter(t, manager, mgrDoc, peer)
	client := mgrSynced(t, membership, peer.fakeMember)
	mgrSend(t, membership, client, " edit")
	mgrWait(t, "the edit blob to land", func() bool { return b.store.frameCount(mgrDoc) == 2 })

	outcome, err := mgrPurge(manager, true)
	if err != nil {
		t.Fatal(err)
	}
	_ = membership.Receive(context.Background(), syncFrame(t, wire.SyncUpdate{Update: updateAppending(client, " late")}))
	time.Sleep(300 * time.Millisecond)
	manager.Settle()

	if outcome != journal.Purged {
		t.Fatalf("outcome = %v, want Purged", outcome)
	}
	mgrClosedOnce(t, peer.fakeMember, collab.CloseForbidden)
	if b.store.holds(mgrDoc) || b.store.deletes.Load() != 1 || len(b.endpoint.Saves()) != 0 || manager.LiveRoomCount() != 0 {
		t.Fatalf("holds %v, deletes %d, saves %d, rooms %d", b.store.holds(mgrDoc), b.store.deletes.Load(), len(b.endpoint.Saves()), manager.LiveRoomCount())
	}
	mgrEveryDoorPurged(t, manager)
	if b.endpoint.Loads() != 1 {
		t.Fatalf("%d loads, want 1", b.endpoint.Loads())
	}
	if got := mgrTryJoin(t, manager, "doc-2", newMgrPeer("", true)).Status; got != collab.JoinJoined {
		t.Fatalf("another doc's join = %v, want Joined", got)
	}
}

func TestPurgeBarsAdmissionWhileAPreviousBlobWriteIsStillInFlight(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "old", nil)
	manager := b.manager(t, mgrFast())
	peer := newMgrPeer("", true)
	membership := mgrEnter(t, manager, mgrDoc, peer)
	client := mgrSynced(t, membership, peer.fakeMember)
	blocked := make(chan struct{})
	b.store.setBeforeWrite(blocked)
	unblocked := false
	unblock := func() {
		if !unblocked {
			unblocked = true
			b.store.setBeforeWrite(nil)
			close(blocked)
		}
	}
	defer unblock()
	mgrSend(t, membership, client, " edit")
	mgrWait(t, "the old blob write to start", func() bool { return b.store.writes.Load() == 2 })

	type answer struct {
		outcome journal.PurgeOutcome
		err     error
	}
	pending := make(chan answer, 1)
	go func() {
		outcome, err := mgrPurge(manager, true)
		pending <- answer{outcome, err}
	}()
	queued := updateAppending(client, " queued")
	frame := make(chan struct{})
	go func() {
		defer close(frame)
		_ = membership.Receive(context.Background(), syncFrame(t, wire.SyncUpdate{Update: queued}))
	}()
	mgrWait(t, "the purge to start", func() bool { return manager.isPurging(mgrDoc) })

	select {
	case <-pending:
		t.Fatal("the purge finished under an in-flight blob write")
	default:
	}
	mgrEveryDoorPurged(t, manager)
	if !b.store.holds(mgrDoc) {
		t.Fatal("the working set went before the write landed")
	}
	unblock()

	if got := <-pending; got.err != nil || got.outcome != journal.Purged {
		t.Fatalf("purge = %v, %v; want Purged", got.outcome, got.err)
	}
	<-frame
	if b.store.holds(mgrDoc) {
		t.Fatal("the purge left a working set")
	}
	mgrClosedOnce(t, peer.fakeMember, collab.CloseForbidden)
}

func TestPurgeWaitsForAnInFlightExportButStartsNoFinalExport(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "old", nil)
	gate := make(chan struct{})
	b.endpoint.setGate(gate)
	manager := b.manager(t, mgrFast())
	peer := newMgrPeer("", true)
	membership := mgrEnter(t, manager, mgrDoc, peer)
	client := mgrSynced(t, membership, peer.fakeMember)
	mgrSend(t, membership, client, " edit")
	mgrWait(t, "the blob to land", func() bool { return b.store.frameCount(mgrDoc) == 2 })
	mgrWait(t, "the export to start", func() bool { return len(b.endpoint.Saves()) == 1 })

	type answer struct {
		outcome journal.PurgeOutcome
		err     error
	}
	pending := make(chan answer, 1)
	go func() {
		outcome, err := mgrPurge(manager, true)
		pending <- answer{outcome, err}
	}()
	mgrWait(t, "the purge to start", func() bool { return manager.isPurging(mgrDoc) })

	select {
	case <-pending:
		t.Fatal("the purge finished under an in-flight export")
	default:
	}
	mgrWithin(t, "the join", func() error {
		result, err := manager.Join(context.Background(), mgrDoc, newMgrPeer("", true))
		if err == nil && result.Status != collab.JoinPurged {
			err = fmt.Errorf("join = %v, want Purged", result.Status)
		}
		return err
	})
	b.endpoint.setGate(nil)
	close(gate)
	if got := <-pending; got.err != nil || got.outcome != journal.Purged {
		t.Fatalf("purge = %v, %v; want Purged", got.outcome, got.err)
	}
	time.Sleep(300 * time.Millisecond)
	manager.Settle()

	if got := len(b.endpoint.Saves()); got != 1 {
		t.Fatalf("%d saves, want 1", got)
	}
	if b.store.holds(mgrDoc) {
		t.Fatal("the purge left a working set")
	}
	mgrClosedOnce(t, peer.fakeMember, collab.CloseForbidden)
}

// mgrPurgeHooks is the built-in journal with C#'s OnPurge and
// FailPurgeAfterTombstone: the purge lands, then the call fails.
type mgrPurgeHooks struct {
	LocalJournal
	mu        sync.Mutex
	events    []string
	failAfter atomic.Bool
	purges    atomic.Int32
}

func (p *mgrPurgeHooks) note(event string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.events = append(p.events, event)
}

func (p *mgrPurgeHooks) noted() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.events...)
}

func (p *mgrPurgeHooks) Purge(ctx context.Context, doc string) (journal.PurgeOutcome, error) {
	p.purges.Add(1)
	outcome, err := p.LocalJournal.Purge(ctx, doc)
	if err != nil {
		return outcome, err
	}
	if outcome == journal.Purged {
		p.note("journal")
		if p.failAfter.Load() {
			return 0, errors.New("journal cleanup failed")
		}
	}
	return outcome, nil
}

func newMgrPurgeHooks(t *testing.T, b *mgrBench, failAfter bool) *mgrPurgeHooks {
	t.Helper()
	hooks := &mgrPurgeHooks{LocalJournal: openJournal(t).(LocalJournal)}
	hooks.failAfter.Store(failAfter)
	b.store.mu.Lock()
	b.store.beforeDelete = func() { hooks.note("working-set") }
	b.store.mu.Unlock()
	return hooks
}

func mgrSameEvents(got []string, want ...string) bool {
	return strings.Join(got, ",") == strings.Join(want, ",")
}

func TestARemoteJournalHoldLeavesTheWorkingSetAndAdmissionGateInPlace(t *testing.T) {
	b := newMgrBench()
	operations := openJournal(t)
	b.store.seed(t, mgrDoc, [][]byte{fullState(t, docWith("old"))}, tagAt(1))
	outcome, held, err := operations.Open(context.Background(), mgrDoc)
	if err != nil || outcome != journal.Opened || held == nil {
		t.Fatalf("open = %v, %v, %v", outcome, held, err)
	}
	manager := b.managerWith(t, mgrFast(), b.store, operations, nil)

	busy, err := mgrPurge(manager, true)

	if err != nil || busy != journal.PurgeOpenElsewhere {
		t.Fatalf("purge = %v, %v; want PurgeOpenElsewhere", busy, err)
	}
	if !b.store.holds(mgrDoc) || b.store.deletes.Load() != 0 {
		t.Fatalf("holds %v, deletes %d", b.store.holds(mgrDoc), b.store.deletes.Load())
	}
	if got := mgrTryJoin(t, manager, mgrDoc, newMgrPeer("", true)).Status; got != collab.JoinPurged {
		t.Fatalf("join = %v, want Purged", got)
	}
	if err := held.Close(); err != nil {
		t.Fatal(err)
	}

	if again, err := mgrPurge(manager, true); err != nil || again != journal.Purged {
		t.Fatalf("purge = %v, %v; want Purged", again, err)
	}
	if b.store.holds(mgrDoc) {
		t.Fatal("the purge left a working set")
	}
}

func TestAJournalPurgeFailureKeepsTheGateAndRetriesBeforeWorkingSetDeletion(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "old", nil)
	operations := newMgrPurgeHooks(t, b, true)
	manager := b.managerWith(t, mgrFast(), b.store, operations, nil)
	peer := newMgrPeer("", true)
	mgrEnter(t, manager, mgrDoc, peer)
	b.store.seed(t, mgrDoc, [][]byte{fullState(t, docWith("legacy"))}, tagAt(1))

	_, err := mgrPurge(manager, true)

	if err == nil || !strings.Contains(err.Error(), "journal cleanup failed") {
		t.Fatalf("purge err = %v, want the journal cleanup failure", err)
	}
	if got := operations.noted(); !mgrSameEvents(got, "journal") {
		t.Fatalf("events = %q, want [journal]", got)
	}
	mgrClosedOnce(t, peer.fakeMember, collab.CloseForbidden)
	if !b.store.holds(mgrDoc) || b.store.deletes.Load() != 0 {
		t.Fatalf("holds %v, deletes %d", b.store.holds(mgrDoc), b.store.deletes.Load())
	}
	if got := mgrTryJoin(t, manager, mgrDoc, newMgrPeer("", true)).Status; got != collab.JoinPurged {
		t.Fatalf("join = %v, want Purged", got)
	}
	if b.endpoint.Loads() != 1 {
		t.Fatalf("%d loads, want 1", b.endpoint.Loads())
	}

	operations.failAfter.Store(false)
	if again, err := mgrPurge(manager, true); err != nil || again != journal.Purged {
		t.Fatalf("purge = %v, %v; want Purged", again, err)
	}
	if got := operations.noted(); !mgrSameEvents(got, "journal", "journal", "working-set") {
		t.Fatalf("events = %q", got)
	}
	if b.store.holds(mgrDoc) {
		t.Fatal("the purge left a working set")
	}
}

func TestAWorkingSetDeleteFailureKeepsTheJournalTombstoneAndRetries(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "old", nil)
	operations := newMgrPurgeHooks(t, b, false)
	b.store.setFailDeletes(func(string) error { return errors.New("working set delete failed") })
	manager := b.managerWith(t, mgrFast(), b.store, operations, nil)
	mgrEnter(t, manager, mgrDoc, newMgrPeer("", true))
	b.store.seed(t, mgrDoc, [][]byte{fullState(t, docWith("legacy"))}, tagAt(1))

	_, err := mgrPurge(manager, true)

	if err == nil || !strings.Contains(err.Error(), "working set delete failed") {
		t.Fatalf("purge err = %v, want the delete failure", err)
	}
	if got := operations.noted(); !mgrSameEvents(got, "journal", "working-set") {
		t.Fatalf("events = %q", got)
	}
	if !b.store.holds(mgrDoc) {
		t.Fatal("the failed delete removed the working set")
	}
	if got := mgrTryJoin(t, manager, mgrDoc, newMgrPeer("", true)).Status; got != collab.JoinPurged {
		t.Fatalf("join = %v, want Purged", got)
	}
	if b.endpoint.Loads() != 1 {
		t.Fatalf("%d loads, want 1", b.endpoint.Loads())
	}

	b.store.setFailDeletes(nil)
	if again, err := mgrPurge(manager, true); err != nil || again != journal.Purged {
		t.Fatalf("purge = %v, %v; want Purged", again, err)
	}
	if got := operations.noted(); !mgrSameEvents(got, "journal", "working-set", "journal", "working-set") {
		t.Fatalf("events = %q", got)
	}
	if b.store.holds(mgrDoc) || operations.purges.Load() != 2 || b.store.deletes.Load() != 2 {
		t.Fatalf("holds %v, journal purges %d, deletes %d; want false, 2, 2", b.store.holds(mgrDoc), operations.purges.Load(), b.store.deletes.Load())
	}
}

func TestAJournalFreePurgeNeedsTheHostsTombstoneOnAnotherManager(t *testing.T) {
	b := newMgrBench()
	b.endpoint.Holds(t, mgrDoc, "old", nil)
	manager := b.manager(t, mgrFast())
	mgrEnter(t, manager, mgrDoc, newMgrPeer("", true))

	if outcome, err := mgrPurge(manager, true); err != nil || outcome != journal.Purged {
		t.Fatalf("purge = %v, %v; want Purged", outcome, err)
	}

	b.endpoint.setLoadFailure(&docendpoint.Error{Message: "gone", StatusCode: 410})
	restarted := b.manager(t, mgrFast())
	late := mgrTryJoin(t, restarted, mgrDoc, newMgrPeer("", true))

	if late.Status != collab.JoinSeedFailed || b.store.holds(mgrDoc) || b.endpoint.Loads() != 2 {
		t.Fatalf("join %v, holds %v, loads %d; want SeedFailed, false, 2", late.Status, b.store.holds(mgrDoc), b.endpoint.Loads())
	}
}

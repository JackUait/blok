package room

import (
	"bytes"
	"context"
	"errors"
	"sync"
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

// memoryStore is a working-set store in memory.
type memoryStore struct {
	mu   sync.Mutex
	sets map[string]*workingset.Set
}

func newMemoryStore() *memoryStore { return &memoryStore{sets: map[string]*workingset.Set{}} }

func (s *memoryStore) Read(_ context.Context, doc string) (*workingset.Set, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if set := s.sets[doc]; set != nil {
		return &workingset.Set{Updates: append([]byte(nil), set.Updates...), Tag: set.Tag}, nil
	}
	return nil, nil
}

func (s *memoryStore) Write(_ context.Context, doc string, updates []byte, tag workingset.Tag) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sets[doc] = &workingset.Set{Updates: append([]byte(nil), updates...), Tag: tag}
	return nil
}

func (s *memoryStore) Reset(ctx context.Context, doc string, tag workingset.Tag) error {
	return s.Write(ctx, doc, nil, tag)
}

func (s *memoryStore) Retire(_ context.Context, doc string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sets, doc)
	return nil
}

func (s *memoryStore) Delete(ctx context.Context, doc string) error { return s.Retire(ctx, doc) }

// memoryEndpoint answers null and records each save.
type memoryEndpoint struct {
	mu    sync.Mutex
	saves []string
}

func (e *memoryEndpoint) Load(context.Context, string) (*docendpoint.Loaded, error) {
	return &docendpoint.Loaded{}, nil
}

func (e *memoryEndpoint) Save(_ context.Context, doc string, _ any, _ *string, _ *docendpoint.Projection) (*string, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.saves = append(e.saves, doc)
	return nil, nil
}

func (e *memoryEndpoint) saved() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return len(e.saves)
}

// fakeMember records what the room hands it.
type fakeMember struct {
	actor  string
	source collab.OperationSource
	write  bool

	mu     sync.Mutex
	frames [][]byte
	closes []collab.CloseReason
}

func (m *fakeMember) CanWrite() bool                         { return m.write }
func (m *fakeMember) AcceptsControlFrames() bool             { return true }
func (m *fakeMember) ActorID() string                        { return m.actor }
func (m *fakeMember) ProtocolSource() collab.OperationSource { return m.source }
func (m *fakeMember) RecheckAccess(context.Context) (bool, error) {
	return true, nil
}

func (m *fakeMember) Send(frame []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.frames = append(m.frames, frame)
}

func (m *fakeMember) Close(reason collab.CloseReason) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closes = append(m.closes, reason)
}

func (m *fakeMember) messages(t *testing.T) []wire.Message {
	t.Helper()
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []wire.Message
	for _, frame := range m.frames {
		message, err := wire.Decode(frame)
		if err != nil {
			t.Fatalf("the room sent a frame it cannot decode: %v", err)
		}
		out = append(out, message)
	}
	return out
}

func (m *fakeMember) closed() []collab.CloseReason {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]collab.CloseReason(nil), m.closes...)
}

func newTestManager(t *testing.T, o Options, operations OperationStore) (*Manager, *memoryStore, *memoryEndpoint) {
	t.Helper()
	store, endpoint := newMemoryStore(), &memoryEndpoint{}
	manager := NewManager(ManagerOptions{
		Store:      store,
		Endpoint:   endpoint,
		Converter:  &convert.DocConverter{Now: time.Now},
		Room:       o,
		Operations: operations,
	})
	t.Cleanup(func() { _ = manager.Drain(context.Background()) })
	return manager, store, endpoint
}

func join(t *testing.T, manager *Manager, doc string, member collab.Member) collab.Membership {
	t.Helper()
	result, err := manager.Join(context.Background(), doc, member)
	if err != nil || result.Status != collab.JoinJoined {
		t.Fatalf("join = %v, %v", result.Status, err)
	}
	return result.Membership
}

// clientUpdate is one update a client doc emits setting key in a root map.
func clientUpdate(t *testing.T, client uint32, key string) []byte {
	t.Helper()
	doc := yjs.NewDoc(yjs.Options{ClientID: &client})
	return doc.Transact(func(tx *yjs.Transaction) {
		doc.GetMap(jsjson.FromString("notes")).Set(tx, jsjson.FromString(key), 1.0)
	})
}

func syncFrame(t *testing.T, message wire.Message) []byte {
	t.Helper()
	frame, err := wire.Encode(message)
	if err != nil {
		t.Fatal(err)
	}
	return frame
}

func TestAJoinerGetsControlLimitsAndIdentitiesAndTheOthersAreAsked(t *testing.T) {
	manager, _, _ := newTestManager(t, Options{AnnouncedMaxMessageBytes: 1 << 20}, nil)
	first := &fakeMember{source: collab.SourceClientV1, write: true}
	join(t, manager, "doc", first)
	second := &fakeMember{source: collab.SourceClientV1, write: true}
	join(t, manager, "doc", second)
	manager.Settle()

	got := second.messages(t)
	if len(got) != 3 {
		t.Fatalf("the joiner got %d frames, want control, limits, identities: %#v", len(got), got)
	}
	if _, ok := got[0].(wire.BlokControl); !ok {
		t.Fatalf("first frame %T, want BlokControl", got[0])
	}
	if limits, ok := got[1].(wire.BlokLimits); !ok || limits.MaxMessageBytes != 1<<20 {
		t.Fatalf("second frame %#v, want BlokLimits 1 MiB", got[1])
	}
	if identities, ok := got[2].(wire.Identities); !ok || len(identities.Identities) != 0 {
		t.Fatalf("third frame %#v, want an empty identities map", got[2])
	}
	others := first.messages(t)
	if _, ok := others[len(others)-1].(wire.QueryAwareness); !ok {
		t.Fatalf("the member already in the room got %T last, want QueryAwareness", others[len(others)-1])
	}
}

// Many members write and leave at once; -race checks the lane is the only
// door to the doc, and every write reaches every member still in the room.
func TestConcurrentWritersAllConvergeThroughTheLane(t *testing.T) {
	manager, _, _ := newTestManager(t, Options{}, nil)
	const writers = 8
	members := make([]*fakeMember, writers)
	memberships := make([]collab.Membership, writers)
	for i := range members {
		members[i] = &fakeMember{source: collab.SourceClientV1, write: true}
		memberships[i] = join(t, manager, "doc", members[i])
	}
	var wg sync.WaitGroup
	for i := range memberships {
		wg.Add(1)
		go func() {
			defer wg.Done()
			update := clientUpdate(t, uint32(100+i), string(rune('a'+i)))
			if err := memberships[i].Receive(context.Background(), syncFrame(t, wire.SyncUpdate{Update: update})); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	manager.Settle()
	for i, member := range members {
		updates := 0
		for _, message := range member.messages(t) {
			if _, ok := message.(wire.SyncUpdate); ok {
				updates++
			}
		}
		// v1 relays to the others only.
		if updates != writers-1 {
			t.Fatalf("member %d saw %d updates, want %d", i, updates, writers-1)
		}
	}
	state, err := manager.State(context.Background(), "doc")
	if err != nil || state.Status != StateReady {
		t.Fatalf("state = %v, %v", state.Status, err)
	}
	for _, membership := range memberships {
		membership.Leave()
	}
}

func TestDrainFlushesThenClosesEveryMember1001AndRefusesNewJoins(t *testing.T) {
	manager, store, endpoint := newTestManager(t, Options{ExportDebounce: time.Hour, ExportMaxDelay: time.Hour}, nil)
	member := &fakeMember{source: collab.SourceClientV1, write: true}
	membership := join(t, manager, "doc", member)
	if err := membership.Receive(context.Background(), syncFrame(t, wire.SyncUpdate{Update: clientUpdate(t, 9, "k")})); err != nil {
		t.Fatal(err)
	}
	if err := manager.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := member.closed(); len(got) != 1 || got[0] != collab.CloseDraining {
		t.Fatalf("closes = %v, want one CloseDraining", got)
	}
	if endpoint.saved() != 1 {
		t.Fatalf("the drain made %d PUTs, want 1", endpoint.saved())
	}
	if set, _ := store.Read(context.Background(), "doc"); set == nil || len(set.Updates) == 0 {
		t.Fatal("the drain left no working set")
	}
	result, err := manager.Join(context.Background(), "doc", &fakeMember{})
	if err != nil || result.Status != collab.JoinDraining {
		t.Fatalf("a join after the drain = %v, %v; want JoinDraining", result.Status, err)
	}
}

func TestAnEmptyRoomFlushesAndUnloadsAfterItsLinger(t *testing.T) {
	manager, _, endpoint := newTestManager(t, Options{EvictionLinger: 20 * time.Millisecond, ExportDebounce: time.Hour, ExportMaxDelay: time.Hour}, nil)
	membership := join(t, manager, "doc", &fakeMember{source: collab.SourceClientV1, write: true})
	if err := membership.Receive(context.Background(), syncFrame(t, wire.SyncUpdate{Update: clientUpdate(t, 9, "k")})); err != nil {
		t.Fatal(err)
	}
	membership.Leave()
	deadline := time.Now().Add(2 * time.Second)
	for manager.LiveRoomCount() > 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if manager.LiveRoomCount() != 0 {
		t.Fatal("the empty room stayed loaded past its linger")
	}
	if endpoint.saved() != 1 {
		t.Fatalf("the eviction made %d PUTs, want 1", endpoint.saved())
	}
}

func openJournal(t *testing.T) OperationStore {
	t.Helper()
	store, err := journal.NewStore(t.TempDir(), journal.StoreOptions{})
	if err != nil {
		t.Fatal(err)
	}
	return LocalJournal{Store: store}
}

// T11/T12: a v2 write is broadcast to everyone, the sender included, then
// acknowledged; an old lineage is refused before the id lookup.
func TestAV2OperationIsRelayedToAllThenAcknowledged(t *testing.T) {
	manager, _, _ := newTestManager(t, Options{}, openJournal(t))
	writer := &fakeMember{source: collab.SourceClientV2, write: true, actor: "alice"}
	membership := join(t, manager, "doc", writer)
	other := &fakeMember{source: collab.SourceClientV2, write: true}
	join(t, manager, "doc", other)
	if err := membership.Receive(context.Background(), syncFrame(t, wire.SyncStep1{StateVector: []byte{0}})); err != nil {
		t.Fatal(err)
	}
	var lineage string
	for _, message := range writer.messages(t) {
		if control, ok := message.(wire.BlokControl); ok {
			lineage = control.Tag.Lineage
		}
	}
	update := clientUpdate(t, 9, "k")
	operationID := "0123456789abcdef0123456789abcdef"
	if err := membership.Receive(context.Background(), syncFrame(t, wire.Operation{Lineage: lineage, OperationID: operationID, Update: update})); err != nil {
		t.Fatal(err)
	}
	stale := "ffffffffffffffffffffffffffffffff"
	if err := membership.Receive(context.Background(), syncFrame(t, wire.Operation{Lineage: stale, OperationID: operationID, Update: update})); err != nil {
		t.Fatal(err)
	}
	got := writer.messages(t)
	tail := got[len(got)-3:]
	if relay, ok := tail[0].(wire.SyncUpdate); !ok || !bytes.Equal(relay.Update, update) {
		t.Fatalf("the writer's frame after its commit is %#v, want the relayed update", tail[0])
	}
	if ack, ok := tail[1].(wire.Acknowledgement); !ok || ack.ServerSequence != 1 || ack.OperationID != operationID || ack.Lineage != lineage {
		t.Fatalf("then %#v, want the acknowledgement at sequence 1", tail[1])
	}
	if reject, ok := tail[2].(wire.Rejection); !ok || reject.Code != "lineage-mismatch" || reject.Lineage != stale {
		t.Fatalf("then %#v, want a lineage-mismatch naming the client's lineage", tail[2])
	}
	relayed := false
	for _, message := range other.messages(t) {
		if relay, ok := message.(wire.SyncUpdate); ok && bytes.Equal(relay.Update, update) {
			relayed = true
		}
	}
	if !relayed {
		t.Fatal("the other member never got the committed update")
	}
}

type recordingObserver struct {
	mu    sync.Mutex
	kinds []ActivityKind
}

func (o *recordingObserver) Record(_ context.Context, _, _ string, _ time.Time, kind ActivityKind) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.kinds = append(o.kinds, kind)
	return errors.New("an observer that fails must not close the room")
}

func TestActivityReportsJoinedActiveOnceInTheWindowAndLeft(t *testing.T) {
	observer := &recordingObserver{}
	store, endpoint := newMemoryStore(), &memoryEndpoint{}
	manager := NewManager(ManagerOptions{Store: store, Endpoint: endpoint, Converter: &convert.DocConverter{Now: time.Now}, Activity: observer})
	membership := join(t, manager, "doc", &fakeMember{actor: "alice", source: collab.SourceClientV1})
	join(t, manager, "doc", &fakeMember{source: collab.SourceClientV1})
	activity := syncFrame(t, wire.Activity{})
	for i := 0; i < 3; i++ {
		if err := membership.Receive(context.Background(), activity); err != nil {
			t.Fatal(err)
		}
	}
	membership.Leave()
	manager.Settle()
	observer.mu.Lock()
	got := append([]ActivityKind(nil), observer.kinds...)
	observer.mu.Unlock()
	want := []ActivityKind{ActivityJoined, ActivityActive, ActivityLeft}
	if len(got) != len(want) {
		t.Fatalf("activity = %v, want %v (the anonymous member reports nothing)", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("activity = %v, want %v", got, want)
		}
	}
	_ = manager.Drain(context.Background())
}

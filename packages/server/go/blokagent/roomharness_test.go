package blokagent

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/docendpoint"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/room"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
)

// A room on the real converter and the real journal over a temp dir, with
// a working set and a doc endpoint in memory: the Go side of C#
// AgentRoomForTests.

type memorySets struct {
	mu     sync.Mutex
	sets   map[string]*workingset.Set
	writes int
}

func (s *memorySets) Read(_ context.Context, doc string) (*workingset.Set, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if set := s.sets[doc]; set != nil {
		return &workingset.Set{Updates: append([]byte(nil), set.Updates...), Tag: set.Tag}, nil
	}
	return nil, nil
}

func (s *memorySets) Write(_ context.Context, doc string, updates []byte, tag workingset.Tag) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.writes++
	s.sets[doc] = &workingset.Set{Updates: append([]byte(nil), updates...), Tag: tag}
	return nil
}

func (s *memorySets) Reset(ctx context.Context, doc string, tag workingset.Tag) error {
	return s.Write(ctx, doc, nil, tag)
}

func (s *memorySets) Retire(_ context.Context, doc string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sets, doc)
	return nil
}

func (s *memorySets) Delete(ctx context.Context, doc string) error { return s.Retire(ctx, doc) }

func (s *memorySets) writeCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.writes
}

// heldDocs answers each held document on every load, whatever was saved.
type heldDocs struct {
	mu   sync.Mutex
	docs map[string]string
}

func (d *heldDocs) hold(doc, json string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.docs[doc] = json
}

func (d *heldDocs) Load(_ context.Context, doc string) (*docendpoint.Loaded, error) {
	d.mu.Lock()
	text, ok := d.docs[doc]
	d.mu.Unlock()
	if !ok {
		return &docendpoint.Loaded{}, nil
	}
	data, err := jsjson.ParseNode([]byte(text), jsjson.Options{})
	if err != nil {
		return nil, err
	}
	return &docendpoint.Loaded{Data: data}, nil
}

func (d *heldDocs) Save(context.Context, string, any, *string, *docendpoint.Projection) (*string, error) {
	return nil, nil
}

type testRoom struct {
	executor *Executor
	manager  *room.Manager
	sets     *memorySets
	docs     *heldDocs
}

// newTestRoom is rooms over the shared engine, with a journal unless
// noJournal. wrap puts a test runtime in front of the real one.
func newTestRoom(t *testing.T, noJournal bool, wrap func(invoker) invoker) *testRoom {
	t.Helper()
	return newTestRoomWith(t, noJournal, wrap, nil)
}

// newTestRoomWith also lets a test put its own converter in front of the
// real one.
func newTestRoomWith(t *testing.T, noJournal bool, wrap func(invoker) invoker, wrapConverter func(*convert.DocConverter) room.Converter) *testRoom {
	t.Helper()
	var operations room.OperationStore
	if !noJournal {
		operations = newLocalJournal(t)
	}
	return newTestRoomOn(t, operations, wrap, wrapConverter)
}

func newLocalJournal(t *testing.T) room.LocalJournal {
	t.Helper()
	store, err := journal.NewStore(t.TempDir(), journal.StoreOptions{})
	if err != nil {
		t.Fatal(err)
	}
	return room.LocalJournal{Store: store}
}

// newTestRoomOn is rooms over the given journal (nil: none).
func newTestRoomOn(t *testing.T, operations room.OperationStore, wrap func(invoker) invoker, wrapConverter func(*convert.DocConverter) room.Converter) *testRoom {
	t.Helper()
	runtime := sharedExecutor(t).runtime
	sets := &memorySets{sets: map[string]*workingset.Set{}}
	docs := &heldDocs{docs: map[string]string{}}
	var converter room.Converter = &convert.DocConverter{Now: time.Now, HTML: convert.RuntimeHTMLReader{Runtime: runtime}}
	if wrapConverter != nil {
		converter = wrapConverter(converter.(*convert.DocConverter))
	}
	manager := room.NewManager(room.ManagerOptions{
		Store:      sets,
		Endpoint:   docs,
		Converter:  converter,
		Operations: operations,
	})
	t.Cleanup(func() { _ = manager.Drain(context.Background()) })
	if wrap != nil {
		runtime = wrap(runtime)
	}
	executor := newExecutor(runtime)
	executor.attach(NewRooms(manager))
	return &testRoom{executor: executor, manager: manager, sets: sets, docs: docs}
}

func (r *testRoom) export(t *testing.T, doc string) *jsjson.Node {
	t.Helper()
	state, err := r.manager.State(context.Background(), doc)
	if err != nil || state.Status != room.StateReady {
		t.Fatalf("state %v, %v", state.Status, err)
	}
	return mustParse(t, string(state.JSON))
}

func (r *testRoom) head(t *testing.T, doc string) string {
	t.Helper()
	state, err := r.manager.State(context.Background(), doc)
	if err != nil || state.Head == nil {
		t.Fatalf("state %v, %v", state.Status, err)
	}
	return receiptHead(state.Head)
}

package room

import (
	"bytes"
	"context"
	"errors"
	"slices"
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

// Ports of the C# CollabRoomTestSupport fakes, for the twins of the
// CollabRoomTests and CollabRoomMigrationTests cases.

// tagLineage is C# Tags.Lineage.
const tagLineage = "00112233445566778899aabbccddeeff"

// tagAt is C# Tags.At.
func tagAt(epoch int64) workingset.Tag {
	return workingset.Tag{Format: workingset.CurrentFormat, Epoch: epoch, Lineage: tagLineage}
}

// manualClock is the room clock a test moves by hand (C# ManualTimeProvider,
// for Options.Now only; room timers still run on wall time).
type manualClock struct {
	mu  sync.Mutex
	now time.Time
}

func newManualClock() *manualClock {
	return &manualClock{now: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
}

func (c *manualClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *manualClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// --- the operation journal (C# FakeCollabOperationStore) ---

type fakeJournalDoc struct {
	head       *operation.Head
	baseline   [][]byte
	checkpoint *operation.Checkpoint
	records    []operation.Record
	fence      int64
	open       bool
}

type fakeJournal struct {
	mu   sync.Mutex
	docs map[string]*fakeJournalDoc

	failAppends     func(doc string) error
	failCheckpoints func(doc string) error
	failResets      func(doc string) error
}

func newFakeJournal() *fakeJournal { return &fakeJournal{docs: map[string]*fakeJournalDoc{}} }

func (j *fakeJournal) doc(id string) *fakeJournalDoc {
	d := j.docs[id]
	if d == nil {
		d = &fakeJournalDoc{}
		j.docs[id] = d
	}
	return d
}

func (j *fakeJournal) setFailResets(f func(string) error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.failResets = f
}

func (j *fakeJournal) setFailCheckpoints(f func(string) error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.failCheckpoints = f
}

// StealFence: another process takes the fence while a session is live.
func (j *fakeJournal) StealFence(id string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.doc(id).fence++
}

func (j *fakeJournal) Head(id string) *operation.Head {
	j.mu.Lock()
	defer j.mu.Unlock()
	if d := j.docs[id]; d != nil && d.head != nil {
		head := *d.head
		return &head
	}
	return nil
}

func (j *fakeJournal) Baseline(id string) [][]byte {
	j.mu.Lock()
	defer j.mu.Unlock()
	if d := j.docs[id]; d != nil {
		return slices.Clone(d.baseline)
	}
	return nil
}

func (j *fakeJournal) Committed(id string) []operation.Record {
	j.mu.Lock()
	defer j.mu.Unlock()
	if d := j.docs[id]; d != nil {
		return slices.Clone(d.records)
	}
	return nil
}

func (j *fakeJournal) Checkpoint(id string) *operation.Checkpoint {
	j.mu.Lock()
	defer j.mu.Unlock()
	if d := j.docs[id]; d != nil && d.checkpoint != nil {
		checkpoint := *d.checkpoint
		return &checkpoint
	}
	return nil
}

func (j *fakeJournal) Open(_ context.Context, id string) (journal.OpenOutcome, OperationSession, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	d := j.doc(id)
	if d.open {
		return journal.DocumentOpenElsewhere, nil, nil
	}
	d.open = true
	d.fence++
	result := operation.OpenResult{Baseline: slices.Clone(d.baseline), Checkpoint: d.checkpoint}
	if d.head != nil {
		head := *d.head
		result.Head = &head
	}
	var through uint64
	if d.checkpoint != nil {
		through = d.checkpoint.Through
	}
	for _, record := range d.records {
		if record.Sequence > through {
			result.Tail = append(result.Tail, record)
		}
	}
	return journal.Opened, &fakeSession{store: j, id: id, fence: d.fence, opened: result}, nil
}

type fakeSession struct {
	store    *fakeJournal
	id       string
	fence    int64
	opened   operation.OpenResult
	disposed bool
}

func (s *fakeSession) fenced() (*fakeJournalDoc, error) {
	if s.disposed {
		return nil, errors.New("the session is disposed")
	}
	d := s.store.doc(s.id)
	if d.fence != s.fence {
		return nil, journal.ErrFenceLost
	}
	return d, nil
}

func (s *fakeSession) OpenResult() operation.OpenResult { return s.opened }

func committedRecord(d *fakeJournalDoc, operationID string) *operation.Record {
	for i := range d.records {
		if d.records[i].OperationID == operationID {
			return &d.records[i]
		}
	}
	return nil
}

func (s *fakeSession) FindCommitted(_ context.Context, operationID string, digest []byte) (operation.Lookup, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	d, err := s.fenced()
	if err != nil {
		return operation.Lookup{}, err
	}
	existing := committedRecord(d, operationID)
	if existing == nil {
		return operation.Lookup{Outcome: operation.NotCommitted}, nil
	}
	if bytes.Equal(existing.Digest, digest) {
		return operation.Lookup{Outcome: operation.LookupDuplicate, Sequence: existing.Sequence}, nil
	}
	return operation.Lookup{Outcome: operation.LookupConflict, Sequence: existing.Sequence}, nil
}

func (s *fakeSession) Append(_ context.Context, candidate operation.Candidate) (operation.AppendResult, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	d, err := s.fenced()
	if err != nil {
		return operation.AppendResult{}, err
	}
	if existing := committedRecord(d, candidate.OperationID); existing != nil {
		if bytes.Equal(existing.Digest, candidate.Digest) {
			return operation.AppendResult{Outcome: operation.AppendDuplicate, Sequence: existing.Sequence}, nil
		}
		return operation.AppendResult{Outcome: operation.AppendConflict, Sequence: existing.Sequence}, nil
	}
	if s.store.failAppends != nil {
		if failure := s.store.failAppends(s.id); failure != nil {
			return operation.AppendResult{}, failure
		}
	}
	if d.head == nil {
		return operation.AppendResult{}, errors.New(`collab: "` + s.id + `" was never seeded; reset it first`)
	}
	sequence := d.head.DurableThrough + 1
	d.records = append(d.records, operation.Record{
		OperationID: candidate.OperationID, Sequence: sequence,
		CommittedAt: time.Unix(int64(sequence), 0).UTC(), ActorID: candidate.ActorID,
		Source: candidate.Source, Update: candidate.Update, Digest: candidate.Digest,
	})
	d.head.DurableThrough = sequence
	return operation.AppendResult{Outcome: operation.Committed, Sequence: sequence}, nil
}

func (s *fakeSession) WriteCheckpoint(_ context.Context, checkpoint operation.Checkpoint) error {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	d, err := s.fenced()
	if err != nil {
		return err
	}
	if s.store.failCheckpoints != nil {
		if failure := s.store.failCheckpoints(s.id); failure != nil {
			return failure
		}
	}
	var durable, published uint64
	if d.head != nil {
		durable = d.head.DurableThrough
	}
	if d.checkpoint != nil {
		published = d.checkpoint.Through
	}
	if checkpoint.Through == 0 || checkpoint.Through > durable || checkpoint.Through < published {
		return &journal.ArgumentError{Message: "a checkpoint must name a committed sequence at or above the published one", OutOfRange: true}
	}
	if d.checkpoint == nil || checkpoint.Through != d.checkpoint.Through {
		d.checkpoint = &checkpoint
	}
	return nil
}

func (s *fakeSession) Reset(_ context.Context, reset operation.Reset) (operation.Head, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	if s.store.failResets != nil {
		if failure := s.store.failResets(s.id); failure != nil {
			return operation.Head{}, failure
		}
	}
	d, err := s.fenced()
	if err != nil {
		return operation.Head{}, err
	}
	d.baseline = slices.Clone(reset.Baseline)
	d.checkpoint = nil
	d.records = nil
	d.head = &operation.Head{Format: reset.Format, Epoch: reset.Epoch, Lineage: reset.Lineage}
	return *d.head, nil
}

func (s *fakeSession) Close() error {
	if s.disposed {
		return nil
	}
	s.disposed = true
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	if d := s.store.doc(s.id); d.fence == s.fence {
		d.open = false
	}
	return nil
}

// seedJournal is C# SeedJournalAsync: a session reset with baseline, then
// closed.
func seedJournal(t *testing.T, j *fakeJournal, doc string, format int32, epoch int64, baseline [][]byte) *fakeSession {
	t.Helper()
	_, opened, err := j.Open(context.Background(), doc)
	if err != nil {
		t.Fatal(err)
	}
	session := opened.(*fakeSession)
	if _, err := session.Reset(context.Background(), operation.Reset{Format: format, Epoch: epoch, Lineage: tagLineage, Baseline: baseline}); err != nil {
		t.Fatal(err)
	}
	return session
}

// --- the working set (C# FakeWorkingSetStore) ---

type fakeWorkingSet struct {
	mu      sync.Mutex
	sets    map[string]*workingset.Set
	writes  int
	resets  int
	retires int

	failWrites  func(doc string) error
	failRetires func(doc string) error
}

func newFakeWorkingSet() *fakeWorkingSet { return &fakeWorkingSet{sets: map[string]*workingset.Set{}} }

func (s *fakeWorkingSet) Seed(t *testing.T, doc string, updates [][]byte, tag workingset.Tag) {
	t.Helper()
	var framed bytes.Buffer
	for _, update := range updates {
		workingset.AppendFrame(&framed, update)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sets[doc] = &workingset.Set{Updates: framed.Bytes(), Tag: tag}
}

func (s *fakeWorkingSet) Holds(doc string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sets[doc] != nil
}

func (s *fakeWorkingSet) Stored(t *testing.T, doc string) workingset.Set {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	set := s.sets[doc]
	if set == nil {
		t.Fatalf("no working set for %q", doc)
	}
	return *set
}

func (s *fakeWorkingSet) Frames(t *testing.T, doc string) [][]byte {
	t.Helper()
	frames, ok := workingset.DecodeFrames(s.Stored(t, doc).Updates)
	if !ok {
		t.Fatal("the stored working set does not decode")
	}
	return frames
}

func (s *fakeWorkingSet) counts() (writes, resets int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.writes, s.resets
}

func (s *fakeWorkingSet) setFailRetires(f func(string) error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failRetires = f
}

func (s *fakeWorkingSet) setFailWrites(f func(string) error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failWrites = f
}

func (s *fakeWorkingSet) Read(_ context.Context, doc string) (*workingset.Set, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if set := s.sets[doc]; set != nil {
		return &workingset.Set{Updates: slices.Clone(set.Updates), Tag: set.Tag}, nil
	}
	return nil, nil
}

func (s *fakeWorkingSet) Write(_ context.Context, doc string, updates []byte, tag workingset.Tag) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failWrites != nil {
		if failure := s.failWrites(doc); failure != nil {
			return failure
		}
	}
	s.writes++
	s.sets[doc] = &workingset.Set{Updates: slices.Clone(updates), Tag: tag}
	return nil
}

func (s *fakeWorkingSet) Reset(_ context.Context, doc string, tag workingset.Tag) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.resets++
	s.sets[doc] = &workingset.Set{Tag: tag}
	return nil
}

func (s *fakeWorkingSet) Retire(_ context.Context, doc string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failRetires != nil {
		if failure := s.failRetires(doc); failure != nil {
			return failure
		}
	}
	s.retires++
	delete(s.sets, doc)
	return nil
}

func (s *fakeWorkingSet) Delete(ctx context.Context, doc string) error { return s.Retire(ctx, doc) }

// --- the doc endpoint (C# FakeDocEndpoint) ---

type recordedSave struct {
	doc        string
	data       string
	version    *string
	projection *docendpoint.Projection
}

type fakeEndpoint struct {
	mu        sync.Mutex
	documents map[string]*docendpoint.Loaded
	saves     []recordedSave
	loads     int

	loadGate        chan struct{}
	saveGate        chan struct{}
	nextSaveVersion *string
	echoesSaves     bool
}

func (e *fakeEndpoint) setSaveGate(gate chan struct{}) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.saveGate = gate
}

func newFakeEndpoint() *fakeEndpoint {
	return &fakeEndpoint{documents: map[string]*docendpoint.Loaded{}}
}

func node(t *testing.T, json string) *jsjson.Node {
	t.Helper()
	parsed, err := jsjson.ParseNode([]byte(json), jsjson.Options{MaxDepth: 64})
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}

func textJSON(t *testing.T, text string) string {
	t.Helper()
	object := &jsjson.Object{}
	object.Set(jsjson.FromString("text"), jsjson.FromString(text))
	encoded, err := jsjson.Stringify(object)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

// Holds is C# Holds: the document {"text": text}.
func (e *fakeEndpoint) Holds(t *testing.T, doc, text string, version *string) {
	e.HoldsDocument(t, doc, textJSON(t, text), version)
}

func (e *fakeEndpoint) HoldsDocument(t *testing.T, doc, json string, version *string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.documents[doc] = &docendpoint.Loaded{Data: node(t, json), Version: version}
}

func (e *fakeEndpoint) HoldsNothing(doc string, version *string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.documents[doc] = &docendpoint.Loaded{Version: version}
}

func (e *fakeEndpoint) setLoadGate(gate chan struct{}) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.loadGate = gate
}

func (e *fakeEndpoint) setNextSaveVersion(version *string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.nextSaveVersion = version
}

func (e *fakeEndpoint) Loads() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.loads
}

func (e *fakeEndpoint) Saves() []recordedSave {
	e.mu.Lock()
	defer e.mu.Unlock()
	return slices.Clone(e.saves)
}

func (e *fakeEndpoint) Load(ctx context.Context, doc string) (*docendpoint.Loaded, error) {
	e.mu.Lock()
	e.loads++
	gate := e.loadGate
	e.mu.Unlock()
	if gate != nil {
		select {
		case <-gate:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	loaded := e.documents[doc]
	if loaded == nil {
		return nil, errors.New("collab: the doc endpoint GET returned 404.")
	}
	return &docendpoint.Loaded{Data: loaded.Data, Version: loaded.Version}, nil
}

func (e *fakeEndpoint) Save(_ context.Context, doc string, outputData any, version *string, projection *docendpoint.Projection) (*string, error) {
	encoded, err := docendpoint.Serialize(outputData)
	if err != nil {
		return nil, err
	}
	data := string(encoded)
	e.mu.Lock()
	e.saves = append(e.saves, recordedSave{doc: doc, data: data, version: version, projection: projection})
	gate := e.saveGate
	e.mu.Unlock()
	if gate != nil {
		<-gate
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	answer := e.nextSaveVersion
	e.nextSaveVersion = nil
	if e.echoesSaves {
		parsed, err := jsjson.ParseNode([]byte(data), jsjson.Options{MaxDepth: 64})
		if err != nil {
			return nil, err
		}
		kept := version
		if answer != nil {
			kept = answer
		}
		e.documents[doc] = &docendpoint.Loaded{Data: parsed, Version: kept}
	}
	return answer, nil
}

// --- the converter (C# FakeDocConverter): one "content" text root, and
// the OutputData shape {"text": ...} ---

type textConverter struct {
	exports atomic.Int32
}

var contentRoot = jsjson.FromString("content")

func docText(doc *yjs.Doc) string { return doc.GetText(contentRoot).String() }

func dataText(n *jsjson.Node) string {
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

func replaceText(doc *yjs.Doc, value string) {
	text := doc.GetText(contentRoot)
	doc.Transact(func(tx *yjs.Transaction) {
		if length := len(text.String()); length > 0 {
			text.Delete(tx, 0, length)
		}
		if value != "" {
			text.Insert(tx, 0, jsjson.FromString(value), nil)
		}
	})
}

func (c *textConverter) Seed(_ context.Context, doc *yjs.Doc, outputData *jsjson.Node) error {
	replaceText(doc, dataText(outputData))
	return nil
}

func (c *textConverter) Export(_ context.Context, doc *yjs.Doc) (*jsjson.Object, error) {
	c.exports.Add(1)
	object := &jsjson.Object{}
	object.Set(jsjson.FromString("text"), jsjson.FromString(docText(doc)))
	return object, nil
}

func (c *textConverter) ApplyOps(_ context.Context, doc *yjs.Doc, ops []convert.EditOp) error {
	text := doc.GetText(contentRoot)
	for _, op := range ops {
		switch op := op.(type) {
		case convert.Insert:
			var data *jsjson.Node
			if op.Block != nil {
				data, _ = op.Block.Lookup("data")
			}
			doc.Transact(func(tx *yjs.Transaction) {
				if value := dataText(data); value != "" {
					text.Insert(tx, len(text.String()), jsjson.FromString(value), nil)
				}
			})
		case convert.Update:
			replaceText(doc, dataText(op.Data))
		default:
			replaceText(doc, "")
		}
	}
	return nil
}

func (c *textConverter) MigrateRichText(context.Context, *yjs.Doc) (int, error) { return 0, nil }

// --- documents and edits (C# YDocs) ---

var nextClientID atomic.Uint32

func init() { nextClientID.Store(1_000_000) }

func newClient() *yjs.Doc {
	id := nextClientID.Add(1)
	return yjs.NewDoc(yjs.Options{ClientID: &id})
}

func updateAppending(doc *yjs.Doc, value string) []byte {
	text := doc.GetText(contentRoot)
	return doc.Transact(func(tx *yjs.Transaction) {
		text.Insert(tx, len(text.String()), jsjson.FromString(value), nil)
	})
}

func docWith(value string) *yjs.Doc {
	doc := newClient()
	updateAppending(doc, value)
	return doc
}

func fullState(t *testing.T, doc *yjs.Doc) []byte {
	t.Helper()
	update, err := doc.EncodeStateAsUpdate(nil)
	if err != nil {
		t.Fatal(err)
	}
	return update
}

// textRoom is a manager over the text converter and the C# fakes.
type textRoom struct {
	manager    *Manager
	store      *fakeWorkingSet
	endpoint   *fakeEndpoint
	operations *fakeJournal
	converter  *textConverter
	clock      *manualClock

	mu  sync.Mutex
	log []string
}

func newTextRoom() *textRoom {
	return &textRoom{
		store: newFakeWorkingSet(), endpoint: newFakeEndpoint(), operations: newFakeJournal(),
		converter: &textConverter{}, clock: newManualClock(),
	}
}

func (r *textRoom) logf(message string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.log = append(r.log, message)
}

func (r *textRoom) logged(part string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, line := range r.log {
		if bytes.Contains([]byte(line), []byte(part)) {
			return true
		}
	}
	return false
}

// newManager is C# CreateJournalManager (journal) or CreateManager (none).
func (r *textRoom) newManager(t *testing.T, o Options, journalled bool) *Manager {
	t.Helper()
	if o.Now == nil {
		o.Now = r.clock.Now
	}
	var operations OperationStore
	if journalled {
		operations = r.operations
	}
	manager := NewManager(ManagerOptions{
		Store: r.store, Endpoint: r.endpoint, Converter: r.converter, Room: o, Log: r.logf, Operations: operations,
	})
	t.Cleanup(func() { _ = manager.Drain(context.Background()) })
	r.manager = manager
	return manager
}

func stateText(t *testing.T, manager *Manager, doc string) (StateResult, string) {
	t.Helper()
	state, err := manager.State(context.Background(), doc)
	if err != nil {
		t.Fatal(err)
	}
	return state, string(state.JSON)
}

// httpEdit is C# HttpEdit: one insert appending text, under operationID.
func httpEdit(t *testing.T, manager *Manager, doc, operationID, text string) EditResult {
	t.Helper()
	block := node(t, `{"id":"b","type":"paragraph","data":`+textJSON(t, text)+`}`)
	digest := make([]byte, 32)
	copy(digest, operationID)
	result, err := manager.Edit(context.Background(), doc, []convert.EditOp{convert.Insert{ID: "b", Block: block}}, operationID, digest, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

// v2Member is C# V2Member.
func v2Member() *fakeMember {
	return &fakeMember{source: collab.SourceClientV2, write: true}
}

// joinSynced is C# Join: joined, then SyncStep1 from an empty client.
func joinSynced(t *testing.T, manager *Manager, doc string, member *fakeMember) collab.Membership {
	t.Helper()
	result, err := manager.Join(context.Background(), doc, member)
	if err != nil || result.Status != collab.JoinJoined {
		t.Fatalf("join = %v, %v (%v)", result.Status, err, result.Err)
	}
	if err := result.Membership.Receive(context.Background(), syncFrame(t, wire.SyncStep1{StateVector: newClient().EncodeStateVector()})); err != nil {
		t.Fatal(err)
	}
	return result.Membership
}

// controlTag is the tag the room announced to member.
func controlTag(t *testing.T, member *fakeMember) wire.Tag {
	t.Helper()
	for _, message := range member.messages(t) {
		if control, ok := message.(wire.BlokControl); ok {
			return control.Tag
		}
	}
	t.Fatal("no control frame")
	return wire.Tag{}
}

// sendOperation is C# Operation: a v2 write under the member's lineage.
func sendOperation(t *testing.T, membership collab.Membership, member *fakeMember, operationID string, update []byte) {
	t.Helper()
	frame := syncFrame(t, wire.Operation{Lineage: controlTag(t, member).Lineage, OperationID: operationID, Update: update})
	if err := membership.Receive(context.Background(), frame); err != nil {
		t.Fatal(err)
	}
}

// probeStep2 joins a read-only probe, asks with vector and answers the
// room's SyncStep2 update.
func probeStep2(t *testing.T, manager *Manager, doc string, vector []byte) []byte {
	t.Helper()
	probe := &fakeMember{source: collab.SourceClientV1}
	result, err := manager.Join(context.Background(), doc, probe)
	if err != nil || result.Status != collab.JoinJoined {
		t.Fatalf("probe join = %v, %v", result.Status, err)
	}
	if err := result.Membership.Receive(context.Background(), syncFrame(t, wire.SyncStep1{StateVector: vector})); err != nil {
		t.Fatal(err)
	}
	result.Membership.Leave()
	for _, message := range probe.messages(t) {
		if step2, ok := message.(wire.SyncStep2); ok {
			return step2.Update
		}
	}
	t.Fatal("the probe got no SyncStep2")
	return nil
}

// syncedClient is C# SyncedClientAsync: a client doc holding the room's
// state, checked against expected.
func syncedClient(t *testing.T, manager *Manager, doc, expected string) *yjs.Doc {
	t.Helper()
	client := newClient()
	if _, err := client.ApplyUpdate(probeStep2(t, manager, doc, client.EncodeStateVector())); err != nil {
		t.Fatal(err)
	}
	if got := docText(client); got != expected {
		t.Fatalf("the synced client reads %q, want %q", got, expected)
	}
	return client
}

// exportedText is C# ExportedTextAsync.
func exportedText(t *testing.T, manager *Manager, doc string) string {
	t.Helper()
	replica := newClient()
	if _, err := replica.ApplyUpdate(probeStep2(t, manager, doc, []byte{0})); err != nil {
		t.Fatal(err)
	}
	return docText(replica)
}

func strPtr(s string) *string { return &s }

func versionOf(save recordedSave) string {
	if save.version == nil {
		return "<nil>"
	}
	return *save.version
}

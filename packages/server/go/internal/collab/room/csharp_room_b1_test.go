package room

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/docendpoint"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/wire"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsruntime"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

// Twins of C# CollabRoomTests cases that had no Go twin.

// rb1Host is the harness endpoint plus C#'s LoadFailure and NextSaveFailure.
// Its fields sit under the embedded endpoint's mu.
type rb1Host struct {
	*fakeEndpoint
	loadFailure     error
	nextSaveFailure error
}

func (h *rb1Host) failLoads(err error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.loadFailure = err
}

func (h *rb1Host) failNextSave(err error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.nextSaveFailure = err
}

func (h *rb1Host) saveFailurePending() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.nextSaveFailure != nil
}

func (h *rb1Host) echoes() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.echoesSaves = true
}

func (h *rb1Host) Load(ctx context.Context, doc string) (*docendpoint.Loaded, error) {
	h.mu.Lock()
	h.loads++
	// Ungated, counted and answered in one step, so a test that sees the
	// count knows which record the load read.
	if gate := h.loadGate; gate != nil {
		h.mu.Unlock()
		select {
		case <-gate:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		h.mu.Lock()
	}
	defer h.mu.Unlock()
	if h.loadFailure != nil {
		return nil, h.loadFailure
	}
	return h.answerLocked(doc)
}

// Save is C# FakeDocEndpoint.SaveAsync: recorded, gated, then a pending
// failure, and only a save that completed is echoed into the record.
func (h *rb1Host) Save(ctx context.Context, doc string, outputData any, version *string, projection *docendpoint.Projection) (*string, error) {
	encoded, err := docendpoint.Serialize(outputData)
	if err != nil {
		return nil, err
	}
	data := string(encoded)
	h.mu.Lock()
	h.saves = append(h.saves, recordedSave{doc: doc, data: data, version: version, projection: projection})
	gate := h.saveGate
	h.mu.Unlock()
	if gate != nil {
		select {
		case <-gate:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if failure := h.nextSaveFailure; failure != nil {
		h.nextSaveFailure = nil
		return nil, failure
	}
	answer := h.nextSaveVersion
	h.nextSaveVersion = nil
	if h.echoesSaves {
		parsed, err := jsjson.ParseNode([]byte(data), jsjson.Options{MaxDepth: 64})
		if err != nil {
			return nil, err
		}
		kept := version
		if answer != nil {
			kept = answer
		}
		h.documents[doc] = &docendpoint.Loaded{Data: parsed, Version: kept}
	}
	return answer, nil
}

// rb1Knob is the text converter with C#'s ExportFailure.
type rb1Knob struct {
	*textConverter
	mu            sync.Mutex
	exportFailure error
}

func (k *rb1Knob) failExports(err error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.exportFailure = err
}

func (k *rb1Knob) Export(ctx context.Context, doc *yjs.Doc) (*jsjson.Object, error) {
	k.mu.Lock()
	failure := k.exportFailure
	k.mu.Unlock()
	if failure != nil {
		k.exports.Add(1)
		return nil, failure
	}
	return k.textConverter.Export(ctx, doc)
}

type rb1Kit struct {
	*textRoom
	host *rb1Host
	knob *rb1Knob
}

func rb1NewKit() *rb1Kit {
	r := newTextRoom()
	return &rb1Kit{textRoom: r, host: &rb1Host{fakeEndpoint: r.endpoint}, knob: &rb1Knob{textConverter: r.converter}}
}

// build is C# CreateManager / CreateJournalManager; a nil converter is the
// text converter.
func (k *rb1Kit) build(t *testing.T, o Options, journalled bool, converter Converter) *Manager {
	t.Helper()
	if o.Now == nil {
		o.Now = k.clock.Now
	}
	if converter == nil {
		converter = k.knob
	}
	var operations OperationStore
	if journalled {
		operations = k.operations
	}
	manager := NewManager(ManagerOptions{
		Store: k.store, Endpoint: k.host, Converter: converter, Room: o, Log: k.logf, Operations: operations,
	})
	t.Cleanup(func() { _ = manager.Drain(context.Background()) })
	return manager
}

func (k *rb1Kit) committed() int { return len(k.operations.Committed(testDoc)) }

// gateSaves holds every save until the answer is called. Call it after the
// manager is built: cleanups run last-in first, so the gate opens before
// the drain that would wait on it.
func (k *rb1Kit) gateSaves(t *testing.T) func() {
	gate := make(chan struct{})
	k.host.setSaveGate(gate)
	var once sync.Once
	open := func() {
		once.Do(func() {
			k.host.setSaveGate(nil)
			close(gate)
		})
	}
	t.Cleanup(open)
	return open
}

func (k *rb1Kit) gateLoads(t *testing.T) func() {
	gate := make(chan struct{})
	k.host.setLoadGate(gate)
	var once sync.Once
	open := func() {
		once.Do(func() {
			k.host.setLoadGate(nil)
			close(gate)
		})
	}
	t.Cleanup(open)
	return open
}

func rb1Quick() Options {
	return OptionsWith(func(ro *Options) {
		ro.ExportDebounce = 10 * time.Millisecond
		ro.ExportMaxDelay = 10 * time.Millisecond
		ro.EvictionLinger = 150 * time.Millisecond
		ro.RetryBackoff = 10 * time.Millisecond
		ro.RetryBackoffCap = 10 * time.Millisecond
		ro.CommitTimeout = 5 * time.Second
	})
}

func rb1Threshold(operations int64) Options {
	o := rb1Quick()
	o.CheckpointOperationThreshold = operations
	return o
}

func rb1V1(write bool) *fakeMember { return &fakeMember{source: collab.SourceClientV1, write: write} }

func rb1V2(actor string, write bool) *fakeMember {
	return &fakeMember{actor: actor, source: collab.SourceClientV2, write: write}
}

// rb1Enter is C# Join, answering the lineage the room announced, which a
// later clear would lose.
func rb1Enter(t *testing.T, manager *Manager, member *fakeMember) (collab.Membership, string) {
	t.Helper()
	var membership collab.Membership
	if member.source == collab.SourceClientV2 {
		membership = joinSynced(t, manager, testDoc, member)
	} else {
		membership = join(t, manager, testDoc, member)
	}
	return membership, controlTag(t, member).Lineage
}

func rb1Op(t *testing.T, membership collab.Membership, lineage, operationID string, update []byte) {
	t.Helper()
	frame := syncFrame(t, wire.Operation{Lineage: lineage, OperationID: operationID, Update: update})
	if err := membership.Receive(context.Background(), frame); err != nil {
		t.Fatal(err)
	}
}

func rb1Leave(manager *Manager, membership collab.Membership) {
	membership.Leave()
	manager.Settle()
}

func rb1Evicted(t *testing.T, manager *Manager, what string) {
	t.Helper()
	waitUntil(t, what, func() bool { return manager.LiveRoomCount() == 0 })
}

// rb1RunTimers runs every debounce, retry and linger window past its end.
func rb1RunTimers(manager *Manager) {
	for range 5 {
		time.Sleep(30 * time.Millisecond)
		manager.Settle()
	}
}

func rb1Appending(t *testing.T, id, text string) convert.EditOp {
	t.Helper()
	return convert.Insert{ID: id, Block: node(t, `{"id":"`+id+`","type":"paragraph","data":`+textJSON(t, text)+`}`)}
}

func rb1AppendingSegments(t *testing.T, id, text string) convert.EditOp {
	t.Helper()
	return convert.Insert{ID: id, Block: node(t, `{"id":"`+id+`","type":"paragraph","data":{"text":[`+textJSON(t, text)+`]}}`)}
}

func rb1EditWith(t *testing.T, manager *Manager, ops []convert.EditOp, operationID string, expect *Precondition) EditResult {
	t.Helper()
	digest, err := convert.CanonicalBodyDigest(ops)
	if err != nil {
		t.Fatal(err)
	}
	result, err := manager.Edit(context.Background(), testDoc, ops, operationID, digest, "", expect)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

// rb1Edit is C# HttpEdit: block id b-{text}, the digest the canonical body.
func rb1Edit(t *testing.T, manager *Manager, operationID, text string, expect *Precondition) EditResult {
	t.Helper()
	return rb1EditWith(t, manager, []convert.EditOp{rb1Appending(t, "b-"+text, text)}, operationID, expect)
}

var rb1NextID atomic.Uint64

// rb1EditOps is C# EditAsync(doc, ops): a fresh operation id.
func rb1EditOps(t *testing.T, manager *Manager, ops ...convert.EditOp) EditResult {
	t.Helper()
	return rb1EditWith(t, manager, ops, fmt.Sprintf("%032x", 0xabc00000+rb1NextID.Add(1)), nil)
}

func rb1Rejection(t *testing.T, member *fakeMember) wire.Rejection {
	t.Helper()
	messages := member.messages(t)
	if len(messages) != 1 {
		t.Fatalf("got %d frames, want one rejection: %#v", len(messages), messages)
	}
	rejection, ok := messages[0].(wire.Rejection)
	if !ok {
		t.Fatalf("got %#v, want a rejection", messages[0])
	}
	return rejection
}

func rb1ClosedOnce(t *testing.T, member *fakeMember, manager *Manager) {
	t.Helper()
	if closes := member.closed(); len(closes) != 1 || closes[0] != collab.CloseCommitUnavailable {
		t.Fatalf("closes = %v, want one CommitUnavailable", closes)
	}
	if got := manager.LiveRoomCount(); got != 0 {
		t.Fatalf("%d live rooms, want 0", got)
	}
}

// rb1OneOperation is a writer that has committed one operation: the C#
// setup most checkpoint cases start from.
func rb1OneOperation(t *testing.T, k *rb1Kit, o Options) (*Manager, *fakeMember, collab.Membership, string, *yjs.Doc) {
	t.Helper()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.build(t, o, true, nil)
	writer := rb1V2("", true)
	membership, lineage := rb1Enter(t, manager, writer)
	client := syncedClient(t, manager, testDoc, "hello")
	rb1Op(t, membership, lineage, opOne, updateAppending(client, "!"))
	return manager, writer, membership, lineage, client
}

func rb1Through(t *testing.T, k *rb1Kit) uint64 {
	t.Helper()
	published := k.operations.Checkpoint(testDoc)
	if published == nil {
		t.Fatal("no checkpoint was published")
	}
	return published.Through
}

func rb1RichConverter(t *testing.T, k *rb1Kit) Converter {
	return &convert.DocConverter{Now: k.clock.Now, HTML: runtimeReader(t)}
}

// rb1FailingHTML is C# FailingHtmlReader.
type rb1FailingHTML struct{ err error }

func (r rb1FailingHTML) Read(context.Context, []convert.RichTextHTML, *time.Duration) ([][]any, error) {
	return nil, r.err
}

// rb1DefaultTimeoutTooShort is C# DefaultTimeoutTooShortReader: a read
// under the runtime's default timeout (0) runs out of time.
type rb1DefaultTimeoutTooShort struct{}

func (rb1DefaultTimeoutTooShort) Read(_ context.Context, fields []convert.RichTextHTML, timeout *time.Duration) ([][]any, error) {
	if timeout == nil {
		return nil, rb1RuntimeFailure(jsruntime.KindTimedOut)
	}
	read := make([][]any, len(fields))
	for i := range read {
		read[i] = []any{}
	}
	return read, nil
}

func rb1RuntimeFailure(kind jsruntime.Kind) error {
	return &jsruntime.Failure{Kind: kind, Err: errors.New("the runtime stopped")}
}

func rb1FailingConverter(k *rb1Kit, err error) Converter {
	return &convert.DocConverter{Now: k.clock.Now, HTML: rb1FailingHTML{err: err}}
}

func rb1Lookup(t *testing.T, value any, key string) any {
	t.Helper()
	object, ok := value.(*jsjson.Object)
	if !ok {
		t.Fatalf("%#v is not an object", value)
	}
	found, _ := object.Get(jsjson.FromString(key))
	return found
}

func rb1SaveBlocks(t *testing.T, save recordedSave) []any {
	t.Helper()
	parsed, err := jsjson.Parse([]byte(save.data))
	if err != nil {
		t.Fatal(err)
	}
	blocks, ok := rb1Lookup(t, parsed, "blocks").([]any)
	if !ok {
		t.Fatalf("the save has no blocks: %s", save.data)
	}
	return blocks
}

// rb1ServerStateVector is C# ServerStateVectorAsync: the SyncStep1 the room
// answers a probe with.
func rb1ServerStateVector(t *testing.T, manager *Manager, client *yjs.Doc) []byte {
	t.Helper()
	probe := rb1V1(false)
	membership := join(t, manager, testDoc, probe)
	if err := membership.Receive(context.Background(), syncFrame(t, wire.SyncStep1{StateVector: client.EncodeStateVector()})); err != nil {
		t.Fatal(err)
	}
	rb1Leave(manager, membership)
	for _, message := range probe.messages(t) {
		if step1, ok := message.(wire.SyncStep1); ok {
			return step1.StateVector
		}
	}
	t.Fatal("the probe got no SyncStep1")
	return nil
}

func TestAColdRoomLoadedByAReusedKeyConflictIsStillEvicted(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.build(t, rb1Quick(), true, nil)
	rb1Edit(t, manager, opOne, "!", nil)
	rb1Evicted(t, manager, "the first room to be evicted")

	conflict := rb1Edit(t, manager, opOne, "different", nil)

	if conflict.Status != EditConflict {
		t.Fatalf("status = %v, want Conflict", conflict.Status)
	}
	if got := manager.LiveRoomCount(); got != 1 {
		t.Fatalf("%d live rooms, want 1", got)
	}
	rb1Evicted(t, manager, "the conflict's room to be evicted")
}

func TestAStaleEditPreconditionIsRefusedWithTheHeadAndNothingApplied(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.build(t, rb1Quick(), true, nil)
	first := rb1Edit(t, manager, opOne, "!", nil)
	if first.Receipt == nil {
		t.Fatal("no receipt")
	}
	head := *first.Receipt
	observer := rb1V1(true)
	join(t, manager, testDoc, observer)
	observer.clear()

	staleSequence := rb1Edit(t, manager, opTwo, "?", &Precondition{Lineage: head.Tag.Lineage, Sequence: 0})
	otherLineage := rb1Edit(t, manager, opThree, "?", &Precondition{Lineage: rb1ZeroLineage, Sequence: head.ServerSequence})

	for _, result := range []EditResult{staleSequence, otherLineage} {
		if result.Status != EditPreconditionFailed {
			t.Fatalf("status = %v, want PreconditionFailed", result.Status)
		}
		if result.Receipt == nil || *result.Receipt != head {
			t.Fatalf("receipt = %+v, want %+v", result.Receipt, head)
		}
	}
	if got := k.committed(); got != 1 {
		t.Fatalf("%d committed, want 1", got)
	}
	if messages := observer.messages(t); len(messages) != 0 {
		t.Fatalf("the observer got %#v", messages)
	}
	if got := exportedText(t, manager, testDoc); got != "hello!" {
		t.Fatalf("text = %q", got)
	}
}

const rb1ZeroLineage = "00000000000000000000000000000000"

func TestAMatchingEditPreconditionAppliesAtTheNextSequence(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.build(t, rb1Quick(), true, nil)
	first := rb1Edit(t, manager, opOne, "!", nil)
	if first.Receipt == nil {
		t.Fatal("no receipt")
	}
	head := *first.Receipt

	result := rb1Edit(t, manager, opTwo, "?", &Precondition{Lineage: head.Tag.Lineage, Sequence: head.ServerSequence})

	if result.Status != EditApplied {
		t.Fatalf("status = %v (%v)", result.Status, result.Err)
	}
	if want := (Receipt{Tag: head.Tag, ServerSequence: 2}); result.Receipt == nil || *result.Receipt != want {
		t.Fatalf("receipt = %+v, want %+v", result.Receipt, want)
	}
	if got := exportedText(t, manager, testDoc); got != "hello!?" {
		t.Fatalf("text = %q", got)
	}
}

func TestACommittedKeyReplaysItsReceiptEvenWhenItsPreconditionIsNowStale(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.build(t, rb1Quick(), true, nil)
	original := rb1Edit(t, manager, opOne, "!", nil)
	rb1Edit(t, manager, opTwo, "?", nil)
	if original.Receipt == nil {
		t.Fatal("no receipt")
	}

	replay := rb1Edit(t, manager, opOne, "!", &Precondition{Lineage: original.Receipt.Tag.Lineage, Sequence: 0})

	if replay.Status != EditApplied {
		t.Fatalf("status = %v (%v)", replay.Status, replay.Err)
	}
	if replay.Receipt == nil || *replay.Receipt != *original.Receipt {
		t.Fatalf("receipt = %+v, want %+v", replay.Receipt, original.Receipt)
	}
	if got := k.committed(); got != 2 {
		t.Fatalf("%d committed, want 2", got)
	}
}

func TestAnEditPreconditionWithoutAJournalIsRefusedBeforeTheRoomLoads(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.build(t, rb1Quick(), false, nil)

	result := rb1Edit(t, manager, opOne, "!", &Precondition{Lineage: rb1ZeroLineage, Sequence: 0})

	if result.Status != EditPreconditionRequired {
		t.Fatalf("status = %v", result.Status)
	}
	if got := k.host.Loads(); got != 0 {
		t.Fatalf("%d loads, want 0", got)
	}
	if got := manager.LiveRoomCount(); got != 0 {
		t.Fatalf("%d live rooms, want 0", got)
	}
}

func TestAColdRoomLoadedByAFailedPreconditionIsStillEvicted(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.build(t, rb1Quick(), true, nil)

	result := rb1Edit(t, manager, opOne, "!", &Precondition{Lineage: rb1ZeroLineage, Sequence: 0})

	if result.Status != EditPreconditionFailed {
		t.Fatalf("status = %v", result.Status)
	}
	if got := manager.LiveRoomCount(); got != 1 {
		t.Fatalf("%d live rooms, want 1", got)
	}
	rb1Evicted(t, manager, "the room to be evicted")
}

func TestAnEditIsRefusedWhileAnotherProcessHoldsTheDocument(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", nil)
	outcome, held, err := k.operations.Open(context.Background(), testDoc)
	if err != nil || outcome != journal.Opened {
		t.Fatalf("open = %v, %v", outcome, err)
	}
	manager := k.build(t, rb1Quick(), true, nil)

	refused := rb1EditOps(t, manager, rb1Appending(t, "b-1", "x"))

	if refused.Status != EditUnavailable {
		t.Fatalf("status = %v, want Unavailable", refused.Status)
	}
	if got := k.host.Loads(); got != 0 {
		t.Fatalf("%d loads, want 0", got)
	}
	if got := manager.LiveRoomCount(); got != 0 {
		t.Fatalf("%d live rooms, want 0", got)
	}

	if err := held.Close(); err != nil {
		t.Fatal(err)
	}
	if result := rb1EditOps(t, manager, rb1Appending(t, "b-1", "x")); result.Status != EditApplied {
		t.Fatalf("after the close: status = %v (%v)", result.Status, result.Err)
	}
}

func TestAReadOnlyMembersOperationIsRejectedWithoutJournalling(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.build(t, rb1Quick(), true, nil)
	reader := rb1V2("", false)
	membership, lineage := rb1Enter(t, manager, reader)
	client := syncedClient(t, manager, testDoc, "hello")
	update := updateAppending(client, " hacked")
	reader.clear()

	rb1Op(t, membership, lineage, opOne, update)

	if got := rb1Rejection(t, reader).Code; got != "read-only" {
		t.Fatalf("code = %q", got)
	}
	if got := k.committed(); got != 0 {
		t.Fatalf("%d committed", got)
	}
	if got := exportedText(t, manager, testDoc); got != "hello" {
		t.Fatalf("text = %q", got)
	}
}

func TestAnOperationFromAnotherLineageIsRejectedWithoutJournalling(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.build(t, rb1Quick(), true, nil)
	writer := rb1V2("", true)
	membership, _ := rb1Enter(t, manager, writer)
	client := syncedClient(t, manager, testDoc, "hello")
	update := updateAppending(client, "!")
	writer.clear()

	rb1Op(t, membership, tagLineage, opOne, update)

	rejection := rb1Rejection(t, writer)
	if rejection.Code != "lineage-mismatch" || rejection.Lineage != tagLineage {
		t.Fatalf("rejection = %+v", rejection)
	}
	if got := k.committed(); got != 0 {
		t.Fatalf("%d committed", got)
	}
	if got := exportedText(t, manager, testDoc); got != "hello" {
		t.Fatalf("text = %q", got)
	}
}

func TestAnUnusableOperationUpdateIsRejectedWithoutJournalling(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.build(t, rb1Quick(), true, nil)
	writer := rb1V2("", true)
	membership, lineage := rb1Enter(t, manager, writer)
	writer.clear()

	rb1Op(t, membership, lineage, opOne, []byte{0xde, 0xad, 0xbe, 0xef, 0x01})

	if got := rb1Rejection(t, writer).Code; got != "invalid-update" {
		t.Fatalf("code = %q", got)
	}
	if got := k.committed(); got != 0 {
		t.Fatalf("%d committed", got)
	}
	if closes := writer.closed(); len(closes) != 0 {
		t.Fatalf("closes = %v", closes)
	}
}

func TestOperationAckDoesNotWaitForJsonProjection(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.build(t, rb1Quick(), true, nil)
	k.gateSaves(t)
	writer := rb1V2("", true)
	membership, lineage := rb1Enter(t, manager, writer)
	client := syncedClient(t, manager, testDoc, "hello")
	writer.clear()

	rb1Op(t, membership, lineage, opOne, updateAppending(client, "!"))

	var ack *wire.Acknowledgement
	for _, message := range writer.messages(t) {
		if found, ok := message.(wire.Acknowledgement); ok {
			ack = &found
		}
	}
	if ack == nil || ack.ServerSequence != 1 {
		t.Fatalf("ack = %+v, want sequence 1", ack)
	}
	time.Sleep(100 * time.Millisecond)
	manager.Settle()

	if saves := k.host.Saves(); len(saves) != 0 {
		t.Fatalf("saves = %+v", saves)
	}
	if got := k.committed(); got != 1 {
		t.Fatalf("%d committed", got)
	}
}

func TestEditsDoNotScheduleAWholeJsonPutPerDebounceWindow(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.build(t, rb1Quick(), true, nil)
	writer := rb1V2("", true)
	membership, lineage := rb1Enter(t, manager, writer)
	client := syncedClient(t, manager, testDoc, "hello")

	for _, id := range []string{opOne, opTwo, opThree} {
		rb1Op(t, membership, lineage, id, updateAppending(client, "!"))
		time.Sleep(50 * time.Millisecond)
		manager.Settle()
	}

	if got := k.converter.exports.Load(); got != 0 {
		t.Fatalf("%d exports, want 0", got)
	}
	if saves := k.host.Saves(); len(saves) != 0 {
		t.Fatalf("saves = %+v", saves)
	}
	if got := k.committed(); got != 3 {
		t.Fatalf("%d committed", got)
	}
}

func TestPublishedCheckpointSchedulesOneProjection(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.build(t, rb1Quick(), true, nil)
	open := k.gateSaves(t)
	writer := rb1V2("", true)
	membership, lineage := rb1Enter(t, manager, writer)
	client := syncedClient(t, manager, testDoc, "hello")
	rb1Op(t, membership, lineage, opOne, updateAppending(client, "!"))

	if !checkpoint(t, manager) {
		t.Fatal("the checkpoint was not published")
	}
	waitUntil(t, "the projection the checkpoint earned", func() bool { return len(k.host.Saves()) == 1 })

	rb1Op(t, membership, lineage, opTwo, updateAppending(client, "?"))
	open()
	rb1RunTimers(manager)

	if got := k.converter.exports.Load(); got != 1 {
		t.Fatalf("%d exports, want 1", got)
	}
	if saves := k.host.Saves(); len(saves) != 1 || saves[0].data != `{"text":"hello!"}` {
		t.Fatalf("saves = %+v, want one of hello!", saves)
	}
	if got := rb1Through(t, k); got != 1 {
		t.Fatalf("checkpoint through %d, want 1", got)
	}
}

func TestAReloadedJournalRoomStillServesWhenTheEndpointIsDown(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.build(t, rb1Quick(), true, nil)
	first, lineage := rb1Enter(t, manager, rb1V2("", true))
	client := syncedClient(t, manager, testDoc, "hello")
	rb1Op(t, first, lineage, opOne, updateAppending(client, " world"))
	rb1Leave(manager, first)
	rb1Evicted(t, manager, "the seeded room to be evicted")
	k.host.failLoads(&docendpoint.Error{Message: "collab: the doc endpoint GET returned 503.", StatusCode: 503})

	rejoined, err := manager.Join(context.Background(), testDoc, rb1V2("", true))

	if err != nil || rejoined.Status != collab.JoinJoined {
		t.Fatalf("join = %v, %v", rejoined.Status, err)
	}
	if got := exportedText(t, manager, testDoc); got != "hello world" {
		t.Fatalf("text = %q", got)
	}
	waitUntil(t, "the version read to report its failure", func() bool {
		return k.logged("could not read the document version")
	})
}

// rb1NullSeedReopensWithOneEmptyPut is the shared tail of the two null-seed
// cases: nothing PUT for the first room, one empty PUT on the reopen.
func rb1NullSeedReopensWithOneEmptyPut(t *testing.T, k *rb1Kit, manager *Manager, lineage string) {
	t.Helper()
	rb1RunTimers(manager)
	rb1Evicted(t, manager, "the first room to be evicted")
	if saves := k.host.Saves(); len(saves) != 0 {
		t.Fatalf("saves after the first room = %+v", saves)
	}

	reopened, _ := rb1Enter(t, manager, rb1V2("", true))
	rb1Leave(manager, reopened)
	waitUntil(t, "the reopen PUT", func() bool { return len(k.host.Saves()) > 0 })
	rb1RunTimers(manager)
	rb1Evicted(t, manager, "the reopened room to be evicted")

	if got := k.host.Loads(); got != 2 {
		t.Fatalf("%d loads, want 2", got)
	}
	saves := k.host.Saves()
	if len(saves) != 1 {
		t.Fatalf("saves = %+v, want one", saves)
	}
	if blocks := rb1SaveBlocks(t, saves[0]); len(blocks) != 0 {
		t.Fatalf("blocks = %v, want none", blocks)
	}
	if saves[0].version != nil {
		t.Fatalf("version = %q, want none", *saves[0].version)
	}
	if want := (docendpoint.Projection{Lineage: lineage, ServerSequence: 0}); saves[0].projection == nil || *saves[0].projection != want {
		t.Fatalf("projection = %+v, want %+v", saves[0].projection, want)
	}
}

func TestUnderAJournalANullSeedPutsNothingAndItsReopenPutsOneEmptyDocument(t *testing.T) {
	k := rb1NewKit()
	k.host.HoldsNothing(testDoc, nil)
	manager := k.build(t, rb1Quick(), true, rb1RichConverter(t, k))
	first, _ := rb1Enter(t, manager, rb1V2("", true))
	head := k.operations.Head(testDoc)
	if head == nil {
		t.Fatal("no journal head")
	}
	rb1Leave(manager, first)

	rb1NullSeedReopensWithOneEmptyPut(t, k, manager, head.Lineage)
}

func TestASeedReadsItsHtmlWithTheOneTimeBudget(t *testing.T) {
	k := rb1NewKit()
	k.host.HoldsDocument(t, testDoc, `{"blocks":[{"id":"b1","type":"paragraph","data":{"text":"<b>large</b>"}}]}`, nil)
	manager := k.build(t, rb1Quick(), false, &convert.DocConverter{Now: k.clock.Now, HTML: rb1DefaultTimeoutTooShort{}})

	result, err := manager.Join(context.Background(), testDoc, rb1V1(true))

	if err != nil || result.Status != collab.JoinJoined {
		t.Fatalf("join = %v, %v (%v)", result.Status, err, result.Err)
	}
}

// rb1PoisonFormattedText is C# YDocConverterRichTextTests.PoisonFormattedText:
// between "a" and "b", a malformed equation embed, an "x" with a non-string
// tag attribute and a non-string color, and a page embed whose id is not a
// string.
func rb1PoisonFormattedText(t *testing.T, doc *yjs.Doc, blockID string) {
	t.Helper()
	block, _ := doc.GetMap(jsjson.FromString("blocks")).Get(jsjson.FromString(blockID))
	blockMap, ok := block.(*yjs.Map)
	if !ok {
		t.Fatalf("block %q is %T, not a map", blockID, block)
	}
	data, _ := blockMap.Get(jsjson.FromString("data"))
	dataMap, ok := data.(*yjs.Map)
	if !ok {
		t.Fatalf("the block data is %T, not a map", data)
	}
	value, _ := dataMap.Get(jsjson.FromString("text"))
	text, ok := value.(*yjs.XmlText)
	if !ok {
		t.Fatalf("the block text is %T, not a YXmlText", value)
	}
	object := func(entries ...any) *jsjson.Object {
		o := &jsjson.Object{}
		for i := 0; i < len(entries); i += 2 {
			o.Set(jsjson.FromString(entries[i].(string)), entries[i+1])
		}
		return o
	}
	marks := object("color", object(), "tag:b", object("x", 1.0))
	badEquation := object("equation", object("expression", 5.0))
	badPage := object("page", object("id", object()))
	doc.Transact(func(tx *yjs.Transaction) {
		text.InsertEmbed(tx, 1, badEquation, object())
		text.Insert(tx, 2, jsjson.FromString("x"), marks)
		text.InsertEmbed(tx, 3, badPage, object())
	})
}

func TestMalformedRichTextFromTheHostOrAPeerKeepsTheRoomExportable(t *testing.T) {
	k := rb1NewKit()
	k.host.HoldsDocument(t, testDoc, `{"blocks":[
	  {"id":"b1","type":"paragraph","data":{"text":[{"text":"ab"}]}},
	  {"id":"b2","type":"paragraph","data":{"text":[
	    {"text":"c","marks":{"tag:b":{"x":1},"color":{}}},
	    {"embed":{"equation":null}}
	  ]}}
	]}`, nil)
	manager := k.build(t, rb1Quick(), false, rb1RichConverter(t, k))
	writer := rb1V1(true)
	membership, _ := rb1Enter(t, manager, writer)
	client := newClient()
	if _, err := client.ApplyUpdate(probeStep2(t, manager, testDoc, client.EncodeStateVector())); err != nil {
		t.Fatal(err)
	}
	before := client.EncodeStateVector()

	rb1PoisonFormattedText(t, client, "b1")
	diff, err := client.EncodeStateAsUpdate(before)
	if err != nil {
		t.Fatal(err)
	}
	if err := membership.Receive(context.Background(), syncFrame(t, wire.SyncUpdate{Update: diff})); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, "the export", func() bool { return len(k.host.Saves()) > 0 })

	saves := k.host.Saves()
	blocks := rb1SaveBlocks(t, saves[len(saves)-1])
	textOf := func(block any) string {
		encoded, err := jsjson.Stringify(rb1Lookup(t, rb1Lookup(t, block, "data"), "text"))
		if err != nil {
			t.Fatal(err)
		}
		return encoded
	}
	if len(blocks) != 2 {
		t.Fatalf("blocks = %v", blocks)
	}
	if got, want := textOf(blocks[0]), `[{"text":"a"},{"text":"x","marks":{"tag:b":{}}},{"text":"b"}]`; got != want {
		t.Fatalf("b1 text = %s, want %s", got, want)
	}
	if got, want := textOf(blocks[1]), `[{"text":"c","marks":{"tag:b":{}}}]`; got != want {
		t.Fatalf("b2 text = %s, want %s", got, want)
	}

	edit := rb1EditOps(t, manager, convert.Update{ID: "b1", Data: node(t, `{"text":[{"text":"abc"}]}`)})

	if edit.Status != EditApplied {
		t.Fatalf("edit = %v (%v)", edit.Status, edit.Err)
	}
	if closes := writer.closed(); len(closes) != 0 {
		t.Fatalf("closes = %v", closes)
	}
}

func TestUnderAJournalAnHtmlReaderFailureRefusesTheEditAndKeepsTheRoom(t *testing.T) {
	k := rb1NewKit()
	k.host.HoldsNothing(testDoc, nil)
	manager := k.build(t, rb1Quick(), true, rb1FailingConverter(k, errors.New("the runtime took too long")))
	writer := rb1V2("", true)
	rb1Enter(t, manager, writer)

	result := rb1EditOps(t, manager, rb1Appending(t, "b-1", "<b>x</b>"))

	if result.Status != EditInvalid {
		t.Fatalf("status = %v (%v), want Invalid", result.Status, result.Err)
	}
	if closes := writer.closed(); len(closes) != 0 {
		t.Fatalf("closes = %v", closes)
	}
	if got := k.committed(); got != 0 {
		t.Fatalf("%d committed", got)
	}
}

func TestUnderAJournalAnHtmlReadPastTheRuntimesLimitsIsOverloadedAndKeepsTheRoom(t *testing.T) {
	k := rb1NewKit()
	k.host.HoldsNothing(testDoc, nil)
	manager := k.build(t, rb1Quick(), true, rb1FailingConverter(k, rb1RuntimeFailure(jsruntime.KindTimedOut)))
	writer := rb1V2("", true)
	rb1Enter(t, manager, writer)

	result := rb1EditOps(t, manager, rb1Appending(t, "b-1", "<b>x</b>"))
	next := rb1EditOps(t, manager, rb1AppendingSegments(t, "b-2", "y"))

	if result.Status != EditOverloaded {
		t.Fatalf("status = %v (%v), want Overloaded", result.Status, result.Err)
	}
	var transient *convert.TransientError
	var failure *jsruntime.Failure
	if !errors.As(result.Err, &transient) || !errors.As(transient.Err, &failure) {
		t.Fatalf("err = %#v, want a transient error over the runtime failure", result.Err)
	}
	if closes := writer.closed(); len(closes) != 0 {
		t.Fatalf("closes = %v", closes)
	}
	if next.Status != EditApplied {
		t.Fatalf("next = %v (%v)", next.Status, next.Err)
	}
	if got := k.committed(); got != 1 {
		t.Fatalf("%d committed, want 1", got)
	}
}

func TestOnAWorkingCopyAnHtmlReadPastTheRuntimesLimitsIsOverloadedAndKeepsTheRoom(t *testing.T) {
	k := rb1NewKit()
	k.host.HoldsNothing(testDoc, nil)
	manager := k.build(t, rb1Quick(), false, rb1FailingConverter(k, rb1RuntimeFailure(jsruntime.KindTimedOut)))
	writer := rb1V1(true)
	rb1Enter(t, manager, writer)

	result := rb1EditOps(t, manager, rb1Appending(t, "b-1", "<b>x</b>"))
	next := rb1EditOps(t, manager, rb1AppendingSegments(t, "b-2", "y"))

	if result.Status != EditOverloaded {
		t.Fatalf("status = %v (%v), want Overloaded", result.Status, result.Err)
	}
	if closes := writer.closed(); len(closes) != 0 {
		t.Fatalf("closes = %v", closes)
	}
	if next.Status != EditApplied {
		t.Fatalf("next = %v (%v)", next.Status, next.Err)
	}
}

func TestAnHtmlReadPastTheAllocationBudgetIsTooLargeAndKeepsTheRoom(t *testing.T) {
	for _, journalled := range []bool{true, false} {
		t.Run(fmt.Sprint(journalled), func(t *testing.T) {
			k := rb1NewKit()
			k.host.HoldsNothing(testDoc, nil)
			manager := k.build(t, rb1Quick(), journalled, rb1FailingConverter(k, rb1RuntimeFailure(jsruntime.KindDocumentTooLarge)))
			writer := rb1V1(true)
			if journalled {
				writer = rb1V2("", true)
			}
			rb1Enter(t, manager, writer)

			result := rb1EditOps(t, manager, rb1Appending(t, "b-1", "<b>x</b>"))
			next := rb1EditOps(t, manager, rb1AppendingSegments(t, "b-2", "y"))

			if result.Status != EditTooLarge {
				t.Fatalf("status = %v (%v), want TooLarge", result.Status, result.Err)
			}
			if closes := writer.closed(); len(closes) != 0 {
				t.Fatalf("closes = %v", closes)
			}
			if next.Status != EditApplied {
				t.Fatalf("next = %v (%v)", next.Status, next.Err)
			}
		})
	}
}

func TestAJavaScriptErrorReadingAnEditsHtmlStaysARefusal(t *testing.T) {
	k := rb1NewKit()
	k.host.HoldsNothing(testDoc, nil)
	manager := k.build(t, rb1Quick(), true, rb1FailingConverter(k, rb1RuntimeFailure(jsruntime.KindInvalidDocument)))
	rb1Enter(t, manager, rb1V2("", true))

	result := rb1EditOps(t, manager, rb1Appending(t, "b-1", "<b>x</b>"))

	if result.Status != EditInvalid {
		t.Fatalf("status = %v (%v), want Invalid", result.Status, result.Err)
	}
}

func TestAStateExportPastTheRuntimesLimitsIsOverloaded(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.build(t, rb1Quick(), false, nil)
	rb1Enter(t, manager, rb1V1(true))
	k.knob.failExports(&convert.TransientError{
		Message: "collab: the rich text HTML could not be read",
		Err:     rb1RuntimeFailure(jsruntime.KindTimedOut),
	})

	state, err := manager.State(context.Background(), testDoc)

	if err != nil || state.Status != StateOverloaded {
		t.Fatalf("state = %v, %v; want Overloaded", state.Status, err)
	}
	if len(state.JSON) != 0 {
		t.Fatalf("json = %s, want empty", state.JSON)
	}
}

func TestAStateExportThatCanNeverBeWrittenStaysExportFailed(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.build(t, rb1Quick(), false, nil)
	rb1Enter(t, manager, rb1V1(true))
	k.knob.failExports(&journal.InvalidDataError{Message: "not JSON"})

	state, err := manager.State(context.Background(), testDoc)

	if err != nil || state.Status != StateExportFailed {
		t.Fatalf("state = %v, %v; want ExportFailed", state.Status, err)
	}
}

func TestUnderAJournalAStateReadSeedsANullDocumentAndItsReopenPutsOnce(t *testing.T) {
	k := rb1NewKit()
	k.host.HoldsNothing(testDoc, nil)
	manager := k.build(t, rb1Quick(), true, rb1RichConverter(t, k))

	state, err := manager.State(context.Background(), testDoc)

	if err != nil || state.Status != StateReady {
		t.Fatalf("state = %v, %v; want Ready", state.Status, err)
	}
	head := k.operations.Head(testDoc)
	if head == nil {
		t.Fatal("no journal head")
	}
	rb1NullSeedReopensWithOneEmptyPut(t, k, manager, head.Lineage)
}

func TestACheckpointRefusedByACorruptJournalClosesTheRoom(t *testing.T) {
	k := rb1NewKit()
	manager, writer, _, _, _ := rb1OneOperation(t, k, rb1Quick())
	k.operations.setFailCheckpoints(func(string) error {
		return &journal.InvalidDataError{Message: "collab: the journal record after sequence 1 is corrupt."}
	})

	if checkpoint(t, manager) {
		t.Fatal("a refused checkpoint was reported published")
	}

	rb1ClosedOnce(t, writer, manager)
}

func TestACheckpointSequenceTheStoreRefusesClosesTheRoom(t *testing.T) {
	k := rb1NewKit()
	manager, writer, _, _, _ := rb1OneOperation(t, k, rb1Quick())
	k.operations.setFailCheckpoints(func(string) error {
		return &journal.ArgumentError{Message: "a checkpoint must name a committed sequence at or above the published one", OutOfRange: true}
	})

	if checkpoint(t, manager) {
		t.Fatal("a refused checkpoint was reported published")
	}

	rb1ClosedOnce(t, writer, manager)
}

func TestATransientCheckpointFailureKeepsTheRoomAndIsRetried(t *testing.T) {
	k := rb1NewKit()
	manager, writer, membership, lineage, client := rb1OneOperation(t, k, rb1Quick())
	busy := func(string) error { return errors.New("the journal disk is busy") }
	k.operations.setFailCheckpoints(busy)

	for range 2 {
		if checkpoint(t, manager) {
			t.Fatal("a failed checkpoint was reported published")
		}
	}
	if closes := writer.closed(); len(closes) != 0 || manager.LiveRoomCount() != 1 {
		t.Fatalf("closes = %v, live rooms = %d", closes, manager.LiveRoomCount())
	}
	if got := k.operations.Checkpoint(testDoc); got != nil {
		t.Fatalf("checkpoint = %+v", got)
	}

	k.operations.setFailCheckpoints(nil)
	if !checkpoint(t, manager) {
		t.Fatal("the checkpoint was not published once the disk recovered")
	}
	if got := rb1Through(t, k); got != 1 {
		t.Fatalf("checkpoint through %d, want 1", got)
	}

	// The run that stops the room is consecutive: the success cleared it.
	rb1Op(t, membership, lineage, opTwo, updateAppending(client, "?"))
	k.operations.setFailCheckpoints(busy)
	for range 2 {
		if checkpoint(t, manager) {
			t.Fatal("a failed checkpoint was reported published")
		}
	}
	if closes := writer.closed(); len(closes) != 0 || manager.LiveRoomCount() != 1 {
		t.Fatalf("closes = %v, live rooms = %d", closes, manager.LiveRoomCount())
	}
}

func TestACheckpointThatLostTheFenceClosesTheRoom(t *testing.T) {
	k := rb1NewKit()
	manager, writer, _, _, _ := rb1OneOperation(t, k, rb1Quick())
	k.operations.StealFence(testDoc)

	if checkpoint(t, manager) {
		t.Fatal("a checkpoint without the fence was reported published")
	}

	rb1ClosedOnce(t, writer, manager)
}

func TestAReloadedRoomCountsTheTailItInheritedTowardTheThreshold(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.build(t, rb1Threshold(3), true, nil)
	membership, lineage := rb1Enter(t, manager, rb1V2("", true))
	client := syncedClient(t, manager, testDoc, "hello")
	for _, op := range [][2]string{{opOne, "a"}, {opTwo, "b"}} {
		rb1Op(t, membership, lineage, op[0], updateAppending(client, op[1]))
	}
	rb1Leave(manager, membership)
	rb1Evicted(t, manager, "the room to be evicted")

	if got := k.operations.Checkpoint(testDoc); got != nil {
		t.Fatalf("the premise is gone: checkpoint = %+v", got)
	}

	rejoined, lineage := rb1Enter(t, manager, rb1V2("", true))
	second := syncedClient(t, manager, testDoc, "helloab")
	rb1Op(t, rejoined, lineage, opThree, updateAppending(second, "c"))
	manager.Settle()

	if got := rb1Through(t, k); got != 3 {
		t.Fatalf("checkpoint through %d, want 3", got)
	}
}

func TestCheckpointThenTailReplaysTheExactDocument(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.build(t, rb1Threshold(3), true, nil)
	membership, lineage := rb1Enter(t, manager, rb1V2("", true))
	client := syncedClient(t, manager, testDoc, "hello")
	for n, id := range []string{opOne, opTwo, opThree, opFour, opFive} {
		rb1Op(t, membership, lineage, id, updateAppending(client, string(rune('a'+n))))
	}
	manager.Settle()
	liveText := exportedText(t, manager, testDoc)
	liveStateVector := rb1ServerStateVector(t, manager, newClient())
	rb1Leave(manager, membership)
	rb1Evicted(t, manager, "the room to be evicted")

	_, probe, err := k.operations.Open(context.Background(), testDoc)
	if err != nil || probe == nil {
		t.Fatalf("the journal did not open: %v", err)
	}
	opened := probe.OpenResult()
	_ = probe.Close()
	if opened.Checkpoint == nil || opened.Checkpoint.Through != 3 {
		t.Fatalf("checkpoint = %+v: the reload has no checkpoint to stand in for anything", opened.Checkpoint)
	}
	var tail []uint64
	for _, record := range opened.Tail {
		tail = append(tail, record.Sequence)
	}
	if !slices.Equal(tail, []uint64{4, 5}) {
		t.Fatalf("tail = %v, want [4 5]", tail)
	}

	reloadedStateVector := rb1ServerStateVector(t, manager, newClient())

	if !slices.Equal(liveStateVector, reloadedStateVector) {
		t.Fatalf("state vectors differ: live %v, reloaded %v", liveStateVector, reloadedStateVector)
	}
	if liveText != "helloabcde" {
		t.Fatalf("live text = %q", liveText)
	}
	if got := exportedText(t, manager, testDoc); got != liveText {
		t.Fatalf("reloaded text = %q, want %q", got, liveText)
	}
}

func TestCheckpointPublicationDoesNotDeleteOperationHistory(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.build(t, rb1Threshold(3), true, nil)
	writer := rb1V2("editor-1", true)
	membership, lineage := rb1Enter(t, manager, writer)
	client := syncedClient(t, manager, testDoc, "hello")
	ids := []string{opOne, opTwo, opThree}
	for n, id := range ids {
		rb1Op(t, membership, lineage, id, updateAppending(client, string(rune('a'+n))))
	}
	manager.Settle()

	if got := rb1Through(t, k); got != 3 {
		t.Fatalf("checkpoint through %d, want 3", got)
	}
	committed := k.operations.Committed(testDoc)
	if len(committed) != 3 {
		t.Fatalf("%d committed, want 3", len(committed))
	}
	for n, record := range committed {
		if record.OperationID != ids[n] || record.Sequence != uint64(n+1) || record.ActorID == nil || *record.ActorID != "editor-1" {
			t.Fatalf("record %d = %+v", n, record)
		}
	}

	writer.clear()
	rb1Op(t, membership, lineage, opOne, committed[0].Update)
	manager.Settle()

	messages := writer.messages(t)
	if len(messages) != 1 {
		t.Fatalf("got %#v, want one acknowledgement", messages)
	}
	if ack, ok := messages[0].(wire.Acknowledgement); !ok || ack.ServerSequence != 1 {
		t.Fatalf("got %#v, want the acknowledgement of sequence 1", messages[0])
	}
}

func TestTheOperationThatTripsAFatalCheckpointIsStillRelayedAndAcknowledged(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.build(t, rb1Threshold(1), true, nil)
	writer := rb1V2("", true)
	membership, lineage := rb1Enter(t, manager, writer)
	client := syncedClient(t, manager, testDoc, "hello")
	k.operations.setFailCheckpoints(func(string) error { return errors.New("the journal disk is busy") })
	for _, id := range []string{opOne, opTwo} {
		rb1Op(t, membership, lineage, id, updateAppending(client, "!"))
	}
	manager.Settle()
	last := updateAppending(client, "?")
	writer.clear()

	rb1Op(t, membership, lineage, opThree, last)
	manager.Settle()

	messages := writer.messages(t)
	if len(messages) != 2 {
		t.Fatalf("got %#v, want the relay then the acknowledgement", messages)
	}
	if relay, ok := messages[0].(wire.SyncUpdate); !ok || !slices.Equal(relay.Update, last) {
		t.Fatalf("first frame = %#v, want the relay", messages[0])
	}
	if ack, ok := messages[1].(wire.Acknowledgement); !ok || ack.ServerSequence != 3 {
		t.Fatalf("second frame = %#v, want the acknowledgement of 3", messages[1])
	}
	if closes := writer.closed(); len(closes) != 1 || closes[0] != collab.CloseCommitUnavailable {
		t.Fatalf("closes = %v, want one CommitUnavailable", closes)
	}
	if got := k.committed(); got != 3 {
		t.Fatalf("%d committed, want 3", got)
	}
}

func TestResettingAJournalRoomProjectsCommittedWorkBeforeItRebaselines(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", strPtr("v1"))
	k.host.echoes()
	manager := k.build(t, rb1Quick(), true, nil)
	membership, lineage := rb1Enter(t, manager, rb1V2("", true))
	client := syncedClient(t, manager, testDoc, "hello")
	rb1Op(t, membership, lineage, opOne, updateAppending(client, " world"))

	if got := exportedText(t, manager, testDoc); got != "hello world" {
		t.Fatalf("text before the reset = %q", got)
	}

	if _, err := manager.Reset(context.Background(), testDoc); err != nil {
		t.Fatal(err)
	}

	if got := exportedText(t, manager, testDoc); got != "hello world" {
		t.Fatalf("text after the reset = %q", got)
	}
}

func TestAClientDisconnectingMidResetDoesNotCostTheProjection(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", strPtr("v1"))
	k.host.echoes()
	manager := k.build(t, rb1Quick(), true, nil)
	membership, lineage := rb1Enter(t, manager, rb1V2("", true))
	client := syncedClient(t, manager, testDoc, "hello")
	rb1Op(t, membership, lineage, opOne, updateAppending(client, " world"))

	open := k.gateSaves(t)
	caller, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = manager.Reset(caller, testDoc)
	}()
	waitUntil(t, "the reset's flush to start", func() bool { return len(k.host.Saves()) == 1 })

	cancel()
	open()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the reset never returned")
	}

	if got := exportedText(t, manager, testDoc); got != "hello world" {
		t.Fatalf("text = %q", got)
	}
}

// rb1RecordMissedAnOperation is C# AJournalledDocumentWhoseRecordMissedAnOperation:
// the drain's write-back is refused, so the record holds "hello". Answers a
// fresh manager over the same journal.
func rb1RecordMissedAnOperation(t *testing.T, k *rb1Kit) *Manager {
	t.Helper()
	k.host.Holds(t, testDoc, "hello", strPtr("v1"))
	k.host.echoes()
	first := k.build(t, rb1Quick(), true, nil)
	membership, lineage := rb1Enter(t, first, rb1V2("", true))
	client := syncedClient(t, first, testDoc, "hello")
	rb1Op(t, membership, lineage, opOne, updateAppending(client, " world"))
	k.host.failNextSave(&docendpoint.Error{Message: "collab: the doc endpoint PUT returned 503.", StatusCode: 503})
	if err := first.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}

	if saves := k.host.Saves(); len(saves) != 1 {
		t.Fatalf("the premise is gone: saves = %+v", saves)
	}
	if k.host.saveFailurePending() {
		t.Fatal("the premise is gone: the drain never tried the write-back")
	}
	return k.build(t, rb1Quick(), true, nil)
}

func TestResettingAReloadedRoomProjectsTheWorkTheRecordNeverGot(t *testing.T) {
	k := rb1NewKit()
	second := rb1RecordMissedAnOperation(t, k)
	rb1Enter(t, second, rb1V2("", true))

	if _, err := second.Reset(context.Background(), testDoc); err != nil {
		t.Fatal(err)
	}

	if got := exportedText(t, second, testDoc); got != "hello world" {
		t.Fatalf("text = %q", got)
	}
}

// rb1SeedRawJournal resets the journal straight to baseline at epoch 3.
func rb1SeedRawJournal(t *testing.T, k *rb1Kit, baseline [][]byte) {
	t.Helper()
	_, session, err := k.operations.Open(context.Background(), testDoc)
	if err != nil || session == nil {
		t.Fatalf("the journal did not open: %v", err)
	}
	if _, err := session.Reset(context.Background(), operation.Reset{
		Format: workingset.CurrentFormat, Epoch: 3, Lineage: workingset.NewLineage(), Baseline: baseline,
	}); err != nil {
		t.Fatal(err)
	}
	if err := session.Close(); err != nil {
		t.Fatal(err)
	}
}

func rb1ResetRebaselines(t *testing.T, manager *Manager) {
	t.Helper()
	result, err := manager.Reset(context.Background(), testDoc)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != ResetDone || result.Tag == nil || result.Tag.Epoch != 4 {
		t.Fatalf("reset = %+v (%v), want done at epoch 4", result, result.Err)
	}
}

func TestResettingAColdDocumentWhoseJournalCannotBeReplayedStillRebaselines(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", strPtr("v1"))
	rb1SeedRawJournal(t, k, [][]byte{{0xde, 0xad, 0xbe, 0xef, 0x01}})
	manager := k.build(t, rb1Quick(), true, nil)

	rb1ResetRebaselines(t, manager)

	if got := exportedText(t, manager, testDoc); got != "hello" {
		t.Fatalf("text = %q", got)
	}
}

func TestResettingAColdDocumentWhoseJournalStopsReplayingStillRebaselines(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", strPtr("v1"))
	rb1SeedRawJournal(t, k, [][]byte{updateAppending(newClient(), "hello"), {0xde, 0xad, 0xbe, 0xef, 0x01}})
	manager := k.build(t, rb1Quick(), true, nil)
	writesBefore, _ := k.store.counts()

	rb1ResetRebaselines(t, manager)

	if writes, _ := k.store.counts(); writes != writesBefore {
		t.Fatalf("%d working-set writes, want %d", writes, writesBefore)
	}
	if got := exportedText(t, manager, testDoc); got != "hello" {
		t.Fatalf("text = %q", got)
	}
}

func TestResettingAColdJournalledDocumentProjectsItBeforeRebaselining(t *testing.T) {
	k := rb1NewKit()
	second := rb1RecordMissedAnOperation(t, k)

	if _, err := second.Reset(context.Background(), testDoc); err != nil {
		t.Fatal(err)
	}

	if got := exportedText(t, second, testDoc); got != "hello world" {
		t.Fatalf("text = %q", got)
	}
}

func TestAnEditOnAColdJournalledDocumentDoesNotWaitForTheVersionRead(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", strPtr("v1"))
	manager := k.build(t, rb1Quick(), true, nil)
	membership, lineage := rb1Enter(t, manager, rb1V2("", true))
	client := syncedClient(t, manager, testDoc, "hello")
	rb1Op(t, membership, lineage, opOne, updateAppending(client, " world"))
	rb1Leave(manager, membership)
	rb1Evicted(t, manager, "the room to be evicted")
	open := k.gateLoads(t)

	edited := make(chan EditResult, 1)
	ops := []convert.EditOp{rb1Appending(t, "b-1", "!")}
	digest, err := convert.CanonicalBodyDigest(ops)
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		result, _ := manager.Edit(context.Background(), testDoc, ops, "abcabcabcabcabcabcabcabcabcabc01", digest, "", nil)
		edited <- result
	}()
	var edit EditResult
	select {
	case edit = <-edited:
	case <-time.After(5 * time.Second):
		t.Fatal("the edit waited for the version read")
	}

	if edit.Status != EditApplied {
		t.Fatalf("status = %v (%v)", edit.Status, edit.Err)
	}
	if got := k.committed(); got != 2 {
		t.Fatalf("%d committed, want 2", got)
	}
	open()
}

func TestAVersionReadThatLandsAfterAFailedProjectionStillFillsTheHandle(t *testing.T) {
	k := rb1NewKit()
	o := versionOptions(50 * time.Millisecond)
	k.host.Holds(t, testDoc, "hello", strPtr("v1"))
	first := k.build(t, o, true, nil)
	firstMembership, firstLineage := rb1Enter(t, first, rb1V2("", true))
	firstClient := syncedClient(t, first, testDoc, "hello")
	rb1Op(t, firstMembership, firstLineage, opOne, updateAppending(firstClient, " world"))
	if err := first.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}
	k.host.Holds(t, testDoc, "hello world", strPtr("v2"))
	manager := k.build(t, o, true, nil)
	open := k.gateLoads(t)

	membership, lineage := rb1Enter(t, manager, rb1V2("", true))
	client := syncedClient(t, manager, testDoc, "hello world")
	rb1Op(t, membership, lineage, opTwo, updateAppending(client, "!"))
	before := len(k.host.Saves())

	k.host.failNextSave(&docendpoint.Error{Message: "collab: the doc endpoint PUT returned 502.", StatusCode: 502})
	if !checkpoint(t, manager) {
		t.Fatal("the checkpoint was not published")
	}
	waitUntil(t, "the projection the settle gave up waiting for", func() bool { return len(k.host.Saves()) > before })

	if got := versionOf(lastSave(t, k.textRoom)); got != "<nil>" {
		t.Fatalf("the first projection carried version %s, want none", got)
	}
	open()

	waitUntil(t, "the refused projection to be retried", func() bool { return len(k.host.Saves()) > before+1 })

	if got := versionOf(lastSave(t, k.textRoom)); got != "v2" {
		t.Fatalf("the retry carried version %s, want v2", got)
	}
}

func TestAResetFlushCarriesTheReloadedVersionAndYieldsToTheHostsSave(t *testing.T) {
	k := rb1NewKit()
	k.host.Holds(t, testDoc, "hello", strPtr("v1"))
	manager := k.build(t, rb1Quick(), true, nil)
	first, lineage := rb1Enter(t, manager, rb1V2("", true))
	client := syncedClient(t, manager, testDoc, "hello")
	rb1Op(t, first, lineage, opOne, updateAppending(client, " world"))
	rb1Leave(manager, first)
	rb1Evicted(t, manager, "the seeded room to be evicted")

	k.host.Holds(t, testDoc, "hello world", strPtr("v2"))
	loads := k.host.Loads()
	second, lineage := rb1Enter(t, manager, rb1V2("", true))
	// C#'s synchronous fake answers the version GET before the join
	// returns; Go sends it from a goroutine, so wait for it.
	waitUntil(t, "the reloaded room's version read", func() bool { return k.host.Loads() > loads })
	next := syncedClient(t, manager, testDoc, "hello world")
	rb1Op(t, second, lineage, opTwo, updateAppending(next, "!"))

	k.host.Holds(t, testDoc, "host wins", strPtr("v3"))
	k.host.failNextSave(&docendpoint.Error{Message: "collab: the doc endpoint PUT returned 409.", StatusCode: 409})

	if _, err := manager.Reset(context.Background(), testDoc); err != nil {
		t.Fatal(err)
	}

	if got := versionOf(lastSave(t, k.textRoom)); got != "v2" {
		t.Fatalf("the flush carried version %s, want v2", got)
	}
	if got := exportedText(t, manager, testDoc); got != "host wins" {
		t.Fatalf("text = %q", got)
	}
}

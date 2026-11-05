package room

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"regexp"
	"slices"
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
	"github.com/JackUait/blok/packages/server/go/internal/jsruntime"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// Twins of C# CollabRoomTests cases that had no Go twin.

// --- the endpoint, with C#'s one-shot NextSaveFailure ---

type rb2Host struct {
	*fakeEndpoint
	failMu          sync.Mutex
	nextSaveFailure error
}

func (h *rb2Host) failNextSave(err error) {
	h.failMu.Lock()
	defer h.failMu.Unlock()
	h.nextSaveFailure = err
}

func (h *rb2Host) Save(ctx context.Context, doc string, outputData any, version *string, projection *docendpoint.Projection) (*string, error) {
	h.failMu.Lock()
	failure := h.nextSaveFailure
	h.nextSaveFailure = nil
	h.failMu.Unlock()
	if failure == nil {
		return h.fakeEndpoint.Save(ctx, doc, outputData, version, projection)
	}
	// C# records the refused save before it throws.
	encoded, err := docendpoint.Serialize(outputData)
	if err != nil {
		return nil, err
	}
	h.fakeEndpoint.mu.Lock()
	h.fakeEndpoint.saves = append(h.fakeEndpoint.saves, recordedSave{doc: doc, data: string(encoded), version: version, projection: projection})
	h.fakeEndpoint.mu.Unlock()
	return nil, failure
}

func rb2EndpointError(status int) error {
	return &docendpoint.Error{Message: fmt.Sprintf("collab: the doc endpoint PUT returned %d.", status), StatusCode: status}
}

// --- the working set, with C#'s read/write counts, write gate and journal ---

type rb2Disk struct {
	*fakeWorkingSet
	reads      atomic.Int32
	writes     atomic.Int32
	mostFrames atomic.Int32

	mu          sync.Mutex
	beforeWrite chan struct{}
	landed      []string
}

func (d *rb2Disk) gateWrites(gate chan struct{}) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.beforeWrite = gate
}

func (d *rb2Disk) landedLog() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return slices.Clone(d.landed)
}

func (d *rb2Disk) Read(ctx context.Context, doc string) (*workingset.Set, error) {
	d.reads.Add(1)
	return d.fakeWorkingSet.Read(ctx, doc)
}

func (d *rb2Disk) Write(ctx context.Context, doc string, updates []byte, tag workingset.Tag) error {
	d.writes.Add(1)
	frames, ok := workingset.DecodeFrames(updates)
	if !ok {
		return errors.New("a written working set does not decode")
	}
	for {
		most := d.mostFrames.Load()
		if int32(len(frames)) <= most || d.mostFrames.CompareAndSwap(most, int32(len(frames))) {
			break
		}
	}
	d.mu.Lock()
	gate := d.beforeWrite
	d.mu.Unlock()
	if gate != nil {
		<-gate
	}
	if err := d.fakeWorkingSet.Write(ctx, doc, updates, tag); err != nil {
		return err
	}
	d.mu.Lock()
	d.landed = append(d.landed, fmt.Sprintf("write:%d", tag.Epoch))
	d.mu.Unlock()
	return nil
}

func (d *rb2Disk) Reset(ctx context.Context, doc string, tag workingset.Tag) error {
	if err := d.fakeWorkingSet.Reset(ctx, doc, tag); err != nil {
		return err
	}
	d.mu.Lock()
	d.landed = append(d.landed, fmt.Sprintf("reset:%d", tag.Epoch))
	d.mu.Unlock()
	return nil
}

// --- the converter, with C#'s ExportFailure and NextExportFailure ---

type rb2Knob struct {
	*textConverter
	exports atomic.Int32

	mu                sync.Mutex
	exportFailure     error
	nextExportFailure error
}

func (k *rb2Knob) failExports(err error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.exportFailure = err
}

func (k *rb2Knob) failNextExport(err error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.nextExportFailure = err
}

func (k *rb2Knob) Export(ctx context.Context, doc *yjs.Doc) (*jsjson.Object, error) {
	k.exports.Add(1)
	k.mu.Lock()
	failure := k.exportFailure
	if failure == nil {
		failure = k.nextExportFailure
		k.nextExportFailure = nil
	}
	k.mu.Unlock()
	if failure != nil {
		return nil, failure
	}
	return k.textConverter.Export(ctx, doc)
}

// rb2FailingHTML is C# FailingHtmlReader.
type rb2FailingHTML struct{ err error }

func (h rb2FailingHTML) Read(context.Context, []convert.RichTextHTML, time.Duration) ([][]any, error) {
	return nil, h.err
}

func rb2Transient(err error) error {
	return &convert.TransientError{Message: "collab: the rich text HTML could not be read", Err: err}
}

func rb2TimedOut() error {
	return rb2Transient(&jsruntime.Failure{Kind: jsruntime.KindTimedOut, Err: errors.New("timed out")})
}

func rb2TooLarge() error {
	return rb2Transient(&jsruntime.Failure{Kind: jsruntime.KindDocumentTooLarge, Err: errors.New("too large")})
}

// rb2PoolWait is a wait for a pooled engine that was cancelled.
func rb2PoolWait() error { return rb2Transient(context.Canceled) }

// --- the activity observer (C# RecordingActivityObserver) ---

type rb2Record struct {
	doc   string
	actor string
	at    time.Time
	kind  ActivityKind
}

type rb2Recorder struct {
	mu      sync.Mutex
	records []rb2Record
	failing bool
	gate    chan struct{}
}

func (o *rb2Recorder) Record(_ context.Context, docID, actorID string, at time.Time, kind ActivityKind) error {
	o.mu.Lock()
	o.records = append(o.records, rb2Record{doc: docID, actor: actorID, at: at, kind: kind})
	failing, gate := o.failing, o.gate
	o.mu.Unlock()
	if failing {
		// C# throws synchronously, before any task exists.
		panic("the activity table is down")
	}
	if gate != nil {
		<-gate
	}
	return nil
}

func (o *rb2Recorder) hold() chan struct{} {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.gate = make(chan struct{})
	return o.gate
}

func (o *rb2Recorder) all() []rb2Record {
	o.mu.Lock()
	defer o.mu.Unlock()
	return slices.Clone(o.records)
}

func (o *rb2Recorder) kinds() []ActivityKind {
	var kinds []ActivityKind
	for _, record := range o.all() {
		kinds = append(kinds, record.kind)
	}
	return kinds
}

func (o *rb2Recorder) actors(kind ActivityKind) []string {
	var actors []string
	for _, record := range o.all() {
		if record.kind == kind {
			actors = append(actors, record.actor)
		}
	}
	return actors
}

func (o *rb2Recorder) waitFor(t *testing.T, count int) {
	t.Helper()
	waitUntil(t, "the activity records", func() bool { return len(o.all()) >= count })
}

func rb2Kinds(t *testing.T, got []ActivityKind, want ...ActivityKind) {
	t.Helper()
	if !slices.Equal(got, want) {
		t.Fatalf("activity = %v, want %v", got, want)
	}
}

// --- the room under test ---

type rb2Kit struct {
	disk     *rb2Disk
	host     *rb2Host
	journal  *fakeJournal
	knob     *rb2Knob
	clock    *manualClock
	activity *rb2Recorder

	mu  sync.Mutex
	log []string
}

func newRb2Kit() *rb2Kit {
	return &rb2Kit{
		disk:     &rb2Disk{fakeWorkingSet: newFakeWorkingSet()},
		host:     &rb2Host{fakeEndpoint: newFakeEndpoint()},
		journal:  newFakeJournal(),
		knob:     &rb2Knob{textConverter: &textConverter{}},
		clock:    newManualClock(),
		activity: &rb2Recorder{},
	}
}

func (k *rb2Kit) logf(message string) {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.log = append(k.log, message)
}

func (k *rb2Kit) lines() []string {
	k.mu.Lock()
	defer k.mu.Unlock()
	return slices.Clone(k.log)
}

func (k *rb2Kit) linesWith(part string) int {
	count := 0
	for _, line := range k.lines() {
		if strings.Contains(line, part) {
			count++
		}
	}
	return count
}

func (k *rb2Kit) logged(part string) bool { return k.linesWith(part) > 0 }

func (k *rb2Kit) committed() int { return len(k.journal.Committed(testDoc)) }

func (k *rb2Kit) build(t *testing.T, o Options, journalled bool, converter Converter, activity bool) *Manager {
	t.Helper()
	if o.Now == nil {
		o.Now = k.clock.Now
	}
	if converter == nil {
		converter = k.knob
	}
	options := ManagerOptions{Store: k.disk, Endpoint: k.host, Converter: converter, Room: o, Log: k.logf}
	if journalled {
		options.Operations = k.journal
	}
	if activity {
		options.Activity = k.activity
	}
	manager := NewManager(options)
	t.Cleanup(func() { _ = manager.Drain(context.Background()) })
	return manager
}

func (k *rb2Kit) manager(t *testing.T, o Options, journalled bool) *Manager {
	t.Helper()
	return k.build(t, o, journalled, nil, false)
}

func (k *rb2Kit) activityManager(t *testing.T, journalled bool) *Manager {
	t.Helper()
	return k.build(t, DefaultOptions(), journalled, nil, true)
}

func rb2Quick() Options {
	return OptionsWith(func(ro *Options) {
		ro.ExportDebounce = 10 * time.Millisecond
		ro.ExportMaxDelay = 10 * time.Millisecond
		ro.EvictionLinger = 150 * time.Millisecond
		ro.RetryBackoff = 10 * time.Millisecond
		ro.RetryBackoffCap = 10 * time.Millisecond
		ro.CommitTimeout = 5 * time.Second
	})
}

func rb2V1(actor string, write bool) *fakeMember {
	return &fakeMember{actor: actor, source: collab.SourceClientV1, write: write}
}

func rb2V2(actor string) *fakeMember {
	return &fakeMember{actor: actor, source: collab.SourceClientV2, write: true}
}

// rb2Enter is C# Join: a v2 member also completes the sync exchange.
func rb2Enter(t *testing.T, manager *Manager, member *fakeMember) collab.Membership {
	t.Helper()
	if member.source == collab.SourceClientV2 {
		return joinSynced(t, manager, testDoc, member)
	}
	return join(t, manager, testDoc, member)
}

func rb2Receive(t *testing.T, membership collab.Membership, message wire.Message) {
	t.Helper()
	if err := membership.Receive(context.Background(), syncFrame(t, message)); err != nil {
		t.Fatal(err)
	}
}

func rb2Update(t *testing.T, membership collab.Membership, update []byte) {
	t.Helper()
	rb2Receive(t, membership, wire.SyncUpdate{Update: update})
}

func rb2Heartbeat(t *testing.T, membership collab.Membership) {
	t.Helper()
	rb2Receive(t, membership, wire.Activity{})
}

func rb2Step1(t *testing.T, membership collab.Membership) {
	t.Helper()
	rb2Receive(t, membership, wire.SyncStep1{StateVector: newClient().EncodeStateVector()})
}

func rb2Leave(manager *Manager, membership collab.Membership) {
	membership.Leave()
	manager.Settle()
}

func rb2Evicted(t *testing.T, manager *Manager, what string) {
	t.Helper()
	waitUntil(t, what, func() bool { return manager.LiveRoomCount() == 0 })
}

func rb2Clear(member *fakeMember) {
	member.mu.Lock()
	defer member.mu.Unlock()
	member.frames = nil
}

func rb2ReceivedStep2(t *testing.T, member *fakeMember) bool {
	t.Helper()
	for _, message := range member.messages(t) {
		if _, ok := message.(wire.SyncStep2); ok {
			return true
		}
	}
	return false
}

func rb2SaveText(t *testing.T, save recordedSave) string {
	t.Helper()
	return dataText(node(t, save.data))
}

func rb2AssertProjection(t *testing.T, save recordedSave, lineage string, sequence uint64) {
	t.Helper()
	if save.projection == nil || save.projection.Lineage != lineage || save.projection.ServerSequence != sequence {
		t.Fatalf("projection = %+v, want (%s, %d)", save.projection, lineage, sequence)
	}
}

// rb2OneOperation: a synced v2 writer on "hello" that committed one "!".
func rb2OneOperation(t *testing.T, k *rb2Kit, o Options) (*Manager, *fakeMember, collab.Membership, *yjs.Doc) {
	t.Helper()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.manager(t, o, true)
	writer := rb2V2("")
	membership := rb2Enter(t, manager, writer)
	client := syncedClient(t, manager, testDoc, "hello")
	sendOperation(t, membership, writer, opOne, updateAppending(client, "!"))
	return manager, writer, membership, client
}

func rb2Appending(t *testing.T, id, text string) convert.EditOp {
	t.Helper()
	return convert.Insert{ID: id, Block: node(t, `{"id":"`+id+`","type":"paragraph","data":`+textJSON(t, text)+`}`)}
}

var rb2NextEdit atomic.Uint64

// rb2EditOps is C# EditAsync(doc, ops): a fresh key, the canonical digest.
func rb2EditOps(t *testing.T, manager *Manager, ops ...convert.EditOp) EditResult {
	t.Helper()
	digest, err := convert.CanonicalBodyDigest(ops)
	if err != nil {
		t.Fatal(err)
	}
	id := fmt.Sprintf("%032x", 0xabc00000+rb2NextEdit.Add(1))
	result, err := manager.Edit(context.Background(), testDoc, ops, id, digest, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

// rb2RunTimers lets every short room timer fire a few times over.
func rb2RunTimers(manager *Manager) {
	for range 5 {
		time.Sleep(30 * time.Millisecond)
		manager.Settle()
	}
}

// --- projections ---

func TestAReloadedRoomInheritsItsCommittedSequenceFromTheHead(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.manager(t, rb2Quick(), true)
	writer := rb2V2("")
	membership := rb2Enter(t, manager, writer)
	client := syncedClient(t, manager, testDoc, "hello")
	for _, id := range []string{opOne, opTwo} {
		sendOperation(t, membership, writer, id, updateAppending(client, "!"))
	}

	if !checkpoint(t, manager) {
		t.Fatal("the first checkpoint was not published")
	}
	rb2Leave(manager, membership)
	rb2Evicted(t, manager, "the room to be evicted")
	rb2Enter(t, manager, rb2V2(""))

	republished := checkpoint(t, manager)

	if got := manager.LiveRoomCount(); got != 1 {
		t.Fatalf("%d live rooms, want 1", got)
	}
	if republished {
		t.Fatal("the reloaded room republished its checkpoint")
	}
	if got := k.journal.Checkpoint(testDoc); got == nil || got.Through != 2 {
		t.Fatalf("checkpoint = %+v, want through 2", got)
	}
}

func TestFailedProjectionStaysDirtyAndRetries(t *testing.T) {
	k := newRb2Kit()
	manager, writer, _, _ := rb2OneOperation(t, k, rb2Quick())
	k.host.failNextSave(rb2EndpointError(502))

	if !checkpoint(t, manager) {
		t.Fatal("the checkpoint was not published")
	}

	waitUntil(t, "the refused projection to be retried", func() bool { return len(k.host.Saves()) >= 2 })

	saves := k.host.Saves()
	if rb2SaveText(t, saves[0]) != "hello!" || rb2SaveText(t, saves[1]) != "hello!" {
		t.Fatalf("saves = %q, %q", saves[0].data, saves[1].data)
	}
	rb2AssertProjection(t, saves[1], controlTag(t, writer).Lineage, 1)
	if got := manager.LiveRoomCount(); got != 1 {
		t.Fatalf("%d live rooms, want 1", got)
	}
}

func TestEvictionAndDrainProjectTheLatestCommittedSequence(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.manager(t, rb2Quick(), true)
	writer := rb2V2("")
	membership := rb2Enter(t, manager, writer)
	client := syncedClient(t, manager, testDoc, "hello")
	lineage := controlTag(t, writer).Lineage
	for _, id := range []string{opOne, opTwo} {
		sendOperation(t, membership, writer, id, updateAppending(client, "!"))
	}
	rb2Leave(manager, membership)
	rb2Evicted(t, manager, "the room to be evicted")

	saves := k.host.Saves()
	if len(saves) != 1 {
		t.Fatalf("%d saves, want 1", len(saves))
	}
	rb2AssertProjection(t, saves[0], lineage, 2)
	if got := rb2SaveText(t, saves[0]); got != "hello!!" {
		t.Fatalf("evicted text %q", got)
	}

	// A fresh room over the same journal: its sequence continues the head's.
	rejoiner := rb2V2("")
	rejoined := rb2Enter(t, manager, rejoiner)
	next := syncedClient(t, manager, testDoc, "hello!!")
	sendOperation(t, rejoined, rejoiner, opThree, updateAppending(next, "?"))

	if err := manager.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}

	saves = k.host.Saves()
	if len(saves) < 2 {
		t.Fatalf("%d saves, want the drain's too", len(saves))
	}
	rb2AssertProjection(t, saves[1], lineage, 3)
	if got := rb2SaveText(t, saves[1]); got != "hello!!?" {
		t.Fatalf("drained text %q", got)
	}
}

func TestEvictionWaitsForADirtyProjection(t *testing.T) {
	k := newRb2Kit()
	o := rb2Quick()
	// Long enough that the held room is still there to be counted.
	o.RetryBackoff, o.RetryBackoffCap = 400*time.Millisecond, 400*time.Millisecond
	manager, writer, membership, _ := rb2OneOperation(t, k, o)
	k.host.failNextSave(rb2EndpointError(502))
	rb2Leave(manager, membership)

	waitUntil(t, "the eviction projection to be refused", func() bool { return len(k.host.Saves()) == 1 })
	manager.Settle()

	if got := manager.LiveRoomCount(); got != 1 {
		t.Fatalf("%d live rooms, want 1: the room was dropped past a refused PUT", got)
	}

	rb2Evicted(t, manager, "the room to be evicted once its projection landed")

	saves := k.host.Saves()
	if len(saves) != 2 {
		t.Fatalf("%d saves, want 2", len(saves))
	}
	rb2AssertProjection(t, saves[1], controlTag(t, writer).Lineage, 1)
}

func TestPermanentProjectionFailureReleasesTheHoldAndMarksTheDocumentUnexportable(t *testing.T) {
	k := newRb2Kit()
	manager, _, membership, _ := rb2OneOperation(t, k, rb2Quick())
	k.knob.failExports(&journal.InvalidDataError{Message: `collab: block "b-1" has data that is not a map.`})

	// First refusal, with the room still occupied.
	if !checkpoint(t, manager) {
		t.Fatal("the checkpoint was not published")
	}
	time.Sleep(100 * time.Millisecond)
	manager.Settle()
	rb2Leave(manager, membership)

	rb2Evicted(t, manager, "the room to stop being held for a projection it can never build")

	// The checkpoint's attempt and the eviction flush's, no retry between.
	if got := k.knob.exports.Load(); got != 2 {
		t.Fatalf("%d exports, want 2", got)
	}
	if saves := k.host.Saves(); len(saves) != 0 {
		t.Fatalf("%d saves, want none", len(saves))
	}
	if got := k.linesWith("b-1"); got != 1 {
		t.Fatalf("%d log lines name b-1, want 1: %q", got, k.lines())
	}
	if got := k.committed(); got != 1 {
		t.Fatalf("%d committed, want 1", got)
	}
}

func TestATransientExportFailureIsRetriedNotRefused(t *testing.T) {
	k := newRb2Kit()
	manager, _, _, _ := rb2OneOperation(t, k, rb2Quick())
	k.knob.failNextExport(rb2Transient(errors.New("the runtime took too long")))

	if !checkpoint(t, manager) {
		t.Fatal("the checkpoint was not published")
	}

	waitUntil(t, "the retried export to land", func() bool { return len(k.host.Saves()) > 0 })

	if k.logged("cannot export its document") {
		t.Fatalf("refused: %q", k.lines())
	}
	saves := k.host.Saves()
	if got := rb2SaveText(t, saves[len(saves)-1]); got != "hello!" {
		t.Fatalf("saved %q", got)
	}
}

func TestAnEnginePoolWaitNeverGivesTheExportUp(t *testing.T) {
	k := newRb2Kit()
	manager, _, _, _ := rb2OneOperation(t, k, rb2Quick())
	k.knob.failExports(rb2PoolWait())

	if !checkpoint(t, manager) {
		t.Fatal("the checkpoint was not published")
	}

	waitUntil(t, "more than eight export attempts", func() bool { return k.knob.exports.Load() > 8 })
	manager.Settle()

	if k.logged("gave up exporting") {
		t.Fatalf("gave up: %q", k.lines())
	}
}

// rb2FailingWorkingCopy is a working copy whose every export fails with
// failure, after one v1 edit.
func rb2FailingWorkingCopy(t *testing.T, k *rb2Kit, failure error) (*Manager, collab.Membership, *yjs.Doc) {
	t.Helper()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.manager(t, rb2Quick(), false)
	membership := rb2Enter(t, manager, rb2V1("", true))
	client := syncedClient(t, manager, testDoc, "hello")
	k.knob.failExports(failure)
	rb2Update(t, membership, updateAppending(client, "!"))
	return manager, membership, client
}

func TestOnAWorkingCopyATransientExportFailureThatNeverHealsIsGivenUp(t *testing.T) {
	k := newRb2Kit()
	manager, membership, client := rb2FailingWorkingCopy(t, k, rb2TimedOut())
	waitUntil(t, "the export to be given up", func() bool { return k.logged("gave up exporting") })

	attempts := k.knob.exports.Load()
	rb2RunTimers(manager)

	if got := k.knob.exports.Load(); got != attempts {
		t.Fatalf("%d exports after the give-up, want %d", got, attempts)
	}
	if saves := k.host.Saves(); len(saves) != 0 {
		t.Fatalf("%d saves, want none", len(saves))
	}

	// The next edit gets one attempt, and a success clears the give-up.
	k.knob.failExports(nil)
	rb2Update(t, membership, updateAppending(client, "?"))
	waitUntil(t, "the next edit's export", func() bool { return len(k.host.Saves()) == 1 })
}

func TestOnAWorkingCopyAGivenUpExportLetsTheRoomUnload(t *testing.T) {
	k := newRb2Kit()
	manager, membership, _ := rb2FailingWorkingCopy(t, k, rb2TooLarge())
	rb2Leave(manager, membership)

	rb2Evicted(t, manager, "the room to unload")

	if saves := k.host.Saves(); len(saves) != 0 {
		t.Fatalf("%d saves, want none", len(saves))
	}
	if got := docText(replay(t, k.disk.Frames(t, testDoc))); got != "hello!" {
		t.Fatalf("the working set replays %q", got)
	}
}

func TestOnAWorkingCopyAnEnginePoolWaitNeverGivesTheExportUp(t *testing.T) {
	k := newRb2Kit()
	manager, _, _ := rb2FailingWorkingCopy(t, k, rb2PoolWait())

	waitUntil(t, "more than eight export attempts", func() bool { return k.knob.exports.Load() > 8 })
	manager.Settle()

	if k.logged("gave up exporting") {
		t.Fatalf("gave up: %q", k.lines())
	}
}

func TestATransientFlushExportFailureIsNotARefusal(t *testing.T) {
	k := newRb2Kit()
	manager, _, _, _ := rb2OneOperation(t, k, rb2Quick())
	k.knob.failExports(rb2Transient(errors.New("the runtime took too long")))

	if err := manager.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}

	if !k.logged("could not export during flush") {
		t.Fatalf("no flush failure logged: %q", k.lines())
	}
	if k.logged("cannot export its document") {
		t.Fatalf("refused: %q", k.lines())
	}
	if saves := k.host.Saves(); len(saves) != 0 {
		t.Fatalf("%d saves, want none", len(saves))
	}
}

func TestAJavaScriptErrorReadingExportHtmlIsARefusal(t *testing.T) {
	k := newRb2Kit()
	k.host.HoldsNothing(testDoc, nil)
	failing := rb2FailingHTML{err: &jsruntime.Failure{Kind: jsruntime.KindInvalidDocument, Err: errors.New("TypeError")}}
	manager := k.build(t, rb2Quick(), true, &convert.DocConverter{Now: k.clock.Now, HTML: failing}, false)
	rb2Enter(t, manager, rb2V2(""))
	edit := rb2EditOps(t, manager, convert.Insert{ID: "r", Block: node(t,
		`{"type":"database-row","data":{"properties":{"notes":{"blocks":[{"id":"n","type":"paragraph","data":{"text":"<i>n</i>"}}]}}}}`)})

	if edit.Status != EditApplied {
		t.Fatalf("edit = %v (%v)", edit.Status, edit.Err)
	}
	if !checkpoint(t, manager) {
		t.Fatal("the checkpoint was not published")
	}
	waitUntil(t, "the refused projection", func() bool { return k.logged("cannot export its document") })
}

func TestACancelledExportIsRetriedNotRefused(t *testing.T) {
	k := newRb2Kit()
	manager, _, _, _ := rb2OneOperation(t, k, rb2Quick())
	k.knob.failNextExport(context.Canceled)

	if !checkpoint(t, manager) {
		t.Fatal("the checkpoint was not published")
	}

	waitUntil(t, "the retried export to land", func() bool { return len(k.host.Saves()) > 0 })

	if k.logged("cannot export its document") {
		t.Fatalf("refused: %q", k.lines())
	}
}

// --- a journal room and the working-set store ---

func TestOperationStoreRoomNeverWritesTheWorkingSetStore(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.manager(t, rb2Quick(), true)
	writer := rb2V2("")
	membership := rb2Enter(t, manager, writer)
	stock := rb2Enter(t, manager, rb2V1("", true))
	client := syncedClient(t, manager, testDoc, "hello")

	sendOperation(t, membership, writer, opOne, updateAppending(client, "!"))
	rb2Update(t, stock, updateAppending(client, "?"))
	edit := rb2EditOps(t, manager, rb2Appending(t, "b-1", "x"))
	text := exportedText(t, manager, testDoc)

	if err := manager.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}

	if got := k.disk.writes.Load(); got != 0 {
		t.Fatalf("%d working-set writes, want 0", got)
	}
	if k.disk.Holds(testDoc) {
		t.Fatal("the working-set store holds the document")
	}
	// The room served all three write paths, so the zeros are absence.
	if edit.Status != EditApplied {
		t.Fatalf("edit = %v", edit.Status)
	}
	if got := k.committed(); got != 3 {
		t.Fatalf("%d committed, want 3", got)
	}
	saves := k.host.Saves()
	if len(saves) != 1 || rb2SaveText(t, saves[0]) != text {
		t.Fatalf("saves = %+v, want one of %q", saves, text)
	}
}

func TestOperationStoreRoomNeverCompacts(t *testing.T) {
	k := newRb2Kit()
	o := rb2Quick()
	o.CompactionFrameThreshold = 2
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.manager(t, o, true)
	writer := rb2V2("")
	membership := rb2Enter(t, manager, writer)
	stock := rb2Enter(t, manager, rb2V1("", true))
	client := syncedClient(t, manager, testDoc, "hello")
	for _, id := range []string{opOne, opTwo} {
		sendOperation(t, membership, writer, id, updateAppending(client, "!"))
	}
	for _, piece := range []string{"a", "b"} {
		rb2Update(t, stock, updateAppending(client, piece))
	}
	rb2EditOps(t, manager, rb2Appending(t, "b-1", "x"))
	if err := manager.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}

	if got := k.disk.writes.Load(); got != 0 {
		t.Fatalf("%d working-set writes, want 0", got)
	}
	if k.disk.Holds(testDoc) {
		t.Fatal("the working-set store holds the document")
	}
	if got := k.committed(); got != 5 {
		t.Fatalf("%d committed, want 5", got)
	}

	// The premise: a working-set-only room on the same options compacts.
	const legacyDoc = "doc-legacy"
	k.host.Holds(t, legacyDoc, "hello", nil)
	legacy := k.manager(t, o, false)
	joined := join(t, legacy, legacyDoc, rb2V1("", true))
	legacyClient := newClient()
	for _, piece := range []string{"a", "b", "c", "d", "e"} {
		rb2Update(t, joined, updateAppending(legacyClient, piece))
	}
	if err := legacy.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}

	if k.disk.writes.Load() == 0 {
		t.Fatal("the working-set-only room wrote nothing")
	}
	if got := k.disk.mostFrames.Load(); got != 1 {
		t.Fatalf("the most frames written is %d, want 1", got)
	}
}

func TestOperationStoreRoomLoadsBaselineAndTailThroughTheFencedSession(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "endpoint", nil)
	source := newClient()
	baseline := updateAppending(source, "base")
	tail := updateAppending(source, "-tail")
	ctx := context.Background()
	_, opened, err := k.journal.Open(ctx, testDoc)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := opened.Reset(ctx, operation.Reset{Format: workingset.CurrentFormat, Epoch: 2, Lineage: tagLineage, Baseline: [][]byte{baseline}}); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(tail)
	if _, err := opened.Append(ctx, operation.Candidate{OperationID: opOne, Source: operation.SourceClientV1, Update: tail, Digest: digest[:]}); err != nil {
		t.Fatal(err)
	}
	if err := opened.Close(); err != nil {
		t.Fatal(err)
	}
	// A blob holding another document: reading it would serve the wrong
	// history, writing it would be the second copy.
	k.disk.Seed(t, testDoc, [][]byte{fullState(t, docWith("blob"))}, tagAt(9))
	manager := k.manager(t, rb2Quick(), true)

	served := exportedText(t, manager, testDoc)
	if err := manager.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}

	if served != "base-tail" {
		t.Fatalf("served %q", served)
	}
	if got := k.disk.reads.Load(); got != 0 {
		t.Fatalf("%d working-set reads, want 0", got)
	}
	if got := k.disk.writes.Load(); got != 0 {
		t.Fatalf("%d working-set writes, want 0", got)
	}
	if k.disk.Holds(testDoc) {
		t.Fatal("the stale blob was kept")
	}
}

func TestOperationStoreRoomEvictsWithoutWaitingForABlobWrite(t *testing.T) {
	k := newRb2Kit()
	k.disk.setFailWrites(func(string) error { return errors.New("the working set store is down") })
	manager, _, membership, _ := rb2OneOperation(t, k, rb2Quick())

	rb2Leave(manager, membership)
	waitUntil(t, "the eviction flush to project", func() bool { return len(k.host.Saves()) == 1 })
	manager.Settle()

	if k.logged("until its working set is written") {
		t.Fatalf("held for a blob write: %q", k.lines())
	}
	if got := manager.LiveRoomCount(); got != 0 {
		t.Fatalf("%d live rooms, want 0", got)
	}
	if got := k.disk.writes.Load(); got != 0 {
		t.Fatalf("%d working-set writes, want 0", got)
	}
	saves := k.host.Saves()
	if len(saves) != 1 || rb2SaveText(t, saves[0]) != "hello!" {
		t.Fatalf("saves = %+v", saves)
	}
}

// --- activity ---

func TestAJoinReportsTheActorAsJoined(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.activityManager(t, false)

	join(t, manager, testDoc, rb2V1("user-1", true))
	manager.Settle()

	records := k.activity.all()
	if len(records) != 1 {
		t.Fatalf("records = %+v, want one", records)
	}
	want := rb2Record{doc: testDoc, actor: "user-1", at: k.clock.Now(), kind: ActivityJoined}
	if records[0] != want {
		t.Fatalf("record = %+v, want %+v", records[0], want)
	}
}

func TestAConnectionWithNoVerifiedActorIsNeverReported(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.activityManager(t, true)
	member := rb2V2("")
	membership := rb2Enter(t, manager, member)
	client := syncedClient(t, manager, testDoc, "hello")
	update := updateAppending(client, "!")

	rb2Heartbeat(t, membership)
	sendOperation(t, membership, member, opOne, update)
	rb2Leave(manager, membership)

	// The commit proves the Edited hook was reached.
	if got := k.committed(); got != 1 {
		t.Fatalf("%d committed, want 1", got)
	}
	if records := k.activity.all(); len(records) != 0 {
		t.Fatalf("records = %+v, want none", records)
	}
}

func TestAnActivityFrameReportsActiveWithTheDocumentAndTheServerClock(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.activityManager(t, false)
	member := rb2V1("user-1", true)
	membership := rb2Enter(t, manager, member)
	rb2Clear(member)

	k.clock.Advance(90 * time.Second)
	sent := k.clock.Now()

	rb2Heartbeat(t, membership)
	manager.Settle()

	rb2Kinds(t, k.activity.kinds(), ActivityJoined, ActivityActive)
	want := rb2Record{doc: testDoc, actor: "user-1", at: sent, kind: ActivityActive}
	if got := k.activity.all()[1]; got != want {
		t.Fatalf("record = %+v, want %+v", got, want)
	}
	// The frame carries no payload and earns no answer.
	if messages := member.messages(t); len(messages) != 0 {
		t.Fatalf("the member got %+v", messages)
	}
}

func TestActiveAndEditedShareOneMinuteWindowPerActor(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.activityManager(t, true)
	member := rb2V2("user-1")
	membership := rb2Enter(t, manager, member)
	client := syncedClient(t, manager, testDoc, "hello")
	opened := k.clock.Now()

	rb2Heartbeat(t, membership)
	k.clock.Advance(30 * time.Second)
	sendOperation(t, membership, member, opOne, updateAppending(client, "a"))
	k.clock.Advance(30 * time.Second)
	sendOperation(t, membership, member, opTwo, updateAppending(client, "b"))
	rb2Heartbeat(t, membership)
	manager.Settle()

	if got := k.committed(); got != 2 {
		t.Fatalf("%d committed, want 2", got)
	}
	records := k.activity.all()
	type seen struct {
		kind ActivityKind
		at   time.Time
	}
	var got []seen
	for _, record := range records {
		got = append(got, seen{record.kind, record.at})
	}
	want := []seen{{ActivityJoined, opened}, {ActivityActive, opened}, {ActivityEdited, opened.Add(60 * time.Second)}}
	if !slices.Equal(got, want) {
		t.Fatalf("activity = %+v, want %+v", got, want)
	}
}

func TestAHeartbeatArrivingJustUnderTheClientsMinuteIsStillReported(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.activityManager(t, false)
	membership := rb2Enter(t, manager, rb2V1("user-1", true))

	rb2Heartbeat(t, membership)
	// A minute of client cadence that lost a second on the way here.
	k.clock.Advance(59 * time.Second)
	late := k.clock.Now()
	rb2Heartbeat(t, membership)
	manager.Settle()

	rb2Kinds(t, k.activity.kinds(), ActivityJoined, ActivityActive, ActivityActive)
	if got := k.activity.all()[2].at; !got.Equal(late) {
		t.Fatalf("the late heartbeat is at %v, want %v", got, late)
	}
}

func TestJoinAndLeaveAreNeverSuppressed(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.activityManager(t, false)

	first := rb2Enter(t, manager, rb2V1("user-1", true))
	rb2Leave(manager, first)
	second := rb2Enter(t, manager, rb2V1("user-1", true))
	rb2Leave(manager, second)

	rb2Kinds(t, k.activity.kinds(), ActivityJoined, ActivityLeft, ActivityJoined, ActivityLeft)
	for _, record := range k.activity.all() {
		if record.actor != "user-1" {
			t.Fatalf("record for %q", record.actor)
		}
	}
}

func TestAReaderThatNeverEditsIsReportedJoinedThenLeft(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.activityManager(t, false)
	membership := rb2Enter(t, manager, rb2V1("user-1", false))

	rb2Step1(t, membership)
	k.clock.Advance(2 * time.Minute)
	rb2Leave(manager, membership)

	rb2Kinds(t, k.activity.kinds(), ActivityJoined, ActivityLeft)
}

func TestAThrowingObserverIsLoggedAndNeitherClosesTheRoomNorStallsIt(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	k.activity.failing = true
	manager := k.activityManager(t, false)
	member := rb2V1("user-1", true)
	membership := rb2Enter(t, manager, member)
	manager.Settle()

	rb2Step1(t, membership)
	rb2Heartbeat(t, membership)
	manager.Settle()

	rb2Kinds(t, k.activity.kinds(), ActivityJoined, ActivityActive)
	if closed := member.closed(); len(closed) != 0 {
		t.Fatalf("the member was closed: %v", closed)
	}
	if !rb2ReceivedStep2(t, member) {
		t.Fatal("the member got no SyncStep2")
	}
	if !k.logged("activity observer failed") {
		t.Fatalf("nothing logged: %q", k.lines())
	}
}

// A wrong answer hangs rather than asserts, so every wait is bounded.
func TestAnObserverStillInsideRecordAsyncDoesNotHoldTheLane(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	gate := k.activity.hold()
	defer close(gate)
	manager := k.activityManager(t, false)
	member := rb2V1("user-1", true)

	joined := make(chan collab.Membership, 1)
	go func() {
		result, err := manager.Join(context.Background(), testDoc, member)
		if err == nil && result.Status == collab.JoinJoined {
			joined <- result.Membership
		}
	}()
	var membership collab.Membership
	select {
	case membership = <-joined:
	case <-time.After(10 * time.Second):
		t.Fatal("the join never took the lane")
	}

	// The record is added before the call blocks, so once it appears the
	// room's own wait is the only thing outstanding.
	k.activity.waitFor(t, 1)
	step1 := syncFrame(t, wire.SyncStep1{StateVector: newClient().EncodeStateVector()})
	stepped := make(chan error, 1)
	go func() { stepped <- membership.Receive(context.Background(), step1) }()
	select {
	case err := <-stepped:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the observer held the lane")
	}

	if !rb2ReceivedStep2(t, member) {
		t.Fatal("the member got no SyncStep2")
	}
}

// The manual clock never moves here, so only the context can end the wait.
func TestADrainAlreadyCancelledDoesNotWaitOutTheActivityObserver(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	gate := k.activity.hold()
	defer close(gate)
	manager := k.activityManager(t, false)
	rb2Enter(t, manager, rb2V1("user-1", true))
	k.activity.waitFor(t, 1)
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()

	drained := make(chan error, 1)
	go func() { drained <- manager.Drain(cancelled) }()
	select {
	case err := <-drained:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the cancelled drain waited out the observer")
	}

	select {
	case <-gate:
		t.Fatal("the gate was opened")
	default:
	}
	if !k.logged("abandoned its activity dispatch while draining: the drain was cancelled") {
		t.Fatalf("nothing logged: %q", k.lines())
	}
}

func TestAHeartbeatFloodIsDroppedBeforeASessionBoundary(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	gate := k.activity.hold()
	manager := k.activityManager(t, false)
	leaving := rb2Enter(t, manager, rb2V1("user-a", true))

	// Joined(user-a) is delivered and stuck, so only the Left below can end
	// that session.
	k.activity.waitFor(t, 1)
	leaving.Leave()

	beating := rb2Enter(t, manager, rb2V1("user-b", true))
	// Two boundaries plus 256 heartbeats against a bound of 256.
	for range 256 {
		k.clock.Advance(60 * time.Second)
		rb2Heartbeat(t, beating)
	}

	close(gate)
	manager.Settle()

	if !slices.Contains(k.activity.actors(ActivityLeft), "user-a") {
		t.Fatal("the Left of user-a was dropped")
	}
	if !slices.Contains(k.activity.actors(ActivityJoined), "user-b") {
		t.Fatal("the Joined of user-b was dropped")
	}
	if !k.logged("dropped an activity record (Active)") {
		t.Fatalf("no heartbeat was dropped: %q", k.lines())
	}
	if k.logged("dropped an activity record (Left)") || k.logged("dropped an activity record (Joined)") {
		t.Fatalf("a boundary was dropped: %q", k.lines())
	}
}

func TestARoomThatClosesOnACommitFailureReportsLeftForEveryMember(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.activityManager(t, true)
	writer := rb2V2("user-1")
	reader := rb2V1("user-2", false)
	membership := rb2Enter(t, manager, writer)
	rb2Enter(t, manager, reader)
	client := syncedClient(t, manager, testDoc, "hello")
	update := updateAppending(client, "!")
	k.journal.mu.Lock()
	k.journal.failAppends = func(string) error { return errors.New("the journal is down") }
	k.journal.mu.Unlock()

	sendOperation(t, membership, writer, opOne, update)

	// The manager forgets a closed room, so the record count is the seam.
	k.activity.waitFor(t, 4)

	for _, member := range []*fakeMember{writer, reader} {
		if closed := member.closed(); !slices.Equal(closed, []collab.CloseReason{collab.CloseCommitUnavailable}) {
			t.Fatalf("%s closed %v, want CommitUnavailable", member.actor, closed)
		}
	}
	left := k.activity.actors(ActivityLeft)
	slices.Sort(left)
	if !slices.Equal(left, []string{"user-1", "user-2"}) {
		t.Fatalf("left = %v", left)
	}
}

func TestADrainReportsLeftForEveryVerifiedMemberItStillHeld(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.activityManager(t, false)
	member := rb2V1("user-1", true)
	anonymous := rb2V1("", true)
	rb2Enter(t, manager, member)
	rb2Enter(t, manager, anonymous)

	if err := manager.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}

	rb2Kinds(t, k.activity.kinds(), ActivityJoined, ActivityLeft)
	if got := k.activity.all()[1]; got.actor != "user-1" || !got.at.Equal(k.clock.Now()) {
		t.Fatalf("left = %+v", got)
	}
	for _, m := range []*fakeMember{member, anonymous} {
		if closed := m.closed(); !slices.Equal(closed, []collab.CloseReason{collab.CloseDraining}) {
			t.Fatalf("closed %v, want Draining", closed)
		}
	}
}

func TestAMemberThatLeftIsNotReportedLeftAgainWhenTheRoomCloses(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.activityManager(t, false)
	member := rb2V1("user-1", true)
	membership := rb2Enter(t, manager, member)

	membership.Leave()
	if err := manager.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}

	rb2Kinds(t, k.activity.kinds(), ActivityJoined, ActivityLeft)
	// Never closed by the room: it was already out of the member set.
	if closed := member.closed(); len(closed) != 0 {
		t.Fatalf("closed %v", closed)
	}
}

func rb2Malformed() wire.Message { return wire.Awareness{Update: []byte{0x01, 0x02, 0x03}} }

func TestAnExpelledMemberIsReportedLeftExactlyOnce(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.activityManager(t, false)
	member := rb2V1("user-1", true)
	membership := rb2Enter(t, manager, member)
	expelled := k.clock.Now()

	for range 3 {
		rb2Receive(t, membership, rb2Malformed())
	}
	// What the socket does next: its close leaves a membership the room
	// already let go.
	membership.Leave()
	if err := manager.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}

	if closed := member.closed(); !slices.Equal(closed, []collab.CloseReason{collab.CloseBadAwareness}) {
		t.Fatalf("closed %v, want BadAwareness", closed)
	}
	rb2Kinds(t, k.activity.kinds(), ActivityJoined, ActivityLeft)
	if got := k.activity.all()[1]; got.actor != "user-1" || !got.at.Equal(expelled) {
		t.Fatalf("left = %+v", got)
	}
}

func TestAnExpelledMemberWithNoVerifiedActorIsNeverReported(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.activityManager(t, false)
	membership := rb2Enter(t, manager, rb2V1("", true))

	for range 3 {
		rb2Receive(t, membership, rb2Malformed())
	}
	if err := manager.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}

	if records := k.activity.all(); len(records) != 0 {
		t.Fatalf("records = %+v, want none", records)
	}
}

// rb2HeartbeatDistinctActors is C# HeartbeatDistinctActorsAsync. It settles
// every 16 so the bounded activity queue never sheds a record under test.
func rb2HeartbeatDistinctActors(t *testing.T, manager *Manager, prefix string, count int) {
	t.Helper()
	for index := range count {
		membership := join(t, manager, testDoc, rb2V1(fmt.Sprintf("%s-%d", prefix, index), true))
		rb2Heartbeat(t, membership)
		membership.Leave()
		if index%16 == 15 {
			manager.Settle()
		}
	}
}

// rb2StampCount is C# RoomActivityStampCount.
func rb2StampCount(t *testing.T, manager *Manager) int {
	t.Helper()
	manager.Settle()
	rooms := manager.liveRooms()
	if len(rooms) != 1 {
		t.Fatalf("%d live rooms, want 1", len(rooms))
	}
	count := 0
	if err := rooms[0].run(context.Background(), func() error {
		count = len(rooms[0].activityStamps)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return count
}

const rb2StampRound = activityStampLimit + 1

func TestAnActorInsideItsWindowIsStillSuppressedAfterASweep(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.activityManager(t, false)
	// Never leaves, so the room never arms its eviction linger.
	join(t, manager, testDoc, rb2V1("anchor", true))

	rb2HeartbeatDistinctActors(t, manager, "old", rb2StampRound)
	k.clock.Advance(56 * time.Second)

	subject := join(t, manager, testDoc, rb2V1("subject", true))
	rb2Heartbeat(t, subject)

	// Well inside the subject's own window when the sweep below runs.
	k.clock.Advance(10 * time.Second)
	rb2HeartbeatDistinctActors(t, manager, "new", rb2StampRound)
	rb2Heartbeat(t, subject)
	manager.Settle()

	active := 0
	for _, record := range k.activity.all() {
		if record.actor == "subject" && record.kind == ActivityActive {
			active++
		}
	}
	if active != 1 {
		t.Fatalf("subject reported Active %d times, want 1", active)
	}
}

func TestDistinctActorsAcrossTwoWindowsLeaveTheStampMapBounded(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.activityManager(t, false)
	join(t, manager, testDoc, rb2V1("anchor", true))

	rb2HeartbeatDistinctActors(t, manager, "first", rb2StampRound)
	k.clock.Advance(56 * time.Second)
	rb2HeartbeatDistinctActors(t, manager, "second", rb2StampRound)

	if got := rb2StampCount(t, manager); got != rb2StampRound {
		t.Fatalf("%d stamps, want %d", got, rb2StampRound)
	}
}

func TestAStampExactlyOneWindowOldIsSwept(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.activityManager(t, false)
	join(t, manager, testDoc, rb2V1("anchor", true))
	edge := join(t, manager, testDoc, rb2V1("edge", true))

	rb2Heartbeat(t, edge)
	edge.Leave()
	k.clock.Advance(55 * time.Second)
	rb2HeartbeatDistinctActors(t, manager, "fresh", rb2StampRound)

	if got := rb2StampCount(t, manager); got != rb2StampRound {
		t.Fatalf("%d stamps, want %d", got, rb2StampRound)
	}
}

func TestAJoinAndLeaveAfterTheLimitStillSweepsTheInertStamps(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.activityManager(t, false)
	join(t, manager, testDoc, rb2V1("anchor", true))

	rb2HeartbeatDistinctActors(t, manager, "gone", rb2StampRound)
	k.clock.Advance(56 * time.Second)

	// Never heartbeats: the only activity a quiet room still produces.
	latecomer := join(t, manager, testDoc, rb2V1("latecomer", true))
	rb2Leave(manager, latecomer)

	if got := rb2StampCount(t, manager); got != 0 {
		t.Fatalf("%d stamps, want 0", got)
	}
}

func TestWithNoObserverAnActivityFrameChangesNothing(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.manager(t, DefaultOptions(), false)
	member := rb2V1("user-1", true)
	membership := rb2Enter(t, manager, member)
	rb2Clear(member)

	rb2Heartbeat(t, membership)
	manager.Settle()

	if records := k.activity.all(); len(records) != 0 {
		t.Fatalf("records = %+v", records)
	}
	if messages := member.messages(t); len(messages) != 0 {
		t.Fatalf("the member got %+v", messages)
	}
	for _, line := range k.lines() {
		if strings.Contains(strings.ToLower(line), "activity") || strings.Contains(line, "dropped a frame") {
			t.Fatalf("logged %q", line)
		}
	}

	rb2Step1(t, membership)
	manager.Settle()

	if !rb2ReceivedStep2(t, member) {
		t.Fatal("the member got no SyncStep2")
	}
}

// --- reset and dispose ---

func TestResetSettlesAnInFlightWriteSoItCannotOvertakeTheReset(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	manager := k.manager(t, DefaultOptions(), false)
	membership := rb2Enter(t, manager, rb2V1("", true))
	client := syncedClient(t, manager, testDoc, "hello")

	// Gate the off-lane write so the edit's persist is still in flight.
	stuck := make(chan struct{})
	k.disk.gateWrites(stuck)
	writes, landed := k.disk.writes.Load(), len(k.disk.landedLog())
	rb2Update(t, membership, updateAppending(client, "!"))
	waitUntil(t, "the update's write to reach the gate", func() bool { return k.disk.writes.Load() == writes+1 })
	if got := len(k.disk.landedLog()); got != landed {
		t.Fatalf("%d landed, want %d: the gate did not hold the write", got, landed)
	}

	type outcome struct {
		result ResetResult
		err    error
	}
	reset := make(chan outcome, 1)
	go func() {
		result, err := manager.Reset(context.Background(), testDoc)
		reset <- outcome{result, err}
	}()
	time.Sleep(50 * time.Millisecond)
	select {
	case <-reset:
		t.Fatal("the reset overtook the in-flight write")
	default:
	}

	// Release the stale write; the reset finishes only after it landed.
	close(stuck)
	k.disk.gateWrites(nil)
	var done outcome
	select {
	case done = <-reset:
	case <-time.After(10 * time.Second):
		t.Fatal("the reset never finished")
	}
	if done.err != nil || done.result.Status != ResetDone || done.result.Tag == nil {
		t.Fatalf("reset = %+v, %v", done.result, done.err)
	}
	minted := *done.result.Tag
	if minted.Format != workingset.CurrentFormat || minted.Epoch != 1 ||
		!regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(minted.Lineage) || minted.Lineage == tagLineage {
		t.Fatalf("minted tag %+v", minted)
	}
	log := k.disk.landedLog()
	if len(log) < 2 || !slices.Equal(log[len(log)-2:], []string{"write:0", "reset:1"}) {
		t.Fatalf("landed %v, want it to end write:0, reset:1", log)
	}
	if got := k.disk.Stored(t, testDoc).Tag; got != minted {
		t.Fatalf("stored tag %+v, want %+v", got, minted)
	}
}

func TestDisposeIsIdempotent(t *testing.T) {
	k := newRb2Kit()
	manager := k.manager(t, DefaultOptions(), false)
	r := newRoom(testDoc, manager)

	r.dispose()
	r.dispose()

	if !r.disposed || r.doc != nil || r.lifetime.Err() == nil {
		t.Fatalf("disposed %v, doc %v, lifetime %v", r.disposed, r.doc, r.lifetime.Err())
	}
	// C# ArmedTimerCount == 0.
	for _, timer := range []*roomTimer{&r.exportTimer, &r.evictTimer, &r.persistTimer} {
		timer.mu.Lock()
		armed, dead := timer.timer != nil, timer.dead
		timer.mu.Unlock()
		if armed || !dead {
			t.Fatalf("a timer is armed %v, dead %v", armed, dead)
		}
	}
}

package room

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab"
	"github.com/JackUait/blok/packages/server/go/internal/collab/collabtest"
	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/internal/collab/wire"
	"github.com/JackUait/blok/packages/server/go/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/jsruntime"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// Twins of C# CollabRoomMigrationTests: a format-1 room is migrated once, in
// place, under a new lineage. The room is the collab-format1 "rich-marks"
// fixture; the migrated export is the one C# captured in
// collab-migrations/cases.json, read by both sides.

const migrationRoom = "rich-marks"

var (
	runtimeOnce sync.Once
	runtimePool *jsruntime.Pool
	runtimeErr  error
)

// runtimeReader is C# RichTextRuntime.Reader: the client's own HTML reader.
func runtimeReader(t *testing.T) convert.HTMLReader {
	t.Helper()
	runtimeOnce.Do(func() { runtimePool, runtimeErr = jsruntime.NewPool(jsruntime.Options{PoolSize: 1}) })
	if runtimeErr != nil {
		t.Fatal(runtimeErr)
	}
	return convert.RuntimeHTMLReader{Runtime: runtimePool}
}

type migrationCase struct {
	Name        string          `json:"name"`
	ShapeUpdate *string         `json:"shapeUpdate"`
	Export      json.RawMessage `json:"export"`
}

func migrationFixture(t *testing.T, name string) migrationCase {
	t.Helper()
	var fixture struct {
		Cases []migrationCase `json:"cases"`
	}
	collabtest.Read(t, "collab-migrations/cases.json", &fixture)
	for _, c := range fixture.Cases {
		if c.Name == name {
			return c
		}
	}
	t.Fatalf("no migration case %q", name)
	return migrationCase{}
}

func decode64(t *testing.T, text string) []byte {
	t.Helper()
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(text))
	if err != nil {
		t.Fatal(err)
	}
	return decoded
}

// format1Update is the fixture room's state.
func format1Update(t *testing.T) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(collabtest.Path(t, "collab-format1"), migrationRoom, "update.b64"))
	if err != nil {
		t.Fatal(err)
	}
	return decode64(t, string(raw))
}

// stringLeafRoom is the room as the released client stored it: rich fields
// as string leaves (the fixture's string-leaves shape update).
func stringLeafRoom(t *testing.T) []byte {
	t.Helper()
	doc := yjs.NewDoc(yjs.Options{})
	if _, err := doc.ApplyUpdate(format1Update(t)); err != nil {
		t.Fatal(err)
	}
	shape := migrationFixture(t, migrationRoom+"/string-leaves").ShapeUpdate
	if shape == nil {
		t.Fatal("the string-leaves case has no shape update")
	}
	if _, err := doc.ApplyUpdate(decode64(t, *shape)); err != nil {
		t.Fatal(err)
	}
	return fullState(t, doc)
}

func format1Tag(epoch int64) workingset.Tag {
	return workingset.Tag{Format: workingset.HTMLRichTextFormat, Epoch: epoch, Lineage: tagLineage}
}

func canonicalJSON(t *testing.T, value any) string {
	t.Helper()
	text, err := jsjson.Stringify(value)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := jsjson.ParseNode([]byte(text), jsjson.Options{MaxDepth: 256})
	if err != nil {
		t.Fatal(err)
	}
	out, err := parsed.AppendCanonical(nil)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

// expectedExport is C# Expected: the captured export, with the tail's
// "<i>tail</i> " read into m-highlight's text when withTail.
func expectedExport(t *testing.T, withTail bool) string {
	t.Helper()
	blocks, err := jsjson.Parse(migrationFixture(t, migrationRoom).Export)
	if err != nil {
		t.Fatal(err)
	}
	if withTail {
		html := "<i>tail</i> a <mark>plain highlight</mark> b"
		read, err := runtimeReader(t).Read(context.Background(),
			[]convert.RichTextHTML{{Type: "paragraph", Field: "text", HTML: jsjson.FromString(html)}}, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, block := range blocks.([]any) {
			object := block.(*jsjson.Object)
			if id, _ := object.Get(jsjson.FromString("id")); id.(jsjson.Str).String() == "m-highlight" {
				data, _ := object.Get(jsjson.FromString("data"))
				data.(*jsjson.Object).Set(jsjson.FromString("text"), read[0])
			}
		}
	}
	return canonicalJSON(t, blocks)
}

func replay(t *testing.T, updates [][]byte) *yjs.Doc {
	t.Helper()
	doc := yjs.NewDoc(yjs.Options{})
	for _, update := range updates {
		if result, err := doc.ApplyUpdate(update); err != nil || result.Outcome != yjs.Applied {
			t.Fatalf("replay: %+v, %v", result, err)
		}
	}
	return doc
}

func exportJSON(t *testing.T, doc *yjs.Doc) string {
	t.Helper()
	blocks, slots, err := convert.Export(doc, convert.BuiltInRichTextFields(), nil)
	if err != nil || len(slots) != 0 {
		t.Fatalf("export: %d HTML slots, %v", len(slots), err)
	}
	return canonicalJSON(t, blocks)
}

// assertMigrated: no legacy rich text is left, and every block's text is an XmlText.
func assertMigrated(t *testing.T, doc *yjs.Doc) {
	t.Helper()
	if left := convert.CollectLegacyRichText(doc, convert.BuiltInRichTextFields()); len(left) != 0 {
		t.Fatalf("legacy rich text left: %v", left)
	}
	blocks := doc.GetMap(jsjson.FromString("blocks"))
	for _, id := range blocks.Keys() {
		block, _ := blocks.Get(id)
		data, _ := block.(*yjs.Map).Get(jsjson.FromString("data"))
		text, _ := data.(*yjs.Map).Get(jsjson.FromString("text"))
		if _, ok := text.(*yjs.XmlText); !ok {
			t.Fatalf("block %s text is %T, want an XmlText", id.String(), text)
		}
	}
}

func baselineFrames(t *testing.T, r *textRoom) [][]byte { return r.operations.Baseline(testDoc) }

// migrationRoomFor is the C# test class state: the fakes, a doc endpoint
// holding nothing, and the real converter over reader.
func migrationRoomFor(t *testing.T) *textRoom {
	t.Helper()
	r := newTextRoom()
	r.endpoint.HoldsNothing(testDoc, nil)
	return r
}

func (r *textRoom) migrationManager(t *testing.T, reader convert.HTMLReader, journalled bool) *Manager {
	t.Helper()
	converter := &convert.DocConverter{Now: r.clock.Now, HTML: reader}
	var operations OperationStore
	if journalled {
		operations = r.operations
	}
	manager := NewManager(ManagerOptions{
		Store: r.store, Endpoint: r.endpoint, Converter: converter,
		Room: OptionsWith(func(ro *Options) { ro.Now = r.clock.Now }), Log: r.logf, Operations: operations,
	})
	t.Cleanup(func() { _ = manager.Drain(context.Background()) })
	return manager
}

// seedFormat1Journal is C# SeedJournalAsync: the room as the baseline at
// epoch 4, and optionally one format-1 edit after it.
func seedFormat1Journal(t *testing.T, r *textRoom, format int32, baseline []byte, withTail bool) {
	t.Helper()
	session := seedJournal(t, r.operations, testDoc, format, 4, [][]byte{baseline})
	defer session.Close()
	if !withTail {
		return
	}
	client := yjs.NewDoc(yjs.Options{})
	if _, err := client.ApplyUpdate(baseline); err != nil {
		t.Fatal(err)
	}
	blocks := client.GetMap(jsjson.FromString("blocks"))
	block, _ := blocks.Get(jsjson.FromString("m-highlight"))
	data, _ := block.(*yjs.Map).Get(jsjson.FromString("data"))
	text, _ := data.(*yjs.Map).Get(jsjson.FromString("text"))
	update := client.Transact(func(tx *yjs.Transaction) {
		text.(*yjs.Text).Insert(tx, 0, jsjson.FromString("<i>tail</i> "), nil)
	})
	if _, err := session.Append(context.Background(), operation.Candidate{
		OperationID: opOne, Source: operation.SourceClientV2, Update: update, Digest: make([]byte, 32),
	}); err != nil {
		t.Fatal(err)
	}
}

func joinStatus(t *testing.T, manager *Manager) collab.JoinStatus {
	t.Helper()
	result, err := manager.Join(context.Background(), testDoc, v2Member())
	if err != nil {
		t.Fatal(err)
	}
	return result.Status
}

func sameFrames(a, b [][]byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if string(a[i]) != string(b[i]) {
			return false
		}
	}
	return true
}

func TestAFormat1JournalIsMigratedOnOpen(t *testing.T) {
	r := migrationRoomFor(t)
	seedFormat1Journal(t, r, workingset.HTMLRichTextFormat, format1Update(t), true)
	manager := r.migrationManager(t, runtimeReader(t), true)
	member := v2Member()
	joinSynced(t, manager, testDoc, member)

	head := r.operations.Head(testDoc)
	if head.Format != workingset.CurrentFormat || head.Epoch != 5 || head.Lineage == tagLineage ||
		!workingset.IsLineage(head.Lineage) || head.DurableThrough != 0 {
		t.Fatalf("head = %+v", head)
	}
	if len(r.operations.Committed(testDoc)) != 0 {
		t.Fatal("the migrated lineage has records")
	}
	tag := controlTag(t, member)
	if tag.Format != head.Format || tag.Epoch != head.Epoch || tag.Lineage != head.Lineage {
		t.Fatalf("control tag %+v, head %+v", tag, head)
	}
	state, _ := stateText(t, manager, testDoc)
	if state.Head == nil || state.Head.Tag.Lineage != head.Lineage || state.Head.ServerSequence != 0 {
		t.Fatalf("state head = %+v", state.Head)
	}

	// The baseline alone rebuilds the migrated room, the tail's edit included.
	rebuilt := replay(t, baselineFrames(t, r))
	assertMigrated(t, rebuilt)
	if got, want := exportJSON(t, rebuilt), expectedExport(t, true); got != want {
		t.Fatalf("export\n got %s\nwant %s", got, want)
	}
}

// The released client (v1.15.2) stored rich fields as string leaves.
func TestAStringLeafJournalIsMigratedOnOpen(t *testing.T) {
	r := migrationRoomFor(t)
	seedFormat1Journal(t, r, workingset.HTMLRichTextFormat, stringLeafRoom(t), false)
	member := v2Member()
	joinSynced(t, r.migrationManager(t, runtimeReader(t), true), testDoc, member)

	if got := controlTag(t, member).Format; got != workingset.CurrentFormat {
		t.Fatalf("format %d", got)
	}
	rebuilt := replay(t, baselineFrames(t, r))
	assertMigrated(t, rebuilt)
	if got, want := exportJSON(t, rebuilt), expectedExport(t, false); got != want {
		t.Fatalf("export\n got %s\nwant %s", got, want)
	}
}

func TestAStringLeafWorkingSetIsMigratedInPlace(t *testing.T) {
	r := migrationRoomFor(t)
	r.store.Seed(t, testDoc, [][]byte{stringLeafRoom(t)}, format1Tag(4))
	member := v2Member()
	joinSynced(t, r.migrationManager(t, runtimeReader(t), false), testDoc, member)

	if got := controlTag(t, member).Format; got != workingset.CurrentFormat {
		t.Fatalf("format %d", got)
	}
	rebuilt := replay(t, r.store.Frames(t, testDoc))
	assertMigrated(t, rebuilt)
	if got, want := exportJSON(t, rebuilt), expectedExport(t, false); got != want {
		t.Fatalf("export\n got %s\nwant %s", got, want)
	}
}

// countingReader fails every read with err.
type countingReader struct {
	calls atomic.Int32
	err   error
}

func (c *countingReader) Read(context.Context, []convert.RichTextHTML, time.Duration) ([][]any, error) {
	c.calls.Add(1)
	return nil, c.err
}

// A failure that is not a runtime limit also repeats on every open, so it
// is held off the same way.
func TestAnyFailedMigrationIsHeldOff(t *testing.T) {
	r := migrationRoomFor(t)
	seedFormat1Journal(t, r, workingset.HTMLRichTextFormat, format1Update(t), false)
	reader := &countingReader{err: errors.New("collab: the runtime answered htmlFieldsToSegments with the wrong shape.")}
	manager := r.migrationManager(t, reader, true)

	if got := joinStatus(t, manager); got != collab.JoinSeedFailed {
		t.Fatalf("first join = %v", got)
	}
	if got := joinStatus(t, manager); got != collab.JoinUnavailable {
		t.Fatalf("a join while held off = %v", got)
	}
	if got := reader.calls.Load(); got != 1 {
		t.Fatalf("%d reads, want 1", got)
	}
}

// A format-1 copy whose lineage is unusable is still format 1 and migrates.
func TestAFormat1WorkingSetWithAnUnusableLineageIsMigratedWhenAdopted(t *testing.T) {
	r := migrationRoomFor(t)
	r.store.Seed(t, testDoc, [][]byte{format1Update(t)}, workingset.Tag{Format: workingset.HTMLRichTextFormat, Epoch: 4, Lineage: "not-a-lineage"})
	member := v2Member()
	joinSynced(t, r.migrationManager(t, runtimeReader(t), true), testDoc, member)

	if got := controlTag(t, member).Format; got != workingset.CurrentFormat {
		t.Fatalf("format %d", got)
	}
	assertMigrated(t, replay(t, baselineFrames(t, r)))
}

func TestAMigratedJournalIsNotMigratedAgain(t *testing.T) {
	r := migrationRoomFor(t)
	seedFormat1Journal(t, r, workingset.HTMLRichTextFormat, format1Update(t), false)
	manager := r.migrationManager(t, runtimeReader(t), true)
	joinSynced(t, manager, testDoc, v2Member())
	migrated := *r.operations.Head(testDoc)
	baseline := baselineFrames(t, r)
	if err := manager.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}

	member := v2Member()
	joinSynced(t, r.migrationManager(t, runtimeReader(t), true), testDoc, member)

	if got := *r.operations.Head(testDoc); got != migrated {
		t.Fatalf("head %+v, want %+v", got, migrated)
	}
	if got := controlTag(t, member).Lineage; got != migrated.Lineage {
		t.Fatalf("lineage %s, want %s", got, migrated.Lineage)
	}
	if !sameFrames(baselineFrames(t, r), baseline) {
		t.Fatal("the baseline changed")
	}
}

// The reset is the commit point: until it lands the journal is format 1.
func TestAFailedCommitLeavesTheFormat1JournalIntact(t *testing.T) {
	r := migrationRoomFor(t)
	seedFormat1Journal(t, r, workingset.HTMLRichTextFormat, format1Update(t), false)
	before := *r.operations.Head(testDoc)
	baseline := baselineFrames(t, r)
	r.operations.setFailResets(func(string) error { return errors.New("the disk is full") })

	if got := joinStatus(t, r.migrationManager(t, runtimeReader(t), true)); got != collab.JoinSeedFailed {
		t.Fatalf("join = %v", got)
	}
	if got := *r.operations.Head(testDoc); got != before || !sameFrames(baselineFrames(t, r), baseline) {
		t.Fatalf("head %+v, want %+v, baseline kept %v", got, before, sameFrames(baselineFrames(t, r), baseline))
	}

	r.operations.setFailResets(nil)
	member := v2Member()
	joinSynced(t, r.migrationManager(t, runtimeReader(t), true), testDoc, member)
	if got := controlTag(t, member).Format; got != workingset.CurrentFormat {
		t.Fatalf("format %d", got)
	}
	assertMigrated(t, replay(t, baselineFrames(t, r)))
}

func TestAFailedReadLeavesTheFormat1JournalIntact(t *testing.T) {
	r := migrationRoomFor(t)
	seedFormat1Journal(t, r, workingset.HTMLRichTextFormat, format1Update(t), false)
	before := *r.operations.Head(testDoc)

	reader := &countingReader{err: errors.New("the runtime ran past its timeout")}
	if got := joinStatus(t, r.migrationManager(t, reader, true)); got != collab.JoinSeedFailed {
		t.Fatalf("join = %v", got)
	}
	if got := *r.operations.Head(testDoc); got != before {
		t.Fatalf("head %+v, want %+v", got, before)
	}
	found := false
	r.mu.Lock()
	for _, line := range r.log {
		found = found || (strings.Contains(line, "could not migrate its format-1 rich text") && strings.Contains(line, "ran past its timeout"))
	}
	r.mu.Unlock()
	if !found {
		t.Fatalf("log = %q", r.log)
	}
}

// A field too large for the runtime's timeout fails the same way on every
// open, so the document is held off for a doubling wait.
func TestAMigrationThatRunsPastTheRuntimesLimitsIsHeldOff(t *testing.T) {
	r := migrationRoomFor(t)
	seedFormat1Journal(t, r, workingset.HTMLRichTextFormat, format1Update(t), false)
	reader := &countingReader{err: &jsruntime.Failure{Kind: jsruntime.KindTimedOut, Err: errors.New("ran past the runtime's timeout")}}
	manager := r.migrationManager(t, reader, true)

	if got := joinStatus(t, manager); got != collab.JoinSeedFailed {
		t.Fatalf("first join = %v", got)
	}
	if got := joinStatus(t, manager); got != collab.JoinUnavailable {
		t.Fatalf("a join while held off = %v", got)
	}
	if got := reader.calls.Load(); got != 1 {
		t.Fatalf("%d reads, want 1", got)
	}
	// C# prints the wait as a TimeSpan.
	if !r.logged(`collab: document "` + testDoc + `" failed to load in a way the next open repeats, ` +
		`so it is held off for 00:00:02 (failure 1); the room's own log line says why`) {
		t.Fatalf("log = %q", r.log)
	}

	r.clock.Advance(DefaultOptions().withDefaults().Backoff(1))
	if got := joinStatus(t, manager); got != collab.JoinSeedFailed {
		t.Fatalf("join after the hold = %v", got)
	}
	if got := reader.calls.Load(); got != 2 {
		t.Fatalf("%d reads, want 2", got)
	}
	if got := r.operations.Head(testDoc).Format; got != workingset.HTMLRichTextFormat {
		t.Fatalf("format %d, want 1", got)
	}
}

// The pre-reset load does not migrate; a refused reset must not leave that
// format-1 room serving.
func TestARefusedResetDoesNotLeaveAFormat1RoomServing(t *testing.T) {
	r := migrationRoomFor(t)
	seedFormat1Journal(t, r, workingset.HTMLRichTextFormat, format1Update(t), false)
	r.store.setFailRetires(func(string) error { return errors.New("the disk is busy") })
	manager := r.migrationManager(t, runtimeReader(t), true)

	reset, err := manager.Reset(context.Background(), testDoc)
	if err != nil || reset.Status != ResetUnavailable {
		t.Fatalf("reset = %v, %v", reset.Status, err)
	}

	r.store.setFailRetires(nil)
	member := v2Member()
	joinSynced(t, manager, testDoc, member)
	if tag := controlTag(t, member); tag.Format != workingset.CurrentFormat || tag.Lineage == tagLineage {
		t.Fatalf("tag = %+v", tag)
	}
}

// The migration's reset leaves the head at sequence 0, and the room's
// counters follow it.
func TestAnEditAfterMigrationCommitsAtSequenceOneAndCheckpoints(t *testing.T) {
	r := migrationRoomFor(t)
	seedFormat1Journal(t, r, workingset.HTMLRichTextFormat, format1Update(t), true)
	manager := r.migrationManager(t, runtimeReader(t), true)
	joinSynced(t, manager, testDoc, v2Member())

	block := node(t, `{"id":"added","type":"paragraph","data":{"text":"<b>after</b>"}}`)
	result, err := manager.Edit(context.Background(), testDoc, []convert.EditOp{convert.Insert{ID: "added", Block: block}}, opTwo, make([]byte, 32), "", nil)
	if err != nil || result.Status != EditApplied {
		t.Fatalf("edit = %v, %v (%v)", result.Status, err, result.Err)
	}
	committed := r.operations.Committed(testDoc)
	if len(committed) != 1 || committed[0].Sequence != 1 {
		t.Fatalf("committed = %+v, want one at sequence 1", committed)
	}
	if !checkpoint(t, manager) {
		t.Fatal("no checkpoint was published")
	}
	if got := r.operations.Checkpoint(testDoc); got == nil || got.Through != 1 {
		t.Fatalf("checkpoint = %+v", got)
	}
}

// A format-1 client's offline operation, on the old lineage, is refused
// and never journalled.
func TestAFormat1ClientsOperationIsRefusedAfterMigration(t *testing.T) {
	r := migrationRoomFor(t)
	seedFormat1Journal(t, r, workingset.HTMLRichTextFormat, format1Update(t), false)
	manager := r.migrationManager(t, runtimeReader(t), true)
	writer := v2Member()
	membership := joinSynced(t, manager, testDoc, writer)
	client := replay(t, baselineFrames(t, r))
	blocks := client.GetMap(jsjson.FromString("blocks"))
	block, _ := blocks.Get(jsjson.FromString("m-simple"))
	data, _ := block.(*yjs.Map).Get(jsjson.FromString("data"))
	update := client.Transact(func(tx *yjs.Transaction) {
		data.(*yjs.Map).Set(tx, jsjson.FromString("text"), yjs.NewText(jsjson.FromString("<b>offline</b>")))
	})
	seen := len(writer.messages(t))

	if err := membership.Receive(context.Background(), syncFrame(t, wire.Operation{Lineage: tagLineage, OperationID: opOne, Update: update})); err != nil {
		t.Fatal(err)
	}

	got := writer.messages(t)[seen:]
	if len(got) != 1 {
		t.Fatalf("the writer got %#v, want one rejection", got)
	}
	if rejection, ok := got[0].(wire.Rejection); !ok || rejection.Code != "lineage-mismatch" {
		t.Fatalf("the writer got %#v, want a lineage-mismatch", got[0])
	}
	if len(r.operations.Committed(testDoc)) != 0 {
		t.Fatal("the old lineage's operation was journalled")
	}
}

func TestAJournalInANewerFormatIsRefusedAndKept(t *testing.T) {
	r := migrationRoomFor(t)
	seedFormat1Journal(t, r, workingset.CurrentFormat+1, format1Update(t), false)
	before := *r.operations.Head(testDoc)

	if got := joinStatus(t, r.migrationManager(t, runtimeReader(t), true)); got != collab.JoinSeedFailed {
		t.Fatalf("join = %v", got)
	}
	if got := *r.operations.Head(testDoc); got != before {
		t.Fatalf("head %+v, want %+v", got, before)
	}
	if !r.logged("format 3") {
		t.Fatalf("log = %q", r.log)
	}
}

func TestAFormat1WorkingSetIsMigratedInPlace(t *testing.T) {
	r := migrationRoomFor(t)
	r.store.Seed(t, testDoc, [][]byte{format1Update(t)}, format1Tag(4))
	member := v2Member()
	joinSynced(t, r.migrationManager(t, runtimeReader(t), false), testDoc, member)

	stored := r.store.Stored(t, testDoc).Tag
	if stored.Format != workingset.CurrentFormat || stored.Epoch != 5 || stored.Lineage == tagLineage {
		t.Fatalf("stored tag = %+v", stored)
	}
	if tag := controlTag(t, member); tag.Format != stored.Format || tag.Epoch != stored.Epoch || tag.Lineage != stored.Lineage {
		t.Fatalf("control tag %+v, stored %+v", tag, stored)
	}
	// A write, never a store reset: a reset stores an empty log.
	if _, resets := r.store.counts(); resets != 0 {
		t.Fatalf("%d store resets", resets)
	}
	if got := r.endpoint.Loads(); got != 0 {
		t.Fatalf("%d endpoint loads", got)
	}
	rebuilt := replay(t, r.store.Frames(t, testDoc))
	assertMigrated(t, rebuilt)
	if got, want := exportJSON(t, rebuilt), expectedExport(t, false); got != want {
		t.Fatalf("export\n got %s\nwant %s", got, want)
	}
}

// The host record still holds HTML; a migrated room writes it back as segments.
func TestAMigratedWorkingSetWritesTheRecordBack(t *testing.T) {
	r := migrationRoomFor(t)
	r.store.Seed(t, testDoc, [][]byte{format1Update(t)}, format1Tag(4))
	converter := &convert.DocConverter{Now: r.clock.Now, HTML: runtimeReader(t)}
	manager := NewManager(ManagerOptions{
		Store: r.store, Endpoint: r.endpoint, Converter: converter, Log: r.logf,
		Room: OptionsWith(func(ro *Options) {
			ro.Now = r.clock.Now
			ro.ExportDebounce = 10 * time.Millisecond
			ro.ExportMaxDelay = 10 * time.Millisecond
		}),
	})
	t.Cleanup(func() { _ = manager.Drain(context.Background()) })
	joinSynced(t, manager, testDoc, v2Member())

	waitUntil(t, "the migrated record to be written back", func() bool { return len(r.endpoint.Saves()) > 0 })
	saved, err := jsjson.Parse([]byte(r.endpoint.Saves()[0].data))
	if err != nil {
		t.Fatal(err)
	}
	blocks, _ := saved.(*jsjson.Object).Get(jsjson.FromString("blocks"))
	if got, want := canonicalJSON(t, blocks), expectedExport(t, false); got != want {
		t.Fatalf("written back\n got %s\nwant %s", got, want)
	}
}

func TestAFailedWriteLeavesTheFormat1WorkingSetIntact(t *testing.T) {
	r := migrationRoomFor(t)
	update := format1Update(t)
	r.store.Seed(t, testDoc, [][]byte{update}, format1Tag(4))
	r.store.setFailWrites(func(string) error { return errors.New("the disk is full") })

	if got := joinStatus(t, r.migrationManager(t, runtimeReader(t), false)); got != collab.JoinSeedFailed {
		t.Fatalf("join = %v", got)
	}
	if got := r.store.Stored(t, testDoc).Tag; got != format1Tag(4) {
		t.Fatalf("stored tag = %+v", got)
	}
	if frames := r.store.Frames(t, testDoc); len(frames) != 1 || string(frames[0]) != string(update) {
		t.Fatal("the format-1 frames changed")
	}
}

func TestAnEmptyFormat1WorkingSetSeedsInTheCurrentFormat(t *testing.T) {
	r := migrationRoomFor(t)
	r.store.Seed(t, testDoc, nil, format1Tag(4))
	canonical, err := os.ReadFile(filepath.Join(collabtest.Path(t, "collab-format1"), migrationRoom, "canonical.json"))
	if err != nil {
		t.Fatal(err)
	}
	r.endpoint.HoldsDocument(t, testDoc, `{"blocks":`+string(canonical)+`}`, nil)
	member := v2Member()
	joinSynced(t, r.migrationManager(t, runtimeReader(t), false), testDoc, member)

	if got := controlTag(t, member).Format; got != workingset.CurrentFormat {
		t.Fatalf("format %d", got)
	}
	if got := r.store.Stored(t, testDoc).Tag.Format; got != workingset.CurrentFormat {
		t.Fatalf("stored format %d", got)
	}
	assertMigrated(t, replay(t, r.store.Frames(t, testDoc)))
}

func TestAFormat1WorkingSetIsMigratedWhenTheJournalAdoptsIt(t *testing.T) {
	r := migrationRoomFor(t)
	r.store.Seed(t, testDoc, [][]byte{format1Update(t)}, format1Tag(4))
	member := v2Member()
	joinSynced(t, r.migrationManager(t, runtimeReader(t), true), testDoc, member)

	head := r.operations.Head(testDoc)
	if head.Format != workingset.CurrentFormat || head.Epoch != 5 || head.Lineage == tagLineage {
		t.Fatalf("head = %+v", head)
	}
	if got := controlTag(t, member).Lineage; got != head.Lineage {
		t.Fatalf("lineage %s, want %s", got, head.Lineage)
	}
	assertMigrated(t, replay(t, baselineFrames(t, r)))
}

func TestAJournalResetStampsTheCurrentFormat(t *testing.T) {
	r := migrationRoomFor(t)
	seedFormat1Journal(t, r, workingset.HTMLRichTextFormat, format1Update(t), false)

	result, err := r.migrationManager(t, runtimeReader(t), true).Reset(context.Background(), testDoc)
	if err != nil || result.Status != ResetDone || result.Tag == nil {
		t.Fatalf("reset = %+v, %v", result, err)
	}
	if result.Tag.Format != workingset.CurrentFormat || result.Tag.Epoch != 5 {
		t.Fatalf("tag = %+v", result.Tag)
	}
	if got := r.operations.Head(testDoc).Format; got != workingset.CurrentFormat {
		t.Fatalf("head format %d", got)
	}
}

func TestAWorkingSetResetStampsTheCurrentFormat(t *testing.T) {
	r := migrationRoomFor(t)
	r.store.Seed(t, testDoc, [][]byte{format1Update(t)}, format1Tag(4))

	result, err := r.migrationManager(t, runtimeReader(t), false).Reset(context.Background(), testDoc)
	if err != nil || result.Status != ResetDone || result.Tag == nil {
		t.Fatalf("reset = %+v, %v", result, err)
	}
	if result.Tag.Format != workingset.CurrentFormat {
		t.Fatalf("tag = %+v", result.Tag)
	}
	if got := r.store.Stored(t, testDoc).Tag.Format; got != workingset.CurrentFormat {
		t.Fatalf("stored format %d", got)
	}
}

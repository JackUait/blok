package room

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"iter"
	"math"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab"
	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/internal/collab/wire"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/jsruntime"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// Twins of C# CollabHistoryManagerTests, CollabRestorePlannerTests and
// CollabVersionChangesTests cases that had no Go twin.

const (
	histDoc = "doc-1"
	// C#: with a 5-byte client id varint this restore's frame is exactly
	// the 2048 limit.
	histBorderlineText = 1884
	histOp             = "a0000000000000000000000000000000"
	histOpRestore      = "b0000000000000000000000000000000"
	histOpOther        = "c0000000000000000000000000000000"
)

var (
	histEpoch = time.Unix(0, 0).UTC()
	// C# ManualTimeProvider's start, so edit stamps encode at the same width.
	histNow = time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)

	histPoolOnce sync.Once
	histPool     *jsruntime.Pool
	histPoolErr  error
	histNextID   atomic.Uint64
)

func histReader(t *testing.T) convert.HTMLReader {
	t.Helper()
	histPoolOnce.Do(func() { histPool, histPoolErr = jsruntime.NewPool(jsruntime.Options{PoolSize: new(1)}) })
	if histPoolErr != nil {
		t.Fatal(histPoolErr)
	}
	return convert.RuntimeHTMLReader{Runtime: histPool}
}

func histConverter(t *testing.T, reader convert.HTMLReader) *convert.DocConverter {
	t.Helper()
	if reader == nil {
		reader = histReader(t)
	}
	return &convert.DocConverter{Now: func() time.Time { return histNow }, HTML: reader}
}

// The built-in journal takes 32 lowercase hex characters only.
func histID() string { return fmt.Sprintf("%032x", histNextID.Add(1)) }

// histJournal is the built-in journal with record and lineage times set to
// the C# fake's clock: record N at the epoch plus N spacings, every lineage
// created at the epoch.
type histJournal struct {
	LocalJournal
	mu               sync.Mutex
	spacing          time.Duration
	unknownCreatedAt bool
	// corrupt, when not 0, is a record whose update reads cut in half.
	corrupt uint64
}

func (j *histJournal) spacingNow() time.Duration {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.spacing
}

func (j *histJournal) ListLineages(ctx context.Context, docID string) ([]journal.LineageInfo, error) {
	j.mu.Lock()
	unknown := j.unknownCreatedAt
	j.mu.Unlock()
	lineages, err := j.Store.ListLineages(ctx, docID)
	for i := range lineages {
		at := histEpoch
		lineages[i].CreatedAt = &at
		if unknown {
			lineages[i].CreatedAt = nil
		}
	}
	return lineages, err
}

func (j *histJournal) ReadHeaders(ctx context.Context, docID, lineage string) iter.Seq2[journal.RecordHeader, error] {
	spacing, inner := j.spacingNow(), j.Store.ReadHeaders(ctx, docID, lineage)
	return func(yield func(journal.RecordHeader, error) bool) {
		for header, err := range inner {
			if err == nil {
				header.CommittedAt = histEpoch.Add(spacing * time.Duration(header.Sequence))
			}
			if !yield(header, err) {
				return
			}
		}
	}
}

func (j *histJournal) ReadRecords(ctx context.Context, docID, lineage string, through uint64) iter.Seq2[operation.Record, error] {
	spacing, inner := j.spacingNow(), j.Store.ReadRecords(ctx, docID, lineage, through)
	j.mu.Lock()
	corrupt := j.corrupt
	j.mu.Unlock()
	return func(yield func(operation.Record, error) bool) {
		for record, err := range inner {
			if err == nil {
				record.CommittedAt = histEpoch.Add(spacing * time.Duration(record.Sequence))
				if record.Sequence == corrupt {
					record.Update = slices.Clone(record.Update[:len(record.Update)/2])
				}
			}
			if !yield(record, err) {
				return
			}
		}
	}
}

type histBench struct {
	journal  *histJournal
	store    *fakeWorkingSet
	endpoint *fakeEndpoint
}

func histNewBench(t *testing.T) *histBench {
	t.Helper()
	store, err := journal.NewStore(t.TempDir(), journal.StoreOptions{})
	if err != nil {
		t.Fatal(err)
	}
	b := &histBench{
		journal: &histJournal{LocalJournal: LocalJournal{Store: store}, spacing: time.Second},
		store:   newFakeWorkingSet(), endpoint: newFakeEndpoint(),
	}
	b.endpoint.HoldsDocument(t, histDoc, `{"blocks":[`+histParagraph(t, "a", "one")+`]}`, nil)
	return b
}

func (b *histBench) manager(t *testing.T, o Options) *Manager {
	t.Helper()
	return b.managerOver(t, b.journal, o, histConverter(t, nil))
}

func (b *histBench) managerOver(t *testing.T, operations OperationStore, o Options, converter Converter) *Manager {
	t.Helper()
	if o.Now == nil {
		o.Now = func() time.Time { return histNow }
	}
	manager := NewManager(ManagerOptions{
		Store: b.store, Endpoint: b.endpoint, Converter: converter, Room: o, Log: func(string) {}, Operations: operations,
	})
	t.Cleanup(func() { _ = manager.Drain(context.Background()) })
	return manager
}

func (b *histBench) lineage(t *testing.T) string {
	t.Helper()
	lineages, err := b.journal.Store.ListLineages(context.Background(), histDoc)
	if err != nil {
		t.Fatal(err)
	}
	for _, lineage := range lineages {
		if lineage.Current {
			return lineage.Lineage
		}
	}
	t.Fatal("no current lineage")
	return ""
}

func histRecords(t *testing.T, history HistoryStore, lineage string, through uint64) []operation.Record {
	t.Helper()
	var records []operation.Record
	for record, err := range history.ReadRecords(context.Background(), histDoc, lineage, through) {
		if err != nil {
			t.Fatal(err)
		}
		records = append(records, record)
	}
	return records
}

func (b *histBench) committed(t *testing.T) []operation.Record {
	t.Helper()
	return histRecords(t, b.journal, b.lineage(t), math.MaxUint64)
}

func histParagraph(t *testing.T, id, text string) string {
	t.Helper()
	return `{"id":` + strconv.Quote(id) + `,"type":"paragraph","data":` + textJSON(t, text) + `}`
}

func histUpdate(t *testing.T, id, text string) convert.EditOp {
	return convert.Update{ID: id, Data: node(t, textJSON(t, text))}
}

func histInsert(t *testing.T, id, text, after string) convert.EditOp {
	return convert.Insert{ID: id, Block: node(t, `{"type":"paragraph","data":`+textJSON(t, text)+`}`), After: &after}
}

func histInsertSegments(t *testing.T, id, text, after string) convert.EditOp {
	return convert.Insert{ID: id, Block: node(t, `{"type":"paragraph","data":{"text":[`+textJSON(t, text)+`]}}`), After: &after}
}

func histEditOps(t *testing.T, manager *Manager, ops []convert.EditOp, actor string) {
	t.Helper()
	digest, err := convert.CanonicalBodyDigest(ops)
	if err != nil {
		t.Fatal(err)
	}
	result, err := manager.Edit(context.Background(), histDoc, ops, histID(), digest, actor, nil)
	if err != nil || result.Status != EditApplied {
		t.Fatalf("edit = %v, %v (%v)", result.Status, err, result.Err)
	}
}

func histEdit(t *testing.T, manager *Manager, op convert.EditOp) {
	t.Helper()
	histEditOps(t, manager, []convert.EditOp{op}, "")
}

func histParse(t *testing.T, data []byte) *jsjson.Object {
	t.Helper()
	value, err := jsjson.Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	object, ok := value.(*jsjson.Object)
	if !ok {
		t.Fatalf("not an object: %s", data)
	}
	return object
}

func histHas(object *jsjson.Object, key string) bool {
	_, ok := object.Get(jsjson.FromString(key))
	return ok
}

func histString(object *jsjson.Object, key string) string {
	value, _ := object.Get(jsjson.FromString(key))
	if s, ok := value.(jsjson.Str); ok {
		return s.String()
	}
	return fmt.Sprintf("<%v>", value)
}

// histBlocks loads the room if needed and answers its exported blocks.
func histBlocks(t *testing.T, manager *Manager) []any {
	t.Helper()
	state, err := manager.State(context.Background(), histDoc)
	if err != nil || state.Status != StateReady {
		t.Fatalf("state = %v, %v (%v)", state.Status, err, state.Err)
	}
	blocks, _ := histParse(t, state.JSON).Get(jsjson.FromString("blocks"))
	items, ok := blocks.([]any)
	if !ok {
		t.Fatalf("blocks = %v", blocks)
	}
	return items
}

func histReset(t *testing.T, manager *Manager) {
	t.Helper()
	if result, err := manager.Reset(context.Background(), histDoc); err != nil || result.Status != ResetDone {
		t.Fatalf("reset = %v, %v", result.Status, err)
	}
}

func histPurge(t *testing.T, manager *Manager) {
	t.Helper()
	if _, err := manager.Purge(context.Background(), histDoc, func(context.Context) (bool, error) { return true, nil }); err != nil {
		t.Fatal(err)
	}
}

func histRestore(t *testing.T, manager *Manager, lineage string, sequence uint64, operationID string) (HistoryStatus, *EditResult) {
	t.Helper()
	return histRestoreAs(t, manager, lineage, sequence, operationID, "", nil)
}

func histRestoreAs(t *testing.T, manager *Manager, lineage string, sequence uint64, operationID, actor string, expect *Precondition) (HistoryStatus, *EditResult) {
	t.Helper()
	status, edit, err := manager.Restore(context.Background(), histDoc, lineage, sequence, operationID, actor, expect)
	if err != nil {
		t.Fatal(err)
	}
	return status, edit
}

func histRead(t *testing.T, manager *Manager, lineage string, sequence uint64) HistoryRead {
	t.Helper()
	read, err := manager.ReadVersion(context.Background(), histDoc, lineage, sequence)
	if err != nil {
		t.Fatal(err)
	}
	return read
}

func histChanges(t *testing.T, manager *Manager, lineage string, sequence, since uint64, maxRecords int, maxBytes int64) HistoryChanges {
	t.Helper()
	changes, err := manager.Changes(context.Background(), histDoc, lineage, sequence, since, maxRecords, maxBytes)
	if err != nil {
		t.Fatal(err)
	}
	return changes
}

// histCanonical is JSON with object keys sorted, for JsonNode.DeepEquals.
func histCanonical(t *testing.T, value any) string {
	t.Helper()
	var sorted func(any) any
	sorted = func(value any) any {
		switch v := value.(type) {
		case *jsjson.Object:
			members := slices.Clone(v.Members())
			sort.Slice(members, func(i, j int) bool { return members[i].Key.String() < members[j].Key.String() })
			out := &jsjson.Object{}
			for _, member := range members {
				out.Set(member.Key, sorted(member.Value))
			}
			return out
		case []any:
			out := make([]any, len(v))
			for i, item := range v {
				out[i] = sorted(item)
			}
			return out
		}
		return value
	}
	text, err := jsjson.Stringify(sorted(value))
	if err != nil {
		t.Fatal(err)
	}
	return text
}

func histWithoutStamps(blocks []any) []any {
	out := make([]any, len(blocks))
	for i, block := range blocks {
		object, ok := block.(*jsjson.Object)
		if !ok {
			out[i] = block
			continue
		}
		copied := &jsjson.Object{}
		for _, member := range object.Members() {
			if key := member.Key.String(); key != "lastEditedAt" && key != "lastEditedBy" {
				copied.Set(member.Key, member.Value)
			}
		}
		out[i] = copied
	}
	return out
}

func histSyncUpdates(t *testing.T, member *fakeMember) int {
	t.Helper()
	count := 0
	for _, message := range member.messages(t) {
		if _, ok := message.(wire.SyncUpdate); ok {
			count++
		}
	}
	return count
}

// histTitleWriter is a v2 peer that writes only the page map, so its own
// map items chain in order.
type histTitleWriter struct {
	membership collab.Membership
	member     *fakeMember
	client     *yjs.Doc
}

func histNewTitleWriter(t *testing.T, manager *Manager) *histTitleWriter {
	t.Helper()
	member := v2Member()
	return &histTitleWriter{membership: joinSynced(t, manager, histDoc, member), member: member, client: newClient()}
}

func (w *histTitleWriter) acks(t *testing.T) int {
	t.Helper()
	count := 0
	for _, message := range w.member.messages(t) {
		if _, ok := message.(wire.Acknowledgement); ok {
			count++
		}
	}
	return count
}

func (w *histTitleWriter) write(t *testing.T, key string, value any) {
	t.Helper()
	page := w.client.GetMap(jsjson.FromString("page"))
	update := w.client.Transact(func(tx *yjs.Transaction) { page.Set(tx, jsjson.FromString(key), value) })
	committed := w.acks(t)
	sendOperation(t, w.membership, w.member, histID(), update)
	if got := w.acks(t); got != committed+1 {
		t.Fatalf("the %s write got %d acks, want %d", key, got, committed+1)
	}
}

// --- CollabHistoryManagerTests ---

func TestAGroupWindowReplacesTheDefaultGrouping(t *testing.T) {
	b := histNewBench(t)
	b.journal.spacing = 90 * time.Second
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	for _, text := range []string{"1", "2", "3"} {
		histEdit(t, manager, histUpdate(t, "a", text))
	}

	byDefault, err := manager.History(context.Background(), histDoc, 0)
	if err != nil {
		t.Fatal(err)
	}
	byMinute, err := manager.History(context.Background(), histDoc, time.Minute)
	if err != nil {
		t.Fatal(err)
	}

	sequences := func(list HistoryList) []uint64 {
		var out []uint64
		for _, version := range list.Versions {
			out = append(out, version.Sequence)
		}
		return out
	}
	if got := sequences(byDefault); !slices.Equal(got, []uint64{3, 0}) {
		t.Fatalf("by default = %v, want [3 0]", got)
	}
	if got := sequences(byMinute); !slices.Equal(got, []uint64{3, 2, 1, 0}) {
		t.Fatalf("by minute = %v, want [3 2 1 0]", got)
	}
}

func histThreeEdits(t *testing.T) (*histBench, *Manager) {
	t.Helper()
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	histEdit(t, manager, histUpdate(t, "a", "two"))
	histEdit(t, manager, histInsert(t, "b", "three", "a"))
	histEdit(t, manager, convert.Remove{ID: "a"})
	return b, manager
}

func TestChangesPastTheCapAreTheNewestAndSaySo(t *testing.T) {
	b, manager := histThreeEdits(t)

	result := histChanges(t, manager, b.lineage(t), 3, 0, 2, MaxChangeBytes)

	if result.Status != HistoryReady || !result.Truncated {
		t.Fatalf("status %v, truncated %v", result.Status, result.Truncated)
	}
	var sequences []uint64
	for _, change := range result.Changes {
		sequences = append(sequences, change.Sequence)
	}
	if !slices.Equal(sequences, []uint64{2, 3}) {
		t.Fatalf("sequences = %v, want [2 3]", sequences)
	}
	if blocks := result.Changes[0].Blocks; len(blocks) != 1 || blocks[0].Kind != BlockAdded {
		t.Fatalf("record 2 = %+v, want one added block", blocks)
	}
}

func histAssertPurgedEverywhere(t *testing.T, manager *Manager, lineage string) {
	t.Helper()
	ctx := context.Background()
	if list, err := manager.History(ctx, histDoc, 0); err != nil || list.Status != HistoryPurged {
		t.Errorf("history = %v, %v", list.Status, err)
	}
	if read := histRead(t, manager, lineage, 0); read.Status != HistoryPurged {
		t.Errorf("read = %v", read.Status)
	}
	if status, _, err := manager.DeleteLineage(ctx, histDoc, lineage); err != nil || status != HistoryPurged {
		t.Errorf("delete = %v, %v", status, err)
	}
	if status, _ := histRestore(t, manager, lineage, 0, histOp); status != HistoryPurged {
		t.Errorf("restore = %v", status)
	}
	if changes := histChanges(t, manager, lineage, 0, 0, MaxChangeRecords, MaxChangeBytes); changes.Status != HistoryPurged {
		t.Errorf("changes = %v", changes.Status)
	}
}

func TestAPurgedDocumentAnswersPurgedFromEveryMethod(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	lineage := b.lineage(t)
	histPurge(t, manager)

	histAssertPurgedEverywhere(t, manager, lineage)
}

func TestAFreshManagerSeesAPurgeFromAnEarlierProcess(t *testing.T) {
	b := histNewBench(t)
	earlier := b.manager(t, DefaultOptions())
	histBlocks(t, earlier)
	lineage := b.lineage(t)
	histPurge(t, earlier)
	manager := b.manager(t, DefaultOptions())

	histAssertPurgedEverywhere(t, manager, lineage)
}

func TestAVersionReadCarriesThePageMapsAndOmitsEmptyOnes(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	titles := histNewTitleWriter(t, manager)
	titles.write(t, "title", jsjson.FromString("Old"))
	titles.write(t, "title", jsjson.FromString("New"))

	old := histParse(t, histRead(t, manager, b.lineage(t), 1).JSON)
	baseline := histParse(t, histRead(t, manager, b.lineage(t), 0).JSON)

	// The title is read once, at the top level, so a page map holding only
	// it adds no page object.
	if got := histString(old, "title"); got != "Old" {
		t.Fatalf("title = %q", got)
	}
	for name, body := range map[string]*jsjson.Object{"old": old, "baseline": baseline} {
		if histHas(body, "page") || histHas(body, "values") {
			t.Errorf("%s carries an empty map: %s", name, histCanonical(t, body))
		}
	}
}

// A peer can put bytes inside an icon. The read leaves that icon out
// instead of failing, the same as the export does.
func TestAVersionReadSkipsAnIconThatIsNotJson(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	writer := histNewTitleWriter(t, manager)
	icon := &jsjson.Object{}
	icon.Set(jsjson.FromString("type"), jsjson.FromString("emoji"))
	icon.Set(jsjson.FromString("value"), jsjson.FromString("x"))
	icon.Set(jsjson.FromString("raw"), []byte{1, 2})
	writer.write(t, "title", jsjson.FromString("Plan"))
	writer.write(t, "icon", icon)

	read := histRead(t, manager, b.lineage(t), 2)

	if read.Status != HistoryReady {
		t.Fatalf("read = %v", read.Status)
	}
	body := histParse(t, read.JSON)
	if got := histString(body, "title"); got != "Plan" {
		t.Fatalf("title = %q", got)
	}
	if histHas(body, "icon") || histHas(body, "page") {
		t.Fatalf("read = %s", read.JSON)
	}
}

func TestARetryAfterItsLineageWasDeletedGetsTheFirstReceipt(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	histEdit(t, manager, histUpdate(t, "a", "old"))
	old := b.lineage(t)
	histReset(t, manager)
	_, first := histRestore(t, manager, old, 1, histOpRestore)
	if first == nil || first.Status != EditApplied {
		t.Fatalf("first restore = %+v", first)
	}
	if status, outcome, err := manager.DeleteLineage(context.Background(), histDoc, old); err != nil ||
		status != HistoryReady || outcome != journal.LineageDeletedOutcome {
		t.Fatalf("delete = %v, %v, %v", status, outcome, err)
	}

	retryStatus, retry := histRestore(t, manager, old, 1, histOpRestore)
	freshStatus, fresh := histRestore(t, manager, old, 1, histOpOther)

	if retryStatus != HistoryReady || retry == nil || retry.Status != EditApplied {
		t.Fatalf("retry = %v, %+v", retryStatus, retry)
	}
	if retry.Receipt.ServerSequence != first.Receipt.ServerSequence {
		t.Fatalf("retry sequence %d, first %d", retry.Receipt.ServerSequence, first.Receipt.ServerSequence)
	}
	if freshStatus != HistoryNotFound || fresh != nil {
		t.Fatalf("fresh = %v, %+v", freshStatus, fresh)
	}
}

func TestTheGateMeasuresTheFrameTheLiveApplyBroadcasts(t *testing.T) {
	ctx := context.Background()
	converter := histConverter(t, nil)
	live := yjs.NewDoc(yjs.Options{})
	if err := converter.Seed(ctx, live, node(t, `{"blocks":[`+histParagraph(t, "a", "one")+`]}`)); err != nil {
		t.Fatal(err)
	}
	// Rewrites push the live client's clock past 2^14, so its clock varints
	// are wider than a fresh client's.
	for round := range 20 {
		if err := converter.ApplyOps(ctx, live, []convert.EditOp{histUpdate(t, "a", strings.Repeat(string(rune('a'+round)), 1000))}); err != nil {
			t.Fatal(err)
		}
	}
	var ops []convert.EditOp
	for index := range 40 {
		after := "a"
		if index > 0 {
			after = "n" + strconv.Itoa(index-1)
		}
		ops = append(ops, histInsert(t, "n"+strconv.Itoa(index), "text "+strconv.Itoa(index), after))
	}

	measured, err := PlannedFrameBytes(ctx, live, converter, ops)
	if err != nil {
		t.Fatal(err)
	}
	var broadcast int64
	unsubscribe := live.OnUpdate(func(event yjs.UpdateEvent) {
		frame, err := wire.Encode(wire.SyncUpdate{Update: event.Update})
		if err != nil {
			t.Error(err)
		}
		broadcast += int64(len(frame))
	})
	defer unsubscribe()
	if err := converter.ApplyOps(ctx, live, ops); err != nil {
		t.Fatal(err)
	}

	if broadcast != measured {
		t.Fatalf("measured %d, broadcast %d", measured, broadcast)
	}
}

// histLargestReader records the longest HTML it is asked to read.
type histLargestReader struct {
	inner   convert.HTMLReader
	mu      sync.Mutex
	largest int
}

func (r *histLargestReader) Read(ctx context.Context, fields []convert.RichTextHTML, timeout *time.Duration) ([][]any, error) {
	r.mu.Lock()
	for _, field := range fields {
		r.largest = max(r.largest, len(field.HTML))
	}
	r.mu.Unlock()
	return r.inner.Read(ctx, fields, timeout)
}

func TestARestorePastTheStoreLimitButUnderTheMessageLimitIsRefusedAndTheRoomStaysOpen(t *testing.T) {
	const mib = 1 << 20
	b := histNewBench(t)
	local, err := journal.NewStore(t.TempDir(), journal.StoreOptions{})
	if err != nil {
		t.Fatal(err)
	}
	reader := &histLargestReader{inner: histReader(t)}
	manager := b.managerOver(t, LocalJournal{Store: local}, OptionsWith(func(ro *Options) { ro.AnnouncedMaxMessageBytes = 4 * mib; ro.MaxUpdateBytes = local.MaxUpdateBytes() }), histConverter(t, reader))
	histBlocks(t, manager)
	member := v2Member()
	joinSynced(t, manager, histDoc, member)
	// Three inserts under the store's 1 MiB limit add up to a 1.5 MiB point.
	// Segments, not HTML, so no 0.5 MiB string goes through the runtime.
	histEdit(t, manager, histInsertSegments(t, "b1", strings.Repeat("x", mib/2), "a"))
	histEdit(t, manager, histInsertSegments(t, "b2", strings.Repeat("y", mib/2), "b1"))
	histEdit(t, manager, histInsertSegments(t, "b3", strings.Repeat("z", mib/2), "b2"))
	histEditOps(t, manager, []convert.EditOp{convert.Remove{ID: "b1"}, convert.Remove{ID: "b2"}, convert.Remove{ID: "b3"}}, "")
	list, err := manager.History(context.Background(), histDoc, 0)
	if err != nil || len(list.Lineages) == 0 {
		t.Fatalf("history = %+v, %v", list, err)
	}
	lineage := list.Lineages[len(list.Lineages)-1].Lineage

	_, restore := histRestore(t, manager, lineage, 3, histID())

	if restore == nil || restore.Status != EditTooLarge {
		t.Fatalf("restore = %+v", restore)
	}
	if closes := member.closed(); len(closes) != 0 {
		t.Fatalf("the refused restore closed %v", closes)
	}
	histEdit(t, manager, histUpdate(t, "a", "after"))
	if closes := member.closed(); len(closes) != 0 {
		t.Fatalf("the edit after closed %v", closes)
	}
	// A 0.5 MiB HTML read takes seconds against the runtime's budget.
	reader.mu.Lock()
	defer reader.mu.Unlock()
	if reader.largest > 64 {
		t.Fatalf("the largest HTML read was %d units", reader.largest)
	}
}

func TestARestoreJustUnderTheFrameLimitIsApplied(t *testing.T) {
	const limit = 2048
	b := histNewBench(t)
	manager := b.manager(t, OptionsWith(func(ro *Options) { ro.AnnouncedMaxMessageBytes = limit }))
	histBlocks(t, manager)
	histEdit(t, manager, histInsert(t, "big", strings.Repeat("x", histBorderlineText), "a"))
	histEdit(t, manager, convert.Remove{ID: "big"})

	_, result := histRestore(t, manager, b.lineage(t), 1, histOp)

	if result == nil || result.Status != EditApplied {
		t.Fatalf("restore = %+v", result)
	}
	committed := b.committed(t)
	frame, err := wire.Encode(wire.SyncUpdate{Update: committed[len(committed)-1].Update})
	if err != nil {
		t.Fatal(err)
	}
	if len(frame) < limit-64 || len(frame) > limit {
		t.Fatalf("the restore frame is %d bytes, want %d..%d", len(frame), limit-64, limit)
	}
}

func TestARestoreOfTheCurrentPointWritesNothing(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	histEdit(t, manager, histUpdate(t, "a", "A"))
	histEdit(t, manager, histInsert(t, "b", "B", "a"))

	_, result := histRestore(t, manager, b.lineage(t), 2, histOp)

	if result == nil || result.Status != EditApplied || result.Receipt.ServerSequence != 2 {
		t.Fatalf("restore = %+v", result)
	}
	if n := len(b.committed(t)); n != 2 {
		t.Fatalf("%d records, want 2", n)
	}
}

func TestARestoreBringsBackTheTitleWithTheBlocksInOneRecord(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	titles := histNewTitleWriter(t, manager)
	titles.write(t, "title", jsjson.FromString("Old"))
	histEdit(t, manager, histUpdate(t, "a", "A"))
	point := histBlocks(t, manager)
	titles.write(t, "title", jsjson.FromString("New"))
	histEdit(t, manager, histUpdate(t, "a", "B"))

	_, result := histRestore(t, manager, b.lineage(t), 2, histOpRestore)

	if result == nil || result.Status != EditApplied || result.Receipt.ServerSequence != 5 {
		t.Fatalf("restore = %+v", result)
	}
	if n := len(b.committed(t)); n != 5 {
		t.Fatalf("%d records, want 5", n)
	}
	lineage := b.lineage(t)
	baseline, ok, err := b.journal.ReadBaseline(context.Background(), histDoc, lineage)
	if err != nil || !ok {
		t.Fatalf("baseline: %v, %v", ok, err)
	}
	live, err := convert.BuildReplay(context.Background(), baseline, b.journal.ReadRecords(context.Background(), histDoc, lineage, 5))
	if err != nil {
		t.Fatal(err)
	}
	title, _ := live.GetMap(jsjson.FromString("page")).Get(jsjson.FromString("title"))
	if s, ok := title.(jsjson.Str); !ok || s.String() != "Old" {
		t.Fatalf("title = %v", title)
	}
	if got, want := histCanonical(t, histWithoutStamps(histBlocks(t, manager))), histCanonical(t, histWithoutStamps(point)); got != want {
		t.Fatalf("blocks = %s, want %s", got, want)
	}
}

func TestARestoreWhoseTitleIsTooLargeForOneFrameChangesNothing(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, OptionsWith(func(ro *Options) { ro.AnnouncedMaxMessageBytes = 2048 }))
	histBlocks(t, manager)
	titles := histNewTitleWriter(t, manager)
	titles.write(t, "title", jsjson.FromString(strings.Repeat("x", 8192)))
	titles.write(t, "title", jsjson.FromString("short"))
	before := histCanonical(t, histBlocks(t, manager))

	_, result := histRestore(t, manager, b.lineage(t), 1, histOp)

	if result == nil || result.Status != EditTooLarge {
		t.Fatalf("restore = %+v", result)
	}
	if n := len(b.committed(t)); n != 2 {
		t.Fatalf("%d records, want 2", n)
	}
	if closes := titles.member.closed(); len(closes) != 0 {
		t.Fatalf("the refused restore closed %v", closes)
	}
	if after := histCanonical(t, histBlocks(t, manager)); after != before {
		t.Fatalf("blocks = %s, want %s", after, before)
	}
	histEdit(t, manager, histUpdate(t, "a", "after"))
	if closes := titles.member.closed(); len(closes) != 0 {
		t.Fatalf("the edit after closed %v", closes)
	}
}

// --- CollabRestorePlannerTests ---

func histSeeded(t *testing.T, blocks ...string) *yjs.Doc {
	t.Helper()
	doc := yjs.NewDoc(yjs.Options{})
	if err := histConverter(t, nil).Seed(context.Background(), doc, node(t, `{"blocks":[`+strings.Join(blocks, ",")+`]}`)); err != nil {
		t.Fatal(err)
	}
	return doc
}

func histExport(t *testing.T, doc *yjs.Doc) []any {
	t.Helper()
	output, err := histConverter(t, nil).Export(context.Background(), doc)
	if err != nil {
		t.Fatal(err)
	}
	blocks, _ := output.Get(jsjson.FromString("blocks"))
	items, _ := blocks.([]any)
	return items
}

// histTarget is a target as a replay hands it over: the export of a seeded doc.
func histTarget(t *testing.T, blocks ...string) []any {
	t.Helper()
	return histExport(t, histSeeded(t, blocks...))
}

func histP(t *testing.T, id, parent string) string {
	t.Helper()
	block := `{"id":` + strconv.Quote(id) + `,"type":"paragraph","data":` + textJSON(t, id)
	if parent != "" {
		block += `,"parent":` + strconv.Quote(parent)
	}
	return block + "}"
}

func histOutline(t *testing.T, blocks []any) []string {
	t.Helper()
	var out []string
	for _, block := range blocks {
		object := block.(*jsjson.Object)
		id := histString(object, "id")
		if histHas(object, "parent") {
			id += "<" + histString(object, "parent")
		}
		out = append(out, id)
	}
	return out
}

// histRestoreBlocks plans against doc, applies the plan, checks the export
// equals the normalized target (edit stamps aside) and answers that export.
func histRestoreBlocks(t *testing.T, doc *yjs.Doc, target []any) []any {
	t.Helper()
	current := histExport(t, doc)
	expected := histCanonical(t, histWithoutStamps(NormalizeTarget(target)))
	// Otherwise an empty plan would pass.
	if expected == histCanonical(t, histWithoutStamps(current)) {
		t.Fatal("the target already equals the doc")
	}
	ops := PlanRestore(current, convert.DescribeStructure(doc), target, nil, nil)
	if err := histConverter(t, nil).ApplyOps(context.Background(), doc, ops); err != nil {
		t.Fatal(err)
	}
	after := histExport(t, doc)
	if got := histCanonical(t, histWithoutStamps(after)); got != expected {
		t.Fatalf("after = %s, want %s", got, expected)
	}
	return after
}

func histBlockMap(t *testing.T, doc *yjs.Doc, id string) *yjs.Map {
	t.Helper()
	value, _ := doc.GetMap(jsjson.FromString("blocks")).Get(jsjson.FromString(id))
	block, ok := value.(*yjs.Map)
	if !ok {
		t.Fatalf("%s is %T", id, value)
	}
	return block
}

func histExpectOutline(t *testing.T, blocks []any, want ...string) {
	t.Helper()
	if got := histOutline(t, blocks); !slices.Equal(got, want) {
		t.Fatalf("outline = %v, want %v", got, want)
	}
}

// The export reads a self-parent as root, but the edit planner reads the
// stored value, so nothing can be inserted after that block.
func TestReplacesARootBlockWhoseStoredParentIsItself(t *testing.T) {
	doc := histSeeded(t, histP(t, "a", ""), histP(t, "x", ""))
	block := histBlockMap(t, doc, "x")
	doc.Transact(func(tx *yjs.Transaction) { block.Set(tx, jsjson.FromString("parentId"), jsjson.FromString("x")) })

	after := histRestoreBlocks(t, doc, histTarget(t, histP(t, "a", ""), histP(t, "x", ""), histP(t, "n", "")))

	histExpectOutline(t, after, "a", "x", "n")
}

func TestReplacesANonBlockKeyWhoseIdTheTargetUses(t *testing.T) {
	doc := histSeeded(t, histP(t, "a", ""))
	blocks := doc.GetMap(jsjson.FromString("blocks"))
	doc.Transact(func(tx *yjs.Transaction) { blocks.Set(tx, jsjson.FromString("x"), jsjson.FromString("not a block")) })

	after := histRestoreBlocks(t, doc, histTarget(t, histP(t, "a", ""), histP(t, "x", "")))

	histExpectOutline(t, after, "a", "x")
}

func TestGivesAChildToAParentWithoutAChildrenList(t *testing.T) {
	doc := histSeeded(t, histP(t, "p", ""), histP(t, "q", ""))
	block := histBlockMap(t, doc, "p")
	doc.Transact(func(tx *yjs.Transaction) { block.Delete(tx, jsjson.FromString("contentIds")) })

	after := histRestoreBlocks(t, doc, histTarget(t,
		`{ "id": "p", "type": "paragraph", "data": { "text": "p" }, "content": ["k"] }`,
		histP(t, "k", "p"),
		histP(t, "q", "")))

	histExpectOutline(t, after, "p", "k<p", "q")
}

func histPlanWithMaps(t *testing.T, doc, target *yjs.Doc) []convert.EditOp {
	t.Helper()
	return PlanRestore(histExport(t, doc), convert.DescribeStructure(doc), histExport(t, target),
		convert.ReadPageMaps(doc), convert.ReadPageMaps(target))
}

func histSetMap(doc *yjs.Doc, name, key string, value any) {
	m := doc.GetMap(jsjson.FromString(name))
	doc.Transact(func(tx *yjs.Transaction) { m.Set(tx, jsjson.FromString(key), value) })
}

func histIcon(emoji string) *jsjson.Object {
	icon := &jsjson.Object{}
	icon.Set(jsjson.FromString("type"), jsjson.FromString("emoji"))
	icon.Set(jsjson.FromString("value"), jsjson.FromString(emoji))
	return icon
}

func TestLeavesAKeyAloneWhenTheTargetHoldsANestedTypeOrUndefined(t *testing.T) {
	doc := histSeeded(t, histP(t, "a", ""))
	target := histSeeded(t, histP(t, "a", ""))
	histSetMap(doc, "page", "title", jsjson.FromString("Live"))
	histSetMap(doc, "values", "k", 5.0)
	page, values := target.GetMap(jsjson.FromString("page")), target.GetMap(jsjson.FromString("values"))
	target.Transact(func(tx *yjs.Transaction) {
		page.Set(tx, jsjson.FromString("title"), yjs.NewText(jsjson.FromString("nested")))
		values.Set(tx, jsjson.FromString("k"), jsjson.Undefined{})
		values.Set(tx, jsjson.FromString("absent"), jsjson.Undefined{})
	})

	if ops := histPlanWithMaps(t, doc, target); len(ops) != 0 {
		t.Fatalf("ops = %#v, want none", ops)
	}
}

func TestPlansNothingForEqualMaps(t *testing.T) {
	doc := histSeeded(t, histP(t, "a", ""))
	target := histSeeded(t, histP(t, "a", ""))
	for _, side := range []*yjs.Doc{doc, target} {
		histSetMap(side, "page", "title", jsjson.FromString("Same"))
		histSetMap(side, "values", "k", histIcon("🌿"))
	}

	if ops := histPlanWithMaps(t, doc, target); len(ops) != 0 {
		t.Fatalf("ops = %#v, want none", ops)
	}
}

// --- CollabVersionChangesTests ---

func histChangeRecords(updates ...[]byte) iter.Seq2[operation.Record, error] {
	return func(yield func(operation.Record, error) bool) {
		for i, update := range updates {
			sequence := uint64(i + 1)
			actor := "actor-" + strconv.FormatUint(sequence, 10)
			record := operation.Record{
				OperationID: fmt.Sprintf("%032x", sequence), Sequence: sequence,
				CommittedAt: histEpoch.Add(time.Duration(sequence) * time.Minute), ActorID: &actor,
				Source: operation.SourceHTTPEdit, Update: update, Digest: make([]byte, 32),
			}
			if !yield(record, nil) {
				return
			}
		}
	}
}

func histHTMLBlock(id, html string) *yjs.Map {
	return yjs.NewMap(
		yjs.MapEntry{Key: jsjson.FromString("id"), Value: jsjson.FromString(id)},
		yjs.MapEntry{Key: jsjson.FromString("type"), Value: jsjson.FromString("paragraph")},
		yjs.MapEntry{Key: jsjson.FromString("data"), Value: yjs.NewMap(
			yjs.MapEntry{Key: jsjson.FromString("text"), Value: yjs.NewText(jsjson.FromString(html))})},
		yjs.MapEntry{Key: jsjson.FromString("tunes"), Value: yjs.NewMap()},
		yjs.MapEntry{Key: jsjson.FromString("contentIds"), Value: yjs.NewArray()},
	)
}

func histTextOf(t *testing.T, blocks *yjs.Map, id string) *yjs.Text {
	t.Helper()
	block, _ := blocks.Get(jsjson.FromString(id))
	data, _ := block.(*yjs.Map).Get(jsjson.FromString("data"))
	text, _ := data.(*yjs.Map).Get(jsjson.FromString("text"))
	return text.(*yjs.Text)
}

func histClient(id uint32) *yjs.Doc { return yjs.NewDoc(yjs.Options{ClientID: &id}) }

func histRoots(doc *yjs.Doc, tx *yjs.Transaction, ids ...string) {
	values := make([]any, len(ids))
	for i, id := range ids {
		values[i] = jsjson.FromString(id)
	}
	doc.GetArray(jsjson.FromString("root")).Insert(tx, 0, values)
}

func histReplaceAt3(doc *yjs.Doc, text *yjs.Text, with string) []byte {
	return doc.Transact(func(tx *yjs.Transaction) {
		text.Delete(tx, 3, 1)
		text.Insert(tx, 3, jsjson.FromString(with), nil)
	})
}

// histCountingReader records every HTML it is asked to read.
type histCountingReader struct {
	inner convert.HTMLReader
	mu    sync.Mutex
	read  []string
}

func (r *histCountingReader) Read(ctx context.Context, fields []convert.RichTextHTML, timeout *time.Duration) ([][]any, error) {
	r.mu.Lock()
	for _, field := range fields {
		r.read = append(r.read, field.HTML.String())
	}
	r.mu.Unlock()
	return r.inner.Read(ctx, fields, timeout)
}

func (r *histCountingReader) sorted() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	read := slices.Clone(r.read)
	slices.Sort(read)
	return read
}

func TestASkippedBlockIsLoggedOncePerCall(t *testing.T) {
	source := histClient(1)
	blocks := source.GetMap(jsjson.FromString("blocks"))
	baseline := source.Transact(func(tx *yjs.Transaction) {
		blocks.Set(tx, jsjson.FromString("a"), histHTMLBlock("a", "x"))
		blocks.Set(tx, jsjson.FromString("bad"), yjs.NewMap(
			yjs.MapEntry{Key: jsjson.FromString("id"), Value: jsjson.FromString("bad")},
			yjs.MapEntry{Key: jsjson.FromString("type"), Value: jsjson.FromString("paragraph")},
			yjs.MapEntry{Key: jsjson.FromString("data"), Value: jsjson.FromString("not a map")},
		))
		histRoots(source, tx, "a", "bad")
	})
	aText := histTextOf(t, blocks, "a")
	u1 := source.Transact(func(tx *yjs.Transaction) { aText.Insert(tx, 1, jsjson.FromString("y"), nil) })
	u2 := source.Transact(func(tx *yjs.Transaction) { aText.Insert(tx, 2, jsjson.FromString("z"), nil) })
	var mu sync.Mutex
	var log []string
	converter := histConverter(t, nil)
	converter.Log = func(message string) {
		mu.Lock()
		defer mu.Unlock()
		log = append(log, message)
	}

	changes, err := ReplayChanges(context.Background(), [][]byte{baseline}, histChangeRecords(u1, u2), 0, converter, math.MaxInt64)

	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 2 {
		t.Fatalf("%d rows, want 2", len(changes))
	}
	mu.Lock()
	defer mu.Unlock()
	if len(log) != 1 || !strings.Contains(log[0], `"bad"`) {
		t.Fatalf("log = %q, want one line naming \"bad\"", log)
	}
}

func histDataText(t *testing.T, block *jsjson.Object) string {
	t.Helper()
	if block == nil {
		t.Fatal("no block")
	}
	data, _ := block.Get(jsjson.FromString("data"))
	text, _ := data.(*jsjson.Object).Get(jsjson.FromString("text"))
	encoded, err := jsjson.Stringify(text)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

// Format 1 keeps HTML in rich fields. Only blocks a record changed go
// through the runtime.
func TestOnlyChangedBlocksHaveTheirHtmlRead(t *testing.T) {
	source := histClient(1)
	blocks := source.GetMap(jsjson.FromString("blocks"))
	baseline := source.Transact(func(tx *yjs.Transaction) {
		blocks.Set(tx, jsjson.FromString("a"), histHTMLBlock("a", "<b>x</b>"))
		blocks.Set(tx, jsjson.FromString("b"), histHTMLBlock("b", "<i>kept</i>"))
		histRoots(source, tx, "a", "b")
	})
	edit := histReplaceAt3(source, histTextOf(t, blocks, "a"), "z")
	reader := &histCountingReader{inner: histReader(t)}

	changes, err := ReplayChanges(context.Background(), [][]byte{baseline}, histChangeRecords(edit), 0, histConverter(t, reader), math.MaxInt64)

	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 1 || len(changes[0].Blocks) != 1 {
		t.Fatalf("changes = %+v", changes)
	}
	change := changes[0].Blocks[0]
	if change.ID.String() != "a" || change.Kind != BlockChanged {
		t.Fatalf("change = %s %v", change.ID.String(), change.Kind)
	}
	if got := histDataText(t, change.Before); got != `[{"text":"x","marks":{"bold":true}}]` {
		t.Fatalf("before = %s", got)
	}
	if got := histDataText(t, change.After); got != `[{"text":"z","marks":{"bold":true}}]` {
		t.Fatalf("after = %s", got)
	}
	if got := reader.sorted(); !slices.Equal(got, []string{"<b>x</b>", "<b>z</b>"}) {
		t.Fatalf("read = %q", got)
	}
}

// A record dropped by the byte budget never sends its HTML to the runtime.
func TestRecordsPastTheByteBudgetAreDroppedOldestFirstBeforeAnyHtmlIsRead(t *testing.T) {
	source := histClient(1)
	blocks := source.GetMap(jsjson.FromString("blocks"))
	baseline := source.Transact(func(tx *yjs.Transaction) {
		blocks.Set(tx, jsjson.FromString("a"), histHTMLBlock("a", "<b>x</b>"))
		histRoots(source, tx, "a")
	})
	aText := histTextOf(t, blocks, "a")
	toY := histReplaceAt3(source, aText, "y")
	toZ := histReplaceAt3(source, aText, "z")
	reader := &histCountingReader{inner: histReader(t)}

	changes, err := ReplayChanges(context.Background(), [][]byte{baseline}, histChangeRecords(toY, toZ), 0, histConverter(t, reader), 1)

	if err != nil {
		t.Fatal(err)
	}
	if got := reader.sorted(); !slices.Equal(got, []string{"<b>y</b>", "<b>z</b>"}) {
		t.Fatalf("read = %q", got)
	}
	if len(changes) != 1 || changes[0].Sequence != 2 {
		t.Fatalf("changes = %+v, want record 2 only", changes)
	}
}

// --- Cases beyond the audit's gap list: conformance pins only part of each. ---

// histNoHistory is a journal that opens sessions and keeps no history.
type histNoHistory struct{ inner LocalJournal }

func (j histNoHistory) Open(ctx context.Context, docID string) (journal.OpenOutcome, OperationSession, error) {
	return j.inner.Open(ctx, docID)
}

func TestWithoutAHistoryStoreEveryMethodAnswersNoHistory(t *testing.T) {
	b := histNewBench(t)
	ctx := context.Background()
	for name, operations := range map[string]OperationStore{"none": nil, "journal without history": histNoHistory{b.journal.LocalJournal}} {
		manager := b.managerOver(t, operations, DefaultOptions(), histConverter(t, nil))
		if list, err := manager.History(ctx, histDoc, 0); err != nil || list.Status != HistoryNone {
			t.Errorf("%s: history = %v, %v", name, list.Status, err)
		}
		if read := histRead(t, manager, "l", 0); read.Status != HistoryNone {
			t.Errorf("%s: read = %v", name, read.Status)
		}
		if status, _, err := manager.DeleteLineage(ctx, histDoc, "l"); err != nil || status != HistoryNone {
			t.Errorf("%s: delete = %v, %v", name, status, err)
		}
		if changes := histChanges(t, manager, "l", 0, 0, MaxChangeRecords, MaxChangeBytes); changes.Status != HistoryNone {
			t.Errorf("%s: changes = %v", name, changes.Status)
		}
		if status, edit := histRestore(t, manager, "l", 0, histOp); status != HistoryNone || edit != nil {
			t.Errorf("%s: restore = %v, %+v", name, status, edit)
		}
	}
}

func histTimes(at ...*time.Time) []string {
	var out []string
	for _, a := range at {
		if a == nil {
			out = append(out, "nil")
			continue
		}
		out = append(out, a.UTC().Format(time.RFC3339))
	}
	return out
}

func TestTheListGroupsEveryLineageNewestFirst(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	first := b.lineage(t)
	histEditOps(t, manager, []convert.EditOp{histUpdate(t, "a", "1")}, "u1")
	histReset(t, manager)
	second := b.lineage(t)
	histEditOps(t, manager, []convert.EditOp{histUpdate(t, "a", "2")}, "u2")
	histEditOps(t, manager, []convert.EditOp{histUpdate(t, "a", "3")}, "u1")
	histReset(t, manager)
	third := b.lineage(t)
	histEdit(t, manager, histUpdate(t, "a", "4"))

	result, err := manager.History(context.Background(), histDoc, 0)

	if err != nil || result.Status != HistoryReady {
		t.Fatalf("history = %v, %v", result.Status, err)
	}
	var lineages, versions []string
	var current []bool
	for _, lineage := range result.Lineages {
		lineages = append(lineages, lineage.Lineage)
		current = append(current, lineage.Current)
	}
	for _, version := range result.Versions {
		versions = append(versions, version.Lineage+":"+strconv.FormatUint(version.Sequence, 10))
	}
	if !slices.Equal(lineages, []string{first, second, third}) || !slices.Equal(current, []bool{false, false, true}) {
		t.Fatalf("lineages = %v %v", lineages, current)
	}
	want := []string{third + ":1", third + ":0", second + ":2", second + ":0", first + ":1", first + ":0"}
	if !slices.Equal(versions, want) {
		t.Fatalf("versions = %v, want %v", versions, want)
	}
	grouped := result.Versions[2]
	if !slices.Equal(grouped.Actors, []string{"u2", "u1"}) {
		t.Fatalf("actors = %v", grouped.Actors)
	}
	if got := histTimes(grouped.StartedAt, grouped.SavedAt); !slices.Equal(got, histTimes(histTime(histEpoch.Add(time.Second)), histTime(histEpoch.Add(2*time.Second)))) {
		t.Fatalf("started, saved = %v", got)
	}
}

func histTime(at time.Time) *time.Time { return &at }

// Go's HistoryRead has no Time field: the time is checked in the JSON only.
func TestAReadAnswersTheExportAtThatPointWithItsTime(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	atZero := histBlocks(t, manager)
	histEdit(t, manager, histUpdate(t, "a", "two"))
	atOne := histBlocks(t, manager)
	histEdit(t, manager, histInsert(t, "b", "three", "a"))
	atTwo := histBlocks(t, manager)
	lineage := b.lineage(t)

	for sequence, expected := range [][]any{atZero, atOne, atTwo} {
		read := histRead(t, manager, lineage, uint64(sequence))

		if read.Status != HistoryReady {
			t.Fatalf("point %d: %v", sequence, read.Status)
		}
		body := histParse(t, read.JSON)
		blocks, _ := body.Get(jsjson.FromString("blocks"))
		if got, want := histCanonical(t, blocks), histCanonical(t, expected); got != want {
			t.Fatalf("point %d: %s, want %s", sequence, got, want)
		}
		at, _ := body.Get(jsjson.FromString("time"))
		if at != float64(histEpoch.Add(time.Duration(sequence)*time.Second).UnixMilli()) {
			t.Fatalf("point %d: time %v", sequence, at)
		}
	}
}

func histSequences(changes []RecordChanges) []uint64 {
	var out []uint64
	for _, change := range changes {
		out = append(out, change.Sequence)
	}
	return out
}

func histKinds(blocks []BlockChange) []string {
	var out []string
	for _, block := range blocks {
		out = append(out, block.ID.String()+":"+blockChangeKindNames[block.Kind])
	}
	return out
}

func TestChangesListEachRecordAfterSinceThroughThePointOldestFirst(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	histEditOps(t, manager, []convert.EditOp{histUpdate(t, "a", "two")}, "u1")
	histEditOps(t, manager, []convert.EditOp{histInsert(t, "b", "three", "a")}, "u2")
	histEdit(t, manager, convert.Remove{ID: "a"})
	lineage := b.lineage(t)

	all := histChanges(t, manager, lineage, 3, 0, MaxChangeRecords, MaxChangeBytes)
	fromOne := histChanges(t, manager, lineage, 3, 1, MaxChangeRecords, MaxChangeBytes)

	if all.Status != HistoryReady || all.Truncated {
		t.Fatalf("status %v, truncated %v", all.Status, all.Truncated)
	}
	if got := histSequences(all.Changes); !slices.Equal(got, []uint64{1, 2, 3}) {
		t.Fatalf("sequences = %v", got)
	}
	var actors []string
	for _, change := range all.Changes {
		actors = append(actors, show(change.ActorID))
	}
	if !slices.Equal(actors, []string{`"u1"`, `"u2"`, "null"}) {
		t.Fatalf("actors = %v", actors)
	}
	if !all.Changes[1].CommittedAt.Equal(histEpoch.Add(2 * time.Second)) {
		t.Fatalf("committed at %v", all.Changes[1].CommittedAt)
	}
	for i, want := range [][]string{{"a:changed"}, {"b:added"}, {"a:removed"}} {
		if got := histKinds(all.Changes[i].Blocks); !slices.Equal(got, want) {
			t.Fatalf("record %d = %v, want %v", i+1, got, want)
		}
	}
	if got := histDataText(t, all.Changes[2].Blocks[0].Before); got != `[{"text":"two"}]` {
		t.Fatalf("before = %s", got)
	}
	if got := histSequences(fromOne.Changes); !slices.Equal(got, []uint64{2, 3}) {
		t.Fatalf("from one = %v", got)
	}
}

func TestChangesOfAnEmptyRangeAreEmpty(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	histEdit(t, manager, histUpdate(t, "a", "two"))

	for _, window := range [][2]uint64{{0, 0}, {1, 1}} {
		result := histChanges(t, manager, b.lineage(t), window[0], window[1], MaxChangeRecords, MaxChangeBytes)

		if result.Status != HistoryReady || len(result.Changes) != 0 || result.Truncated {
			t.Fatalf("%v: %v, %d rows, truncated %v", window, result.Status, len(result.Changes), result.Truncated)
		}
	}
}

func TestChangesPastTheByteBudgetAreTheNewestAndSaySo(t *testing.T) {
	b, manager := histThreeEdits(t)

	result := histChanges(t, manager, b.lineage(t), 3, 0, MaxChangeRecords, 1)

	if result.Status != HistoryReady || !result.Truncated {
		t.Fatalf("status %v, truncated %v", result.Status, result.Truncated)
	}
	// The newest record stays even past the budget, so a reader can always page.
	if got := histSequences(result.Changes); !slices.Equal(got, []uint64{3}) {
		t.Fatalf("sequences = %v", got)
	}
	if got := histDataText(t, result.Changes[0].Blocks[0].Before); got != `[{"text":"two"}]` {
		t.Fatalf("before = %s", got)
	}
}

func TestChangesOfAnUnknownPointAreNotFound(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	histEdit(t, manager, histUpdate(t, "a", "two"))

	if status := histChanges(t, manager, b.lineage(t), 2, 0, MaxChangeRecords, MaxChangeBytes).Status; status != HistoryNotFound {
		t.Fatalf("past the head = %v", status)
	}
	if status := histChanges(t, manager, strings.Repeat("f", 32), 0, 0, MaxChangeRecords, MaxChangeBytes).Status; status != HistoryNotFound {
		t.Fatalf("an unknown lineage = %v", status)
	}
}

func TestABaselineWithAnUnknownCreatedAtHasNoTime(t *testing.T) {
	b := histNewBench(t)
	b.journal.unknownCreatedAt = true
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)

	read := histRead(t, manager, b.lineage(t), 0)

	if read.Status != HistoryReady || histHas(histParse(t, read.JSON), "time") {
		t.Fatalf("read = %v %s", read.Status, read.JSON)
	}
}

func TestAnUnknownPointIsNotFound(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	histEdit(t, manager, histUpdate(t, "a", "two"))

	if read := histRead(t, manager, b.lineage(t), 2); read.Status != HistoryNotFound {
		t.Fatalf("past the head = %v", read.Status)
	}
	if read := histRead(t, manager, strings.Repeat("f", 32), 0); read.Status != HistoryNotFound {
		t.Fatalf("an unknown lineage = %v", read.Status)
	}
	if status, edit := histRestore(t, manager, b.lineage(t), 2, histOp); status != HistoryNotFound || edit != nil {
		t.Fatalf("restore = %v, %+v", status, edit)
	}
	if n := len(b.committed(t)); n != 1 {
		t.Fatalf("%d records, want 1", n)
	}
}

func TestACorruptRecordIsCorrupt(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	histEdit(t, manager, histUpdate(t, "a", "two"))
	lineage := b.lineage(t)
	b.journal.corrupt = 1

	if read := histRead(t, manager, lineage, 1); read.Status != HistoryCorrupt {
		t.Fatalf("read 1 = %v", read.Status)
	}
	if read := histRead(t, manager, lineage, 0); read.Status != HistoryReady {
		t.Fatalf("read 0 = %v", read.Status)
	}
	if status, _ := histRestore(t, manager, lineage, 1, histOp); status != HistoryCorrupt {
		t.Fatalf("restore = %v", status)
	}
	if changes := histChanges(t, manager, lineage, 1, 0, MaxChangeRecords, MaxChangeBytes); changes.Status != HistoryCorrupt {
		t.Fatalf("changes = %v", changes.Status)
	}
}

func TestARestoreMakesTheLiveDocumentEqualThePointAsOneJournalledEdit(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	histEdit(t, manager, histUpdate(t, "a", "A"))
	pointA := histBlocks(t, manager)
	histEdit(t, manager, histInsert(t, "b", "B", "a"))
	histEdit(t, manager, convert.Remove{ID: "a"})
	lineage := b.lineage(t)

	status, result := histRestoreAs(t, manager, lineage, 1, histOpRestore, "u9", nil)

	if status != HistoryReady || result == nil || result.Status != EditApplied || result.Receipt.ServerSequence != 4 {
		t.Fatalf("restore = %v, %+v", status, result)
	}
	if got, want := histCanonical(t, histWithoutStamps(histBlocks(t, manager))), histCanonical(t, histWithoutStamps(pointA)); got != want {
		t.Fatalf("blocks = %s, want %s", got, want)
	}
	committed := b.committed(t)
	record := committed[len(committed)-1]
	if record.Sequence != 4 || record.OperationID != histOpRestore || show(record.ActorID) != `"u9"` || record.Source != operation.SourceHTTPEdit {
		t.Fatalf("record = %d %s %s %v", record.Sequence, record.OperationID, show(record.ActorID), record.Source)
	}
	digest := sha256.Sum256([]byte("restore\n" + lineage + "\n1"))
	if !bytes.Equal(record.Digest, digest[:]) {
		t.Fatalf("digest = %x", record.Digest)
	}
}

func TestARestoreReachesALineageAResetReplaced(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	histEdit(t, manager, histUpdate(t, "a", "old"))
	old := histBlocks(t, manager)
	lineage := b.lineage(t)
	histReset(t, manager)

	_, result := histRestore(t, manager, lineage, 1, histOp)

	if result == nil || result.Status != EditApplied {
		t.Fatalf("restore = %+v", result)
	}
	if got, want := histCanonical(t, histWithoutStamps(histBlocks(t, manager))), histCanonical(t, histWithoutStamps(old)); got != want {
		t.Fatalf("blocks = %s, want %s", got, want)
	}
}

func TestARetriedRestoreGetsTheFirstReceipt(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	histEdit(t, manager, histUpdate(t, "a", "A"))
	histEdit(t, manager, histUpdate(t, "a", "B"))
	lineage := b.lineage(t)
	_, first := histRestore(t, manager, lineage, 1, histOpRestore)
	histEdit(t, manager, histUpdate(t, "a", "C"))

	_, retry := histRestore(t, manager, lineage, 1, histOpRestore)

	if first == nil || retry == nil || retry.Status != EditApplied || retry.Receipt.ServerSequence != first.Receipt.ServerSequence {
		t.Fatalf("first %+v, retry %+v", first, retry)
	}
	if n := len(b.committed(t)); n != 4 {
		t.Fatalf("%d records, want 4", n)
	}
}

func TestAStalePreconditionRefusesTheRestore(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	histEdit(t, manager, histUpdate(t, "a", "A"))
	lineage := b.lineage(t)

	status, result := histRestoreAs(t, manager, lineage, 0, histOp, "", &Precondition{Lineage: lineage, Sequence: 0})

	if status != HistoryReady || result == nil || result.Status != EditPreconditionFailed || result.Receipt.ServerSequence != 1 {
		t.Fatalf("restore = %v, %+v", status, result)
	}
	if n := len(b.committed(t)); n != 1 {
		t.Fatalf("%d records, want 1", n)
	}
}

func TestAStalePreconditionWinsOverAMissingPoint(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	histEdit(t, manager, histUpdate(t, "a", "A"))
	lineage := b.lineage(t)

	status, result := histRestoreAs(t, manager, lineage, 9, histOp, "", &Precondition{Lineage: lineage, Sequence: 0})

	if status != HistoryReady || result == nil || result.Status != EditPreconditionFailed {
		t.Fatalf("restore = %v, %+v", status, result)
	}
	if n := len(b.committed(t)); n != 1 {
		t.Fatalf("%d records, want 1", n)
	}
}

func TestARestoreTooLargeForOneFrameChangesNothing(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, OptionsWith(func(ro *Options) { ro.AnnouncedMaxMessageBytes = 2048 }))
	histBlocks(t, manager)
	member := v2Member()
	joinSynced(t, manager, histDoc, member)
	histEdit(t, manager, histInsert(t, "big", strings.Repeat("x", 8192), "a"))
	histEdit(t, manager, convert.Remove{ID: "big"})
	before := histCanonical(t, histBlocks(t, manager))
	frames := histSyncUpdates(t, member)

	_, result := histRestore(t, manager, b.lineage(t), 1, histOp)

	if result == nil || result.Status != EditTooLarge {
		t.Fatalf("restore = %+v", result)
	}
	if n := len(b.committed(t)); n != 2 {
		t.Fatalf("%d records, want 2", n)
	}
	if got := histSyncUpdates(t, member); got != frames {
		t.Fatalf("%d update frames, want %d", got, frames)
	}
	if after := histCanonical(t, histBlocks(t, manager)); after != before {
		t.Fatalf("blocks = %s, want %s", after, before)
	}
	if closes := member.closed(); len(closes) != 0 {
		t.Fatalf("closed %v", closes)
	}
}

func TestADeleteRefusesTheCurrentLineageAndRemovesAnOldOne(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	old := b.lineage(t)
	histReset(t, manager)
	ctx := context.Background()

	for _, step := range []struct {
		lineage string
		want    journal.LineageDeleteOutcome
	}{{b.lineage(t), journal.LineageCurrent}, {old, journal.LineageDeletedOutcome}, {old, journal.LineageNotFound}} {
		if status, outcome, err := manager.DeleteLineage(ctx, histDoc, step.lineage); err != nil || status != HistoryReady || outcome != step.want {
			t.Fatalf("delete %s = %v, %v, %v; want %v", step.lineage, status, outcome, err, step.want)
		}
	}
	list, err := manager.History(ctx, histDoc, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, lineage := range list.Lineages {
		if lineage.Lineage == old {
			t.Fatal("the deleted lineage is still listed")
		}
	}
}

// --- CollabVersionChangesTests: DiffBlocks and page keys ---

func histDiffBlock(t *testing.T, id, kind, text, parent, tunes string) any {
	t.Helper()
	if kind == "" {
		kind = "paragraph"
	}
	if text == "" {
		text = "t"
	}
	json := `{"id":` + strconv.Quote(id) + `,"type":` + strconv.Quote(kind) + `,"data":` + textJSON(t, text)
	if tunes != "" {
		json += `,"tunes":` + tunes
	}
	if parent != "" {
		json += `,"parent":` + strconv.Quote(parent)
	}
	value, err := jsjson.Parse([]byte(json + "}"))
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func histB(t *testing.T, id string) any { return histDiffBlock(t, id, "", "", "", "") }

func histExpectKinds(t *testing.T, changes []BlockChange, want ...string) {
	t.Helper()
	if got := histKinds(changes); !slices.Equal(got, want) {
		t.Fatalf("changes = %v, want %v", got, want)
	}
}

func TestANewBlockIsAddedAndAMissingOneIsRemoved(t *testing.T) {
	changes := DiffBlocks(
		[]any{histB(t, "a"), histDiffBlock(t, "gone", "header", "", "", "")},
		[]any{histB(t, "a"), histB(t, "new")})

	histExpectKinds(t, changes, "new:added", "gone:removed")
	if changes[0].Type == nil || changes[0].Type.String() != "paragraph" || changes[1].Type == nil || changes[1].Type.String() != "header" {
		t.Fatalf("types = %v, %v", changes[0].Type, changes[1].Type)
	}
	if changes[0].Before != nil || histString(changes[0].After, "id") != "new" {
		t.Fatalf("added = %v -> %v", changes[0].Before, changes[0].After)
	}
	if histString(changes[1].Before, "id") != "gone" || changes[1].After != nil {
		t.Fatalf("removed = %v -> %v", changes[1].Before, changes[1].After)
	}
}

func TestADifferentTypeDataOrTunesIsAChange(t *testing.T) {
	changes := DiffBlocks(
		[]any{histDiffBlock(t, "a", "", "x", "", ""), histB(t, "b"), histB(t, "c")},
		[]any{histDiffBlock(t, "a", "", "y", "", ""), histDiffBlock(t, "b", "header", "", "", ""), histDiffBlock(t, "c", "", "", "", `{"align":"center"}`)})

	histExpectKinds(t, changes, "a:changed", "b:changed", "c:changed")
	if got := histDataText(t, changes[0].Before); got != `"x"` {
		t.Fatalf("before = %s", got)
	}
	if got := histDataText(t, changes[0].After); got != `"y"` {
		t.Fatalf("after = %s", got)
	}
	if changes[1].Type == nil || changes[1].Type.String() != "header" {
		t.Fatalf("type = %v", changes[1].Type)
	}
}

func TestKeyOrderMissingTunesAndEditStampsAreNoChange(t *testing.T) {
	before, err := jsjson.Parse([]byte(`{"id":"a","type":"paragraph","data":{"text":"x","level":2}}`))
	if err != nil {
		t.Fatal(err)
	}
	after, err := jsjson.Parse([]byte(`{"id":"a","type":"paragraph","data":{"level":2,"text":"x"},"tunes":{},"lastEditedAt":5,"lastEditedBy":"u2"}`))
	if err != nil {
		t.Fatal(err)
	}

	histExpectKinds(t, DiffBlocks([]any{before}, []any{after}))
}

// As the client diff: a block that is changed still takes its place in the
// kept order.
func TestAChangedBlockThatAlsoMovedIsChanged(t *testing.T) {
	changes := DiffBlocks(
		[]any{histB(t, "a"), histDiffBlock(t, "b", "", "x", "", "")},
		[]any{histDiffBlock(t, "b", "", "y", "", ""), histB(t, "a"), histDiffBlock(t, "c", "", "", "a", "")})

	histExpectKinds(t, changes, "b:changed", "c:added")
}

// As the client diff, unlike the restore planner's kept order: a changed
// block still holds its place, so its unchanged sibling is the one moved.
func TestAChangedBlockStillTakesPartInTheKeptOrder(t *testing.T) {
	changes := DiffBlocks(
		[]any{histDiffBlock(t, "a", "", "x", "", ""), histB(t, "b")},
		[]any{histB(t, "b"), histDiffBlock(t, "a", "", "y", "", "")})

	histExpectKinds(t, changes, "b:moved", "a:changed")
}

func TestSiblingOrderIsComparedWithinEachParent(t *testing.T) {
	changes := DiffBlocks(
		[]any{histB(t, "p"), histDiffBlock(t, "x", "", "", "p", ""), histDiffBlock(t, "y", "", "", "p", ""), histB(t, "q")},
		[]any{histB(t, "q"), histB(t, "p"), histDiffBlock(t, "y", "", "", "p", ""), histDiffBlock(t, "x", "", "", "p", "")})

	histExpectKinds(t, changes, "q:moved", "y:moved")
}

func TestPageAndValueKeysThatChangedAreListedPageFirst(t *testing.T) {
	doc := histClient(1)
	page, values := doc.GetMap(jsjson.FromString("page")), doc.GetMap(jsjson.FromString("values"))
	doc.Transact(func(tx *yjs.Transaction) {
		page.Set(tx, jsjson.FromString("title"), jsjson.FromString("Plan"))
		page.Set(tx, jsjson.FromString("icon"), jsjson.FromString("x"))
		values.Set(tx, jsjson.FromString("count"), 1.0)
		values.Set(tx, jsjson.FromString("kept"), jsjson.FromString("same"))
	})
	before := PageFields(doc)
	doc.Transact(func(tx *yjs.Transaction) {
		page.Set(tx, jsjson.FromString("title"), jsjson.FromString("Plan B"))
		page.Delete(tx, jsjson.FromString("icon"))
		page.Set(tx, jsjson.FromString("cover"), jsjson.FromString("c"))
		values.Set(tx, jsjson.FromString("count"), 2.0)
		values.Set(tx, jsjson.FromString("kept"), jsjson.FromString("same"))
	})
	after := PageFields(doc)

	if got := DiffPage(before, after); !slices.Equal(got, []string{"cover", "icon", "title", "values.count"}) {
		t.Fatalf("changed = %v", got)
	}
	if got := DiffPage(after, PageFields(doc)); len(got) != 0 {
		t.Fatalf("unchanged = %v", got)
	}
}

func TestAnObjectValueIsComparedByContent(t *testing.T) {
	doc := histClient(1)
	values := doc.GetMap(jsjson.FromString("values"))
	object := func(a float64) *jsjson.Object {
		o := &jsjson.Object{}
		o.Set(jsjson.FromString("a"), a)
		return o
	}
	doc.Transact(func(tx *yjs.Transaction) { values.Set(tx, jsjson.FromString("o"), object(1)) })
	before := PageFields(doc)
	doc.Transact(func(tx *yjs.Transaction) { values.Set(tx, jsjson.FromString("o"), object(2)) })

	if got := DiffPage(before, PageFields(doc)); !slices.Equal(got, []string{"values.o"}) {
		t.Fatalf("changed = %v", got)
	}
}

// --- CollabRestorePlannerTests whose fixture case is a different scenario ---

func histParentBlock(t *testing.T, id, kind string, content []string, parent string) string {
	t.Helper()
	ids := make([]string, len(content))
	for i, child := range content {
		ids[i] = strconv.Quote(child)
	}
	block := `{"id":` + strconv.Quote(id) + `,"type":` + strconv.Quote(kind) + `,"data":{},"content":[` + strings.Join(ids, ",") + `]`
	if parent != "" {
		block += `,"parent":` + strconv.Quote(parent)
	}
	return block + "}"
}

// c names p as its parent but p does not list it, so c cannot be an
// anchor: inserting after it would be refused. The fixture's orphan moves to
// the root, so it does not reach this rule.
func TestReplacesAnOrphanChildItsParentDoesNotList(t *testing.T) {
	doc := histSeeded(t, histParentBlock(t, "p", "toggle", []string{"k"}, ""), histP(t, "k", "p"), histP(t, "c", "p"))

	// k then c is c's current order too, so only the anchor rule keeps c
	// from staying and n from being refused after it.
	after := histRestoreBlocks(t, doc, histTarget(t,
		histParentBlock(t, "p", "toggle", []string{"k", "c", "n"}, ""),
		histP(t, "k", "p"), histP(t, "c", "p"), histP(t, "n", "p")))

	histExpectOutline(t, after, "p", "k<p", "c<p", "n<p")
}

// The fixture's identical document has no children.
func TestPlansNothingForAnIdenticalDocument(t *testing.T) {
	blocks := []string{histParentBlock(t, "a", "toggle", []string{"c"}, ""), histP(t, "c", "a"), histP(t, "b", "")}
	doc := histSeeded(t, blocks...)

	if ops := PlanRestore(histExport(t, doc), convert.DescribeStructure(doc), histTarget(t, blocks...), nil, nil); len(ops) != 0 {
		t.Fatalf("ops = %#v, want none", ops)
	}
}

// The fixture's map case changes several keys at once.
func TestPlansOneMapPatchForATitleOnlyChange(t *testing.T) {
	doc := histSeeded(t, histP(t, "a", ""), histP(t, "b", ""))
	target := histSeeded(t, histP(t, "a", ""), histP(t, "b", ""))
	histSetMap(doc, "page", "title", jsjson.FromString("Old"))
	histSetMap(target, "page", "title", jsjson.FromString("New"))
	before := histCanonical(t, histWithoutStamps(histExport(t, doc)))

	ops := histPlanWithMaps(t, doc, target)
	if err := histConverter(t, nil).ApplyOps(context.Background(), doc, ops); err != nil {
		t.Fatal(err)
	}

	if len(ops) != 1 {
		t.Fatalf("ops = %#v, want one patch", ops)
	}
	patch, ok := ops[0].(convert.PatchMaps)
	if !ok || len(patch.Patches) != 1 {
		t.Fatalf("op = %#v", ops[0])
	}
	if got := patch.Patches[0]; got.Map != "page" || got.Key != "title" || got.Remove || histCanonical(t, got.Value) != `"New"` {
		t.Fatalf("patch = %#v", got)
	}
	title, _ := doc.GetMap(jsjson.FromString("page")).Get(jsjson.FromString("title"))
	if s, ok := title.(jsjson.Str); !ok || s.String() != "New" {
		t.Fatalf("title = %v", title)
	}
	if after := histCanonical(t, histWithoutStamps(histExport(t, doc))); after != before {
		t.Fatalf("blocks = %s, want %s", after, before)
	}
}

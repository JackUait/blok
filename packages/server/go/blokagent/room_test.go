package blokagent

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/internal/collab/room"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// Go twins of the C# room tests a scenario cannot express: timing,
// concurrency, a clock, and runtimes that answer for the bundle.

const historySeed = `{"blocks":[{"id":"p","type":"paragraph","data":{"text":"Hello"}},{"id":"q","type":"paragraph","data":{"text":"Other"}}]}`

var roomAgent = Actor{ID: "agent-cs", Name: "Agent"}

func runIn(t *testing.T, r *testRoom, doc, batch string, actor Actor) (Execution, string) {
	t.Helper()
	execution, err := r.executor.ExecuteInRoom(context.Background(), doc, batch, actor, nil)
	if err != nil {
		t.Fatal(err)
	}
	code, _ := stringOf(lookup(lookup(mustParse(t, execution.ResultJSON), "error"), "code"))
	return execution, code
}

func okIn(t *testing.T, r *testRoom, doc, batch string) Execution {
	t.Helper()
	execution, code := runIn(t, r, doc, batch, roomAgent)
	if code != "" {
		t.Fatalf("%s: %s", batch, execution.ResultJSON)
	}
	return execution
}

func ids(t *testing.T, r *testRoom, doc string) string {
	t.Helper()
	var out []string
	for _, block := range records(lookup(r.export(t, doc), "blocks")) {
		id, _ := idOf(block)
		out = append(out, id)
	}
	return strings.Join(out, ",")
}

const (
	undoBatch = `{"commands":[{"name":"history.undo","args":{}}]}`
	redoBatch = `{"commands":[{"name":"history.redo","args":{}}]}`
)

func insertBatch(id, text string) string {
	return `{"commands":[{"name":"block.insert","args":{"id":"` + id + `","type":"paragraph","data":{"text":"` + text + `"},"position":"end"}}]}`
}

// T6 (C# AStepCarriesItsLineageWhenItIsAdded): a step is shared the moment
// it is added, so its lineage is set by then.
func TestAStepCarriesItsLineageWhenItIsAdded(t *testing.T) {
	r := newTestRoom(t, false, nil)
	r.docs.hold("d", historySeed)
	var added []string
	r.executor.history.added = func(step *roomStep) {
		if step.lineage == nil {
			added = append(added, "<nil>")
		} else {
			added = append(added, *step.lineage)
		}
	}
	execution := okIn(t, r, "d", insertBatch("a", "Agent"))
	lineage := execution.Revision[:strings.LastIndexByte(execution.Revision, ':')]
	if len(added) != 1 || added[0] != lineage {
		t.Fatalf("added %v, want [%s]", added, lineage)
	}
}

// C# TwoUndosAtOnceTakeTheStepBackOnce. Run with -race.
func TestTwoUndosAtOnceTakeTheStepBackOnce(t *testing.T) {
	r := newTestRoom(t, false, nil)
	r.docs.hold("d", historySeed)
	okIn(t, r, "d", insertBatch("a", "Agent"))
	codes := make([]string, 2)
	var wg sync.WaitGroup
	for i := range codes {
		wg.Add(1)
		go func() {
			defer wg.Done()
			execution, err := r.executor.ExecuteInRoom(context.Background(), "d", undoBatch, roomAgent, nil)
			if err != nil {
				t.Error(err)
				return
			}
			codes[i], _ = stringOf(lookup(lookup(mustParse(t, execution.ResultJSON), "error"), "code"))
		}()
	}
	wg.Wait()
	won := 0
	for _, code := range codes {
		switch code {
		case "":
			won++
		case "NOTHING_TO_UNDO", "CONFLICT":
		default:
			t.Fatalf("codes %v", codes)
		}
	}
	if won != 1 {
		t.Fatalf("codes %v, want one undo", codes)
	}
	if got := ids(t, r, "d"); got != "p,q" {
		t.Fatalf("blocks %s", got)
	}
	okIn(t, r, "d", redoBatch)
	if got := ids(t, r, "d"); got != "p,q,a" {
		t.Fatalf("blocks after redo %s", got)
	}
}

// T18: the idle limit is lazy, on top and add, against the clock.
func TestStepsGoAfterAnHourWithoutACall(t *testing.T) {
	r := newTestRoom(t, false, nil)
	r.docs.hold("d", historySeed)
	now := time.Now()
	var mu sync.Mutex
	r.executor.history.now = func() time.Time { mu.Lock(); defer mu.Unlock(); return now }
	advance := func(d time.Duration) { mu.Lock(); defer mu.Unlock(); now = now.Add(d) }
	okIn(t, r, "d", insertBatch("a", "One"))
	advance(time.Hour)
	// Exactly the limit is not past it, and the call touches the steps.
	okIn(t, r, "d", insertBatch("b", "Two"))
	advance(time.Hour + time.Millisecond)
	if _, code := runIn(t, r, "d", undoBatch, roomAgent); code != "NOTHING_TO_UNDO" {
		t.Fatalf("code %q after the idle limit", code)
	}
	if got := ids(t, r, "d"); got != "p,q,a,b" {
		t.Fatalf("blocks %s", got)
	}
}

// T2: the room trims done steps only, so with the redo side full, a page
// action (which keeps the redo side) evicts the very step it adds.
func TestTheRoomTrimsOnlyDoneSteps(t *testing.T) {
	h := newRoomHistory(time.Now)
	step := func(other bool) *roomStep {
		s := &roomStep{other: other}
		if err := s.measure(); err != nil {
			t.Fatal(err)
		}
		return s
	}
	for range maxSteps {
		h.add("d", roomAgent, step(false))
	}
	for range maxSteps {
		top := h.top("d", roomAgent, true)
		if ok, err := h.replayed("d", roomAgent, top, true, nil); err != nil || !ok {
			t.Fatal(ok, err)
		}
	}
	h.add("d", roomAgent, step(true))
	steps := h.rooms[keyOf("d", roomAgent)]
	if len(steps.done) != 0 || len(steps.undone) != maxSteps {
		t.Fatalf("done %d undone %d", len(steps.done), len(steps.undone))
	}
	// A batch clears the redo side and stays.
	kept := step(false)
	h.add("d", roomAgent, kept)
	if len(steps.done) != 1 || steps.done[0] != kept || len(steps.undone) != 0 {
		t.Fatalf("done %d undone %d", len(steps.done), len(steps.undone))
	}
}

// historyRuntime answers a history batch as a contract without history.*
// would (C# NoHistoryRuntime).
type historyRuntime struct{ inner invoker }

func (r historyRuntime) Invoke(ctx context.Context, op, input string, timeout time.Duration) (string, error) {
	if op == "agentExecute" && (strings.Contains(input, `"name":"history.undo"`) || strings.Contains(input, `"name":"history.redo"`)) {
		return `{"result":{"ok":false,"error":{"code":"COMMAND_UNAVAILABLE","message":"\"history.undo\" is not available here.","retryable":false,"details":{"reason":"runtime"}},"warnings":[],"revision":"h1"},"document":{"blocks":[]},"edits":[]}`, nil
	}
	return r.inner.Invoke(ctx, op, input, timeout)
}

// F28 (C# RefusesUndoTheContractDoesNotOffer): the gate's refusal goes back
// as the bundle wrote it, without its revision, and nothing is replayed.
func TestRefusesUndoTheContractDoesNotOffer(t *testing.T) {
	r := newTestRoom(t, false, func(inner invoker) invoker { return historyRuntime{inner} })
	r.docs.hold("d", historySeed)
	okIn(t, r, "d", insertBatch("a", "Agent"))
	execution, code := runIn(t, r, "d", undoBatch, roomAgent)
	if code != "COMMAND_UNAVAILABLE" || execution.Revision != "" || strings.Contains(execution.ResultJSON, `"revision"`) {
		t.Fatalf("%s %q", execution.ResultJSON, execution.Revision)
	}
	if got := ids(t, r, "d"); got != "p,q,a" {
		t.Fatalf("blocks %s", got)
	}
}

// C# AFailedRestoreIsRetryableOnlyWhenTheSharedRuntimeWouldSaySo.
func TestAFailedRestoreIsRetryableOnlyWhenTheSharedRuntimeWouldSaySo(t *testing.T) {
	for status, want := range map[room.HistoryStatus]bool{
		room.HistoryExportFailed: false, room.HistoryCorrupt: false, room.HistoryNone: false,
		room.HistoryPurged: false, room.HistoryUnavailable: true,
	} {
		if got := restoreRetryable(status); got != want {
			t.Errorf("%s: %v", status, got)
		}
	}
}

// C# AReadWithoutAJournalWritesNothingBack.
func TestAReadWithoutAJournalWritesNothingBack(t *testing.T) {
	r := newTestRoom(t, true, nil)
	r.docs.hold("d", historySeed)
	r.export(t, "d")
	writes := r.sets.writeCount()
	okIn(t, r, "d", `{"commands":[{"name":"doc.read","args":{}}]}`)
	if got := r.sets.writeCount(); got != writes {
		t.Fatalf("writes %d, want %d", got, writes)
	}
}

// peerAfterRestoreCheck runs a peer's write right after the bundle answers
// a restore, before the room restores (C# PeerWriteAfterRestoreCheck).
type peerAfterRestoreCheck struct {
	inner invoker
	mu    sync.Mutex
	peer  func()
}

func (r *peerAfterRestoreCheck) Invoke(ctx context.Context, op, input string, timeout time.Duration) (string, error) {
	output, err := r.inner.Invoke(ctx, op, input, timeout)
	r.mu.Lock()
	peer := r.peer
	if peer != nil && op == "agentExecute" && strings.Contains(output, `"restore":`) {
		r.peer = nil
	} else {
		peer = nil
	}
	r.mu.Unlock()
	if peer != nil {
		peer()
	}
	return output, err
}

// C# ARoomChangeBetweenTheRestoreCheckAndTheRestoreIsStaleAndWritesNothing.
func TestARoomChangeBetweenTheRestoreCheckAndTheRestoreIsStale(t *testing.T) {
	var hook *peerAfterRestoreCheck
	r := newTestRoom(t, false, func(inner invoker) invoker { hook = &peerAfterRestoreCheck{inner: inner}; return hook })
	r.docs.hold("d", `{"blocks":[{"id":"p","type":"paragraph","data":{"text":"Hello world"}},{"id":"q","type":"paragraph","data":{"text":"Second"}}]}`)
	edit := okIn(t, r, "d", `{"commands":[{"name":"text.replace","args":{"id":"p","with":"Changed"}}]}`)
	lineage := edit.Revision[:strings.LastIndexByte(edit.Revision, ':')]
	var afterPeer string
	hook.peer = func() {
		okIn(t, r, "d", `{"commands":[{"name":"text.replace","args":{"id":"q","with":"Peer"}}]}`)
		afterPeer = r.head(t, "d")
	}
	_, code := runIn(t, r, "d", `{"commands":[{"name":"history.restore","args":{"version":"`+lineage+`:0"}}]}`, roomAgent)
	if code != "STALE" {
		t.Fatalf("code %q", code)
	}
	blocks := lookup(r.export(t, "d"), "blocks")
	first, _ := stringOf(lookup(lookup(lookup(blocks.Items[0], "data"), "text").Items[0], "text"))
	second, _ := stringOf(lookup(lookup(lookup(blocks.Items[1], "data"), "text").Items[0], "text"))
	if first != "Changed" || second != "Peer" || r.head(t, "d") != afterPeer {
		t.Fatalf("p %q q %q head %s, after the peer %s", first, second, r.head(t, "d"), afterPeer)
	}
}

// H1/T9: an undo that pinned the head itself tries again, three times in
// all, when a peer writes between its read and its lane; one that sent its
// own expectRevision is never retried.
func TestAnUndoRetriesItsOwnStaleHeadThreeTimes(t *testing.T) {
	for _, row := range []struct {
		name   string
		writes int
		expect bool
		code   string
		calls  int
	}{
		{"one peer write", 1, false, "", 2},
		{"a peer write every time", 99, false, "STALE", 3},
		{"the caller's own head", 99, true, "STALE", 1},
	} {
		t.Run(row.name, func(t *testing.T) {
			r := newTestRoom(t, false, nil)
			r.docs.hold("d", historySeed)
			okIn(t, r, "d", insertBatch("a", "Agent"))
			calls := 0
			r.executor.beforeHistoryLane = func() {
				calls++
				if calls <= row.writes {
					digest := make([]byte, 32)
					edit, err := r.manager.Edit(context.Background(), "d", []convert.EditOp{
						convert.Update{ID: "q", Data: mustParse(t, `{"text":"Peer `+strconv.Itoa(calls)+`"}`)},
					}, newGUID(), digest, "human-2", nil)
					if err != nil || edit.Status != room.EditApplied {
						t.Fatalf("peer %v %v", edit.Status, err)
					}
				}
			}
			batch := undoBatch
			if row.expect {
				batch = `{"expectRevision":"` + r.head(t, "d") + `","commands":[{"name":"history.undo","args":{}}]}`
			}
			_, code := runIn(t, r, "d", batch, roomAgent)
			if code != row.code || calls != row.calls {
				t.Fatalf("code %q after %d tries, want %q after %d", code, calls, row.code, row.calls)
			}
		})
	}
}

// pageCreator makes host-1, host-2, ... and records them.
type pageCreator struct {
	mu      sync.Mutex
	created []string
}

func (c *pageCreator) Resolve(context.Context, string, Actor) (PageLocation, error) { return nil, nil }

func (c *pageCreator) Create(context.Context, Actor) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	id := "host-" + strconv.Itoa(len(c.created)+1)
	c.created = append(c.created, id)
	return id, nil
}

const insertPageBatch = `{"commands":[{"name":"block.insert","args":{"type":"page","id":"np","position":"end"}}]}`

// failingExecute lets the page count run, then fails the batch run itself.
type failingExecute struct {
	inner invoker
	err   error
}

func (f failingExecute) Invoke(ctx context.Context, op, input string, timeout time.Duration) (string, error) {
	if op == "agentExecute" {
		return "", f.err
	}
	return f.inner.Invoke(ctx, op, input, timeout)
}

func orphanedCause(t *testing.T, execution Execution) (string, string) {
	t.Helper()
	result := mustParse(t, execution.ResultJSON)
	code, _ := stringOf(lookup(lookup(result, "error"), "code"))
	cause, _ := stringOf(lookup(lookup(lookup(lookup(result, "error"), "details"), "cause"), "code"))
	return code, cause
}

// C# ARoomRunThatStopsAfterTheHostMadePagesListsThem (cancel, error).
func TestARoomRunThatStopsAfterTheHostMadePagesListsThem(t *testing.T) {
	for _, row := range []struct {
		err   error
		cause string
	}{{context.Canceled, "CANCELLED"}, {errors.New("The engine broke."), "APPLY_FAILED"}} {
		r := newTestRoom(t, false, func(inner invoker) invoker { return failingExecute{inner, row.err} })
		r.docs.hold("d", `{"blocks":[]}`)
		pages := &pageCreator{}
		execution, err := r.executor.ExecuteInRoom(context.Background(), "d", insertPageBatch, roomAgent, &Options{PageTitles: true, PageTarget: pages})
		if err != nil {
			t.Fatal(err)
		}
		code, cause := orphanedCause(t, execution)
		if code != "ORPHANED_SIDE_EFFECT" || cause != row.cause || !strings.Contains(execution.ResultJSON, "host-1") || execution.DocumentJSON != nil {
			t.Fatalf("%s", execution.ResultJSON)
		}
		if len(pages.created) != 1 || ids(t, r, "d") != "" {
			t.Fatalf("created %v, blocks %q", pages.created, ids(t, r, "d"))
		}
	}
}

// throwsAfterApply writes the ops into the doc, then fails, as an error
// after the room changed would.
type throwsAfterApply struct{ *convert.DocConverter }

func (c throwsAfterApply) ApplyOps(ctx context.Context, doc *yjs.Doc, ops []convert.EditOp) error {
	if err := c.DocConverter.ApplyOps(ctx, doc, ops); err != nil {
		return err
	}
	return errors.New("The disk filled after the write.")
}

// C# APageTheRoomLinksIsNeverReportedOrphanedWhenTheEditThrowsAfterWriting.
func TestAPageTheRoomLinksIsNeverReportedOrphanedWhenTheEditThrowsAfterWriting(t *testing.T) {
	for _, noJournal := range []bool{false, true} {
		r := newTestRoomWith(t, noJournal, nil, func(inner *convert.DocConverter) room.Converter { return throwsAfterApply{inner} })
		r.docs.hold("d", `{"blocks":[]}`)
		pages := &pageCreator{}
		execution, err := r.executor.ExecuteInRoom(context.Background(), "d", insertPageBatch, roomAgent, &Options{PageTitles: true, PageTarget: pages})
		result := ""
		if err == nil {
			result = execution.ResultJSON
		}
		state, stateErr := r.manager.State(context.Background(), "d")
		if stateErr != nil {
			t.Fatal(stateErr)
		}
		linked := state.Status == room.StateReady && strings.Contains(string(state.JSON), "host-1")
		orphaned := strings.Contains(result, `"orphaned":[`) && strings.Contains(result, "host-1")
		if len(pages.created) != 1 {
			t.Fatalf("created %v", pages.created)
		}
		if linked && orphaned {
			t.Fatalf("journal %v: the room links host-1, yet the result lists it orphaned: %s", !noJournal, result)
		}
		if !linked && err == nil && !orphaned {
			t.Fatalf("journal %v: the room does not link host-1, so the result must list it: %s", !noJournal, result)
		}
	}
}

// throwsOnExport fails the nth export (counted from 1).
type throwsOnExport struct {
	*convert.DocConverter
	mu    *sync.Mutex
	count *int
	nth   int
}

func (c throwsOnExport) Export(ctx context.Context, doc *yjs.Doc) (*jsjson.Object, error) {
	c.mu.Lock()
	*c.count++
	hit := *c.count == c.nth
	c.mu.Unlock()
	if hit {
		return nil, errors.New("Post-processing failed.")
	}
	return c.DocConverter.Export(ctx, doc)
}

// C# AThrowAfterTheRoomCommitNeverReportsTheLinkedPageOrphaned: the export
// after the commit fails. Go's executor exports through the room's
// converter, so the state read before the page is made counts first:
// state (1), the plan (2), after the commit (3).
func TestAThrowAfterTheRoomCommitNeverReportsTheLinkedPageOrphaned(t *testing.T) {
	var mu sync.Mutex
	count := 0
	r := newTestRoomWith(t, false, nil, func(inner *convert.DocConverter) room.Converter {
		return throwsOnExport{inner, &mu, &count, 3}
	})
	r.docs.hold("d", `{"blocks":[]}`)
	pages := &pageCreator{}
	execution, err := r.executor.ExecuteInRoom(context.Background(), "d", insertPageBatch, roomAgent, &Options{PageTitles: true, PageTarget: pages})
	if err == nil && strings.Contains(execution.ResultJSON, "orphaned") {
		t.Fatalf("%s", execution.ResultJSON)
	}
	if err == nil {
		t.Fatalf("the failed export was not passed on: %s", execution.ResultJSON)
	}
	page, _ := stringOf(lookup(lookup(records(lookup(r.export(t, "d"), "blocks"))[0], "data"), "pageId"))
	if page != "host-1" {
		t.Fatalf("page %q", page)
	}
}

// cancelOnExecute cancels the caller's context when the batch runs.
type cancelOnExecute struct {
	inner  invoker
	cancel context.CancelFunc
}

func (c cancelOnExecute) Invoke(ctx context.Context, op, input string, timeout time.Duration) (string, error) {
	if op == "agentExecute" {
		// The plan runs on the room's own context, so the caller's cancel
		// reaches it as this error.
		c.cancel()
		return "", context.Canceled
	}
	return c.inner.Invoke(ctx, op, input, timeout)
}

// T10: the room read that decides whether the made pages are orphans
// ignores the caller's cancel, so a cancelled call still lists them.
func TestTheOrphanCheckReadsTheRoomAfterTheCallerCancels(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := newTestRoom(t, false, func(inner invoker) invoker { return cancelOnExecute{inner, cancel} })
	r.docs.hold("d", `{"blocks":[]}`)
	pages := &pageCreator{}
	execution, err := r.executor.ExecuteInRoom(ctx, "d", insertPageBatch, roomAgent, &Options{PageTitles: true, PageTarget: pages})
	if err != nil {
		t.Fatal(err)
	}
	if code, cause := orphanedCause(t, execution); code != "ORPHANED_SIDE_EFFECT" || cause != "CANCELLED" {
		t.Fatalf("%s", execution.ResultJSON)
	}
}

// hookedCreator makes host-1, host-2, ... and runs during inside each create.
type hookedCreator struct {
	pageCreator
	during func()
}

func (c *hookedCreator) Create(ctx context.Context, actor Actor) (string, error) {
	if c.during != nil {
		c.during()
	}
	return c.pageCreator.Create(ctx, actor)
}

// C# ARoomThatRefusesTheEditAfterThePageWasMadeListsIt (R10).
func TestARoomThatRefusesTheEditAfterThePageWasMadeListsIt(t *testing.T) {
	r := newTestRoom(t, false, nil)
	r.docs.hold("d", `{"blocks":[{"id":"p","type":"paragraph","data":{"text":"P"}}]}`)
	head := r.head(t, "d")
	pages := &hookedCreator{during: func() {
		edit, err := r.manager.Edit(context.Background(), "d", []convert.EditOp{
			convert.Update{ID: "p", Data: mustParse(t, `{"text":"Peer"}`)}}, newGUID(), make([]byte, 32), "human-2", nil)
		if err != nil || edit.Status != room.EditApplied {
			t.Errorf("peer %v %v", edit.Status, err)
		}
	}}
	execution, err := r.executor.ExecuteInRoom(context.Background(), "d",
		`{"expectRevision":"`+head+`","commands":[{"name":"block.insert","args":{"type":"page","id":"np","position":"end"}}]}`,
		roomAgent, &Options{PageTitles: true, PageTarget: pages})
	if err != nil {
		t.Fatal(err)
	}
	code, cause := orphanedCause(t, execution)
	orphaned, _ := write(lookup(lookup(lookup(mustParse(t, execution.ResultJSON), "error"), "details"), "orphaned"))
	if code != "ORPHANED_SIDE_EFFECT" || cause != "STALE" || orphaned != `[{"command":"block.insert","type":"page","prepared":{"pageId":"host-1"}}]` {
		t.Fatalf("%s", execution.ResultJSON)
	}
	if len(pages.created) != 1 {
		t.Fatalf("created %v", pages.created)
	}
}

// drainAfterRestoreCheck drains the rooms right after the bundle answers a
// restore, before the room restores.
type drainAfterRestoreCheck struct {
	inner invoker
	drain func()
}

func (d *drainAfterRestoreCheck) Invoke(ctx context.Context, op, input string, timeout time.Duration) (string, error) {
	output, err := d.inner.Invoke(ctx, op, input, timeout)
	if drain := d.drain; drain != nil && op == "agentExecute" && strings.Contains(output, `"restore":`) {
		d.drain = nil
		drain()
	}
	return output, err
}

// C# ARestoreTheRoomRefusesIsApplyFailedWithItsStatus (F26).
func TestARestoreTheRoomRefusesIsApplyFailedWithItsStatus(t *testing.T) {
	var hook *drainAfterRestoreCheck
	r := newTestRoom(t, false, func(inner invoker) invoker { hook = &drainAfterRestoreCheck{inner: inner}; return hook })
	r.docs.hold("d", `{"blocks":[{"id":"p","type":"paragraph","data":{"text":"P"}}]}`)
	edit := okIn(t, r, "d", `{"commands":[{"name":"text.replace","args":{"id":"p","with":"Changed"}}]}`)
	lineage := edit.Revision[:strings.LastIndexByte(edit.Revision, ':')]
	hook.drain = func() {
		if err := r.manager.Drain(context.Background()); err != nil {
			t.Error(err)
		}
	}
	execution, _ := runIn(t, r, "d", `{"commands":[{"name":"history.restore","args":{"version":"`+lineage+`:0"}}]}`, roomAgent)
	want := `{"ok":false,"error":{"code":"APPLY_FAILED","message":"The room refused the restore (Draining). Nothing was written.","retryable":true,"details":{"status":"Draining"}},"warnings":[]}`
	if execution.ResultJSON != want || execution.Revision != "" {
		t.Fatalf("%s %q", execution.ResultJSON, execution.Revision)
	}
}

// T1: the char cap counts the escaped JSON text in UTF-16 units (C#
// RoomAgentHistoryTests.AStepCountsItsEscapedJsonText).
func TestAStepCountsItsEscapedJSONText(t *testing.T) {
	before := &jsjson.Object{}
	before.Set(jsjson.FromString("t"), jsjson.FromString("\U0001F680<a>&'+é"))
	s := &roomStep{before: before, after: &jsjson.Object{}}
	if err := s.measure(); err != nil {
		t.Fatal(err)
	}
	if s.chars != 57+2 {
		t.Fatalf("chars %d", s.chars)
	}
}

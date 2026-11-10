package room

import (
	"context"
	"errors"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
)

// Twins of C# CollabHistoryManagerTests.Signals: change signals and audit
// events through the manager, on the real converter.

type signalObserver struct {
	mu      sync.Mutex
	signals []ChangeSignal
	events  []AuditEvent
	failure error
	gate    chan struct{}
	// hangFirst: the first OnChanges never returns; entered closes when it starts.
	hangFirst bool
	entered   chan struct{}
	calls     int
}

func (o *signalObserver) Record(context.Context, string, string, time.Time, ActivityKind) error {
	return nil
}

func (o *signalObserver) OnChanges(_ context.Context, signal ChangeSignal) error {
	o.mu.Lock()
	o.calls++
	first := o.calls == 1
	o.mu.Unlock()
	if o.hangFirst && first {
		close(o.entered)
		select {}
	}
	if o.gate != nil {
		<-o.gate
	}
	if o.failure != nil {
		return o.failure
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	o.signals = append(o.signals, signal)
	return nil
}

func (o *signalObserver) OnEvent(_ context.Context, event AuditEvent) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.events = append(o.events, event)
	return nil
}

func (o *signalObserver) gotSignals() []ChangeSignal {
	o.mu.Lock()
	defer o.mu.Unlock()
	return append([]ChangeSignal{}, o.signals...)
}

func (o *signalObserver) gotEvents() []AuditEvent {
	o.mu.Lock()
	defer o.mu.Unlock()
	return append([]AuditEvent{}, o.events...)
}

type activityOnly struct{}

func (activityOnly) Record(context.Context, string, string, time.Time, ActivityKind) error {
	return nil
}

type signalBench struct {
	*histBench
	clock   *manualClock
	timers  *manualTimers
	logMu   sync.Mutex
	logged  []string
	manager *Manager
}

func newSignalBench(t *testing.T, observer ActivityObserver, window time.Duration) *signalBench {
	t.Helper()
	b := &signalBench{histBench: histNewBench(t), clock: newManualClock(), timers: &manualTimers{}}
	o := OptionsWith(func(o *Options) {
		o.Now, o.Timers = b.clock.Now, b.timers
		if window > 0 {
			o.ChangeSignalWindow = window
		}
	})
	b.manager = NewManager(ManagerOptions{
		Store: b.store, Endpoint: b.endpoint, Converter: histConverter(t, nil), Room: o, Operations: b.journal,
		Activity: observer, Log: func(message string) {
			b.logMu.Lock()
			defer b.logMu.Unlock()
			b.logged = append(b.logged, message)
		},
	})
	t.Cleanup(func() { _ = b.manager.Drain(context.Background()) })
	histBlocks(t, b.manager)
	return b
}

func (b *signalBench) advance(d time.Duration) {
	b.clock.Advance(d)
	b.timers.Advance(d)
	b.manager.Settle()
}

func TestOneSignalPerWindowNamesTheChangedBlocksAndTheirAuthors(t *testing.T) {
	observer := &signalObserver{}
	b := newSignalBench(t, observer, 0)
	opened := b.clock.Now()
	histEditOps(t, b.manager, []convert.EditOp{histUpdate(t, "a", "two")}, "u1")
	b.advance(30 * time.Second)
	histEditOps(t, b.manager, []convert.EditOp{histInsert(t, "b", "three", "a")}, "u2")
	b.manager.Settle()
	if got := observer.gotSignals(); len(got) != 0 {
		t.Fatalf("a signal before the window ended: %+v", got)
	}

	b.advance(30 * time.Second)

	got := observer.gotSignals()
	if len(got) != 1 {
		t.Fatalf("signals = %+v", got)
	}
	signal := got[0]
	person := "person"
	if signal.DocID != histDoc || signal.Lineage != b.lineage(t) || signal.FromSequence != 1 || signal.ToSequence != 2 ||
		!signal.WindowStart.Equal(opened) || !signal.WindowEnd.Equal(opened.Add(time.Minute)) {
		t.Fatalf("signal = %+v", signal)
	}
	if want := []SignalBlock{{"a", "changed"}, {"b", "added"}}; !reflect.DeepEqual(signal.Blocks, want) {
		t.Fatalf("blocks = %+v", signal.Blocks)
	}
	if want := []SignalAuthor{{"u1", &person}, {"u2", &person}}; !reflect.DeepEqual(signal.Authors, want) {
		t.Fatalf("authors = %+v", signal.Authors)
	}
}

func TestAnEditAfterTheWindowOpensTheNextOne(t *testing.T) {
	observer := &signalObserver{}
	b := newSignalBench(t, observer, 0)
	histEdit(t, b.manager, histUpdate(t, "a", "two"))
	b.advance(time.Minute)
	histEdit(t, b.manager, histUpdate(t, "a", "three"))
	b.advance(time.Minute)

	got := observer.gotSignals()
	if len(got) != 2 || got[0].FromSequence != 1 || got[0].ToSequence != 1 || got[1].FromSequence != 2 || got[1].ToSequence != 2 {
		t.Fatalf("signals = %+v", got)
	}
}

func TestABlockAddedAndRemovedInOneWindowSendsNothing(t *testing.T) {
	observer := &signalObserver{}
	b := newSignalBench(t, observer, 0)
	histEdit(t, b.manager, histInsert(t, "b", "brief", "a"))
	histEdit(t, b.manager, convert.Remove{ID: "b"})
	b.advance(time.Minute)

	if got := observer.gotSignals(); len(got) != 0 {
		t.Fatalf("signals = %+v", got)
	}
}

func TestALineageChangeClosesTheWindow(t *testing.T) {
	observer := &signalObserver{}
	b := newSignalBench(t, observer, 0)
	histEdit(t, b.manager, histUpdate(t, "a", "two"))
	first := b.lineage(t)
	histReset(t, b.manager)
	histEdit(t, b.manager, histUpdate(t, "a", "three"))
	second := b.lineage(t)
	// The first window closed early; let it go out before time passes its call timeout.
	b.manager.Settle()
	b.advance(time.Minute)

	got := observer.gotSignals()
	if len(got) != 2 || got[0].Lineage != first || got[1].Lineage != second {
		t.Fatalf("signals = %+v", got)
	}
}

func TestTheWindowLengthComesFromTheOptions(t *testing.T) {
	observer := &signalObserver{}
	b := newSignalBench(t, observer, 5*time.Minute)
	histEdit(t, b.manager, histUpdate(t, "a", "two"))
	b.advance(4 * time.Minute)
	histEdit(t, b.manager, histUpdate(t, "a", "three"))
	b.manager.Settle()
	if got := observer.gotSignals(); len(got) != 0 {
		t.Fatalf("signals = %+v", got)
	}

	b.advance(time.Minute)

	got := observer.gotSignals()
	if len(got) != 1 || got[0].FromSequence != 1 || got[0].ToSequence != 2 || got[0].WindowEnd.Sub(got[0].WindowStart) != 5*time.Minute {
		t.Fatalf("signals = %+v", got)
	}
}

func TestAFailingObserverIsLoggedAndEditsGoOn(t *testing.T) {
	observer := &signalObserver{failure: errors.New("host down")}
	b := newSignalBench(t, observer, 0)
	histEdit(t, b.manager, histUpdate(t, "a", "two"))
	b.advance(time.Minute)
	histEdit(t, b.manager, histUpdate(t, "a", "three"))

	b.logMu.Lock()
	defer b.logMu.Unlock()
	if !strings.Contains(strings.Join(b.logged, "\n"), "host down") {
		t.Fatalf("log = %v", b.logged)
	}
}

func TestASlowObserverNeverHoldsTheRoom(t *testing.T) {
	observer := &signalObserver{gate: make(chan struct{})}
	b := newSignalBench(t, observer, 0)
	histEdit(t, b.manager, histUpdate(t, "a", "two"))
	b.clock.Advance(time.Minute)
	b.timers.Advance(time.Minute)
	for i := range 5 {
		histEdit(t, b.manager, histUpdate(t, "a", "edit "+string(rune('0'+i))))
	}
	if got := len(b.committed(t)); got != 6 {
		t.Fatalf("committed = %d", got)
	}
	close(observer.gate)
	// Before the next advance, which would also pass the call timeout.
	for wait := 0; wait < 2000 && len(observer.gotSignals()) == 0; wait++ {
		time.Sleep(time.Millisecond)
	}
	b.advance(time.Minute)
	if got := observer.gotSignals(); len(got) != 2 {
		t.Fatalf("signals = %+v", got)
	}
}

func TestAnObserverWithNeitherInterfaceGetsNoHub(t *testing.T) {
	b := newSignalBench(t, activityOnly{}, 0)
	if b.manager.signals != nil {
		t.Fatal("a hub for an activity-only observer")
	}
}

func TestAnEditIsAContentEditedEventWithTheActorsNote(t *testing.T) {
	observer := &signalObserver{}
	b := newSignalBench(t, observer, 0)
	histEditOps(t, b.manager, []convert.EditOp{histUpdate(t, "a", "two")}, "u1")
	histEditOps(t, b.manager, []convert.EditOp{histUpdate(t, "a", "three")}, "u1")
	b.manager.Settle()

	got := observer.gotEvents()
	if len(got) != 1 || got[0].Type != AuditContentEdited || got[0].DocID != histDoc ||
		!reflect.DeepEqual(got[0].Actor, &AuditActor{ID: "u1", Kind: "person"}) {
		t.Fatalf("events = %+v", got)
	}
}

func TestDeletingALineageAndPurgingAreEvents(t *testing.T) {
	observer := &signalObserver{}
	b := newSignalBench(t, observer, 0)
	old := b.lineage(t)
	histReset(t, b.manager)
	if status, _, err := b.manager.DeleteLineageBy(context.Background(), histDoc, old, "u9"); err != nil || status != HistoryReady {
		t.Fatalf("delete = %v, %v", status, err)
	}
	histPurge(t, b.manager)
	b.manager.Settle()

	got := observer.gotEvents()
	if len(got) != 2 ||
		got[0].Type != AuditLineageDeleted || got[0].Lineage != old ||
		!reflect.DeepEqual(got[0].Actor, &AuditActor{ID: "u9", Kind: "person"}) ||
		got[1].Type != AuditDocumentPurged || got[1].Actor != nil {
		t.Fatalf("events = %+v", got)
	}
}

func TestAHungObserverCallTimesOutAndLaterSignalsStillFlow(t *testing.T) {
	observer := &signalObserver{hangFirst: true, entered: make(chan struct{})}
	b := newSignalBench(t, observer, 0)
	histEdit(t, b.manager, histUpdate(t, "a", "two"))
	b.clock.Advance(time.Minute)
	b.timers.Advance(time.Minute)
	select {
	case <-observer.entered:
	case <-time.After(30 * time.Second):
		t.Fatal("the first signal never reached the observer")
	}
	b.clock.Advance(30 * time.Second)
	b.timers.Advance(30 * time.Second)
	b.manager.Settle()

	histEdit(t, b.manager, histUpdate(t, "a", "three"))
	b.advance(time.Minute)

	got := observer.gotSignals()
	if len(got) != 1 || got[0].FromSequence != 2 || got[0].ToSequence != 2 {
		t.Fatalf("signals = %+v", got)
	}
	b.logMu.Lock()
	defer b.logMu.Unlock()
	if !strings.Contains(strings.Join(b.logged, "\n"), "ran past") {
		t.Fatalf("log = %v", b.logged)
	}
}

func TestAWindowPastOneReadNamesOnlyTheRecordsItFolded(t *testing.T) {
	observer := &signalObserver{}
	b := newSignalBench(t, observer, 0)
	for i := 0; i <= MaxChangeRecords; i++ {
		histEdit(t, b.manager, histUpdate(t, "a", "edit "+strconv.Itoa(i)))
	}
	b.advance(time.Minute)

	got := observer.gotSignals()
	if len(got) != 1 || !got[0].Truncated || got[0].FromSequence != 2 || got[0].ToSequence != 201 {
		t.Fatalf("signals = %+v", got)
	}
}

func TestAWindowPastTheLongestRunsOneDay(t *testing.T) {
	observer := &signalObserver{}
	b := newSignalBench(t, observer, 60*24*time.Hour)
	histEdit(t, b.manager, histUpdate(t, "a", "two"))
	b.advance(24 * time.Hour)

	got := observer.gotSignals()
	if len(got) != 1 || got[0].WindowEnd.Sub(got[0].WindowStart) != 24*time.Hour {
		t.Fatalf("signals = %+v", got)
	}
}

type auditOnly struct {
	mu     sync.Mutex
	events []AuditEvent
}

func (o *auditOnly) Record(context.Context, string, string, time.Time, ActivityKind) error {
	return nil
}

func (o *auditOnly) OnEvent(_ context.Context, event AuditEvent) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.events = append(o.events, event)
	return nil
}

// A heartbeat that silences the next Edited must not silence the audit
// event for a real edit.
func TestAnActiveFrameThenAnEditStillSendsContentEdited(t *testing.T) {
	k := newRb2Kit()
	k.host.Holds(t, testDoc, "hello", nil)
	audit := &auditOnly{}
	o := DefaultOptions()
	o.Now = k.clock.Now
	manager := NewManager(ManagerOptions{Store: k.disk, Endpoint: k.host, Converter: k.knob, Room: o, Log: k.logf,
		Operations: k.journal, Activity: audit})
	t.Cleanup(func() { _ = manager.Drain(context.Background()) })
	member := rb2V2("user-1")
	membership := rb2Enter(t, manager, member)
	client := syncedClient(t, manager, testDoc, "hello")

	rb2Heartbeat(t, membership)
	k.clock.Advance(20 * time.Second)
	sendOperation(t, membership, member, opOne, updateAppending(client, "a"))
	manager.Settle()

	audit.mu.Lock()
	defer audit.mu.Unlock()
	if len(audit.events) != 1 || audit.events[0].Type != AuditContentEdited || audit.events[0].Actor == nil ||
		audit.events[0].Actor.ID != "user-1" {
		t.Fatalf("events = %+v", audit.events)
	}
}

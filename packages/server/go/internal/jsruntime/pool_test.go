package jsruntime

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// Each engine counts its own calls, so a test can tell reuse from a rebuild.
const countingScript = `
let calls = 0;
let open = 0;
globalThis.blokServerInvoke = async function (operation, input) {
  calls += 1;
  switch (operation) {
    case 'count': return String(calls);
    case 'spin': for (;;) {}
    case 'spinFor': { const until = Date.now() + Number(input); while (Date.now() < until) {} return 'ok'; }
    case 'throwError': throw new Error('the bundle itself broke');
    case 'throwTypeError': throw new TypeError('not a document');
    case 'throwSyntaxError': JSON.parse('not json');
    case 'throwRangeError': throw new RangeError('out of range');
    case 'throwString': throw 'bare';
    case 'pending': return new Promise(() => {});
    case 'awaitThenSpin': await null; for (;;) {}
    case 'recurse': { const r = (d) => d === 0 ? 0 : r(d - 1) + 1; return String(r(1000000)); }
    case 'catchRecursion': { try { const r = (d) => d === 0 ? 0 : r(d - 1) + 1; return String(r(1000000)); } catch (e) { return 'caught ' + e.name; } }
    case 'guardedRecurse': { const r = (d) => { open += 1; try { return d === 0 ? 0 : r(d - 1) + 1; } finally { open -= 1; } }; return String(r(1000000)); }
    case 'open': return String(open);
    case 'grow': { const kept = []; for (;;) { kept.push({ a: [1, 2, 3, 4, 5, 6, 7, 8] }); } }
    case 'churn': { let n = 0; for (let i = 0; i < Number(input); i++) { n += ('x' + i).repeat(1 << 16).length; } return String(n); }
    default: return 'ok';
  }
};`

func newCountingPool(t *testing.T, size int, timeout time.Duration, budget int64) *Pool {
	t.Helper()
	p, err := newPoolFromSource(countingScript, size, timeout, budget)
	if err != nil {
		t.Fatalf("newPoolFromSource: %v", err)
	}
	return p
}

func invoke(t *testing.T, p *Pool, op, input string) (string, error) {
	t.Helper()
	return p.Invoke(context.Background(), op, input, 0)
}

func wantKind(t *testing.T, err error, kind Kind) {
	t.Helper()
	var failure *Failure
	if !errors.As(err, &failure) {
		t.Fatalf("err = %v (%T), want a *Failure of kind %d", err, err, kind)
	}
	if failure.Kind != kind {
		t.Fatalf("kind = %d, want %d (err %v)", failure.Kind, kind, err)
	}
}

func wantCount(t *testing.T, p *Pool, want string) {
	t.Helper()
	got, err := invoke(t, p, "count", "")
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if got != want {
		t.Fatalf("count = %s, want %s", got, want)
	}
}

func TestTimesOutInsteadOfHanging(t *testing.T) {
	p := newCountingPool(t, 1, 200*time.Millisecond, 0)
	start := time.Now()
	_, err := invoke(t, p, "spin", "")
	wantKind(t, err, KindTimedOut)
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("took %v", elapsed)
	}
}

func TestTimesOutInsideTheJobQueue(t *testing.T) {
	p := newCountingPool(t, 1, 200*time.Millisecond, 0)
	_, err := invoke(t, p, "awaitThenSpin", "")
	wantKind(t, err, KindTimedOut)
}

// The pool is fixed size: a slot that is not refilled leaves later callers waiting forever.
func TestKeepsServingAfterATimeoutAndReplacesTheEngine(t *testing.T) {
	p := newCountingPool(t, 1, 200*time.Millisecond, 0)
	for range 3 {
		_, err := invoke(t, p, "spin", "")
		wantKind(t, err, KindTimedOut)
		// A fresh engine: its count starts again.
		wantCount(t, p, "1")
	}
}

func TestAPerCallTimeoutReplacesTheDefaultForThatCallOnly(t *testing.T) {
	p := newCountingPool(t, 1, 200*time.Millisecond, 0)
	got, err := p.Invoke(context.Background(), "spinFor", "600", 30*time.Second)
	if err != nil || got != "ok" {
		t.Fatalf("long call = %q, %v", got, err)
	}
	_, err = invoke(t, p, "spinFor", "600")
	wantKind(t, err, KindTimedOut)
}

func TestAPerCallTimeoutCanBeShorterThanTheDefault(t *testing.T) {
	p := newCountingPool(t, 1, 0, 0)
	_, err := p.Invoke(context.Background(), "spinFor", "600", 200*time.Millisecond)
	wantKind(t, err, KindTimedOut)
}

func TestRefusesAPerCallTimeoutBelowTheFloor(t *testing.T) {
	p := newCountingPool(t, 1, 0, 0)
	for _, timeout := range []time.Duration{time.Millisecond, -time.Second} {
		_, err := p.Invoke(context.Background(), "count", "", timeout)
		var constraint *ConstraintError
		if !errors.As(err, &constraint) || constraint.Param != "timeout" {
			t.Fatalf("timeout %v: err = %v, want a timeout ConstraintError", timeout, err)
		}
	}
	// Refused before an engine was taken.
	wantCount(t, p, "1")
}

// A deadline that fires just as a call ends must not stop the next call on
// the same engine.
func TestALateDeadlineNeverStopsTheNextCall(t *testing.T) {
	p := newCountingPool(t, 1, MinimumTimeout, 0)
	for attempt := range 40 {
		spin := fmt.Sprint(90 + attempt%20)
		if _, err := invoke(t, p, "spinFor", spin); err != nil {
			wantKind(t, err, KindTimedOut)
		}
		if _, err := invoke(t, p, "count", ""); err != nil {
			t.Fatalf("attempt %d: the next call failed: %v", attempt, err)
		}
	}
}

func TestClassifiesJavaScriptErrorsAndKeepsTheEngine(t *testing.T) {
	cases := []struct {
		op   string
		kind Kind
	}{
		{"throwError", KindUnknown},
		{"throwTypeError", KindInvalidDocument},
		{"throwSyntaxError", KindInvalidDocument},
		{"throwRangeError", KindUnknown},
		{"throwString", KindUnknown},
		{"noSuchOp", -1},
	}
	p := newCountingPool(t, 1, 0, 0)
	for _, c := range cases {
		if c.kind < 0 {
			continue
		}
		_, err := invoke(t, p, c.op, "")
		wantKind(t, err, c.kind)
	}
	// Five failed calls, then this one: the same engine served them all.
	wantCount(t, p, "6")
}

func TestClassifiesTheBundlesOwnErrorsByName(t *testing.T) {
	p, err := NewPool(Options{PoolSize: new(1)})
	if err != nil {
		t.Fatal(err)
	}
	_, err = invoke(t, p, "noSuchOperation", "{}")
	wantKind(t, err, KindInvalidDocument)
	_, err = invoke(t, p, "blocksToHtml", "not json")
	wantKind(t, err, KindInvalidDocument)
	_, err = invoke(t, p, "blocksToMarkdown", `{"nope":1}`)
	wantKind(t, err, KindInvalidDocument)
}

// Unlike Jint's catchable RangeError, goja's overflow cannot be caught in
// JS, and it skips every finally on the way out, so the engine's own state
// is left mid-call. The engine is replaced, where C# keeps its own.
func TestSurvivesRunawayRecursionAndReplacesTheEngine(t *testing.T) {
	p := newCountingPool(t, 1, 0, 0)
	_, err := invoke(t, p, "recurse", "")
	wantKind(t, err, KindUnknown)
	_, err = invoke(t, p, "catchRecursion", "")
	wantKind(t, err, KindUnknown)
	wantCount(t, p, "1")
}

// The bundle's state left by an overflow shrank how deep the next document
// could nest: 20 overflows took HTML from 1248 to 1244 levels (measured).
func TestAnOverflowLeavesNoStateForTheNextCall(t *testing.T) {
	p := newCountingPool(t, 1, 0, 0)
	_, err := invoke(t, p, "guardedRecurse", "")
	wantKind(t, err, KindUnknown)
	open, err := invoke(t, p, "open", "")
	if err != nil || open != "0" {
		t.Fatalf("open = %s, %v", open, err)
	}
}

// goja has no event loop, so a promise pending after the call never settles.
func TestFailsAPendingPromiseAtOnceAndKeepsTheEngine(t *testing.T) {
	p := newCountingPool(t, 1, 0, 0)
	start := time.Now()
	_, err := invoke(t, p, "pending", "")
	wantKind(t, err, KindUnknown)
	if !errors.Is(err, ErrPending) {
		t.Fatalf("err = %v, want ErrPending inside", err)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("took %v", elapsed)
	}
	wantCount(t, p, "2")
}

func TestStopsACallThatOutgrowsItsMemoryBudget(t *testing.T) {
	p := newCountingPool(t, 1, 30*time.Second, 64<<20)
	_, err := invoke(t, p, "grow", "")
	wantKind(t, err, KindDocumentTooLarge)
	wantCount(t, p, "1")
}

// Jint charges every allocation of a call, so garbage counts: strings
// dropped at once (about 250 MiB of them) outgrow an 8 MiB budget.
func TestChargesEveryAllocationNotTheHeapItHolds(t *testing.T) {
	p := newCountingPool(t, 1, 30*time.Second, MinimumMemoryBudget)
	_, err := invoke(t, p, "churn", "1024")
	wantKind(t, err, KindDocumentTooLarge)
}

// Go counts allocations for the whole process, so calls running together
// share what was allocated while they ran: each is charged its own part.
func TestChargesCallsThatRunTogetherOnlyTheirShare(t *testing.T) {
	p := newCountingPool(t, 2, 30*time.Second, 64<<20)
	// 420 rounds allocate about 102 MiB (measured), charged as about 38 MiB:
	// 60% of the budget.
	if _, err := invoke(t, p, "churn", "420"); err != nil {
		t.Fatalf("one call alone: %v", err)
	}
	errs := make(chan error, 2)
	for range 2 {
		go func() {
			_, err := p.Invoke(context.Background(), "churn", "420", 0)
			errs <- err
		}()
	}
	for range 2 {
		if err := <-errs; err != nil {
			t.Fatalf("two calls together: %v", err)
		}
	}
}

func TestReturnsTheCallersCancellationUnwrapped(t *testing.T) {
	p := newCountingPool(t, 1, 30*time.Second, 0)
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	_, err := p.Invoke(ctx, "spin", "", 0)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want context.DeadlineExceeded", err)
	}
	var failure *Failure
	if errors.As(err, &failure) {
		t.Fatalf("err = %v, a cancellation must not be a Failure", err)
	}
	// The engine was stopped mid-run, so it was replaced.
	wantCount(t, p, "1")
}

func TestCancellationEndsTheWaitForAnEngine(t *testing.T) {
	p := newCountingPool(t, 1, 30*time.Second, 0)
	busy := make(chan error, 1)
	go func() {
		_, err := p.Invoke(context.Background(), "spinFor", "500", 0)
		busy <- err
	}()
	time.Sleep(50 * time.Millisecond)

	ctx, cancel := context.WithCancel(context.Background())
	go func() { time.Sleep(50 * time.Millisecond); cancel() }()
	start := time.Now()
	_, err := p.Invoke(ctx, "count", "", 0)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
	if elapsed := time.Since(start); elapsed > 300*time.Millisecond {
		t.Fatalf("waited %v", elapsed)
	}
	if err := <-busy; err != nil {
		t.Fatalf("the busy call: %v", err)
	}
}

func TestRefusesAnAlreadyCancelledContext(t *testing.T) {
	p := newCountingPool(t, 1, 0, 0)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := p.Invoke(ctx, "count", "", 0); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
	wantCount(t, p, "1")
}

func TestKeepsTheSlotWhenARebuildFails(t *testing.T) {
	p := newCountingPool(t, 1, 200*time.Millisecond, 0)
	p.load = func() (*Runtime, error) { return nil, errors.New("no rebuild") }
	_, err := invoke(t, p, "spin", "")
	wantKind(t, err, KindTimedOut)
	// The spent engine went back, so the call is served, not stuck.
	got, err := invoke(t, p, "count", "")
	if err != nil || got != "2" {
		t.Fatalf("count = %q, %v; want the spent engine's 2", got, err)
	}
}

func TestHandlesConcurrentCallsWithoutSharingAnEngine(t *testing.T) {
	p, err := NewPool(Options{PoolSize: new(4)})
	if err != nil {
		t.Fatal(err)
	}
	const calls = 64
	var wg sync.WaitGroup
	errs := make(chan error, calls)
	for i := range calls {
		wg.Go(func() {
			text := fmt.Sprintf("paragraph number %d", i)
			input := fmt.Sprintf(`{"blocks":[{"id":"p","type":"paragraph","data":{"text":%q}}]}`, text)
			got, err := p.Invoke(context.Background(), "blocksToPlainText", input, 0)
			if err != nil || got != text {
				errs <- fmt.Errorf("call %d = %q, %v", i, got, err)
			}
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
}

func TestCallersWaitWhenEveryEngineIsBusy(t *testing.T) {
	p := newCountingPool(t, 2, 30*time.Second, 0)
	start := time.Now()
	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() {
			if _, err := p.Invoke(context.Background(), "spinFor", "200", 0); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	// Four 200 ms calls on two engines take two rounds.
	if elapsed := time.Since(start); elapsed < 350*time.Millisecond {
		t.Fatalf("took %v, want two rounds", elapsed)
	}
}

func nestedOutline(levels int) string {
	var blocks []string
	for depth := range levels {
		parent := "null"
		if depth > 0 {
			parent = fmt.Sprintf(`"n%d"`, depth-1)
		}
		blocks = append(blocks, fmt.Sprintf(`{"id":"n%d","parent":%s,"type":"list","data":{"style":"unordered","text":"level %d"}}`, depth, parent, depth))
	}
	return `{"blocks":[` + strings.Join(blocks, ",") + `]}`
}

func TestConvertsADeeplyNestedOutline(t *testing.T) {
	p, err := NewPool(Options{PoolSize: new(1)})
	if err != nil {
		t.Fatal(err)
	}
	input := nestedOutline(120)
	for _, op := range []string{"blocksToPlainText", "blocksToMarkdown", "blocksToHtml"} {
		got, err := p.Invoke(context.Background(), op, input, time.Minute)
		if err != nil || !strings.Contains(got, "level 119") {
			t.Fatalf("%s: err = %v, has level 119 = %v", op, err, strings.Contains(got, "level 119"))
		}
	}
}

// C# JintBlokRuntimeTests.ConvertsTheSameDepthWhateverTheCallerHasSpentOfItsStack:
// a 1000-level outline converts to HTML.
func TestConvertsTheSameDepthWhateverTheCallerHasSpentOfItsStack(t *testing.T) {
	p, err := NewPool(Options{PoolSize: new(1), Timeout: 2 * time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	got, err := p.Invoke(context.Background(), "blocksToHtml", nestedOutline(1000), 0)
	if err != nil || !strings.Contains(got, "level 999") {
		t.Fatalf("err = %v, has level 999 = %v", err, strings.Contains(got, "level 999"))
	}
}

// C# converts 2411 outline levels to HTML and stops at 2416 on its
// allocation budget (measured); Go's frame cap should reach as far.
func TestConvertsAsManyOutlineLevelsToHTMLAsCSharp(t *testing.T) {
	if testing.Short() || raceEnabled {
		t.Skip("slow")
	}
	p, err := NewPool(Options{PoolSize: new(1), Timeout: 2 * time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	got, err := p.Invoke(context.Background(), "blocksToHtml", nestedOutline(2411), 0)
	if err != nil || !strings.Contains(got, "level 2410") {
		t.Fatalf("err = %v, has level 2410 = %v", err, strings.Contains(got, "level 2410"))
	}
}

func TestReportsALoadThatRunsPastTheTimeout(t *testing.T) {
	_, err := newPoolFromSource(`for (;;) {}`, 1, 200*time.Millisecond, 0)
	var startup *StartupError
	if !errors.As(err, &startup) || startup.Cause != StartupTimedOut {
		t.Fatalf("err = %v, want a timed-out StartupError", err)
	}
	if !strings.Contains(startup.Error(), "200ms") || !strings.Contains(startup.Error(), "timeout") {
		t.Fatalf("message %q does not name the timeout", startup.Error())
	}
}

func TestReportsALoadThatOutgrowsTheBudget(t *testing.T) {
	_, err := newPoolFromSource(`const kept = []; for (;;) { kept.push([1, 2, 3, 4]); }`, 1, 30*time.Second, 1<<20)
	var startup *StartupError
	if !errors.As(err, &startup) || startup.Cause != StartupOverBudget {
		t.Fatalf("err = %v, want an over-budget StartupError", err)
	}
	// C# JintBlokRuntime's wording.
	if !strings.Contains(startup.Error(), "allocated more than the 1048576-byte allocation budget") ||
		!strings.Contains(startup.Error(), "(512 MiB)") {
		t.Fatalf("message %q does not name the budget", startup.Error())
	}
}

func TestReportsAnyOtherLoadFailure(t *testing.T) {
	for _, source := range []string{`throw new Error('broken')`, `var x = 1;`, `syntax error (`} {
		_, err := newPoolFromSource(source, 1, 0, 0)
		var startup *StartupError
		if !errors.As(err, &startup) || startup.Cause != StartupFailed {
			t.Fatalf("%q: err = %v, want a StartupError", source, err)
		}
		if startup.Error() != "Could not load Blok's runtime bundle into an engine." {
			t.Fatalf("message = %q", startup.Error())
		}
	}
}

func TestRefusesLimitsBelowTheirFloors(t *testing.T) {
	cases := []struct {
		options Options
		param   string
	}{
		{Options{MemoryBudget: 1024}, "MemoryBudget"},
		{Options{MemoryBudget: -1}, "MemoryBudget"},
		{Options{Timeout: time.Millisecond}, "Timeout"},
		{Options{Timeout: -time.Second}, "Timeout"},
		{Options{PoolSize: new(-1)}, "PoolSize"},
		{Options{PoolSize: new(0)}, "PoolSize"},
	}
	for _, c := range cases {
		_, err := NewPool(c.options)
		var constraint *ConstraintError
		if !errors.As(err, &constraint) || constraint.Param != c.param {
			t.Fatalf("%+v: err = %v, want a %s ConstraintError", c.options, err, c.param)
		}
	}
}

func TestLoadsAtTheFloors(t *testing.T) {
	if _, err := NewPool(Options{PoolSize: new(1), MemoryBudget: MinimumMemoryBudget, Timeout: 30 * time.Second}); err != nil {
		t.Fatalf("NewPool at the budget floor: %v", err)
	}
}

func TestTakesTheDefaultsForZeroOptions(t *testing.T) {
	p, err := NewPool(Options{})
	if err != nil {
		t.Fatal(err)
	}
	if p.timeout != 10*time.Second || p.budget != 512<<20 {
		t.Fatalf("timeout = %v, budget = %d", p.timeout, p.budget)
	}
	if want := max(1, min(runtime.NumCPU(), 4)); cap(p.engines) != want || len(p.engines) != want {
		t.Fatalf("pool holds %d of %d engines, want %d", len(p.engines), cap(p.engines), want)
	}
}

// C# JintBlokRuntimeTests.ReplacesAnEngineAfterCancellation. C# waits on the
// pending promise until the caller cancels; goja has no event loop, so the
// call fails at once (as in Rust). Either way the next call is served.
func TestReplacesAnEngineAfterCancellation(t *testing.T) {
	p, err := newPoolFromSource(`globalThis.blokServerInvoke = async (operation) => {
  if (operation === 'wait') return await new Promise(() => {});
  return 'ok';
};`, 1, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	cancelled, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err = p.Invoke(cancelled, "wait", "{}", 0)
	wantKind(t, err, KindUnknown)
	if !errors.Is(err, ErrPending) {
		t.Fatalf("err = %v, want ErrPending inside", err)
	}
	ready, stop := context.WithTimeout(context.Background(), 5*time.Second)
	defer stop()
	if output, err := p.Invoke(ready, "ready", "{}", 0); err != nil || output != "ok" {
		t.Fatalf("ready = %q, %v", output, err)
	}
}

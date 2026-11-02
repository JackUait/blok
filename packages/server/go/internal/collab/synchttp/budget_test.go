package synchttp

import (
	"testing"
	"time"
)

type fakeClock struct{ now time.Time }

func (c *fakeClock) Now() time.Time          { return c.now }
func (c *fakeClock) Advance(d time.Duration) { c.now = c.now.Add(d) }

func newTestBudget(clock *fakeClock, o BudgetOptions) *InboundBudget {
	return NewInboundBudget(o, clock.Now)
}

func defaultBudget() BudgetOptions {
	return BudgetOptions{FramesPerSecond: 50, BurstFrames: 100, ResyncsPerMinute: 60, AwarenessBytesPerSecond: 128 << 10}
}

func presence(size int) []byte {
	frame := make([]byte, size)
	frame[0] = 1
	return frame
}

// AnInboundBurstOverTheBudgetCloses1008: the clock never moves, so the
// eleventh frame is over.
func TestTheFrameAfterTheBurstIsOverBudget(t *testing.T) {
	clock := &fakeClock{now: time.Unix(1000, 0)}
	budget := newTestBudget(clock, BudgetOptions{FramesPerSecond: 10, BurstFrames: 10})
	for i := range 10 {
		if !budget.Allows(presence(2)) {
			t.Fatalf("frame %d refused inside the burst", i+1)
		}
	}
	if budget.Allows(presence(2)) {
		t.Fatal("the eleventh frame was allowed with no refill")
	}
}

// ASustainedLegitimateCadenceRefillsTheBudgetAndStaysOpen.
func TestASteadyCadenceRefillsTheBudget(t *testing.T) {
	clock := &fakeClock{now: time.Unix(1000, 0)}
	budget := newTestBudget(clock, BudgetOptions{FramesPerSecond: 10, BurstFrames: 10})
	for i := range 31 {
		if !budget.Allows(presence(2)) {
			t.Fatalf("frame %d refused at the rate", i+1)
		}
		clock.Advance(100 * time.Millisecond)
	}
}

func TestResyncsAndPresenceQueriesShareTheTighterBudget(t *testing.T) {
	frames := map[string][]byte{
		"SyncStep1":            {0, 0, 1, 0},
		"overlong SyncStep1":   {0x80, 0x00, 0x80, 0x00, 0x01, 0x00},
		"queryAwareness":       {3},
		"overlong query":       {0x83, 0x00},
		"SyncStep1 then extra": {0, 0},
	}
	for name, frame := range frames {
		clock := &fakeClock{now: time.Unix(1000, 0)}
		budget := newTestBudget(clock, defaultBudget())
		for i := range 10 {
			if !budget.Allows(frame) {
				t.Fatalf("%s: frame %d refused inside the amplifier burst", name, i+1)
			}
		}
		if budget.Allows(frame) {
			t.Fatalf("%s: the eleventh amplifier was allowed", name)
		}
	}
}

func TestUpdatesAndUnknownFramesAreNotAmplifiers(t *testing.T) {
	for name, frame := range map[string][]byte{
		"SyncStep2":   {0, 1, 0},
		"Update":      {0, 2, 0},
		"unknown":     {105},
		"undecodable": {0x80},
		"empty":       {},
	} {
		clock := &fakeClock{now: time.Unix(1000, 0)}
		budget := newTestBudget(clock, defaultBudget())
		for i := range 100 {
			if !budget.Allows(frame) {
				t.Fatalf("%s: frame %d refused inside the frame burst", name, i+1)
			}
		}
	}
}

// APresenceFloodOverTheAwarenessByteBudgetCloses1008, and a frame above the
// whole burst can never be paid.
func TestPresenceIsMeteredByBytes(t *testing.T) {
	clock := &fakeClock{now: time.Unix(1000, 0)}
	budget := newTestBudget(clock, defaultBudget())
	for i := range 5 {
		if !budget.Allows(presence(100_000)) {
			t.Fatalf("presence frame %d refused under 512 KiB", i+1)
		}
	}
	if budget.Allows(presence(100_000)) {
		t.Fatal("the sixth 100 KB presence frame was allowed")
	}

	fresh := newTestBudget(clock, defaultBudget())
	if !fresh.Allows(presence(512 << 10)) {
		t.Fatal("a presence frame of exactly the burst was refused")
	}
	fresh = newTestBudget(clock, defaultBudget())
	if fresh.Allows(presence(512<<10 + 1)) {
		t.Fatal("a presence frame over the burst was allowed")
	}
}

// ADocumentPasteOfTheSameSizeIsNotMeteredAsPresence.
func TestAnUpdateOfPresenceSizeIsNotMeteredAsPresence(t *testing.T) {
	clock := &fakeClock{now: time.Unix(1000, 0)}
	budget := newTestBudget(clock, defaultBudget())
	update := make([]byte, 100_000)
	update[1] = 2
	for i := range 6 {
		if !budget.Allows(update) {
			t.Fatalf("update %d refused", i+1)
		}
	}
}

func TestARateOfZeroTurnsABucketOff(t *testing.T) {
	clock := &fakeClock{now: time.Unix(1000, 0)}
	budget := newTestBudget(clock, BudgetOptions{BurstFrames: 1})
	for range 1000 {
		if !budget.Allows([]byte{0, 0, 0}) || !budget.Allows(presence(1<<20)) {
			t.Fatal("a zero rate refused a frame")
		}
	}
}

func TestTheAmplifierBucketRefillsPerMinute(t *testing.T) {
	clock := &fakeClock{now: time.Unix(1000, 0)}
	budget := newTestBudget(clock, defaultBudget())
	resync := []byte{0, 0, 0}
	for range 10 {
		budget.Allows(resync)
	}
	// 60 a minute is one a second.
	clock.Advance(999 * time.Millisecond)
	if budget.Allows(resync) {
		t.Fatal("refilled before a whole token")
	}
	clock.Advance(2 * time.Millisecond)
	if !budget.Allows(resync) {
		t.Fatal("no refill after one second")
	}
}

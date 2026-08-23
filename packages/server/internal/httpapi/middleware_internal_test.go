package httpapi

import (
	"testing"
	"time"
)

// An expired window is reset on access anyway, so eviction changes no decision
// and is invisible through allow(). It is only observable as the size of the
// map — which is the whole point: without a sweep the limiter holds one entry
// per distinct client for the life of the process, an unbounded allocation
// driven by anyone who can reach the port.
func TestRateLimiterEvictsWindowsNobodyReturnsTo(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	l := newRateLimiter(10, func() time.Time { return now })

	for i := 0; i < 500; i++ {
		l.allow("addr:198.51.100." + string(rune('a'+i%26)) + string(rune('a'+i/26)))
	}
	if len(l.windows) != 500 {
		t.Fatalf("len(windows) = %d, want 500 before any window expires", len(l.windows))
	}

	now = now.Add(2 * time.Minute)
	l.allow("addr:203.0.113.1")

	if len(l.windows) != 1 {
		t.Fatalf("len(windows) = %d, want 1: the 500 expired windows were never reclaimed", len(l.windows))
	}
}

// A client that keeps coming back must survive the sweep, or its count resets
// and the limit stops applying.
func TestRateLimiterKeepsLiveWindowsThroughASweep(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	l := newRateLimiter(2, func() time.Time { return now })

	l.allow("user:stale")

	now = now.Add(2 * time.Minute)
	l.allow("user:live") // triggers the sweep, and starts a fresh window

	now = now.Add(time.Second)
	if !l.allow("user:live") {
		t.Fatal("allow = false, want true: the live window was swept away and then... it would have to be recreated, not refused")
	}
	if l.allow("user:live") {
		t.Fatal("allow = true, want false: the live window was swept, so its count restarted and the limit stopped applying")
	}
	if _, ok := l.windows["user:stale"]; ok {
		t.Fatal("the stale window survived the sweep")
	}
}

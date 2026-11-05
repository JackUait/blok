package room

import (
	"testing"
	"time"
)

// Twin of C# CollabRoomConstantsCaptureTests: the room's timers and limits
// as C# holds them.
func TestTheRoomConstantsMatchCSharp(t *testing.T) {
	fixture := readRepoJSON(t, "test", "unit", "server-conformance", "fixtures", "collab-room-constants.json")
	want := func(key string) int64 {
		t.Helper()
		value, ok := member(t, fixture, key).(float64)
		if !ok {
			t.Fatalf("%q is not a number", key)
		}
		return int64(value)
	}
	ms := func(d time.Duration) int64 { return d.Milliseconds() }
	o := DefaultOptions().withDefaults()
	wide := OptionsWith(func(ro *Options) { ro.RetryBackoffCap = 10 * 24 * time.Hour }).withDefaults()
	for key, got := range map[string]int64{
		"exportDebounce":               ms(o.ExportDebounce),
		"exportMaxDelay":               ms(o.ExportMaxDelay),
		"evictionLinger":               ms(o.EvictionLinger),
		"compactionFrameThreshold":     int64(o.CompactionFrameThreshold),
		"compactionByteThreshold":      o.CompactionByteThreshold,
		"checkpointOperationThreshold": o.CheckpointOperationThreshold,
		"checkpointByteThreshold":      o.CheckpointByteThreshold,
		"maxAwarenessClients":          int64(o.MaxAwarenessClients),
		"retryBackoff":                 ms(o.RetryBackoff),
		"retryBackoffCap":              ms(o.RetryBackoffCap),
		"commitTimeout":                ms(o.CommitTimeout),
		"malformedAwarenessLimit":      malformedAwarenessLimit,
		"checkpointFailureLimit":       checkpointFailureLimit,
		"transientExportFailureLimit":  transientExportFailureLimit,
		"activityWindow":               ms(activityWindow),
		"activityQueueLimit":           activityQueueLimit,
		"activityStampLimit":           activityStampLimit,
		"maxJoinAttempts":              maxJoinAttempts,
		"maxChangeRecords":             MaxChangeRecords,
		"maxChangeBytes":               MaxChangeBytes,
		"timelineIdleGap":              ms(timelineIdleGap),
		"timelineMaxSpan":              ms(timelineMaxSpan),
	} {
		if expected := want(key); got != expected {
			t.Errorf("%s = %d, C# holds %d", key, got, expected)
		}
	}
	for key, options := range map[string]Options{"backoff": o, "backoffUnderATenDayCap": wide} {
		series, _ := member(t, fixture, key).([]any)
		if len(series) != 21 {
			t.Fatalf("%s has %d entries", key, len(series))
		}
		for failures, value := range series {
			if got := ms(options.Backoff(failures)); got != int64(value.(float64)) {
				t.Errorf("%s(%d) = %d ms, C# says %v", key, failures, got, value)
			}
		}
	}
	// $comment, 22 values and 2 series.
	if fixture.Len() != 25 {
		t.Errorf("the fixture holds %d keys; compare the new ones here", fixture.Len())
	}
}

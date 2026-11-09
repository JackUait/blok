package room

import (
	"reflect"
	"time"
)

// Options is CollabRoomOptions. DefaultOptions holds C#'s defaults; a field
// set to zero stays zero, as a C# init property does. Build one with
// DefaultOptions or OptionsWith, not a bare literal.
type Options struct {
	ExportDebounce           time.Duration
	ExportMaxDelay           time.Duration
	EvictionLinger           time.Duration
	CompactionFrameThreshold int
	CompactionByteThreshold  int64
	// CheckpointOperationThreshold and CheckpointByteThreshold: a journal
	// room's counterpart to compaction.
	CheckpointOperationThreshold int64
	CheckpointByteThreshold      int64
	MaxAwarenessClients          int
	// AnnouncedMaxMessageBytes 0 announces no limits frame.
	AnnouncedMaxMessageBytes int64
	// MaxUpdateBytes is the store's append limit when known; 0 means unknown.
	MaxUpdateBytes  int64
	RetryBackoff    time.Duration
	RetryBackoffCap time.Duration
	// CommitTimeout bounds each store call made with the lane held.
	CommitTimeout time.Duration
	// Now is the room's clock; time.Now when nil.
	Now func() time.Time
	// RestoreTrashesPages: a history restore, by any path, sets data.trashed
	// on a page pointer the point lacks instead of removing it.
	RestoreTrashesPages bool
	// Timers is TimeProvider.CreateTimer: the export, eviction and persist
	// timers and every CommitTimeout bound run on it. Wall time when nil.
	Timers Timers
}

// Timers runs f once d has passed on its clock. stop cancels f and reports
// whether it had not run yet.
type Timers interface {
	AfterFunc(d time.Duration, f func()) (stop func() bool)
}

type wallTimers struct{}

func (wallTimers) AfterFunc(d time.Duration, f func()) func() bool {
	return time.AfterFunc(d, f).Stop
}

const (
	malformedAwarenessLimit     = 3
	checkpointFailureLimit      = 3
	transientExportFailureLimit = 8
	maxJoinAttempts             = 16
	// activityWindow is shorter than the client's 60 s heartbeat on purpose:
	// equal values let jitter drop every other heartbeat.
	activityWindow     = 55 * time.Second
	activityQueueLimit = 256
	activityStampLimit = 256
)

// DefaultOptions is new CollabRoomOptions().
func DefaultOptions() Options {
	return Options{
		ExportDebounce:               2 * time.Second,
		ExportMaxDelay:               10 * time.Second,
		EvictionLinger:               30 * time.Second,
		CompactionFrameThreshold:     64,
		CompactionByteThreshold:      1 << 20,
		CheckpointOperationThreshold: 64,
		CheckpointByteThreshold:      1 << 20,
		MaxAwarenessClients:          256,
		RetryBackoff:                 2 * time.Second,
		RetryBackoffCap:              60 * time.Second,
		CommitTimeout:                10 * time.Second,
	}
}

// OptionsWith is DefaultOptions with set applied: C#'s object initializer.
func OptionsWith(set func(*Options)) Options {
	o := DefaultOptions()
	set(&o)
	return o
}

// withDefaults fills the clock and the timers. A wholly zero Options (ManagerOptions with
// no Room) is C#'s `roomOptions ?? new CollabRoomOptions()`.
func (o Options) withDefaults() Options {
	bare := o
	bare.Now, bare.Timers = nil, nil
	if reflect.ValueOf(bare).IsZero() {
		bare = DefaultOptions()
		bare.Now, bare.Timers = o.Now, o.Timers
		o = bare
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.Timers == nil {
		o.Timers = wallTimers{}
	}
	return o
}

// Backoff is the doubling wait after failures, capped: 2 s, 4 s, ... 60 s.
func (o Options) Backoff(failures int) time.Duration {
	steps := failures - 1
	if steps < 0 {
		steps = 0
	}
	if steps > 16 {
		steps = 16
	}
	delay := o.RetryBackoff * time.Duration(1<<steps)
	if delay < o.RetryBackoffCap {
		return delay
	}
	return o.RetryBackoffCap
}

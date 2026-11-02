package room

import "time"

// Options is CollabRoomOptions. Zero fields take C#'s defaults in withDefaults.
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

func (o Options) withDefaults() Options {
	if o.ExportDebounce == 0 {
		o.ExportDebounce = 2 * time.Second
	}
	if o.ExportMaxDelay == 0 {
		o.ExportMaxDelay = 10 * time.Second
	}
	if o.EvictionLinger == 0 {
		o.EvictionLinger = 30 * time.Second
	}
	if o.CompactionFrameThreshold == 0 {
		o.CompactionFrameThreshold = 64
	}
	if o.CompactionByteThreshold == 0 {
		o.CompactionByteThreshold = 1 << 20
	}
	if o.CheckpointOperationThreshold == 0 {
		o.CheckpointOperationThreshold = 64
	}
	if o.CheckpointByteThreshold == 0 {
		o.CheckpointByteThreshold = 1 << 20
	}
	if o.MaxAwarenessClients == 0 {
		o.MaxAwarenessClients = 256
	}
	if o.RetryBackoff == 0 {
		o.RetryBackoff = 2 * time.Second
	}
	if o.RetryBackoffCap == 0 {
		o.RetryBackoffCap = 60 * time.Second
	}
	if o.CommitTimeout == 0 {
		o.CommitTimeout = 10 * time.Second
	}
	if o.Now == nil {
		o.Now = time.Now
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

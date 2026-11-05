package room

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab"
	"github.com/JackUait/blok/packages/server/go/internal/collab/wire"
	"github.com/JackUait/blok/packages/server/go/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

type roomState int

const (
	stateNew roomState = iota
	stateReady
	stateClosed
)

// Membership is a member's handle onto its room: CollabMembership.
type Membership struct {
	room   *Room
	member collab.Member
	// tag is the working-set tag the member joined under.
	tag workingset.Tag
	// Room-owned, touched only in the lane.
	malformedAwareness int
	// synced is set once the room queued its SyncStep2 to this member; a v2
	// operation before that is refused as not-synced.
	synced bool
}

func (m *Membership) Receive(ctx context.Context, frame []byte) error {
	return m.room.receive(ctx, m, frame)
}

func (m *Membership) Leave() { m.room.leave(m) }

// Member is the connection behind this membership.
func (m *Membership) Member() collab.Member { return m.member }

type awarenessOwner struct {
	membership *Membership
	clock      uint64
}

type pendingActivity struct {
	actor string
	at    time.Time
	kind  ActivityKind
}

// task is a C# Task the lane awaits or observes later.
type task[T any] struct {
	done   chan struct{}
	result T
	err    error
}

func start[T any](run func() (T, error)) *task[T] {
	t := &task[T]{done: make(chan struct{})}
	go func() {
		t.result, t.err = run()
		close(t.done)
	}()
	return t
}

func (t *task[T]) wait() (T, error) {
	<-t.done
	return t.result, t.err
}

// Room is one doc's sync room: CollabRoom.
type Room struct {
	docID      string
	store      WorkingSetStore
	operations OperationStore
	activity   ActivityObserver
	endpoint   Endpoint
	converter  Converter
	options    Options
	log        func(string)

	lane     lane
	lifetime context.Context
	cancel   context.CancelFunc

	members         ordered[*Membership, struct{}]
	awarenessOwners ordered[uint64, awarenessOwner]
	activityStamps  map[string]time.Time
	awarenessCache  []wire.AwarenessEntry

	activityMu       sync.Mutex
	activityQueue    []pendingActivity
	activityPumping  bool
	activityDispatch chan struct{}

	frameSection bytes.Buffer
	exportTimer  roomTimer
	evictTimer   roomTimer
	persistTimer roomTimer

	localUpdates [][]byte
	unsubscribe  func()

	state   roomState
	tag     workingset.Tag
	doc     *yjs.Doc
	session OperationSession

	frameCount      int
	baseFrameLength int64

	committedThrough          uint64
	checkpointedThrough       uint64
	checkpointFailures        int
	operationsSinceCheckpoint int64
	bytesSinceCheckpoint      int64

	blobVersion       int64
	persistedVersion  int64
	persistingVersion int64
	inFlightPersist   *task[struct{}]
	persistFailures   int

	version        *string
	pendingVersion *task[*string]

	exportDirty             bool
	projectionOwed          bool
	projectionRefused       bool
	dirtySince              *time.Time
	exportRetryAt           *time.Time
	exportFailures          int
	transientExportFailures int
	migrationFailed         bool
	inFlightSave            *task[*string]

	purgeRequested atomic.Bool
	disposed       bool

	// Read by the manager when the room closes.
	commitUnavailable bool
	loadHeldOff       bool
	onClosed          func(*Room)
}

func newRoom(docID string, m *Manager) *Room {
	r := &Room{
		docID:          docID,
		store:          m.store,
		operations:     m.operations,
		activity:       m.activity,
		endpoint:       m.endpoint,
		converter:      m.converter,
		options:        m.options,
		log:            m.log,
		activityStamps: map[string]time.Time{},
		tag:            workingset.Tag{Format: workingset.CurrentFormat, Lineage: workingset.NoLineage},
	}
	r.lifetime, r.cancel = context.WithCancel(context.Background())
	for _, timer := range []*roomTimer{&r.exportTimer, &r.evictTimer, &r.persistTimer} {
		timer.timers = r.options.Timers
	}
	r.exportTimer.fire = func() { r.post(r.tryExportLocked) }
	r.evictTimer.fire = func() { r.post(r.evictLocked) }
	r.persistTimer.fire = func() {
		r.post(func() error {
			r.schedulePersistLocked()
			return nil
		})
	}
	return r
}

// DocID is the document this room serves.
func (r *Room) DocID() string { return r.docID }

func (r *Room) logf(message string) {
	if r.log != nil {
		r.log(message)
	}
}

// logfSurviving logs where a failing logger must not stop access cleanup.
func (r *Room) logfSurviving(message string) {
	defer func() { _ = recover() }()
	r.logf(message)
}

func (r *Room) requestPurge() { r.purgeRequested.Store(true) }

// run is RunAsync: the operation holds the lane.
func (r *Room) run(ctx context.Context, operation func() error) error {
	if err := r.lane.enter(ctx); err != nil {
		return err
	}
	defer r.lane.leave()
	return operation()
}

// post is fire-and-forget lane entry for timers and observers. Its place in
// line is taken now, not when the goroutine runs: a checkpoint posted inside
// a commit must run before the next frame's work.
func (r *Room) post(operation func() error) {
	turn := r.lane.reserve()
	go func() {
		<-turn
		defer r.lane.leave()
		if err := operation(); err != nil {
			r.logf(`collab: room "` + r.docID + `" background work failed: ` + err.Error())
		}
	}()
}

// join is JoinAsync. A nil result means the room already closed: retry on a
// fresh one.
func (r *Room) join(ctx context.Context, member collab.Member) (*collab.JoinResult, error) {
	var result *collab.JoinResult
	err := r.run(ctx, func() error {
		if r.purgeRequested.Load() {
			result = &collab.JoinResult{Status: collab.JoinPurged}
			return nil
		}
		if r.state == stateClosed {
			return nil
		}
		allowed, err := r.isMemberAllowedLocked(ctx, member)
		if err != nil {
			return err
		}
		if !allowed {
			if r.state == stateNew {
				r.closeRoomLocked(nil)
			}
			result = &collab.JoinResult{Status: collab.JoinForbidden}
			return nil
		}
		if r.purgeRequested.Load() {
			result = &collab.JoinResult{Status: collab.JoinPurged}
			return nil
		}
		if r.state == stateNew {
			if failure := r.tryLoadLocked(); failure != nil {
				r.closeRoomLocked(nil)
				status := collab.JoinSeedFailed
				switch failure.open {
				case openPurged:
					status = collab.JoinPurged
				case openElsewhere:
					status = collab.JoinUnavailable
				}
				result = &collab.JoinResult{Status: status, Err: failure.err}
				return nil
			}
		}
		if r.purgeRequested.Load() {
			result = &collab.JoinResult{Status: collab.JoinPurged}
			return nil
		}
		if err := ctx.Err(); err != nil {
			// The joiner is gone but the room is Ready: arm the linger, or
			// only a leave that never comes would.
			r.updateEvictionLocked(-1)
			return err
		}

		membership := &Membership{room: r, member: member, tag: r.tag}
		r.members.set(membership, struct{}{})
		r.updateEvictionLocked(-1)
		r.recordActivityLocked(member.ActorID(), ActivityJoined)

		if member.AcceptsControlFrames() {
			r.sendEncoded(membership, wire.BlokControl{Tag: wireTag(r.tag)})
			if r.options.AnnouncedMaxMessageBytes > 0 {
				r.sendEncoded(membership, wire.BlokLimits{MaxMessageBytes: r.options.AnnouncedMaxMessageBytes})
			}
		}
		// Sent even when empty, so a reconnect overwrites the stale map the
		// client still holds.
		r.sendEncoded(membership, r.identitiesFrameLocked())
		r.broadcastLocked(queryAwarenessFrame, membership)
		result = &collab.JoinResult{Status: collab.JoinJoined, Membership: membership}
		return nil
	})
	return result, err
}

// recheckAccess is RecheckAccessAsync: expels every member that fails.
func (r *Room) recheckAccess(ctx context.Context) (int, error) {
	expelled := 0
	err := r.run(ctx, func() error {
		if r.state != stateReady {
			return nil
		}
		for _, membership := range r.members.keys() {
			allowed, err := r.isMemberAllowedLocked(ctx, membership.member)
			if err != nil {
				return err
			}
			if !allowed {
				r.expelLocked(membership, collab.CloseForbidden)
				expelled++
			}
		}
		return nil
	})
	return expelled, err
}

// isMemberAllowedLocked: a failed check is a denial, except a cancellation
// once the caller cancelled. Any other failure still denies, as in C#.
func (r *Room) isMemberAllowedLocked(ctx context.Context, member collab.Member) (bool, error) {
	allowed, err := member.RecheckAccess(ctx)
	if err == nil {
		return allowed, nil
	}
	if ctx.Err() != nil && (errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)) {
		return false, ctx.Err()
	}
	r.logfSurviving(`collab: room "` + r.docID + `" could not recheck member access: ` + err.Error())
	return false, nil
}

func (r *Room) receive(ctx context.Context, membership *Membership, frame []byte) error {
	return r.run(ctx, func() error {
		if !r.purgeRequested.Load() && r.state == stateReady && r.members.has(membership) {
			r.receiveLocked(membership, frame)
		}
		return nil
	})
}

func (r *Room) leave(membership *Membership) {
	_ = r.run(context.Background(), func() error {
		if r.members.remove(membership) {
			r.withdrawAwarenessLocked(membership)
			r.updateEvictionLocked(-1)
			r.recordActivityLocked(membership.member.ActorID(), ActivityLeft)
		}
		return nil
	})
}

var queryAwarenessFrame = mustEncode(wire.QueryAwareness{})

func mustEncode(message wire.Message) []byte {
	frame, err := wire.Encode(message)
	if err != nil {
		panic(err)
	}
	return frame
}

func wireTag(tag workingset.Tag) wire.Tag {
	return wire.Tag{Format: tag.Format, Epoch: tag.Epoch, Lineage: tag.Lineage}
}

func (r *Room) sendEncoded(membership *Membership, message wire.Message) {
	frame, err := wire.Encode(message)
	if err != nil {
		r.logf(`collab: room "` + r.docID + `" could not hand a frame to a member: ` + err.Error())
		return
	}
	r.send(membership, frame)
}

func (r *Room) send(membership *Membership, frame []byte) {
	defer func() {
		if failure := recover(); failure != nil {
			r.logf(`collab: room "` + r.docID + `" could not hand a frame to a member`)
		}
	}()
	membership.member.Send(frame)
}

func (r *Room) broadcastLocked(frame []byte, except *Membership) {
	for membership := range r.members.all() {
		if membership != except {
			r.send(membership, frame)
		}
	}
}

func (r *Room) closeMember(membership *Membership, reason collab.CloseReason) {
	defer func() {
		if failure := recover(); failure != nil {
			r.logf(`collab: room "` + r.docID + `" could not close a member`)
		}
	}()
	membership.member.Close(reason)
}

// expelLocked stops serving one member. Removing it from the set is the
// never-twice guard: the leave that follows finds nothing to remove.
func (r *Room) expelLocked(membership *Membership, reason collab.CloseReason) {
	if !r.members.remove(membership) {
		return
	}
	r.withdrawAwarenessLocked(membership)
	r.updateEvictionLocked(-1)
	r.closeMember(membership, reason)
	r.recordActivityLocked(membership.member.ActorID(), ActivityLeft)
}

// updateEvictionLocked is the one place the linger is armed or disarmed.
// linger < 0 means the configured linger.
func (r *Room) updateEvictionLocked(linger time.Duration) {
	if r.state != stateReady {
		return
	}
	if r.members.len() > 0 {
		r.evictTimer.change(-1)
		return
	}
	if linger < 0 {
		linger = r.options.EvictionLinger
	}
	r.evictTimer.change(linger)
}

// newOperationID is what a v1 write is journalled under.
func newOperationID() string {
	var id [16]byte
	_, _ = rand.Read(id[:])
	return hex.EncodeToString(id[:])
}

// closeRoomLocked releases the fence with the room. The session close is
// bounded: past CommitTimeout it is abandoned.
func (r *Room) closeRoomLocked(reason *collab.CloseReason) {
	if closing := r.session; closing != nil {
		r.session = nil
		done := make(chan error, 1)
		go func() { done <- closing.Close() }()
		bound, stop := r.after(r.options.CommitTimeout)
		select {
		case err := <-done:
			if err != nil {
				r.logf(`collab: room "` + r.docID + `" could not release its operation session: ` + err.Error())
			}
		case <-bound:
			r.logf(`collab: room "` + r.docID + `" could not release its operation session: it did not answer within the commit timeout`)
		}
		stop()
	}
	r.closeLocked(reason)
}

func (r *Room) closeLocked(reason *collab.CloseReason) {
	r.state = stateClosed
	for membership := range r.members.all() {
		if reason != nil {
			r.closeMember(membership, *reason)
		}
		// The only end these sessions get.
		r.recordActivityLocked(membership.member.ActorID(), ActivityLeft)
	}
	r.members.clear()
	r.dispose()
	if r.onClosed != nil {
		r.onClosed(r)
	}
}

func (r *Room) dispose() {
	if r.disposed {
		return
	}
	r.disposed = true
	r.exportTimer.stop()
	r.evictTimer.stop()
	r.persistTimer.stop()
	r.cancel()
	if r.unsubscribe != nil {
		r.unsubscribe()
		r.unsubscribe = nil
	}
	r.doc = nil
}

func reasonPtr(reason collab.CloseReason) *collab.CloseReason { return &reason }

// roomTimer is an ITimer: change(d) re-arms it once, d < 0 disarms it.
type roomTimer struct {
	mu     sync.Mutex
	timers Timers
	// timer stops the armed callback; nil when disarmed.
	timer func() bool
	fire  func()
	dead  bool
}

func (t *roomTimer) change(d time.Duration) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.dead {
		return
	}
	if t.timer != nil {
		t.timer()
		t.timer = nil
	}
	if d < 0 {
		return
	}
	t.timer = t.timers.AfterFunc(d, t.fire)
}

func (t *roomTimer) stop() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.dead = true
	if t.timer != nil {
		t.timer()
		t.timer = nil
	}
}

package synchttp

import (
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab/wire"
)

// amplifierBurst: a flaky reconnect can land a few resyncs at once.
const amplifierBurst = 10

// awarenessBurstBytes: several full presence replies in a large room; a
// single frame above it can never be paid for.
const awarenessBurstBytes = 512 * 1024

// BudgetOptions are the four CollabInbound* options. A rate of 0 is off.
type BudgetOptions struct {
	FramesPerSecond         int
	BurstFrames             int
	ResyncsPerMinute        int
	AwarenessBytesPerSecond int
}

// InboundBudget is one connection's SyncInboundBudget: every frame costs a
// slot, SyncStep1 and queryAwareness also cost an amplifier token, and
// awareness also costs its bytes. Only its connection's receive loop uses
// it, so it has no lock.
type InboundBudget struct {
	frames, amplifiers, awarenessBytes tokenBucket
}

// NewInboundBudget reads elapsed time from now; pass time.Now so the
// monotonic clock is used, as TimeProvider.GetTimestamp is in C#.
func NewInboundBudget(o BudgetOptions, now func() time.Time) *InboundBudget {
	return &InboundBudget{
		frames:         newTokenBucket(now, float64(o.FramesPerSecond), float64(o.BurstFrames)),
		amplifiers:     newTokenBucket(now, float64(o.ResyncsPerMinute)/60, amplifierBurst),
		awarenessBytes: newTokenBucket(now, float64(o.AwarenessBytesPerSecond), awarenessBurstBytes),
	}
}

// Allows is false when frame is over budget; the caller closes 1008.
func (b *InboundBudget) Allows(frame []byte) bool {
	if !b.frames.take(1) {
		return false
	}
	switch classify(frame) {
	case classAmplifier:
		return b.amplifiers.take(1)
	case classPresence:
		return b.awarenessBytes.take(float64(len(frame)))
	}
	return true
}

type frameClass int

const (
	classPlain frameClass = iota
	classAmplifier
	classPresence
)

// classify reads the type with the codec's varuint reader, never by bytes:
// [0x80, 0x00] is also type 0.
func classify(frame []byte) frameClass {
	messageType, rest, ok := wire.ReadVarUint(frame)
	switch {
	case !ok:
		return classPlain
	case messageType == wire.MessageAwareness:
		return classPresence
	case messageType == wire.MessageQueryAwareness:
		return classAmplifier
	case messageType == wire.MessageSync:
		if subType, _, ok := wire.ReadVarUint(rest); ok && subType == wire.SyncStep1Type {
			return classAmplifier
		}
	}
	return classPlain
}

type tokenBucket struct {
	now       func() time.Time
	perSecond float64
	capacity  float64
	tokens    float64
	stamp     time.Time
}

func newTokenBucket(now func() time.Time, perSecond, capacity float64) tokenBucket {
	return tokenBucket{now: now, perSecond: perSecond, capacity: capacity, tokens: capacity, stamp: now()}
}

func (b *tokenBucket) take(cost float64) bool {
	if b.perSecond <= 0 {
		return true
	}
	now := b.now()
	b.tokens = min(b.capacity, b.tokens+now.Sub(b.stamp).Seconds()*b.perSecond)
	b.stamp = now
	if b.tokens < cost {
		return false
	}
	b.tokens -= cost
	return true
}

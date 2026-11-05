package room

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strconv"

	"github.com/JackUait/blok/packages/server/go/internal/collab"
	"github.com/JackUait/blok/packages/server/go/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/internal/collab/wire"
)

func (r *Room) receiveLocked(membership *Membership, frame []byte) {
	message, decodeErr := wire.Decode(frame)
	if decodeErr != nil {
		r.logf(`collab: room "` + r.docID + `" dropped a frame: ` + decodeErr.Reason)
		return
	}
	// Protocol §7: a v2 client writes only through operation frames.
	switch message.(type) {
	case wire.SyncStep2, wire.SyncUpdate:
		if membership.member.ProtocolSource() == collab.SourceClientV2 {
			r.logf(`collab: room "` + r.docID + `" closed a v2 member that sent a raw write`)
			r.expelLocked(membership, collab.CloseRawWriteOnV2)
			return
		}
	}
	switch m := message.(type) {
	case wire.SyncStep1:
		r.answerSyncStep1Locked(membership, m.StateVector)
	case wire.SyncStep2:
		r.applyFromMemberLocked(membership, m.Update)
	case wire.SyncUpdate:
		r.applyFromMemberLocked(membership, m.Update)
	case wire.Operation:
		r.commitFromMemberLocked(membership, m)
	case wire.Awareness:
		r.relayAwarenessLocked(membership, m)
	case wire.QueryAwareness:
		r.broadcastLocked(queryAwarenessFrame, membership)
	case wire.Activity:
		// Payload-free: identity comes from the handshake, time from here.
		r.recordActivityLocked(membership.member.ActorID(), ActivityActive)
	}
}

// relayAwarenessLocked relays presence verbatim after walking it. Over the
// cap the frame is dropped; the third malformed frame closes the sender.
func (r *Room) relayAwarenessLocked(membership *Membership, awareness wire.Awareness) {
	clients, valid := wire.ValidateAwarenessUpdate(awareness.Update, r.options.MaxAwarenessClients, &r.awarenessCache)
	if valid {
		r.recordAwarenessOwnersLocked(membership, r.awarenessCache)
		r.broadcastLocked(mustEncode(awareness), membership)
		return
	}
	if clients > r.options.MaxAwarenessClients {
		r.logf(fmt.Sprintf(`collab: room "%s" dropped an awareness frame claiming %d clients (the cap is %d)`,
			r.docID, clients, r.options.MaxAwarenessClients))
		return
	}
	membership.malformedAwareness++
	r.logf(fmt.Sprintf(`collab: room "%s" dropped a malformed awareness frame (%d of %d from this member)`,
		r.docID, membership.malformedAwareness, malformedAwarenessLimit))
	if membership.malformedAwareness >= malformedAwarenessLimit {
		r.expelLocked(membership, collab.CloseBadAwareness)
	}
}

// answerSyncStep1Locked replies Step2(diff) then Step1(sv), and only then
// marks the member synced. The server never sends its own SyncStep1 first.
func (r *Room) answerSyncStep1Locked(membership *Membership, peerStateVector []byte) {
	diff, err := r.doc.EncodeStateAsUpdate(peerStateVector)
	if err != nil {
		r.logf(`collab: room "` + r.docID + `" dropped a SyncStep1 it could not answer: ` + err.Error())
		return
	}
	stateVector := r.doc.EncodeStateVector()
	if len(diff) == 0 || len(stateVector) == 0 {
		r.logf(`collab: room "` + r.docID + `" dropped a SyncStep1 with an unusable state vector`)
		return
	}
	r.sendEncoded(membership, wire.SyncStep2{Update: diff})
	r.sendEncoded(membership, wire.SyncStep1{StateVector: stateVector})
	membership.synced = true
}

// boundedLocked is one store call made with the lane held, bounded by
// CommitTimeout.
func (r *Room) boundedLocked() (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.lifetime, r.options.CommitTimeout)
}

// commitFromMemberLocked is a v2 operation: settle the id, apply, journal
// it, and only then let anyone see it.
func (r *Room) commitFromMemberLocked(membership *Membership, op wire.Operation) {
	if r.session == nil {
		r.logf(`collab: room "` + r.docID + `" dropped an operation frame; it has no operation store`)
		return
	}
	if membership.member.ProtocolSource() != collab.SourceClientV2 {
		r.logf(`collab: room "` + r.docID + `" dropped an operation frame from a member that did not negotiate v2`)
		return
	}
	if !membership.member.CanWrite() {
		r.rejectLocked(membership, op, "read-only")
		return
	}
	if !membership.synced {
		r.rejectLocked(membership, op, "not-synced")
		return
	}
	// Ahead of the lookup, which answers for the current lineage only.
	if op.Lineage != r.tag.Lineage {
		r.rejectLocked(membership, op, "lineage-mismatch")
		return
	}
	digest := sha256.Sum256(op.Update)
	ctx, cancel := r.boundedLocked()
	committed, err := r.session.FindCommitted(ctx, op.OperationID, digest[:])
	cancel()
	if err != nil {
		r.failCommitLocked("look up an operation id", err)
		return
	}
	switch committed.Outcome {
	case operation.LookupDuplicate:
		r.acknowledgeLocked(membership, op, committed.Sequence)
		return
	case operation.LookupConflict:
		r.rejectLocked(membership, op, "operation-id-conflict")
		return
	}
	if _, ok := r.applyRemoteLocked(op.Update); !ok {
		r.rejectLocked(membership, op, "invalid-update")
		return
	}
	sequence, ok := r.appendCommittedLocked(op.OperationID, membership.member.ActorID(), membership.member.ProtocolSource(), op.Update, digest[:])
	if !ok {
		return
	}
	r.appendLocked(op.Update)
	// The submitter included: on v2 the relay is how a writer sees what was
	// accepted, and the acknowledgement follows it.
	r.broadcastLocked(mustEncode(wire.SyncUpdate{Update: op.Update}), nil)
	r.acknowledgeLocked(membership, op, sequence)
	r.compactIfOversizedLocked()
	r.schedulePersistLocked()
	r.markDirtyLocked()
}

// appendCommittedLocked is the durable step every journal write shares. It
// answers the sequence, or closes the room before anything is published.
func (r *Room) appendCommittedLocked(operationID, actorID string, source collab.OperationSource, update, digest []byte) (uint64, bool) {
	var actor *string
	if actorID != "" {
		actor = &actorID
	}
	ctx, cancel := r.boundedLocked()
	appended, err := r.session.Append(ctx, operation.Candidate{
		OperationID: operationID,
		ActorID:     actor,
		Source:      operation.Source(source),
		Update:      update,
		Digest:      digest,
	})
	cancel()
	if err != nil {
		// A timeout too: the write may still land, so the outcome is unknown.
		r.failCommitLocked("journal an operation", err)
		return 0, false
	}
	if appended.Outcome != operation.Committed {
		r.failCommitLocked("journal an operation", fmt.Errorf(
			`collab: the store returned %s for new operation "%s".`, appendOutcomeName(appended.Outcome), operationID))
		return 0, false
	}
	r.committedThrough = appended.Sequence
	// After the append: an edit is reported once it is durable.
	r.recordActivityLocked(actorID, ActivityEdited)
	r.operationsSinceCheckpoint++
	r.bytesSinceCheckpoint += int64(len(update))
	if r.operationsSinceCheckpoint >= r.options.CheckpointOperationThreshold ||
		r.bytesSinceCheckpoint >= r.options.CheckpointByteThreshold {
		// Posted: this operation still owes its broadcast and receipt.
		r.post(func() error {
			_, err := r.checkpointLocked()
			return err
		})
	}
	return appended.Sequence, true
}

func appendOutcomeName(outcome operation.AppendOutcome) string {
	switch outcome {
	case operation.Committed:
		return "Committed"
	case operation.AppendDuplicate:
		return "Duplicate"
	case operation.AppendConflict:
		return "Conflict"
	}
	return strconv.Itoa(int(outcome))
}

func (r *Room) acknowledgeLocked(membership *Membership, op wire.Operation, sequence uint64) {
	r.sendEncoded(membership, wire.Acknowledgement{Lineage: r.tag.Lineage, OperationID: op.OperationID, ServerSequence: sequence})
}

// rejectLocked carries the lineage the client named, not the room's.
func (r *Room) rejectLocked(membership *Membership, op wire.Operation, code string) {
	r.logf(`collab: room "` + r.docID + `" refused operation "` + op.OperationID + `": ` + code)
	r.sendEncoded(membership, wire.Rejection{Lineage: op.Lineage, OperationID: op.OperationID, Code: code})
}

// failCommitLocked: the doc may hold bytes the journal does not, so the room
// closes every member with the retryable close and discards itself.
func (r *Room) failCommitLocked(what string, err error) {
	// Every commit step runs on a fresh commit-timeout context, so a cancel
	// here came during the call.
	r.logf(`collab: room "` + r.docID + `" could not ` + what + `, closing: ` + errorText(err, nil, false))
	r.commitUnavailable = true
	r.closeRoomLocked(reasonPtr(collab.CloseCommitUnavailable))
}

// applyFromMemberLocked is a SyncStep2 or Update from a v1 or stock member.
// A journal room journals it under a minted id and sends no receipt.
func (r *Room) applyFromMemberLocked(membership *Membership, update []byte) {
	if !membership.member.CanWrite() {
		return
	}
	if r.session == nil {
		if _, ok := r.applyRemoteLocked(update); ok {
			r.publishFromMemberLocked(membership, update)
		}
		return
	}
	applied, ok := r.applyRemoteLocked(update)
	if !ok {
		return
	}
	// The ENGINE decides whether anything changed, never the bytes.
	if !applied.Changed {
		return
	}
	digest := sha256.Sum256(update)
	if _, ok := r.appendCommittedLocked(newOperationID(), membership.member.ActorID(), membership.member.ProtocolSource(), update, digest[:]); !ok {
		return
	}
	r.publishFromMemberLocked(membership, update)
}

// publishFromMemberLocked relays a v1 write to the OTHERS only.
func (r *Room) publishFromMemberLocked(membership *Membership, update []byte) {
	r.appendLocked(update)
	r.broadcastLocked(mustEncode(wire.SyncUpdate{Update: update}), membership)
	r.compactIfOversizedLocked()
	r.schedulePersistLocked()
	r.markDirtyLocked()
}

// recordAwarenessOwnersLocked: ownership follows the clock, never the
// sender; an unknown id is claimed only from a one-entry frame.
func (r *Room) recordAwarenessOwnersLocked(membership *Membership, entries []wire.AwarenessEntry) {
	ownPublish := len(entries) == 1
	changed := false
	skipped := 0
	for _, entry := range entries {
		if entry.ClientID > wire.MaxAwarenessClientID {
			skipped++
			continue
		}
		owner, known := r.awarenessOwners.get(entry.ClientID)
		if entry.Removed {
			if known && entry.Clock >= owner.clock {
				r.awarenessOwners.remove(entry.ClientID)
			}
			continue
		}
		if known {
			if entry.Clock > owner.clock {
				previous := owner.membership.member.ActorID()
				r.awarenessOwners.set(entry.ClientID, awarenessOwner{membership, entry.Clock})
				if membership.member.ActorID() != previous {
					changed = true
				}
			}
			continue
		}
		if ownPublish && r.awarenessOwners.len() < r.options.MaxAwarenessClients {
			r.awarenessOwners.set(entry.ClientID, awarenessOwner{membership, entry.Clock})
			if membership.member.ActorID() != "" {
				changed = true
			}
		}
	}
	if skipped > 0 {
		r.logf(fmt.Sprintf(`collab: room "%s" ignored %d awareness client id(s) past the safe-integer ceiling in one frame`, r.docID, skipped))
	}
	if changed {
		r.broadcastLocked(mustEncode(r.identitiesFrameLocked()), nil)
	}
}

// withdrawAwarenessLocked tells the room a departing member's clients are
// gone; a crashed tab never says so itself.
func (r *Room) withdrawAwarenessLocked(membership *Membership) {
	var gone []wire.AwarenessEntry
	for clientID, owner := range r.awarenessOwners.all() {
		if owner.membership == membership {
			gone = append(gone, wire.AwarenessEntry{ClientID: clientID, Clock: owner.clock, Removed: true})
		}
	}
	if len(gone) == 0 {
		return
	}
	for _, entry := range gone {
		r.awarenessOwners.remove(entry.ClientID)
	}
	r.broadcastLocked(mustEncode(wire.Awareness{Update: wire.EncodeAwarenessRemoval(gone)}), membership)
	if membership.member.ActorID() != "" {
		r.broadcastLocked(mustEncode(r.identitiesFrameLocked()), nil)
	}
}

// identitiesFrameLocked is the whole verified map, every time.
func (r *Room) identitiesFrameLocked() wire.Identities {
	identities := []wire.Identity{}
	for clientID, owner := range r.awarenessOwners.all() {
		if actor := owner.membership.member.ActorID(); actor != "" {
			identities = append(identities, wire.Identity{ClientID: clientID, ActorID: actor})
		}
	}
	return wire.Identities{Identities: identities}
}

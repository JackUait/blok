// Package collab holds the seam between the sync endpoint and the rooms:
// the member a room talks to, and the membership the endpoint feeds. The
// room lane implements Rooms; the endpoint (synchttp) implements Member.
package collab

import "context"

// CloseReason is why a room closes a member: CollabCloseReason. The endpoint
// maps it to a close code and reason.
type CloseReason int

const (
	// CloseReset: the doc was reset; 4409.
	CloseReset CloseReason = iota
	// CloseForbidden: access was revoked; 4403. It overtakes any other close.
	CloseForbidden
	// CloseDraining: the server is shutting down; 1001.
	CloseDraining
	// CloseBadAwareness: presence a stock client cannot parse; 1008.
	CloseBadAwareness
	// CloseCommitUnavailable: a journal commit was not confirmed; 4503.
	CloseCommitUnavailable
	// CloseRawWriteOnV2: a v2 member sent SyncStep2 or Update; 1008.
	CloseRawWriteOnV2
)

// OperationSource is CollabOperationSource. The numbers are stored on disk.
type OperationSource int

const (
	SourceClientV2 OperationSource = 0
	SourceClientV1 OperationSource = 1
	SourceHTTPEdit OperationSource = 2
)

// Member is one connection as a room sees it: ICollabMember. The room calls
// Send and Close inside its lane, so both must enqueue and return; they never
// block on the socket.
type Member interface {
	// CanWrite false drops the member's SyncStep2 and Update frames.
	CanWrite() bool
	// AcceptsControlFrames is true when a blok-sync subprotocol was
	// negotiated: the room sends the control frame first.
	AcceptsControlFrames() bool
	// ActorID is who a journalled write is attributed to; "" when the
	// connection carries no verified identity.
	ActorID() string
	ProtocolSource() OperationSource
	// RecheckAccess checks the admitted read (and write) rights again.
	RecheckAccess(ctx context.Context) (bool, error)
	// Send queues one encoded wire frame.
	Send(frame []byte)
	Close(reason CloseReason)
}

// JoinStatus is CollabJoinStatus.
type JoinStatus int

const (
	JoinJoined JoinStatus = iota
	// JoinForbidden: access changed after the handshake; HTTP 403.
	JoinForbidden
	// JoinPurged: the document was purged; HTTP 403.
	JoinPurged
	// JoinSeedFailed: the doc endpoint could not seed; upgrade, then 4503.
	JoinSeedFailed
	// JoinDraining: the server is shutting down; HTTP 503.
	JoinDraining
	// JoinUnavailable: held elsewhere or in a retry cooldown; upgrade, then 4503.
	JoinUnavailable
)

// Membership is a member's handle onto its room: CollabMembership.
type Membership interface {
	// Receive hands the room one whole inbound frame.
	Receive(ctx context.Context, frame []byte) error
	// Leave is called once, when the connection ends.
	Leave()
}

// JoinResult is CollabJoinResult. Membership is set only when Status is
// JoinJoined.
type JoinResult struct {
	Status     JoinStatus
	Membership Membership
	Err        error
}

// Rooms is the part of the room manager the sync endpoint uses.
type Rooms interface {
	// Join adds member to doc's room. A context error means the request
	// was aborted and nothing is answered.
	Join(ctx context.Context, doc string, member Member) (JoinResult, error)
}

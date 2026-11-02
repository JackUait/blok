package synchttp

import "github.com/JackUait/blok/packages/server/go/internal/collab"

// CloseFrame is a close status and its exact reason text: SyncCloseFrame.
// Compared as a whole value, so code AND reason must match.
type CloseFrame struct {
	Status uint16
	Reason string
}

// Every close the sync endpoint sends: SyncClose.cs.
var (
	CloseNormal              = CloseFrame{1000, ""}
	CloseDraining            = CloseFrame{1001, "server shutting down"}
	CloseTooBig              = CloseFrame{1009, "message too big"}
	CloseInboundRateExceeded = CloseFrame{1008, "inbound rate exceeded"}
	CloseSlowConsumer        = CloseFrame{1008, "outbound queue overflow"}
	CloseBadDocument         = CloseFrame{4400, "document ids must be a single path segment"}
	CloseMissingPass         = CloseFrame{4401, "missing pass"}
	CloseInvalidPass         = CloseFrame{4401, "invalid pass"}
	CloseOtherDocument       = CloseFrame{4401, "pass is for another document"}
	CloseTextFrame           = CloseFrame{1003, "binary frames only"}
	CloseUserlessPass        = CloseFrame{4401, "pass names no user"}
	CloseForbidden           = CloseFrame{4403, "forbidden"}
	CloseReset               = CloseFrame{4409, "document reset"}
	CloseSeedFailed          = CloseFrame{4503, "document unavailable"}
	CloseCommitUnavailable   = CloseFrame{4503, "commit unavailable, retry"}
	CloseBadAwareness        = CloseFrame{1008, "malformed awareness"}
	CloseRawWriteOnV2        = CloseFrame{1008, "raw write on a v2 session"}
	CloseInternal            = CloseFrame{1011, "internal error"}
)

// closeFor is SyncClose.For: a reason outside the set closes 1011, never
// panics, because the room calls it inside its lane.
func closeFor(reason collab.CloseReason) CloseFrame {
	switch reason {
	case collab.CloseReset:
		return CloseReset
	case collab.CloseForbidden:
		return CloseForbidden
	case collab.CloseDraining:
		return CloseDraining
	case collab.CloseBadAwareness:
		return CloseBadAwareness
	case collab.CloseCommitUnavailable:
		return CloseCommitUnavailable
	case collab.CloseRawWriteOnV2:
		return CloseRawWriteOnV2
	}
	return CloseInternal
}

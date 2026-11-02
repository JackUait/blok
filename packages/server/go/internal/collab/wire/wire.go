// Package wire is SyncWire: y-protocols framing as y-websocket puts it on the
// wire, one message per WebSocket frame, plus Blok's own types 100-107.
// Pinned byte for byte by sync-frames.json and sync-wire-decode.json, which
// the C# SyncWire tests read too.
package wire

// Message types. 105 is unassigned and decodes as Unknown.
const (
	MessageSync            uint64 = 0
	MessageAwareness       uint64 = 1
	MessageAuth            uint64 = 2
	MessageQueryAwareness  uint64 = 3
	MessageBlokControl     uint64 = 100
	MessageBlokLimits      uint64 = 101
	MessageOperation       uint64 = 102
	MessageAcknowledgement uint64 = 103
	MessageRejection       uint64 = 104
	MessageActivity        uint64 = 106
	MessageIdentities      uint64 = 107
)

// Sync sub-types. SyncStep1 is exported because the inbound budget
// classifies frames by it.
const (
	SyncStep1Type uint64 = 0
	syncStep2Type uint64 = 1
	syncUpdate    uint64 = 2

	authPermissionDenied uint64 = 0
)

// maxVarUintBytes: 64 bits is ten LEB128 bytes.
const maxVarUintBytes = 10

// MaxAwarenessClientID is 2^53-1: identities are JSON, and a JS client
// reads a larger id with lost precision and refuses the whole frame.
const MaxAwarenessClientID uint64 = 1<<53 - 1

// Message is one decoded frame.
type Message interface{ isMessage() }

type (
	SyncStep1  struct{ StateVector []byte }
	SyncStep2  struct{ Update []byte }
	SyncUpdate struct{ Update []byte }
	// Awareness is relayed verbatim, never parsed.
	Awareness        struct{ Update []byte }
	QueryAwareness   struct{}
	PermissionDenied struct{ Reason string }
	// BlokControl announces the working set: epoch, format and lineage.
	BlokControl struct{ Tag Tag }
	// BlokLimits announces the message cap in bytes.
	BlokLimits struct{ MaxMessageBytes int64 }
	// Operation is a v2 client write; Lineage and OperationID are 32
	// lowercase hex characters.
	Operation struct {
		Lineage, OperationID string
		Update               []byte
	}
	// Acknowledgement: ServerSequence is at least 1.
	Acknowledgement struct {
		Lineage, OperationID string
		ServerSequence       uint64
	}
	// Rejection: Code is an open set matching ^[a-z][a-z0-9-]{0,63}$.
	Rejection struct{ Lineage, OperationID, Code string }
	Activity  struct{}
	// Identities maps awareness client ids to verified actor ids.
	Identities struct{ Identities []Identity }
	// Unknown is a type this codec does not know; the room ignores it.
	Unknown struct{ MessageType uint64 }
)

// Identity is one verified awareness client.
type Identity struct {
	ClientID uint64
	ActorID  string
}

func (SyncStep1) isMessage()        {}
func (SyncStep2) isMessage()        {}
func (SyncUpdate) isMessage()       {}
func (Awareness) isMessage()        {}
func (QueryAwareness) isMessage()   {}
func (PermissionDenied) isMessage() {}
func (BlokControl) isMessage()      {}
func (BlokLimits) isMessage()       {}
func (Operation) isMessage()        {}
func (Acknowledgement) isMessage()  {}
func (Rejection) isMessage()        {}
func (Activity) isMessage()         {}
func (Identities) isMessage()       {}
func (Unknown) isMessage()          {}

// Tag is CollabWorkingSetTag as the control frame carries it.
type Tag struct {
	Format  int32
	Epoch   int64
	Lineage string
}

// IsAnnounceable is format >= 1, epoch >= 0 and a 32-hex lineage.
func (t Tag) IsAnnounceable() bool {
	return t.Format >= 1 && t.Epoch >= 0 && IsLineage(t.Lineage)
}

// IsLineage is 32 lowercase hex characters.
func IsLineage(value string) bool {
	if len(value) != 32 {
		return false
	}
	for i := 0; i < len(value); i++ {
		c := value[i]
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

// ReadVarUint reads a lib0 varuint: at most ten bytes, and the tenth may
// carry only bit 0. It never panics; ok is false on a short or wide input.
func ReadVarUint(input []byte) (value uint64, rest []byte, ok bool) {
	for i := 0; i < maxVarUintBytes && i < len(input); i++ {
		current := input[i]
		bits := uint64(current & 0x7f)
		if i == maxVarUintBytes-1 && bits > 1 {
			return 0, input, false
		}
		value |= bits << (7 * i)
		if current&0x80 == 0 {
			return value, input[i+1:], true
		}
	}
	return 0, input, false
}

// readVarBytes checks the length against what is left BEFORE slicing, so a
// huge prefix never allocates.
func readVarBytes(input []byte) (b, rest []byte, ok bool) {
	length, remaining, ok := ReadVarUint(input)
	if !ok || length > uint64(len(remaining)) {
		return nil, input, false
	}
	return remaining[:length], remaining[length:], true
}

func appendVarUint(dst []byte, value uint64) []byte {
	for {
		current := byte(value & 0x7f)
		value >>= 7
		if value != 0 {
			current |= 0x80
		}
		dst = append(dst, current)
		if value == 0 {
			return dst
		}
	}
}

func appendVarBytes(dst, b []byte) []byte {
	return append(appendVarUint(dst, uint64(len(b))), b...)
}

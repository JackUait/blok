package wire

import (
	"bytes"
	"math"
)

// AwarenessEntry is one entry of an awareness payload; Removed marks the
// exact state bytes "null" a departing client publishes.
type AwarenessEntry struct {
	ClientID uint64
	Clock    uint64
	Removed  bool
}

var nullState = []byte("null")

// ValidateAwarenessUpdate walks [clients]{[clientId][clock][varstring state]}*
// and checks each state is one JSON value, which is what a stock client
// throws on. clientCount is the claimed count (capped at 2^31-1), set as
// soon as it is read, so a caller can tell over-cap from malformed. entries,
// when not nil, is reset and filled with what was read.
func ValidateAwarenessUpdate(payload []byte, maxClients int, entries *[]AwarenessEntry) (clientCount int, valid bool) {
	if entries != nil {
		*entries = (*entries)[:0]
	}
	claimed, payload, ok := ReadVarUint(payload)
	if !ok {
		return 0, false
	}
	clientCount = math.MaxInt32
	if claimed <= math.MaxInt32 {
		clientCount = int(claimed)
	}
	if claimed > uint64(maxClients) {
		return clientCount, false
	}
	for entry := uint64(0); entry < claimed; entry++ {
		var clientID, clock uint64
		var state []byte
		if clientID, payload, ok = ReadVarUint(payload); !ok {
			return clientCount, false
		}
		if clock, payload, ok = ReadVarUint(payload); !ok {
			return clientCount, false
		}
		if state, payload, ok = readVarBytes(payload); !ok || !isJSONDocument(state) {
			return clientCount, false
		}
		if entries != nil {
			*entries = append(*entries, AwarenessEntry{ClientID: clientID, Clock: clock, Removed: bytes.Equal(state, nullState)})
		}
	}
	return clientCount, len(payload) == 0
}

// EncodeAwarenessRemoval writes each client at its last clock with a null
// state: y-protocols' removeAwarenessStates on the wire.
func EncodeAwarenessRemoval(clients []AwarenessEntry) []byte {
	b := appendVarUint(nil, uint64(len(clients)))
	for _, client := range clients {
		b = appendVarUint(b, client.ClientID)
		b = appendVarUint(b, client.Clock)
		b = appendVarBytes(b, nullState)
	}
	return b
}

func isJSONDocument(json []byte) bool {
	reader := newJSONReader(json)
	read, err := reader.Read()
	if err != nil || !read {
		return false
	}
	if reader.Skip() != nil {
		return false
	}
	more, err := reader.Read()
	return err == nil && !more
}

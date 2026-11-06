package blokmcp

import (
	"cmp"
	"encoding/json"
	"slices"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/lib0"
)

// awareness is y-protocols' Awareness for one client: every known state
// with its clock, the local one as ordered fields, as JSON.stringify keeps
// them.
type awareness struct {
	local uint64
	// seq is each state's insertion order, as a JS Map keeps it: a
	// removed state leaves, and comes back at the end.
	seq      map[uint64]uint64
	next     uint64
	states   map[uint64]json.RawMessage
	meta     map[uint64]awarenessMeta
	fields   []awarenessField
	hasLocal bool
	now      func() time.Time
}

type awarenessMeta struct {
	clock       uint64
	lastUpdated time.Time
}

type awarenessField struct {
	key   string
	value json.RawMessage
}

// awarenessOutdated is y-protocols' outdatedTimeout.
const awarenessOutdated = 30 * time.Second

// awarenessTombstoneTTL is how long the store keeps a stateless peer's
// clock row (AWARENESS_TOMBSTONE_TTL_MS), so a relayed old state cannot
// come back.
const awarenessTombstoneTTL = 90 * time.Second

func newAwareness(clientID uint64) *awareness {
	a := &awareness{local: clientID, seq: map[uint64]uint64{}, states: map[uint64]json.RawMessage{}, meta: map[uint64]awarenessMeta{}, now: time.Now}
	a.setLocal([]awarenessField{}, true)
	return a
}

// setState stores a client's state; a new one goes to the end of the order.
func (a *awareness) setState(client uint64, state json.RawMessage) {
	if _, ok := a.states[client]; !ok {
		a.next++
		a.seq[client] = a.next
	}
	a.states[client] = state
}

func (a *awareness) removeState(client uint64) {
	delete(a.states, client)
	delete(a.seq, client)
}

func (a *awareness) localJSON() json.RawMessage {
	buffer := []byte{'{'}
	for i, field := range a.fields {
		if i > 0 {
			buffer = append(buffer, ',')
		}
		key, _ := marshal(field.key)
		buffer = append(buffer, key...)
		buffer = append(buffer, ':')
		buffer = append(buffer, field.value...)
	}
	return append(buffer, '}')
}

// setLocal is setLocalState: the clock moves on every call.
func (a *awareness) setLocal(fields []awarenessField, present bool) {
	clock := uint64(0)
	if meta, ok := a.meta[a.local]; ok {
		clock = meta.clock + 1
	}
	a.fields, a.hasLocal = fields, present
	if present {
		a.setState(a.local, a.localJSON())
	} else {
		a.removeState(a.local)
	}
	a.meta[a.local] = awarenessMeta{clock: clock, lastUpdated: a.now()}
}

// setField is setLocalStateField.
func (a *awareness) setField(key string, value any) {
	if !a.hasLocal {
		return
	}
	written, _ := marshal(value)
	fields := slices.Clone(a.fields)
	replaced := false
	for i := range fields {
		if fields[i].key == key {
			fields[i].value, replaced = written, true
		}
	}
	if !replaced {
		fields = append(fields, awarenessField{key: key, value: written})
	}
	a.setLocal(fields, true)
}

// renewDue is the 3 s sweep's check: the local state is 15 s old.
func (a *awareness) renewDue() bool {
	return a.hasLocal && a.now().Sub(a.meta[a.local].lastUpdated) >= awarenessOutdated/2
}

// sweepRemote drops remote states not renewed for 30 s.
func (a *awareness) sweepRemote() {
	for client, meta := range a.meta {
		if client != a.local && a.now().Sub(meta.lastUpdated) >= awarenessOutdated {
			a.removeState(client)
		}
	}
}

// known lists every client with a state, in Map order.
func (a *awareness) known() []uint64 {
	clients := make([]uint64, 0, len(a.states))
	for client := range a.states {
		clients = append(clients, client)
	}
	slices.SortFunc(clients, func(x, y uint64) int { return cmp.Compare(a.seq[x], a.seq[y]) })
	return clients
}

// pruneMeta drops the clock rows of remote peers with no state, silent past
// the tombstone time, as the store does before each inbound apply.
func (a *awareness) pruneMeta() {
	for client, meta := range a.meta {
		if _, has := a.states[client]; client != a.local && !has && a.now().Sub(meta.lastUpdated) > awarenessTombstoneTTL {
			delete(a.meta, client)
		}
	}
}

// encode is encodeAwarenessUpdate over clients (with a meta row).
func (a *awareness) encode(clients []uint64) []byte {
	w := &lib0.Writer{}
	var listed []uint64
	for _, client := range clients {
		if _, ok := a.meta[client]; ok {
			listed = append(listed, client)
		}
	}
	w.WriteVarUint(uint64(len(listed)))
	for _, client := range listed {
		state, ok := a.states[client]
		if !ok {
			state = json.RawMessage("null")
		}
		w.WriteVarUint(client)
		w.WriteVarUint(a.meta[client].clock)
		w.WriteVarString(jsjson.FromString(string(state)))
	}
	return w.Bytes()
}

// departure is a null state at the current clock, from an empty map.
func (a *awareness) departure() []byte {
	if _, ok := a.meta[a.local]; !ok {
		return nil
	}
	w := &lib0.Writer{}
	w.WriteVarUint(1)
	w.WriteVarUint(a.local)
	w.WriteVarUint(a.meta[a.local].clock)
	w.WriteVarString(jsjson.FromString("null"))
	return w.Bytes()
}

// apply is applyAwarenessUpdate; it reports the clients that changed. A
// malformed update is dropped.
func (a *awareness) apply(update []byte) (changed []uint64, ok bool) {
	a.pruneMeta()
	r := lib0.NewReader(update)
	count, err := r.ReadVarUint()
	if err != nil {
		return nil, false
	}
	now := a.now()
	for range count {
		client, err := r.ReadVarUint()
		if err != nil {
			return changed, false
		}
		clock, err := r.ReadVarUint()
		if err != nil {
			return changed, false
		}
		text, err := r.ReadVarString()
		if err != nil {
			return changed, false
		}
		raw := json.RawMessage(text.String())
		if !json.Valid(raw) {
			return changed, false
		}
		meta := a.meta[client]
		_, hasState := a.states[client]
		isNull := string(raw) == "null"
		if !(meta.clock < clock || (meta.clock == clock && isNull && hasState)) {
			continue
		}
		if isNull {
			if client == a.local && a.hasLocal {
				clock++
			} else {
				a.removeState(client)
			}
		} else {
			a.setState(client, raw)
		}
		a.meta[client] = awarenessMeta{clock: clock, lastUpdated: now}
		changed = append(changed, client)
	}
	return changed, true
}

// clearRemote drops every remote state, as a connection ends.
func (a *awareness) clearRemote() {
	for client := range a.states {
		if client != a.local {
			a.removeState(client)
		}
	}
}

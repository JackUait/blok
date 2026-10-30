package yjs

import (
	"cmp"
	"slices"

	"github.com/JackUait/blok/packages/server/go/internal/lib0"
)

// Store holds every integrated struct, one contiguous ascending run per
// client, plus what could not be integrated yet. Clients keep the order
// they were first added in, as a .NET Dictionary does.
type Store struct {
	clients map[uint64][]Struct
	order   []uint64

	pendingStructs []Struct
	hasPending     bool
	pendingDs      *DeleteSet
	pendingMissing *StateVector
}

func newStore() *Store { return &Store{clients: map[uint64][]Struct{}} }

func (s *Store) getState(client uint64) uint64 {
	structs, ok := s.clients[client]
	if !ok {
		return 0
	}
	return structs[len(structs)-1].head().end()
}

func (s *Store) getStateVector() *StateVector {
	vector := &StateVector{}
	for _, client := range s.order {
		vector.Set(client, s.getState(client))
	}
	return vector
}

func (s *Store) structs(client uint64) []Struct {
	structs, ok := s.clients[client]
	if !ok {
		fail("yjs: client %d is not in the store.", client)
	}
	return structs
}

func (s *Store) find(id ID) Struct {
	return s.structs(id.Client)[s.findIndex(id.Client, id.Clock)]
}

// findIndex bisects a client's contiguous run. A missing clock is an engine
// error: callers check the state first.
func (s *Store) findIndex(client, clock uint64) int {
	structs := s.structs(client)
	left, right := 0, len(structs)-1
	// yjs tests the last struct for an exact clock first. Only that finds a
	// length-0 last struct, which the state vector names: without it every
	// encode of such a document fails.
	if right >= 0 && structs[right].head().id.Clock == clock {
		return right
	}
	for left <= right {
		middle := left + (right-left)/2
		current := structs[middle].head()
		if clock < current.id.Clock {
			right = middle - 1
			continue
		}
		if clock < current.end() {
			return middle
		}
		left = middle + 1
	}
	fail("yjs: client %d has no struct at clock %d; check the state first.", client, clock)
	return 0
}

func (s *Store) getItemCleanStart(t *Transaction, id ID) *Item {
	item, ok := s.getStructCleanStart(t, id).(*Item)
	if !ok {
		fail("yjs: %v is a collected struct, not an item.", id)
	}
	return item
}

// getStructCleanStart returns the struct starting exactly at id, splitting
// the item that covers it. A GC is returned whole.
func (s *Store) getStructCleanStart(t *Transaction, id ID) Struct {
	index := s.findIndex(id.Client, id.Clock)
	found := s.clients[id.Client][index]
	if item, ok := found.(*Item); ok && item.id.Clock < id.Clock {
		return s.split(t, id.Client, index, item, int(id.Clock-item.id.Clock))
	}
	return found
}

// getItemCleanEnd returns the struct ending exactly at id. A GC is
// returned whole.
func (s *Store) getItemCleanEnd(t *Transaction, id ID) Struct {
	index := s.findIndex(id.Client, id.Clock)
	found := s.clients[id.Client][index]
	if item, ok := found.(*Item); ok && id.Clock != item.lastID().Clock {
		s.split(t, id.Client, index, item, int(id.Clock-item.id.Clock)+1)
	}
	return found
}

func (s *Store) replaceStruct(existing, replacement Struct) {
	id := existing.head().id
	s.clients[id.Client][s.findIndex(id.Client, id.Clock)] = replacement
}

// split cuts item and files the right half straight after it.
func (s *Store) split(t *Transaction, client uint64, index int, item *Item, diff int) *Item {
	right := item.splitAt(diff)
	s.clients[client] = slices.Insert(s.clients[client], index+1, Struct(right))
	if t != nil {
		t.mergeStructs = append(t.mergeStructs, right)
	}
	return right
}

// addStruct appends to the client's run. A first struct may start at any
// clock; a later gap is refused, and no empty run is ever left behind.
func (s *Store) addStruct(added Struct) {
	id := added.head().id
	structs, ok := s.clients[id.Client]
	if !ok {
		s.clients[id.Client] = []Struct{added}
		s.order = append(s.order, id.Client)
		return
	}
	if end := structs[len(structs)-1].head().end(); end != id.Clock {
		fail("yjs: client %d jumps from clock %d to %d.", id.Client, end, id.Clock)
	}
	s.clients[id.Client] = append(structs, added)
}

// StateVector is, per client, the next clock that client has not produced.
// It encodes clients in descending id order.
type StateVector struct {
	clocks map[uint64]uint64
	order  []uint64
}

// Get is the client's clock, 0 when unknown.
func (v *StateVector) Get(client uint64) uint64 {
	if v == nil {
		return 0
	}
	return v.clocks[client]
}

// Has reports a listed client.
func (v *StateVector) Has(client uint64) bool {
	if v == nil {
		return false
	}
	_, ok := v.clocks[client]
	return ok
}

// Set records a clock.
func (v *StateVector) Set(client, clock uint64) {
	if v.clocks == nil {
		v.clocks = map[uint64]uint64{}
	}
	if _, ok := v.clocks[client]; !ok {
		v.order = append(v.order, client)
	}
	v.clocks[client] = clock
}

// Len is the number of clients.
func (v *StateVector) Len() int {
	if v == nil {
		return 0
	}
	return len(v.order)
}

// Clients are the listed clients, highest id first.
func (v *StateVector) Clients() []uint64 {
	if v == nil {
		return nil
	}
	clients := slices.Clone(v.order)
	slices.SortFunc(clients, func(a, b uint64) int { return cmp.Compare(b, a) })
	return clients
}

// Encode writes the vector, clients descending. The empty vector is 00.
func (v *StateVector) Encode() []byte {
	w := &writer{}
	w.WriteVarUint(uint64(v.Len()))
	for _, client := range v.Clients() {
		w.WriteVarUint(client)
		w.WriteVarUint(v.clocks[client])
	}
	return w.Bytes()
}

// DecodeStateVector refuses a client listed twice and trailing bytes.
func DecodeStateVector(data []byte) (vector *StateVector, err error) {
	defer recoverFormat(&err)
	r := lib0.NewReader(data)
	vector = &StateVector{}
	count := must(r.ReadVarUint())
	for range count {
		client := must(r.ReadVarUint())
		clock := must(r.ReadVarUint())
		if vector.Has(client) {
			panic(lib0.Errorf("yjs: client %d is listed twice in a state vector.", client))
		}
		vector.Set(client, clock)
	}
	if !r.AtEnd() {
		panic(lib0.Errorf("yjs: %d bytes trail the state vector.", r.Len()-r.Pos()))
	}
	return vector, nil
}

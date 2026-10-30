package yjs

import (
	"slices"
)

// integrationRest is what a pass could not place: the structs, and per
// client the clock they wait for.
type integrationRest struct {
	missing map[uint64]uint64
	structs *clientStructMap
}

// clientStructMap is client -> structs in insertion order.
type clientStructMap struct {
	order []uint64
	runs  map[uint64][]Struct
}

func newClientStructMap() *clientStructMap {
	return &clientStructMap{runs: map[uint64][]Struct{}}
}

func (m *clientStructMap) set(client uint64, structs []Struct) {
	if _, ok := m.runs[client]; !ok {
		m.order = append(m.order, client)
	}
	m.runs[client] = structs
}

func (m *clientStructMap) len() int { return len(m.order) }

// toRuntimeStructs builds runtime structs from a decoded update. A root
// parent stays the wire's name until integration; contents are copied so
// the decoded update can be applied again.
func toRuntimeStructs(update *DecodedUpdate) *clientStructMap {
	structs := newClientStructMap()
	for _, group := range update.Groups {
		runtime := make([]Struct, 0, len(group.Structs))
		for _, decoded := range group.Structs {
			runtime = append(runtime, toRuntimeStruct(decoded))
		}
		structs.set(group.Client, runtime)
	}
	return structs
}

func toRuntimeStruct(decoded *DecodedStruct) Struct {
	h := header{id: decoded.ID, length: decoded.Length}
	switch decoded.Kind {
	case KindGC:
		return &GC{h}
	case KindSkip:
		return &Skip{h}
	}
	item := &Item{
		header:           h,
		origin:           decoded.Origin,
		rightOrigin:      decoded.RightOrigin,
		parentSub:        decoded.ParentSub,
		wireParentSubBit: decoded.Info&parentSubBit != 0,
		content:          decoded.Content.copy(),
	}
	switch {
	case decoded.ParentRoot != nil:
		item.parent = *decoded.ParentRoot
	case decoded.ParentID != nil:
		item.parent = *decoded.ParentID
	}
	return item
}

type clientRefs struct {
	refs  []Struct
	index int
}

// integrateStructs is yjs's integrateStructs: a stack machine that walks
// clients from the highest id, follows dependencies across clients, and
// parks only what is genuinely absent.
func integrateStructs(t *Transaction, store *Store, structs *clientStructMap) *integrationRest {
	ids := slices.Clone(structs.order)
	slices.Sort(ids)
	if len(ids) == 0 {
		return nil
	}
	pending := map[uint64]*clientRefs{}
	for _, client := range structs.order {
		pending[client] = &clientRefs{refs: structs.runs[client]}
	}
	current := nextTarget(&ids, pending)
	if current == nil {
		return nil
	}
	var stack []Struct
	rest := newClientStructMap()
	missing := map[uint64]uint64{}
	state := map[uint64]uint64{}
	head := current.refs[current.index]
	current.index++
	for {
		if _, skip := head.(*Skip); !skip {
			h := head.head()
			client := h.id.Client
			localClock, known := state[client]
			if !known {
				localClock = store.getState(client)
				state[client] = localClock
			}
			if localClock < h.id.Clock {
				// A gap in this client's own run.
				stack = append(stack, head)
				recordMissing(missing, client, h.id.Clock-1)
				stack = park(stack, pending, rest)
			} else {
				offset := localClock - h.id.Clock
				var waitingFor uint64
				var blocked bool
				if item, ok := head.(*Item); ok {
					waitingFor, blocked = item.getMissing(t, store)
				}
				switch {
				case blocked:
					stack = append(stack, head)
					if carrier, ok := pending[waitingFor]; ok && carrier.index < len(carrier.refs) {
						head = carrier.refs[carrier.index]
						carrier.index++
						continue
					}
					recordMissing(missing, waitingFor, store.getState(waitingFor))
					stack = park(stack, pending, rest)
				case offset == 0 || offset < uint64(h.length):
					integrateStruct(head, t, int(offset))
					state[client] = h.id.Clock + uint64(h.length)
				}
				// Anything else is a run the store already holds: dropped.
			}
		}
		switch {
		case len(stack) > 0:
			head = stack[len(stack)-1]
			stack = stack[:len(stack)-1]
		case current != nil && current.index < len(current.refs):
			head = current.refs[current.index]
			current.index++
		default:
			current = nextTarget(&ids, pending)
			if current == nil {
				if rest.len() > 0 {
					return &integrationRest{missing: missing, structs: rest}
				}
				return nil
			}
			head = current.refs[current.index]
			current.index++
		}
	}
}

func integrateStruct(head Struct, t *Transaction, offset int) {
	switch s := head.(type) {
	case *Item:
		s.integrate(t, offset)
	case *GC:
		s.integrate(t, offset)
	default:
		fail("yjs: %T is never integrated.", head)
	}
}

func recordMissing(missing map[uint64]uint64, client, clock uint64) {
	if known, ok := missing[client]; !ok || known > clock {
		missing[client] = clock
	}
}

// park parks the stack and, with each struct, its client's unread tail.
// Skips are dropped: a parked Skip would make later real content for those
// clocks look like a duplicate. The client is struck off this pass.
func park(stack []Struct, pending map[uint64]*clientRefs, rest *clientStructMap) []Struct {
	for _, parked := range stack {
		client := parked.head().id.Client
		if refs, ok := pending[client]; ok {
			refs.index--
			var waiting []Struct
			for _, s := range refs.refs[refs.index:] {
				if _, skip := s.(*Skip); !skip {
					waiting = append(waiting, s)
				}
			}
			rest.set(client, waiting)
			delete(pending, client)
			refs.index = 0
			refs.refs = nil
		} else {
			rest.set(client, []Struct{parked})
		}
	}
	return stack[:0]
}

// nextTarget is the next client to read, highest id first.
func nextTarget(ids *[]uint64, pending map[uint64]*clientRefs) *clientRefs {
	for len(*ids) > 0 {
		last := (*ids)[len(*ids)-1]
		if target, ok := pending[last]; ok && len(target.refs) != target.index {
			return target
		}
		*ids = (*ids)[:len(*ids)-1]
	}
	return nil
}

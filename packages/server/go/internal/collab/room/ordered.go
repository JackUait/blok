package room

import "iter"

// ordered is a map that enumerates like .NET's Dictionary and HashSet: a
// removed slot is reused last-freed-first, and enumeration walks the slots.
// The identities frame and the awareness removal list their entries in this
// order, so C# and Go put the same bytes on the wire.
type ordered[K comparable, V any] struct {
	index map[K]int
	slots []orderedSlot[K, V]
	free  []int
}

type orderedSlot[K comparable, V any] struct {
	key   K
	value V
	used  bool
}

func (o *ordered[K, V]) get(key K) (V, bool) {
	if i, ok := o.index[key]; ok {
		return o.slots[i].value, true
	}
	var zero V
	return zero, false
}

func (o *ordered[K, V]) set(key K, value V) {
	if i, ok := o.index[key]; ok {
		o.slots[i].value = value
		return
	}
	if o.index == nil {
		o.index = map[K]int{}
	}
	slot := orderedSlot[K, V]{key: key, value: value, used: true}
	if n := len(o.free); n > 0 {
		i := o.free[n-1]
		o.free = o.free[:n-1]
		o.slots[i] = slot
		o.index[key] = i
		return
	}
	o.index[key] = len(o.slots)
	o.slots = append(o.slots, slot)
}

func (o *ordered[K, V]) remove(key K) bool {
	i, ok := o.index[key]
	if !ok {
		return false
	}
	delete(o.index, key)
	o.slots[i] = orderedSlot[K, V]{}
	o.free = append(o.free, i)
	return true
}

func (o *ordered[K, V]) has(key K) bool {
	_, ok := o.index[key]
	return ok
}

func (o *ordered[K, V]) len() int { return len(o.index) }

func (o *ordered[K, V]) clear() {
	o.index, o.slots, o.free = nil, nil, nil
}

// all may be ranged over while the body removes entries.
func (o *ordered[K, V]) all() iter.Seq2[K, V] {
	return func(yield func(K, V) bool) {
		for i := 0; i < len(o.slots); i++ {
			if s := o.slots[i]; s.used && !yield(s.key, s.value) {
				return
			}
		}
	}
}

// keys is a snapshot, for loops that change the map.
func (o *ordered[K, V]) keys() []K {
	out := make([]K, 0, len(o.index))
	for k := range o.all() {
		out = append(out, k)
	}
	return out
}

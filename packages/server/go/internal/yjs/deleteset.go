package yjs

import (
	"cmp"
	"slices"

	"github.com/JackUait/blok/packages/server/go/internal/lib0"
)

// DeleteRange is a run of deleted clocks.
type DeleteRange struct {
	Clock  uint64
	Length uint64
}

type deleteClient struct {
	client uint64
	ranges []DeleteRange
}

// DeleteSet is, per client, a list of clock ranges. Clients keep their
// insertion order, which decides the order deletions are applied in.
type DeleteSet struct {
	clients []deleteClient
	index   map[uint64]int
}

// IsEmpty reports no clients.
func (d *DeleteSet) IsEmpty() bool { return len(d.clients) == 0 }

// Len is the number of clients.
func (d *DeleteSet) Len() int { return len(d.clients) }

// Ranges returns a client's ranges, nil when unlisted.
func (d *DeleteSet) Ranges(client uint64) []DeleteRange {
	if at, ok := d.index[client]; ok {
		return d.clients[at].ranges
	}
	return nil
}

// Clients are the listed clients in insertion order.
func (d *DeleteSet) Clients() []uint64 {
	clients := make([]uint64, len(d.clients))
	for i, entry := range d.clients {
		clients[i] = entry.client
	}
	return clients
}

func (d *DeleteSet) entry(client uint64) *deleteClient {
	if at, ok := d.index[client]; ok {
		return &d.clients[at]
	}
	if d.index == nil {
		d.index = map[uint64]int{}
	}
	d.index[client] = len(d.clients)
	d.clients = append(d.clients, deleteClient{client: client})
	return &d.clients[len(d.clients)-1]
}

func (d *DeleteSet) add(client, clock, length uint64) {
	entry := d.entry(client)
	entry.ranges = append(entry.ranges, DeleteRange{clock, length})
}

// readDeleteSet drops a client with no ranges, and a client listed twice
// appends (unlike struct groups, which are refused).
func readDeleteSet(r *lib0.Reader) *DeleteSet {
	set := &DeleteSet{}
	clients := must(r.ReadVarUint())
	for range clients {
		client := must(r.ReadVarUint())
		ranges := must(r.ReadVarUint())
		if ranges == 0 {
			continue
		}
		entry := set.entry(client)
		for range ranges {
			clock := must(r.ReadVarUint())
			length := must(r.ReadVarUint())
			entry.ranges = append(entry.ranges, DeleteRange{clock, length})
		}
	}
	return set
}

// write puts clients in descending id order, each clock absolute.
func (d *DeleteSet) write(w *writer) {
	w.WriteVarUint(uint64(len(d.clients)))
	sorted := slices.Clone(d.clients)
	slices.SortFunc(sorted, func(a, b deleteClient) int { return cmp.Compare(b.client, a.client) })
	for _, entry := range sorted {
		w.WriteVarUint(entry.client)
		w.WriteVarUint(uint64(len(entry.ranges)))
		for _, r := range entry.ranges {
			w.WriteVarUint(r.Clock)
			w.WriteVarUint(r.Length)
		}
	}
}

// apply deletes everything the ranges name and returns what could not be
// applied yet, or nil. A range is split on both edges; a range starting
// past the state parks whole, one reaching past it parks only its tail.
func (d *DeleteSet) apply(t *Transaction, store *Store) *DeleteSet {
	unapplied := &DeleteSet{}
	for _, entry := range d.clients {
		client := entry.client
		state := store.getState(client)
		for _, r := range entry.ranges {
			clockEnd := r.Clock + r.Length
			if r.Clock >= state {
				unapplied.add(client, r.Clock, r.Length)
				continue
			}
			if state < clockEnd {
				unapplied.add(client, state, clockEnd-state)
			}
			index := store.findIndex(client, r.Clock)
			if head, ok := store.clients[client][index].(*Item); ok && !head.deleted && head.id.Clock < r.Clock {
				store.split(t, client, index, head, int(r.Clock-head.id.Clock))
				index++
			}
			// Re-read the run each step: a split inserts into it.
			for index < len(store.clients[client]) {
				current := store.clients[client][index]
				index++
				if current.head().id.Clock >= clockEnd {
					break
				}
				item, ok := current.(*Item)
				if !ok || item.deleted {
					continue
				}
				if clockEnd < item.end() {
					store.split(t, client, index-1, item, int(clockEnd-item.id.Clock))
				}
				item.delete(t)
			}
		}
	}
	if unapplied.IsEmpty() {
		return nil
	}
	return unapplied
}

// sortAndMerge sorts each client's ranges by clock and folds touching or
// overlapping ones together, in place.
func (d *DeleteSet) sortAndMerge() {
	for c := range d.clients {
		ranges := d.clients[c].ranges
		slices.SortFunc(ranges, func(a, b DeleteRange) int { return cmp.Compare(a.Clock, b.Clock) })
		write := 1
		for read := 1; read < len(ranges); read++ {
			left, right := ranges[write-1], ranges[read]
			if left.Clock+left.Length >= right.Clock {
				ranges[write-1] = DeleteRange{left.Clock, max(left.Length, right.Clock+right.Length-left.Clock)}
				continue
			}
			ranges[write] = right
			write++
		}
		if len(ranges) > write {
			d.clients[c].ranges = ranges[:write]
		}
	}
}

func copyRanges(source, target *DeleteSet) {
	for _, entry := range source.clients {
		for _, r := range entry.ranges {
			target.add(entry.client, r.Clock, r.Length)
		}
	}
}

func mergeDeleteSets(left, right *DeleteSet) *DeleteSet {
	if left == nil {
		return right
	}
	if right == nil {
		return left
	}
	merged := &DeleteSet{}
	copyRanges(left, merged)
	copyRanges(right, merged)
	merged.sortAndMerge()
	return merged
}

package yjs

import (
	"cmp"
	"math"
	"slices"
)

type writtenStruct struct {
	s      Struct
	offset int
}

// encodedRun is one client's group: a start clock and a contiguous run.
type encodedRun struct {
	client  uint64
	clock   uint64
	structs []writtenStruct
}

// writeRuns is yjs's LazyStructWriter: per run the count, client, clock,
// then the structs.
func writeRuns(w *writer, runs []encodedRun) {
	w.WriteVarUint(uint64(len(runs)))
	for _, run := range runs {
		w.WriteVarUint(uint64(len(run.structs)))
		w.WriteVarUint(run.client)
		w.WriteVarUint(run.clock)
		for _, written := range run.structs {
			written.s.write(w, written.offset)
		}
	}
}

// updateFromTransaction is yjs's writeUpdateMessageFromTransaction, or nil
// when the transaction changed nothing. Only integrated structs are written.
func updateFromTransaction(t *Transaction) []byte {
	store := t.doc.store
	after := t.afterState
	if after == nil {
		after = store.getStateVector()
	}
	if t.deleteSet.Len() == 0 && !advanced(t.beforeState, after) {
		return nil
	}
	t.deleteSet.sortAndMerge()
	w := &writer{}
	writeRuns(w, buildRuns(store, t.beforeState, false))
	t.deleteSet.write(w)
	return w.Bytes()
}

func advanced(before, after *StateVector) bool {
	for _, client := range after.Clients() {
		if before.Get(client) != after.Get(client) {
			return true
		}
	}
	return false
}

// buildRuns turns the store, and optionally what is parked, into v1 client
// runs: one group per client, descending, holes as Skips, overlaps written
// at an offset.
func buildRuns(store *Store, target *StateVector, includePending bool) []encodedRun {
	starts := startClocks(store, target)
	var parked map[uint64][]Struct
	if includePending {
		parked = parkedByClient(store, target)
	}
	clients := make([]uint64, 0, len(starts)+len(parked))
	for client := range starts {
		clients = append(clients, client)
	}
	for client := range parked {
		if _, ok := starts[client]; !ok {
			clients = append(clients, client)
		}
	}
	slices.SortFunc(clients, func(a, b uint64) int { return cmp.Compare(b, a) })
	var runs []encodedRun
	for _, client := range clients {
		var written []writtenStruct
		var clock uint64
		if start, ok := starts[client]; ok {
			clock, written = appendIntegrated(store, client, start, written)
		}
		if waiting, ok := parked[client]; ok {
			from := clock
			if len(written) == 0 {
				from = target.Get(client)
			}
			clock, written = appendParked(waiting, from, written)
		}
		if len(written) > 0 {
			runs = append(runs, encodedRun{client: client, clock: clock, structs: written})
		}
	}
	return runs
}

// startClocks is yjs's writeClientsStructs: a client the target has seen
// part of starts at its clock, an unknown client at 0, a level one is left
// out.
func startClocks(store *Store, target *StateVector) map[uint64]uint64 {
	starts := map[uint64]uint64{}
	for _, client := range target.Clients() {
		if clock := target.Get(client); store.getState(client) > clock {
			starts[client] = clock
		}
	}
	for _, client := range store.order {
		if !target.Has(client) {
			starts[client] = 0
		}
	}
	return starts
}

func appendIntegrated(store *Store, client, start uint64, written []writtenStruct) (uint64, []writtenStruct) {
	structs := store.clients[client]
	clock := max(start, structs[0].head().id.Clock)
	first := store.findIndex(client, clock)
	written = append(written, writtenStruct{structs[first], int(clock - structs[first].head().id.Clock)})
	for _, s := range structs[first+1:] {
		written = append(written, writtenStruct{s, 0})
	}
	return clock, written
}

// appendParked folds parked structs in after the integrated tail. A gap
// past int32 is written as several Skips, never refused: refusing it once
// broke every sync answer for a room's life.
func appendParked(waiting []Struct, clock uint64, written []writtenStruct) (uint64, []writtenStruct) {
	start := clock
	var covered uint64
	if len(written) > 0 {
		last := written[len(written)-1].s.head()
		covered = last.end()
	}
	for _, parked := range waiting {
		h := parked.head()
		boundary := max(clock, covered)
		end := h.end()
		if end <= boundary {
			continue
		}
		if h.id.Clock > boundary && len(written) > 0 {
			for hole := boundary; hole < h.id.Clock; {
				span := min(h.id.Clock-hole, math.MaxInt32)
				written = append(written, writtenStruct{&Skip{header{id: ID{h.id.Client, hole}, length: int(span)}}, 0})
				hole += span
			}
		}
		var offset uint64
		if h.id.Clock < boundary {
			offset = boundary - h.id.Clock
		}
		if len(written) == 0 {
			start = h.id.Clock + offset
		}
		written = append(written, writtenStruct{parked, int(offset)})
		covered = end
	}
	return start, written
}

// parkedByClient drops Skips and what the target has seen, then sorts each
// client's run by clock (stable, so equal clocks keep their parked order).
func parkedByClient(store *Store, target *StateVector) map[uint64][]Struct {
	parked := map[uint64][]Struct{}
	for _, waiting := range store.pendingStructs {
		h := waiting.head()
		if _, skip := waiting.(*Skip); skip || h.end() <= target.Get(h.id.Client) {
			continue
		}
		parked[h.id.Client] = append(parked[h.id.Client], waiting)
	}
	for _, run := range parked {
		slices.SortStableFunc(run, func(a, b Struct) int { return cmp.Compare(a.head().id.Clock, b.head().id.Clock) })
	}
	return parked
}

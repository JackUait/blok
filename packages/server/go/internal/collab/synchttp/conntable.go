package synchttp

import (
	"sync"
	"sync/atomic"
)

// ConnectionTable counts live sync connections: process-wide, against
// CollabMaxConnections, and per (doc, principal), against
// CollabMaxConnectionsPerUserPerDoc. SyncConnectionTable.
type ConnectionTable struct {
	ceiling int64
	perUser int

	live   atomic.Int64
	mu     sync.Mutex
	counts map[leaseKey]int
}

type leaseKey struct{ doc, principal string }

// NewConnectionTable takes the two caps; a ceiling of 0 means none.
func NewConnectionTable(ceiling int64, perUserPerDoc int) *ConnectionTable {
	return &ConnectionTable{ceiling: ceiling, perUser: perUserPerDoc, counts: map[leaseKey]int{}}
}

// Slot is one process-wide connection; release it when the request ends.
type Slot struct {
	table    *ConnectionTable
	released atomic.Bool
}

// Release frees the slot once; later calls do nothing.
func (s *Slot) Release() {
	if s != nil && s.released.CompareAndSwap(false, true) {
		s.table.live.Add(-1)
	}
}

// Live is the number of sync connections whose request has not ended.
func (t *ConnectionTable) Live() int64 { return t.live.Load() }

// TryEnter is nil when the process is at its ceiling.
func (t *ConnectionTable) TryEnter() *Slot {
	if t.live.Add(1) > t.ceiling && t.ceiling > 0 {
		t.live.Add(-1)
		return nil
	}
	return &Slot{table: t}
}

// Lease is one (doc, principal) connection.
type Lease struct {
	table    *ConnectionTable
	key      leaseKey
	released atomic.Bool
}

// Release frees the lease once; later calls do nothing.
func (l *Lease) Release() {
	if l == nil || !l.released.CompareAndSwap(false, true) {
		return
	}
	t := l.table
	t.mu.Lock()
	defer t.mu.Unlock()
	if count := t.counts[l.key]; count > 1 {
		t.counts[l.key] = count - 1
	} else {
		delete(t.counts, l.key)
	}
}

// TryReserve is nil when principal already holds the cap for doc.
func (t *ConnectionTable) TryReserve(doc, principal string) *Lease {
	key := leaseKey{doc, principal}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.counts[key] >= t.perUser {
		return nil
	}
	t.counts[key]++
	return &Lease{table: t, key: key}
}

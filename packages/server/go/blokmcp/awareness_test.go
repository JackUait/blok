package blokmcp

import (
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/lib0"
)

func awarenessUpdate(entries ...struct {
	client, clock uint64
	state string
}) []byte {
	w := &lib0.Writer{}
	w.WriteVarUint(uint64(len(entries)))
	for _, entry := range entries {
		w.WriteVarUint(entry.client)
		w.WriteVarUint(entry.clock)
		w.WriteVarString(jsjson.FromString(entry.state))
	}
	return w.Bytes()
}

type entry = struct {
	client, clock uint64
	state string
}

func TestARemovedPeerLeavesNoOrderBehind(t *testing.T) {
	a := newAwareness(1)
	a.apply(awarenessUpdate(entry{2, 1, `{"x":1}`}))
	a.apply(awarenessUpdate(entry{2, 2, `null`}))
	if len(a.known()) != 1 || len(a.seq) != 1 {
		t.Fatalf("known %v, order rows %d", a.known(), len(a.seq))
	}
}

func TestAStatelessPeerRowIsPrunedAfterTheTombstoneTime(t *testing.T) {
	now := time.Now()
	a := newAwareness(1)
	a.now = func() time.Time { return now }
	a.apply(awarenessUpdate(entry{2, 1, `{"x":1}`}))
	a.apply(awarenessUpdate(entry{2, 2, `null`}))
	now = now.Add(awarenessTombstoneTTL + time.Second)
	a.apply(awarenessUpdate())
	if _, ok := a.meta[2]; ok {
		t.Fatal("the stateless row stayed")
	}
}

func TestATenThousandClientUpdateStaysFast(t *testing.T) {
	a := newAwareness(1)
	entries := make([]entry, 10_000)
	for i := range entries {
		entries[i] = entry{uint64(i + 2), 1, `{"x":1}`}
	}
	update := awarenessUpdate(entries...)
	started := time.Now()
	a.apply(update)
	a.encode(a.known())
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("took %v", elapsed)
	}
}

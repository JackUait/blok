package yjs

import (
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/lib0"
)

// Ports of the StructStoreTests that pin the store's own invariants.

const storeClient = 1000

func anyItem(client, clock uint64, values ...any) *Item {
	return &Item{header: header{id: ID{client, clock}, length: len(values)}, content: &ContentAny{Items: values}}
}

func TestAddStructRejectsAGapAndNeverLeavesAnEmptyRun(t *testing.T) {
	store := newStore()
	store.addStruct(anyItem(storeClient, 0, s("a"), s("b")))
	expectPanic(t, "a clock gap", func() { store.addStruct(anyItem(storeClient, 3, s("c"))) })
	// A first struct may start at any clock.
	store.addStruct(anyItem(storeClient+1, 5, s("c")))
	if len(store.clients[storeClient]) != 1 || len(store.clients[storeClient+1]) != 1 || store.getState(storeClient+2) != 0 {
		t.Fatal("runs")
	}
}

func TestFindLocatesAStructByAnyClockInsideIt(t *testing.T) {
	store := newStore()
	first := anyItem(storeClient, 0, s("a"), s("b"), s("c"))
	second := &GC{header{id: ID{storeClient, 3}, length: 1}}
	third := anyItem(storeClient, 4, s("d"), s("e"), s("f"), s("g"), s("h"))
	store.addStruct(first)
	store.addStruct(second)
	store.addStruct(third)
	for clock, want := range map[uint64]Struct{0: first, 2: first, 3: second, 4: third, 8: third} {
		if store.find(ID{storeClient, clock}) != want {
			t.Errorf("clock %d", clock)
		}
	}
	expectPanic(t, "a clock past the run", func() { store.find(ID{storeClient, 9}) })
	expectPanic(t, "an unknown client", func() { store.find(ID{storeClient + 1, 0}) })
}

func TestCleanStartSplitsAnItemAndKeepsLastIDArithmetic(t *testing.T) {
	store := newStore()
	left := anyItem(storeClient, 0, s("a"), s("b"), s("c"), s("d"))
	lastID := left.lastID()
	store.addStruct(left)
	right := store.getItemCleanStart(nil, ID{storeClient, 3})
	if right == left || left.lastID() != (ID{storeClient, 2}) || left.length != 3 || left.content.Len() != 3 {
		t.Fatal("left half")
	}
	if right.id != (ID{storeClient, 3}) || *right.origin != left.lastID() || right.lastID() != lastID || left.right != right || right.left != left {
		t.Fatal("right half")
	}
	if store.getState(storeClient) != 4 || store.getItemCleanStart(nil, ID{storeClient, 3}) != right || len(store.clients[storeClient]) != 2 {
		t.Fatal("store")
	}
}

func TestCleanEndNeverSplitsAGC(t *testing.T) {
	store := newStore()
	collected := &GC{header{id: ID{storeClient, 0}, length: 5}}
	store.addStruct(collected)
	if store.getItemCleanEnd(nil, ID{storeClient, 2}) != Struct(collected) || len(store.clients[storeClient]) != 1 || collected.length != 5 {
		t.Fatal("a GC was split")
	}
	items := newStore()
	item := anyItem(storeClient, 0, s("a"), s("b"), s("c"), s("d"), s("e"))
	items.addStruct(item)
	if items.getItemCleanEnd(nil, ID{storeClient, 2}) != Struct(item) || item.length != 3 || items.clients[storeClient][1].head().id.Clock != 3 {
		t.Fatal("the clean end did not hand back the left half")
	}
}

func TestSplitRepointsTheMapHeadWhenSplittingTheLastValue(t *testing.T) {
	m := &Map{}
	head := anyItem(storeClient, 0, s("a"), s("b"))
	key := s("k")
	head.parent, head.parentSub, head.deleted, head.keep = m, &key, true, true
	m.mapSetHead(key, head)
	right := head.splitAt(1)
	if m.mapGet(key) != right || right.parent != AbstractType(m) || !right.deleted || !right.keep {
		t.Fatal("the head did not move to the right half")
	}
	other := &Map{}
	tail := anyItem(storeClient+1, 0, s("z"))
	withTail := anyItem(storeClient, 0, s("a"), s("b"), s("c"))
	withTail.parent, withTail.parentSub, withTail.right, tail.left = other, &key, tail, withTail
	other.mapSetHead(key, withTail)
	middle := withTail.splitAt(1)
	if other.mapGet(key) != withTail || withTail.right != middle || middle.right != tail || tail.left != middle {
		t.Fatal("a head with a right neighbour moved")
	}
	unresolved := anyItem(storeClient, 0, s("a"), s("b"))
	unresolved.parent, unresolved.parentSub = s("root"), &key
	expectPanic(t, "an unresolved parent owning a map head", func() { unresolved.splitAt(1) })
}

func TestCreateTypeCoversEveryTypeRef(t *testing.T) {
	name := s("p")
	for ref := range maxTypeRef + 1 {
		w := &writer{}
		newContentTypeFor(createType(ref, &name)).write(w, 0)
		if got := readContentType(lib0.NewReader(w.Bytes())); got.TypeRef != ref {
			t.Errorf("ref %d reads back as %d", ref, got.TypeRef)
		}
	}
	expectPanic(t, "ref 7", func() { createType(7, nil) })
}

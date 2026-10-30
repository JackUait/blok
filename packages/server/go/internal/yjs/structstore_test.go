package yjs

import (
	"errors"
	"slices"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
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

// EncodeStateAsUpdate promises an error, so an engine invariant failing
// inside it must come back as one, never as a panic that ends the process.
func TestEncodeReturnsAnEngineFailureAsAnError(t *testing.T) {
	doc := pinnedDoc()
	// A gap the store never allows: clocks 2..4 are missing.
	doc.store.clients[storeClient] = []Struct{anyItem(storeClient, 0, s("a"), s("b")), anyItem(storeClient, 5, s("c"))}
	doc.store.order = append(doc.store.order, storeClient)
	target := &StateVector{}
	target.Set(storeClient, 3)
	var engine *EngineError
	update, err := func() (update []byte, err error) {
		defer func() {
			if recovered := recover(); recovered != nil {
				t.Fatalf("panicked: %v", recovered)
			}
		}()
		return doc.EncodeStateAsUpdate(target.Encode())
	}()
	if update != nil || !errors.As(err, &engine) {
		t.Fatalf("got %x, %v; want an *EngineError", update, err)
	}
}

func isStr(value any, want string) bool {
	text, ok := value.(jsjson.Str)
	return ok && text.String() == want
}

func itemWith(clock uint64, content Content) *Item {
	return &Item{header: header{id: ID{storeClient, clock}, length: content.Len()}, content: content}
}

func chain(parent *typeCore, items ...*Item) {
	for index, item := range items {
		item.parent = parent
		if index == 0 {
			parent.start = item
			continue
		}
		item.left = items[index-1]
		items[index-1].right = item
	}
}

func TestArrayEnumerateSkipsDeletedAndNonCountable(t *testing.T) {
	array := &Array{}
	nested := &Map{}
	gone := itemWith(2, &ContentAny{Items: []any{s("skipped")}})
	gone.deleted = true
	nestedContent := newContentType(1, nil)
	nestedContent.Type = nested
	chain(&array.typeCore,
		itemWith(0, &ContentAny{Items: []any{1.0, 2.0}}),
		gone,
		itemWith(3, &ContentFormat{Key: s("bold"), JSON: s("true")}),
		itemWith(4, nestedContent),
		itemWith(5, &ContentString{Text: s("hi")}))

	values := array.Values()
	if len(values) != 5 || values[0] != 1.0 || values[1] != 2.0 || values[2] != AbstractType(nested) ||
		!isStr(values[3], "h") || !isStr(values[4], "i") {
		t.Fatalf("values %#v", values)
	}
	if array.Len() != 5 || array.Get(0) != 1.0 || array.Get(2) != AbstractType(nested) || !isStr(array.Get(4), "i") {
		t.Fatal("get")
	}
	if array.Get(5) != nil || array.Get(-1) != nil {
		t.Fatal("out of range")
	}
}

func TestMapTryGetReadsTheLastValueOfTheHeadAndSkipsDeleted(t *testing.T) {
	m := &Map{}
	m.mapSetHead(s("single"), itemWith(0, &ContentAny{Items: []any{s("x")}}))
	m.mapSetHead(s("run"), itemWith(1, &ContentAny{Items: []any{s("p"), s("q")}}))
	gone := itemWith(3, &ContentAny{Items: []any{s("dead")}})
	gone.deleted = true
	m.mapSetHead(s("gone"), gone)

	if value, ok := m.Get(s("single")); !ok || !isStr(value, "x") {
		t.Fatalf("single %#v", value)
	}
	// A map head's value is the LAST element of its content, never the first.
	if value, ok := m.Get(s("run")); !ok || !isStr(value, "q") {
		t.Fatalf("run %#v", value)
	}
	if value, ok := m.Get(s("gone")); ok || value != nil {
		t.Fatalf("gone %#v", value)
	}
	if _, ok := m.Get(s("absent")); ok {
		t.Fatal("absent")
	}
	keys := m.Keys()
	slices.SortFunc(keys, jsjson.Compare)
	if len(keys) != 2 || keys[0].String() != "run" || keys[1].String() != "single" || m.Len() != 2 {
		t.Fatalf("keys %v", keys)
	}
}

func TestGetStateIsZeroForAnUnknownClient(t *testing.T) {
	store := newStore()
	if store.getState(storeClient) != 0 || len(store.getStateVector().Clients()) != 0 {
		t.Fatal("empty store")
	}
	store.addStruct(anyItem(storeClient, 0, s("a"), s("b")))
	if store.getState(storeClient) != 2 || store.getState(storeClient+1) != 0 || store.getStateVector().Get(storeClient) != 2 {
		t.Fatal("after one struct")
	}
}

package yjs

import (
	"bytes"
	"errors"
	"slices"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/lib0"
	"github.com/JackUait/blok/packages/server/go/internal/yjs/yjstest"
)

// Ports of DeleteSetTests, StateVectorTests and DeepDocumentTests.

const author = 9

type shape struct {
	clock   uint64
	length  int
	deleted bool
}

func shapeOf(structs []Struct) []shape {
	var out []shape
	for _, s := range structs {
		out = append(out, shape{s.head().id.Clock, s.head().length, s.IsDeleted()})
	}
	return out
}

func authorRun(doc *Doc, parent *Array, values ...any) *Item {
	item := &Item{header: header{id: ID{author, 0}, length: len(values)}, parent: parent, content: &ContentAny{Items: values}}
	doc.store.addStruct(item)
	parent.start = item
	parent.length = len(values)
	return item
}

func remoteTransaction(doc *Doc) *Transaction {
	return &Transaction{doc: doc, beforeState: doc.store.getStateVector(), deleteSet: &DeleteSet{}}
}

func TestDeleteRangeSplitsBothEdgesAndParksTheUnappliableTail(t *testing.T) {
	id := uint32(1)
	doc := NewDoc(Options{ClientID: &id})
	parent := doc.GetArray(s("list"))
	run := authorRun(doc, parent, s("a"), s("b"), s("c"), s("d"), s("e"))
	txn := remoteTransaction(doc)
	inside := &DeleteSet{}
	inside.add(author, 1, 2)
	if inside.apply(txn, doc.store) != nil {
		t.Fatal("parked a range the store holds")
	}
	structs := doc.store.clients[author]
	if want := []shape{{0, 1, false}, {1, 2, true}, {3, 2, false}}; !slices.Equal(shapeOf(structs), want) {
		t.Fatalf("%v", shapeOf(structs))
	}
	if structs[0] != Struct(run) || run.right != structs[1].(*Item) || structs[1].(*Item).right != structs[2].(*Item) {
		t.Fatal("the split halves are not wired into the chain")
	}
	if parent.Len() != 3 {
		t.Fatalf("len %d", parent.Len())
	}
	past := &DeleteSet{}
	past.add(author, 3, 5)
	parked := past.apply(txn, doc.store)
	if want := []shape{{0, 1, false}, {1, 2, true}, {3, 2, true}}; !slices.Equal(shapeOf(doc.store.clients[author]), want) {
		t.Fatalf("%v", shapeOf(doc.store.clients[author]))
	}
	if parked == nil || !slices.Equal(parked.Clients(), []uint64{author}) || !slices.Equal(parked.Ranges(author), []DeleteRange{{5, 3}}) {
		t.Fatalf("parked %+v", parked)
	}
	if parent.Len() != 1 {
		t.Fatalf("len %d", parent.Len())
	}
}

func TestAWholeRangePastTheStateIsParked(t *testing.T) {
	id := uint32(1)
	doc := NewDoc(Options{ClientID: &id})
	parent := doc.GetArray(s("list"))
	authorRun(doc, parent, s("a"), s("b"))
	txn := remoteTransaction(doc)
	unknown := &DeleteSet{}
	unknown.add(author, 2, 4)
	unknown.add(author+1, 0, 1)
	parked := unknown.apply(txn, doc.store)
	if parked == nil || parked.Len() != 2 || !slices.Equal(parked.Ranges(author), []DeleteRange{{2, 4}}) {
		t.Fatalf("parked %+v", parked)
	}
	if !slices.Equal(shapeOf(doc.store.clients[author]), []shape{{0, 2, false}}) || !txn.deleteSet.IsEmpty() {
		t.Fatal("something was deleted")
	}
}

func TestAddThenSortAndMergeFoldsTouchingRanges(t *testing.T) {
	set := &DeleteSet{}
	set.add(author, 6, 2)
	set.add(author, 0, 2)
	set.add(author, 2, 1)
	set.add(author, 1, 4)
	set.add(author+1, 3, 1)
	set.sortAndMerge()
	if !slices.Equal(set.Ranges(author), []DeleteRange{{0, 5}, {6, 2}}) || !slices.Equal(set.Ranges(author+1), []DeleteRange{{3, 1}}) {
		t.Fatalf("%+v %+v", set.Ranges(author), set.Ranges(author+1))
	}
}

// deleteSetBytes writes clients in the order given.
func deleteSetBytes(clients ...struct {
	client uint64
	ranges [][2]uint64
}) []byte {
	w := &writer{}
	w.WriteVarUint(uint64(len(clients)))
	for _, c := range clients {
		w.WriteVarUint(c.client)
		w.WriteVarUint(uint64(len(c.ranges)))
		for _, r := range c.ranges {
			w.WriteVarUint(r[0])
			w.WriteVarUint(r[1])
		}
	}
	return w.Bytes()
}

type dsClient = struct {
	client uint64
	ranges [][2]uint64
}

func TestDeleteSetSortsMergesAndWritesClientsDescending(t *testing.T) {
	set := readDeleteSet(lib0.NewReader(deleteSetBytes(
		dsClient{7, [][2]uint64{{10, 2}, {0, 3}, {3, 1}, {20, 1}}},
		dsClient{9, [][2]uint64{{0, 5}, {2, 1}}})))
	set.sortAndMerge()
	if !slices.Equal(set.Ranges(7), []DeleteRange{{0, 4}, {10, 2}, {20, 1}}) || !slices.Equal(set.Ranges(9), []DeleteRange{{0, 5}}) {
		t.Fatalf("%+v %+v", set.Ranges(7), set.Ranges(9))
	}
	w := &writer{}
	set.write(w)
	if want := deleteSetBytes(dsClient{9, [][2]uint64{{0, 5}}}, dsClient{7, [][2]uint64{{0, 4}, {10, 2}, {20, 1}}}); !bytes.Equal(w.Bytes(), want) {
		t.Fatalf("%x, want %x", w.Bytes(), want)
	}
	if !readDeleteSet(lib0.NewReader(deleteSetBytes())).IsEmpty() {
		t.Fatal("empty set is not empty")
	}
}

func TestDeleteSetReadDropsEmptyClientsAndAppendsRepeats(t *testing.T) {
	set := readDeleteSet(lib0.NewReader(deleteSetBytes(
		dsClient{7, [][2]uint64{{0, 1}}},
		dsClient{8, nil},
		dsClient{7, [][2]uint64{{5, 1}}})))
	if !slices.Equal(set.Clients(), []uint64{7}) || !slices.Equal(set.Ranges(7), []DeleteRange{{0, 1}, {5, 1}}) {
		t.Fatalf("%v %+v", set.Clients(), set.Ranges(7))
	}
}

func scenarioStateVectors(t *testing.T, minimumClients int) [][]byte {
	seen := map[string]bool{}
	var out [][]byte
	for _, c := range fixtureCases(t, "scenarios.json") {
		for _, step := range yjstest.Items(c, "steps") {
			expect := yjstest.Field(step, "expect")
			if !yjstest.Has(expect, "sv") || seen[yjstest.String(expect, "sv")] {
				continue
			}
			seen[yjstest.String(expect, "sv")] = true
			sv := fixtureBytes(t, expect, "sv")
			if count, _ := lib0.NewReader(sv).ReadVarUint(); int(count) >= minimumClients {
				out = append(out, sv)
			}
		}
	}
	if len(out) == 0 {
		t.Fatal("no state vectors")
	}
	return out
}

func TestStateVectorEncodesClientsDescending(t *testing.T) {
	for _, golden := range scenarioStateVectors(t, 2) {
		decoded, err := DecodeStateVector(golden)
		if err != nil {
			t.Fatal(err)
		}
		clients := decoded.Clients()
		ascending := slices.Clone(clients)
		slices.Sort(ascending)
		rebuilt := &StateVector{}
		for _, client := range ascending {
			rebuilt.Set(client, decoded.Get(client))
		}
		if !bytes.Equal(rebuilt.Encode(), golden) {
			t.Errorf("%x rebuilt as %x", golden, rebuilt.Encode())
		}
	}
}

func TestStateVectorDecodeRoundTrips(t *testing.T) {
	for _, golden := range scenarioStateVectors(t, 1) {
		decoded, err := DecodeStateVector(golden)
		if err != nil || !bytes.Equal(decoded.Encode(), golden) || decoded.Get(^uint64(0)) != 0 {
			t.Errorf("%x: %v", golden, err)
		}
	}
}

func TestStateVectorEdges(t *testing.T) {
	if !bytes.Equal((&StateVector{}).Encode(), []byte{0}) {
		t.Fatal("empty vector is not 00")
	}
	vector := &StateVector{}
	vector.Set(7, 3)
	vector.Set(7, 9)
	if vector.Get(7) != 9 || vector.Len() != 1 {
		t.Fatal("set does not overwrite")
	}
	if _, err := DecodeStateVector([]byte{0, 0}); !errors.Is(err, lib0.ErrFormat) {
		t.Fatalf("trailing bytes: %v", err)
	}
	if _, err := DecodeStateVector([]byte{2, 7, 1, 7, 2}); !errors.Is(err, lib0.ErrFormat) {
		t.Fatalf("a client listed twice: %v", err)
	}
}

const deepLevels = 10_000

func nest(doc *Doc, root *Map, levels int) [][]byte {
	var updates [][]byte
	cursor := root
	for range levels {
		child := NewMap()
		owner := cursor
		if update := doc.Transact(func(txn *Transaction) { owner.Set(txn, s("c"), child) }); update != nil {
			updates = append(updates, update)
		}
		cursor = child
	}
	return updates
}

func TestDeletingADeeplyNestedChainDoesNotRecursePerLevel(t *testing.T) {
	doc := pinnedDoc()
	blocks := doc.GetMap(s("blocks"))
	nest(doc, blocks, deepLevels)
	doc.Transact(func(txn *Transaction) { blocks.Delete(txn, s("c")) })
	if _, ok := blocks.Get(s("c")); ok || blocks.Len() != 0 || doc.HasPending() {
		t.Fatal("the chain survived")
	}
}

func TestCollectingADeeplyNestedChainDoesNotRecursePerLevel(t *testing.T) {
	doc := pinnedDoc()
	blocks := doc.GetMap(s("blocks"))
	nest(doc, blocks, deepLevels)
	doc.Transact(func(txn *Transaction) { blocks.Clear(txn) })
	if blocks.Len() != 0 {
		t.Fatal("the chain survived")
	}
}

func TestAChainBuiltOneLevelPerUpdateIsAcceptedAndThenDeletable(t *testing.T) {
	authorDoc := pinnedDoc()
	updates := nest(authorDoc, authorDoc.GetMap(s("blocks")), deepLevels)
	id := uint32(1001)
	peerDoc := NewDoc(Options{ClientID: &id})
	for _, update := range updates {
		if Inspect(update, DefaultInspectDepth).Verdict != VerdictOK {
			t.Fatal("an update was refused")
		}
		if applyBytes(t, peerDoc, update).Outcome != Applied {
			t.Fatal("an update did not apply")
		}
	}
	blocks := peerDoc.GetMap(s("blocks"))
	peerDoc.Transact(func(txn *Transaction) { blocks.Delete(txn, s("c")) })
	if blocks.Len() != 0 {
		t.Fatal("the chain survived")
	}
}

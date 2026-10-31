package yjs

import (
	"encoding/base64"
	"encoding/hex"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/yjs/yjstest"
)

// Ports of HostileUpdateTests, PendingRetentionTests and ParkedCoverageTests:
// behaviour a fixture cannot spell, driven through hand-built structs.

const peer = 7

func pinnedDoc() *Doc {
	id := uint32(pinnedClient)
	return NewDoc(Options{ClientID: &id})
}

func b64Bytes(t *testing.T, text string) []byte {
	t.Helper()
	data, err := base64.StdEncoding.DecodeString(text)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func applyBytes(t *testing.T, doc *Doc, update []byte) ApplyResult {
	t.Helper()
	result, err := doc.ApplyUpdate(update)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func applyStructs(t *testing.T, doc *Doc, structs []*DecodedStruct, deletions *DeleteSet) ApplyResult {
	t.Helper()
	if deletions == nil {
		deletions = &DeleteSet{}
	}
	result, err := doc.ApplyDecoded(&DecodedUpdate{Groups: []ClientStructs{{Client: peer, Structs: structs}}, DeleteSet: deletions})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func runStruct(clock uint64, text string) *DecodedStruct {
	root := s("t")
	return &DecodedStruct{ID: ID{peer, clock}, Length: len(s(text)), Kind: KindItem, ParentRoot: &root, Content: &ContentString{Text: s(text)}, Info: 0x04}
}

func afterStruct(clock, origin uint64, text string) *DecodedStruct {
	return &DecodedStruct{ID: ID{peer, clock}, Length: len(s(text)), Kind: KindItem, Origin: &ID{peer, origin}, Content: &ContentString{Text: s(text)}, Info: 0x84}
}

func skipStruct(clock uint64, length int) *DecodedStruct {
	return &DecodedStruct{ID: ID{peer, clock}, Length: length, Kind: KindSkip, Info: 10}
}

func TestAnUnreachableSameClientDependencyParksInsteadOfThrowing(t *testing.T) {
	for what, update := range map[string]string{
		"a parent that is the item itself":                      "AQEBACgAAQABawF+AA==",
		"a parent at a clock this client has not reached":       "AQEBACgAAQkBawF+AA==",
		"an origin at a clock this client has not reached":      "AQEBAIgBCQF+AA==",
		"a right origin at a clock this client has not reached": "AQEBAEgBCQF+AA==",
	} {
		bytes := b64Bytes(t, update)
		if Inspect(bytes, DefaultInspectDepth).Verdict != VerdictOK {
			t.Errorf("%s: not ok", what)
		}
		result := applyBytes(t, pinnedDoc(), bytes)
		if result.Outcome != Applied || !result.PendingRemains {
			t.Errorf("%s: %+v", what, result)
		}
	}
}

func TestAMapKeyWithNoValueReadsAsUndefined(t *testing.T) {
	for what, update := range map[string]string{
		"a formatting mark":  "AQHoBwAmAQFtAWsEYm9sZAR0cnVlAA==",
		"an empty string":    "AQHoBwAkAQFtAWsAAA==",
		"an empty value run": "AQHoBwAoAQFtAWsAAA==",
		"an empty JSON run":  "AQHoBwAiAQFtAWsAAA==",
	} {
		doc := pinnedDoc()
		if applyBytes(t, doc, b64Bytes(t, update)).Outcome != Applied {
			t.Errorf("%s: not applied", what)
		}
		value, ok := doc.GetMap(s("m")).Get(s("k"))
		if !ok || value != (jsjson.Undefined{}) {
			t.Errorf("%s: %#v %v", what, value, ok)
		}
		// An empty run put {1000: 0} in the state vector; the sync answer
		// must still encode.
		if full := mustEncode(t, doc, nil); len(full) == 0 {
			t.Errorf("%s: empty full state", what)
		}
	}
}

// mustEncode fails the test on an error or an engine panic.
func mustEncode(t *testing.T, doc *Doc, target []byte) (update []byte) {
	t.Helper()
	defer func() {
		if recovered := recover(); recovered != nil {
			t.Fatalf("encode panicked: %v", recovered)
		}
	}()
	update, err := doc.EncodeStateAsUpdate(target)
	if err != nil {
		t.Fatal(err)
	}
	return update
}

// Twin of C# HostileUpdateTests.TheFuzzCrashInputEncodes: the input that
// found the length-0 crash. Its full bytes hit the open parentSub-bit
// difference with yjs, so only the vector and a clean encode are pinned.
func TestTheFuzzCrashInputEncodes(t *testing.T) {
	update, err := hex.DecodeString("0102e80700220101300130002100e8303001303000")
	if err != nil {
		t.Fatal(err)
	}
	doc := docWithID(4242)
	if result := applyBytes(t, doc, update); result.Outcome != Applied {
		t.Fatalf("%+v", result)
	}
	mustEncode(t, doc, nil)
	if got := base64.StdEncoding.EncodeToString(doc.EncodeStateVector()); got != "AegHAA==" {
		t.Fatalf("sv %s", got)
	}
}

// Shared oracle with C# HostileUpdateTests.ALengthZeroStructEncodesAsYjsDoes:
// yjs accepts a length-0 struct and still encodes the document.
func TestALengthZeroStructEncodesAsYjsDoes(t *testing.T) {
	cases := fixtureCases(t, "empty-structs.json")
	if len(cases) == 0 {
		t.Fatal("empty-structs.json has no cases")
	}
	for _, c := range cases {
		t.Run(yjstest.String(c, "name"), func(t *testing.T) {
			doc := docWithID(4242)
			for _, update := range yjstest.Items(c, "updates") {
				applyBytes(t, doc, b64Bytes(t, update.(jsjson.Str).String()))
			}
			b64 := base64.StdEncoding.EncodeToString
			if got, want := b64(doc.EncodeStateVector()), yjstest.String(c, "sv"); got != want {
				t.Errorf("sv %s, want %s", got, want)
			}
			if got, want := b64(mustEncode(t, doc, nil)), yjstest.String(c, "full"); got != want {
				t.Errorf("full %s, want %s", got, want)
			}
			behind := fixtureBytes(t, c, "behind")
			if got, want := b64(mustEncode(t, doc, behind)), yjstest.String(c, "diff"); got != want {
				t.Errorf("diff %s, want %s", got, want)
			}
		})
	}
}

func TestAPartlyImpossibleUpdateStillEmitsWhatItIntegrated(t *testing.T) {
	doc := pinnedDoc()
	var emitted [][]byte
	doc.OnUpdate(func(event UpdateEvent) { emitted = append(emitted, event.Update) })
	result := applyBytes(t, doc, b64Bytes(t, "AgECACgBAW0EZ29vZAF4AQEAKAABAANiYWQBfgA="))
	if result.Outcome != Applied || len(emitted) != 1 {
		t.Fatalf("%+v, %d emitted", result, len(emitted))
	}
	if good, ok := doc.GetMap(s("m")).Get(s("good")); !ok || good != true {
		t.Fatalf("good = %v", good)
	}
	if !doc.HasPending() {
		t.Fatal("nothing parked")
	}
}

func TestAParkedSkipDoesNotSwallowContentThatArrivesLater(t *testing.T) {
	doc := pinnedDoc()
	applyStructs(t, doc, []*DecodedStruct{runStruct(0, "aaaaa"), skipStruct(5, 10), afterStruct(15, 14, "ccc"), skipStruct(18, 7), afterStruct(25, 24, "eeeee")}, nil)
	for _, parked := range doc.store.pendingStructs {
		if _, skip := parked.(*Skip); skip {
			t.Fatal("a Skip was parked")
		}
	}
	applyStructs(t, doc, []*DecodedStruct{afterStruct(19, 18, "bbbbbb")}, nil)
	found := false
	for _, parked := range doc.store.pendingStructs {
		if h := parked.head(); h.id.Clock == 19 && h.length == 6 {
			found = true
		}
	}
	if !found {
		t.Fatal("the content for the second hole was dropped")
	}
}

func TestAGapWiderThanAnIntIsWrittenAsSeveralSkips(t *testing.T) {
	doc := pinnedDoc()
	applyStructs(t, doc, []*DecodedStruct{runStruct(0, "a")}, nil)
	applyStructs(t, doc, []*DecodedStruct{runStruct(4294967295, "b")}, nil)
	decoded := mustDecode(t, encodeState(t, doc, nil))
	var skips, total uint64
	for _, group := range decoded.Groups {
		if group.Client != peer {
			continue
		}
		for _, d := range group.Structs {
			if d.Kind == KindSkip {
				skips++
				total += uint64(d.Length)
			}
		}
	}
	if skips != 2 || total != 4294967294 {
		t.Fatalf("%d skips covering %d", skips, total)
	}
}

func TestADiffStartingInsideAnAstralCharacterStillEncodes(t *testing.T) {
	doc := pinnedDoc()
	text := doc.GetText(s("t"))
	doc.Transact(func(txn *Transaction) { text.Insert(txn, 0, s("😀"), nil) })
	target := &StateVector{}
	target.Set(pinnedClient, 1)
	diff := encodeState(t, doc, target.Encode())
	if groups := mustDecode(t, diff).Groups; len(groups) != 1 {
		t.Fatalf("%d groups", len(groups))
	}
}

func parkedUnion(doc *Doc) uint64 { return doc.parkedCoverage() }

func rawParkedLength(doc *Doc) uint64 {
	var raw uint64
	for _, waiting := range doc.store.pendingStructs {
		raw += uint64(waiting.head().length)
	}
	return raw
}

func TestAnArrivalThatWidensOverlappingParkedRunsIsAChange(t *testing.T) {
	doc := pinnedDoc()
	applyStructs(t, doc, []*DecodedStruct{runStruct(5, "aaaaa"), runStruct(6, "bbb")}, nil)
	if rawParkedLength(doc) != 8 || parkedUnion(doc) != 5 {
		t.Fatalf("premise: raw %d union %d", rawParkedLength(doc), parkedUnion(doc))
	}
	arrival := applyStructs(t, doc, []*DecodedStruct{runStruct(10, "ccc")}, nil)
	if rawParkedLength(doc) != 8 || parkedUnion(doc) != 8 {
		t.Fatalf("raw %d union %d", rawParkedLength(doc), parkedUnion(doc))
	}
	if !arrival.Changed {
		t.Fatal("three newly parked clocks were reported as no change")
	}
}

func TestAParkedDeletionOfAlreadyParkedClocksIsAChange(t *testing.T) {
	doc := pinnedDoc()
	applyStructs(t, doc, []*DecodedStruct{runStruct(1, "aaaa")}, nil)
	if parkedUnion(doc) != 4 {
		t.Fatalf("union %d", parkedUnion(doc))
	}
	deletions := &DeleteSet{}
	deletions.add(peer, 1, 4)
	arrival := applyStructs(t, doc, nil, deletions)
	if parkedUnion(doc) != 8 || !arrival.Changed {
		t.Fatalf("union %d, %+v", parkedUnion(doc), arrival)
	}
}

func TestNoApplyThatGrowsParkedContentReportsNoChange(t *testing.T) {
	id := uint32(peer)
	stray := NewDoc(Options{ClientID: &id})
	text := stray.GetText(s("content"))
	insert := func(chunk string) {
		stray.Transact(func(txn *Transaction) { text.Insert(txn, len(text.Units()), s(chunk), nil) })
	}
	insert("a")
	insert("bcdefgh")
	stray.Transact(func(txn *Transaction) { text.Delete(txn, 3, 2) })
	insert("ijkl")
	insert("mnop")
	cuts := []uint64{1, 2, 3, 4, 5, 6, 8, 9, 10}
	updates := map[uint64][]byte{}
	for _, cut := range cuts {
		vector := &StateVector{}
		vector.Set(peer, cut)
		updates[cut] = encodeState(t, stray, vector.Encode())
	}
	swept := 0
	for _, first := range cuts {
		for _, second := range cuts {
			for _, third := range cuts {
				doc := pinnedDoc()
				applyBytes(t, doc, updates[first])
				applyBytes(t, doc, updates[second])
				before := parkedUnion(doc)
				result := applyBytes(t, doc, updates[third])
				swept++
				if parkedUnion(doc) > before && !result.Changed {
					t.Fatalf("%d,%d -> %d parked more and reported no change", first, second, third)
				}
			}
		}
	}
	if swept != 729 {
		t.Fatalf("swept %d", swept)
	}
}

// Twin of C# PendingRetentionTests.EqualClockParkedStructsKeepTheirParkedOrder.
// 16 one-char items of client 7 park at clocks 10..25, then a 5-char item
// parks at clock 13. With 17 structs an unstable sort reorders the two at
// clock 13, and the covered filter then keeps different structs.
func TestEqualClockParkedStructsKeepTheirParkedOrder(t *testing.T) {
	const items = "ARAHCgQBAXQBYQQBAXQBYgQBAXQBYwQBAXQBZAQBAXQBZQQBAXQBZgQBAXQBZwQBAXQBaAQBAXQBaQQBAXQBagQBAXQBawQBAXQBbAQBAXQBbQQBAXQBbgQBAXQBbwQBAXQBcAA="
	const gapFill = "AQoHAAQBAXQBMAQBAXQBMAQBAXQBMAQBAXQBMAQBAXQBMAQBAXQBMAQBAXQBMAQBAXQBMAQBAXQBMAQBAXQBMAA="
	cases := []struct{ name, run, pending, text string }{
		{"conflicting content", "AQEHDQQBAXQFQUJDREUA", "AQ0HCgQBAXQBYQQBAXQBYgQBAXQBYwQBAXQBZIQHDQRCQ0RFBAEBdAFpBAEBdAFqBAEBdAFrBAEBdAFsBAEBdAFtBAEBdAFuBAEBdAFvBAEBdAFwAA==", "ponmlkjidBCDEcba0000000000"},
		{"same content", "AQEHDQQBAXQFZGVmZ2gA", "AQ0HCgQBAXQBYQQBAXQBYgQBAXQBYwQBAXQBZIQHDQRlZmdoBAEBdAFpBAEBdAFqBAEBdAFrBAEBdAFsBAEBdAFtBAEBdAFuBAEBdAFvBAEBdAFwAA==", "ponmlkjidefghcba0000000000"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			doc := pinnedDoc()
			doc.GetText(s("t"))
			applyBytes(t, doc, b64Bytes(t, items))
			applyBytes(t, doc, b64Bytes(t, c.run))
			full, err := doc.EncodeStateAsUpdate(nil)
			if err != nil {
				t.Fatal(err)
			}
			if got := base64.StdEncoding.EncodeToString(full); got != c.pending {
				t.Fatalf("pending state %s, want %s", got, c.pending)
			}
			applyBytes(t, doc, b64Bytes(t, gapFill))
			if got := doc.GetText(s("t")).String(); got != c.text {
				t.Fatalf("text %q, want %q", got, c.text)
			}
		})
	}
}

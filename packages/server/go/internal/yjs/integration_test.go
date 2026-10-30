package yjs

import (
	"bytes"
	"slices"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/yjs/yjstest"
)

// Ports of the IntegrationTests that are not scenario replays.

func scenarioNamed(t *testing.T, name string) scenarioCase {
	t.Helper()
	for _, c := range scenarios(t) {
		if c.name == name {
			return c
		}
	}
	t.Fatalf("no scenario %s", name)
	return scenarioCase{}
}

func stepUpdate(t *testing.T, c scenarioCase, id string) []byte {
	t.Helper()
	for _, step := range c.steps {
		if step.id == id && step.update != nil {
			return step.update
		}
	}
	t.Fatalf("%s has no update %s", c.name, id)
	return nil
}

func docWithID(id uint32) *Doc { return NewDoc(Options{ClientID: &id}) }

func TestDuplicateDeliveryOfOneDecodedUpdateIsIdempotent(t *testing.T) {
	c := scenarioNamed(t, "duplicate-delivery")
	doc := docWithID(4242)
	decoded := mustDecode(t, stepUpdate(t, c, "s1"))
	if result, err := doc.ApplyDecoded(decoded); err != nil || result.Outcome != Applied {
		t.Fatalf("%+v %v", result, err)
	}
	once, vector := canonical(t, render(t, doc, c.roots)), doc.EncodeStateVector()
	if result, err := doc.ApplyDecoded(decoded); err != nil || result.Outcome != Applied || result.Changed {
		t.Fatalf("second apply: %+v %v", result, err)
	}
	if canonical(t, render(t, doc, c.roots)) != once || !bytes.Equal(doc.EncodeStateVector(), vector) || doc.HasPending() {
		t.Fatal("the second apply changed the document")
	}
}

func TestDeletingABlockCascadesIntoNestedTypesAndMatchesYjsDeleteSet(t *testing.T) {
	runner := newScenarioRunner(t, scenarioNamed(t, "cascade-delete-grid"))
	var seen []*DeleteSet
	runner.doc.encoder = func(txn *Transaction) []byte {
		seen = append(seen, txn.deleteSet)
		return nil
	}
	for _, step := range runner.c.steps {
		// The hook swallows the engine's bytes, so only deliveries run.
		if step.kind != "engineWrites" {
			step.expect = nil
			runner.run(step)
		}
	}
	last := seen[len(seen)-1]
	if !slices.Equal(last.Clients(), []uint64{1000}) || !slices.Equal(last.Ranges(1000), []DeleteRange{{0, 11}}) {
		t.Fatalf("%v %+v", last.Clients(), last.Ranges(1000))
	}
	for _, s := range runner.doc.store.clients[1000] {
		if !s.IsDeleted() {
			t.Fatal("a struct survived the cascade")
		}
	}
}

func TestContentGcReplacesDeletedContentAndSubtrees(t *testing.T) {
	collected := newScenarioRunner(t, scenarioNamed(t, "cascade-delete-grid"))
	collected.runAll()
	structs := collected.doc.store.clients[1000]
	if _, ok := structs[0].(*Item).content.(*ContentDeleted); !ok {
		t.Fatal("the head kept its content")
	}
	total := 0
	for i, s := range structs {
		total += s.head().length
		if _, ok := s.(*GC); i > 0 && !ok {
			t.Fatalf("struct %d is %T", i, s)
		}
	}
	kept := newScenarioRunner(t, scenarioNamed(t, "cascade-delete-grid-no-gc"))
	kept.runAll()
	keptTotal := 0
	for _, s := range kept.doc.store.clients[1000] {
		keptTotal += s.head().length
		if item, ok := s.(*Item); !ok || !item.deleted {
			t.Fatal("a struct was collected with gc off")
		}
	}
	if keptTotal != total {
		t.Fatalf("%d clocks kept, %d collected", keptTotal, total)
	}
	if _, ok := kept.doc.store.clients[1000][0].(*Item).content.(*ContentType); !ok {
		t.Fatal("the head lost its type with gc off")
	}
}

func rootsOf(value any) [][2]string {
	var roots [][2]string
	for _, member := range value.(*jsjson.Object).Members() {
		roots = append(roots, [2]string{member.Key.String(), member.Value.(jsjson.Str).String()})
	}
	return roots
}

func TestEveryStructsGoldenAppliesToItsJSON(t *testing.T) {
	for _, c := range fixtureCases(t, "structs.json") {
		name := yjstest.String(c, "name")
		doc := NewDoc(Options{ClientID: ptr32(7), NoGC: !yjstest.Bool(c, "gc")})
		if applyBytes(t, doc, fixtureBytes(t, c, "update")).Outcome != Applied {
			t.Errorf("%s: not applied", name)
			continue
		}
		if doc.HasPending() != yjstest.Bool(c, "hasPending") {
			t.Errorf("%s: hasPending %v", name, doc.HasPending())
		}
		if got, want := canonical(t, render(t, doc, rootsOf(yjstest.Field(c, "roots")))), canonical(t, yjstest.Field(c, "json")); got != want {
			t.Errorf("%s:\n got %s\nwant %s", name, got, want)
		}
	}
}

func ptr32(id uint32) *uint32 { return &id }

func TestReplaysEveryYrsEncodedFixture(t *testing.T) {
	roots := [][2]string{{"blocks", "map"}}
	for _, c := range fixtureCases(t, "yrs-compat.json") {
		name := yjstest.String(c, "name")
		update := fixtureBytes(t, c, "update")
		doc := docWithID(7)
		if applyBytes(t, doc, update).Outcome != Applied || doc.HasPending() {
			t.Errorf("%s: not applied cleanly", name)
			continue
		}
		rendered, vector := canonical(t, render(t, doc, roots)), doc.EncodeStateVector()
		applyBytes(t, doc, update)
		if !bytes.Equal(doc.EncodeStateVector(), vector) || canonical(t, render(t, doc, roots)) != rendered {
			t.Errorf("%s: a second apply changed the document", name)
		}
	}
}

func TestRemoteAdvanceOfTheLocalClockRegeneratesTheClientID(t *testing.T) {
	update := stepUpdate(t, scenarioNamed(t, "concurrent-map-set-two-clients"), "s1")
	impostor := docWithID(1000)
	applyBytes(t, impostor, update)
	if impostor.ClientID() == 1000 {
		t.Fatal("kept a client id another writer uses")
	}
	bystander := docWithID(4242)
	applyBytes(t, bystander, update)
	if bystander.ClientID() != 4242 {
		t.Fatal("re-minted without cause")
	}
}

func TestMalformedBytesReportMalformedAndLeaveTheDocUntouched(t *testing.T) {
	c := scenarioNamed(t, "concurrent-map-set-two-clients")
	doc := docWithID(4242)
	applyBytes(t, doc, stepUpdate(t, c, "s1"))
	vector, rendered := doc.EncodeStateVector(), canonical(t, render(t, doc, c.roots))
	result := applyBytes(t, doc, []byte{1, 1, 0xe8, 0x07})
	if result.Outcome != Malformed || result.Reason == "" || result.Changed {
		t.Fatalf("%+v", result)
	}
	if !bytes.Equal(doc.EncodeStateVector(), vector) || canonical(t, render(t, doc, c.roots)) != rendered {
		t.Fatal("a refused update changed the document")
	}
}

func TestEmptyV1UpdateAppliesAndChangesNothing(t *testing.T) {
	doc := pinnedDoc()
	result := applyBytes(t, doc, []byte{0, 0})
	if result.Outcome != Applied || result.Changed || result.PendingRemains {
		t.Fatalf("%+v", result)
	}
}

func TestAdoptClientIDWritesUnderTheAdoptedID(t *testing.T) {
	author := docWithID(1000)
	blocks := author.GetMap(s("blocks"))
	author.Transact(func(txn *Transaction) { blocks.Set(txn, s("a"), 1.0) })
	state := encodeState(t, author, nil)
	restored := docWithID(5)
	applyBytes(t, restored, state)
	// The load advanced 1000, not 5, so 5 is kept; adopting 1000 continues
	// its clock line instead of opening a new one.
	restored.AdoptClientID(1000)
	update := restored.Transact(func(txn *Transaction) { restored.GetMap(s("blocks")).Set(txn, s("b"), 2.0) })
	group := mustDecode(t, update).Groups[0]
	if group.Client != 1000 || group.Structs[0].ID.Clock != 1 {
		t.Fatalf("wrote %d:%d", group.Client, group.Structs[0].ID.Clock)
	}
}

func TestARemoteApplyInsideALocalTransactionMakesItRemote(t *testing.T) {
	peerDoc := docWithID(1001)
	peerDoc.Transact(func(txn *Transaction) { peerDoc.GetMap(s("m")).Set(txn, s("k"), 1.0) })
	update := encodeState(t, peerDoc, nil)
	doc := pinnedDoc()
	var events []UpdateEvent
	doc.OnUpdate(func(event UpdateEvent) { events = append(events, event) })
	var nested ApplyResult
	emitted := doc.Transact(func(txn *Transaction) {
		doc.GetMap(s("m")).Set(txn, s("own"), 2.0)
		nested = applyBytes(t, doc, update)
	})
	// The nested apply joins the open transaction, reports no move of its
	// own, and turns the whole transaction remote. A remote transaction that
	// advanced our own clock re-mints the id, so the local write does too.
	if nested.Changed || len(events) != 1 || events[0].Local || emitted == nil {
		t.Fatalf("nested %+v, events %+v", nested, events)
	}
	if doc.ClientID() == pinnedClient {
		t.Fatal("kept the client id")
	}
}

func TestSameClientGapParksTheTail(t *testing.T) {
	c := scenarioNamed(t, "out-of-order-delivery")
	doc := NewDoc(Options{ClientID: &c.clientID, NoGC: !c.gc})
	// Only the third op of a three-op run: nothing can be placed, and the
	// gap is recorded as "waiting for the clock before this one".
	if _, err := doc.ApplyUpdate(stepUpdate(t, c, "s3")); err != nil {
		t.Fatal(err)
	}
	store := doc.store
	if !doc.HasPending() || len(store.clients) != 0 || len(store.pendingStructs) != 1 {
		t.Fatalf("pending %v, clients %d, parked %d", doc.HasPending(), len(store.clients), len(store.pendingStructs))
	}
	if id := store.pendingStructs[0].head().id; id != (ID{pinnedClient, 2}) {
		t.Fatalf("parked %v", id)
	}
	if store.pendingMissing == nil || store.pendingMissing.Get(pinnedClient) != 1 {
		t.Fatalf("missing %v", store.pendingMissing)
	}
}

func TestPendingRetriesWhenTheDependencyArrives(t *testing.T) {
	c := scenarioNamed(t, "out-of-order-delivery")
	doc := NewDoc(Options{ClientID: &c.clientID, NoGC: !c.gc})
	for _, id := range []string{"s3", "s1"} {
		if _, err := doc.ApplyUpdate(stepUpdate(t, c, id)); err != nil {
			t.Fatal(err)
		}
	}
	// Clock 1 is still missing, so the parked clock 2 stays parked.
	if !doc.HasPending() || doc.store.getState(pinnedClient) != 1 {
		t.Fatalf("pending %v, state %d", doc.HasPending(), doc.store.getState(pinnedClient))
	}
	if _, err := doc.ApplyUpdate(stepUpdate(t, c, "s2")); err != nil {
		t.Fatal(err)
	}
	// The retry ran inside the same transaction: all three clocks are in.
	if doc.HasPending() || doc.store.getState(pinnedClient) != 3 || doc.store.pendingStructs != nil || doc.store.pendingMissing != nil {
		t.Fatalf("pending %v, state %d, parked %v, missing %v", doc.HasPending(), doc.store.getState(pinnedClient), doc.store.pendingStructs, doc.store.pendingMissing)
	}
}

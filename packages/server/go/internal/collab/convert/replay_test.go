package convert

import (
	"context"
	"errors"
	"fmt"
	"iter"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/lib0"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// Twins of CollabHistoryReplayTests.

func records(updates ...[]byte) iter.Seq2[operation.Record, error] {
	return func(yield func(operation.Record, error) bool) {
		for i, update := range updates {
			sequence := uint64(i + 1)
			record := operation.Record{
				OperationID: fmt.Sprintf("%032x", sequence),
				Sequence:    sequence,
				CommittedAt: time.Unix(0, 0).UTC().Add(time.Duration(sequence) * time.Minute),
				Source:      operation.SourceHTTPEdit,
				Update:      update,
				Digest:      make([]byte, 32),
			}
			if !yield(record, nil) {
				return
			}
		}
	}
}

func exportJSON(t *testing.T, doc *yjs.Doc) string {
	t.Helper()
	blocks, _, err := Export(doc, BuiltInRichTextFields(), nil)
	if err != nil {
		t.Fatal(err)
	}
	return canonical(t, blocks)
}

func localUpdates(doc *yjs.Doc) *[][]byte {
	var emitted [][]byte
	doc.OnUpdate(func(e yjs.UpdateEvent) {
		if e.Local {
			emitted = append(emitted, e.Update)
		}
	})
	return &emitted
}

func seeded(t *testing.T, blocks ...string) *yjs.Doc {
	t.Helper()
	var nodes []*jsjson.Node
	for _, b := range blocks {
		nodes = append(nodes, node(t, []byte(b)))
	}
	doc := yjs.NewDoc(yjs.Options{})
	if err := Seed(doc, nodes, Refusing(BuiltInRichTextFields()), nil); err != nil {
		t.Fatal(err)
	}
	return doc
}

func TestEveryPrefixExportsWhatTheLiveDocumentHeldAtThatPoint(t *testing.T) {
	live := seeded(t,
		`{"id":"root","type":"paragraph","data":{"text":[{"text":"r"}]}}`,
		`{"id":"second","type":"header","data":{"text":[{"text":"s"}],"level":2}}`)
	baseline, err := live.EncodeStateAsUpdate(nil)
	if err != nil {
		t.Fatal(err)
	}
	emitted := localUpdates(live)
	snapshots := []string{exportJSON(t, live)}
	for _, edit := range []string{
		`{"op":"insert","id":"a","after":"root","block":{"type":"paragraph","data":{"text":[{"text":"x "},{"text":"y","marks":{"bold":true}}]}}}`,
		`{"op":"update","id":"root","data":{"text":[{"text":"changed"}]}}`,
		`{"op":"remove","id":"second"}`,
		`{"op":"insert","id":"b","parent":"a","block":{"type":"paragraph","data":{"text":[{"text":"kid"}]}}}`,
	} {
		if err := ApplyOps(live, editOps(t, edit), Refusing(BuiltInRichTextFields())); err != nil {
			t.Fatal(err)
		}
		snapshots = append(snapshots, exportJSON(t, live))
	}
	if len(*emitted) != 4 {
		t.Fatalf("%d updates", len(*emitted))
	}
	for n := 0; n <= 4; n++ {
		replayed, err := BuildReplay(context.Background(), [][]byte{baseline}, records((*emitted)[:n]...))
		if err != nil {
			t.Fatal(err)
		}
		if got := exportJSON(t, replayed); got != snapshots[n] {
			t.Errorf("%d: %s, want %s", n, got, snapshots[n])
		}
	}
}

func textUpdates(t *testing.T, chunks ...string) [][]byte {
	t.Helper()
	client := uint32(1)
	source := yjs.NewDoc(yjs.Options{ClientID: &client})
	text := source.GetText(str("t"))
	var updates [][]byte
	at := 0
	for _, chunk := range chunks {
		updates = append(updates, source.Transact(func(tx *yjs.Transaction) { text.Insert(tx, at, str(chunk), nil) }))
		at += len(chunk)
	}
	return updates
}

func TestSteppingYieldsTheBaselineThenTheDocumentAfterEachRecord(t *testing.T) {
	u := textUpdates(t, "a", "b", "c")
	var seen []string
	err := StepReplay(context.Background(), [][]byte{u[0]}, records(u[1], u[2]), func(record *operation.Record, doc *yjs.Doc) error {
		sequence := "nil"
		if record != nil {
			sequence = fmt.Sprint(record.Sequence)
		}
		seen = append(seen, sequence+":"+doc.GetText(str("t")).String())
		return nil
	})
	if err != nil || strings.Join(seen, " ") != "nil:a 1:ab 2:abc" {
		t.Fatal(seen, err)
	}
}

// Journal order is commit order, not causal order: a record whose
// dependency comes later is parked, then lands with it.
func TestARecordAheadOfItsDependencyIsParkedNotRefused(t *testing.T) {
	u := textUpdates(t, "a", "b")
	toOne, err := BuildReplay(context.Background(), nil, records(u[1]))
	if err != nil || strings.Contains(toOne.GetText(str("t")).String(), "b") {
		t.Fatal(err)
	}
	toTwo, err := BuildReplay(context.Background(), nil, records(u[1], u[0]))
	if err != nil || toTwo.GetText(str("t")).String() != "ab" {
		t.Fatal(err)
	}
}

func TestAFormatOneBaselineExportsItsLegacySlot(t *testing.T) {
	replayed, err := BuildReplay(context.Background(), [][]byte{mustState(t, legacyHTMLDoc())}, records())
	if err != nil {
		t.Fatal(err)
	}
	// The slot is what DocConverter.Export reads to segments (C# test reads it through the runtime).
	_, slots, err := Export(replayed, BuiltInRichTextFields(), nil)
	if err != nil || len(slots) != 1 || slots[0].HTML.HTML.String() != "<b>x</b>" {
		t.Fatal(slots, err)
	}
}

func mustState(t *testing.T, doc *yjs.Doc) []byte {
	t.Helper()
	state, err := doc.EncodeStateAsUpdate(nil)
	if err != nil {
		t.Fatal(err)
	}
	return state
}

// nestedArrayUpdate is one map key holding depth nested Any arrays.
func nestedArrayUpdate(depth int) []byte {
	w := &lib0.Writer{}
	w.WriteVarUint(1)
	w.WriteVarUint(1)
	w.WriteVarUint(1000)
	w.WriteVarUint(0)
	// ContentAny with the parentSub bit; the parent is a root name.
	w.WriteUint8(0x28)
	w.WriteVarUint(1)
	w.WriteVarString(str("m"))
	w.WriteVarString(str("k"))
	w.WriteVarUint(1)
	for range depth {
		w.WriteUint8(117)
		w.WriteVarUint(1)
	}
	w.WriteUint8(126)
	w.WriteVarUint(0)
	return w.Bytes()
}

func TestARecordTheInspectorRefusesFailsNamingItsSequence(t *testing.T) {
	u := textUpdates(t, "a")
	_, err := BuildReplay(context.Background(), nil, records(u[0], nestedArrayUpdate(257)))
	var refused *ReplayError
	if !errors.As(err, &refused) || refused.Sequence == nil || *refused.Sequence != 2 || !strings.Contains(refused.Message, "record 2") {
		t.Fatal(err)
	}
	if want := "collab: history replay could not read record 2: yjs: a value nests 257 levels, past the 256 allowed."; refused.Message != want {
		t.Fatalf("%q", refused.Message)
	}
}

func TestABaselineFrameTheInspectorRefusesHasNoSequence(t *testing.T) {
	_, err := BuildReplay(context.Background(), [][]byte{nestedArrayUpdate(257)}, records())
	var refused *ReplayError
	if !errors.As(err, &refused) || refused.Sequence != nil || !strings.HasPrefix(refused.Message, "collab: history replay could not read baseline frame 0: ") {
		t.Fatal(err)
	}
}

func TestCancellingBetweenRecordsStopsTheReplay(t *testing.T) {
	u := textUpdates(t, "a", "b")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cancelAfterFirst := func(yield func(operation.Record, error) bool) {
		for record, err := range records(u...) {
			if !yield(record, err) {
				return
			}
			cancel()
		}
	}
	if _, err := BuildReplay(ctx, nil, cancelAfterFirst); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

// The edit endpoint journals its update without the inspector, so replay
// must take the deepest data an edit can write: nested objects become
// Y.Maps (shallow Any); an array holding a scalar stays one Any value, kept
// at 256 levels by the converter's own cap.
func TestAnEditAtTheDeepestDataTheConverterTakesReplays(t *testing.T) {
	for _, c := range []struct {
		open, close string
		anyDepth    int
	}{{`{"k":`, `}`, 0}, {`[1,`, `]`, 256}} {
		deep := func(containers int) string {
			return `{"op":"update","id":"root","data":{"deep":` + strings.Repeat(c.open, containers) + "1" + strings.Repeat(c.close, containers) + `}}`
		}
		live := seeded(t, `{"id":"root","type":"paragraph","data":{"text":[{"text":"r"}]}}`)
		baseline := mustState(t, live)
		emitted := localUpdates(live)
		if err := ApplyOps(live, editOps(t, deep(MaxValueDepth)), Refusing(BuiltInRichTextFields())); err != nil {
			t.Fatal(err)
		}
		if len(*emitted) != 1 {
			t.Fatalf("%d updates", len(*emitted))
		}
		update := (*emitted)[0]
		if got := yjs.Inspect(update, yjs.DefaultInspectDepth); got.Decoded == nil || got.Decoded.MaxNestingDepth != c.anyDepth {
			t.Fatalf("depth %+v", got)
		}
		replayed, err := BuildReplay(context.Background(), [][]byte{baseline}, records(update))
		if err != nil || exportJSON(t, replayed) != exportJSON(t, live) {
			t.Fatal(err)
		}
		// One more level and the edit is refused, so it never reaches the journal.
		var edit *EditError
		if err := ApplyOps(live, editOps(t, deep(MaxValueDepth+1)), Refusing(BuiltInRichTextFields())); !errors.As(err, &edit) || len(*emitted) != 1 {
			t.Fatal(err)
		}
	}
}

package room

import (
	"context"
	"encoding/base64"
	"strconv"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

// The twins of C# CollabHistoryCaptureTests: the same grouping, changes
// and restore plans, read from fixtures/collab-history.

func historyFixture(t *testing.T, name string) []*jsjson.Object {
	t.Helper()
	fixture := readRepoJSON(t, "test", "unit", "server-conformance", "fixtures", "collab-history", name)
	items, _ := member(t, fixture, "cases").([]any)
	if len(items) < 5 {
		t.Fatalf("%s: only %d cases", name, len(items))
	}
	cases := make([]*jsjson.Object, len(items))
	for i, item := range items {
		cases[i] = item.(*jsjson.Object)
	}
	return cases
}

func text(t *testing.T, object *jsjson.Object, key string) string {
	t.Helper()
	s, ok := member(t, object, key).(jsjson.Str)
	if !ok {
		t.Fatalf("%q is not a string", key)
	}
	return s.String()
}

func optionalText(t *testing.T, object *jsjson.Object, key string) *string {
	t.Helper()
	if member(t, object, key) == nil {
		return nil
	}
	s := text(t, object, key)
	return &s
}

func number(t *testing.T, object *jsjson.Object, key string) uint64 {
	t.Helper()
	n, err := strconv.ParseUint(text(t, object, key), 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func ticks(t *testing.T, object *jsjson.Object, key string) *time.Time {
	t.Helper()
	s := optionalText(t, object, key)
	if s == nil {
		return nil
	}
	n, err := strconv.ParseInt(*s, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	at := dotnet.TimeFromTicks(n)
	return &at
}

func ticksText(at *time.Time) *string {
	if at == nil {
		return nil
	}
	s := strconv.FormatInt(dotnet.Ticks(*at), 10)
	return &s
}

func sameText(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func show(s *string) string {
	if s == nil {
		return "null"
	}
	return strconv.Quote(*s)
}

func objects(t *testing.T, value any) []*jsjson.Object {
	t.Helper()
	items, _ := value.([]any)
	out := make([]*jsjson.Object, len(items))
	for i, item := range items {
		out[i] = item.(*jsjson.Object)
	}
	return out
}

func stringList(t *testing.T, value any) []string {
	t.Helper()
	items, _ := value.([]any)
	out := make([]string, len(items))
	for i, item := range items {
		out[i] = item.(jsjson.Str).String()
	}
	return out
}

func sameStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func stringified(t *testing.T, value any) string {
	t.Helper()
	s, err := jsjson.Stringify(value)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func nodeText(t *testing.T, node *jsjson.Node) string {
	t.Helper()
	if node == nil {
		return "null"
	}
	raw, err := node.AppendJSON(nil)
	if err != nil {
		t.Fatal(err)
	}
	value, err := jsjson.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return stringified(t, value)
}

func objectText(t *testing.T, object *jsjson.Object) string {
	if object == nil {
		return "null"
	}
	return stringified(t, object)
}

func decode(t *testing.T, s string) []byte {
	t.Helper()
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestGroupVersionsMatchesTheTimelineFixture(t *testing.T) {
	for _, c := range historyFixture(t, "timeline.json") {
		name := text(t, c, "name")
		var lineages []LineageHeaders
		for _, entry := range objects(t, member(t, c, "lineages")) {
			lineage := LineageHeaders{Lineage: journal.LineageInfo{
				Lineage: text(t, entry, "lineage"), Epoch: 1, Format: 2, CreatedAt: ticks(t, entry, "createdAt"),
			}}
			for _, header := range objects(t, member(t, entry, "headers")) {
				lineage.Headers = append(lineage.Headers, journal.RecordHeader{
					Sequence:    number(t, header, "sequence"),
					CommittedAt: *ticks(t, header, "committedAt"),
					ActorID:     optionalText(t, header, "actor"),
				})
			}
			lineages = append(lineages, lineage)
		}
		gap, span := timelineIdleGap, timelineMaxSpan
		if window, ok := member(t, c, "windowMinutes").(float64); ok {
			gap, span = time.Duration(window)*time.Minute, time.Duration(window)*time.Minute
		}
		got := GroupVersions(lineages, gap, span)
		want := objects(t, member(t, c, "versions"))
		if len(got) != len(want) {
			t.Errorf("%s: %d versions, want %d", name, len(got), len(want))
			continue
		}
		for i, version := range want {
			g := got[i]
			if g.Lineage != text(t, version, "lineage") || g.Sequence != number(t, version, "sequence") ||
				!sameText(ticksText(g.StartedAt), optionalText(t, version, "startedAt")) ||
				!sameText(ticksText(g.SavedAt), optionalText(t, version, "savedAt")) ||
				!sameStrings(g.Actors, stringList(t, member(t, version, "actors"))) {
				t.Errorf("%s: version %d is %+v, want %s", name, i, g, stringified(t, version))
			}
		}
	}
}

func TestReplayChangesMatchesTheChangesFixture(t *testing.T) {
	converter := &convert.DocConverter{Now: time.Now}
	for _, c := range historyFixture(t, "changes.json") {
		name := text(t, c, "name")
		var baseline [][]byte
		for _, update := range stringList(t, member(t, c, "baseline")) {
			baseline = append(baseline, decode(t, update))
		}
		var records []operation.Record
		for _, record := range objects(t, member(t, c, "records")) {
			sequence := number(t, record, "sequence")
			records = append(records, operation.Record{
				OperationID: "op-" + strconv.FormatUint(sequence, 10),
				Sequence:    sequence,
				CommittedAt: *ticks(t, record, "committedAt"),
				ActorID:     optionalText(t, record, "actor"),
				Source:      operation.SourceHTTPEdit,
				Update:      decode(t, text(t, record, "update")),
				Digest:      make([]byte, 32),
			})
		}
		maxBytes, err := strconv.ParseInt(text(t, c, "maxBytes"), 10, 64)
		if err != nil {
			t.Fatal(err)
		}
		got, err := ReplayChanges(context.Background(), baseline, func(yield func(operation.Record, error) bool) {
			for _, record := range records {
				if !yield(record, nil) {
					return
				}
			}
		}, number(t, c, "firstBefore"), converter, maxBytes)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		want := objects(t, member(t, c, "changes"))
		if len(got) != len(want) {
			t.Errorf("%s: %d rows, want %d", name, len(got), len(want))
			continue
		}
		for i, row := range want {
			g := got[i]
			if g.Sequence != number(t, row, "sequence") ||
				!sameText(ticksText(&g.CommittedAt), optionalText(t, row, "committedAt")) ||
				!sameText(g.ActorID, optionalText(t, row, "actor")) ||
				!sameStrings(g.Page, stringList(t, member(t, row, "page"))) {
				t.Errorf("%s: row %d is %d %v %s %v, want %s", name, i, g.Sequence, g.CommittedAt, show(g.ActorID), g.Page, stringified(t, row))
			}
			blocks := objects(t, member(t, row, "blocks"))
			if len(g.Blocks) != len(blocks) {
				t.Errorf("%s: row %d has %d blocks, want %d", name, i, len(g.Blocks), len(blocks))
				continue
			}
			for j, block := range blocks {
				change := g.Blocks[j]
				var typeName *string
				if change.Type != nil {
					s := change.Type.String()
					typeName = &s
				}
				if change.ID.String() != text(t, block, "id") || !sameText(typeName, optionalText(t, block, "type")) ||
					blockChangeKindNames[change.Kind] != text(t, block, "kind") ||
					objectText(t, change.Before) != stringified(t, member(t, block, "before")) ||
					objectText(t, change.After) != stringified(t, member(t, block, "after")) {
					t.Errorf("%s: row %d block %d is %s %s %s -> %s, want %s", name, i, j, change.ID.String(),
						blockChangeKindNames[change.Kind], objectText(t, change.Before), objectText(t, change.After), stringified(t, block))
				}
			}
		}
	}
}

func docOf(t *testing.T, update string) *yjs.Doc {
	t.Helper()
	doc := yjs.NewDoc(yjs.Options{})
	if _, err := doc.ApplyUpdate(decode(t, update)); err != nil {
		t.Fatal(err)
	}
	return doc
}

func exportedBlocks(t *testing.T, doc *yjs.Doc) []any {
	t.Helper()
	blocks, slots, err := (&convert.DocConverter{Now: time.Now}).ExportBlocks(doc, map[string]bool{})
	if err != nil {
		t.Fatal(err)
	}
	if len(slots) != 0 {
		t.Fatalf("%d HTML slots: the fixture holds format-2 docs only", len(slots))
	}
	return blocks
}

func opText(t *testing.T, op convert.EditOp) string {
	t.Helper()
	out := &jsjson.Object{}
	str := func(key string, value *string) {
		if value == nil {
			out.Set(jsjson.FromString(key), nil)
			return
		}
		out.Set(jsjson.FromString(key), jsjson.FromString(*value))
	}
	parsed := func(key string, node *jsjson.Node) {
		raw, err := node.AppendJSON(nil)
		if err != nil {
			t.Fatal(err)
		}
		value, err := jsjson.Parse(raw)
		if err != nil {
			t.Fatal(err)
		}
		out.Set(jsjson.FromString(key), value)
	}
	switch v := op.(type) {
	case convert.Insert:
		str("op", ptr("insert"))
		str("id", &v.ID)
		str("after", v.After)
		str("parent", v.Parent)
		parsed("block", v.Block)
	case convert.Update:
		str("op", ptr("update"))
		str("id", &v.ID)
		parsed("data", v.Data)
	case convert.Remove:
		str("op", ptr("remove"))
		str("id", &v.ID)
	case convert.PatchMaps:
		str("op", ptr("patchMaps"))
		patches := []any{}
		for _, patch := range v.Patches {
			entry := &jsjson.Object{}
			entry.Set(jsjson.FromString("map"), jsjson.FromString(patch.Map))
			entry.Set(jsjson.FromString("key"), jsjson.FromString(patch.Key))
			entry.Set(jsjson.FromString("remove"), patch.Remove)
			entry.Set(jsjson.FromString("value"), patch.Value)
			patches = append(patches, entry)
		}
		out.Set(jsjson.FromString("patches"), patches)
	default:
		t.Fatalf("the planner made a %T", op)
	}
	return stringified(t, out)
}

func ptr(s string) *string { return &s }

func TestPlanRestoreMatchesTheRestorePlansFixture(t *testing.T) {
	for _, c := range historyFixture(t, "restore-plans.json") {
		name := text(t, c, "name")
		current, target := docOf(t, text(t, c, "current")), docOf(t, text(t, c, "target"))
		var trash *RestoreTrash
		if raw, ok := c.Get(jsjson.FromString("trash")); ok {
			input := raw.(*jsjson.Object)
			trash = &RestoreTrash{At: int64(member(t, input, "at").(float64))}
			if by, isString := member(t, input, "by").(jsjson.Str); isString {
				name := by.String()
				trash.By = &name
			}
		}
		ops := PlanRestoreTrashing(exportedBlocks(t, current), convert.DescribeStructure(current), exportedBlocks(t, target),
			convert.ReadPageMaps(current), convert.ReadPageMaps(target), trash)
		want, _ := member(t, c, "ops").([]any)
		if len(ops) != len(want) {
			t.Errorf("%s: %d ops, want %d", name, len(ops), len(want))
			continue
		}
		for i, op := range ops {
			if got, expected := opText(t, op), stringified(t, want[i]); got != expected {
				t.Errorf("%s: op %d is %s, want %s", name, i, got, expected)
			}
		}
	}
}

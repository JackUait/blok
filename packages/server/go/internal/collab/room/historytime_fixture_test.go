package room

import (
	"strconv"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
)

// The twins of C# CollabHistoryTimeCaptureTests.

func fixtureLineages(t *testing.T, c *jsjson.Object) []LineageHeaders {
	t.Helper()
	var lineages []LineageHeaders
	for _, entry := range objects(t, member(t, c, "lineages")) {
		lineage := LineageHeaders{Lineage: journal.LineageInfo{
			Lineage: text(t, entry, "lineage"), Epoch: 1, Format: 2, CreatedAt: ticks(t, entry, "createdAt"),
		}}
		for _, header := range objects(t, member(t, entry, "headers")) {
			lineage.Headers = append(lineage.Headers, journal.RecordHeader{
				Sequence: number(t, header, "sequence"), CommittedAt: *ticks(t, header, "committedAt"),
			})
		}
		lineages = append(lineages, lineage)
	}
	return lineages
}

func pointText(p *HistoryPoint) string {
	if p == nil {
		return "null"
	}
	return p.Lineage + ":" + strconv.FormatUint(p.Sequence, 10) + "@" + *ticksText(p.CommittedAt)
}

func wantPointText(t *testing.T, value any) string {
	t.Helper()
	if value == nil {
		return "null"
	}
	o := value.(*jsjson.Object)
	return text(t, o, "lineage") + ":" + text(t, o, "sequence") + "@" + text(t, o, "committedAt")
}

func TestParseHistoryTimeMatchesTheAtTimeFixture(t *testing.T) {
	fixture := readRepoJSON(t, "test", "unit", "server-conformance", "fixtures", "collab-history", "at-time.json")
	cases := objects(t, member(t, fixture, "parse"))
	if len(cases) < 5 {
		t.Fatalf("only %d parse cases", len(cases))
	}
	for _, c := range cases {
		input := text(t, c, "text")
		var got *string
		if at, ok := ParseHistoryTime(input); ok {
			got = ticksText(&at)
		}
		if want := optionalText(t, c, "ticks"); !sameText(got, want) {
			t.Errorf("%q parsed to %s, want %s", input, show(got), show(want))
		}
	}
}

func TestResolveAtMatchesTheAtTimeFixture(t *testing.T) {
	for _, c := range historyFixture(t, "at-time.json") {
		got := ResolveAt(fixtureLineages(t, c), *ticks(t, c, "time"))
		if want := wantPointText(t, member(t, c, "point")); pointText(got) != want {
			t.Errorf("%s: %s, want %s", text(t, c, "name"), pointText(got), want)
		}
	}
}

func TestSelectRangeMatchesTheChangesRangeFixture(t *testing.T) {
	for _, c := range historyFixture(t, "changes-range.json") {
		name := text(t, c, "name")
		var before *HistoryPoint
		if o, ok := member(t, c, "before").(*jsjson.Object); ok {
			before = &HistoryPoint{Lineage: text(t, o, "lineage"), Sequence: number(t, o, "sequence")}
		}
		maxRecords := int(member(t, c, "maxRecords").(float64))
		maxLineages := int(member(t, c, "maxLineages").(float64))
		got := SelectRange(fixtureLineages(t, c), *ticks(t, c, "from"), *ticks(t, c, "to"), before, maxRecords, maxLineages)
		if found := member(t, c, "found").(bool); found != (got.Status == HistoryReady) {
			t.Errorf("%s: status %v, want found %v", name, got.Status, found)
		}
		want := objects(t, member(t, c, "records"))
		if len(got.Records) != len(want) || got.Truncated != member(t, c, "truncated").(bool) {
			t.Errorf("%s: %d records truncated %v, want %d truncated %v", name, len(got.Records), got.Truncated,
				len(want), member(t, c, "truncated"))
			continue
		}
		for i, record := range want {
			if g, w := pointText(&got.Records[i]), wantPointText(t, record); g != w {
				t.Errorf("%s: record %d is %s, want %s", name, i, g, w)
			}
		}
	}
}

func TestFitRowsMatchesTheChangesRangeFixture(t *testing.T) {
	fixture := readRepoJSON(t, "test", "unit", "server-conformance", "fixtures", "collab-history", "changes-range.json")
	cases := objects(t, member(t, fixture, "fit"))
	if len(cases) < 5 {
		t.Fatalf("only %d fit cases", len(cases))
	}
	for _, c := range cases {
		var sizes []int64
		for _, row := range objects(t, member(t, c, "rows")) {
			sizes = append(sizes, int64(number(t, row, "bytes")))
		}
		got := FitRows(sizes, int64(number(t, c, "maxBytes")))
		if want := int(member(t, c, "kept").(float64)); got != want {
			t.Errorf("%s: kept %d, want %d", text(t, c, "name"), got, want)
		}
	}
}

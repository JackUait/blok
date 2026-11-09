package room

import (
	"strconv"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
)

// The twin of C# CollabHistoryWindowCaptureTests.

func windowFixture(t *testing.T) *jsjson.Object {
	t.Helper()
	return readRepoJSON(t, "test", "unit", "server-conformance", "fixtures", "collab-history", "window.json")
}

func TestHistoryCutMatchesTheWindowFixture(t *testing.T) {
	cuts := objects(t, member(t, windowFixture(t), "cuts"))
	if len(cuts) < 4 {
		t.Fatalf("only %d cut cases", len(cuts))
	}
	for _, c := range cuts {
		window, err := strconv.ParseInt(text(t, c, "window"), 10, 64)
		if err != nil {
			t.Fatal(err)
		}
		got := HistoryCut(*ticks(t, c, "now"), window)
		if want := text(t, c, "cut"); *ticksText(&got) != want {
			t.Errorf("%s: cut %s, want %s", text(t, c, "name"), *ticksText(&got), want)
		}
	}
}

func floorText(floor *uint64) string {
	if floor == nil {
		return "null"
	}
	return strconv.FormatUint(*floor, 10)
}

func TestHistoryWindowMatchesTheWindowFixture(t *testing.T) {
	cases := objects(t, member(t, windowFixture(t), "cases"))
	if len(cases) < 8 {
		t.Fatalf("only %d window cases", len(cases))
	}
	for _, c := range cases {
		name := text(t, c, "name")
		lineages := fixtureLineages(t, c)
		cut := *ticks(t, c, "cut")
		floors := HistoryFloors(lineages, cut)
		wantFloors := member(t, c, "floors").(*jsjson.Object)
		for _, lineage := range lineages {
			want := "null"
			if value, _ := wantFloors.Get(jsjson.FromString(lineage.Lineage.Lineage)); value != nil {
				want = value.(jsjson.Str).String()
			}
			if got := floorText(floors[lineage.Lineage.Lineage]); got != want {
				t.Errorf("%s: %s floor %s, want %s", name, lineage.Lineage.Lineage, got, want)
			}
		}
		for _, p := range objects(t, member(t, c, "points")) {
			lineage, sequence := text(t, p, "lineage"), number(t, p, "sequence")
			if got, want := HidesPoint(floors, lineage, sequence), member(t, p, "hidden").(bool); got != want {
				t.Errorf("%s: %s:%d hidden %v, want %v", name, lineage, sequence, got, want)
			}
		}
		for _, s := range objects(t, member(t, c, "since")) {
			lineage := text(t, s, "lineage")
			if got, want := WindowSince(floors[lineage], number(t, s, "since")), number(t, s, "from"); got != want {
				t.Errorf("%s: %s since from %d, want %d", name, lineage, got, want)
			}
		}
		for _, a := range objects(t, member(t, c, "at")) {
			at := *ticks(t, a, "time")
			point := ResolveAt(lineages, at)
			got, reason := "null", "null"
			switch {
			case point == nil:
				reason = "not_found"
			case HidesPoint(floors, point.Lineage, point.Sequence):
				reason = "retention"
			default:
				got = point.Lineage + ":" + strconv.FormatUint(point.Sequence, 10)
			}
			want := "null"
			if o, ok := member(t, a, "point").(*jsjson.Object); ok {
				want = text(t, o, "lineage") + ":" + text(t, o, "sequence")
			}
			wantReason := "null"
			if r := optionalText(t, a, "reason"); r != nil {
				wantReason = *r
			}
			if got != want || reason != wantReason {
				t.Errorf("%s: at %d is %s (%s), want %s (%s)", name, dotnet.Ticks(at), got, reason, want, wantReason)
			}
		}
		visible := VisibleTimeline(lineages, cut)
		from, to := dotnet.TimeFromTicks(0), dotnet.TimeFromTicks(3155378975999999999)
		for _, r := range objects(t, member(t, c, "range")) {
			var before *HistoryPoint
			if o, ok := member(t, r, "before").(*jsjson.Object); ok {
				before = &HistoryPoint{Lineage: text(t, o, "lineage"), Sequence: number(t, o, "sequence")}
			}
			hidden := before != nil && HidesPoint(floors, before.Lineage, before.Sequence)
			if want := optionalText(t, r, "reason"); (want != nil) != hidden {
				t.Errorf("%s: before %v hidden %v, want reason %s", name, before, hidden, show(want))
				continue
			}
			want := objects(t, member(t, r, "records"))
			if hidden {
				continue
			}
			got := SelectRange(visible, from, to, before, 200, MaxRangeLineages).Records
			if len(got) != len(want) {
				t.Errorf("%s: before %v has %d records, want %d", name, before, len(got), len(want))
				continue
			}
			for i, record := range want {
				if g, w := got[i].Lineage+":"+strconv.FormatUint(got[i].Sequence, 10), text(t, record, "lineage")+":"+text(t, record, "sequence"); g != w {
					t.Errorf("%s: before %v record %d is %s, want %s", name, before, i, g, w)
				}
			}
		}
	}
}

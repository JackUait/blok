package room

import (
	"context"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
)

// Two lineages whose rows together pass the byte cap: the older lineage
// replays with what the newer one left, so the answer stops at the cap.
func TestChangesBetweenKeepsOneByteBudgetAcrossLineages(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	histEdit(t, manager, histUpdate(t, "a", "old one"))
	histEdit(t, manager, histUpdate(t, "a", "old two"))
	old := b.lineage(t)
	histReset(t, manager)
	histBlocks(t, manager)
	histEdit(t, manager, histUpdate(t, "a", "new one"))
	current := b.lineage(t)
	from, to := dotnet.TimeFromTicks(0), dotnet.TimeFromTicks(maxTicks)

	all, err := manager.ChangesBetween(context.Background(), histDoc, from, to, nil, MaxChangeRecords, MaxChangeBytes)
	if err != nil || all.Status != HistoryReady || len(all.Records) != 3 || all.Truncated {
		t.Fatalf("all = %+v, %v", all, err)
	}
	newest := RecordBytes(all.Records[0].RecordChanges)
	// Room for the newest row and half of the next one.
	result, err := manager.ChangesBetween(context.Background(), histDoc, from, to, nil, MaxChangeRecords,
		newest+RecordBytes(all.Records[1].RecordChanges)/2)

	if err != nil || result.Status != HistoryReady || !result.Truncated {
		t.Fatalf("result = %v, truncated %v, %v", result.Status, result.Truncated, err)
	}
	var got []string
	for _, record := range result.Records {
		got = append(got, record.Lineage)
	}
	if !slices.Equal(got, []string{current}) || current == old {
		t.Fatalf("lineages = %v, want only %s", got, current)
	}
}

// A lineage cut by its own replay ends the answer: an older lineage that
// would still fit must not follow it, or the cut rows would be skipped.
func TestChangesBetweenStopsAtALineageItsOwnReplayCut(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	histEdit(t, manager, histUpdate(t, "a", "s"))
	histReset(t, manager)
	histBlocks(t, manager)
	histEdit(t, manager, histUpdate(t, "a", strings.Repeat("x", 1000)))
	histEdit(t, manager, histUpdate(t, "a", strings.Repeat("y", 1000)))
	current := b.lineage(t)
	from, to := dotnet.TimeFromTicks(0), dotnet.TimeFromTicks(maxTicks)
	all, err := manager.ChangesBetween(context.Background(), histDoc, from, to, nil, MaxChangeRecords, MaxChangeBytes)
	if err != nil || len(all.Records) != 3 {
		t.Fatalf("all = %+v, %v", all, err)
	}
	// Room for the newest row and the old lineage's small row, not the middle one.
	budget := RecordBytes(all.Records[0].RecordChanges) + RecordBytes(all.Records[2].RecordChanges)

	result, err := manager.ChangesBetween(context.Background(), histDoc, from, to, nil, MaxChangeRecords, budget)

	if err != nil || !result.Truncated || len(result.Records) != 1 || result.Records[0].Lineage != current ||
		result.Records[0].Sequence != 2 {
		t.Fatalf("result = %v rows, truncated %v, %v", len(result.Records), result.Truncated, err)
	}
}

func TestChangesBetweenReadsAtMostEightLineages(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, DefaultOptions())
	histBlocks(t, manager)
	var lineages []string
	for i := 0; i < MaxRangeLineages+1; i++ {
		if i > 0 {
			histReset(t, manager)
			histBlocks(t, manager)
		}
		histEdit(t, manager, histUpdate(t, "a", "v"+strconv.Itoa(i)))
		lineages = append(lineages, b.lineage(t))
	}
	from, to := dotnet.TimeFromTicks(0), dotnet.TimeFromTicks(maxTicks)

	result, err := manager.ChangesBetween(context.Background(), histDoc, from, to, nil, MaxChangeRecords, MaxChangeBytes)

	if err != nil || !result.Truncated || len(result.Records) != MaxRangeLineages {
		t.Fatalf("result = %d rows, truncated %v, %v", len(result.Records), result.Truncated, err)
	}
	if got := result.Records[len(result.Records)-1].Lineage; got != lineages[1] {
		t.Fatalf("oldest lineage read = %s, want %s", got, lineages[1])
	}
}

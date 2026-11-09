package room

import (
	"context"
	"slices"
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

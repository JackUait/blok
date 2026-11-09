package room

import (
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
)

// HistoryCut is CollabHistoryWindow.Cut: now minus the window in .NET
// ticks, never before tick 0. A negative window counts as zero.
func HistoryCut(now time.Time, windowTicks int64) time.Time {
	return dotnet.TimeFromTicks(max(0, dotnet.Ticks(now)-max(0, windowTicks)))
}

// HistoryFloor is CollabHistoryWindow.Floor: the highest sequence the cut
// hides, nil when it hides none. The baseline is hidden when its lineage was
// created before the cut or has no created-at; a record when committed
// before it; and every point below a hidden one.
func HistoryFloor(lineage LineageHeaders, cut time.Time) *uint64 {
	cutTicks := dotnet.Ticks(cut)
	var floor *uint64
	if created := lineage.Lineage.CreatedAt; created == nil || dotnet.Ticks(*created) < cutTicks {
		floor = new(uint64)
	}
	for _, header := range lineage.Headers {
		if dotnet.Ticks(header.CommittedAt) < cutTicks && (floor == nil || header.Sequence > *floor) {
			floor = new(header.Sequence)
		}
	}
	return floor
}

// HistoryFloors is each lineage's floor by name; a repeated name keeps the newest.
func HistoryFloors(lineages []LineageHeaders, cut time.Time) map[string]*uint64 {
	floors := make(map[string]*uint64, len(lineages))
	for _, lineage := range lineages {
		floors[lineage.Lineage.Lineage] = HistoryFloor(lineage, cut)
	}
	return floors
}

func hides(floor *uint64, sequence uint64) bool { return floor != nil && sequence <= *floor }

// HidesPoint: the window hides the point. A lineage the floors lack hides
// nothing: it answers not found.
func HidesPoint(floors map[string]*uint64, lineage string, sequence uint64) bool {
	return hides(floors[lineage], sequence)
}

// WindowSince is a changes read's since, raised to the floor so no hidden
// record is listed.
func WindowSince(floor *uint64, since uint64) uint64 {
	if floor != nil && *floor > since {
		return *floor
	}
	return since
}

// VisibleTimeline is the timeline as the window shows it: hidden records
// dropped, a hidden baseline without its created-at.
func VisibleTimeline(lineages []LineageHeaders, cut time.Time) []LineageHeaders {
	visible := make([]LineageHeaders, 0, len(lineages))
	for _, lineage := range lineages {
		floor := HistoryFloor(lineage, cut)
		entry := LineageHeaders{Lineage: lineage.Lineage}
		if floor != nil {
			entry.Lineage.CreatedAt = nil
		}
		for _, header := range lineage.Headers {
			if !hides(floor, header.Sequence) {
				entry.Headers = append(entry.Headers, header)
			}
		}
		visible = append(visible, entry)
	}
	return visible
}

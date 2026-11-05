package room

import (
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/journal"
)

// Version is CollabVersion: one version in a document's history. Sequence 0
// is a lineage baseline; both its times are the lineage's created-at.
type Version struct {
	Lineage   string
	Sequence  uint64
	StartedAt *time.Time
	SavedAt   *time.Time
	// Actors are distinct, in first-seen order.
	Actors []string
}

// LineageHeaders is one lineage with its record headers.
type LineageHeaders struct {
	Lineage journal.LineageInfo
	Headers []journal.RecordHeader
}

const (
	timelineIdleGap = 2 * time.Minute
	timelineMaxSpan = 10 * time.Minute
)

// GroupVersions is CollabVersionTimeline.Group: newest lineage first, each
// lineage's groups newest first, then its baseline.
func GroupVersions(lineagesOldestFirst []LineageHeaders, idleGap, maxSpan time.Duration) []Version {
	versions := []Version{}
	for i := len(lineagesOldestFirst) - 1; i >= 0; i-- {
		lineage, headers := lineagesOldestFirst[i].Lineage, lineagesOldestFirst[i].Headers
		var groups []Version
		start := 0
		for r := 1; r <= len(headers); r++ {
			if r < len(headers) && !startsGroup(headers[r], headers[r-1], headers[start], idleGap, maxSpan) {
				continue
			}
			groups = append(groups, toVersion(lineage.Lineage, headers, start, r))
			start = r
		}
		for left, right := 0, len(groups)-1; left < right; left, right = left+1, right-1 {
			groups[left], groups[right] = groups[right], groups[left]
		}
		versions = append(versions, groups...)
		versions = append(versions, Version{
			Lineage: lineage.Lineage, StartedAt: lineage.CreatedAt, SavedAt: lineage.CreatedAt, Actors: []string{},
		})
	}
	return versions
}

// startsGroup: the store clock is wall time, so a negative gap passes no
// limit, which counts it as 0.
func startsGroup(record, previous, first journal.RecordHeader, idleGap, maxSpan time.Duration) bool {
	return record.CommittedAt.Sub(previous.CommittedAt) > idleGap ||
		record.CommittedAt.Sub(first.CommittedAt) >= maxSpan
}

func toVersion(lineage string, headers []journal.RecordHeader, start, end int) Version {
	actors := []string{}
	for r := start; r < end; r++ {
		actor := headers[r].ActorID
		if actor == nil {
			continue
		}
		seen := false
		for _, have := range actors {
			if have == *actor {
				seen = true
				break
			}
		}
		if !seen {
			actors = append(actors, *actor)
		}
	}
	startedAt, savedAt := headers[start].CommittedAt, headers[end-1].CommittedAt
	return Version{
		Lineage:   lineage,
		Sequence:  headers[end-1].Sequence,
		StartedAt: &startedAt,
		SavedAt:   &savedAt,
		Actors:    actors,
	}
}

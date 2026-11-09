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
	// Noted: the list was read with a record notes store. ActorKinds then
	// holds each actor's first note, in Actors order, skipping actors that
	// have none.
	Noted      bool
	ActorKinds []ActorKind
}

// ActorKind is CollabActorKind: one actor of a version and the note of its
// first record there.
type ActorKind struct {
	ID   string
	Note RecordNote
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
	return GroupVersionsBy(lineagesOldestFirst, idleGap, maxSpan, false, nil)
}

// GroupVersionsBy is GroupVersions where byActor also starts a group when the
// actor changes, and noteOf, when not nil, gives each version its actor kinds.
func GroupVersionsBy(lineagesOldestFirst []LineageHeaders, idleGap, maxSpan time.Duration, byActor bool,
	noteOf func(lineage string, sequence uint64) *RecordNote) []Version {
	versions := []Version{}
	for i := len(lineagesOldestFirst) - 1; i >= 0; i-- {
		lineage, headers := lineagesOldestFirst[i].Lineage, lineagesOldestFirst[i].Headers
		var groups []Version
		start := 0
		for r := 1; r <= len(headers); r++ {
			if r < len(headers) && !startsGroup(headers[r], headers[r-1], headers[start], idleGap, maxSpan) &&
				!(byActor && !sameActor(headers[r].ActorID, headers[r-1].ActorID)) {
				continue
			}
			groups = append(groups, toVersion(lineage.Lineage, headers, start, r, noteOf))
			start = r
		}
		for left, right := 0, len(groups)-1; left < right; left, right = left+1, right-1 {
			groups[left], groups[right] = groups[right], groups[left]
		}
		versions = append(versions, groups...)
		versions = append(versions, Version{
			Lineage: lineage.Lineage, StartedAt: lineage.CreatedAt, SavedAt: lineage.CreatedAt, Actors: []string{},
			Noted: noteOf != nil, ActorKinds: noKinds(noteOf != nil),
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

func noKinds(noted bool) []ActorKind {
	if noted {
		return []ActorKind{}
	}
	return nil
}

// sameActor: no actor equals no actor, and "" is an actor.
func sameActor(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func toVersion(lineage string, headers []journal.RecordHeader, start, end int,
	noteOf func(lineage string, sequence uint64) *RecordNote) Version {
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
	var kinds []ActorKind
	if noteOf != nil {
		kinds = []ActorKind{}
		for _, actor := range actors {
			for r := start; r < end; r++ {
				if headers[r].ActorID == nil || *headers[r].ActorID != actor {
					continue
				}
				if note := noteOf(lineage, headers[r].Sequence); note != nil {
					kinds = append(kinds, ActorKind{ID: actor, Note: *note})
					break
				}
			}
		}
	}
	startedAt, savedAt := headers[start].CommittedAt, headers[end-1].CommittedAt
	return Version{
		Lineage:    lineage,
		Sequence:   headers[end-1].Sequence,
		StartedAt:  &startedAt,
		SavedAt:    &savedAt,
		Actors:     actors,
		Noted:      noteOf != nil,
		ActorKinds: kinds,
	}
}

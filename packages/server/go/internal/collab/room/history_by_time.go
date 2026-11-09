package room

import (
	"context"
	"time"
)

// HistoryAt is the point a time reads.
type HistoryAt struct {
	Status HistoryStatus
	Point  *HistoryPoint
}

// RangeRecord is one record's edits in a changes-by-time answer.
type RangeRecord struct {
	Lineage string
	RecordChanges
}

// HistoryRange is the changes-by-time answer, newest first. Truncated:
// older records in the range were left out.
type HistoryRange struct {
	Status    HistoryStatus
	Records   []RangeRecord
	Truncated bool
}

// readTimeline is every lineage, oldest first, with its record headers.
func (m *Manager) readTimeline(ctx context.Context, docID string) ([]LineageHeaders, HistoryStatus, error) {
	history, ok := m.history()
	if !ok {
		return nil, HistoryNone, nil
	}
	if purged, err := m.isPurged(ctx, history, docID); err != nil || purged {
		return nil, HistoryPurged, err
	}
	lineages, err := history.ListLineages(ctx, docID)
	var out []LineageHeaders
	if err == nil {
		for _, lineage := range lineages {
			entry := LineageHeaders{Lineage: lineage}
			for header, readErr := range history.ReadHeaders(ctx, docID, lineage.Lineage) {
				if readErr != nil {
					err = readErr
					break
				}
				entry.Headers = append(entry.Headers, header)
			}
			if err != nil {
				break
			}
			out = append(out, entry)
		}
	}
	if err != nil {
		if isCorrupt(err) {
			m.logf(`collab: the history of "` + docID + `" could not be read: ` + err.Error())
			return nil, HistoryCorrupt, nil
		}
		return nil, 0, err
	}
	// A purge that raced the reads leaves them empty.
	if purged, err := m.isPurged(ctx, history, docID); err != nil || purged {
		return nil, HistoryPurged, err
	}
	return out, HistoryReady, nil
}

// At is the newest point at or before at. NotFound when the document's
// history starts later.
func (m *Manager) At(ctx context.Context, docID string, at time.Time) (HistoryAt, error) {
	lineages, status, err := m.readTimeline(ctx, docID)
	if err != nil || status != HistoryReady {
		return HistoryAt{Status: status}, err
	}
	point := ResolveAt(lineages, at)
	if point == nil {
		return HistoryAt{Status: HistoryNotFound}, nil
	}
	return HistoryAt{Status: HistoryReady, Point: point}, nil
}

// ChangesBetween is the edits of each record committed in [from, to),
// older than before when given, newest first across lineages. Each lineage
// replays on its own, under the same caps as Changes.
func (m *Manager) ChangesBetween(ctx context.Context, docID string, from, to time.Time, before *HistoryPoint,
	maxRecords int, maxBytes int64) (HistoryRange, error) {
	lineages, status, err := m.readTimeline(ctx, docID)
	if err != nil || status != HistoryReady {
		return HistoryRange{Status: status}, err
	}
	selection := SelectRange(lineages, from, to, before, maxRecords)
	if selection.Status != HistoryReady {
		return HistoryRange{Status: selection.Status}, nil
	}
	out := HistoryRange{Status: HistoryReady, Records: []RangeRecord{}, Truncated: selection.Truncated}
	for start := 0; start < len(selection.Records); {
		lineage := selection.Records[start].Lineage
		end := start
		picked := map[uint64]bool{}
		for end < len(selection.Records) && selection.Records[end].Lineage == lineage {
			picked[selection.Records[end].Sequence] = true
			end++
		}
		through, oldest := selection.Records[start].Sequence, selection.Records[end-1].Sequence
		result, err := m.Changes(ctx, docID, lineage, through, oldest-1, maxRecords, maxBytes)
		if err != nil || result.Status != HistoryReady {
			return HistoryRange{Status: result.Status}, err
		}
		for i := len(result.Changes) - 1; i >= 0; i-- {
			if picked[result.Changes[i].Sequence] {
				out.Records = append(out.Records, RangeRecord{Lineage: lineage, RecordChanges: result.Changes[i]})
			}
		}
		// Older records were dropped inside this lineage: anything older still is past the cut.
		if result.Truncated {
			out.Truncated = true
			break
		}
		start = end
	}
	return out, nil
}

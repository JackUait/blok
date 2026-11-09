package room

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/docendpoint"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

// HistoryStatus is CollabHistoryStatus.
type HistoryStatus int

const (
	HistoryReady HistoryStatus = iota
	// HistoryNone: no journal, or one without history reads.
	HistoryNone
	HistoryNotFound
	HistoryPurged
	// HistoryUnavailable: a converter limit a retry may pass.
	HistoryUnavailable
	HistoryExportFailed
	HistoryCorrupt
)

const (
	// MaxChangeRecords and MaxChangeBytes bound one changes answer; the
	// newest records are kept.
	MaxChangeRecords = 200
	MaxChangeBytes   = 4 * 1024 * 1024
)

// HistoryList is CollabHistoryListResult.
type HistoryList struct {
	Status   HistoryStatus
	Lineages []journal.LineageInfo
	Versions []Version
}

// errCorrupt marks a store or replay failure the history answers 500 for.
type corruptError struct{ err error }

func (e *corruptError) Error() string { return e.err.Error() }
func (e *corruptError) Unwrap() error { return e.err }

func isCorrupt(err error) bool {
	var invalid *journal.InvalidDataError
	var replay *convert.ReplayError
	var corrupt *corruptError
	return errors.As(err, &invalid) || errors.As(err, &replay) || errors.As(err, &corrupt)
}

func (m *Manager) history() (HistoryStore, bool) {
	history, ok := m.operations.(HistoryStore)
	return history, ok && m.operations != nil
}

// HasHistory: the journal keeps versions.
func (m *Manager) HasHistory() bool {
	_, ok := m.history()
	return ok
}

func (m *Manager) isPurged(ctx context.Context, history HistoryStore, docID string) (bool, error) {
	if m.isPurging(docID) {
		return true, nil
	}
	return history.IsPurged(ctx, docID)
}

// History lists every lineage and its versions newest first. group > 0
// replaces both default grouping limits.
func (m *Manager) History(ctx context.Context, docID string, group time.Duration) (HistoryList, error) {
	history, ok := m.history()
	if !ok {
		return HistoryList{Status: HistoryNone}, nil
	}
	if purged, err := m.isPurged(ctx, history, docID); err != nil || purged {
		return HistoryList{Status: HistoryPurged}, err
	}
	lineages, err := history.ListLineages(ctx, docID)
	var withHeaders []LineageHeaders
	if err == nil {
		for _, lineage := range lineages {
			var headers []journal.RecordHeader
			for header, readErr := range history.ReadHeaders(ctx, docID, lineage.Lineage) {
				if readErr != nil {
					err = readErr
					break
				}
				headers = append(headers, header)
			}
			if err != nil {
				break
			}
			withHeaders = append(withHeaders, LineageHeaders{lineage, headers})
		}
	}
	if err != nil {
		if isCorrupt(err) {
			m.logf(`collab: the history of "` + docID + `" could not be read: ` + err.Error())
			return HistoryList{Status: HistoryCorrupt}, nil
		}
		return HistoryList{}, err
	}
	if purged, err := m.isPurged(ctx, history, docID); err != nil || purged {
		return HistoryList{Status: HistoryPurged}, err
	}
	idleGap, maxSpan := timelineIdleGap, timelineMaxSpan
	if group > 0 {
		idleGap, maxSpan = group, group
	}
	return HistoryList{Status: HistoryReady, Lineages: lineages, Versions: GroupVersions(withHeaders, idleGap, maxSpan)}, nil
}

type point struct {
	status HistoryStatus
	output *jsjson.Object
	time   *time.Time
	doc    *yjs.Doc
}

// readPoint rebuilds and exports one point. Its bounds come from the
// headers: a record read stops early without saying so.
func (m *Manager) readPoint(ctx context.Context, docID, lineage string, sequence uint64) (point, error) {
	history, ok := m.history()
	if !ok {
		return point{status: HistoryNone}, nil
	}
	if purged, err := m.isPurged(ctx, history, docID); err != nil || purged {
		return point{status: HistoryPurged}, err
	}
	replayed, at, found, err := m.replayPoint(ctx, history, docID, lineage, sequence)
	if err != nil {
		if isCorrupt(err) {
			m.logf(`collab: version ` + itoa64(sequence) + ` of lineage ` + lineage + ` of "` + docID + `" could not be rebuilt: ` + err.Error())
			return point{status: HistoryCorrupt}, nil
		}
		return point{}, err
	}
	if !found {
		if purged, err := m.isPurged(ctx, history, docID); err != nil || purged {
			return point{status: HistoryPurged}, err
		}
		return point{status: HistoryNotFound}, nil
	}
	output, err := m.converter.Export(ctx, replayed)
	if err != nil {
		if isTransient(err) {
			return point{status: HistoryUnavailable}, nil
		}
		if isCancellation(err) {
			return point{}, err
		}
		m.logf(`collab: version ` + itoa64(sequence) + ` of lineage ` + lineage + ` of "` + docID + `" could not be exported: ` + err.Error())
		return point{status: HistoryExportFailed}, nil
	}
	return point{status: HistoryReady, output: output, time: at, doc: replayed}, nil
}

func (m *Manager) replayPoint(ctx context.Context, history HistoryStore, docID, lineage string, sequence uint64) (*yjs.Doc, *time.Time, bool, error) {
	lineages, err := history.ListLineages(ctx, docID)
	if err != nil {
		return nil, nil, false, err
	}
	var info *journal.LineageInfo
	for i := range lineages {
		if lineages[i].Lineage == lineage {
			info = &lineages[i]
			break
		}
	}
	if info == nil {
		return nil, nil, false, nil
	}
	at := info.CreatedAt
	found := sequence == 0
	if sequence > 0 {
		for header, readErr := range history.ReadHeaders(ctx, docID, lineage) {
			if readErr != nil {
				return nil, nil, false, readErr
			}
			if header.Sequence >= sequence {
				found = header.Sequence == sequence
				committed := header.CommittedAt
				at = &committed
				break
			}
		}
	}
	if !found {
		return nil, nil, false, nil
	}
	baseline, ok, err := history.ReadBaseline(ctx, docID, lineage)
	if err != nil || !ok {
		return nil, nil, false, err
	}
	replayed, err := convert.BuildReplay(ctx, baseline, history.ReadRecords(ctx, docID, lineage, sequence))
	if err != nil {
		return nil, nil, false, err
	}
	return replayed, at, true, nil
}

// HistoryRead is CollabHistoryReadResult.
type HistoryRead struct {
	Status HistoryStatus
	JSON   []byte
}

// ReadVersion is one point as OutputData JSON, read without the room. It
// carries the point's own time, and the page maps beside the title and icon.
func (m *Manager) ReadVersion(ctx context.Context, docID, lineage string, sequence uint64) (HistoryRead, error) {
	p, err := m.readPoint(ctx, docID, lineage, sequence)
	if err != nil || p.status != HistoryReady {
		return HistoryRead{Status: p.status}, err
	}
	output := withoutKey(p.output, "time")
	if p.time != nil {
		output = withKeyAt(p.output, "time", p.time.UnixMilli())
	}
	for _, plain := range convert.PlainPageMaps(p.doc, map[string]bool{"title": true, "icon": true}) {
		output.Set(jsjson.FromString(plain.Name), plain.Map)
	}
	json, err := docendpoint.Serialize(output)
	if err != nil {
		return HistoryRead{}, err
	}
	return HistoryRead{Status: HistoryReady, JSON: json}, nil
}

// withKeyAt sets key in place when present, else at the end, as JsonObject's
// indexer does.
func withKeyAt(object *jsjson.Object, key string, value any) *jsjson.Object {
	object.Set(jsjson.FromString(key), value)
	return object
}

// withoutKey is JsonObject.Remove.
func withoutKey(object *jsjson.Object, key string) *jsjson.Object {
	if _, ok := object.Get(jsjson.FromString(key)); !ok {
		return object
	}
	out := &jsjson.Object{}
	for _, member := range object.Members() {
		if member.Key.String() != key {
			out.Set(member.Key, member.Value)
		}
	}
	return out
}

// HistoryChanges is CollabHistoryChangesResult.
type HistoryChanges struct {
	Status    HistoryStatus
	Changes   []RecordChanges
	Truncated bool
}

// Changes is the edits of each record in (since, sequence] of one lineage,
// read without the room. The replay always starts at the baseline.
func (m *Manager) Changes(ctx context.Context, docID, lineage string, sequence, since uint64, maxRecords int, maxBytes int64) (HistoryChanges, error) {
	history, ok := m.history()
	if !ok {
		return HistoryChanges{Status: HistoryNone}, nil
	}
	if purged, err := m.isPurged(ctx, history, docID); err != nil || purged {
		return HistoryChanges{Status: HistoryPurged}, err
	}
	notFound := func() (HistoryChanges, error) {
		if purged, err := m.isPurged(ctx, history, docID); err != nil || purged {
			return HistoryChanges{Status: HistoryPurged}, err
		}
		return HistoryChanges{Status: HistoryNotFound}, nil
	}
	changes, truncated, found, err := m.collectChanges(ctx, history, docID, lineage, sequence, since, maxRecords, maxBytes)
	if err != nil {
		var export *ChangesExportError
		switch {
		case isCorrupt(err):
			m.logf(`collab: the changes through ` + itoa64(sequence) + ` of lineage ` + lineage + ` of "` + docID + `" could not be rebuilt: ` + err.Error())
			return HistoryChanges{Status: HistoryCorrupt}, nil
		case isTransient(err):
			return HistoryChanges{Status: HistoryUnavailable}, nil
		case errors.As(err, &export):
			m.logf(`collab: the changes through ` + itoa64(sequence) + ` of lineage ` + lineage + ` of "` + docID + `" could not be exported: ` + err.Error())
			return HistoryChanges{Status: HistoryExportFailed}, nil
		}
		return HistoryChanges{}, err
	}
	if !found {
		return notFound()
	}
	if purged, err := m.isPurged(ctx, history, docID); err != nil || purged {
		return HistoryChanges{Status: HistoryPurged}, err
	}
	return HistoryChanges{Status: HistoryReady, Changes: changes, Truncated: truncated}, nil
}

func (m *Manager) collectChanges(ctx context.Context, history HistoryStore, docID, lineage string, sequence, since uint64,
	maxRecords int, maxBytes int64) ([]RecordChanges, bool, bool, error) {
	lineages, err := history.ListLineages(ctx, docID)
	if err != nil {
		return nil, false, false, err
	}
	known := false
	for _, entry := range lineages {
		if entry.Lineage == lineage {
			known = true
			break
		}
	}
	found := known && sequence == 0
	var firstBefore uint64
	var window []uint64
	if known && sequence > 0 {
		for header, readErr := range history.ReadHeaders(ctx, docID, lineage) {
			if readErr != nil {
				return nil, false, false, readErr
			}
			if header.Sequence > sequence {
				break
			}
			if header.Sequence <= since {
				firstBefore = header.Sequence
			} else {
				window = append(window, header.Sequence)
			}
			if header.Sequence == sequence {
				found = true
				break
			}
		}
	}
	if !found {
		return nil, false, false, nil
	}
	truncated := false
	if len(window) > maxRecords {
		firstBefore = window[len(window)-maxRecords-1]
		window = window[len(window)-maxRecords:]
		truncated = true
	}
	changes := []RecordChanges{}
	if len(window) > 0 {
		baseline, ok, err := history.ReadBaseline(ctx, docID, lineage)
		if err != nil {
			return nil, false, false, err
		}
		if !ok {
			return nil, false, false, nil
		}
		converter, ok := m.converter.(HistoryConverter)
		if !ok {
			return nil, false, false, errors.New("collab: the converter cannot replay changes")
		}
		changes, err = ReplayChanges(ctx, baseline, history.ReadRecords(ctx, docID, lineage, sequence), firstBefore, converter, maxBytes)
		if err != nil {
			return nil, false, false, err
		}
		// The replay drops the oldest records past the byte budget; what is
		// left is the window's tail.
		tail := window[len(window)-min(len(changes), len(window)):]
		if len(changes) == 0 || len(changes) > len(window) || !sameSequences(changes, tail) {
			return nil, false, false, &corruptError{errors.New("collab: the records do not match their headers.")}
		}
		truncated = truncated || len(changes) < len(window)
	}
	return changes, truncated, true, nil
}

func sameSequences(changes []RecordChanges, window []uint64) bool {
	if len(changes) != len(window) {
		return false
	}
	for i, change := range changes {
		if change.Sequence != window[i] {
			return false
		}
	}
	return true
}

// DeleteLineage removes one superseded lineage.
func (m *Manager) DeleteLineage(ctx context.Context, docID, lineage string) (HistoryStatus, journal.LineageDeleteOutcome, error) {
	history, ok := m.history()
	if !ok {
		return HistoryNone, 0, nil
	}
	if purged, err := m.isPurged(ctx, history, docID); err != nil || purged {
		return HistoryPurged, journal.LineagePurged, err
	}
	outcome, err := history.DeleteLineage(ctx, docID, lineage)
	if err != nil {
		return 0, 0, err
	}
	if outcome == journal.LineagePurged || m.isPurging(docID) {
		return HistoryPurged, journal.LineagePurged, nil
	}
	return HistoryReady, outcome, nil
}

var errRestorePointMissing = errors.New("collab: the restore point is gone")

// Restore makes the live doc equal one point, as one journalled edit planned
// inside the lane after the duplicate and precondition checks.
func (m *Manager) Restore(ctx context.Context, docID, lineage string, sequence uint64, operationID, actorID string,
	expect *Precondition) (HistoryStatus, *EditResult, error) {
	status, edit, _, err := m.RestoreGuarded(ctx, docID, lineage, sequence, operationID, actorID, expect, nil)
	return status, edit, err
}

var errRestoreGuarded = errors.New("collab: the restore needs confirmation")

// RestoreGuarded is Restore with the guards enforced when confirmed is not
// nil: a guard whose kind it lacks refuses the restore, which then changes
// nothing and answers the guards with a nil edit. The check runs in the
// lane after the duplicate check, so a refusal consumes no key and a
// committed retry still gets its receipt.
func (m *Manager) RestoreGuarded(ctx context.Context, docID, lineage string, sequence uint64, operationID, actorID string,
	expect *Precondition, confirmed map[string]bool) (HistoryStatus, *EditResult, []RestoreGuard, error) {
	p, err := m.readPoint(ctx, docID, lineage, sequence)
	if err != nil {
		return 0, nil, nil, err
	}
	// A missing point still goes to the room: a retry whose lineage was
	// deleted since gets its first receipt from the duplicate check.
	if p.status != HistoryReady && p.status != HistoryNotFound {
		return p.status, nil, nil, nil
	}
	var refused []RestoreGuard
	var target []any
	if p.output != nil {
		if blocks, ok := p.output.Get(jsjson.FromString("blocks")); ok {
			target, _ = blocks.([]any)
		}
	}
	var targetMaps []convert.PageMap
	if p.doc != nil {
		targetMaps = convert.ReadPageMaps(p.doc)
	}
	// The request, never the plan: a retry plans against a doc that moved.
	digest := convert.RestoreDigest(lineage, sequence)
	edit, err := m.editInRoom(docID, func(r *Room) (*EditResult, error) {
		return r.edit(ctx, func(ctx context.Context, doc *yjs.Doc) ([]convert.EditOp, error) {
			if p.status == HistoryNotFound || p.doc == nil {
				return nil, errRestorePointMissing
			}
			structure := convert.DescribeStructure(doc)
			exported, err := m.converter.Export(ctx, doc)
			if err != nil {
				return nil, err
			}
			var current []any
			if blocks, ok := exported.Get(jsjson.FromString("blocks")); ok {
				current, _ = blocks.([]any)
			}
			if confirmed != nil {
				guards := RestoreGuards(current, target)
				for _, guard := range guards {
					if !confirmed[guard.Kind] {
						refused = guards
						return nil, errRestoreGuarded
					}
				}
			}
			return PlanRestore(current, structure, target, convert.ReadPageMaps(doc), targetMaps), nil
		}, true, operationID, digest, actorID, expect, nil)
	})
	if errors.Is(err, errRestorePointMissing) {
		return HistoryNotFound, nil, nil, nil
	}
	if errors.Is(err, errRestoreGuarded) {
		return HistoryReady, nil, refused, nil
	}
	if err != nil {
		return 0, nil, nil, err
	}
	if edit.Status == EditApplied {
		m.documentReplaced(docID)
	}
	return HistoryReady, &edit, nil, nil
}

func itoa64(n uint64) string { return strconv.FormatUint(n, 10) }

// String is the C# CollabHistoryStatus name, which agent answers print.
func (s HistoryStatus) String() string {
	names := [...]string{"Ready", "NoHistory", "NotFound", "Purged", "Unavailable", "ExportFailed", "Corrupt"}
	if int(s) < len(names) && s >= 0 {
		return names[s]
	}
	return strconv.Itoa(int(s))
}

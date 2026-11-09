package collabhttp

import (
	"net/http"
	"strconv"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/auth"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/docendpoint"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/room"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/synchttp"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/route"
)

const (
	historyLineageHeader  = "Blok-History-Lineage"
	historySequenceHeader = "Blok-History-Sequence"
	noSuchVersion         = "no such version\n"
	// changesEnvelopeBytes is {"changes":[ and ],"truncated":true}.
	changesEnvelopeBytes = 32
)

type admitted struct {
	doc        string
	user       auth.User
	hasUser    bool
	ticketUser string
	rooms      *room.Manager
}

// admitHistory sends no-store first: versions are document content behind
// an access check, whatever the answer.
func (h *Handlers) admitHistory(w http.ResponseWriter, r *http.Request, write bool) (*admitted, bool) {
	w.Header().Set("Cache-Control", "no-store")
	doc, user, hasUser, ok := h.admit(w, r, write)
	if !ok {
		return nil, false
	}
	manager, ok := h.manager(w)
	if !ok {
		return nil, false
	}
	a := &admitted{doc: doc, user: user, hasUser: hasUser, rooms: manager}
	if h.config.TicketMode {
		a.ticketUser = user.ID
	}
	return a, true
}

// HistoryList is GET /sync/{doc}/history.
func (h *Handlers) HistoryList(w http.ResponseWriter, r *http.Request) {
	a, ok := h.admitHistory(w, r, false)
	if !ok {
		return
	}
	minutes, ok := queryNumber(r, "group")
	if !ok || (minutes != nil && *minutes != 1 && *minutes != 15 && *minutes != 60) {
		synchttp.Refuse(w, http.StatusBadRequest, "group must be 1, 15 or 60\n")
		return
	}
	var group time.Duration
	if minutes != nil {
		group = time.Duration(*minutes) * time.Minute
	}
	result, err := a.rooms.History(r.Context(), a.doc, group)
	if err != nil {
		failed(w, r.Context())
		return
	}
	if result.Status != room.HistoryReady {
		h.refuseHistory(w, a, result.Status)
		return
	}
	body := []byte(`{"lineages":[`)
	for i, lineage := range result.Lineages {
		if i > 0 {
			body = append(body, ',')
		}
		body = append(body, `{"lineage":`...)
		body = jsjson.AppendQuoted(body, jsjson.FromString(lineage.Lineage))
		body = append(body, `,"epoch":`...)
		body = strconv.AppendInt(body, lineage.Epoch, 10)
		body = append(body, `,"format":`...)
		body = strconv.AppendInt(body, int64(lineage.Format), 10)
		body = append(body, `,"createdAt":`...)
		body = appendMillis(body, lineage.CreatedAt)
		body = append(body, `,"current":`...)
		body = strconv.AppendBool(body, lineage.Current)
		body = append(body, '}')
	}
	body = append(body, `],"versions":[`...)
	for i, version := range result.Versions {
		if i > 0 {
			body = append(body, ',')
		}
		body = append(body, `{"lineage":`...)
		body = jsjson.AppendQuoted(body, jsjson.FromString(version.Lineage))
		body = append(body, `,"sequence":`...)
		body = strconv.AppendUint(body, version.Sequence, 10)
		body = append(body, `,"startedAt":`...)
		body = appendMillis(body, version.StartedAt)
		body = append(body, `,"savedAt":`...)
		body = appendMillis(body, version.SavedAt)
		body = append(body, `,"actors":[`...)
		for j, actor := range version.Actors {
			if j > 0 {
				body = append(body, ',')
			}
			body = jsjson.AppendQuoted(body, jsjson.FromString(actor))
		}
		body = append(body, "]}"...)
	}
	body = append(body, "]}"...)
	writeJSON(w, body)
}

func appendMillis(body []byte, at *time.Time) []byte {
	if at == nil {
		return append(body, "null"...)
	}
	return strconv.AppendInt(body, at.UnixMilli(), 10)
}

func writeJSON(w http.ResponseWriter, body []byte) {
	w.Header().Set("Content-Type", "application/json")
	route.StartStream(w, http.StatusOK)
	_, _ = w.Write(body)
}

// HistoryRead is GET /sync/{doc}/history/{lineage}/{sequence}.
func (h *Handlers) HistoryRead(w http.ResponseWriter, r *http.Request) {
	a, ok := h.admitHistory(w, r, false)
	if !ok {
		return
	}
	lineage, sequence, ok := historyPoint(w, r)
	if !ok {
		return
	}
	result, err := a.rooms.ReadVersion(r.Context(), a.doc, lineage, sequence)
	if err != nil {
		failed(w, r.Context())
		return
	}
	if result.Status != room.HistoryReady {
		h.refuseHistory(w, a, result.Status)
		return
	}
	writeHistoryHead(w, lineage, sequence)
	writeJSON(w, result.JSON)
}

// HistoryChanges is GET .../changes: the edits of each record in
// (since, sequence]. The client names the previous version's sequence.
func (h *Handlers) HistoryChanges(w http.ResponseWriter, r *http.Request) {
	a, ok := h.admitHistory(w, r, false)
	if !ok {
		return
	}
	lineage, sequence, ok := historyPoint(w, r)
	if !ok {
		return
	}
	since, ok := queryNumber(r, "since")
	if !ok || (since != nil && *since > sequence) {
		synchttp.Refuse(w, http.StatusBadRequest, "since must be a whole number no greater than the sequence\n")
		return
	}
	detail, ok := queryDetail(r)
	if !ok {
		synchttp.Refuse(w, http.StatusBadRequest, badDetail)
		return
	}
	var from uint64
	if since != nil {
		from = *since
	}
	result, err := a.rooms.Changes(r.Context(), a.doc, lineage, sequence, from, room.MaxChangeRecords, room.MaxChangeBytes)
	if err != nil {
		failed(w, r.Context())
		return
	}
	if result.Status != room.HistoryReady {
		h.refuseHistory(w, a, result.Status)
		return
	}
	// Rows are measured newest first; the newest always goes out.
	var rows [][]byte
	size := int64(changesEnvelopeBytes + olderEndBytes)
	truncated := result.Truncated
	for index := len(result.Changes) - 1; index >= 0; index-- {
		row, err := changeRow(result.Changes[index], detail)
		if err != nil {
			failed(w, r.Context())
			return
		}
		if len(rows) > 0 && size+int64(len(row))+1 > room.MaxChangeBytes {
			truncated = true
			break
		}
		rows = append(rows, row)
		size += int64(len(row)) + 1
	}
	writeHistoryHead(w, lineage, sequence)
	body := []byte(`{"changes":[`)
	for index := len(rows) - 1; index >= 0; index-- {
		if index < len(rows)-1 {
			body = append(body, ',')
		}
		body = append(body, rows[index]...)
	}
	body = append(body, ']')
	if truncated {
		oldest := result.Changes[len(result.Changes)-len(rows)]
		body = appendOlderEnd(body, lineage, oldest.Sequence, oldest.CommittedAt)
	}
	writeJSON(w, append(body, '}'))
}

var changeKinds = map[room.BlockChangeKind]string{
	room.BlockAdded: "added", room.BlockRemoved: "removed", room.BlockChanged: "changed", room.BlockMoved: "moved",
}

// changeRow writes one row. With detail, a changed database or row also
// carries what changed inside its data.
func changeRow(record room.RecordChanges, detail bool) ([]byte, error) {
	row := []byte(`{"sequence":`)
	row = strconv.AppendUint(row, record.Sequence, 10)
	row = append(row, `,"committedAt":`...)
	row = strconv.AppendInt(row, record.CommittedAt.UnixMilli(), 10)
	row = append(row, `,"actor":`...)
	if record.ActorID == nil {
		row = append(row, "null"...)
	} else {
		row = jsjson.AppendQuoted(row, jsjson.FromString(*record.ActorID))
	}
	row = append(row, `,"blocks":[`...)
	for i, change := range record.Blocks {
		if i > 0 {
			row = append(row, ',')
		}
		row = append(row, `{"id":`...)
		row = jsjson.AppendQuoted(row, change.ID)
		row = append(row, `,"type":`...)
		if change.Type == nil {
			row = append(row, "null"...)
		} else {
			row = jsjson.AppendQuoted(row, *change.Type)
		}
		row = append(row, `,"kind":"`...)
		row = append(row, changeKinds[change.Kind]...)
		row = append(row, '"')
		for _, side := range []struct {
			name  string
			block *jsjson.Object
		}{{"before", change.Before}, {"after", change.After}} {
			if side.block == nil {
				continue
			}
			encoded, err := docendpoint.Serialize(side.block)
			if err != nil {
				return nil, err
			}
			row = append(row, `,"`+side.name+`":`...)
			row = append(row, encoded...)
		}
		if detail && change.Kind == room.BlockChanged {
			fields := room.DescribeDatabaseChange(change.Type, change.Before, change.After)
			if fields.Len() > 0 {
				encoded, err := docendpoint.Serialize(fields)
				if err != nil {
					return nil, err
				}
				row = append(append(row, ','), encoded[1:len(encoded)-1]...)
			}
		}
		row = append(row, '}')
	}
	row = append(row, ']')
	if len(record.Page) > 0 {
		row = append(row, `,"page":[`...)
		for i, key := range record.Page {
			if i > 0 {
				row = append(row, ',')
			}
			row = jsjson.AppendQuoted(row, jsjson.FromString(key))
		}
		row = append(row, ']')
	}
	return append(row, '}'), nil
}

// HistoryDelete is DELETE /sync/{doc}/history/{lineage}.
func (h *Handlers) HistoryDelete(w http.ResponseWriter, r *http.Request) {
	a, ok := h.admitHistory(w, r, true)
	if !ok {
		return
	}
	lineage, ok := historyLineage(w, r)
	if !ok {
		return
	}
	status, outcome, err := a.rooms.DeleteLineage(r.Context(), a.doc, lineage)
	if err != nil {
		failed(w, r.Context())
		return
	}
	if status != room.HistoryReady {
		h.refuseHistory(w, a, status)
		return
	}
	switch outcome {
	case journal.LineageDeletedOutcome:
		w.WriteHeader(http.StatusNoContent)
	case journal.LineageCurrent:
		synchttp.Refuse(w, http.StatusConflict, "the document is on this lineage; it cannot be deleted\n")
	case journal.LineagePurged:
		h.refuseHistory(w, a, room.HistoryPurged)
	default:
		h.refuseHistory(w, a, room.HistoryNotFound)
	}
}

// HistoryRestore is POST .../restore: the key is required, If-Match is
// optional, and it answers like an edit.
func (h *Handlers) HistoryRestore(w http.ResponseWriter, r *http.Request) {
	a, ok := h.admitHistory(w, r, true)
	if !ok {
		return
	}
	lineage, sequence, ok := historyPoint(w, r)
	if !ok {
		return
	}
	keys := r.Header.Values(IdempotencyKeyHeader)
	var operationID string
	if len(keys) == 1 {
		operationID, ok = convert.NormalizeIdempotencyKey(keys[0])
	} else {
		ok = false
	}
	if !ok {
		synchttp.Refuse(w, http.StatusBadRequest, "a valid "+IdempotencyKeyHeader+" header is required\n")
		return
	}
	var expect *room.Precondition
	if values, present := r.Header["If-Match"]; present {
		if expect, ok = parseEntityTag(values); !ok {
			synchttp.Refuse(w, http.StatusBadRequest, "If-Match must be one quoted \"<lineage>:<sequence>\" tag\n")
			return
		}
	}
	actor := synchttp.DeriveActor(a.ticketUser, a.user, a.hasUser)
	status, edit, err := a.rooms.Restore(r.Context(), a.doc, lineage, sequence, operationID, actor, expect)
	if err != nil {
		failed(w, r.Context())
		return
	}
	if status != room.HistoryReady {
		h.refuseHistory(w, a, status)
		return
	}
	WriteEditResult(w, *edit, a.rooms.RetryAfter())
}

// historyPoint is the route's lineage and sequence; a sequence that is not
// a plain unsigned number is refused.
func historyPoint(w http.ResponseWriter, r *http.Request) (string, uint64, bool) {
	lineage, ok := historyLineage(w, r)
	if !ok {
		return "", 0, false
	}
	sequence, ok := parseUnsigned(r.PathValue("sequence"))
	if !ok {
		synchttp.Refuse(w, http.StatusBadRequest, "the sequence must be a whole number\n")
		return "", 0, false
	}
	return lineage, sequence, true
}

// historyLineage: anything not shaped like a lineage is a 404 and never
// reaches the store.
func historyLineage(w http.ResponseWriter, r *http.Request) (string, bool) {
	lineage := r.PathValue("lineage")
	if !workingset.IsLineage(lineage) {
		synchttp.Refuse(w, http.StatusNotFound, noSuchVersion)
		return "", false
	}
	return lineage, true
}

// parseUnsigned is ulong.TryParse with NumberStyles.None: digits only, but
// .NET also skips any NULs after the last digit ("1\x00" is 1).
func parseUnsigned(digits string) (uint64, bool) { return dotnet.ParseUInt64None(digits) }

// queryNumber: absent is nil; a repeated, empty or signed value is false.
// The query is read the ASP.NET way, not with net/url.
func queryNumber(r *http.Request, name string) (*uint64, bool) {
	values := dotnet.QueryAll(r.URL.RawQuery, name)
	if len(values) == 0 {
		return nil, true
	}
	if len(values) != 1 {
		return nil, false
	}
	value, ok := parseUnsigned(values[0])
	if !ok {
		return nil, false
	}
	return &value, true
}

// writeHistoryHead is not Blok-Doc-*: those name the live head.
func writeHistoryHead(w http.ResponseWriter, lineage string, sequence uint64) {
	w.Header().Set(historyLineageHeader, lineage)
	w.Header().Set(historySequenceHeader, strconv.FormatUint(sequence, 10))
	expose(w, historyLineageHeader, historySequenceHeader)
}

func (h *Handlers) refuseHistory(w http.ResponseWriter, a *admitted, status room.HistoryStatus) {
	switch status {
	case room.HistoryNone:
		synchttp.Refuse(w, http.StatusNotImplemented, "history needs a journal that keeps it\n")
	case room.HistoryNotFound:
		synchttp.Refuse(w, http.StatusNotFound, noSuchVersion)
	case room.HistoryPurged:
		synchttp.Refuse(w, http.StatusForbidden, "forbidden\n")
	case room.HistoryUnavailable:
		refuseRetryLater(w, a.rooms.RetryAfter(), "the server ran past its limits exporting this version, retry\n")
	case room.HistoryExportFailed:
		synchttp.Refuse(w, http.StatusInternalServerError, "the version could not be exported\n")
	default:
		if h.config.CorruptLog != nil {
			h.config.CorruptLog(a.doc)
		}
		synchttp.Refuse(w, http.StatusInternalServerError, "a stored version could not be read\n")
	}
}

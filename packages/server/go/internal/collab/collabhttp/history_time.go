package collabhttp

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/room"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/synchttp"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/route"
)

const (
	badTime   = "time must be an ISO 8601 time with an offset\n"
	badRange  = "from and to must be ISO 8601 times with an offset, from no later than to\n"
	badBefore = "before must be one <lineage>:<sequence>\n"
	badDetail = "detail must be properties\n"
	// olderEndBytes is the longest ,"olderEnd":{...} an answer adds.
	olderEndBytes = 125
)

// HistoryAt is GET /sync/{doc}/history/at?time=: the newest point at or
// before the time. A redirect to the point, or the point as JSON when the
// caller accepts JSON.
func (h *Handlers) HistoryAt(w http.ResponseWriter, r *http.Request) {
	a, ok := h.admitHistory(w, r, false)
	if !ok {
		return
	}
	at, ok := queryTime(r, "time")
	if !ok || at == nil {
		synchttp.Refuse(w, http.StatusBadRequest, badTime)
		return
	}
	result, err := a.rooms.At(r.Context(), a.doc, *at)
	if err != nil {
		failed(w, r.Context())
		return
	}
	if result.Status == room.HistoryNotFound {
		w.Header().Set("Content-Type", "application/json")
		route.StartStream(w, http.StatusNotFound)
		_, _ = w.Write([]byte(`{"reason":"not_found"}`))
		return
	}
	if result.Status != room.HistoryReady {
		h.refuseHistory(w, a, result.Status)
		return
	}
	point := result.Point
	writeHistoryHead(w, point.Lineage, point.Sequence)
	if !acceptsJSON(r) {
		// Relative, so it keeps the mount prefix and the doc as sent.
		w.Header().Set("Location", point.Lineage+"/"+strconv.FormatUint(point.Sequence, 10))
		w.Header().Set("Content-Length", "0")
		w.WriteHeader(http.StatusFound)
		return
	}
	writeJSON(w, appendPoint([]byte(nil), point.Lineage, point.Sequence, point.CommittedAt))
}

// HistoryChangesBetween is GET /sync/{doc}/history/changes?from=&to=: each
// record's edits in [from, to), newest first across lineages. The default
// range is the last 24 hours.
func (h *Handlers) HistoryChangesBetween(w http.ResponseWriter, r *http.Request) {
	a, ok := h.admitHistory(w, r, false)
	if !ok {
		return
	}
	from, okFrom := queryTime(r, "from")
	to, okTo := queryTime(r, "to")
	if !okFrom || !okTo {
		synchttp.Refuse(w, http.StatusBadRequest, badRange)
		return
	}
	end := time.Now().UTC()
	if to != nil {
		end = *to
	}
	start := dotnet.TimeFromTicks(max(0, dotnet.Ticks(end)-int64(room.DefaultHistoryRange/100)))
	if from != nil {
		start = *from
	}
	if start.After(end) {
		synchttp.Refuse(w, http.StatusBadRequest, badRange)
		return
	}
	before, ok := queryPoint(r, "before")
	if !ok {
		synchttp.Refuse(w, http.StatusBadRequest, badBefore)
		return
	}
	detail, ok := queryDetail(r)
	if !ok {
		synchttp.Refuse(w, http.StatusBadRequest, badDetail)
		return
	}
	result, err := a.rooms.ChangesBetween(r.Context(), a.doc, start, end, before, room.MaxChangeRecords, room.MaxChangeBytes)
	if err != nil {
		failed(w, r.Context())
		return
	}
	if result.Status != room.HistoryReady {
		h.refuseHistory(w, a, result.Status)
		return
	}
	var rows [][]byte
	size := int64(changesEnvelopeBytes + olderEndBytes)
	truncated := result.Truncated
	for _, record := range result.Records {
		row, err := changeRow(record.RecordChanges, detail)
		if err != nil {
			failed(w, r.Context())
			return
		}
		lineaged := jsjson.AppendQuoted([]byte(`{"lineage":`), jsjson.FromString(record.Lineage))
		row = append(append(lineaged, ','), row[1:]...)
		if len(rows) > 0 && size+int64(len(row))+1 > room.MaxChangeBytes {
			truncated = true
			break
		}
		rows = append(rows, row)
		size += int64(len(row)) + 1
	}
	body := []byte(`{"changes":[`)
	for i, row := range rows {
		if i > 0 {
			body = append(body, ',')
		}
		body = append(body, row...)
	}
	body = append(body, ']')
	if truncated {
		oldest := result.Records[len(rows)-1]
		body = appendOlderEnd(body, oldest.Lineage, oldest.Sequence, oldest.CommittedAt)
	}
	writeJSON(w, append(body, '}'))
}

// appendOlderEnd writes ,"truncated":true,"olderEnd":{...}: the oldest
// record in the answer, so a caller can ask for what is older.
func appendOlderEnd(body []byte, lineage string, sequence uint64, committedAt time.Time) []byte {
	body = append(body, `,"truncated":true,"olderEnd":`...)
	return appendPoint(body, lineage, sequence, &committedAt)
}

func appendPoint(body []byte, lineage string, sequence uint64, at *time.Time) []byte {
	body = jsjson.AppendQuoted(append(body, `{"lineage":`...), jsjson.FromString(lineage))
	body = strconv.AppendUint(append(body, `,"sequence":`...), sequence, 10)
	body = appendMillis(append(body, `,"committedAt":`...), at)
	return append(body, '}')
}

// queryTime: absent is nil; a repeated value or one ParseHistoryTime
// refuses is false.
func queryTime(r *http.Request, name string) (*time.Time, bool) {
	values := dotnet.QueryAll(r.URL.RawQuery, name)
	if len(values) == 0 {
		return nil, true
	}
	if len(values) != 1 {
		return nil, false
	}
	at, ok := room.ParseHistoryTime(values[0])
	if !ok {
		return nil, false
	}
	return &at, true
}

// queryPoint reads <lineage>:<sequence>; absent is nil.
func queryPoint(r *http.Request, name string) (*room.HistoryPoint, bool) {
	values := dotnet.QueryAll(r.URL.RawQuery, name)
	if len(values) == 0 {
		return nil, true
	}
	if len(values) != 1 {
		return nil, false
	}
	lineage, digits, found := strings.Cut(values[0], ":")
	if !found || !workingset.IsLineage(lineage) {
		return nil, false
	}
	sequence, ok := parseUnsigned(digits)
	if !ok {
		return nil, false
	}
	return &room.HistoryPoint{Lineage: lineage, Sequence: sequence}, true
}

// acceptsJSON: some Accept entry is application/json, ignoring case and
// parameters. */* is a redirect: a browser follows it to the version.
func acceptsJSON(r *http.Request) bool {
	for _, value := range r.Header.Values("Accept") {
		for _, entry := range strings.Split(value, ",") {
			mediaType, _, _ := strings.Cut(entry, ";")
			if strings.EqualFold(strings.TrimSpace(mediaType), "application/json") {
				return true
			}
		}
	}
	return false
}

// queryDetail: absent is false; only one detail=properties is true.
func queryDetail(r *http.Request) (bool, bool) {
	values := dotnet.QueryAll(r.URL.RawQuery, "detail")
	if len(values) == 0 {
		return false, true
	}
	return true, len(values) == 1 && values[0] == "properties"
}

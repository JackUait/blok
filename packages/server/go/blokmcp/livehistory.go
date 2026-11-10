package blokmcp

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
)

// The sync server's version history routes for one room, behind the room's
// own ticket: Node's createHttpVersionHistory, read ahead of the batch,
// because the bundle cannot wait on the host mid-batch.

var sequencePattern = regexp.MustCompile(`^\d+$`)

// historyBase is the room URL with /history.
func (r *liveRoom) historyBase() string { return r.url + "/history" }

// historySend sends one history request; a 401 is tried once more with a
// fresh ticket. Call without mu.
func (r *liveRoom) historySend(ctx context.Context, method, url string, header http.Header) (*fetched, error) {
	for fresh := false; ; fresh = true {
		r.mu.Lock()
		refused := r.refusedBy
		r.mu.Unlock()
		if refused != nil {
			return nil, refused
		}
		token, err := r.tickets(fresh)
		if failure, ok := asSurface(err); ok && failure.Code == "FORBIDDEN" {
			// Node's revocable(): a refusal here ends the room as on reconnect.
			r.mu.Lock()
			if r.refusedBy == nil {
				r.refusedBy = err
				r.terminate("forbidden")
			}
			r.mu.Unlock()
		}
		if err != nil {
			return nil, err
		}
		headers := http.Header{"Authorization": {"Bearer " + token}}
		for name, values := range header {
			headers[name] = values
		}
		if r.origin != nil {
			headers["Origin"] = []string{*r.origin}
		}
		answer, err := fetch(ctx, 0, method, url, headers, nil)
		if err != nil {
			// Node's fetch names every network failure "fetch failed".
			return nil, &unreachableError{"The sync server could not be reached: fetch failed"}
		}
		if answer.status == http.StatusUnauthorized && !fresh {
			continue
		}
		return answer, nil
	}
}

// unreachableError: no answer came, so a retry can help (Node's fetch
// error carries retryable: true).
type unreachableError struct{ message string }

func (e *unreachableError) Error() string { return e.message }

// historyFailed is a load's failure as the bundle reads it.
func historyFailed(err error) map[string]any {
	failed := map[string]any{"failed": err.Error()}
	var unreachable *unreachableError
	if errors.As(err, &unreachable) {
		failed["retryable"] = true
	}
	return failed
}

// pointPath is "lineage:sequence" as its route path, or "".
func pointPath(version string) string {
	colon := strings.LastIndexByte(version, ':')
	if colon <= 0 {
		return ""
	}
	lineage, sequence := version[:colon], version[colon+1:]
	if lineage == "." || lineage == ".." || !sequencePattern.MatchString(sequence) {
		return ""
	}
	return encodeURIComponent(lineage) + "/" + sequence
}

func refusedHistory(answer *fetched) map[string]any {
	return map[string]any{
		"failed": fmt.Sprintf("The sync server answered %d: %s", answer.status, strings.TrimSpace(decodeUTF8(answer.body))),
		"status": answer.status,
	}
}

// historyCommands lists the history commands of a batch with their args.
func historyCommands(batch json.RawMessage) []struct {
	Name string
	Args map[string]json.RawMessage
} {
	commands, _ := batchCommands(batch)
	var found []struct {
		Name string
		Args map[string]json.RawMessage
	}
	for _, command := range commands {
		if strings.HasPrefix(command.name, "history.") && command.name != "history.undo" && command.name != "history.redo" {
			found = append(found, struct {
				Name string
				Args map[string]json.RawMessage
			}{command.name, command.args})
		}
	}
	return found
}

// loadVersions reads what a batch's history commands need: the version
// list and the documents they name. Call without mu.
func (r *liveRoom) loadVersions(ctx context.Context, batch json.RawMessage) map[string]any {
	return r.loadVersionsFor(ctx, batch, true)
}

// loadVersionsFor is loadVersions for a handle that can write or not. A
// read-only handle's ticket cannot reach the preview route, so the bundle
// refuses its preview and nothing is asked.
func (r *liveRoom) loadVersionsFor(ctx context.Context, batch json.RawMessage, write bool) map[string]any {
	commands := historyCommands(batch)
	if len(commands) == 0 {
		return nil
	}
	loaded := map[string]any{}
	documents := map[string]json.RawMessage{}
	wantsList := false
	var names []string
	for _, command := range commands {
		switch command.Name {
		case "history.versions", "history.restore":
			wantsList = true
		case "history.previewRestore":
			// A preview asks its own route and reads nothing else.
			if !write {
				continue
			}
			if failed := r.loadPreview(ctx, command.Args, loaded); failed != nil {
				return failed
			}
			continue
		}
		for _, key := range []string{"version", "from", "to"} {
			var name string
			if json.Unmarshal(command.Args[key], &name) == nil && name != "" && !strings.Contains(strings.Join(names, "\x00"), name) {
				names = append(names, name)
			}
		}
	}
	if wantsList {
		group := ""
		for _, command := range commands {
			if command.Name == "history.versions" && len(command.Args["group"]) > 0 {
				group = "?group=" + string(command.Args["group"])
			}
		}
		answer, err := r.historySend(ctx, http.MethodGet, r.historyBase()+group, nil)
		if err != nil {
			return historyFailed(err)
		}
		if answer.status < 200 || answer.status > 299 {
			return refusedHistory(answer)
		}
		versions, err := versionsOf(answer.body)
		if err != nil {
			return map[string]any{"failed": err.Error()}
		}
		loaded["versions"] = versions
	}
	for _, name := range names {
		path := pointPath(name)
		if path == "" {
			documents[name] = json.RawMessage("null")
			continue
		}
		answer, err := r.historySend(ctx, http.MethodGet, r.historyBase()+"/"+path, nil)
		if err != nil {
			return historyFailed(err)
		}
		switch {
		case answer.status == http.StatusNotFound:
			documents[name] = json.RawMessage("null")
		case answer.status < 200 || answer.status > 299:
			return refusedHistory(answer)
		default:
			body := json.RawMessage(decodeUTF8(answer.body))
			if err := assertDocumentShape(body, name); err != nil {
				documents[name] = json.RawMessage("null")
			} else {
				documents[name] = body
			}
		}
	}
	loaded["documents"] = documents
	return loaded
}

// loadPreview posts the preview route for a history.previewRestore and
// keeps its answer under loaded["previews"], null for a 404. Arguments the
// bundle refuses ask nothing. A failure comes back as the load's.
func (r *liveRoom) loadPreview(ctx context.Context, args map[string]json.RawMessage, loaded map[string]any) map[string]any {
	previews, _ := loaded["previews"].(map[string]json.RawMessage)
	if previews == nil {
		previews = map[string]json.RawMessage{}
		loaded["previews"] = previews
	}
	var version string
	if json.Unmarshal(args["version"], &version) != nil || version == "" {
		return nil
	}
	query := ""
	if raw, given := args["databases"]; given {
		var databases string
		if json.Unmarshal(raw, &databases) != nil || (databases != "keep" && databases != "restore") {
			return nil
		}
		query = "?databases=" + databases
	}
	path := pointPath(version)
	if path == "" {
		previews[version] = json.RawMessage("null")
		return nil
	}
	answer, err := r.historySend(ctx, http.MethodPost, r.historyBase()+"/"+path+"/restore/preview"+query, nil)
	if err != nil {
		return historyFailed(err)
	}
	switch {
	case answer.status == http.StatusNotFound:
		previews[version] = json.RawMessage("null")
	case answer.status < 200 || answer.status > 299:
		return refusedHistory(answer)
	case !json.Valid(answer.body):
		return map[string]any{"failed": "The sync server sent a restore preview it could not read."}
	default:
		previews[version] = json.RawMessage(decodeUTF8(answer.body))
	}
	return nil
}

// versionsOf is the server's version list as AgentVersions, newest first.
func versionsOf(body []byte) ([]map[string]any, error) {
	// Maps, not structs: a struct decode would also take "VERSIONS".
	var listing map[string]json.RawMessage
	var listed []json.RawMessage
	if json.Unmarshal(body, &listing) != nil || json.Unmarshal(listing["versions"], &listed) != nil || listed == nil {
		return nil, fmt.Errorf("The sync server sent a version list it could not read.")
	}
	var lineages []json.RawMessage
	_ = json.Unmarshal(listing["lineages"], &lineages)
	current := map[string]bool{}
	for _, raw := range lineages {
		lineage, _ := isRecordJSON(raw)
		var name string
		if string(lineage["current"]) == "true" && json.Unmarshal(lineage["lineage"], &name) == nil {
			current[name] = true
		}
	}
	versions := []map[string]any{}
	for _, raw := range listed {
		entry, ok := isRecordJSON(raw)
		if !ok {
			continue
		}
		var lineage, sequence any
		_ = json.Unmarshal(entry["lineage"], &lineage)
		_ = json.Unmarshal(entry["sequence"], &sequence)
		version := map[string]any{
			"version":   fmt.Sprintf("%v:%v", jsString(lineage), jsString(sequence)),
			"savedAt":   numberOrNull(entry["savedAt"]),
			"startedAt": numberOrNull(entry["startedAt"]),
			"actors":    stringsOf(entry["actors"]),
		}
		if name, ok := lineage.(string); !ok || !current[name] {
			version["beforeReset"] = true
		}
		versions = append(versions, version)
	}
	return versions, nil
}

func jsString(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case float64:
		return strings.TrimSuffix(strings.TrimRight(fmt.Sprintf("%f", v), "0"), ".")
	case nil:
		return "undefined"
	}
	written, _ := json.Marshal(value)
	return string(written)
}

func numberOrNull(raw json.RawMessage) any {
	var number float64
	if json.Unmarshal(raw, &number) == nil && len(raw) > 0 && raw[0] != '"' {
		return json.RawMessage(raw)
	}
	return nil
}

func stringsOf(raw json.RawMessage) []string {
	var items []any
	_ = json.Unmarshal(raw, &items)
	out := []string{}
	for _, item := range items {
		if text, ok := item.(string); ok {
			out = append(out, text)
		}
	}
	return out
}

// restoreOutcome is a restore's answer: "ok", "missing", "stale", or a
// refusal of the given status (0: no answer came).
type restoreOutcome struct {
	kind   string
	status int
	err    error
}

// restoreVersion posts a restore the bundle checked, pinned with If-Match
// to the newest version the agent saw, as Node's does. Call without mu.
func (r *liveRoom) restoreVersion(ctx context.Context, version string, previous *string) restoreOutcome {
	path := pointPath(version)
	if path == "" {
		return restoreOutcome{kind: "missing"}
	}
	header := http.Header{}
	if previous != nil {
		// A tag the server cannot read would restore unpinned.
		if pointPath(*previous) == "" {
			return restoreOutcome{kind: "stale"}
		}
		header["If-Match"] = []string{`"` + *previous + `"`}
	}
	key := make([]byte, 16)
	_, _ = rand.Read(key)
	key[6] = key[6]&0x0f | 0x40
	key[8] = key[8]&0x3f | 0x80
	header["Blok-Idempotency-Key"] = []string{fmt.Sprintf("%x-%x-%x-%x-%x", key[0:4], key[4:6], key[6:8], key[8:10], key[10:16])}
	answer, err := r.historySend(ctx, http.MethodPost, r.historyBase()+"/"+path+"/restore", header)
	if err != nil {
		return restoreOutcome{err: err}
	}
	switch {
	case answer.status == http.StatusNotFound:
		return restoreOutcome{kind: "missing"}
	case answer.status == http.StatusPreconditionFailed:
		return restoreOutcome{kind: "stale"}
	case answer.status < 200 || answer.status > 299:
		return restoreOutcome{status: answer.status, err: fmt.Errorf("The sync server answered %d: %s", answer.status, strings.TrimSpace(decodeUTF8(answer.body)))}
	}
	return restoreOutcome{kind: "ok"}
}

// retryable is Node's isTransient for a restore, which is never asked
// twice: no answer, a 429 or a 5xx other than 500 and 501. Any other
// error, a failed ticket too, is plain and not retryable.
func (o restoreOutcome) retryable() bool {
	var unreachable *unreachableError
	return errors.As(o.err, &unreachable) || o.status == 429 || (o.status >= 502 && o.status <= 599)
}

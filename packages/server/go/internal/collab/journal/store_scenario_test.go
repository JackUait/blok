package journal

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab/collabtest"
	"github.com/JackUait/blok/packages/server/go/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
)

// The scenarios C# CollabJournalStoreCaptureTests ran against its store.
type journalScenarios struct {
	DocID      string `json:"docId"`
	StartTicks string `json:"startTicks"`
	Scenarios  []struct {
		Name           string             `json:"name"`
		MaxUpdateBytes int64              `json:"maxUpdateBytes"`
		Steps          []map[string]any   `json:"steps"`
		Log            []string           `json:"log"`
		Files          map[string]*string `json:"files"`
		Reopen         map[string]any     `json:"reopen"`
	} `json:"scenarios"`
}

func loadJournalScenarios(t *testing.T) journalScenarios {
	t.Helper()
	var fixture journalScenarios
	collabtest.Read(t, "collab-journal/scenarios.json", &fixture)
	if len(fixture.Scenarios) < 40 {
		t.Fatalf("only %d scenarios", len(fixture.Scenarios))
	}
	return fixture
}

// TestTheStoreAnswersEveryScenarioLikeCSharp replays each scenario and checks
// every answer, the log, and that the files left on disk are byte for byte
// the files C# left.
func TestTheStoreAnswersEveryScenarioLikeCSharp(t *testing.T) {
	fixture := loadJournalScenarios(t)
	for _, scenario := range fixture.Scenarios {
		t.Run(scenario.Name, func(t *testing.T) {
			root := t.TempDir()
			runner := newScenarioRunner(t, root, fixture.DocID, fixture.StartTicks, scenario.MaxUpdateBytes)
			for i, step := range scenario.Steps {
				want, hasResult := step["result"]
				got := runner.run(step)
				if hasResult && !sameJSON(t, got, want) {
					t.Fatalf("step %d %v: got %s, want %s", i, step["op"], encodeJSON(t, got), encodeJSON(t, want))
				}
			}
			runner.closeAll()
			if !slices.Equal(runner.logs, scenario.Log) && !(len(runner.logs) == 0 && len(scenario.Log) == 0) {
				t.Errorf("log:\n got %q\nwant %q", runner.logs, scenario.Log)
			}
			got := listFiles(t, root, fixture.DocID)
			for _, path := range slices.Sorted(maps.Keys(scenario.Files)) {
				want := scenario.Files[path]
				have, ok := got[path]
				switch {
				case !ok:
					t.Errorf("%s: missing", path)
				case (want == nil) != (have == nil):
					t.Errorf("%s: directory/file mismatch", path)
				case want != nil && *want != *have:
					t.Errorf("%s:\n got %s\nwant %s", path, *have, *want)
				}
			}
			for path := range got {
				if _, ok := scenario.Files[path]; !ok {
					t.Errorf("%s: written by Go, not by C#", path)
				}
			}
		})
	}
}

// TestTheStoreOpensEveryDirectoryCSharpLeft opens the files each C# scenario
// left with a fresh Go store, and must see what a fresh C# store saw.
func TestTheStoreOpensEveryDirectoryCSharpLeft(t *testing.T) {
	fixture := loadJournalScenarios(t)
	for _, scenario := range fixture.Scenarios {
		t.Run(scenario.Name, func(t *testing.T) {
			root := t.TempDir()
			key := workingset.DocKey(fixture.DocID)
			for _, path := range slices.Sorted(maps.Keys(scenario.Files)) {
				full := filepath.Join(root, filepath.FromSlash(strings.ReplaceAll(path, "{doc}", key)))
				content := scenario.Files[path]
				if content == nil {
					if err := os.MkdirAll(full, 0o700); err != nil {
						t.Fatal(err)
					}
					continue
				}
				if err := os.MkdirAll(filepath.Dir(full), 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(full, collabtest.Hex(t, *content), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			runner := newScenarioRunner(t, root, fixture.DocID, fixture.StartTicks, scenario.MaxUpdateBytes)
			got := runner.call("open", map[string]any{"session": "reopen"})
			runner.closeAll()
			if !sameJSON(t, got, scenario.Reopen) {
				t.Fatalf("got %s, want %s", encodeJSON(t, got), encodeJSON(t, scenario.Reopen))
			}
		})
	}
}

type scenarioRunner struct {
	t         *testing.T
	root      string
	docID     string
	now       time.Time
	store     *Store
	sessions  map[string]*Session
	snapshots map[string][]byte
	logs      []string
}

func newScenarioRunner(t *testing.T, root, docID, startTicks string, maxUpdate int64) *scenarioRunner {
	t.Helper()
	runner := &scenarioRunner{
		t:         t,
		root:      root,
		docID:     docID,
		now:       dotnet.TimeFromTicks(parseInt(t, startTicks)),
		sessions:  map[string]*Session{},
		snapshots: map[string][]byte{},
	}
	store, err := NewStore(root, StoreOptions{
		MaxUpdateBytes: maxUpdate,
		Log:            func(line string) { runner.logs = append(runner.logs, runner.normalise(line)) },
		Now:            func() time.Time { return runner.now },
	})
	if err != nil {
		t.Fatal(err)
	}
	runner.store = store
	return runner
}

func (r *scenarioRunner) normalise(line string) string {
	const held = " is held elsewhere: "
	if cut := strings.Index(line, held); cut >= 0 {
		line = line[:cut+len(held)] + "…"
	}
	line = strings.ReplaceAll(line, r.root, "{root}")
	return strings.ReplaceAll(line, workingset.DocKey(r.docID), "{doc}")
}

func (r *scenarioRunner) path(step map[string]any) string {
	relative := strings.ReplaceAll(step["path"].(string), "{doc}", workingset.DocKey(r.docID))
	return filepath.Join(r.root, filepath.FromSlash(relative))
}

func (r *scenarioRunner) closeAll() {
	for _, session := range r.sessions {
		session.Close()
	}
	clear(r.sessions)
}

func (r *scenarioRunner) must(err error) {
	r.t.Helper()
	if err != nil {
		r.t.Fatal(err)
	}
}

func (r *scenarioRunner) readFile(step map[string]any) []byte {
	data, err := os.ReadFile(r.path(step))
	r.must(err)
	return data
}

func (r *scenarioRunner) run(step map[string]any) any {
	t := r.t
	t.Helper()
	switch op := step["op"].(string); op {
	case "clock":
		r.now = dotnet.TimeFromTicks(parseInt(t, step["ticks"].(string)))
	case "write":
		r.must(os.WriteFile(r.path(step), unhex(t, step["hex"]), 0o600))
	case "appendBytes":
		file, err := os.OpenFile(r.path(step), os.O_WRONLY|os.O_APPEND, 0o600)
		r.must(err)
		_, err = file.Write(unhex(t, step["hex"]))
		r.must(err)
		r.must(file.Close())
	case "delete":
		r.must(os.Remove(r.path(step)))
	case "mkdir":
		r.must(os.MkdirAll(r.path(step), 0o755))
	case "rmdir":
		r.must(os.Remove(r.path(step)))
	case "zero":
		data := r.readFile(step)
		offset, length := int(step["offset"].(float64)), int(step["length"].(float64))
		clear(data[offset : offset+length])
		r.must(os.WriteFile(r.path(step), data, 0o600))
	case "flip":
		data := r.readFile(step)
		data[int(step["offset"].(float64))] ^= 0xff
		r.must(os.WriteFile(r.path(step), data, 0o600))
	case "snapshot":
		r.snapshots[step["name"].(string)] = r.readFile(step)
	case "restore":
		r.must(os.WriteFile(r.path(step), r.snapshots[step["name"].(string)], 0o600))
	case "keepRecords":
		data := r.readFile(step)
		offset := 0
		for range int(step["count"].(float64)) {
			status, _, consumed, _ := DecodeRecord(data[offset:])
			if status != StatusOK {
				t.Fatalf("keepRecords: record at %d is %v", offset, status)
			}
			offset += consumed
		}
		r.must(os.WriteFile(r.path(step), data[:offset], 0o600))
	case "sealed":
		r.must(WriteSealed(r.path(step), step["magic"].(string), uint64(parseInt(t, step["tag"].(string))), unhex(t, step["content"])))
	default:
		return r.call(op, step)
	}
	return nil
}

func (r *scenarioRunner) call(op string, step map[string]any) any {
	t := r.t
	ctx := context.Background()
	name, _ := step["session"].(string)
	switch op {
	case "open":
		outcome, session, err := r.store.Open(ctx, r.docID)
		if err != nil {
			return errorJSON(t, err)
		}
		if session != nil {
			r.sessions[name] = session
		}
		return openJSON(outcome, session)
	case "close":
		if err := r.sessions[name].Close(); err != nil {
			return errorJSON(t, err)
		}
		return map[string]any{"ok": true}
	case "append":
		var actor *string
		if value, ok := step["actorId"].(string); ok {
			actor = &value
		}
		result, err := r.sessions[name].Append(ctx, operation.Candidate{
			OperationID: step["operationId"].(string),
			ActorID:     actor,
			Source:      operation.Source(step["source"].(float64)),
			Update:      unhex(t, step["update"]),
			Digest:      unhex(t, step["digest"]),
		})
		if err != nil {
			return errorJSON(t, err)
		}
		return map[string]any{"outcome": appendNames[result.Outcome], "sequence": strconv.FormatUint(result.Sequence, 10)}
	case "find":
		result, err := r.sessions[name].FindCommitted(ctx, step["operationId"].(string), unhex(t, step["digest"]))
		if err != nil {
			return errorJSON(t, err)
		}
		return map[string]any{"outcome": lookupNames[result.Outcome], "sequence": strconv.FormatUint(result.Sequence, 10)}
	case "checkpoint":
		err := r.sessions[name].WriteCheckpoint(ctx, operation.Checkpoint{
			Through: uint64(parseInt(t, step["through"].(string))),
			State:   unhex(t, step["state"]),
		})
		if err != nil {
			return errorJSON(t, err)
		}
		return map[string]any{"ok": true}
	case "reset":
		var frames [][]byte
		for _, frame := range step["baseline"].([]any) {
			frames = append(frames, unhex(t, frame))
		}
		head, err := r.sessions[name].Reset(ctx, operation.Reset{
			Format:   int32(step["format"].(float64)),
			Epoch:    int64(step["epoch"].(float64)),
			Lineage:  step["lineage"].(string),
			Baseline: frames,
		})
		if err != nil {
			return errorJSON(t, err)
		}
		return headJSON(head)
	case "purge":
		outcome, err := r.store.Purge(ctx, r.docID)
		if err != nil {
			return errorJSON(t, err)
		}
		return map[string]any{"outcome": outcome.String()}
	case "isPurged":
		purged, err := r.store.IsPurged(ctx, r.docID)
		if err != nil {
			return errorJSON(t, err)
		}
		return map[string]any{"purged": purged}
	case "lineages":
		lineages, err := r.store.ListLineages(ctx, r.docID)
		if err != nil {
			return errorJSON(t, err)
		}
		list := []any{}
		for _, info := range lineages {
			var created any
			if info.CreatedAt != nil {
				created = strconv.FormatInt(dotnet.Ticks(*info.CreatedAt), 10)
			}
			list = append(list, map[string]any{
				"lineage": info.Lineage, "epoch": info.Epoch, "format": info.Format,
				"createdAt": created, "current": info.Current,
			})
		}
		return map[string]any{"lineages": list}
	case "baseline":
		frames, found, err := r.store.ReadBaseline(ctx, r.docID, step["lineage"].(string))
		if err != nil {
			return errorJSON(t, err)
		}
		if !found {
			return map[string]any{"baseline": nil}
		}
		return map[string]any{"baseline": hexList(frames)}
	case "records":
		records := []any{}
		for record, err := range r.store.ReadRecords(ctx, r.docID, step["lineage"].(string), uint64(parseInt(t, step["through"].(string)))) {
			if err != nil {
				return errorJSON(t, err)
			}
			records = append(records, recordJSON(record))
		}
		return map[string]any{"records": records}
	case "headers":
		headers := []any{}
		for header, err := range r.store.ReadHeaders(ctx, r.docID, step["lineage"].(string)) {
			if err != nil {
				return errorJSON(t, err)
			}
			headers = append(headers, map[string]any{
				"sequence":    strconv.FormatUint(header.Sequence, 10),
				"committedAt": strconv.FormatInt(dotnet.Ticks(header.CommittedAt), 10),
				"actorId":     header.ActorID,
			})
		}
		return map[string]any{"headers": headers}
	case "deleteLineage":
		outcome, err := r.store.DeleteLineage(ctx, r.docID, step["lineage"].(string))
		if err != nil {
			return errorJSON(t, err)
		}
		return map[string]any{"outcome": outcome.String()}
	}
	t.Fatalf("unknown step %q", op)
	return nil
}

var appendNames = map[operation.AppendOutcome]string{
	operation.Committed: "Committed", operation.AppendDuplicate: "Duplicate", operation.AppendConflict: "Conflict",
}

var lookupNames = map[operation.LookupOutcome]string{
	operation.NotCommitted: "NotCommitted", operation.LookupDuplicate: "Duplicate", operation.LookupConflict: "Conflict",
}

func openJSON(outcome OpenOutcome, session *Session) map[string]any {
	encoded := map[string]any{"outcome": outcome.String()}
	if session == nil {
		return encoded
	}
	result := session.OpenResult()
	encoded["head"] = nil
	if result.Head != nil {
		encoded["head"] = headJSON(*result.Head)
	}
	encoded["baseline"] = hexList(result.Baseline)
	encoded["checkpoint"] = nil
	if result.Checkpoint != nil {
		encoded["checkpoint"] = map[string]any{
			"through": strconv.FormatUint(result.Checkpoint.Through, 10),
			"state":   hex.EncodeToString(result.Checkpoint.State),
		}
	}
	tail := []any{}
	for _, record := range result.Tail {
		tail = append(tail, recordJSON(record))
	}
	encoded["tail"] = tail
	return encoded
}

func headJSON(head operation.Head) map[string]any {
	return map[string]any{
		"format": head.Format, "epoch": head.Epoch, "lineage": head.Lineage,
		"durableThrough": strconv.FormatUint(head.DurableThrough, 10),
	}
}

func recordJSON(record operation.Record) map[string]any {
	return map[string]any{
		"operationId": record.OperationID,
		"sequence":    strconv.FormatUint(record.Sequence, 10),
		"committedAt": strconv.FormatInt(dotnet.Ticks(record.CommittedAt), 10),
		"actorId":     record.ActorID,
		"source":      int(record.Source),
		"update":      hex.EncodeToString(record.Update),
		"digest":      hex.EncodeToString(record.Digest),
	}
}

func hexList(frames [][]byte) []any {
	list := []any{}
	for _, frame := range frames {
		list = append(list, hex.EncodeToString(frame))
	}
	return list
}

// errorJSON names an error the way the capture does; anything else fails.
func errorJSON(t *testing.T, err error) map[string]any {
	t.Helper()
	var invalid *InvalidDataError
	var argument *ArgumentError
	var operationErr *InvalidOperationError
	encoded := map[string]any{}
	switch {
	case errors.Is(err, ErrFenceLost):
		encoded["type"], encoded["message"] = "FenceLost", err.Error()
	case errors.As(err, &invalid):
		encoded["type"], encoded["message"] = "InvalidData", invalid.Message
	case errors.Is(err, ErrClosed):
		encoded["type"] = "Disposed"
	case errors.As(err, &operationErr):
		encoded["type"], encoded["message"] = "InvalidOperation", operationErr.Message
	case errors.As(err, &argument) && argument.OutOfRange:
		encoded["type"], encoded["message"] = "ArgumentOutOfRange", argument.Message
	case errors.As(err, &argument):
		encoded["type"], encoded["message"] = "Argument", argument.Message
	default:
		var pathErr *fs.PathError
		if !errors.As(err, &pathErr) {
			t.Fatalf("an error C# has no kind for: %v", err)
		}
		encoded["type"] = "IO"
	}
	return map[string]any{"error": encoded}
}

func listFiles(t *testing.T, root, docID string) map[string]*string {
	t.Helper()
	key := workingset.DocKey(docID)
	files := map[string]*string{}
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || path == root {
			return err
		}
		relative, _ := filepath.Rel(root, path)
		relative = strings.ReplaceAll(filepath.ToSlash(relative), key, "{doc}")
		if entry.IsDir() {
			files[relative+"/"] = nil
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		content := hex.EncodeToString(data)
		files[relative] = &content
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

func sameJSON(t *testing.T, got, want any) bool {
	t.Helper()
	var a, b any
	if err := json.Unmarshal([]byte(encodeJSON(t, got)), &a); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(encodeJSON(t, want)), &b); err != nil {
		t.Fatal(err)
	}
	return reflect.DeepEqual(a, b)
}

func encodeJSON(t *testing.T, value any) string {
	t.Helper()
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(buffer.String())
}

func unhex(t *testing.T, value any) []byte {
	t.Helper()
	return collabtest.Hex(t, value.(string))
}

func parseInt(t *testing.T, text string) int64 {
	t.Helper()
	if value, err := strconv.ParseInt(text, 10, 64); err == nil {
		return value
	}
	value, err := strconv.ParseUint(text, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	return int64(value)
}

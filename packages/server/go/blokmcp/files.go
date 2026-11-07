package blokmcp

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Lock timings, as Node's files source: a save holds the lock for one read,
// one small write and one rename, so a lock this old was left by a dead
// process.
const (
	lockStaleMs = 30_000
	lockWait    = 2 * time.Second
	lockRetry   = 25 * time.Millisecond
)

// filesSource is Node's createFilesSource: one JSON file per document.
type filesSource struct {
	dir    string
	bundle bundle
	// lanes serialise saves of one target file inside this process. A
	// lane goes once no save holds or waits for it, as Node's chain does.
	mu    sync.Mutex
	lanes map[string]*fileLane
}

type fileLane struct {
	mu    sync.Mutex
	users int
}

func newFilesSource(dir string, b bundle) *filesSource {
	return &filesSource{dir: dir, bundle: b, lanes: map[string]*fileLane{}}
}

func (s *filesSource) documentForm() string { return "file" }
func (s *filesSource) lists() bool          { return true }

func sha256Hex(bytes []byte) string {
	sum := sha256.Sum256(bytes)
	return hex.EncodeToString(sum[:])
}

// unavailable names only <id>.json to the agent; the path goes to stderr.
func unavailable(message, path string, cause any) *surfaceErr {
	fmt.Fprintf(os.Stderr, "blok-mcp files source: %s (%s): %v\n", message, path, cause)
	return surfaceError("SOURCE_UNAVAILABLE", message)
}

func documentChanged() *surfaceErr {
	return surfaceError("DOCUMENT_CHANGED", "The document changed on disk since you opened it. Read it again, then retry.")
}

// bundleRefusal reads a bundle answer that is {} or {error}.
func bundleRefusal(raw json.RawMessage) error {
	var answer struct {
		Error json.RawMessage `json:"error"`
	}
	if err := json.Unmarshal(raw, &answer); err != nil {
		return err
	}
	if len(answer.Error) == 0 {
		return nil
	}
	return rawError(answer.Error)
}

// rawError is a bundle-built error object, sent as is.
func rawError(raw json.RawMessage) *surfaceErr {
	var fields struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	_ = json.Unmarshal(raw, &fields)
	return &surfaceErr{Code: fields.Code, Message: fields.Message, Helper: "as-is", Raw: raw}
}

func (s *filesSource) pathOf(ctx context.Context, documentID string) (string, error) {
	raw, err := s.bundle.call(ctx, "mcpFileId", map[string]string{"id": documentID}, nil)
	if err != nil {
		return "", err
	}
	if err := bundleRefusal(raw); err != nil {
		return "", err
	}
	return filepath.Join(s.dir, documentID+".json"), nil
}

func (s *filesSource) readBytes(documentID, path string) ([]byte, error) {
	bytes, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, unavailable(fmt.Sprintf("Cannot read %s.json.", documentID), path, err)
	}
	return bytes, nil
}

// assertExactName refuses an id that reaches a file under another letter
// case, which a case-insensitive disk allows. The folder listing is the one
// place that holds the on-disk name.
func (s *filesSource) assertExactName(documentID string) error {
	name := documentID + ".json"
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return unavailable("Cannot list the documents directory.", s.dir, err)
	}
	var taken string
	for _, entry := range entries {
		if entry.Name() == name {
			return nil
		}
		if taken == "" && strings.ToLower(entry.Name()) == strings.ToLower(name) {
			taken = entry.Name()
		}
	}
	if taken == "" {
		return surfaceError("INVALID_ARGS", "Document ids are case-sensitive. Use the id exactly as listed.")
	}
	return surfaceError("INVALID_ARGS", fmt.Sprintf("%s already uses this name with different letter case. This disk ignores case, so the two ids cannot both exist.", taken))
}

// writeTargetOf is the file a save replaces, symlinks resolved, so a link is
// written through and survives. A link to a missing file is refused.
func (s *filesSource) writeTargetOf(documentID, path string) (string, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		dir, dirErr := filepath.EvalSymlinks(s.dir)
		if dirErr != nil {
			dir = s.dir
		}
		return filepath.Join(dir, filepath.Base(path)), nil
	}
	if err != nil {
		return "", unavailable(fmt.Sprintf("Cannot read %s.json.", documentID), path, err)
	}
	target, err := filepath.EvalSymlinks(path)
	if err != nil {
		if info.Mode()&fs.ModeSymlink == 0 {
			return path, nil
		}
		return "", unavailable(fmt.Sprintf("%s.json is a link to a missing file.", documentID), path, err)
	}
	if !filepath.IsAbs(target) {
		if absolute, absErr := filepath.Abs(target); absErr == nil {
			target = absolute
		}
	}
	return target, nil
}

// sameFileKey is lower case: on a case-insensitive disk doc and DOC are one
// file.
func sameFileKey(target string) string { return strings.ToLower(target) }

func (s *filesSource) load(ctx context.Context, documentID string) (*loaded, error) {
	path, err := s.pathOf(ctx, documentID)
	if err != nil {
		return nil, err
	}
	bytes, err := s.readBytes(documentID, path)
	if err != nil {
		return nil, err
	}
	if bytes == nil {
		// A link to a missing file is refused here, as a save would be.
		if _, err := s.writeTargetOf(documentID, path); err != nil {
			return nil, err
		}
		return &loaded{document: emptyDocument, missing: true}, nil
	}
	if err := s.assertExactName(documentID); err != nil {
		return nil, err
	}
	raw, err := s.bundle.call(ctx, "mcpParseDocument", map[string]string{"id": documentID, "text": decodeUTF8(bytes)}, nil)
	if err != nil {
		return nil, err
	}
	var answer struct {
		Document json.RawMessage `json:"document"`
		Error    json.RawMessage `json:"error"`
	}
	if err := json.Unmarshal(raw, &answer); err != nil {
		return nil, err
	}
	if len(answer.Error) > 0 {
		return nil, rawError(answer.Error)
	}
	version := sha256Hex(bytes)
	return &loaded{document: answer.Document, version: &version}, nil
}

// enterLane waits for the lane of key; the returned func leaves it.
func (s *filesSource) enterLane(key string) func() {
	s.mu.Lock()
	lane, ok := s.lanes[key]
	if !ok {
		lane = &fileLane{}
		s.lanes[key] = lane
	}
	lane.users++
	s.mu.Unlock()
	lane.mu.Lock()
	return func() {
		lane.mu.Unlock()
		s.mu.Lock()
		defer s.mu.Unlock()
		if lane.users--; lane.users == 0 {
			delete(s.lanes, key)
		}
	}
}

func (s *filesSource) save(ctx context.Context, documentID string, text []byte, ifVersion *string) (*string, error) {
	path, err := s.pathOf(ctx, documentID)
	if err != nil {
		return nil, err
	}
	target, err := s.writeTargetOf(documentID, path)
	if err != nil {
		return nil, err
	}
	defer s.enterLane(sameFileKey(target))()
	held, err := s.lock(documentID, target)
	if err != nil {
		return nil, err
	}
	defer os.Remove(held)
	return s.saveLocked(documentID, path, target, text, ifVersion)
}

// lock takes the cross-process lock file next to the target.
func (s *filesSource) lock(documentID, target string) (string, error) {
	path := filepath.Join(filepath.Dir(target), "."+strings.ToLower(filepath.Base(target))+".lock")
	deadline := time.Now().Add(lockWait)
	for {
		file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o666)
		if err == nil {
			_ = file.Close()
			return path, nil
		}
		if !errors.Is(err, fs.ErrExist) {
			return "", unavailable(fmt.Sprintf("Cannot write %s.json.", documentID), path, err)
		}
		// Not atomic: two waiters may both judge one lock stale. It needs a
		// crashed holder.
		if held, statErr := os.Stat(path); statErr == nil && time.Since(held.ModTime()).Milliseconds() > lockStaleMs {
			_ = os.Remove(path)
			continue
		}
		if !time.Now().Before(deadline) {
			return "", unavailable(fmt.Sprintf("%s.json is being saved by another process. Retry shortly.", documentID), path, "lock held")
		}
		time.Sleep(lockRetry)
	}
}

func randomHex(n int) string {
	bytes := make([]byte, n)
	_, _ = rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

func (s *filesSource) saveLocked(documentID, path, target string, text []byte, ifVersion *string) (*string, error) {
	// A link pointed elsewhere during the wait would be checked against one
	// file and written to another.
	now, err := s.writeTargetOf(documentID, path)
	if err != nil {
		return nil, err
	}
	if sameFileKey(now) != sameFileKey(target) {
		return nil, documentChanged()
	}
	current, err := s.readBytes(documentID, path)
	if err != nil {
		return nil, err
	}
	if current != nil {
		if err := s.assertExactName(documentID); err != nil {
			return nil, err
		}
	}
	var currentVersion *string
	if current != nil {
		version := sha256Hex(current)
		currentVersion = &version
	}
	if !sameVersion(currentVersion, ifVersion) {
		return nil, documentChanged()
	}
	// Same folder as the target, so the rename is atomic.
	temp := filepath.Join(filepath.Dir(target), "."+documentID+"."+randomHex(6)+".tmp")
	var mode fs.FileMode
	hasMode := false
	if info, statErr := os.Stat(target); statErr == nil {
		mode, hasMode = info.Mode().Perm()|(info.Mode()&(fs.ModeSetuid|fs.ModeSetgid|fs.ModeSticky)), true
	}
	if err := writeSynced(temp, text, mode, hasMode, target); err != nil {
		_ = os.Remove(temp)
		return nil, unavailable(fmt.Sprintf("Cannot write %s.json.", documentID), path, err)
	}
	syncDir(filepath.Dir(target))
	version := sha256Hex(text)
	return &version, nil
}

func writeSynced(temp string, text []byte, mode fs.FileMode, hasMode bool, target string) error {
	file, err := os.OpenFile(temp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o666)
	if err != nil {
		return err
	}
	if _, err := file.Write(text); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	// The umask filters a create mode, so the old mode is set explicitly.
	if hasMode {
		if err := os.Chmod(temp, mode); err != nil {
			return err
		}
	}
	return os.Rename(temp, target)
}

// syncDir makes the rename durable. Best effort: some platforms refuse.
func syncDir(dir string) {
	file, err := os.Open(dir)
	if err != nil {
		return
	}
	_ = file.Sync()
	_ = file.Close()
}

func sameVersion(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func (s *filesSource) list(ctx context.Context, request listRequest) (*sourceListing, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, unavailable("Cannot list the documents directory.", s.dir, err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	var ids struct {
		IDs []string `json:"ids"`
	}
	if _, err := s.bundle.call(ctx, "mcpFileIds", map[string]any{"names": names}, &ids); err != nil {
		return nil, err
	}
	type entry struct {
		ID   string  `json:"id"`
		Text *string `json:"text"`
	}
	listed := make([]entry, len(ids.IDs))
	for index, id := range ids.IDs {
		listed[index] = entry{ID: id}
		if bytes, readErr := os.ReadFile(filepath.Join(s.dir, id+".json")); readErr == nil {
			text := decodeUTF8(bytes)
			listed[index].Text = &text
		}
	}
	input := map[string]any{"entries": listed, "limit": request.Limit}
	if request.Query != nil {
		input["query"] = *request.Query
	}
	if request.Cursor != nil {
		input["cursor"] = *request.Cursor
	}
	var listing sourceListing
	if _, err := s.bundle.call(ctx, "mcpFilesList", input, &listing); err != nil {
		return nil, err
	}
	return &listing, nil
}

// sameDocument is Node's files sameDocument: two ids that save to one file.
func (s *filesSource) sameDocument(ctx context.Context, first, second string) bool {
	keyOf := func(documentID string) string {
		path, err := s.pathOf(ctx, documentID)
		if err != nil {
			return ""
		}
		target, err := s.writeTargetOf(documentID, path)
		if err != nil {
			return ""
		}
		return sameFileKey(target)
	}
	a := keyOf(first)
	return a != "" && a == keyOf(second)
}

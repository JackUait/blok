package workingset

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

const (
	docID     = "doc-1"
	docKeyHex = "bb0e4f49443794d901e8969ff11bd112e34208a0dcdf0e1eedb480cc9b3c7293"
)

var (
	ctx      = context.Background()
	storeTag = Tag{Format: CurrentFormat, Epoch: 3, Lineage: "fedcba9876543210fedcba9876543210"}
)

type harness struct {
	dir  string
	logs []string
}

func newHarness(t *testing.T) *harness {
	return &harness{dir: filepath.Join(t.TempDir(), "collab")}
}

func (h *harness) store() *LocalStore {
	return NewLocalStore(h.dir, func(m string) { h.logs = append(h.logs, m) })
}

func sectionOf(t *testing.T, updates ...[]byte) []byte {
	section, err := EncodeFrames(updates)
	if err != nil {
		t.Fatal(err)
	}
	return section
}

func files(t *testing.T, dir string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() {
			names = append(names, e.Name())
		}
	}
	return names
}

func exists(path string) bool { _, err := os.Stat(path); return err == nil }

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func read(t *testing.T, s *LocalStore) *Set {
	stored, err := s.Read(ctx, docID)
	must(t, err)
	return stored
}

// Twins of LocalCollabStoreTests.
func TestReadsAbsentAsNull(t *testing.T) {
	h := newHarness(t)
	if read(t, h.store()) != nil || len(h.logs) != 0 {
		t.Fatal(h.logs)
	}
}

func TestWritesThenReadsBackTheWorkingSet(t *testing.T) {
	h := newHarness(t)
	s := h.store()
	updates := sectionOf(t, []byte{1, 2}, []byte{3})
	must(t, s.Write(ctx, docID, updates, storeTag))
	stored := read(t, s)
	if stored == nil || !bytes.Equal(stored.Updates, updates) || stored.Tag != storeTag || !slices.Equal(files(t, h.dir), []string{docKeyHex}) {
		t.Fatal(stored)
	}
	// The file is the blob C# writes, byte for byte.
	want, _ := EncodeDocument(storeTag, updates)
	got, _ := os.ReadFile(filepath.Join(h.dir, docKeyHex))
	if !bytes.Equal(got, want) {
		t.Fatal("file bytes")
	}
}

func TestOverwritesThePreviousWorkingSet(t *testing.T) {
	h := newHarness(t)
	s := h.store()
	must(t, s.Write(ctx, docID, sectionOf(t, []byte{1}), storeTag))
	replacement := sectionOf(t, []byte{10}, []byte{11})
	must(t, s.Write(ctx, docID, replacement, storeTag))
	if stored := read(t, s); !bytes.Equal(stored.Updates, replacement) || len(files(t, h.dir)) != 1 {
		t.Fatal(stored)
	}
}

func TestResetRewritesToAnEmptyLogWithTheNewTag(t *testing.T) {
	h := newHarness(t)
	s := h.store()
	must(t, s.Write(ctx, docID, sectionOf(t, []byte{1}), storeTag))
	bumped := storeTag
	bumped.Epoch++
	must(t, s.Reset(ctx, docID, bumped))
	if stored := read(t, s); len(stored.Updates) != 0 || stored.Tag != bumped {
		t.Fatal(stored)
	}
}

func TestWriteRefusesToLowerTheEpoch(t *testing.T) {
	h := newHarness(t)
	s := h.store()
	updates := sectionOf(t, []byte{1})
	must(t, s.Write(ctx, docID, updates, storeTag))
	lower := storeTag
	lower.Epoch--
	if err := s.Write(ctx, docID, sectionOf(t, []byte{2}), lower); err == nil || !strings.Contains(err.Error(), "refusing to lower") {
		t.Fatal(err)
	}
	if stored := read(t, s); !bytes.Equal(stored.Updates, updates) || stored.Tag != storeTag {
		t.Fatal(stored)
	}
}

func TestWriteKeepsTheEpochForOrdinaryAppends(t *testing.T) {
	h := newHarness(t)
	s := h.store()
	must(t, s.Write(ctx, docID, sectionOf(t, []byte{1}), storeTag))
	appended := sectionOf(t, []byte{1}, []byte{2})
	must(t, s.Write(ctx, docID, appended, storeTag))
	if !bytes.Equal(read(t, s).Updates, appended) {
		t.Fatal("append")
	}
}

func TestResetRequiresAStrictlyHigherEpoch(t *testing.T) {
	h := newHarness(t)
	s := h.store()
	must(t, s.Write(ctx, docID, sectionOf(t, []byte{1}), storeTag))
	if err := s.Reset(ctx, docID, storeTag); err == nil || !strings.Contains(err.Error(), "must raise") {
		t.Fatal(err)
	}
}

func TestTreatsACorruptFileAsAbsentAndLogsIt(t *testing.T) {
	h := newHarness(t)
	s := h.store()
	must(t, os.MkdirAll(h.dir, 0o700))
	must(t, os.WriteFile(filepath.Join(h.dir, docKeyHex), []byte("not a working set"), 0o600))
	if read(t, s) != nil || !slices.ContainsFunc(h.logs, func(l string) bool { return strings.Contains(l, docID) }) {
		t.Fatal(h.logs)
	}
	zero := storeTag
	zero.Epoch = 0
	must(t, s.Write(ctx, docID, sectionOf(t, []byte{1}), zero))
	if stored := read(t, s); stored == nil || stored.Tag.Epoch != 0 {
		t.Fatal(stored)
	}
}

func TestMovesAnUnreadableFileAsideSoTheEpochGuardSeesNothing(t *testing.T) {
	h := newHarness(t)
	s := h.store()
	s.now = func() time.Time { return time.Date(2026, 11, 2, 3, 4, 5, 678_000_000, time.UTC) }
	must(t, s.Write(ctx, docID, sectionOf(t, []byte{1}), storeTag))
	path := filepath.Join(h.dir, docKeyHex)
	written, _ := os.ReadFile(path)
	corrupt := append(slices.Clone(written[:HeaderLength]), 0xff, 0xff, 0xff)
	must(t, os.WriteFile(path, corrupt, 0o600))
	if read(t, s) != nil || exists(path) {
		t.Fatal("not moved")
	}
	names := files(t, h.dir)
	aside := docKeyHex + ".unreadable-20261102T030405678Z"
	if !slices.Equal(names, []string{aside}) {
		t.Fatal(names)
	}
	if got, _ := os.ReadFile(filepath.Join(h.dir, aside)); !bytes.Equal(got, corrupt) {
		t.Fatal("aside bytes")
	}
	if !slices.ContainsFunc(h.logs, func(l string) bool { return strings.Contains(l, aside) }) {
		t.Fatal(h.logs)
	}
	zero := storeTag
	zero.Epoch = 0
	must(t, s.Write(ctx, docID, sectionOf(t, []byte{2}), zero))
	if stored := read(t, s); stored == nil || stored.Tag.Epoch != 0 {
		t.Fatal(stored)
	}
}

func TestSweepsStaleTemporaryFilesAtStartupAndKeepsTheRest(t *testing.T) {
	h := newHarness(t)
	must(t, os.MkdirAll(h.dir, 0o700))
	old := time.Now().Add(-2 * time.Minute)
	for _, name := range []string{".blok-collab-stale", ".blok-collab-fresh", docKeyHex} {
		must(t, os.WriteFile(filepath.Join(h.dir, name), []byte{1}, 0o600))
	}
	must(t, os.Chtimes(filepath.Join(h.dir, ".blok-collab-stale"), old, old))
	must(t, os.Chtimes(filepath.Join(h.dir, docKeyHex), old, old))
	h.store()
	if exists(filepath.Join(h.dir, ".blok-collab-stale")) || !exists(filepath.Join(h.dir, ".blok-collab-fresh")) || !exists(filepath.Join(h.dir, docKeyHex)) {
		t.Fatal(files(t, h.dir))
	}
}

func TestCleansUpTheTempFileWhenTheRenameFails(t *testing.T) {
	h := newHarness(t)
	s := h.store()
	must(t, os.MkdirAll(filepath.Join(h.dir, docKeyHex), 0o700))
	if err := s.Write(ctx, docID, sectionOf(t, []byte{1}), storeTag); err == nil {
		t.Fatal("wrote onto a directory")
	}
	if len(files(t, h.dir)) != 0 || !exists(filepath.Join(h.dir, docKeyHex)) {
		t.Fatal(files(t, h.dir))
	}
}

func TestRefusesInvalidUpdatesBeforeTouchingTheDisk(t *testing.T) {
	h := newHarness(t)
	s := h.store()
	updates := sectionOf(t, []byte{1})
	must(t, s.Write(ctx, docID, updates, storeTag))
	if err := s.Write(ctx, docID, []byte{1, 2}, storeTag); err == nil {
		t.Fatal("accepted")
	}
	if !bytes.Equal(read(t, s).Updates, updates) {
		t.Fatal("touched")
	}
}

func TestKeepsTheWorkingSetPrivateOnUnix(t *testing.T) {
	h := newHarness(t)
	must(t, h.store().Write(ctx, docID, sectionOf(t, []byte{1}), storeTag))
	file, _ := os.Stat(filepath.Join(h.dir, docKeyHex))
	dir, _ := os.Stat(h.dir)
	if file.Mode().Perm() != 0o600 || dir.Mode().Perm() != 0o700 {
		t.Fatal(file.Mode(), dir.Mode())
	}
}

// Twin of LocalCollabStoreDirectoryModeTests.
func TestTightensAWorkingSetDirectoryThatAlreadyExisted(t *testing.T) {
	h := newHarness(t)
	must(t, os.MkdirAll(h.dir, 0o755))
	must(t, os.Chmod(h.dir, 0o755))
	must(t, h.store().Write(ctx, "doc-1", nil, storeTag))
	if dir, _ := os.Stat(h.dir); dir.Mode().Perm() != 0o700 {
		t.Fatal(dir.Mode())
	}
}

func TestDeleteRemovesOnlyOneDocumentsWorkingSetAndKeyedOrphans(t *testing.T) {
	h := newHarness(t)
	s := h.store()
	must(t, s.Write(ctx, docID, sectionOf(t, []byte{1}), storeTag))
	must(t, s.Write(ctx, "doc-2", sectionOf(t, []byte{2}), storeTag))
	other := DocKey("doc-2")
	names := map[string]bool{
		docKeyHex + ".unreadable-old": false, other + ".unreadable-old": true,
		".blok-collab-" + docKeyHex + "-abandoned": false, ".blok-collab-" + other + "-abandoned": true,
		".blok-collab-unidentified": true,
	}
	for name := range names {
		must(t, os.WriteFile(filepath.Join(h.dir, name), []byte{3}, 0o600))
	}
	must(t, s.Delete(ctx, docID))
	must(t, s.Delete(ctx, docID))
	names[docKeyHex] = false
	names[other] = true
	for name, kept := range names {
		if exists(filepath.Join(h.dir, name)) != kept {
			t.Errorf("%s kept=%v", name, !kept)
		}
	}
}

func TestDeleteRefusesALegacyUnkeyedTemporaryFileUntilItIsRemoved(t *testing.T) {
	h := newHarness(t)
	s := h.store()
	must(t, s.Write(ctx, docID, sectionOf(t, []byte{1}), storeTag))
	must(t, s.Write(ctx, "doc-2", sectionOf(t, []byte{2}), storeTag))
	legacy := filepath.Join(h.dir, ".blok-collab-00000000000000000000000000000001")
	must(t, os.WriteFile(legacy, []byte{3}, 0o600))
	if err := s.Delete(ctx, docID); err == nil || !strings.Contains(err.Error(), "cannot purge") {
		t.Fatal(err)
	}
	if !exists(filepath.Join(h.dir, docKeyHex)) || !exists(legacy) {
		t.Fatal("removed")
	}
	must(t, os.Remove(legacy))
	must(t, s.Delete(ctx, docID))
	if exists(filepath.Join(h.dir, docKeyHex)) || !exists(filepath.Join(h.dir, DocKey("doc-2"))) {
		t.Fatal(files(t, h.dir))
	}
}

func TestDeletePropagatesAnOccupiedWorkingSetPath(t *testing.T) {
	h := newHarness(t)
	s := h.store()
	must(t, os.MkdirAll(filepath.Join(h.dir, docKeyHex), 0o700))
	if err := s.Delete(ctx, docID); err == nil || !exists(filepath.Join(h.dir, docKeyHex)) {
		t.Fatal(err)
	}
}

func TestRetireRemovesOnlyAReadableWorkingSet(t *testing.T) {
	h := newHarness(t)
	s := h.store()
	must(t, s.Write(ctx, docID, sectionOf(t, []byte{1}), storeTag))
	unreadable := filepath.Join(h.dir, docKeyHex+".unreadable-old")
	scratch := filepath.Join(h.dir, ".blok-collab-00000000000000000000000000000001")
	must(t, os.WriteFile(unreadable, []byte{3}, 0o600))
	must(t, os.WriteFile(scratch, []byte{4}, 0o600))
	must(t, s.Retire(ctx, docID))
	must(t, s.Retire(ctx, docID))
	if exists(filepath.Join(h.dir, docKeyHex)) || !exists(unreadable) || !exists(scratch) {
		t.Fatal(files(t, h.dir))
	}
}

func TestRetireLeavesAnUnreadableWorkingSetInPlace(t *testing.T) {
	h := newHarness(t)
	s := h.store()
	must(t, os.MkdirAll(h.dir, 0o700))
	path := filepath.Join(h.dir, docKeyHex)
	must(t, os.WriteFile(path, []byte{9, 9, 9}, 0o600))
	must(t, s.Retire(ctx, docID))
	if got, _ := os.ReadFile(path); !bytes.Equal(got, []byte{9, 9, 9}) {
		t.Fatal(got)
	}
}

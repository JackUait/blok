package journal

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/workingset"
)

// Go twins of LocalCollabOperationStoreTests and LocalCollabOperationHistoryTests
// for what the scenario fixture cannot hold: other processes, stale
// descriptors, OS faults and concurrency. Run with -race.

const twinDoc = "doc-1"

type twinStore struct {
	*Store
	root string
	mu   sync.Mutex
	logs []string
}

func newTwinStore(t *testing.T) *twinStore {
	t.Helper()
	twin := &twinStore{root: t.TempDir()}
	store, err := NewStore(twin.root, StoreOptions{Log: func(line string) {
		twin.mu.Lock()
		defer twin.mu.Unlock()
		twin.logs = append(twin.logs, line)
	}})
	if err != nil {
		t.Fatal(err)
	}
	twin.Store = store
	return twin
}

func (s *twinStore) docDir() string {
	return filepath.Join(s.root, workingset.DocKey(twinDoc)+journalSuffix)
}

func (s *twinStore) path(name string) string { return filepath.Join(s.docDir(), name) }

func (s *twinStore) open(t *testing.T) *Session {
	t.Helper()
	outcome, session, err := s.Open(context.Background(), twinDoc)
	if err != nil || outcome != Opened {
		t.Fatalf("open: %v %v", outcome, err)
	}
	t.Cleanup(func() { session.Close() })
	return session
}

func twinLineage(n int) string { return fmt.Sprintf("%032x", n) }

func twinOpID(n int) string { return fmt.Sprintf("%032x", n) }

func twinReset(t *testing.T, session *Session, epoch int64, lineage string, frames ...[]byte) {
	t.Helper()
	if _, err := session.Reset(context.Background(), operation.Reset{Format: 1, Epoch: epoch, Lineage: lineage, Baseline: frames}); err != nil {
		t.Fatal(err)
	}
}

func twinAppend(t *testing.T, session *Session, n int, update ...byte) (operation.AppendResult, error) {
	t.Helper()
	actor := "user-1"
	digest := sha256.Sum256(update)
	return session.Append(context.Background(), operation.Candidate{
		OperationID: twinOpID(n), ActorID: &actor, Source: operation.SourceClientV2, Update: update, Digest: digest[:],
	})
}

func TestRefusesAWireLimitTheRecordFormatCannotCarry(t *testing.T) {
	root := t.TempDir()
	var argument *ArgumentError
	if _, err := NewStore(root, StoreOptions{MaxUpdateBytes: 33 << 20}); !errors.As(err, &argument) || !argument.OutOfRange {
		t.Fatalf("33 MiB: %v", err)
	}
	if _, err := NewStore(root, StoreOptions{MaxUpdateBytes: -1}); !errors.As(err, &argument) {
		t.Fatalf("-1: %v", err)
	}
	store, err := NewStore(root, StoreOptions{MaxUpdateBytes: 32 << 20})
	if err != nil {
		t.Fatal(err)
	}
	if store.MaxUpdateBytes() != 32<<20 {
		t.Fatal(store.MaxUpdateBytes())
	}
	// Zero is Go's "unset": the C# default.
	if store, _ := NewStore(root, StoreOptions{}); store.MaxUpdateBytes() != DefaultMaxUpdateBytes {
		t.Fatal(store.MaxUpdateBytes())
	}
}

func TestAStaleSessionCannotAppendEvenWithItsFileHandleStillOpen(t *testing.T) {
	store := newTwinStore(t)
	stale := store.open(t)
	twinReset(t, stale, 1, twinLineage(1))
	if _, err := twinAppend(t, stale, 1, 0x01); err != nil {
		t.Fatal(err)
	}
	journalPath := store.path("journal.1.1")
	old, err := os.OpenFile(journalPath, os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer old.Close()
	if err := os.Remove(store.path(lockName)); err != nil {
		t.Fatal(err)
	}
	winner := store.open(t)
	before, _ := os.ReadFile(journalPath)

	// Nothing at the OS level took write access away from the stale side.
	if _, err := old.WriteAt([]byte{0xff}, int64(len(before))); err != nil {
		t.Fatal(err)
	}
	if err := old.Truncate(int64(len(before))); err != nil {
		t.Fatal(err)
	}
	if _, err := twinAppend(t, stale, 2, 0x02); !errors.Is(err, ErrFenceLost) {
		t.Fatalf("stale append: %v", err)
	}
	if after, _ := os.ReadFile(journalPath); !bytes.Equal(after, before) {
		t.Fatal("the stale session wrote")
	}
	if _, err := twinAppend(t, winner, 3, 0x03); err != nil {
		t.Fatal(err)
	}
	stale.Close()
	winner.Close()
	reopened := store.open(t)
	var ids []string
	for _, record := range reopened.OpenResult().Tail {
		ids = append(ids, record.OperationID)
	}
	if !slices.Equal(ids, []string{twinOpID(1), twinOpID(3)}) {
		t.Fatal(ids)
	}
}

func python3(t *testing.T) string {
	t.Helper()
	for _, candidate := range []string{"/usr/bin/python3", "/usr/local/bin/python3", "/opt/homebrew/bin/python3"} {
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	// CI runs Linux: a skipped cross-process check there would be a lie.
	if runtime.GOOS == "linux" {
		t.Fatal("no python3 to hold the lock from a separate process")
	}
	t.Skip("no python3")
	return ""
}

// startLockHolder holds flock(LOCK_EX) from another process: what a live
// C# store holds, since .NET's FileShare.None is flock on Unix.
func startLockHolder(t *testing.T, python, lockPath string) *exec.Cmd {
	t.Helper()
	const script = "import fcntl, sys, time\n" +
		"handle = open(sys.argv[1], 'a+')\n" +
		"fcntl.flock(handle, fcntl.LOCK_EX)\n" +
		"print('locked', flush=True)\n" +
		"time.sleep(300)\n"
	cmd := exec.Command(python, "-c", script, lockPath)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cmd.Process.Kill()
		cmd.Wait()
	})
	line, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil || strings.TrimSpace(line) != "locked" {
		t.Fatalf("holder: %q %v", line, err)
	}
	return cmd
}

func TestOpenWhileAnotherProcessHoldsTheDocumentReportsOpenElsewhere(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("flock and the python holder are POSIX-only")
	}
	store := newTwinStore(t)
	seeder := store.open(t)
	twinReset(t, seeder, 1, twinLineage(1))
	seeder.Close()

	holder := store.open(t)
	other, _ := NewStore(store.root, StoreOptions{})
	if outcome, session, err := other.Open(context.Background(), twinDoc); err != nil || outcome != DocumentOpenElsewhere || session != nil {
		t.Fatalf("in-process holder: %v %v", outcome, err)
	}
	holder.Close()
	if _, err := os.Stat(store.path(lockName)); err != nil {
		t.Fatal("the lock file must stay")
	}
	store.open(t).Close()

	live := startLockHolder(t, python3(t), store.path(lockName))
	if outcome, _, err := other.Open(context.Background(), twinDoc); err != nil || outcome != DocumentOpenElsewhere {
		t.Fatalf("other-process holder: %v %v", outcome, err)
	}
	if outcome, err := other.Purge(context.Background(), twinDoc); err != nil || outcome != PurgeOpenElsewhere {
		t.Fatalf("purge under another process: %v %v", outcome, err)
	}
	live.Process.Kill()
	live.Wait()
	if store.open(t).OpenResult().Head == nil {
		t.Fatal("no head after the holder died")
	}
}

// A Go hold is the same flock another process (and so a C# store) tests for.
func TestAGoHoldRefusesAnotherProcessFlock(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("flock is POSIX-only")
	}
	python := python3(t)
	store := newTwinStore(t)
	store.open(t)
	probe := "import fcntl, sys\n" +
		"handle = open(sys.argv[1], 'a+')\n" +
		"try:\n    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)\n    print('free')\n" +
		"except OSError:\n    print('held')\n"
	out, err := exec.Command(python, "-c", probe, store.path(lockName)).Output()
	if err != nil || strings.TrimSpace(string(out)) != "held" {
		t.Fatalf("%q %v", out, err)
	}
}

func TestPurgeDoesNotReportALockIoFaultAsALiveHolder(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("a symlink loop is POSIX-only")
	}
	store := newTwinStore(t)
	session := store.open(t)
	twinReset(t, session, 1, twinLineage(1), []byte{0xb1})
	session.Close()
	manifestBefore, _ := os.ReadFile(store.path(ManifestFileName))
	lock := store.path(lockName)
	if err := os.Remove(lock); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(lock, lock); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(lock)

	if outcome, err := store.Purge(context.Background(), twinDoc); err == nil {
		t.Fatalf("purge answered %v", outcome)
	}
	if fileExists(store.path(purgeName)) {
		t.Fatal("marker written")
	}
	if after, _ := os.ReadFile(store.path(ManifestFileName)); !bytes.Equal(after, manifestBefore) {
		t.Fatal("manifest changed")
	}
}

func TestPurgeKeepsTheMarkerOnACaseInsensitiveVolume(t *testing.T) {
	store := newTwinStore(t)
	session := store.open(t)
	twinReset(t, session, 1, twinLineage(1), []byte{0xb1})
	session.Close()
	if err := os.WriteFile(store.path("PURGED"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if outcome, err := store.Purge(context.Background(), twinDoc); err != nil || outcome != Purged {
		t.Fatalf("%v %v", outcome, err)
	}
	other, _ := NewStore(store.root, StoreOptions{})
	if outcome, session, err := other.Open(context.Background(), twinDoc); err != nil || outcome != DocumentPurged || session != nil {
		t.Fatalf("%v %v", outcome, err)
	}
	entries, _ := os.ReadDir(store.docDir())
	if len(entries) != 2 {
		t.Fatalf("%d entries", len(entries))
	}
}

func TestALedgerThatCannotBeWrittenNeverFailsAResetOrAnOpen(t *testing.T) {
	store := newTwinStore(t)
	session := store.open(t)
	twinReset(t, session, 1, twinLineage(1), []byte{0xb1})
	session.Close()
	ledger := store.path(LedgerFileName)
	if err := os.Remove(ledger); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(ledger, 0o700); err != nil {
		t.Fatal(err)
	}
	session = store.open(t)
	head, err := session.Reset(context.Background(), operation.Reset{Format: 1, Epoch: 2, Lineage: twinLineage(2), Baseline: [][]byte{{0xb2}}})
	if err != nil || head.Lineage != twinLineage(2) {
		t.Fatalf("%v %v", head, err)
	}
	session.Close()
	if got := store.open(t).OpenResult().Head.Lineage; got != twinLineage(2) {
		t.Fatal(got)
	}
	if !slices.ContainsFunc(store.logs, func(line string) bool { return strings.Contains(line, LedgerFileName) }) {
		t.Fatal(store.logs)
	}
}

func TestConcurrentDeletesAndResetsLeaveEveryLedgerEntryReadable(t *testing.T) {
	store := newTwinStore(t)
	session := store.open(t)
	var lineages []string
	for epoch := 1; epoch <= 10; epoch++ {
		lineages = append(lineages, workingset.NewLineage())
		twinReset(t, session, int64(epoch), lineages[epoch-1], []byte{0xb1})
	}
	var later []string
	for range 11 {
		later = append(later, workingset.NewLineage())
	}
	var wait sync.WaitGroup
	wait.Go(func() {
		for index, lineage := range later {
			if _, err := session.Reset(context.Background(), operation.Reset{Format: 1, Epoch: int64(11 + index), Lineage: lineage, Baseline: [][]byte{{0xb2}}}); err != nil {
				t.Error(err)
			}
		}
	})
	outcomes := make([]LineageDeleteOutcome, 9)
	errs := make([]error, 9)
	for index, lineage := range lineages[:9] {
		wait.Go(func() { outcomes[index], errs[index] = store.DeleteLineage(context.Background(), twinDoc, lineage) })
	}
	wait.Wait()
	for index := range outcomes {
		if errs[index] != nil || outcomes[index] != LineageDeletedOutcome {
			t.Fatalf("delete %d: %v %v", index, outcomes[index], errs[index])
		}
	}
	data, err := os.ReadFile(store.path(LedgerFileName))
	if err != nil || len(data)%LedgerEntrySize != 0 {
		t.Fatalf("%d bytes, %v", len(data), err)
	}
	for offset := 0; offset < len(data); offset += LedgerEntrySize {
		if _, ok := DecodeLineageEntry(data[offset : offset+LedgerEntrySize]); !ok {
			t.Fatalf("bad entry at %d", offset)
		}
	}
	listed, err := store.ListLineages(context.Background(), twinDoc)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, info := range listed {
		names = append(names, info.Lineage)
	}
	if want := append([]string{lineages[9]}, later...); !slices.Equal(names, want) {
		t.Fatalf("got %v\nwant %v", names, want)
	}
}

// History reads take no lock and never write, so they run beside a live
// session's appends.
func TestHistoryReadsRunBesideALiveSession(t *testing.T) {
	store := newTwinStore(t)
	session := store.open(t)
	twinReset(t, session, 1, twinLineage(1))
	var wait sync.WaitGroup
	wait.Go(func() {
		for n := 1; n <= 50; n++ {
			if _, err := twinAppend(t, session, n, byte(n)); err != nil {
				t.Error(err)
			}
		}
	})
	for range 20 {
		var last uint64
		for record, err := range store.ReadRecords(context.Background(), twinDoc, twinLineage(1), ^uint64(0)) {
			if err != nil {
				t.Fatal(err)
			}
			if record.Sequence != last+1 {
				t.Fatalf("sequence %d after %d", record.Sequence, last)
			}
			last = record.Sequence
		}
	}
	wait.Wait()
}

func TestACancelledCallWritesNothing(t *testing.T) {
	store := newTwinStore(t)
	session := store.open(t)
	twinReset(t, session, 1, twinLineage(1))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	before, _ := os.ReadFile(store.path("journal.1.1"))
	actor := "user-1"
	if _, err := session.Append(ctx, operation.Candidate{OperationID: twinOpID(1), ActorID: &actor, Update: []byte{1}, Digest: make([]byte, 32)}); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err := session.Reset(ctx, operation.Reset{Format: 1, Epoch: 2, Lineage: twinLineage(2)}); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, _, err := store.Open(ctx, twinDoc); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err := store.Purge(ctx, twinDoc); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if after, _ := os.ReadFile(store.path("journal.1.1")); !bytes.Equal(before, after) {
		t.Fatal("journal changed")
	}
}

// A failed fsync undoes its record, so the retry the caller must make is not
// told Duplicate for bytes no disk holds.
func TestAnAppendWhoseFlushFailsIsUndone(t *testing.T) {
	store := newTwinStore(t)
	session := store.open(t)
	twinReset(t, session, 1, twinLineage(1))
	journalPath := store.path("journal.1.1")
	failed := errors.New("injected fsync failure")
	defer func(saved func(*os.File) error) { syncJournal = saved }(syncJournal)
	syncJournal = func(*os.File) error { return failed }

	if _, err := twinAppend(t, session, 1, 0x01); !errors.Is(err, failed) {
		t.Fatal(err)
	}
	if info, _ := os.Stat(journalPath); info.Size() != 0 {
		t.Fatalf("%d bytes left", info.Size())
	}
	syncJournal = func(file *os.File) error { return file.Sync() }
	digest := sha256.Sum256([]byte{0x01})
	if lookup, err := session.FindCommitted(context.Background(), twinOpID(1), digest[:]); err != nil || lookup.Outcome != operation.NotCommitted {
		t.Fatalf("%v %v", lookup, err)
	}
	if result, err := twinAppend(t, session, 1, 0x01); err != nil || result.Outcome != operation.Committed || result.Sequence != 1 {
		t.Fatalf("%v %v", result, err)
	}
}

// A holder that took the document during the flush may reuse the sequence,
// so a flush that succeeds after the fence moved must not answer Committed.
func TestAnAppendWhoseFenceMovesDuringTheFlushIsNotCommitted(t *testing.T) {
	store := newTwinStore(t)
	session := store.open(t)
	twinReset(t, session, 1, twinLineage(1))
	defer func(saved func(*os.File) error) { syncJournal = saved }(syncJournal)
	syncJournal = func(file *os.File) error {
		if err := os.Remove(store.path(lockName)); err != nil {
			t.Fatal(err)
		}
		store.open(t)
		return file.Sync()
	}
	result, err := twinAppend(t, session, 1, 0x01)
	if !errors.Is(err, ErrFenceLost) {
		t.Fatalf("%v %v", result, err)
	}
}

// When the fence moved before the undo, the cut could delete the new holder's
// records, so the session leaves the bytes and stops answering.
func TestAnAppendThatCannotBeUndoneFaultsTheSession(t *testing.T) {
	store := newTwinStore(t)
	session := store.open(t)
	twinReset(t, session, 1, twinLineage(1))
	defer func(saved func(*os.File) error) { syncJournal = saved }(syncJournal)
	syncJournal = func(*os.File) error {
		if err := os.Remove(store.path(lockName)); err != nil {
			t.Fatal(err)
		}
		store.open(t)
		return errors.New("injected fsync failure")
	}
	if _, err := twinAppend(t, session, 1, 0x01); err == nil {
		t.Fatal("append answered")
	}
	syncJournal = func(file *os.File) error { return file.Sync() }
	if info, _ := os.Stat(store.path("journal.1.1")); info.Size() == 0 {
		t.Fatal("the record was cut after the fence moved")
	}
	_, err := session.FindCommitted(context.Background(), twinOpID(1), make([]byte, 32))
	// C# LocalCollabOperationStore.RequireFence, with its closing period.
	want := `collab: the journal for "doc-1" could not be flushed and this session can no longer say what is durable; reopen the document.`
	if err == nil || errors.Is(err, ErrFenceLost) || err.Error() != want {
		t.Fatalf("err = %v, want %q", err, want)
	}
}

// C# LocalCollabOperationStore.WriteCheckpointAsync lists the folder for
// stale checkpoints without a guard, so a listing failure after the
// publication throws even though the manifest names the new checkpoint.
func TestAListingFailureAfterACheckpointIsPublishedIsReported(t *testing.T) {
	store := newTwinStore(t)
	session := store.open(t)
	twinReset(t, session, 1, twinLineage(1))
	if _, err := twinAppend(t, session, 1, 0x01); err != nil {
		t.Fatal(err)
	}
	defer func(saved func(string, string) ([]string, error)) { globFiles = saved }(globFiles)
	injected := errors.New("injected listing failure")
	globFiles = func(string, string) ([]string, error) { return nil, injected }
	err := session.WriteCheckpoint(context.Background(), operation.Checkpoint{Through: 1, State: []byte{0x02}})
	if !errors.Is(err, injected) {
		t.Fatalf("err = %v, want the listing failure", err)
	}
	session.Close()
	reopened := store.open(t)
	if checkpoint := reopened.OpenResult().Checkpoint; checkpoint == nil || checkpoint.Through != 1 {
		t.Fatalf("reopened checkpoint = %+v, want the one through 1", checkpoint)
	}
}

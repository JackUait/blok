package blokmcp

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func record(principal, document string) HandleRecord {
	return HandleRecord{
		V: 1, ContractRevision: "c1", Principal: principal, ClientName: "Desktop", Actor: json.RawMessage(`{"id":"a","name":"A","kind":"agent"}`),
		DocumentID: "doc", Write: true, Document: json.RawMessage(document), History: json.RawMessage(`{}`),
	}
}

func filesStore(t *testing.T) (*FilesHandleStore, string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "handles")
	store, err := NewFilesHandleStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	return store, dir
}

const minute = time.Minute

func TestTheFilesStoreKeepsARecordUnderALease(t *testing.T) {
	ctx := context.Background()
	store, _ := filesStore(t)
	scopes := record("alice", `{"blocks":[]}`)
	scopes.Scopes = []string{}
	if added, err := store.TryAdd(ctx, "h1", scopes, 8, minute); err != nil || !added {
		t.Fatalf("%v %v", added, err)
	}
	lease, err := store.Acquire(ctx, "h1", minute, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	got := lease.Record()
	if got.Principal != "alice" || got.Scopes == nil || string(got.Document) != `{"blocks":[]}` {
		t.Fatalf("record %+v", got)
	}
	next := got
	next.Document = json.RawMessage(`{"blocks":[{"id":"p"}]}`)
	if err := lease.Save(ctx, next); err != nil {
		t.Fatal(err)
	}
	// A second acquire waits for the lease, then gives up.
	if _, err := store.Acquire(ctx, "h1", minute, 100*time.Millisecond); !errors.Is(err, ErrHandleBusy) {
		t.Fatalf("busy: %v", err)
	}
	if err := lease.Release(ctx); err != nil {
		t.Fatal(err)
	}
	again, err := store.Acquire(ctx, "h1", minute, time.Second)
	if err != nil || string(again.Record().Document) != `{"blocks":[{"id":"p"}]}` {
		t.Fatalf("%v %v", again, err)
	}
	// null scopes stay null, [] stays [].
	if again.Record().Scopes == nil {
		t.Fatal("[] scopes came back null")
	}
	if err := again.Remove(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Acquire(ctx, "h1", minute, time.Second); !errors.Is(err, ErrHandleUnknown) {
		t.Fatalf("removed: %v", err)
	}
}

// Count and add is one step per principal, across stores on one directory
// (processes): at most maxPerPrincipal adds win.
func TestTheFilesStoreCapIsAtomic(t *testing.T) {
	ctx := context.Background()
	store, dir := filesStore(t)
	other, err := NewFilesHandleStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	var won atomic.Int32
	var group sync.WaitGroup
	for index := range 20 {
		group.Go(func() {
			on := store
			if index%2 == 1 {
				on = other
			}
			added, err := on.TryAdd(ctx, "h"+string(rune('a'+index)), record("alice", `{"blocks":[]}`), 8, minute)
			if err != nil {
				t.Error(err)
			}
			if added {
				won.Add(1)
			}
		})
	}
	group.Wait()
	if won.Load() != 8 {
		t.Fatalf("added %d", won.Load())
	}
	if count, err := store.Count(ctx, "alice", minute); err != nil || count != 8 {
		t.Fatalf("count %d %v", count, err)
	}
	if count, _ := store.Count(ctx, "bob", minute); count != 0 {
		t.Fatalf("bob %d", count)
	}
}

// A lease another holder took over cannot save, release or remove.
func TestALostLeaseCannotWrite(t *testing.T) {
	ctx := context.Background()
	dir := filepath.Join(t.TempDir(), "handles")
	store, err := newFilesHandleStore(dir, 200*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.TryAdd(ctx, "h1", record("alice", `{"blocks":[]}`), 8, minute); err != nil {
		t.Fatal(err)
	}
	stale, err := store.Acquire(ctx, "h1", minute, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	// No heartbeat within the stale time: the next acquire takes it over.
	fresh, err := store.Acquire(ctx, "h1", minute, 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if err := stale.Save(ctx, record("alice", `{"blocks":["lost"]}`)); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("save: %v", err)
	}
	if err := stale.Renew(ctx); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("renew: %v", err)
	}
	if err := stale.Remove(ctx); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("remove: %v", err)
	}
	// Release of a lost lease does nothing, and leaves the new holder's lease.
	if err := stale.Release(ctx); err != nil {
		t.Fatalf("release: %v", err)
	}
	if err := fresh.Save(ctx, record("alice", `{"blocks":["kept"]}`)); err != nil {
		t.Fatal(err)
	}
	_ = fresh.Release(ctx)
	kept, err := store.Acquire(ctx, "h1", minute, time.Second)
	if err != nil || string(kept.Record().Document) != `{"blocks":["kept"]}` {
		t.Fatalf("%v %v", kept, err)
	}
}

// A lease its holder renews outlives the stale time; the store itself
// never renews, so an unrenewed one is taken over.
func TestARenewedLeaseIsNotTakenOver(t *testing.T) {
	ctx := context.Background()
	store, err := newFilesHandleStore(filepath.Join(t.TempDir(), "handles"), 300*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = store.TryAdd(ctx, "h1", record("alice", `{"blocks":[]}`), 8, minute)
	held, err := store.Acquire(ctx, "h1", minute, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	stop := make(chan struct{})
	renewed := make(chan struct{})
	go func() {
		defer close(renewed)
		for {
			select {
			case <-stop:
				return
			case <-time.After(50 * time.Millisecond):
				if err := held.Renew(ctx); err != nil {
					t.Error(err)
				}
			}
		}
	}()
	_, err = store.Acquire(ctx, "h1", minute, 700*time.Millisecond)
	close(stop)
	<-renewed
	if !errors.Is(err, ErrHandleBusy) {
		t.Fatalf("taken over: %v", err)
	}
	if err := held.Save(ctx, record("alice", `{"blocks":[]}`)); err != nil {
		t.Fatal(err)
	}
	// Unrenewed now: the next acquire takes it over.
	if _, err := store.Acquire(ctx, "h1", minute, 2*time.Second); err != nil {
		t.Fatalf("not taken over: %v", err)
	}
}

// One breaker at a time, and it deletes only the stale lock it saw: a lock
// another waiter took since stays.
func TestBreakingAStaleLockLeavesANewHolder(t *testing.T) {
	store, dir := filesStore(t)
	lock := filepath.Join(dir, "h1.lease")
	_ = os.WriteFile(lock, []byte("newer"), 0o600)
	old := time.Now().Add(-time.Hour)
	_ = os.Chtimes(lock, old, old)
	if store.breakStale(lock, "older") {
		t.Fatal("broke a lock it did not see")
	}
	if text, _ := os.ReadFile(lock); string(text) != "newer" {
		t.Fatalf("lock %q", text)
	}
	// Another breaker holds the guard: this one waits its turn.
	_ = os.WriteFile(lock+".break", []byte("other"), 0o600)
	if store.breakStale(lock, "newer") {
		t.Fatal("two breakers")
	}
	_ = os.Remove(lock + ".break")
	if !store.breakStale(lock, "newer") {
		t.Fatal("the stale lock it saw stayed")
	}
	if _, err := os.Stat(lock); !os.IsNotExist(err) {
		t.Fatalf("lock %v", err)
	}
}

// Sweep deletes idle records and only those: not a fresh one, not a
// leased one.
func TestSweepDeletesIdleRecordsOnly(t *testing.T) {
	ctx := context.Background()
	store, dir := filesStore(t)
	for _, handle := range []string{"idle", "fresh", "leased", "bobs"} {
		owner := "alice"
		if handle == "bobs" {
			owner = "bob"
		}
		if _, err := store.TryAdd(ctx, handle, record(owner, `{"blocks":[]}`), 8, minute); err != nil {
			t.Fatal(err)
		}
	}
	writeMetaUsed(t, dir, "bobs", time.Now().Add(-time.Hour))
	// Crash leftovers older than a lease can be: a temp file, a guard, a
	// lease and a record no meta names.
	ancient := time.Now().Add(-time.Hour)
	for _, name := range []string{".x.tmp", "gone.lease.break", "gone.lease", "gone.record.json"} {
		_ = os.WriteFile(filepath.Join(dir, name), nil, 0o600)
		_ = os.Chtimes(filepath.Join(dir, name), ancient, ancient)
	}
	held, err := store.Acquire(ctx, "leased", minute, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-time.Hour)
	for _, handle := range []string{"idle", "leased"} {
		writeMetaUsed(t, dir, handle, old)
	}
	if err := store.Sweep(ctx, minute); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "idle.record.json")); !os.IsNotExist(err) {
		t.Fatalf("idle record kept: %v", err)
	}
	// Bob's idle handle goes too: sweep is for every principal.
	for _, handle := range []string{"fresh", "leased"} {
		if _, err := os.Stat(filepath.Join(dir, handle+".record.json")); err != nil {
			t.Fatalf("%s: %v", handle, err)
		}
	}
	for _, name := range []string{"bobs.record.json", ".x.tmp", "gone.lease.break", "gone.lease", "gone.record.json"} {
		if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
			t.Fatalf("%s kept: %v", name, err)
		}
	}
	_ = held.Release(ctx)
}

func writeMetaUsed(t *testing.T, dir, handle string, at time.Time) {
	t.Helper()
	path := filepath.Join(dir, handle+".meta.json")
	text, _ := json.Marshal(map[string]any{"v": 1, "principal": "alice", "lastUsedMs": at.UnixMilli()})
	if err := os.WriteFile(path, text, 0o600); err != nil {
		t.Fatal(err)
	}
}

// A handle that is not a file-safe name is unknown before any file is
// touched.
func TestTheFilesStoreRefusesHandlesThatAreNotNames(t *testing.T) {
	ctx := context.Background()
	store, _ := filesStore(t)
	for _, handle := range []string{"../escape", "a/b", ".", "", string(make([]byte, 129))} {
		if _, err := store.Acquire(ctx, handle, minute, time.Second); !errors.Is(err, ErrHandleUnknown) {
			t.Fatalf("%q: %v", handle, err)
		}
		if _, err := store.TryAdd(ctx, handle, record("alice", `{"blocks":[]}`), 8, minute); err == nil {
			t.Fatalf("%q added", handle)
		}
	}
}

// The directory is made private; every file in it is 0600. A directory
// another user could reach, a link (even written with a trailing slash) or
// a file is refused.
// The files store cannot check privacy on Windows, so it refuses to start.
func TestTheFilesStoreIsRefusedOnWindows(t *testing.T) {
	previous := storePlatform
	storePlatform = "windows"
	t.Cleanup(func() { storePlatform = previous })
	var config *ConfigError
	if _, err := NewFilesHandleStore(filepath.Join(t.TempDir(), "handles")); !errors.As(err, &config) ||
		config.Message != "--handle-store files: is not supported on Windows; use your own store" {
		t.Fatalf("%v", err)
	}
}

func TestTheFilesStoreIsPrivate(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX modes")
	}
	ctx := context.Background()
	store, dir := filesStore(t)
	info, _ := os.Lstat(dir)
	if info.Mode().Perm() != 0o700 {
		t.Fatalf("dir %v", info.Mode())
	}
	_, _ = store.TryAdd(ctx, "h1", record("alice", `{"blocks":[]}`), 8, minute)
	lease, _ := store.Acquire(ctx, "h1", minute, time.Second)
	entries, _ := os.ReadDir(dir)
	for _, entry := range entries {
		info, _ := entry.Info()
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("%s %v", entry.Name(), info.Mode())
		}
	}
	_ = lease.Release(ctx)

	root := t.TempDir()
	open := filepath.Join(root, "open")
	_ = os.Mkdir(open, 0o700)
	_ = os.Chmod(open, 0o770)
	private := filepath.Join(root, "private")
	_ = os.Mkdir(private, 0o700)
	link := filepath.Join(root, "link")
	_ = os.Symlink(private, link)
	file := filepath.Join(root, "file")
	_ = os.WriteFile(file, nil, 0o600)
	for _, refused := range []string{open, link, link + "/", file} {
		var config *ConfigError
		if _, err := NewFilesHandleStore(refused); !errors.As(err, &config) {
			t.Fatalf("%s: %v", refused, err)
		}
	}
	// The owner must be the effective user, root included.
	previousUID := effectiveUID
	effectiveUID = func() int { return os.Geteuid() + 1 }
	_, err := NewFilesHandleStore(private)
	effectiveUID = previousUID
	var config *ConfigError
	if !errors.As(err, &config) {
		t.Fatalf("another owner: %v", err)
	}
	// Nothing makes the directory again later: a write fails.
	_ = os.RemoveAll(dir)
	if _, err := store.TryAdd(ctx, "h2", record("alice", `{"blocks":[]}`), 8, minute); err == nil {
		t.Fatal("the directory was made again")
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("dir %v", err)
	}
}

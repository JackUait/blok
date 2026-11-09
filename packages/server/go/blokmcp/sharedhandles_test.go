package blokmcp

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// sharedPair is two servers (two processes) on one source and one store.
type sharedPair struct {
	a, b  *Server
	dir   string
	store HandleStore
}

func newSharedPair(t *testing.T, store func(HandleStore) HandleStore) *sharedPair {
	t.Helper()
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "doc.json"), []byte(`{"blocks":[{"id":"p1","type":"paragraph","data":{"text":"Hello"}}]}`), 0o644)
	files, err := NewFilesHandleStore(filepath.Join(t.TempDir(), "handles"))
	if err != nil {
		t.Fatal(err)
	}
	var shared HandleStore = files
	if store != nil {
		shared = store(files)
	}
	pair := &sharedPair{dir: dir, store: shared}
	for _, at := range []**Server{&pair.a, &pair.b} {
		server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: dir}, HandleStore: shared})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(server.Close)
		*at = server
	}
	return pair
}

func call(t *testing.T, server *Server, principal, client, tool string, arguments string) map[string]any {
	t.Helper()
	who, err := server.actorFor(context.Background(), principal, &client)
	if err != nil {
		t.Fatal(err)
	}
	ran, err := server.dispatch(context.Background(), &toolCall{name: tool, arguments: json.RawMessage(arguments), caller: who})
	if err != nil {
		t.Fatal(err)
	}
	return structured(t, ran.answer)
}

func openOn(t *testing.T, server *Server, principal string) string {
	t.Helper()
	opened := call(t, server, principal, "Desktop", "blok_open", `{"documentId":"doc","write":true}`)
	handle, _ := opened["handle"].(string)
	if handle == "" {
		t.Fatalf("open %v", opened)
	}
	return handle
}

const setTitle = `[{"name":"doc.setTitle","args":{"title":"Saved"}}]`

// A handle opened on A runs on B, as its opener's caller; undo on A takes
// the batch back.
func TestASharedHandleRunsOnAnotherServer(t *testing.T) {
	pair := newSharedPair(t, nil)
	handle := openOn(t, pair.a, "alice")
	ran := call(t, pair.b, "alice", "Phone", "blok_execute", `{"handle":"`+handle+`","commands":[{"name":"block.update","args":{"id":"p1","data":{"text":"Edited"}}}]}`)
	if ran["ok"] != true {
		t.Fatalf("execute %v", ran)
	}
	saved, _ := os.ReadFile(filepath.Join(pair.dir, "doc.json"))
	// The opener's actor, not the caller's client.
	if !strings.Contains(string(saved), "Edited") || !strings.Contains(string(saved), "agent:alice:Desktop") {
		t.Fatalf("saved %s", saved)
	}
	if undo := call(t, pair.a, "alice", "Desktop", "blok_execute", `{"handle":"`+handle+`","commands":[{"name":"history.undo","args":{}}]}`); undo["ok"] != true {
		t.Fatalf("undo %v", undo)
	}
	if saved, _ := os.ReadFile(filepath.Join(pair.dir, "doc.json")); strings.Contains(string(saved), "Edited") {
		t.Fatalf("after undo %s", saved)
	}
	if other := call(t, pair.b, "bob", "Desktop", "blok_read", `{"handle":"`+handle+`"}`); errorCode(other) != "UNKNOWN_HANDLE" {
		t.Fatalf("bob %v", other)
	}
	if closed := call(t, pair.b, "alice", "Desktop", "blok_close", `{"handle":"`+handle+`"}`); closed["closed"] != true {
		t.Fatalf("close %v", closed)
	}
	if read := call(t, pair.a, "alice", "Desktop", "blok_read", `{"handle":"`+handle+`"}`); errorCode(read) != "UNKNOWN_HANDLE" {
		t.Fatalf("read after close %v", read)
	}
}

// The cap counts the store across servers.
func TestTheSharedCapCountsEveryServer(t *testing.T) {
	pair := newSharedPair(t, nil)
	for index := range 8 {
		server := pair.a
		if index%2 == 1 {
			server = pair.b
		}
		openOn(t, server, "alice")
	}
	for _, server := range []*Server{pair.a, pair.b} {
		if opened := call(t, server, "alice", "Desktop", "blok_open", `{"documentId":"doc"}`); errorCode(opened) != "HANDLE_LIMIT" {
			t.Fatalf("ninth %v", opened)
		}
	}
	openOn(t, pair.a, "bob")
}

// countingStore counts store calls and can fail lease saves or every call.
type countingStore struct {
	HandleStore
	calls      atomic.Int32
	failSave   atomic.Bool
	failRemove atomic.Bool
	failAll    atomic.Bool
	removed    atomic.Int32
	released   atomic.Int32
}

func (c *countingStore) fail() error {
	c.calls.Add(1)
	if c.failAll.Load() {
		return errors.New("redis password=hunter2 is down")
	}
	return nil
}

func (c *countingStore) Count(ctx context.Context, principal string, idle time.Duration) (int, error) {
	if err := c.fail(); err != nil {
		return 0, err
	}
	return c.HandleStore.Count(ctx, principal, idle)
}

func (c *countingStore) Acquire(ctx context.Context, handle string, idle, wait time.Duration) (HandleLease, error) {
	if err := c.fail(); err != nil {
		return nil, err
	}
	lease, err := c.HandleStore.Acquire(ctx, handle, idle, wait)
	if err != nil {
		return nil, err
	}
	return &countingLease{HandleLease: lease, store: c}, nil
}

type countingLease struct {
	HandleLease
	store *countingStore
}

func (l *countingLease) Save(ctx context.Context, record HandleRecord) error {
	if l.store.failSave.Load() {
		return errors.New("the store is full")
	}
	return l.HandleLease.Save(ctx, record)
}

func (l *countingLease) Remove(ctx context.Context) error {
	l.store.removed.Add(1)
	if l.store.failRemove.Load() {
		return errors.New("the store lost its connection")
	}
	return l.HandleLease.Remove(ctx)
}

func (l *countingLease) Release(ctx context.Context) error {
	l.store.released.Add(1)
	return l.HandleLease.Release(ctx)
}

// A record that cannot be saved after the source save: the answer stands,
// the handle is removed, and the next call answers UNKNOWN_HANDLE.
func TestAFailedRecordSaveClosesTheHandle(t *testing.T) {
	var counting *countingStore
	pair := newSharedPair(t, func(inner HandleStore) HandleStore {
		counting = &countingStore{HandleStore: inner}
		return counting
	})
	handle := openOn(t, pair.a, "alice")
	counting.failSave.Store(true)
	if ran := call(t, pair.b, "alice", "Desktop", "blok_execute", `{"handle":"`+handle+`","commands":`+setTitle+`}`); ran["ok"] != true {
		t.Fatalf("execute %v", ran)
	}
	if saved, _ := os.ReadFile(filepath.Join(pair.dir, "doc.json")); !strings.Contains(string(saved), "Saved") {
		t.Fatalf("saved %s", saved)
	}
	if counting.removed.Load() != 1 {
		t.Fatalf("removed %d", counting.removed.Load())
	}
	if read := call(t, pair.a, "alice", "Desktop", "blok_read", `{"handle":"`+handle+`"}`); errorCode(read) != "UNKNOWN_HANDLE" {
		t.Fatalf("read %v", read)
	}
}

// A store that fails answers SOURCE_UNAVAILABLE in fixed words; its text
// is only logged.
func TestAStoreErrorIsSourceUnavailable(t *testing.T) {
	var log strings.Builder
	previous := logOutput
	logOutput = &log
	t.Cleanup(func() { logOutput = previous })
	var counting *countingStore
	pair := newSharedPair(t, func(inner HandleStore) HandleStore {
		counting = &countingStore{HandleStore: inner}
		return counting
	})
	handle := openOn(t, pair.a, "alice")
	counting.failAll.Store(true)
	for _, answer := range []map[string]any{
		call(t, pair.b, "alice", "Desktop", "blok_read", `{"handle":"`+handle+`"}`),
		call(t, pair.b, "alice", "Desktop", "blok_open", `{"documentId":"doc"}`),
	} {
		failure, _ := answer["error"].(map[string]any)
		if failure["code"] != "SOURCE_UNAVAILABLE" || failure["retryable"] != true || failure["message"] != "The handle store is unavailable. Retry shortly." {
			t.Fatalf("answer %v", answer)
		}
	}
	if !strings.Contains(log.String(), "hunter2") {
		t.Fatalf("log %q", log.String())
	}
}

// A handle that is not a minted shape is unknown before the store sees it.
func TestAHandleThatIsNotOneNeverReachesTheStore(t *testing.T) {
	var counting *countingStore
	pair := newSharedPair(t, func(inner HandleStore) HandleStore {
		counting = &countingStore{HandleStore: inner}
		return counting
	})
	for _, handle := range []string{"../x", "a b", strings.Repeat("a", 129), ""} {
		quoted, _ := json.Marshal(handle)
		if read := call(t, pair.a, "alice", "Desktop", "blok_read", `{"handle":`+string(quoted)+`}`); errorCode(read) != "UNKNOWN_HANDLE" && errorCode(read) != "INVALID_ARGS" {
			t.Fatalf("%q: %v", handle, read)
		}
	}
	if counting.calls.Load() != 0 {
		t.Fatalf("store calls %d", counting.calls.Load())
	}
}

// editRecord rewrites the stored record of handle.
func editRecord(t *testing.T, store HandleStore, handle string, edit func(*HandleRecord)) {
	t.Helper()
	lease, err := store.Acquire(context.Background(), handle, time.Minute, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	record := lease.Record()
	edit(&record)
	if err := lease.Save(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	_ = lease.Release(context.Background())
}

// A record from a server with another tool contract answers VERSION_SKEW.
func TestARecordFromAnotherContractIsVersionSkew(t *testing.T) {
	pair := newSharedPair(t, nil)
	handle := openOn(t, pair.a, "alice")
	editRecord(t, pair.store, handle, func(record *HandleRecord) { record.ContractRevision = "another" })
	if read := call(t, pair.b, "alice", "Desktop", "blok_read", `{"handle":"`+handle+`"}`); errorCode(read) != "VERSION_SKEW" {
		t.Fatalf("read %v", read)
	}
	editRecord(t, pair.store, handle, func(record *HandleRecord) { record.V = 2 })
	if read := call(t, pair.b, "alice", "Desktop", "blok_read", `{"handle":"`+handle+`"}`); errorCode(read) != "UNKNOWN_HANDLE" {
		t.Fatalf("v2 %v", read)
	}
}

// Restored undo steps hold only for the document they were made on: a
// record whose document changed answers undo with CONFLICT.
func TestRestoredHistoryForAnotherDocumentConflicts(t *testing.T) {
	pair := newSharedPair(t, nil)
	handle := openOn(t, pair.a, "alice")
	if ran := call(t, pair.a, "alice", "Desktop", "blok_execute", `{"handle":"`+handle+`","commands":`+setTitle+`}`); ran["ok"] != true {
		t.Fatalf("execute %v", ran)
	}
	editRecord(t, pair.store, handle, func(record *HandleRecord) {
		record.Document = json.RawMessage(`{"blocks":[{"id":"x","type":"paragraph","data":{"text":"Elsewhere"}}]}`)
	})
	if undo := call(t, pair.b, "alice", "Desktop", "blok_execute", `{"handle":"`+handle+`","commands":[{"name":"history.undo","args":{}}]}`); errorCode(undo) != "CONFLICT" {
		t.Fatalf("undo %v", undo)
	}
}

// renewingStore counts renewals and can hold a call or a sweep.
type renewingStore struct {
	HandleStore
	renewals  atomic.Int32
	sweeping  chan struct{}
	sweepDone atomic.Bool
}

func (r *renewingStore) Acquire(ctx context.Context, handle string, idle, wait time.Duration) (HandleLease, error) {
	lease, err := r.HandleStore.Acquire(ctx, handle, idle, wait)
	if err != nil {
		return nil, err
	}
	return &renewingLease{HandleLease: lease, store: r}, nil
}

func (r *renewingStore) Sweep(ctx context.Context, idle time.Duration) error {
	if r.sweeping != nil {
		<-r.sweeping
		r.sweepDone.Store(true)
	}
	return r.HandleStore.Sweep(ctx, idle)
}

type renewingLease struct {
	HandleLease
	store *renewingStore
}

func (l *renewingLease) Renew(ctx context.Context) error {
	l.store.renewals.Add(1)
	return l.HandleLease.Renew(ctx)
}

// Blok renews a held lease while a call runs, and stops at release.
func TestBlokRenewsALeaseWhileACallRuns(t *testing.T) {
	previous := leaseRenewEvery
	leaseRenewEvery = 20 * time.Millisecond
	t.Cleanup(func() { leaseRenewEvery = previous })
	var renewing *renewingStore
	pair := newSharedPair(t, func(inner HandleStore) HandleStore {
		renewing = &renewingStore{HandleStore: inner}
		return renewing
	})
	handle := openOn(t, pair.a, "alice")
	pair.b.options.Authorize = func(context.Context, string, string, bool) (bool, error) {
		time.Sleep(200 * time.Millisecond)
		return true, nil
	}
	if read := call(t, pair.b, "alice", "Desktop", "blok_read", `{"handle":"`+handle+`"}`); read["ok"] == false {
		t.Fatalf("read %v", read)
	}
	during := renewing.renewals.Load()
	if during == 0 {
		t.Fatal("no renewal during a slow call")
	}
	time.Sleep(100 * time.Millisecond)
	if after := renewing.renewals.Load(); after != during {
		t.Fatalf("renewed after release: %d then %d", during, after)
	}
}

// A failed Remove still releases the lease, so the next call does not
// wait out the lease time.
func TestAFailedRemoveStillReleasesTheLease(t *testing.T) {
	for _, tool := range []string{"blok_execute", "blok_close"} {
		var counting *countingStore
		pair := newSharedPair(t, func(inner HandleStore) HandleStore {
			counting = &countingStore{HandleStore: inner}
			return counting
		})
		handle := openOn(t, pair.a, "alice")
		counting.failSave.Store(true)
		counting.failRemove.Store(true)
		arguments := `{"handle":"` + handle + `"}`
		if tool == "blok_execute" {
			arguments = `{"handle":"` + handle + `","commands":` + setTitle + `}`
		}
		call(t, pair.b, "alice", "Desktop", tool, arguments)
		if counting.removed.Load() != 1 || counting.released.Load() != 1 {
			t.Fatalf("%s: removed %d, released %d", tool, counting.removed.Load(), counting.released.Load())
		}
		lease, err := counting.HandleStore.Acquire(context.Background(), handle, time.Minute, 0)
		if err != nil {
			t.Fatalf("%s: the lease was kept: %v", tool, err)
		}
		_ = lease.Release(context.Background())
	}
}

// A record that does not read answers UNKNOWN_HANDLE.
func TestACorruptRecordIsAnUnknownHandle(t *testing.T) {
	pair := newSharedPair(t, nil)
	handle := openOn(t, pair.a, "alice")
	files, _ := pair.store.(*FilesHandleStore)
	if err := os.WriteFile(filepath.Join(files.dir, handle+".record.json"), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if read := call(t, pair.b, "alice", "Desktop", "blok_read", `{"handle":"`+handle+`"}`); errorCode(read) != "UNKNOWN_HANDLE" {
		t.Fatalf("read %v", read)
	}
}

// sweepingStore's Sweep runs sweep, and counts the sweeps at once.
type sweepingStore struct {
	HandleStore
	sweep   func(ctx context.Context)
	running atomic.Int32
	most    atomic.Int32
	sweeps  atomic.Int32
}

func (s *sweepingStore) Sweep(ctx context.Context, _ time.Duration) error {
	s.sweeps.Add(1)
	now := s.running.Add(1)
	defer s.running.Add(-1)
	for {
		most := s.most.Load()
		if now <= most || s.most.CompareAndSwap(most, now) {
			break
		}
	}
	s.sweep(ctx)
	return nil
}

func sweepingServer(t *testing.T, sweep func(ctx context.Context), idleMs string) (*Server, *sweepingStore) {
	t.Helper()
	previous := storeSweepEvery
	storeSweepEvery = 5 * time.Millisecond
	t.Cleanup(func() { storeSweepEvery = previous })
	files, err := NewFilesHandleStore(filepath.Join(t.TempDir(), "handles"))
	if err != nil {
		t.Fatal(err)
	}
	store := &sweepingStore{HandleStore: files, sweep: sweep}
	options := Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: t.TempDir()}, HandleStore: store}
	if idleMs != "" {
		options.HandleIdleMs = json.Number(idleMs)
	}
	server, err := New(options)
	if err != nil {
		t.Fatal(err)
	}
	return server, store
}

func waitFor(t *testing.T, what string, done func() bool) {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); !done(); time.Sleep(5 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
	}
}

// closingSession is a local handle that says when it closes.
type closingSession struct {
	session
	closed chan struct{}
}

func (c *closingSession) close() (int, bool) {
	close(c.closed)
	return 0, false
}

// A stuck store sweep runs apart: local handles still expire, and only one
// sweep runs at a time.
func TestAStuckStoreSweepDoesNotStopLocalExpiry(t *testing.T) {
	stuck := make(chan struct{})
	t.Cleanup(func() { close(stuck) })
	server, store := sweepingServer(t, func(context.Context) { <-stuck }, "50")
	t.Cleanup(server.Close)
	waitFor(t, "a sweep", func() bool { return store.sweeps.Load() > 0 })
	local := &closingSession{closed: make(chan struct{})}
	if _, err := server.handles.add("alice", "doc", local); err != nil {
		t.Fatal(err)
	}
	select {
	case <-local.closed:
	case <-time.After(5 * time.Second):
		t.Fatal("a local handle did not expire while a store sweep was stuck")
	}
	if most := store.most.Load(); most != 1 {
		t.Fatalf("%d sweeps ran at once", most)
	}
}

// A sweep has a deadline, and Close cancels it and returns after it.
func TestCloseCancelsAStoreSweep(t *testing.T) {
	saw := make(chan context.Context, 1)
	server, _ := sweepingServer(t, func(ctx context.Context) {
		select {
		case saw <- ctx:
		default:
		}
		<-ctx.Done()
	}, "")
	ctx := <-saw
	if deadline, ok := ctx.Deadline(); !ok || time.Until(deadline) > storeSweepTimeout {
		t.Fatalf("deadline %v %v", deadline, ok)
	}
	server.Close()
	if ctx.Err() != context.Canceled {
		t.Fatalf("after Close: %v", ctx.Err())
	}
}

// A sweep that ignores its context does not hold Close.
func TestCloseDoesNotWaitForAStuckStoreSweep(t *testing.T) {
	stuck := make(chan struct{})
	t.Cleanup(func() { close(stuck) })
	server, store := sweepingServer(t, func(context.Context) { <-stuck }, "")
	waitFor(t, "a sweep", func() bool { return store.sweeps.Load() > 0 })
	closed := make(chan struct{})
	go func() {
		server.Close()
		close(closed)
	}()
	select {
	case <-closed:
	case <-time.After(sweepStopWait + 2*time.Second):
		t.Fatal("Close waited for a stuck sweep")
	}
}

// A sweep past its deadline ends, and the next one runs.
func TestAStoreSweepTimesOut(t *testing.T) {
	previous := storeSweepTimeout
	storeSweepTimeout = 20 * time.Millisecond
	t.Cleanup(func() { storeSweepTimeout = previous })
	ended := atomic.Int32{}
	server, _ := sweepingServer(t, func(ctx context.Context) {
		<-ctx.Done()
		if ctx.Err() == context.DeadlineExceeded {
			ended.Add(1)
		}
	}, "")
	t.Cleanup(server.Close)
	waitFor(t, "two timed-out sweeps", func() bool { return ended.Load() >= 2 })
}

package room

import (
	"context"
	"testing"
	"time"
)

// Twins of the C# CollabRoomTests version-handle cases (load.go
// startVersionReadLocked / applyVersionLocked / settleVersionLocked).
// Room timers run on wall time here, so the C# defaults are shortened.

const (
	opOne   = "0123456789abcdef0123456789abcdef"
	opTwo   = "fedcba9876543210fedcba9876543210"
	opThree = "00112233445566778899aabbccddeeff"
)

func versionOptions(commitTimeout time.Duration) Options {
	return Options{
		ExportDebounce: 10 * time.Millisecond, ExportMaxDelay: 10 * time.Millisecond,
		EvictionLinger: 10 * time.Millisecond, CommitTimeout: commitTimeout,
		RetryBackoff: 10 * time.Millisecond, RetryBackoffCap: 10 * time.Millisecond,
	}
}

func lastSave(t *testing.T, r *textRoom) recordedSave {
	t.Helper()
	saves := r.endpoint.Saves()
	if len(saves) == 0 {
		t.Fatal("no save")
	}
	return saves[len(saves)-1]
}

// reloadedRoomWhoseVersionReadIsStuck is C# AReloadedRoomWhoseVersionReadIsStuck:
// a journal with a head, and an endpoint whose next GET hangs until gate closes.
func reloadedRoomWhoseVersionReadIsStuck(t *testing.T, r *textRoom, o Options) (*Manager, chan struct{}) {
	t.Helper()
	r.endpoint.Holds(t, testDoc, "hello", strPtr("v1"))
	first := r.newManager(t, o, true)
	member := v2Member()
	membership := joinSynced(t, first, testDoc, member)
	client := syncedClient(t, first, testDoc, "hello")
	sendOperation(t, membership, member, opOne, updateAppending(client, " world"))
	if err := first.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}
	r.endpoint.Holds(t, testDoc, "hello world", strPtr("v2"))
	gate := make(chan struct{})
	r.endpoint.setLoadGate(gate)
	return r.newManager(t, o, true), gate
}

// A PUT built while the load-time read is in flight would carry no version,
// so the checkpoint's projection waits it out.
func TestACheckpointProjectionWaitsForAVersionReadStillInFlight(t *testing.T) {
	r := newTextRoom()
	manager, gate := reloadedRoomWhoseVersionReadIsStuck(t, r, versionOptions(5*time.Second))
	member := v2Member()
	membership := joinSynced(t, manager, testDoc, member)
	client := syncedClient(t, manager, testDoc, "hello world")
	sendOperation(t, membership, member, opTwo, updateAppending(client, "!"))
	before := len(r.endpoint.Saves())

	if published, err := manager.Checkpoint(context.Background(), testDoc); err != nil || !published {
		t.Fatalf("checkpoint = %v, %v", published, err)
	}
	time.Sleep(50 * time.Millisecond)
	close(gate)
	waitUntil(t, "the checkpoint's projection", func() bool { return len(r.endpoint.Saves()) > before })

	if got := versionOf(lastSave(t, r)); got != "v2" {
		t.Fatalf("the projection carried %s, want v2", got)
	}
}

// A read the settle gave up on must never land over a newer handle the
// consumer answered the bare PUT with.
func TestAVersionReadTheSettleGaveUpOnCannotLandOverANewerHandle(t *testing.T) {
	r := newTextRoom()
	manager, gate := reloadedRoomWhoseVersionReadIsStuck(t, r, versionOptions(50*time.Millisecond))
	member := v2Member()
	membership := joinSynced(t, manager, testDoc, member)
	client := syncedClient(t, manager, testDoc, "hello world")
	sendOperation(t, membership, member, opTwo, updateAppending(client, "!"))
	before := len(r.endpoint.Saves())

	r.endpoint.setNextSaveVersion(strPtr("v5"))
	if published, err := manager.Checkpoint(context.Background(), testDoc); err != nil || !published {
		t.Fatalf("checkpoint = %v, %v", published, err)
	}
	waitUntil(t, "the projection the settle gave up waiting for", func() bool { return len(r.endpoint.Saves()) > before })
	// The premise: the settle gave up, so that PUT went bare.
	if got := versionOf(lastSave(t, r)); got != "<nil>" {
		t.Fatalf("the abandoned PUT carried %s", got)
	}

	close(gate)
	for range 5 {
		time.Sleep(10 * time.Millisecond)
		manager.Settle()
	}
	sendOperation(t, membership, member, opThree, updateAppending(client, "?"))
	if published, err := manager.Checkpoint(context.Background(), testDoc); err != nil || !published {
		t.Fatalf("second checkpoint = %v, %v", published, err)
	}
	second := len(r.endpoint.Saves())
	waitUntil(t, "the next projection", func() bool { return len(r.endpoint.Saves()) > second })

	if got := versionOf(lastSave(t, r)); got != "v5" {
		t.Fatalf("the next projection carried %s, want v5", got)
	}
}

// The same race on the drain's PUT.
func TestADrainProjectionWaitsForAVersionReadStillInFlight(t *testing.T) {
	r := newTextRoom()
	manager, gate := reloadedRoomWhoseVersionReadIsStuck(t, r, versionOptions(5*time.Second))
	member := v2Member()
	membership := joinSynced(t, manager, testDoc, member)
	client := syncedClient(t, manager, testDoc, "hello world")
	sendOperation(t, membership, member, opTwo, updateAppending(client, "!"))

	drained := make(chan error, 1)
	go func() { drained <- manager.Drain(context.Background()) }()
	time.Sleep(50 * time.Millisecond)
	close(gate)
	if err := <-drained; err != nil {
		t.Fatal(err)
	}

	if got := versionOf(lastSave(t, r)); got != "v2" {
		t.Fatalf("the drain's projection carried %s, want v2", got)
	}
}

// leaveAndEvict leaves and waits for the idle room to be evicted.
func leaveAndEvict(t *testing.T, manager *Manager, membership interface{ Leave() }, what string) {
	t.Helper()
	membership.Leave()
	waitUntil(t, what, func() bool { return manager.LiveRoomCount() == 0 })
}

// The version is captured when the room starts diverging from the record,
// not when it builds a PUT: read then, it would be the host's own save's
// version, and the write-back would land over that save.
func TestTheVersionIsCapturedAtLoadSoAHostSaveAfterwardsStillRefusesTheWriteBack(t *testing.T) {
	r := newTextRoom()
	r.endpoint.Holds(t, testDoc, "hello", strPtr("v1"))
	manager := r.newManager(t, versionOptions(5*time.Second), true)
	member := v2Member()
	first := joinSynced(t, manager, testDoc, member)
	client := syncedClient(t, manager, testDoc, "hello")
	sendOperation(t, first, member, opOne, updateAppending(client, " world"))
	leaveAndEvict(t, manager, first, "the seeded room to be evicted")

	// The room reloads while the consumer's record is at v2 ...
	r.endpoint.Holds(t, testDoc, "hello world", strPtr("v2"))
	nextMember := v2Member()
	second := joinSynced(t, manager, testDoc, nextMember)
	next := syncedClient(t, manager, testDoc, "hello world")
	sendOperation(t, second, nextMember, opTwo, updateAppending(next, "!"))

	// ... and the host saves after that, moving its record on to v3.
	r.endpoint.Holds(t, testDoc, "host wins", strPtr("v3"))
	leaveAndEvict(t, manager, second, "the reloaded room to be evicted")

	if got := versionOf(lastSave(t, r)); got != "v2" {
		t.Fatalf("the write-back carried %s, want v2", got)
	}
}

// A room loaded from the journal never seeded, so only the version read
// gives its write-back a version.
func TestAReloadedJournalRoomStillCarriesTheDocumentVersion(t *testing.T) {
	r := newTextRoom()
	r.endpoint.Holds(t, testDoc, "hello", strPtr("v1"))
	manager := r.newManager(t, versionOptions(5*time.Second), true)
	member := v2Member()
	first := joinSynced(t, manager, testDoc, member)
	client := syncedClient(t, manager, testDoc, "hello")
	sendOperation(t, first, member, opOne, updateAppending(client, " world"))
	leaveAndEvict(t, manager, first, "the seeded room to be evicted")

	// The host saved meanwhile, so its record moved to v2.
	r.endpoint.Holds(t, testDoc, "hello world", strPtr("v2"))
	nextMember := v2Member()
	second := joinSynced(t, manager, testDoc, nextMember)
	next := syncedClient(t, manager, testDoc, "hello world")
	sendOperation(t, second, nextMember, opTwo, updateAppending(next, "!"))
	leaveAndEvict(t, manager, second, "the reloaded room to be evicted")

	saves := r.endpoint.Saves()
	if got := versionOf(saves[len(saves)-1]); got != "v2" {
		t.Fatalf("the reloaded write-back carried %s, want v2", got)
	}
	if got := versionOf(saves[0]); got != "v1" {
		t.Fatalf("the first write-back carried %s, want v1", got)
	}
}

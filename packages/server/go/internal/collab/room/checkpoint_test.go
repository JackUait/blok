package room

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab"
	"github.com/JackUait/blok/packages/server/go/internal/collab/wire"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// Twins of the C# CollabRoomTests checkpoint-policy cases (ops.go
// checkpointLocked and the threshold in sync.go).

const (
	opFour = "11111111222222223333333344444444"
	opFive = "5555555566666666777777778888888a"
	opSix  = "99999999aaaaaaaabbbbbbbbcccccccd"
)

func updateDeleting(doc *yjs.Doc, index, length int) []byte {
	text := doc.GetText(contentRoot)
	return doc.Transact(func(tx *yjs.Transaction) { text.Delete(tx, index, length) })
}

func checkpoint(t *testing.T, manager *Manager) bool {
	t.Helper()
	published, err := manager.Checkpoint(context.Background(), testDoc)
	if err != nil {
		t.Fatal(err)
	}
	return published
}

// checkpointRoom is a journal room on "hello" with one synced v2 writer.
func checkpointRoom(t *testing.T, o Options) (*textRoom, *Manager, *fakeMember, collab.Membership, *yjs.Doc) {
	t.Helper()
	r := newTextRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.newManager(t, o, true)
	writer := v2Member()
	membership := joinSynced(t, manager, testDoc, writer)
	client := syncedClient(t, manager, testDoc, "hello")
	return r, manager, writer, membership, client
}

// A failure that is not one of the fatal kinds is retried, but a run of
// them stops the room: the session may never succeed again.
func TestARunOfCheckpointFailuresStopsTheRoom(t *testing.T) {
	r, manager, writer, membership, client := checkpointRoom(t, DefaultOptions())
	sendOperation(t, membership, writer, opOne, updateAppending(client, "!"))
	r.operations.setFailCheckpoints(func(string) error {
		return errors.New("collab: this session can no longer say what is durable; reopen the document")
	})

	for range 2 {
		if checkpoint(t, manager) {
			t.Fatal("a failed checkpoint was reported published")
		}
		if closes := writer.closed(); len(closes) != 0 {
			t.Fatalf("closed after a retryable failure: %v", closes)
		}
	}
	if checkpoint(t, manager) {
		t.Fatal("a failed checkpoint was reported published")
	}

	if closes := writer.closed(); len(closes) != 1 || closes[0] != collab.CloseCommitUnavailable {
		t.Fatalf("closes = %v, want one CommitUnavailable", closes)
	}
	if manager.LiveRoomCount() != 0 {
		t.Fatal("the stopped room is still loaded")
	}
}

// A checkpoint published while a PUT is in flight still earns its own
// projection, through the owed mark.
func TestACheckpointPublishedDuringAnInFlightProjectionStillEarnsOne(t *testing.T) {
	gate := make(chan struct{})
	r := newTextRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	r.endpoint.setSaveGate(gate)
	manager := r.newManager(t, versionOptions(5*time.Second), true)
	writer := v2Member()
	membership := joinSynced(t, manager, testDoc, writer)
	client := syncedClient(t, manager, testDoc, "hello")
	sendOperation(t, membership, writer, opOne, updateAppending(client, "!"))

	if !checkpoint(t, manager) {
		t.Fatal("the first checkpoint was not published")
	}
	waitUntil(t, "the projection the first checkpoint earned", func() bool { return len(r.endpoint.Saves()) == 1 })

	sendOperation(t, membership, writer, opTwo, updateAppending(client, "?"))
	if !checkpoint(t, manager) {
		t.Fatal("the second checkpoint was not published")
	}
	r.endpoint.setSaveGate(nil)
	close(gate)
	waitUntil(t, "the projection the second checkpoint earned", func() bool { return len(r.endpoint.Saves()) >= 2 })
	time.Sleep(50 * time.Millisecond)

	if got := r.operations.Checkpoint(testDoc); got == nil || got.Through != 2 {
		t.Fatalf("checkpoint = %+v, want through 2", got)
	}
	saves := r.endpoint.Saves()
	if len(saves) != 2 || saves[1].data != `{"text":"hello!?"}` {
		t.Fatalf("saves = %+v, want two, the second hello!?", saves)
	}
}

// A checkpoint replaces the operations it covers on replay, so it never
// names a sequence past the journal's, nor carries bytes past it.
func TestCheckpointThroughNeverExceedsDurableThrough(t *testing.T) {
	r, manager, writer, membership, client := checkpointRoom(t, OptionsWith(func(ro *Options) { ro.CheckpointOperationThreshold = 3 }))
	for _, op := range [][2]string{{opOne, "a"}, {opTwo, "b"}, {opThree, "c"}} {
		sendOperation(t, membership, writer, op[0], updateAppending(client, op[1]))
	}
	manager.Settle()

	published, head := r.operations.Checkpoint(testDoc), r.operations.Head(testDoc)
	if published == nil {
		t.Fatal("three committed operations crossed the threshold and nothing was published")
	}
	if published.Through > head.DurableThrough {
		t.Fatalf("the checkpoint names sequence %d, past the journal's %d", published.Through, head.DurableThrough)
	}
	replica := newClient()
	if _, err := replica.ApplyUpdate(published.State); err != nil {
		t.Fatal(err)
	}
	if got := docText(replica); got != "helloabc" || published.Through != 3 || head.DurableThrough != 3 {
		t.Fatalf("checkpoint holds %q through %d, durable %d", got, published.Through, head.DurableThrough)
	}

	// The cursor moves only where a checkpoint was written.
	sendOperation(t, membership, writer, opFour, updateAppending(client, "d"))
	manager.Settle()
	if got := r.operations.Checkpoint(testDoc).Through; got != 3 {
		t.Fatalf("checkpoint through %d, want 3", got)
	}
	if got := r.operations.Head(testDoc).DurableThrough; got != 4 {
		t.Fatalf("durable through %d, want 4", got)
	}
}

// A parked update holds the cursor back: the threshold may fire, the
// checkpoint may not.
func TestPendingYjsStatePreventsCheckpointAdvancement(t *testing.T) {
	r, manager, writer, membership, _ := checkpointRoom(t, OptionsWith(func(ro *Options) { ro.CheckpointOperationThreshold = 2 }))
	author := syncedClient(t, manager, testDoc, "hello")
	other := syncedClient(t, manager, testDoc, "hello")
	first := updateAppending(author, "a")
	second := updateAppending(author, "b")

	sendOperation(t, membership, writer, opOne, updateAppending(other, "z"))
	sendOperation(t, membership, writer, opTwo, second)
	manager.Settle()

	if got := r.operations.Checkpoint(testDoc); got != nil {
		t.Fatalf("a checkpoint over parked state was published: %+v", got)
	}
	if got := len(r.operations.Committed(testDoc)); got != 2 {
		t.Fatalf("%d committed, want 2: the gate refuses the accelerator, never the journal", got)
	}

	sendOperation(t, membership, writer, opThree, first)
	manager.Settle()
	published := r.operations.Checkpoint(testDoc)
	if published == nil || published.Through != 3 {
		t.Fatalf("checkpoint = %+v, want through 3 once the dependency landed", published)
	}
	replica := newClient()
	if _, err := replica.ApplyUpdate(published.State); err != nil {
		t.Fatal(err)
	}
	if got, want := docText(replica), exportedText(t, manager, testDoc); got != want {
		t.Fatalf("checkpoint reads %q, room reads %q", got, want)
	}
}

// Three consecutive failures close the room, so a failed checkpoint costs
// another whole threshold before it retries.
func TestAFailedCheckpointCostsAnotherThresholdBeforeItRetries(t *testing.T) {
	r, manager, writer, membership, client := checkpointRoom(t, OptionsWith(func(ro *Options) { ro.CheckpointOperationThreshold = 2 }))
	var attempts atomic.Int32
	r.operations.setFailCheckpoints(func(string) error {
		attempts.Add(1)
		return errors.New("the journal disk is busy")
	})

	for _, op := range []string{opOne, opTwo, opThree, opFour} {
		sendOperation(t, membership, writer, op, updateAppending(client, "!"))
	}
	manager.Settle()

	if got := attempts.Load(); got != 2 {
		t.Fatalf("%d attempts over four operations, want 2", got)
	}
	if closes := writer.closed(); len(closes) != 0 || manager.LiveRoomCount() != 1 {
		t.Fatalf("closes = %v, live rooms = %d", closes, manager.LiveRoomCount())
	}
	if got := r.operations.Checkpoint(testDoc); got != nil {
		t.Fatalf("checkpoint = %+v", got)
	}
	var runs []string
	r.mu.Lock()
	for _, line := range r.log {
		if strings.Contains(line, "could not publish a checkpoint") {
			runs = append(runs, line[strings.Index(line, "(")+1:strings.Index(line, ")")])
		}
	}
	r.mu.Unlock()
	if strings.Join(runs, ",") != "1 of 3,2 of 3" {
		t.Fatalf("failure runs = %q", runs)
	}

	r.operations.setFailCheckpoints(nil)
	for _, op := range []string{opFive, opSix} {
		sendOperation(t, membership, writer, op, updateAppending(client, "?"))
	}
	manager.Settle()
	if got := r.operations.Checkpoint(testDoc); got == nil || got.Through != 6 {
		t.Fatalf("checkpoint = %+v, want through 6 after the disk recovered", got)
	}
}

// Bytes accumulate across operations toward the byte threshold.
func TestTheByteThresholdPublishesWhereTheOperationCountWouldNot(t *testing.T) {
	const byteThreshold = 300
	r, manager, writer, membership, client := checkpointRoom(t, OptionsWith(func(ro *Options) { ro.CheckpointOperationThreshold = 1000; ro.CheckpointByteThreshold = byteThreshold }))

	sendOperation(t, membership, writer, opOne, updateAppending(client, strings.Repeat("y", 200)))
	manager.Settle()
	first := len(r.operations.Committed(testDoc)[0].Update)
	if first >= byteThreshold {
		t.Fatalf("the premise is gone: the first operation crosses on its own at %d bytes", first)
	}
	if got := r.operations.Checkpoint(testDoc); got != nil {
		t.Fatalf("checkpoint after one operation: %+v", got)
	}

	sendOperation(t, membership, writer, opTwo, updateAppending(client, strings.Repeat("x", 200)))
	manager.Settle()
	second := len(r.operations.Committed(testDoc)[1].Update)
	if second >= byteThreshold || first+second < byteThreshold {
		t.Fatalf("the premise is gone: %d and %d bytes against %d", first, second, byteThreshold)
	}
	if got := r.operations.Checkpoint(testDoc); got == nil || got.Through != 2 {
		t.Fatalf("checkpoint = %+v, want through 2 after %d bytes", got, first+second)
	}
}

// The trigger is in the durable step every write path shares: a v1 write
// and an HTTP edit count too.
func TestTheThresholdCountsEveryJournalledWriteNotJustV2Operations(t *testing.T) {
	r := newTextRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.newManager(t, OptionsWith(func(ro *Options) { ro.CheckpointOperationThreshold = 2 }), true)
	stock := join(t, manager, testDoc, &fakeMember{source: collab.SourceClientV1, write: true})
	client := syncedClient(t, manager, testDoc, "hello")

	if err := stock.Receive(context.Background(), syncFrame(t, wire.SyncUpdate{Update: updateAppending(client, "a")})); err != nil {
		t.Fatal(err)
	}
	if result := httpEdit(t, manager, testDoc, opOne, "x"); result.Status != EditApplied {
		t.Fatalf("edit = %v (%v)", result.Status, result.Err)
	}
	manager.Settle()

	if got := r.operations.Checkpoint(testDoc); got == nil || got.Through != 2 {
		t.Fatalf("checkpoint = %+v, want through 2", got)
	}
	committed := r.operations.Committed(testDoc)
	if len(committed) != 2 || committed[0].Source != 1 || committed[1].Source != 2 {
		t.Fatalf("committed sources = %+v, want ClientV1 then HttpEdit", committed)
	}
}

// A deletion of text this room never received is parked, and the
// checkpoint is refused while it is.
func TestACheckpointIsRefusedWhileTheEngineHoldsPendingState(t *testing.T) {
	r := newTextRoom()
	r.endpoint.Holds(t, testDoc, "hello", nil)
	manager := r.newManager(t, DefaultOptions(), true)
	membership := join(t, manager, testDoc, &fakeMember{source: collab.SourceClientV1, write: true})

	stray := newClient()
	updateAppending(stray, "zz")
	if err := membership.Receive(context.Background(), syncFrame(t, wire.SyncUpdate{Update: updateDeleting(stray, 0, 2)})); err != nil {
		t.Fatal(err)
	}

	if got := len(r.operations.Committed(testDoc)); got != 1 {
		t.Fatalf("%d committed, want 1", got)
	}
	if checkpoint(t, manager) {
		t.Fatal("a checkpoint was published over pending state")
	}
	if got := r.operations.Checkpoint(testDoc); got != nil {
		t.Fatalf("checkpoint = %+v", got)
	}
}

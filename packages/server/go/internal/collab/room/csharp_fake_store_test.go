package room

import (
	"context"
	"crypto/sha256"
	"errors"
	"iter"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/internal/collab/workingset"
)

// Twins of the C# FakeCollabOperationStoreTests: the fake journal's own
// contract, which the room tests rely on.

const fakeDoc = "doc"

// historyJournal adds the C# fake's history and purge stores. It is a
// separate type because the manager type-asserts PurgeStore and HistoryStore,
// and the room tests expect the plain fake to be neither.
type historyJournal struct{ *fakeJournal }

var (
	_ HistoryStore = historyJournal{}
	_ PurgeStore   = historyJournal{}
)

func (j historyJournal) Purge(_ context.Context, id string) (journal.PurgeOutcome, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	d := j.doc(id)
	if d.open {
		return journal.PurgeOpenElsewhere, nil
	}
	d.purged = true
	d.baseline, d.records, d.superseded = nil, nil, nil
	d.checkpoint, d.head = nil, nil
	return journal.Purged, nil
}

func (j historyJournal) IsPurged(_ context.Context, id string) (bool, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	d := j.docs[id]
	return d != nil && d.purged, nil
}

// lineages is oldest first, current last, one per lineage id (the newest).
func (j historyJournal) lineages(id string) []fakeLineage {
	d := j.doc(id)
	if d.purged {
		return nil
	}
	all := slices.Clone(d.superseded)
	if d.head != nil {
		all = append(all, fakeLineage{head: *d.head, baseline: slices.Clone(d.baseline), records: slices.Clone(d.records), createdAt: d.createdAt, current: true})
	}
	var out []fakeLineage
	for i, l := range all {
		if !slices.ContainsFunc(all[i+1:], func(newer fakeLineage) bool { return newer.head.Lineage == l.head.Lineage }) {
			out = append(out, l)
		}
	}
	return out
}

func (j historyJournal) find(id, lineage string) *fakeLineage {
	for _, l := range j.lineages(id) {
		if l.head.Lineage == lineage {
			return &l
		}
	}
	return nil
}

func (j historyJournal) ListLineages(_ context.Context, id string) ([]journal.LineageInfo, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	var out []journal.LineageInfo
	for _, l := range j.lineages(id) {
		out = append(out, journal.LineageInfo{Lineage: l.head.Lineage, Epoch: l.head.Epoch, Format: l.head.Format, CreatedAt: l.createdAt, Current: l.current})
	}
	return out, nil
}

func (j historyJournal) ReadBaseline(_ context.Context, id, lineage string) ([][]byte, bool, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if l := j.find(id, lineage); l != nil {
		return slices.Clone(l.baseline), true, nil
	}
	return nil, false, nil
}

func (j historyJournal) ReadHeaders(ctx context.Context, id, lineage string) iter.Seq2[journal.RecordHeader, error] {
	return func(yield func(journal.RecordHeader, error) bool) {
		for record, err := range j.ReadRecords(ctx, id, lineage, ^uint64(0)) {
			if !yield(journal.RecordHeader{Sequence: record.Sequence, CommittedAt: record.CommittedAt, ActorID: record.ActorID}, err) || err != nil {
				return
			}
		}
	}
}

func (j historyJournal) ReadRecords(ctx context.Context, id, lineage string, through uint64) iter.Seq2[operation.Record, error] {
	return func(yield func(operation.Record, error) bool) {
		j.mu.Lock()
		var records []operation.Record
		if l := j.find(id, lineage); l != nil {
			for _, r := range l.records {
				if r.Sequence <= through {
					records = append(records, r)
				}
			}
		}
		j.mu.Unlock()
		for _, r := range records {
			if err := ctx.Err(); err != nil {
				yield(operation.Record{}, err)
				return
			}
			if !yield(r, nil) {
				return
			}
		}
	}
}

func (j historyJournal) DeleteLineage(_ context.Context, id, lineage string) (journal.LineageDeleteOutcome, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	d := j.doc(id)
	if d.purged {
		return journal.LineagePurged, nil
	}
	if d.head != nil && d.head.Lineage == lineage {
		return journal.LineageCurrent, nil
	}
	// Every superseded copy goes, so an older one sharing the id is not
	// listed in its place.
	before := len(d.superseded)
	d.superseded = slices.DeleteFunc(d.superseded, func(old fakeLineage) bool { return old.head.Lineage == lineage })
	if len(d.superseded) < before {
		return journal.LineageDeletedOutcome, nil
	}
	return journal.LineageNotFound, nil
}

func fakeDigest(update byte) []byte {
	sum := sha256.Sum256([]byte{update})
	return sum[:]
}

func fakeCandidate(operationID string, update byte) operation.Candidate {
	actor := "actor"
	return operation.Candidate{OperationID: operationID, ActorID: &actor, Source: operation.SourceClientV2, Update: []byte{update}, Digest: fakeDigest(update)}
}

func fakeReset(epoch int64, lineage string) operation.Reset {
	if lineage == "" {
		lineage = strings.Repeat("a", workingset.LineageLength)
	}
	return operation.Reset{Format: workingset.CurrentFormat, Epoch: epoch, Lineage: lineage}
}

func openFake(t *testing.T, store *fakeJournal) *fakeSession {
	t.Helper()
	outcome, session, err := store.Open(context.Background(), fakeDoc)
	if err != nil || outcome != journal.Opened {
		t.Fatalf("open: %v %v", outcome, err)
	}
	return session.(*fakeSession)
}

func openSeeded(t *testing.T, store *fakeJournal) *fakeSession {
	t.Helper()
	session := openFake(t, store)
	if _, err := session.Reset(context.Background(), fakeReset(0, "")); err != nil {
		t.Fatal(err)
	}
	return session
}

func mustAppend(t *testing.T, session *fakeSession, operationID string, update byte) operation.AppendResult {
	t.Helper()
	result, err := session.Append(context.Background(), fakeCandidate(operationID, update))
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func mustLookup(t *testing.T, session *fakeSession, operationID string, update byte) operation.Lookup {
	t.Helper()
	result, err := session.FindCommitted(context.Background(), operationID, fakeDigest(update))
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func committedIDs(store *fakeJournal) []string {
	var ids []string
	for _, r := range store.Committed(fakeDoc) {
		ids = append(ids, r.OperationID)
	}
	return ids
}

func TestAssignsSequencesFromOneAndExposesCommittedRecords(t *testing.T) {
	store := newFakeJournal()
	session := openSeeded(t, store)
	defer session.Close()

	first := mustAppend(t, session, "a", 1)
	second := mustAppend(t, session, "b", 2)

	if first != (operation.AppendResult{Outcome: operation.Committed, Sequence: 1}) {
		t.Fatalf("first = %+v", first)
	}
	if second != (operation.AppendResult{Outcome: operation.Committed, Sequence: 2}) {
		t.Fatalf("second = %+v", second)
	}
	if ids := committedIDs(store); !slices.Equal(ids, []string{"a", "b"}) {
		t.Fatalf("committed = %v", ids)
	}
	if head := store.Head(fakeDoc); head == nil || head.DurableThrough != 2 {
		t.Fatalf("head = %+v", head)
	}
}

func TestReportsWhetherAnOperationIdIsAlreadyCommitted(t *testing.T) {
	store := newFakeJournal()
	session := openSeeded(t, store)
	defer session.Close()

	unseen := mustLookup(t, session, "a", 1)
	mustAppend(t, session, "a", 1)
	retry := mustLookup(t, session, "a", 1)
	reused := mustLookup(t, session, "a", 9)

	if unseen != (operation.Lookup{Outcome: operation.NotCommitted, Sequence: 0}) {
		t.Fatalf("unseen = %+v", unseen)
	}
	if retry != (operation.Lookup{Outcome: operation.LookupDuplicate, Sequence: 1}) {
		t.Fatalf("retry = %+v", retry)
	}
	if reused != (operation.Lookup{Outcome: operation.LookupConflict, Sequence: 1}) {
		t.Fatalf("reused = %+v", reused)
	}
	// The answer covers this session's own commit, not the state at open.
	if len(session.OpenResult().Tail) != 0 {
		t.Fatalf("tail = %v", session.OpenResult().Tail)
	}
}

func TestDeduplicatesARetryAndConflictsOnADifferentDigest(t *testing.T) {
	store := newFakeJournal()
	session := openSeeded(t, store)
	defer session.Close()
	mustAppend(t, session, "a", 1)

	retry := mustAppend(t, session, "a", 1)
	reused := mustAppend(t, session, "a", 9)

	if retry != (operation.AppendResult{Outcome: operation.AppendDuplicate, Sequence: 1}) {
		t.Fatalf("retry = %+v", retry)
	}
	if reused != (operation.AppendResult{Outcome: operation.AppendConflict, Sequence: 1}) {
		t.Fatalf("reused = %+v", reused)
	}
	if n := len(store.Committed(fakeDoc)); n != 1 {
		t.Fatalf("committed %d records", n)
	}
}

func TestFailsAnAppendWithoutJournallingIt(t *testing.T) {
	store := newFakeJournal()
	session := openSeeded(t, store)
	defer session.Close()
	disk := errors.New("disk")
	store.failAppends = func(string) error { return disk }

	if _, err := session.Append(context.Background(), fakeCandidate("a", 1)); !errors.Is(err, disk) {
		t.Fatalf("err = %v", err)
	}
	if n := len(store.Committed(fakeDoc)); n != 0 {
		t.Fatalf("committed %d records", n)
	}
}

func TestKeepsAnUnknownOutcomeDurableSoTheRetryReadsAsADuplicate(t *testing.T) {
	store := newFakeJournal()
	session := openSeeded(t, store)
	defer session.Close()
	lost := errors.New("acknowledgement lost")
	store.failAppends = func(string) error { return lost }
	store.commitBeforeFailing = true

	if _, err := session.Append(context.Background(), fakeCandidate("a", 1)); !errors.Is(err, lost) {
		t.Fatalf("err = %v", err)
	}
	// The caller saw a failure; the store is durable.
	if n := len(store.Committed(fakeDoc)); n != 1 {
		t.Fatalf("committed %d records", n)
	}
	store.failAppends = nil
	store.commitBeforeFailing = false

	retry := mustAppend(t, session, "a", 1)

	if retry != (operation.AppendResult{Outcome: operation.AppendDuplicate, Sequence: 1}) {
		t.Fatalf("retry = %+v", retry)
	}
}

func TestHoldsAnAppendUntilTheStoreIsReleased(t *testing.T) {
	store := newFakeJournal()
	session := openSeeded(t, store)
	defer session.Close()
	release := make(chan struct{})
	store.beforeAppend = release

	type answer struct {
		result operation.AppendResult
		err    error
	}
	done := make(chan answer, 1)
	go func() {
		result, err := session.Append(context.Background(), fakeCandidate("a", 1))
		done <- answer{result, err}
	}()

	select {
	case got := <-done:
		t.Fatalf("the append finished while held: %+v", got)
	case <-time.After(50 * time.Millisecond):
	}
	if n := len(store.Committed(fakeDoc)); n != 0 {
		t.Fatalf("committed %d records while held", n)
	}
	close(release)

	got := <-done
	if got.err != nil || got.result.Outcome != operation.Committed {
		t.Fatalf("append = %+v", got)
	}
}

func TestReportsASecondOpenAsHeldElsewhereUntilTheFirstIsDisposed(t *testing.T) {
	store := newFakeJournal()
	first := openFake(t, store)

	outcome, second, err := store.Open(context.Background(), fakeDoc)

	if err != nil || outcome != journal.DocumentOpenElsewhere || second != nil {
		t.Fatalf("second open = %v %v %v", outcome, second, err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	if outcome, _, _ := store.Open(context.Background(), fakeDoc); outcome != journal.Opened {
		t.Fatalf("open after dispose = %v", outcome)
	}
}

func TestRefusesEveryCallOnceTheFenceIsLost(t *testing.T) {
	store := newFakeJournal()
	session := openSeeded(t, store)
	defer session.Close()
	store.StealFence(fakeDoc)
	ctx := context.Background()

	if _, err := session.Append(ctx, fakeCandidate("a", 1)); !errors.Is(err, journal.ErrFenceLost) {
		t.Fatalf("append: %v", err)
	}
	if err := session.WriteCheckpoint(ctx, operation.Checkpoint{Through: 1, State: []byte{7}}); !errors.Is(err, journal.ErrFenceLost) {
		t.Fatalf("checkpoint: %v", err)
	}
	if _, err := session.Reset(ctx, fakeReset(2, "")); !errors.Is(err, journal.ErrFenceLost) {
		t.Fatalf("reset: %v", err)
	}
	if _, err := session.FindCommitted(ctx, "a", fakeDigest(1)); !errors.Is(err, journal.ErrFenceLost) {
		t.Fatalf("lookup: %v", err)
	}
	if n := len(store.Committed(fakeDoc)); n != 0 {
		t.Fatalf("committed %d records", n)
	}
}

func TestOpensAnUnseededDocumentWithNoHead(t *testing.T) {
	store := newFakeJournal()
	session := openFake(t, store)
	defer session.Close()

	opened := session.OpenResult()
	if opened.Head != nil || len(opened.Baseline) != 0 || len(opened.Tail) != 0 || opened.Checkpoint != nil {
		t.Fatalf("open result = %+v", opened)
	}

	head, err := session.Reset(context.Background(), fakeReset(0, ""))

	if err != nil || head.DurableThrough != 0 {
		t.Fatalf("reset = %+v %v", head, err)
	}
	// OpenResult is the state at open and never moves with the session.
	if session.OpenResult().Head != nil {
		t.Fatalf("open result head moved to %+v", session.OpenResult().Head)
	}
}

func TestHandsTheCheckpointAndTheTailAfterItToTheNextOpen(t *testing.T) {
	store := newFakeJournal()
	writer := openSeeded(t, store)
	mustAppend(t, writer, "a", 1)
	mustAppend(t, writer, "b", 2)
	if err := writer.WriteCheckpoint(context.Background(), operation.Checkpoint{Through: 1, State: []byte{42}}); err != nil {
		t.Fatal(err)
	}
	writer.Close()

	session := openFake(t, store)
	defer session.Close()

	opened := session.OpenResult()
	if opened.Checkpoint == nil || opened.Checkpoint.Through != 1 {
		t.Fatalf("checkpoint = %+v", opened.Checkpoint)
	}
	var tail []string
	for _, r := range opened.Tail {
		tail = append(tail, r.OperationID)
	}
	if !slices.Equal(tail, []string{"b"}) {
		t.Fatalf("tail = %v", tail)
	}
	if opened.Head == nil || opened.Head.DurableThrough != 2 {
		t.Fatalf("head = %+v", opened.Head)
	}
}

func outOfRange(err error) bool {
	var argument *journal.ArgumentError
	return errors.As(err, &argument) && argument.OutOfRange
}

func TestRefusesACheckpointPastTheCommittedSequence(t *testing.T) {
	store := newFakeJournal()
	session := openSeeded(t, store)
	defer session.Close()
	mustAppend(t, session, "a", 1)

	err := session.WriteCheckpoint(context.Background(), operation.Checkpoint{Through: 2, State: []byte{42}})

	if !outOfRange(err) {
		t.Fatalf("err = %v", err)
	}
}

func TestAcceptsARepublishedCheckpointAtTheSameSequence(t *testing.T) {
	store := newFakeJournal()
	session := openSeeded(t, store)
	defer session.Close()
	ctx := context.Background()
	mustAppend(t, session, "a", 1)
	mustAppend(t, session, "b", 2)
	if err := session.WriteCheckpoint(ctx, operation.Checkpoint{Through: 2, State: []byte{42}}); err != nil {
		t.Fatal(err)
	}

	if err := session.WriteCheckpoint(ctx, operation.Checkpoint{Through: 2, State: []byte{42}}); err != nil {
		t.Fatalf("republish: %v", err)
	}
	if err := session.WriteCheckpoint(ctx, operation.Checkpoint{Through: 1, State: []byte{42}}); !outOfRange(err) {
		t.Fatalf("step back: %v", err)
	}
}

func TestForgetsOperationIdsFromASupersededLineage(t *testing.T) {
	store := newFakeJournal()
	session := openSeeded(t, store)
	defer session.Close()
	mustAppend(t, session, "a", 1)

	head, err := session.Reset(context.Background(), fakeReset(1, strings.Repeat("b", 32)))
	if err != nil {
		t.Fatal(err)
	}
	lookup := mustLookup(t, session, "a", 1)

	if head.Epoch != 1 || head.DurableThrough != 0 {
		t.Fatalf("head = %+v", head)
	}
	if lookup.Outcome != operation.NotCommitted {
		t.Fatalf("lookup = %+v", lookup)
	}
	if got := mustAppend(t, session, "a", 1); got.Sequence != 1 {
		t.Fatalf("append = %+v", got)
	}
}

func TestReleasesNothingOnDisposeOnceTheFenceIsLost(t *testing.T) {
	store := newFakeJournal()
	session := openSeeded(t, store)
	store.StealFence(fakeDoc)

	session.Close()

	// The fence belongs to whoever reclaimed it.
	if outcome, _, _ := store.Open(context.Background(), fakeDoc); outcome != journal.DocumentOpenElsewhere {
		t.Fatalf("open = %v", outcome)
	}
}

func TestThrowsObjectDisposedOnEveryCallAfterDisposal(t *testing.T) {
	store := newFakeJournal()
	session := openSeeded(t, store)
	session.Close()
	ctx := context.Background()
	disposed := func(err error) bool { return err != nil && err.Error() == "the session is disposed" }

	if _, err := session.FindCommitted(ctx, "a", fakeDigest(1)); !disposed(err) {
		t.Fatalf("lookup: %v", err)
	}
	if _, err := session.Append(ctx, fakeCandidate("a", 1)); !disposed(err) {
		t.Fatalf("append: %v", err)
	}
	if err := session.WriteCheckpoint(ctx, operation.Checkpoint{Through: 1, State: []byte{7}}); !disposed(err) {
		t.Fatalf("checkpoint: %v", err)
	}
	if _, err := session.Reset(ctx, fakeReset(1, "")); !disposed(err) {
		t.Fatalf("reset: %v", err)
	}
}

func TestKeepsSupersededLineagesForHistory(t *testing.T) {
	store := historyJournal{newFakeJournal()}
	first := strings.Repeat("a", workingset.LineageLength)
	second := strings.Repeat("b", workingset.LineageLength)
	ctx := context.Background()
	session := openFake(t, store.fakeJournal)
	defer session.Close()
	if _, err := session.Reset(ctx, operation.Reset{Format: workingset.CurrentFormat, Epoch: 1, Lineage: first, Baseline: [][]byte{{0xb1}}}); err != nil {
		t.Fatal(err)
	}
	mustAppend(t, session, "a", 1)
	mustAppend(t, session, "b", 2)
	if _, err := session.Reset(ctx, fakeReset(2, second)); err != nil {
		t.Fatal(err)
	}
	mustAppend(t, session, "c", 3)

	listed, err := store.ListLineages(ctx, fakeDoc)
	if err != nil {
		t.Fatal(err)
	}
	var sequences []uint64
	for header, err := range store.ReadHeaders(ctx, fakeDoc, first) {
		if err != nil {
			t.Fatal(err)
		}
		sequences = append(sequences, header.Sequence)
	}
	var records []string
	for record, err := range store.ReadRecords(ctx, fakeDoc, first, 1) {
		if err != nil {
			t.Fatal(err)
		}
		records = append(records, record.OperationID)
	}

	var lineages []string
	var current []bool
	var epochs []int64
	for _, info := range listed {
		lineages, current, epochs = append(lineages, info.Lineage), append(current, info.Current), append(epochs, info.Epoch)
	}
	if !slices.Equal(lineages, []string{first, second}) {
		t.Fatalf("lineages = %v", lineages)
	}
	if !slices.Equal(current, []bool{false, true}) {
		t.Fatalf("current = %v", current)
	}
	if !slices.Equal(epochs, []int64{1, 2}) {
		t.Fatalf("epochs = %v", epochs)
	}
	if !slices.Equal(sequences, []uint64{1, 2}) {
		t.Fatalf("header sequences = %v", sequences)
	}
	if !slices.Equal(records, []string{"a"}) {
		t.Fatalf("records = %v", records)
	}
	baseline, found, err := store.ReadBaseline(ctx, fakeDoc, first)
	if err != nil || !found || len(baseline) != 1 || !slices.Equal(baseline[0], []byte{0xb1}) {
		t.Fatalf("baseline = %v %v %v", baseline, found, err)
	}
	if _, found, _ := store.ReadBaseline(ctx, fakeDoc, strings.Repeat("f", workingset.LineageLength)); found {
		t.Fatal("an unknown lineage has a baseline")
	}

	// The current lineage's accessors are unchanged by the history kept beside it.
	if ids := committedIDs(store.fakeJournal); !slices.Equal(ids, []string{"c"}) {
		t.Fatalf("committed = %v", ids)
	}
	if head := store.Head(fakeDoc); head == nil || head.Lineage != second {
		t.Fatalf("head = %+v", head)
	}
}

func TestDeletesOnlyASupersededLineage(t *testing.T) {
	store := historyJournal{newFakeJournal()}
	first := strings.Repeat("a", workingset.LineageLength)
	second := strings.Repeat("b", workingset.LineageLength)
	ctx := context.Background()
	session := openFake(t, store.fakeJournal)
	if _, err := session.Reset(ctx, fakeReset(1, first)); err != nil {
		t.Fatal(err)
	}
	if _, err := session.Reset(ctx, fakeReset(2, second)); err != nil {
		t.Fatal(err)
	}
	session.Close()

	for _, step := range []struct {
		lineage string
		want    journal.LineageDeleteOutcome
	}{{second, journal.LineageCurrent}, {first, journal.LineageDeletedOutcome}, {first, journal.LineageNotFound}} {
		if got, err := store.DeleteLineage(ctx, fakeDoc, step.lineage); err != nil || got != step.want {
			t.Fatalf("delete %s = %v %v, want %v", step.lineage[:1], got, err, step.want)
		}
	}
	listed, _ := store.ListLineages(ctx, fakeDoc)
	if len(listed) != 1 || listed[0].Lineage != second {
		t.Fatalf("listed = %+v", listed)
	}

	if _, err := store.Purge(ctx, fakeDoc); err != nil {
		t.Fatal(err)
	}

	if got, _ := store.DeleteLineage(ctx, fakeDoc, second); got != journal.LineagePurged {
		t.Fatalf("delete after purge = %v", got)
	}
	if listed, _ := store.ListLineages(ctx, fakeDoc); len(listed) != 0 {
		t.Fatalf("listed after purge = %+v", listed)
	}
}

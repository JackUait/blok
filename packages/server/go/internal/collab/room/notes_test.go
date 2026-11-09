package room

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

// Twins of C# CollabHistoryManagerTests.Notes.

func (b *histBench) notedManager(t *testing.T, notes RecordNotes, logs *[]string) *Manager {
	t.Helper()
	manager := NewManager(ManagerOptions{
		Store: b.store, Endpoint: b.endpoint, Converter: histConverter(t, nil),
		Room: Options{Now: func() time.Time { return histNow }},
		Log: func(line string) {
			if logs != nil {
				*logs = append(*logs, line)
			}
		},
		Operations: b.journal, Notes: notes,
	})
	t.Cleanup(func() { _ = manager.Drain(context.Background()) })
	return manager
}

func TestEachJournalledEditLeavesANoteOfItsActorsKind(t *testing.T) {
	b := histNewBench(t)
	notes := NewMemoryRecordNotes()
	manager := b.notedManager(t, notes, nil)
	histBlocks(t, manager)
	histEditOps(t, manager, []convert.EditOp{histUpdate(t, "a", "1")}, "u1")
	histEditOps(t, manager, []convert.EditOp{histUpdate(t, "a", "2")}, "agent:alice:claude-code")
	histEditOps(t, manager, []convert.EditOp{histUpdate(t, "a", "3")}, "")

	written, _ := notes.Read(context.Background(), histDoc, b.lineage(t))
	if written[1] != (RecordNote{Kind: KindPerson}) {
		t.Errorf("note 1 = %+v", written[1])
	}
	// The id's text never makes a ticket user an agent.
	if written[2] != (RecordNote{Kind: KindPerson}) {
		t.Errorf("note 2 = %+v", written[2])
	}
	if _, ok := written[3]; ok {
		t.Errorf("an edit with no actor has a note: %+v", written[3])
	}
}

func TestAnAgentEditNotesTheAgentAndItsPerson(t *testing.T) {
	b := histNewBench(t)
	notes := NewMemoryRecordNotes()
	manager := b.notedManager(t, notes, nil)
	histBlocks(t, manager)
	op := histUpdate(t, "a", "by an agent")
	digest, _ := convert.CanonicalBodyDigest([]convert.EditOp{op})
	result, err := manager.AgentEdit(context.Background(), histDoc, func(context.Context, *yjs.Doc) ([]convert.EditOp, error) {
		return []convert.EditOp{op}, nil
	}, histID(), digest, "bot-7", nil, nil, ClassifyActor("bot-7", true, "carol"))
	if err != nil || result.Status != EditApplied {
		t.Fatalf("edit = %v, %v", result.Status, err)
	}
	written, _ := notes.Read(context.Background(), histDoc, b.lineage(t))
	if written[1] != (RecordNote{Kind: KindAgent, OnBehalfOf: "carol"}) {
		t.Errorf("note = %+v", written[1])
	}
}

func TestTheListCarriesActorKindsOnlyWithARecordNotesStore(t *testing.T) {
	b := histNewBench(t)
	manager := b.notedManager(t, NewMemoryRecordNotes(), nil)
	histBlocks(t, manager)
	histEditOps(t, manager, []convert.EditOp{histUpdate(t, "a", "1")}, "u1")
	histEditOps(t, manager, []convert.EditOp{histUpdate(t, "a", "2")}, "agent:u1:cursor")

	noted, err := manager.History(context.Background(), histDoc, 0)
	if err != nil {
		t.Fatal(err)
	}
	want := []ActorKind{
		{ID: "u1", Note: RecordNote{Kind: KindPerson}},
		{ID: "agent:u1:cursor", Note: RecordNote{Kind: KindPerson}},
	}
	first := noted.Versions[0]
	if !first.Noted || len(first.ActorKinds) != 2 || first.ActorKinds[0] != want[0] || first.ActorKinds[1] != want[1] {
		t.Errorf("kinds = %+v", first)
	}
	if !noted.Versions[1].Noted || len(noted.Versions[1].ActorKinds) != 0 {
		t.Errorf("baseline = %+v", noted.Versions[1])
	}
	plain, _ := b.manager(t, Options{}).History(context.Background(), histDoc, 0)
	for _, version := range plain.Versions {
		if version.Noted {
			t.Errorf("a list without notes has kinds: %+v", version)
		}
	}
}

func TestByActorStartsAVersionWhenTheActorChanges(t *testing.T) {
	b := histNewBench(t)
	manager := b.manager(t, Options{})
	histBlocks(t, manager)
	histEditOps(t, manager, []convert.EditOp{histUpdate(t, "a", "1")}, "u1")
	histEditOps(t, manager, []convert.EditOp{histUpdate(t, "a", "2")}, "u1")
	histEditOps(t, manager, []convert.EditOp{histUpdate(t, "a", "3")}, "u2")

	byTime, _ := manager.History(context.Background(), histDoc, 0)
	byActor, _ := manager.HistoryBy(context.Background(), histDoc, 0, true)
	sequences := func(list HistoryList) []uint64 {
		var out []uint64
		for _, version := range list.Versions {
			out = append(out, version.Sequence)
		}
		return out
	}
	if got := sequences(byTime); len(got) != 2 || got[0] != 3 {
		t.Errorf("by time = %v", got)
	}
	if got := sequences(byActor); len(got) != 3 || got[0] != 3 || got[1] != 2 || got[2] != 0 {
		t.Errorf("by actor = %v", got)
	}
}

type failingNotes struct{}

func (failingNotes) Write(context.Context, string, string, uint64, RecordNote) error {
	return errors.New("the notes are down")
}

func (failingNotes) Read(context.Context, string, string) (map[uint64]RecordNote, error) {
	return nil, errors.New("the notes are down")
}

func TestANoteThatFailsNeverFailsTheEdit(t *testing.T) {
	b := histNewBench(t)
	var logs []string
	manager := b.notedManager(t, failingNotes{}, &logs)
	histBlocks(t, manager)
	histEditOps(t, manager, []convert.EditOp{histUpdate(t, "a", "kept")}, "u1")

	if records := b.committed(t); len(records) != 1 {
		t.Fatalf("%d records", len(records))
	}
	found := false
	for _, line := range logs {
		found = found || strings.Contains(line, "record note")
	}
	if !found {
		t.Errorf("no log line names the record note: %q", logs)
	}
}

func TestARestoreIsNotedAsItsRestorer(t *testing.T) {
	b := histNewBench(t)
	notes := NewMemoryRecordNotes()
	manager := b.notedManager(t, notes, nil)
	histBlocks(t, manager)
	histEditOps(t, manager, []convert.EditOp{histUpdate(t, "a", "1")}, "u1")
	lineage := b.lineage(t)

	status, edit := histRestoreAs(t, manager, lineage, 0, histID(), "u2", nil)
	if status != HistoryReady || edit.Status != EditApplied {
		t.Fatalf("restore = %v, %+v", status, edit)
	}
	written, _ := notes.Read(context.Background(), histDoc, lineage)
	if written[2] != (RecordNote{Kind: KindPerson}) {
		t.Errorf("note = %+v", written[2])
	}
}

package blokagent

import (
	"context"
	"crypto/rand"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/room"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
)

// The room half of the scenario runner; the contract is on the C# reader,
// AgentServerScenarioTests.cs.

type scenarioRoom struct {
	*testRoom
	doc     string
	journal *failingJournal
}

// failingJournal is the scenario's journal with the failListings knob.
type failingJournal struct {
	room.LocalJournal
	mu    sync.Mutex
	armed bool
	left  int
}

var (
	_ room.OperationStore = (*failingJournal)(nil)
	_ room.HistoryStore   = (*failingJournal)(nil)
	_ room.PurgeStore     = (*failingJournal)(nil)
)

func (j *failingJournal) ListLineages(ctx context.Context, docID string) ([]journal.LineageInfo, error) {
	j.mu.Lock()
	fail := j.armed && j.left <= 0
	if j.armed {
		j.left--
	}
	j.mu.Unlock()
	if fail {
		return nil, &journal.InvalidDataError{Message: "The scenario's journal cannot list lineages."}
	}
	return j.LocalJournal.ListLineages(ctx, docID)
}

func (j *failingJournal) arm(after int) {
	j.mu.Lock()
	j.armed, j.left = true, after
	j.mu.Unlock()
}

func (r *scenarioRoom) healListings() {
	if r != nil && r.journal != nil {
		r.journal.mu.Lock()
		r.journal.armed = false
		r.journal.mu.Unlock()
	}
}

func openScenarioRoom(t *testing.T, spec, seed *jsjson.Node) *scenarioRoom {
	t.Helper()
	var store *failingJournal
	var operations room.OperationStore
	if given := lookup(spec, "journal"); given == nil || given.Kind != jsjson.KindFalse {
		store = &failingJournal{LocalJournal: newLocalJournal(t)}
		operations = store
	}
	rooms := newTestRoomOn(t, operations, nil, nil)
	doc := "agent-room"
	if value, ok := stringOf(lookup(spec, "doc")); ok {
		doc = value
	}
	written, _ := write(seed)
	rooms.docs.hold(doc, written)
	if held := lookup(spec, "held"); held != nil {
		for _, m := range held.Members {
			key, _ := m.Key()
			text, _ := write(m.Value)
			rooms.docs.hold(key.String(), text)
		}
	}
	return &scenarioRoom{testRoom: rooms, doc: doc, journal: store}
}

func (r *scenarioRoom) stepDoc(step *jsjson.Node) string {
	if r == nil {
		return ""
	}
	if doc, ok := stringOf(lookup(step, "doc")); ok {
		return doc
	}
	return r.doc
}

func (r *scenarioRoom) head(t *testing.T, doc string) string {
	t.Helper()
	state, err := r.manager.State(context.Background(), doc)
	if err != nil {
		t.Fatal(err)
	}
	return receiptHead(state.Head)
}

func (r *scenarioRoom) state(t *testing.T, doc string) *jsjson.Node {
	t.Helper()
	state, err := r.manager.State(context.Background(), doc)
	if err != nil {
		t.Fatal(err)
	}
	if state.Status != room.StateReady {
		return nil
	}
	return mustParse(t, string(state.JSON))
}

func (r *scenarioRoom) blocks(t *testing.T, doc string) string {
	t.Helper()
	blocks := lookup(r.state(t, doc), "blocks")
	if blocks == nil {
		return ""
	}
	written, _ := write(blocks)
	return written
}

var revisionRef = regexp.MustCompile(`\{rev:(\d+)\}`)

func fillScenario(text string, revisions map[int]string, head string) string {
	if strings.Contains(text, "{lineage}") {
		text = strings.ReplaceAll(text, "{lineage}", head[:strings.LastIndexByte(head, ':')])
	}
	return revisionRef.ReplaceAllStringFunc(text, func(match string) string {
		at, _ := strconv.Atoi(revisionRef.FindStringSubmatch(match)[1])
		return revisions[at]
	})
}

// headed puts the room head in place of every "@head" string.
func headed(node *jsjson.Node, head string) *jsjson.Node {
	if value, ok := stringOf(node); ok && value == "@head" {
		return str(head)
	}
	for i, item := range node.Items {
		node.Items[i] = headed(item, head)
	}
	for i := range node.Members {
		node.Members[i].Value = headed(node.Members[i].Value, head)
	}
	return node
}

func stepActor(step *jsjson.Node) Actor {
	given := lookup(step, "actor")
	if given == nil {
		return scenarioActor
	}
	id, _ := stringOf(lookup(given, "id"))
	name, _ := stringOf(lookup(given, "name"))
	actor := Actor{ID: id, Name: name}
	if onBehalfOf, ok := stringOf(lookup(given, "onBehalfOf")); ok {
		actor.OnBehalfOf = &onBehalfOf
	}
	return actor
}

func sequenceOf(head string) int64 {
	if head == "" {
		return 0
	}
	value, _ := strconv.ParseInt(head[strings.LastIndexByte(head, ':')+1:], 10, 64)
	return value
}

func (r *scenarioRoom) hostStep(t *testing.T, where, run string, step *jsjson.Node, fill func(string) string) {
	t.Helper()
	ctx := context.Background()
	doc := r.stepDoc(step)
	switch run {
	case "peer":
		body, _ := write(lookup(step, "ops"))
		ops, err := convert.ParseEditOps([]byte(fill(body)))
		if err != nil {
			t.Fatalf("%s: %v", where, err)
		}
		digest := make([]byte, 32)
		_, _ = rand.Read(digest)
		edit, err := r.manager.Edit(ctx, doc, ops, newGUID(), digest, "human-2", nil)
		if err != nil || edit.Status != room.EditApplied {
			t.Fatalf("%s: peer edit %v, %v", where, edit.Status, err)
		}
	case "reset":
		if _, err := r.manager.Reset(ctx, doc); err != nil {
			t.Fatalf("%s: %v", where, err)
		}
	case "drain":
		if err := r.manager.Drain(ctx); err != nil {
			t.Fatalf("%s: %v", where, err)
		}
	case "failListings":
		after, _ := strconv.Atoi(string(lookup(step, "after").Raw()))
		r.journal.arm(after)
	case "purge":
		if _, err := r.manager.Purge(ctx, doc, func(context.Context) (bool, error) { return true, nil }); err != nil {
			t.Fatalf("%s: %v", where, err)
		}
	case "restore":
		version, _ := stringOf(lookup(step, "version"))
		version = fill(version)
		colon := strings.LastIndexByte(version, ':')
		sequence, _ := strconv.ParseUint(version[colon+1:], 10, 64)
		status, edit, err := r.manager.Restore(ctx, doc, version[:colon], sequence, newGUID(), "human-2", nil)
		if err != nil || status != room.HistoryReady || edit == nil || edit.Status != room.EditApplied {
			t.Fatalf("%s: restore %v %+v %v", where, status, edit, err)
		}
	}
}

func (r *scenarioRoom) check(t *testing.T, where, doc string, expect *jsjson.Node, execution Execution, head, beforeHead, beforeBlocks string,
	byStep map[int]string, seed *jsjson.Node) {
	t.Helper()
	if want, ok := stringOf(lookup(expect, "revision")); ok && want != execution.Revision {
		t.Errorf("%s: revision %q, want %q\n%s", where, execution.Revision, want, execution.ResultJSON)
	}
	if want := lookup(expect, "committed"); want != nil {
		count, _ := strconv.ParseInt(string(want.Raw()), 10, 64)
		if got := sequenceOf(head) - sequenceOf(beforeHead); got != count {
			t.Errorf("%s: committed %d, want %d\n%s", where, got, count, execution.ResultJSON)
		}
	}
	if want := lookup(expect, "blocksUnchanged"); want != nil && want.Kind == jsjson.KindTrue && r.blocks(t, doc) != beforeBlocks {
		t.Errorf("%s: the blocks changed\n%s", where, execution.ResultJSON)
	}
	if pointers := lookup(expect, "state"); pointers != nil {
		stateDoc := doc
		if other, ok := stringOf(lookup(expect, "stateDoc")); ok {
			stateDoc = other
		}
		checkPointers(t, where+" state", r.state(t, stateDoc), pointers)
	}
	if want := lookup(expect, "stateMatchesSaved"); want != nil {
		at, _ := strconv.Atoi(string(want.Raw()))
		ids := map[string]bool{}
		for _, block := range records(lookup(seed, "blocks")) {
			if id, ok := idOf(block); ok {
				ids[id] = true
			}
		}
		saved := stable(t, normalizeDocument(mustParse(t, byStep[at]), ids))
		live := stable(t, normalizeDocument(r.state(t, doc), ids))
		if saved != live {
			t.Errorf("%s: the room holds\n%s\nthe stored runner saved\n%s", where, live, saved)
		}
	}
}

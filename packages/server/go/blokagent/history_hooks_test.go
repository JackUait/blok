package blokagent

import (
	"context"
	"iter"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/room"
)

// Twins of C# BlokAgentVersionHistoryTests.Hooks: the host's history read and
// window hooks reach an agent's history commands.

// spacedJournal: record N reads as committed at the Unix epoch plus N
// spacings, a day when unset.
type spacedJournal struct {
	room.LocalJournal
	spacing time.Duration
}

func (j spacedJournal) ReadHeaders(ctx context.Context, docID, lineage string) iter.Seq2[journal.RecordHeader, error] {
	return func(yield func(journal.RecordHeader, error) bool) {
		for header, err := range j.LocalJournal.ReadHeaders(ctx, docID, lineage) {
			if err == nil {
				spacing := j.spacing
				if spacing == 0 {
					spacing = 24 * time.Hour
				}
				header.CommittedAt = time.Unix(0, 0).UTC().Add(spacing * time.Duration(header.Sequence))
			}
			if !yield(header, err) {
				return
			}
		}
	}
}

// hookedRoom answers the hooks from canRead and cut, and keeps who was asked.
func hookedRoom(t *testing.T, canRead bool, cut *time.Time) (*testRoom, *[]string) {
	t.Helper()
	return hookedRoomSpaced(t, canRead, cut, 0)
}

func hookedRoomSpaced(t *testing.T, canRead bool, cut *time.Time, spacing time.Duration) (*testRoom, *[]string) {
	t.Helper()
	r := newTestRoomOn(t, spacedJournal{newLocalJournal(t), spacing}, nil, nil)
	r.docs.hold("d", historySeed)
	var asked []string
	r.executor.rooms.policy = func(_ context.Context, userID, docID string) (HistoryAccess, error) {
		asked = append(asked, userID+" "+docID)
		access := HistoryAccess{CanRead: canRead}
		if cut != nil {
			access.Window = new(time.Since(*cut))
		}
		return access, nil
	}
	return r, &asked
}

func editTwice(t *testing.T, r *testRoom) string {
	t.Helper()
	okIn(t, r, "d", `{"commands":[{"name":"text.replace","args":{"id":"p","with":"One"}}]}`)
	second := okIn(t, r, "d", `{"commands":[{"name":"text.replace","args":{"id":"p","with":"Two"}}]}`)
	return second.Revision[:strings.LastIndexByte(second.Revision, ':')]
}

func TestAWindowHidesOlderVersionsFromAnAgent(t *testing.T) {
	// Records 1 and 2 land at the epoch plus 1 and 2 days: the cut hides
	// record 1 and the baseline below it.
	cut := time.Unix(0, 0).UTC().Add(36 * time.Hour)
	r, asked := hookedRoom(t, true, &cut)
	lineage := editTwice(t, r)
	head := r.head(t, "d")

	listed, code := runIn(t, r, "d", `{"commands":[{"name":"history.versions","args":{"group":1}}]}`, roomAgent)
	if code != "" {
		t.Fatalf("list: %s", listed.ResultJSON)
	}
	versions := lookup(lookup(mustParse(t, listed.ResultJSON), "results").Items[0], "versions")
	if len(versions.Items) != 1 {
		t.Fatalf("versions: %s", listed.ResultJSON)
	}
	if version, _ := stringOf(lookup(versions.Items[0], "version")); version != lineage+":2" {
		t.Fatalf("versions: %s", listed.ResultJSON)
	}
	if _, code := runIn(t, r, "d", `{"commands":[{"name":"history.read","args":{"version":"`+lineage+`:1"}}]}`, roomAgent); code != "INVALID_ARGS" {
		t.Fatalf("read: %q", code)
	}
	if _, code := runIn(t, r, "d", `{"commands":[{"name":"history.restore","args":{"version":"`+lineage+`:1"}}]}`, roomAgent); code != "VERSION_NOT_FOUND" {
		t.Fatalf("restore: %q", code)
	}
	if r.head(t, "d") != head {
		t.Fatal("the hidden restore wrote")
	}
	if previewed, code := runIn(t, r, "d", `{"commands":[{"name":"history.previewRestore","args":{"version":"`+lineage+`:1"}}]}`, roomAgent); code != "VERSION_NOT_FOUND" {
		t.Fatalf("preview: %s", previewed.ResultJSON)
	}
	if previewed, code := runIn(t, r, "d", `{"commands":[{"name":"history.previewRestore","args":{"version":"`+lineage+`:2"}}]}`, roomAgent); code != "" {
		t.Fatalf("visible preview: %s", previewed.ResultJSON)
	}
	if len(*asked) == 0 || (*asked)[0] != "agent-cs d" {
		t.Fatalf("asked %v", *asked)
	}
}

func TestAReadHookThatSaysNoRefusesAnAgentsListReadAndRestore(t *testing.T) {
	r, _ := hookedRoom(t, false, nil)
	lineage := editTwice(t, r)

	if _, code := runIn(t, r, "d", `{"commands":[{"name":"history.versions","args":{}}]}`, roomAgent); code != "TOOL_ACTION_FAILED" {
		t.Fatalf("list: %q", code)
	}
	if _, code := runIn(t, r, "d", `{"commands":[{"name":"history.read","args":{"version":"`+lineage+`:0"}}]}`, roomAgent); code != "TOOL_ACTION_FAILED" {
		t.Fatalf("read: %q", code)
	}
	head := r.head(t, "d")
	if restored, code := runIn(t, r, "d", `{"commands":[{"name":"history.restore","args":{"version":"`+lineage+`:0"}}]}`, roomAgent); code != "TOOL_ACTION_FAILED" {
		t.Fatalf("restore: %s", restored.ResultJSON)
	}
	if r.head(t, "d") != head {
		t.Fatal("the refused restore wrote")
	}
	if previewed, code := runIn(t, r, "d", `{"commands":[{"name":"history.previewRestore","args":{"version":"`+lineage+`:0"}}]}`, roomAgent); code != "TOOL_ACTION_FAILED" {
		t.Fatalf("preview: %s", previewed.ResultJSON)
	}
}

func TestAnAgentActingForAPersonIsAskedAboutAsThatPerson(t *testing.T) {
	r, asked := hookedRoom(t, true, nil)
	person := "person-1"

	runIn(t, r, "d", `{"commands":[{"name":"history.versions","args":{}}]}`, Actor{ID: "agent-cs", Name: "Agent", OnBehalfOf: &person})

	if len(*asked) != 1 || (*asked)[0] != "person-1 d" {
		t.Fatalf("asked %v", *asked)
	}
}

// A group that straddles the cut shows only its visible records to an agent.
func TestAnAgentsListShowsNothingOfAHiddenRecord(t *testing.T) {
	// Records 1 and 2 land a minute apart, in one 15-minute group; the cut hides 1.
	cut := time.Unix(0, 0).UTC().Add(90 * time.Second)
	r, _ := hookedRoomSpaced(t, true, &cut, time.Minute)
	lineage := editTwice(t, r)

	listed, code := runIn(t, r, "d", `{"commands":[{"name":"history.versions","args":{"group":15}}]}`, roomAgent)
	if code != "" {
		t.Fatalf("list: %s", listed.ResultJSON)
	}
	versions := lookup(lookup(mustParse(t, listed.ResultJSON), "results").Items[0], "versions")
	if len(versions.Items) != 1 {
		t.Fatalf("versions: %s", listed.ResultJSON)
	}
	version, _ := stringOf(lookup(versions.Items[0], "version"))
	started := string(lookup(versions.Items[0], "startedAt").Raw())
	if version != lineage+":2" || started != "120000" {
		t.Fatalf("versions: %s", listed.ResultJSON)
	}
}

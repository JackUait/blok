package room

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/collab"
	"github.com/JackUait/blok/packages/server/go/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// Twins of the C# CollabRoomTests compaction-on-load cases (M31).

var compactionTag = workingset.Tag{Format: workingset.CurrentFormat, Epoch: 2, Lineage: "0123456789abcdef0123456789abcdef"}

func seedFrames(t *testing.T, store *memoryStore, updates [][]byte) {
	t.Helper()
	var framed bytes.Buffer
	for _, update := range updates {
		workingset.AppendFrame(&framed, update)
	}
	if err := store.Write(context.Background(), "doc", framed.Bytes(), compactionTag); err != nil {
		t.Fatal(err)
	}
}

func storedFrames(t *testing.T, store *memoryStore) ([][]byte, workingset.Tag) {
	t.Helper()
	set, _ := store.Read(context.Background(), "doc")
	if set == nil {
		t.Fatal("no working set")
	}
	frames, ok := workingset.DecodeFrames(set.Updates)
	if !ok {
		t.Fatal("the working set does not decode")
	}
	return frames, set.Tag
}

// appending is one client doc whose updates each set one more key.
func appending(t *testing.T, values ...string) [][]byte {
	t.Helper()
	client := uint32(77)
	doc := yjs.NewDoc(yjs.Options{ClientID: &client})
	var updates [][]byte
	for i, value := range values {
		updates = append(updates, doc.Transact(func(tx *yjs.Transaction) {
			doc.GetMap(jsjson.FromString("notes")).Set(tx, jsjson.FromString(string(rune('a'+i))), jsjson.FromString(value))
		}))
	}
	return updates
}

func notes(t *testing.T, frames [][]byte) map[string]string {
	t.Helper()
	doc := yjs.NewDoc(yjs.Options{})
	for _, frame := range frames {
		if _, err := doc.ApplyUpdate(frame); err != nil {
			t.Fatal(err)
		}
	}
	out := map[string]string{}
	m := doc.GetMap(jsjson.FromString("notes"))
	for _, key := range m.Keys() {
		value, _ := m.Get(key)
		out[key.String()] = value.(jsjson.Str).String()
	}
	return out
}

func TestCompactsAnOversizedWorkingSetOnLoadByFrameCount(t *testing.T) {
	manager, store, endpoint := newTestManager(t, Options{CompactionFrameThreshold: 4}, nil)
	seedFrames(t, store, appending(t, "a", "b", "c", "d", "e"))

	join(t, manager, "doc", &fakeMember{source: collab.SourceClientV1})

	frames, tag := storedFrames(t, store)
	if len(frames) != 1 || tag != compactionTag || endpoint.loaded() != 0 {
		t.Fatalf("%d frames, tag %v, %d loads; want 1 frame, the same tag, no load", len(frames), tag, endpoint.loaded())
	}
	if got := notes(t, frames); len(got) != 5 || got["e"] != "e" {
		t.Fatalf("the compacted frame holds %v", got)
	}
}

func TestCompactsAnOversizedWorkingSetOnLoadByByteSize(t *testing.T) {
	manager, store, _ := newTestManager(t, Options{CompactionByteThreshold: 256}, nil)
	seedFrames(t, store, appending(t, strings.Repeat("a", 200), strings.Repeat("b", 200)))

	join(t, manager, "doc", &fakeMember{source: collab.SourceClientV1})

	if frames, _ := storedFrames(t, store); len(frames) != 1 {
		t.Fatalf("%d frames, want 1", len(frames))
	}
}

func TestLeavesASmallWorkingSetAloneOnLoad(t *testing.T) {
	manager, store, _ := newTestManager(t, Options{}, nil)
	seedFrames(t, store, appending(t, "a", "b"))

	join(t, manager, "doc", &fakeMember{source: collab.SourceClientV1})

	if frames, _ := storedFrames(t, store); len(frames) != 2 {
		t.Fatalf("%d frames, want 2", len(frames))
	}
}

// C# compacts once frameCount reaches the threshold (CollabRoom.cs:2530).
func TestCompactsAtExactlyTheFrameThresholdAndNotOneBelow(t *testing.T) {
	for count, want := range map[int]int{4: 1, 3: 3} {
		manager, store, _ := newTestManager(t, Options{CompactionFrameThreshold: 4}, nil)
		seedFrames(t, store, appending(t, []string{"a", "b", "c", "d"}[:count]...))

		join(t, manager, "doc", &fakeMember{source: collab.SourceClientV1})

		if frames, _ := storedFrames(t, store); len(frames) != want {
			t.Fatalf("%d seeded frames left %d, want %d", count, len(frames), want)
		}
	}
}

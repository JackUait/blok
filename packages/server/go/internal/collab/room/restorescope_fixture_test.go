package room

import (
	"encoding/hex"
	"sort"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
)

// The twin of C# CollabHistoryCaptureTests.TheRestoreScopeMatchesThePlanner.
func TestKeepDatabasesMatchesTheRestoreScopeFixture(t *testing.T) {
	cases := historyFixture(t, "restore-scope.json")
	if len(cases) < 8 {
		t.Fatalf("only %d cases", len(cases))
	}
	for _, c := range cases {
		name := text(t, c, "name")
		current, target := docOf(t, text(t, c, "current")), docOf(t, text(t, c, "target"))
		currentBlocks, targetBlocks := exportedBlocks(t, current), exportedBlocks(t, target)
		var kept []string
		var orphaned []string
		var pinned map[string]bool
		if text(t, c, "databases") == "keep" {
			keep := KeepDatabases(currentBlocks, targetBlocks)
			targetBlocks, pinned = keep.Target, keep.Pinned
			for _, block := range currentBlocks {
				if id := stringOf(asObject(block), "id"); id != nil && pinned[unitKey(*id)] {
					kept = append(kept, id.String())
				}
			}
			for _, guard := range keep.Orphaned {
				orphaned = append(orphaned, stringified(t, guard.JSON()))
			}
		}
		sort.Strings(kept)
		if got, want := strings.Join(kept, ","), strings.Join(stringList(t, member(t, c, "kept")), ","); got != want {
			t.Errorf("%s: kept %s, want %s", name, got, want)
		}
		var wantOrphaned []string
		for _, guard := range member(t, c, "orphaned").([]any) {
			wantOrphaned = append(wantOrphaned, stringified(t, guard))
		}
		if strings.Join(orphaned, "\n") != strings.Join(wantOrphaned, "\n") {
			t.Errorf("%s: orphaned %v, want %v", name, orphaned, wantOrphaned)
		}
		ops := PlanRestorePinned(currentBlocks, convert.DescribeStructure(current), targetBlocks,
			convert.ReadPageMaps(current), convert.ReadPageMaps(target), nil, pinned)
		want, _ := member(t, c, "ops").([]any)
		if len(ops) != len(want) {
			t.Errorf("%s: %d ops, want %d", name, len(ops), len(want))
			continue
		}
		for i, op := range ops {
			if got, expected := opText(t, op), stringified(t, want[i]); got != expected {
				t.Errorf("%s: op %d is %s, want %s", name, i, got, expected)
			}
		}
	}
	fixture := readRepoJSON(t, "test", "unit", "server-conformance", "fixtures", "collab-history", "restore-scope.json")
	for _, d := range objects(t, member(t, fixture, "digests")) {
		got := hex.EncodeToString(convert.RestoreDigestKeeping(text(t, d, "lineage"), number(t, d, "sequence"), text(t, d, "databases") == "keep"))
		if want := text(t, d, "digestHex"); got != want {
			t.Errorf("digest %s: %s, want %s", text(t, d, "databases"), got, want)
		}
	}
}

func asObject(value any) *jsjson.Object {
	object, _ := value.(*jsjson.Object)
	return object
}

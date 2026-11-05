package convert

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs/yjstest"
)

// Twin of C# CollabLongestKeptOrderTests: the fixture the TS client diff and
// the C# restore planner also run, so all three keep the same blocks.
func TestLongestKeptOrderKeepsTheFixtureIndexes(t *testing.T) {
	root, err := yjstest.RepoRoot()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "test", "fixtures", "version-history", "lis-cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Positions []int `json:"positions"`
			Kept      []int `json:"kept"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Cases) <= 5 {
		t.Fatalf("only %d cases", len(fixture.Cases))
	}
	for _, c := range fixture.Cases {
		if got := LongestKeptOrder(c.Positions); !slices.Equal(got, c.Kept) && !(len(got) == 0 && len(c.Kept) == 0) {
			t.Errorf("%v: got %v, want %v", c.Positions, got, c.Kept)
		}
	}
}

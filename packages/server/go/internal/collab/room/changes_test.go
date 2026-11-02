package room

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/yjs/yjstest"
)

var blockChangeKindNames = map[BlockChangeKind]string{
	BlockAdded: "added", BlockRemoved: "removed", BlockChanged: "changed", BlockMoved: "moved",
}

func readRepoJSON(t *testing.T, parts ...string) *jsjson.Object {
	t.Helper()
	root, err := yjstest.RepoRoot()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(append([]string{root}, parts...)...))
	if err != nil {
		t.Fatal(err)
	}
	value, err := jsjson.Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	object, ok := value.(*jsjson.Object)
	if !ok {
		t.Fatalf("%v is not an object", parts)
	}
	return object
}

func member(t *testing.T, object *jsjson.Object, key string) any {
	t.Helper()
	value, ok := object.Get(jsjson.FromString(key))
	if !ok {
		t.Fatalf("no %q", key)
	}
	return value
}

// Twin of C# EveryKindFixtureCaseMarksTheExpectedBlocks: the drawer's
// changePreview runs the same file.
func TestDiffBlocksMarksEveryKindFixtureCase(t *testing.T) {
	fixture := readRepoJSON(t, "test", "fixtures", "version-history", "kind-cases.json")
	cases, _ := member(t, fixture, "cases").([]any)
	if len(cases) <= 10 {
		t.Fatalf("only %d cases", len(cases))
	}
	for _, item := range cases {
		testCase := item.(*jsjson.Object)
		name := member(t, testCase, "name").(jsjson.Str).String()
		before, _ := member(t, testCase, "before").([]any)
		after, _ := member(t, testCase, "after").([]any)
		want := map[string]string{}
		for _, entry := range member(t, testCase, "kinds").(*jsjson.Object).Members() {
			want[entry.Key.String()] = entry.Value.(jsjson.Str).String()
		}
		got := map[string]string{}
		for _, change := range DiffBlocks(before, after) {
			got[change.ID.String()] = blockChangeKindNames[change.Kind]
		}
		if len(got) != len(want) {
			t.Errorf("%s: got %v, want %v", name, got, want)
			continue
		}
		for id, kind := range want {
			if got[id] != kind {
				t.Errorf("%s: got %v, want %v", name, got, want)
				break
			}
		}
	}
}

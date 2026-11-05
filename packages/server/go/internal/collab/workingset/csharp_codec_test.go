package workingset

import (
	"regexp"
	"testing"
)

func TestRefusesAnEmptyId(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal(`DocKey("") did not panic`)
		}
	}()
	DocKey("")
}

func TestMintsADistinctLineageEveryTime(t *testing.T) {
	shape := regexp.MustCompile(`^[0-9a-f]{32}$`)
	seen := map[string]bool{}
	for range 64 {
		lineage := NewLineage()
		if !shape.MatchString(lineage) {
			t.Fatalf("lineage %q is not 32 lower-hex characters", lineage)
		}
		seen[lineage] = true
	}
	if len(seen) != 64 {
		t.Fatalf("got %d distinct lineages of 64", len(seen))
	}
}

package room

import (
	"slices"
	"testing"
)

// The expected orders were printed by .NET 10's Dictionary<ulong,int> and
// HashSet<string> (dotnet fsi probe, this session): a removed slot is
// reused last-freed-first, and enumeration walks slots.
func TestEnumerationFollowsDotnetSlotReuse(t *testing.T) {
	var d ordered[uint64, int]
	keys := func() []uint64 {
		var out []uint64
		for k := range d.all() {
			out = append(out, k)
		}
		return out
	}
	step := func(label string, want ...uint64) {
		t.Helper()
		if got := keys(); !slices.Equal(got, want) {
			t.Fatalf("%s: %v, want %v", label, got, want)
		}
	}
	for _, k := range []uint64{1, 2, 3, 4, 5} {
		d.set(k, 0)
	}
	step("a", 1, 2, 3, 4, 5)
	d.remove(2)
	d.remove(4)
	step("b", 1, 3, 5)
	d.set(6, 0)
	step("c", 1, 3, 6, 5)
	d.set(7, 0)
	step("d", 1, 7, 3, 6, 5)
	d.set(8, 0)
	d.set(3, 9)
	step("f", 1, 7, 3, 6, 5, 8)
	d.remove(1)
	d.remove(6)
	d.remove(5)
	d.set(9, 0)
	d.set(10, 0)
	step("g", 7, 3, 10, 9, 8)
	d.clear()
	d.set(11, 0)
	step("h", 11)

	var s ordered[string, struct{}]
	for _, k := range []string{"a", "b", "c", "d"} {
		s.set(k, struct{}{})
	}
	s.remove("b")
	s.remove("c")
	for _, k := range []string{"e", "f", "g"} {
		s.set(k, struct{}{})
	}
	var got []string
	for k := range s.all() {
		got = append(got, k)
	}
	if want := []string{"a", "f", "e", "d", "g"}; !slices.Equal(got, want) {
		t.Fatalf("set: %v, want %v", got, want)
	}
}

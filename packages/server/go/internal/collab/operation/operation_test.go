package operation

import "testing"

// C# CollabOperationSourceTests: an undefined value prints as its number.
func TestNamesASourceOrPrintsTheNumberOfAnUndefinedOne(t *testing.T) {
	for _, c := range []struct {
		source Source
		name   string
	}{
		{0, "ClientV2"},
		{1, "ClientV1"},
		{2, "HttpEdit"},
		{7, "7"},
		{255, "255"},
	} {
		if got := c.source.String(); got != c.name {
			t.Errorf("Source(%d).String() = %q, want %q", c.source, got, c.name)
		}
	}
}

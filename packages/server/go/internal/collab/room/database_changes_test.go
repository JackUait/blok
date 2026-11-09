package room

import (
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
)

// The twin of C# CollabDatabaseChangesCaptureTests.
func TestDescribeDatabaseChangeMatchesThePropertyChangesFixture(t *testing.T) {
	for _, c := range historyFixture(t, "property-changes.json") {
		var typeName *jsjson.Str
		if s := optionalText(t, c, "type"); s != nil {
			str := jsjson.FromString(*s)
			typeName = &str
		}
		before, _ := member(t, c, "before").(*jsjson.Object)
		after, _ := member(t, c, "after").(*jsjson.Object)
		got := stringified(t, DescribeDatabaseChange(typeName, before, after))
		if want := stringified(t, member(t, c, "fields")); got != want {
			t.Errorf("%s: %s, want %s", text(t, c, "name"), got, want)
		}
	}
}

package room

import (
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
)

// The twin of C# CollabHistoryCaptureTests.TheRestoreGuardsMatchTheRules.
func TestRestoreGuardsMatchTheFixture(t *testing.T) {
	for _, c := range historyFixture(t, "restore-guards.json") {
		name := text(t, c, "name")
		current, _ := member(t, c, "current").([]any)
		target, _ := member(t, c, "target").([]any)
		want, _ := member(t, c, "guards").([]any)
		var wanted []string
		for _, item := range want {
			wanted = append(wanted, stringified(t, item))
		}
		guards := RestoreGuards(current, target)
		// A keep restore guards the kept target, then refuses each orphan.
		// A case without databases is databases=restore.
		if databases, _ := c.Get(jsjson.FromString("databases")); databases != nil && databases.(jsjson.Str).String() == "keep" {
			kept := KeepDatabases(current, target)
			guards = append(RestoreGuards(current, kept.Target), kept.Orphaned...)
		}
		var got []string
		for _, guard := range guards {
			got = append(got, stringified(t, guard.JSON()))
		}
		if strings.Join(got, "\n") != strings.Join(wanted, "\n") {
			t.Errorf("%s: guards are\n%s\nwant\n%s", name, strings.Join(got, "\n"), strings.Join(wanted, "\n"))
		}
	}
}

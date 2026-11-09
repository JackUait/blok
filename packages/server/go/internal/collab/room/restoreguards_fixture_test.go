package room

import (
	"strings"
	"testing"
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
		var got []string
		for _, guard := range RestoreGuards(current, target) {
			got = append(got, stringified(t, guard.JSON()))
		}
		if strings.Join(got, "\n") != strings.Join(wanted, "\n") {
			t.Errorf("%s: guards are\n%s\nwant\n%s", name, strings.Join(got, "\n"), strings.Join(wanted, "\n"))
		}
	}
}

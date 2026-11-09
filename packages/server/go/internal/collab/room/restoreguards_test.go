package room

import (
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
)

// Two ids with different lone surrogates are two blocks to the planner, so
// the guards must not read them as one.
func TestRestoreGuardsKeepLoneSurrogateIdsApart(t *testing.T) {
	parse := func(text string) []any {
		value, err := jsjson.Parse([]byte(text))
		if err != nil {
			t.Fatal(err)
		}
		return value.([]any)
	}
	public := `"views": [{ "id": "v", "type": "table", "form": { "public": true } }]`
	current := parse(`[{ "id": "\uD800", "type": "database", "data": { "schema": [], ` + public + ` } }]`)
	target := parse(`[{ "id": "\uDC00", "type": "database", "data": { "schema": [], ` + public + ` } },
		{ "id": "\uD800", "type": "database", "data": { "schema": [], ` + public + ` } }]`)
	var got []string
	for _, guard := range RestoreGuards(current, target) {
		got = append(got, stringified(t, guard.JSON()))
	}
	want := `{"kind":"share","blockId":"` + "�" + `","viewId":"v"}`
	if len(got) != 1 || got[0] != want {
		t.Fatalf("guards are %v, want [%s]", got, want)
	}
}

package dotnet

import (
	"encoding/json"
	"os"
	"testing"
)

// http-dates.json holds what HeaderUtilities.TryParseDate answers; the C#
// HttpDateFixtureTests recomputes it.
const httpDatesPath = "../../../../../test/unit/server-conformance/fixtures/http-dates.json"

func TestParseHTTPDateMatchesHeaderUtilities(t *testing.T) {
	raw, err := os.ReadFile(httpDatesPath)
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Inputs  []string `json:"inputs"`
		Answers []*int64 `json:"answers"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Inputs) != len(f.Answers) || len(f.Inputs) == 0 {
		t.Fatalf("fixture has %d inputs and %d answers", len(f.Inputs), len(f.Answers))
	}
	for i, input := range f.Inputs {
		got, ok := ParseHTTPDate(input)
		want := f.Answers[i]
		switch {
		case want == nil && ok:
			t.Errorf("%q: got %d, want a failure", input, got.Unix())
		case want != nil && !ok:
			t.Errorf("%q: failed, want %d", input, *want)
		case want != nil && got.Unix() != *want:
			t.Errorf("%q: got %d, want %d", input, got.Unix(), *want)
		}
	}
}

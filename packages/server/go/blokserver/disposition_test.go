package blokserver

import (
	"encoding/json"
	"os"
	"regexp"
	"testing"
)

// content-disposition-filenames.json holds the file name UploadEndpoint
// keeps for each Content-Disposition; the C# ContentDispositionFixtureTests
// recomputes it.
const dispositionFixturePath = "../../../../test/unit/server-conformance/fixtures/content-disposition-filenames.json"

func TestFileNameFromDispositionMatchesUploadEndpoint(t *testing.T) {
	raw, err := os.ReadFile(dispositionFixturePath)
	if err != nil {
		t.Fatal(err)
	}
	// encoding/json turns a lone surrogate escape into U+FFFD without a word.
	pairs := regexp.MustCompile(`(?i)\\ud[89ab][0-9a-f]{2}\\ud[c-f][0-9a-f]{2}`)
	if regexp.MustCompile(`(?i)\\ud[89a-f]`).Match(pairs.ReplaceAll(raw, nil)) {
		t.Fatal("the fixture holds a lone surrogate, which encoding/json cannot read back")
	}
	var f struct {
		Inputs  []string  `json:"inputs"`
		Answers []*string `json:"answers"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Inputs) != len(f.Answers) || len(f.Inputs) == 0 {
		t.Fatalf("fixture has %d inputs and %d answers", len(f.Inputs), len(f.Answers))
	}
	for i, input := range f.Inputs {
		got, ok := fileNameFromDisposition(input)
		want := f.Answers[i]
		switch {
		case want == nil && ok:
			t.Errorf("%q: got %q, want no file", input, got)
		case want != nil && !ok:
			t.Errorf("%q: no file, want %q", input, *want)
		case want != nil && got != *want:
			t.Errorf("%q: got %q, want %q", input, got, *want)
		}
	}
}

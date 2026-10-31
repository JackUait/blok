package unfurl

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"
)

// unfurl-html.json is what C#'s UnfurlMetadataParser answers;
// UnfurlHtmlFixtureTests recomputes it.
const fixturePath = "../../../../../test/unit/server-conformance/fixtures/unfurl-html.json"

func TestParseMatchesTheCSharpParser(t *testing.T) {
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Cases []struct {
			Name       string  `json:"name"`
			HTML       *string `json:"html"`
			HTMLBase64 string  `json:"htmlBase64"`
			URL        string  `json:"url"`
		} `json:"cases"`
		Answers []struct {
			Title       string `json:"title"`
			Description string `json:"description"`
			Image       string `json:"image"`
			Favicon     string `json:"favicon"`
			Domain      string `json:"domain"`
		} `json:"answers"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Cases) == 0 || len(f.Cases) != len(f.Answers) {
		t.Fatalf("fixture has %d cases and %d answers", len(f.Cases), len(f.Answers))
	}
	for i, c := range f.Cases {
		body := []byte(nil)
		if c.HTML != nil {
			body = []byte(*c.HTML)
		} else if body, err = base64.StdEncoding.DecodeString(c.HTMLBase64); err != nil {
			t.Fatal(err)
		}
		want := f.Answers[i]
		got := Parse(body, c.URL)
		if got != (Metadata{want.Title, want.Description, want.Image, want.Favicon, want.Domain}) {
			t.Errorf("%s:\n got %+v\nwant %+v", c.Name, got, want)
		}
	}
}

package framecheck

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"
)

// frame-check-oembed.json is what C#'s OEmbedAnswer keeps;
// FrameCheckOEmbedFixtureTests recomputes it.
const oEmbedFixture = "../../../../../test/unit/server-conformance/fixtures/frame-check-oembed.json"

func TestOEmbedAnswersMatchTheCSharpFixture(t *testing.T) {
	raw, err := os.ReadFile(oEmbedFixture)
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Cases []struct {
			Name       string  `json:"name"`
			JSON       *string `json:"json"`
			JSONBase64 string  `json:"jsonBase64"`
			// Set where C# writes a host a browser may decode to a refused
			// one. Go drops the thumbnail; C# is still to be fixed.
			GoDrops string `json:"goDropsPendingCSharpFix"`
		} `json:"cases"`
		Answers []struct {
			Title        *string `json:"title"`
			ProviderName *string `json:"provider_name"`
			ThumbnailURL *string `json:"thumbnail_url"`
			Width        *int    `json:"width"`
			Height       *int    `json:"height"`
			Wire         string  `json:"wire"`
		} `json:"answers"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Cases) == 0 || len(f.Cases) != len(f.Answers) {
		t.Fatalf("fixture has %d cases and %d answers", len(f.Cases), len(f.Answers))
	}
	text := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	number := func(p *int) int {
		if p == nil {
			return 0
		}
		return *p
	}
	for i, c := range f.Cases {
		body := []byte(nil)
		if c.JSON != nil {
			body = []byte(*c.JSON)
		} else if body, err = base64.StdEncoding.DecodeString(c.JSONBase64); err != nil {
			t.Fatal(err)
		}
		want := f.Answers[i]
		if c.GoDrops != "" {
			want.ThumbnailURL, want.Wire = nil, ""
		}
		got := ParseOEmbed(body)
		wire := ""
		if !got.Empty() {
			wire = string(got.AppendJSON(nil))
		}
		if got.Title.String() != text(want.Title) || got.ProviderName.String() != text(want.ProviderName) ||
			got.ThumbnailURL != text(want.ThumbnailURL) || got.Width != number(want.Width) ||
			got.Height != number(want.Height) || wire != want.Wire {
			t.Errorf("%s:\n got %+v %s\nwant %s", c.Name, got, wire, want.Wire)
		}
	}
}

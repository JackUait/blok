package blokdocs

import "testing"

// Read by C# LooksLikeADocumentFixtureTests too.
func TestLooksLikeADocumentMatchesTheSharedFixture(t *testing.T) {
	var cases []struct {
		Name     string  `json:"name"`
		Input    *string `json:"input"`
		Expected bool    `json:"expected"`
	}
	readFixture(t, "looks-like-a-document.json", &cases)
	if len(cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range cases {
		input := ""
		if c.Input != nil {
			input = *c.Input
		}
		if got := LooksLikeADocument(input); got != c.Expected {
			t.Errorf("%s: LooksLikeADocument(%q) = %v, want %v", c.Name, input, got, c.Expected)
		}
	}
}

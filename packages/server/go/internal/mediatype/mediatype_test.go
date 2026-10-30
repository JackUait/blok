package mediatype

import (
	"encoding/json"
	"os"
	"testing"
)

// Captured from UploadWire and the upload and JSON routes by MediaTypeFixtureTests.
const fixturePath = "../../../../../test/unit/server-conformance/fixtures/media-types.json"

func TestMediaTypesMatchTheCSharpFixture(t *testing.T) {
	data, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Inputs  []string `json:"inputs"`
		Answers []struct {
			Wire     string  `json:"wire"`
			Boundary *string `json:"boundary"`
			JSON     bool    `json:"json"`
		} `json:"answers"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	for i, input := range fixture.Inputs {
		want := fixture.Answers[i]
		if got := SanitizeWire(input); got != want.Wire {
			t.Errorf("%q: wire %q, want %q", input, got, want.Wire)
		}
		boundary, ok := Boundary(input)
		if ok != (want.Boundary != nil) || ok && boundary != *want.Boundary {
			t.Errorf("%q: boundary %q %v, want %v", input, boundary, ok, want.Boundary)
		}
		if got := IsJSON(input); got != want.JSON {
			t.Errorf("%q: json %v, want %v", input, got, want.JSON)
		}
	}
}

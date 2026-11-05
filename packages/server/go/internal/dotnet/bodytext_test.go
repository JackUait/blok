package dotnet

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

const bodyTextPath = "../../../../../test/unit/server-conformance/fixtures/outbound-body-text.json"

// The twin of C#'s BodyTextMatchesTheFixture: the text Digest auth-int
// hashes, as HttpContent.ReadAsStringAsync reads a body.
func TestBodyTextMatchesTheFixture(t *testing.T) {
	raw, err := os.ReadFile(bodyTextPath)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Body        string  `json:"body"`
			ContentType *string `json:"contentType"`
		} `json:"cases"`
		Answers []struct {
			Text  *string `json:"text"`
			Error string  `json:"error"`
		} `json:"answers"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Answers) != len(fixture.Cases) || len(fixture.Cases) == 0 {
		t.Fatalf("%d cases, %d answers", len(fixture.Cases), len(fixture.Answers))
	}
	for i, c := range fixture.Cases {
		body, err := hex.DecodeString(c.Body)
		if err != nil {
			t.Fatal(err)
		}
		contentType, has := "", c.ContentType != nil
		if has {
			contentType = *c.ContentType
		}
		text, err := bodyText(body, contentType, has)
		want := fixture.Answers[i]
		switch {
		case want.Text != nil && (err != nil || hex.EncodeToString([]byte(text)) != *want.Text):
			t.Errorf("%s %q: got %x, %v; want %s", c.Body, contentType, text, err, *want.Text)
		case want.Text == nil && (err == nil || bodyTextErrorName(err) != want.Error):
			t.Errorf("%s %q: got %x, %v; want %s", c.Body, contentType, text, err, want.Error)
		}
	}
}

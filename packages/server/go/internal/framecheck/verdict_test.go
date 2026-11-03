package framecheck

import (
	"encoding/json"
	"os"
	"testing"
)

const verdictFixture = "../../../../../test/unit/server-conformance/fixtures/frame-check-verdicts.json"

func TestVerdictsMatchTheSharedFixture(t *testing.T) {
	data, err := os.ReadFile(verdictFixture)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Name     string      `json:"name"`
			URL      string      `json:"url"`
			Embedder *string     `json:"embedder"`
			Headers  [][2]string `json:"headers"`
			Verdict  string      `json:"verdict"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range fixture.Cases {
		embedder := ""
		if c.Embedder != nil {
			embedder = *c.Embedder
		}
		var headers []Header
		for _, h := range c.Headers {
			headers = append(headers, Header{Name: h[0], Value: h[1]})
		}
		if got := Verdict(c.URL, embedder, headers); got != c.Verdict {
			t.Errorf("%s: %s, want %s", c.Name, got, c.Verdict)
		}
	}
}

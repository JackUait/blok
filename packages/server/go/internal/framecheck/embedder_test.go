package framecheck

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
)

const embedderFixture = "../../../../../test/unit/server-conformance/fixtures/frame-check-embedders.json"

func TestEmbeddersMatchTheSharedFixture(t *testing.T) {
	data, err := os.ReadFile(embedderFixture)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Name           string   `json:"name"`
			Origin         *string  `json:"origin"`
			SecFetchSite   string   `json:"secFetchSite"`
			Embedder       string   `json:"embedder"`
			AllowedOrigins []string `json:"allowedOrigins"`
			Self           string   `json:"self"`
			Want           *string  `json:"want"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range fixture.Cases {
		allowed := func(origin string) bool {
			for _, candidate := range c.AllowedOrigins {
				if origin != "" && dotnet.EqualsOrdinalIgnoreCase(strings.TrimSpace(candidate), origin) {
					return true
				}
			}
			return false
		}
		origin := ""
		if c.Origin != nil {
			origin = *c.Origin
		}
		want := ""
		if c.Want != nil {
			want = *c.Want
		}
		got := Embedder(Request{
			Origin: origin, HasOrigin: c.Origin != nil, SecFetchSite: c.SecFetchSite,
			Embedder: c.Embedder, Self: c.Self,
		}, allowed)
		if got != want {
			t.Errorf("%s: %q, want %q", c.Name, got, want)
		}
	}
}

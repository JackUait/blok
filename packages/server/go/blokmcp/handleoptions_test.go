package blokmcp

import (
	"encoding/json"
	"testing"
)

// Node's createBlokMcpServer refuses these in the shared check, in these words.
func TestRefusesHandleOptionsNodeRefuses(t *testing.T) {
	cases := []struct {
		options Options
		want    string
	}{
		{Options{HandleIdleMs: json.Number("0")}, "handleIdleMs must be a positive integer, got 0"},
		{Options{HandleIdleMs: json.Number("-5")}, "handleIdleMs must be a positive integer, got -5"},
		{Options{HandleIdleMs: json.Number("1.5")}, "handleIdleMs must be a positive integer, got 1.5"},
		{Options{MaxHandlesPerPrincipal: json.Number("0")}, "maxHandlesPerPrincipal must be a positive integer, got 0"},
		{Options{Schema: "bogus"}, `schema must be one of envelope, full, mixed, got "bogus"`},
		{Options{PageTitles: "pages"}, `pageTitles must be one of off, page-map, got "pages"`},
	}
	for _, c := range cases {
		c.options.Transport = Transport{Kind: "stdio"}
		c.options.Auth = Auth{Kind: "none"}
		_, err := New(c.options)
		if err == nil || err.Error() != c.want {
			t.Errorf("%+v: got %v, want %q", c.options, err, c.want)
		}
	}
}

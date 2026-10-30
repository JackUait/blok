package dotnet

import (
	"encoding/json"
	"net/netip"
	"os"
	"strings"
	"testing"
)

// primitives.json is captured from .NET by scripts/capture-dotnet-primitives.fsx.
const fixturePath = "../../../../../test/unit/server-conformance/fixtures/dotnet/primitives.json"

type ipCase struct {
	Input    string `json:"input"`
	OK       bool   `json:"ok"`
	Address  string `json:"address"`
	Loopback bool   `json:"loopback"`
	Any      bool   `json:"any"`
}

type uriCase struct {
	Base         *string `json:"base"`
	Input        string  `json:"input"`
	OK           bool    `json:"ok"`
	Scheme       string  `json:"scheme"`
	Host         string  `json:"host"`
	IdnHost      string  `json:"idnHost"`
	UserInfo     string  `json:"userInfo"`
	Port         int     `json:"port"`
	AbsolutePath string  `json:"absolutePath"`
	Query        string  `json:"query"`
	Fragment     string  `json:"fragment"`
	AbsoluteURI  string  `json:"absoluteUri"`
	Loopback     bool    `json:"loopback"`
}

type fixture struct {
	IP       []ipCase    `json:"ip"`
	URI      []uriCase   `json:"uri"`
	Relative []uriCase   `json:"relative"`
	Unescape [][2]string `json:"unescape"`
}

func load(t *testing.T) fixture {
	t.Helper()
	data, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	var f fixture
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestParseIPMatchesDotnet(t *testing.T) {
	for _, c := range load(t).IP {
		got, ok := ParseIP(c.Input)
		if ok != c.OK {
			t.Errorf("%q: ok %v, want %v", c.Input, ok, c.OK)
			continue
		}
		if !ok {
			continue
		}
		want, err := netip.ParseAddr(strings.SplitN(c.Address, "%", 2)[0])
		if err != nil {
			t.Fatalf("%q: fixture address %q: %v", c.Input, c.Address, err)
		}
		if got != want || IsLoopback(got) != c.Loopback || IsAny(got) != c.Any {
			t.Errorf("%q: %v loopback %v any %v, want %v %v %v", c.Input, got, IsLoopback(got), IsAny(got), want, c.Loopback, c.Any)
		}
	}
}

// Only http and https are read field by field: they are the only schemes the
// server acts on. Every other scheme must still agree on whether it parses
// and what the scheme is, since that is what the callers refuse it by.
func checkURI(t *testing.T, label string, got *URI, ok bool, c uriCase) {
	t.Helper()
	if ok != c.OK {
		t.Errorf("%s: ok %v, want %v", label, ok, c.OK)
		return
	}
	if !ok {
		return
	}
	if got.Scheme != c.Scheme {
		t.Errorf("%s: scheme %q, want %q", label, got.Scheme, c.Scheme)
		return
	}
	if c.Scheme != "http" && c.Scheme != "https" {
		return
	}
	want := URI{
		Scheme: c.Scheme, Host: c.Host, IdnHost: c.IdnHost, UserInfo: c.UserInfo, Port: c.Port,
		AbsolutePath: c.AbsolutePath, Query: c.Query, Fragment: c.Fragment, AbsoluteURI: c.AbsoluteURI,
		Loopback: c.Loopback,
	}
	got.HostType, got.authority = "", ""
	if *got != want {
		t.Errorf("%s:\n got %+v\nwant %+v", label, *got, want)
	}
}

func TestParseAbsoluteURIMatchesDotnet(t *testing.T) {
	for _, c := range load(t).URI {
		got, ok := ParseAbsoluteURI(c.Input)
		checkURI(t, c.Input, got, ok, c)
	}
}

func TestResolveURIMatchesDotnet(t *testing.T) {
	for _, c := range load(t).Relative {
		base, ok := ParseAbsoluteURI(*c.Base)
		if !ok {
			t.Fatalf("base %q does not parse", *c.Base)
		}
		got, ok := ResolveURI(base, c.Input)
		checkURI(t, *c.Base+" + "+c.Input, got, ok, c)
	}
}

func TestUnescapeDataStringMatchesDotnet(t *testing.T) {
	for _, c := range load(t).Unescape {
		if got := UnescapeDataString(c[0]); got != c[1] {
			t.Errorf("%q: %q, want %q", c[0], got, c[1])
		}
	}
}

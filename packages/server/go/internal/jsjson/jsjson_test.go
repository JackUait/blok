package jsjson

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"testing"
)

const fixtureDir = "../../../../../test/unit/server-conformance/fixtures/jsjson"

// An odd run of backslashes before u+D800..DFFF is a lone-surrogate escape
// that encoding/json would silently turn into U+FFFD.
var surrogateEscape = regexp.MustCompile(`(^|[^\\])(\\\\)*\\u[dD][89a-fA-F][0-9a-fA-F]{2}`)

func readFixture(t *testing.T, name string, into any) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(fixtureDir, name))
	if err != nil {
		t.Fatalf("%v; run node scripts/generate-jsjson-fixtures.mjs", err)
	}
	if surrogateEscape.Match(data) {
		t.Fatalf("%s holds a surrogate escape outside a string; write it as hex units", name)
	}
	if err := json.Unmarshal(data, into); err != nil {
		t.Fatal(err)
	}
}

type jsFixture struct {
	NaNBits   string      `json:"nanBits"`
	Numbers   [][2]string `json:"numbers"`
	Stringify []struct {
		Name  string  `json:"name"`
		Value any     `json:"value"`
		JSON  *string `json:"json"`
	} `json:"stringify"`
	Parse []struct {
		Name string  `json:"name"`
		Text string  `json:"text"`
		JSON *string `json:"json"`
	} `json:"parse"`
}

type outcome struct {
	text  *string
	error string
}

func (o *outcome) UnmarshalJSON(data []byte) error {
	var text string
	if err := json.Unmarshal(data, &text); err == nil {
		o.text = &text
		return nil
	}
	var failed struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(data, &failed); err != nil {
		return err
	}
	o.error = failed.Error
	return nil
}

type dotnetFixture struct {
	Documents []struct {
		Name             string   `json:"name"`
		Text             *string  `json:"text"`
		Hex              string   `json:"hex"`
		MaxDepth         int      `json:"maxDepth"`
		RefuseDuplicates bool     `json:"refuseDuplicates"`
		Parse            string   `json:"parse"`
		Write            *outcome `json:"write"`
		Canonical        *outcome `json:"canonical"`
	} `json:"documents"`
	Strings []struct {
		Name  string  `json:"name"`
		Units string  `json:"units"`
		JSON  outcome `json:"json"`
	} `json:"strings"`
}

func unitsOf(t *testing.T, hexUnits string) Str {
	t.Helper()
	raw, err := hex.DecodeString(hexUnits)
	if err != nil || len(raw)%2 != 0 {
		t.Fatalf("bad units %q", hexUnits)
	}
	units := make(Str, len(raw)/2)
	for i := range units {
		units[i] = uint16(raw[2*i])<<8 | uint16(raw[2*i+1])
	}
	return units
}

func numberOf(t *testing.T, bits string) float64 {
	t.Helper()
	pattern, err := strconv.ParseUint(bits, 16, 64)
	if err != nil {
		t.Fatal(err)
	}
	return math.Float64frombits(pattern)
}

// build turns a fixture value spec into a JS value (see the generator).
func build(t *testing.T, spec any) any {
	t.Helper()
	switch spec := spec.(type) {
	case nil, bool:
		return spec
	case map[string]any:
		switch {
		case spec["n"] != nil:
			return numberOf(t, spec["n"].(string))
		case spec["s"] != nil:
			return unitsOf(t, spec["s"].(string))
		case spec["u"] != nil:
			return Undefined{}
		case spec["a"] != nil:
			items := []any{}
			for _, item := range spec["a"].([]any) {
				items = append(items, build(t, item))
			}
			return items
		case spec["o"] != nil:
			object := &Object{}
			for _, member := range spec["o"].([]any) {
				pair := member.([]any)
				object.Set(unitsOf(t, pair[0].(string)), build(t, pair[1]))
			}
			return object
		}
	}
	t.Fatalf("bad value spec %v", spec)
	return nil
}

func TestFormatNumberMatchesNode(t *testing.T) {
	var fixture jsFixture
	readFixture(t, "js.json", &fixture)
	if len(fixture.Numbers) < 1000 {
		t.Fatalf("only %d numbers", len(fixture.Numbers))
	}
	for _, pair := range fixture.Numbers {
		number := numberOf(t, pair[0])
		want := pair[1]
		// String(x) for the non-finite; JSON.stringify writes them as null.
		switch {
		case math.IsNaN(number):
			want = "null"
			if pair[1] != "NaN" {
				t.Fatalf("%s: node wrote %q", pair[0], pair[1])
			}
		case math.IsInf(number, 0):
			want = "null"
		}
		if got := FormatNumber(number); got != want {
			t.Errorf("FormatNumber(%s = %v) = %q, want %q", pair[0], number, got, want)
		}
	}
}

func TestNaNBitsMatchNode(t *testing.T) {
	var fixture jsFixture
	readFixture(t, "js.json", &fixture)
	if got := strconv.FormatUint(math.Float64bits(NaN()), 16); got != fixture.NaNBits {
		t.Fatalf("NaN() bits %s, want %s", got, fixture.NaNBits)
	}
	if NaNBits != 0x7ff8000000000000 {
		t.Fatalf("NaNBits = %x", NaNBits)
	}
}

func TestStringifyMatchesNode(t *testing.T) {
	var fixture jsFixture
	readFixture(t, "js.json", &fixture)
	for _, entry := range fixture.Stringify {
		got, err := Stringify(build(t, entry.Value))
		if entry.JSON == nil {
			if err == nil {
				t.Errorf("%s: Stringify = %q, want an error", entry.Name, got)
			}
			continue
		}
		if err != nil || got != *entry.JSON {
			t.Errorf("%s: Stringify = %q, %v; want %q", entry.Name, got, err, *entry.JSON)
		}
	}
}

func TestParseMatchesNode(t *testing.T) {
	var fixture jsFixture
	readFixture(t, "js.json", &fixture)
	for _, entry := range fixture.Parse {
		value, err := Parse([]byte(entry.Text))
		if entry.JSON == nil {
			if err == nil {
				t.Errorf("%s: Parse accepted %q", entry.Name, entry.Text)
			}
			continue
		}
		// C# validates with JsonDocument at depth 512 first; JS has no limit.
		if entry.Name == "depth 513 (JS has no limit)" {
			if !errors.Is(err, ErrDepth) {
				t.Errorf("%s: Parse error %v, want ErrDepth like C#", entry.Name, err)
			}
			continue
		}
		if err != nil {
			t.Errorf("%s: Parse error %v", entry.Name, err)
			continue
		}
		if got, err := Stringify(value); err != nil || got != *entry.JSON {
			t.Errorf("%s: Stringify(Parse) = %q, %v; want %q", entry.Name, got, err, *entry.JSON)
		}
	}
}

var errorKinds = map[string]error{
	"invalid":       ErrInvalid,
	"depth":         ErrDepth,
	"duplicate":     ErrDuplicate,
	"loneSurrogate": ErrLoneSurrogate,
	"invalidUtf8":   ErrInvalidUTF8,
}

func checkOutcome(t *testing.T, name, what string, got []byte, err error, want *outcome) {
	t.Helper()
	if want == nil {
		t.Fatalf("%s: fixture has no %s", name, what)
	}
	if want.text != nil {
		if err != nil || string(got) != *want.text {
			t.Errorf("%s: %s = %q, %v; want %q", name, what, got, err, *want.text)
		}
		return
	}
	kind, known := errorKinds[want.error]
	if !known {
		t.Fatalf("%s: unknown error kind %q", name, want.error)
	}
	if !errors.Is(err, kind) {
		t.Errorf("%s: %s = %q, %v; want %s", name, what, got, err, want.error)
	}
}

func TestNodeMatchesSystemTextJSON(t *testing.T) {
	var fixture dotnetFixture
	readFixture(t, "dotnet.json", &fixture)
	for _, entry := range fixture.Documents {
		data := []byte(nil)
		if entry.Text != nil {
			data = []byte(*entry.Text)
		} else {
			var err error
			if data, err = hex.DecodeString(entry.Hex); err != nil {
				t.Fatal(err)
			}
		}
		node, err := ParseNode(data, Options{MaxDepth: entry.MaxDepth, RefuseDuplicates: entry.RefuseDuplicates})
		if entry.Parse != "ok" {
			checkOutcome(t, entry.Name, "parse", nil, err, &outcome{error: entry.Parse})
			continue
		}
		if err != nil {
			t.Errorf("%s: ParseNode error %v", entry.Name, err)
			continue
		}
		written, err := node.AppendJSON(nil)
		checkOutcome(t, entry.Name, "write", written, err, entry.Write)
		canonical, err := node.AppendCanonical(nil)
		checkOutcome(t, entry.Name, "canonical", canonical, err, entry.Canonical)
	}
}

func TestQuotedMatchesSystemTextJSON(t *testing.T) {
	var fixture dotnetFixture
	readFixture(t, "dotnet.json", &fixture)
	for _, entry := range fixture.Strings {
		got := AppendQuoted(nil, unitsOf(t, entry.Units))
		checkOutcome(t, entry.Name, "quote", got, nil, &entry.JSON)
	}
}

// .NET output is pure ASCII, so a byte count is a UTF-16 count: the agent's
// ToJsonString().Length caps become len() in Go.
func TestDotnetOutputIsASCII(t *testing.T) {
	node, err := ParseNode([]byte(`{"t":"🚀<a>&'+é","n":1}`), Options{})
	if err != nil {
		t.Fatal(err)
	}
	written, err := node.AppendJSON(nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range written {
		if b >= 0x80 {
			t.Fatalf("non-ASCII byte in %q", written)
		}
	}
	want := `{"t":"` + "\\uD83D\\uDE80\\u003Ca\\u003E\\u0026\\u0027\\u002B\\u00E9" + `","n":1}`
	if string(written) != want {
		t.Fatalf("got %s, want %s", written, want)
	}
}

func TestCompareUsesUTF16Units(t *testing.T) {
	emoji, fullwidth := FromString("😀"), FromString("～")
	if Compare(emoji, fullwidth) >= 0 {
		t.Fatal("U+1F600 must sort before U+FF5E by UTF-16 units")
	}
	if Compare(FromString("a"), FromString("ab")) >= 0 || Compare(FromString("b"), FromString("b")) != 0 {
		t.Fatal("prefix or equal order is wrong")
	}
}

func TestStrRoundTripsAndReplacesLoneSurrogates(t *testing.T) {
	if got := FromString("a😀é").String(); got != "a😀é" {
		t.Fatalf("round trip gave %q", got)
	}
	if got := (Str{'a', 0xd800, 'b'}).String(); got != "a�b" {
		t.Fatalf("lone surrogate gave %q", got)
	}
	if got := len(FromString("😀")); got != 2 {
		t.Fatalf("astral length %d, want 2 units", got)
	}
}

func TestObjectSetKeepsFirstPlaceAndLastValue(t *testing.T) {
	object := &Object{}
	object.Set(FromString("a"), 1.0)
	object.Set(FromString("b"), 2.0)
	object.Set(FromString("a"), 3.0)
	got, err := Stringify(object)
	if err != nil || got != `{"a":3,"b":2}` {
		t.Fatalf("got %q, %v", got, err)
	}
	if value, ok := object.Get(FromString("a")); !ok || value != 3.0 {
		t.Fatalf("Get gave %v, %v", value, ok)
	}
}

func TestStringifyRefusesValuesWithNoJSONForm(t *testing.T) {
	for _, value := range []any{"go string", 1, []byte{1}, map[string]any{}} {
		if got, err := Stringify(value); err == nil {
			t.Errorf("Stringify(%T) = %q, want an error", value, got)
		}
	}
}

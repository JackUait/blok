package dotnet

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

// The doubles C# writes, from fixtures/canonical-edit-digest.json.
func TestFormatsDoublesLikeDotnet(t *testing.T) {
	path := filepath.Join("..", "..", "..", "..", "..", "test", "unit", "server-conformance", "fixtures", "canonical-edit-digest.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Doubles []struct {
			Bits      string `json:"bits"`
			JSON      string `json:"json"`
			Invariant string `json:"invariant"`
		} `json:"doubles"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Doubles) == 0 {
		t.Fatal("no doubles")
	}
	for _, c := range fixture.Doubles {
		bits, err := strconv.ParseInt(c.Bits, 10, 64)
		if err != nil {
			t.Fatal(err)
		}
		value := math.Float64frombits(uint64(bits))
		if got := FormatDouble(value); got != c.Invariant || got != c.JSON {
			t.Errorf("%v: %s, want %s (json %s)", value, got, c.Invariant, c.JSON)
		}
	}
}

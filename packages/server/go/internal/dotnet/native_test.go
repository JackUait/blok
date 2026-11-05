package dotnet

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

const nativeTextPath = "../../../../../test/unit/server-conformance/fixtures/native-text.json"

func TestNativeTextDecodesBytesAsTheCSharpHostDoes(t *testing.T) {
	raw, err := os.ReadFile(nativeTextPath)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct{ Bytes, Text string }
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range fixture.Cases {
		input, err := hex.DecodeString(c.Bytes)
		if err != nil {
			t.Fatal(err)
		}
		if got := NativeText(string(input)); got != c.Text {
			t.Errorf("%s: got %+q, want %+q", c.Bytes, got, c.Text)
		}
	}
}

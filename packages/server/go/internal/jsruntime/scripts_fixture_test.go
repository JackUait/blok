package jsruntime

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

type scriptOutcome struct {
	Result *string `json:"result,omitempty"`
	Error  string  `json:"error,omitempty"`
}

type scriptStep struct {
	Op     string         `json:"op"`
	Expect scriptOutcome  `json:"expect"`
	Goja   *scriptOutcome `json:"goja"`
}

// C# reads the same file (RuntimeScriptFixtureTests). A step's "goja" entry
// is a recorded engine divergence; its "why" says where it comes from.
func TestMatchesTheSharedRuntimeScriptFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(repoRoot, "test/unit/server-conformance/fixtures/documents/runtime-scripts.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name   string       `json:"name"`
		Script string       `json:"script"`
		Steps  []scriptStep `json:"steps"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	names := map[Kind]string{KindUnknown: "Unknown", KindInvalidDocument: "InvalidDocument", KindTimedOut: "TimedOut", KindDocumentTooLarge: "DocumentTooLarge"}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			p, err := newPoolFromSource(c.Script, 1, 10*time.Second, 0)
			if err != nil {
				t.Fatal(err)
			}
			for _, step := range c.Steps {
				want := step.Expect
				if step.Goja != nil {
					want = *step.Goja
				}
				var got scriptOutcome
				out, err := invoke(t, p, step.Op, "{}")
				var failure *Failure
				switch {
				case err == nil:
					got.Result = &out
				case errors.As(err, &failure):
					got.Error = names[failure.Kind]
				default:
					t.Fatalf("%s: unexpected error %v (%T)", step.Op, err, err)
				}
				if !reflect.DeepEqual(got, want) {
					t.Fatalf("%s: got %s, want %s (err %v)", step.Op, show(got), show(want), err)
				}
			}
		})
	}
}

func show(o scriptOutcome) string {
	raw, _ := json.Marshal(o)
	return string(raw)
}

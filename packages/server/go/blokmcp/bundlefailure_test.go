package blokmcp

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/jsruntime"
)

type failingRuntime struct{ kind jsruntime.Kind }

func (f failingRuntime) Invoke(context.Context, string, string, *time.Duration) (string, error) {
	return "", &jsruntime.Failure{Kind: f.kind, Err: errors.New("1 at V$ (blok-server-runtime.js:1:2)")}
}

// A call the engine stopped at its time or size limit says so plainly,
// without the engine's stack.
func TestABundleCallStoppedAtALimitSaysSoPlainly(t *testing.T) {
	cases := map[jsruntime.Kind]string{
		jsruntime.KindTimedOut:         "blok-mcp: the document took longer than 60 s to process; it may be too large.",
		jsruntime.KindDocumentTooLarge: "blok-mcp: the document is too large to process.",
	}
	for kind, want := range cases {
		_, err := bundle{runtime: failingRuntime{kind}}.call(context.Background(), "agentExecute", map[string]any{}, nil)
		if err == nil || err.Error() != want {
			t.Errorf("kind %d: %v", kind, err)
		}
	}
	_, err := bundle{runtime: failingRuntime{jsruntime.KindUnknown}}.call(context.Background(), "agentExecute", map[string]any{}, nil)
	if err == nil || !strings.Contains(err.Error(), "agentExecute failed") {
		t.Errorf("other failure: %v", err)
	}
}

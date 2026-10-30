package yjs

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/yjs/yjstest"
)

// The C#-captured golden (Blok.Server.Tests/Yjs/CSharpCaptureTests.cs):
// after every scenario and fuzz step, the Go engine must answer what the C#
// engine answered, byte for byte where bytes are involved.

func captureHash(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])[:12]
}

func encodeState(t *testing.T, doc *Doc, target []byte) []byte {
	t.Helper()
	update, err := doc.EncodeStateAsUpdate(target)
	if err != nil {
		t.Fatal(err)
	}
	return update
}

// captureStep renders one step the way the C# test writes it.
func captureStep(t *testing.T, doc *Doc, previous, first []byte, minted bool, emitted []UpdateEvent, result *ApplyResult) string {
	sv := doc.EncodeStateVector()
	line := fmt.Sprintf(`{"sv": %q, "full": %q, "prev": %q, "first": %q`,
		base64.StdEncoding.EncodeToString(sv),
		captureHash(encodeState(t, doc, nil)),
		captureHash(encodeState(t, doc, previous)),
		captureHash(encodeState(t, doc, first)))
	if doc.HasPending() {
		line += `, "pending": true`
	}
	if minted {
		line += `, "minted": true`
	}
	if len(emitted) > 0 {
		line += `, "emitted": [`
		for i, event := range emitted {
			if i > 0 {
				line += ", "
			}
			line += fmt.Sprintf(`{"update": %q, "local": %v}`, captureHash(event.Update), event.Local)
		}
		line += "]"
	}
	if result != nil {
		line += fmt.Sprintf(`, "apply": {"pendingRemains": %v, "changed": %v}`, result.PendingRemains, result.Changed)
	}
	return line + "}"
}

func expectedStep(t *testing.T, step any) string {
	t.Helper()
	line := fmt.Sprintf(`{"sv": %q, "full": %q, "prev": %q, "first": %q`,
		yjstest.String(step, "sv"), yjstest.String(step, "full"), yjstest.String(step, "prev"), yjstest.String(step, "first"))
	if yjstest.Bool(step, "pending") {
		line += `, "pending": true`
	}
	if yjstest.Bool(step, "minted") {
		line += `, "minted": true`
	}
	if events := yjstest.Items(step, "emitted"); len(events) > 0 {
		line += `, "emitted": [`
		for i, event := range events {
			if i > 0 {
				line += ", "
			}
			line += fmt.Sprintf(`{"update": %q, "local": %v}`, yjstest.String(event, "update"), yjstest.Bool(event, "local"))
		}
		line += "]"
	}
	if apply := yjstest.Field(step, "apply"); apply != nil {
		line += fmt.Sprintf(`, "apply": {"pendingRemains": %v, "changed": %v}`, yjstest.Bool(apply, "pendingRemains"), yjstest.Bool(apply, "changed"))
	}
	return line + "}"
}

func TestEveryStepMatchesTheCSharpCapture(t *testing.T) {
	captured := fixtureCases(t, "csharp-capture.json")
	cases := append(scenarios(t), fuzzSeeds(t)...)
	if len(captured) != len(cases) {
		t.Fatalf("the capture holds %d cases, the fixtures %d; rerun CSharpCaptureTests with BLOK_WRITE_CSHARP_CAPTURE=1", len(captured), len(cases))
	}
	checked := 0
	for i, c := range cases {
		if yjstest.String(captured[i], "name") != c.name {
			t.Fatalf("case %d is %s in the capture, %s here", i, yjstest.String(captured[i], "name"), c.name)
		}
		steps := yjstest.Items(captured[i], "steps")
		if len(steps) != len(c.steps) {
			t.Fatalf("%s: %d captured steps, %d steps", c.name, len(steps), len(c.steps))
		}
		t.Run(c.name, func(t *testing.T) {
			runner := newScenarioRunner(t, c)
			var emitted []UpdateEvent
			runner.doc.OnUpdate(func(event UpdateEvent) { emitted = append(emitted, event) })
			previous := runner.doc.EncodeStateVector()
			var first []byte
			for index, step := range c.steps {
				clientBefore := runner.doc.ClientID()
				emitted = nil
				var result *ApplyResult
				runner.observe = func(_ scenarioStep, _ []byte, applied *ApplyResult) { result = applied }
				runner.run(step)
				sv := runner.doc.EncodeStateVector()
				if first == nil && len(sv) > 1 {
					first = sv
				}
				got := captureStep(t, runner.doc, previous, first, runner.doc.ClientID() != clientBefore, emitted, result)
				if want := expectedStep(t, steps[index]); got != want {
					t.Fatalf("step %d (%s %q):\n got %s\nwant %s", index, step.kind, step.id, got, want)
				}
				checked++
				previous = sv
			}
		})
	}
	if checked == 0 {
		t.Fatal("nothing was checked")
	}
}

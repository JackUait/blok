package jsruntime

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// The repo root, from this package's directory.
const repoRoot = "../../../../.."

func newRuntime(t *testing.T) *Runtime {
	t.Helper()
	r, err := New()
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return r
}

func TestVersionMatchesPackageJSON(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(repoRoot, "package.json"))
	if err != nil {
		t.Fatal(err)
	}
	var pkg struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(raw, &pkg); err != nil {
		t.Fatal(err)
	}
	if pkg.Version == "" {
		t.Fatal("package.json has no version")
	}

	got, err := newRuntime(t).Invoke("version", "{}")
	if err != nil {
		t.Fatalf("Invoke(version): %v", err)
	}
	if got != pkg.Version {
		t.Fatalf("version = %q, want %q", got, pkg.Version)
	}
}

// Outputs in the fixture come from node:vm on the same bundle; a vitest law keeps them current.
func TestMatchesNodeOnTheSmokeFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(repoRoot, "test/unit/server-conformance/fixtures/documents/bundle-smoke.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name   string `json:"name"`
		Op     string `json:"op"`
		Input  string `json:"input"`
		Output string `json:"output"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) == 0 {
		t.Fatal("no smoke cases")
	}

	r := newRuntime(t)
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			got, err := r.Invoke(c.Op, c.Input)
			if err != nil {
				t.Fatalf("Invoke(%s): %v", c.Op, err)
			}
			if got != c.Output {
				t.Fatalf("Invoke(%s)\n got %q\nwant %q", c.Op, got, c.Output)
			}
		})
	}
}

func TestReportsTheJavaScriptErrorName(t *testing.T) {
	r := newRuntime(t)

	_, err := r.Invoke("noSuchOperation", "{}")
	var jsErr *JSError
	if !errors.As(err, &jsErr) || jsErr.Name != "TypeError" {
		t.Fatalf("unknown op: err = %v, want a TypeError", err)
	}

	_, err = r.Invoke("blocksToHtml", "not json")
	if !errors.As(err, &jsErr) || jsErr.Name != "SyntaxError" {
		t.Fatalf("bad json: err = %v, want a SyntaxError", err)
	}

	// The engine is still usable after a rejection.
	if _, err := r.Invoke("version", "{}"); err != nil {
		t.Fatalf("version after errors: %v", err)
	}
}

// goja has no event loop, so a promise still pending when the call returns never settles.
func TestFailsAtOnceOnAPendingPromise(t *testing.T) {
	r, err := newFromSource("pending.js", `globalThis.blokServerInvoke = () => new Promise(() => {});`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.Invoke("version", "{}"); !errors.Is(err, ErrPending) {
		t.Fatalf("err = %v, want ErrPending", err)
	}
}

func TestRefusesABundleWithoutTheEntryPoint(t *testing.T) {
	if _, err := newFromSource("empty.js", `var x = 1;`); err == nil {
		t.Fatal("want an error for a bundle with no blokServerInvoke")
	}
}

func BenchmarkCompile(b *testing.B) {
	for b.Loop() {
		if _, err := compile("blok-server-runtime.js", bundle); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkNew(b *testing.B) {
	for b.Loop() {
		if _, err := New(); err != nil {
			b.Fatal(err)
		}
	}
}

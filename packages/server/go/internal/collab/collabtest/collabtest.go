// Package collabtest reads the shared collab fixtures under
// test/unit/server-conformance/fixtures, the same files Blok.Server.Tests reads.
package collabtest

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/yjs/yjstest"
)

// Path is the absolute path of a file under fixtures/.
func Path(t testing.TB, relative string) string {
	t.Helper()
	root, err := yjstest.RepoRoot()
	if err != nil {
		t.Fatal(err)
	}
	return filepath.Join(root, "test", "unit", "server-conformance", "fixtures", filepath.FromSlash(relative))
}

// Read decodes one fixture file into value with encoding/json.
func Read(t testing.TB, relative string, value any) {
	t.Helper()
	data, err := os.ReadFile(Path(t, relative))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, value); err != nil {
		t.Fatalf("%s: %v", relative, err)
	}
}

// Hex decodes lower hex, failing the test on bad input.
func Hex(t testing.TB, text string) []byte {
	t.Helper()
	data, err := hex.DecodeString(text)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

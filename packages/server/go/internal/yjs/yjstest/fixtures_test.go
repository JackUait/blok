package yjstest

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// Port of YjsEngineHarnessTests.LoaderFindsEveryManifestedFile, plus the
// manifest's bytes and sha256, which C# does not check.
func TestLoaderFindsEveryManifestedFile(t *testing.T) {
	manifest, err := Load("manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	dir, err := Dir()
	if err != nil {
		t.Fatal(err)
	}
	files := Items(manifest, "files")
	if len(files) == 0 {
		t.Fatal("manifest lists no files")
	}
	for _, file := range files {
		path := String(file, "path")
		data, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(path)))
		if err != nil {
			t.Errorf("%s: %v", path, err)
			continue
		}
		if _, err := Load(path); err != nil {
			t.Errorf("%s: %v", path, err)
		}
		// The manifest cannot hash itself.
		if !Has(file, "sha256") {
			continue
		}
		if len(data) != int(Number(file, "bytes")) {
			t.Errorf("%s: %d bytes, manifest says %v", path, len(data), Number(file, "bytes"))
		}
		sum := sha256.Sum256(data)
		if hex.EncodeToString(sum[:]) != String(file, "sha256") {
			t.Errorf("%s: sha256 differs from the manifest", path)
		}
	}
}

// JS sort() orders keys by UTF-16 units, so the emoji (D83D...) comes
// before U+FF5E; Go's byte order would swap them. Expected text is
// node's JSON.stringify of the same object with Object.keys(o).sort().
func TestCanonicalSortsKeysByUTF16Units(t *testing.T) {
	object := &jsjson.Object{}
	object.Set(jsjson.FromString("～"), 1.0)
	object.Set(jsjson.FromString("\U0001F600"), 2.0)
	object.Set(jsjson.FromString("a"), 3.0)
	got, err := Canonical(object)
	if err != nil {
		t.Fatal(err)
	}
	if want := "{\"a\":3,\"\U0001F600\":2,\"～\":1}"; got != want {
		t.Fatalf("got %s, want %s", got, want)
	}
}

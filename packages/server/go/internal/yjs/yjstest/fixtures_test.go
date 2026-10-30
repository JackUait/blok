package yjstest

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
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

package journal

import (
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/collabtest"
)

type manifestJSON struct {
	WriteCounter      string `json:"writeCounter"`
	Fence             string `json:"fence"`
	Generation        string `json:"generation"`
	Seeded            bool   `json:"seeded"`
	Format            int32  `json:"format"`
	Epoch             string `json:"epoch"`
	Lineage           string `json:"lineage"`
	CheckpointThrough string `json:"checkpointThrough"`
	GenerationFence   string `json:"generationFence"`
	CheckpointFence   string `json:"checkpointFence"`
	Hex               string `json:"hex"`
}

func (m manifestJSON) manifest(t *testing.T) Manifest {
	return Manifest{
		WriteCounter: u64(t, m.WriteCounter), Fence: u64(t, m.Fence), Generation: u64(t, m.Generation),
		Seeded: m.Seeded, Format: m.Format, Epoch: i64(t, m.Epoch), Lineage: m.Lineage,
		CheckpointThrough: u64(t, m.CheckpointThrough), GenerationFence: u64(t, m.GenerationFence),
		CheckpointFence: u64(t, m.CheckpointFence),
	}
}

type files struct {
	Manifest struct {
		Encode []manifestJSON `json:"encode"`
		Read   []struct {
			Name     string        `json:"name"`
			Hex      string        `json:"hex"`
			Manifest *manifestJSON `json:"manifest"`
			Error    string        `json:"error"`
		} `json:"read"`
	} `json:"manifest"`
	Sealed struct {
		Encode []struct {
			Magic   string `json:"magic"`
			Tag     string `json:"tag"`
			Content string `json:"content"`
			Hex     string `json:"hex"`
		} `json:"encode"`
		Read []struct {
			Name     string  `json:"name"`
			FileName string  `json:"fileName"`
			Magic    string  `json:"magic"`
			Hex      *string `json:"hex"`
			Tag      string  `json:"tag"`
			Content  string  `json:"content"`
			Error    string  `json:"error"`
		} `json:"read"`
	} `json:"sealed"`
}

func loadFiles(t *testing.T) files {
	var fixture files
	collabtest.Read(t, "collab-disk/codecs.json", &fixture)
	if len(fixture.Manifest.Encode) == 0 || len(fixture.Manifest.Read) == 0 || len(fixture.Sealed.Encode) == 0 || len(fixture.Sealed.Read) == 0 {
		t.Fatal("no manifest or sealed cases")
	}
	return fixture
}

func TestEncodesEveryManifestSlotToTheBytesCSharpWrites(t *testing.T) {
	for _, c := range loadFiles(t).Manifest.Encode {
		if got := hex.EncodeToString(EncodeManifestSlot(c.manifest(t))); got != c.Hex {
			t.Fatalf("counter %s:\n got %s\nwant %s", c.WriteCounter, got, c.Hex)
		}
	}
}

func TestReadsEveryManifestFileLikeCSharp(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ManifestFileName)
	for _, c := range loadFiles(t).Manifest.Read {
		if err := os.WriteFile(path, collabtest.Hex(t, c.Hex), 0o600); err != nil {
			t.Fatal(err)
		}
		got, err := ReadManifest(path, "doc-1")
		switch {
		case c.Error != "":
			var invalid *InvalidDataError
			if !errors.As(err, &invalid) || err.Error() != c.Error {
				t.Errorf("%s: error %v, want %q", c.Name, err, c.Error)
			}
		case err != nil:
			t.Errorf("%s: %v", c.Name, err)
		case c.Manifest == nil:
			if got != nil {
				t.Errorf("%s: %+v, want none", c.Name, *got)
			}
		case got == nil || *got != c.Manifest.manifest(t):
			t.Errorf("%s: %+v, want %+v", c.Name, got, c.Manifest.manifest(t))
		}
	}
}

func TestAMissingManifestIsNone(t *testing.T) {
	got, err := ReadManifest(filepath.Join(t.TempDir(), "no", ManifestFileName), "doc-1")
	if got != nil || err != nil {
		t.Fatalf("%v %v", got, err)
	}
}

func TestWritesEverySealedFileToTheBytesCSharpWrites(t *testing.T) {
	dir := t.TempDir()
	for i, c := range loadFiles(t).Sealed.Encode {
		path := filepath.Join(dir, "sealed")
		if err := WriteSealed(path, c.Magic, u64(t, c.Tag), collabtest.Hex(t, c.Content)); err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if got := hex.EncodeToString(data); got != c.Hex {
			t.Fatalf("case %d:\n got %s\nwant %s", i, got, c.Hex)
		}
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("mode %v", info.Mode())
		}
	}
}

func TestReadsEverySealedFileLikeCSharp(t *testing.T) {
	dir := t.TempDir()
	for _, c := range loadFiles(t).Sealed.Read {
		path := filepath.Join(dir, c.FileName)
		_ = os.Remove(path)
		if c.Hex != nil {
			if err := os.WriteFile(path, collabtest.Hex(t, *c.Hex), 0o600); err != nil {
				t.Fatal(err)
			}
		}
		content, tag, err := ReadSealed(path, c.Magic, "doc-1")
		if c.Error != "" {
			var invalid *InvalidDataError
			if !errors.As(err, &invalid) || err.Error() != c.Error {
				t.Errorf("%s: error %v, want %q", c.Name, err, c.Error)
			}
			continue
		}
		if err != nil || hex.EncodeToString(content) != c.Content || tag != u64(t, c.Tag) {
			t.Errorf("%s: %x %d %v", c.Name, content, tag, err)
		}
	}
}

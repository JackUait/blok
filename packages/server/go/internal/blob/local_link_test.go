package blob

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// C#'s File.Move succeeds on a file system without hard links (measured on
// FAT32), so Put must not depend on link(2).
func TestPutStoresTheFileWhenHardLinksFail(t *testing.T) {
	directory := t.TempDir()
	t.Cleanup(func() { link = os.Link })
	link = func(_, _ string) error { return &os.LinkError{Op: "link", Err: errors.ErrUnsupported} }
	store := &Local{Directory: directory, PublicURL: testPublicURL}

	url, err := store.Put(context.Background(), ".txt", "text/plain", strings.NewReader("hello"))
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(directory, strings.TrimPrefix(url, testPublicURL))
	if content, err := os.ReadFile(path); err != nil || string(content) != "hello" {
		t.Fatalf("stored %q, %v", content, err)
	}
	if info, err := os.Stat(path); err != nil || info.Mode().Perm() != 0o644 {
		t.Fatalf("mode %v, %v", info, err)
	}
	if entries, _ := os.ReadDir(directory); len(entries) != 1 {
		t.Fatalf("directory holds %d entries, want only the file", len(entries))
	}
}

func TestPutNeverOverwritesWhenHardLinksFail(t *testing.T) {
	directory := t.TempDir()
	t.Cleanup(func() { link = os.Link })
	// The key appears between the failed link and the fallback.
	link = func(_, final string) error {
		if err := os.WriteFile(final, []byte("first"), 0o644); err != nil {
			t.Fatal(err)
		}
		return &os.LinkError{Op: "link", Err: errors.ErrUnsupported}
	}
	store := &Local{Directory: directory, PublicURL: testPublicURL}

	if _, err := store.Put(context.Background(), ".txt", "text/plain", strings.NewReader("second")); err == nil {
		t.Fatal("Put wrote over an existing key")
	}
	entries, _ := os.ReadDir(directory)
	if len(entries) != 1 {
		t.Fatalf("directory holds %d entries, want only the first file", len(entries))
	}
	if content, _ := os.ReadFile(filepath.Join(directory, entries[0].Name())); string(content) != "first" {
		t.Fatalf("existing file now holds %q", content)
	}
}

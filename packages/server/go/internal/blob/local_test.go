package blob

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Hand ports of LocalBlobStoreTests. The key gate is the only thing that
// keeps a delete inside the storage directory.

const testPublicURL = "https://cdn.example.com/files/"

func TestRefusesForeignURLsWithoutTouchingBystanderFiles(t *testing.T) {
	key := strings.Repeat("a", 32) + ".txt"
	hex := "0123456789abcdef0123456789abcdef"
	urls := []string{
		"http://cdn.example.com/files/" + key,
		"https://evil.example.com/files/" + key,
		"https://cdn.example.com:444/files/" + key,
		"https://cdn.example.com/other/" + key,
		"https://cdn.example.com/files-confused/" + key,
		"https://cdn.example.com/files/sub/" + key,
		"https://cdn.example.com/files/../" + key,
		"https://cdn.example.com/files/%2e%2e%2f" + key,
		"https://cdn.example.com/files/" + strings.Repeat("A", 32) + ".txt",
		"https://cdn.example.com/files/" + strings.Repeat("g", 32) + ".txt",
		"https://cdn.example.com/files/" + strings.Repeat("a", 32) + ".TXT",
		"https://cdn.example.com/files/" + strings.Repeat("a", 32) + ".tar-gz",
		"https://cdn.example.com/files/" + strings.Repeat("a", 32) + "." + strings.Repeat("a", 16),
		"https://cdn.example.com/files/" + key + "/",
		// A generated prefix followed by a path that climbs out of the store.
		"https://cdn.example.com/files/" + hex + "/../../victim.txt",
		"https://cdn.example.com/files/" + hex + "/../" + key,
	}
	for _, url := range urls {
		root := t.TempDir()
		directory := filepath.Join(root, "store", "files")
		if err := os.MkdirAll(directory, 0o755); err != nil {
			t.Fatal(err)
		}
		bystander := filepath.Join(directory, key)
		victim := filepath.Join(root, "store", "victim.txt")
		for _, path := range []string{bystander, victim} {
			if err := os.WriteFile(path, []byte("bystander"), 0o644); err != nil {
				t.Fatal(err)
			}
		}
		store := &Local{Directory: directory, PublicURL: testPublicURL}

		if err := store.Delete(context.Background(), url); !errors.Is(err, ErrForeign) {
			t.Errorf("%s: got %v, want ErrForeign", url, err)
		}
		for _, path := range []string{bystander, victim} {
			if content, err := os.ReadFile(path); err != nil || string(content) != "bystander" {
				t.Errorf("%s: %s is gone or changed (%v)", url, path, err)
			}
		}
	}
}

func TestDeletesAnOwnedURLAndTreatsAnAbsentOwnedFileAsDeleted(t *testing.T) {
	directory := t.TempDir()
	store := &Local{Directory: directory, PublicURL: testPublicURL}
	url, err := store.Put(context.Background(), ".txt", "text/plain", strings.NewReader("bytes"))
	if err != nil {
		t.Fatal(err)
	}

	if err := store.Delete(context.Background(), url+"?download=1#file"); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(context.Background(), url); err != nil {
		t.Fatal(err)
	}
	if entries, _ := os.ReadDir(directory); len(entries) != 0 {
		t.Fatalf("left %v", entries)
	}
}

func TestKeepsOnlyABoundedASCIIAlphanumericExtension(t *testing.T) {
	cases := map[string]string{
		"":                  "",
		".A":                ".a",
		".AbC123":           ".abc123",
		".123456789012345":  ".123456789012345",
		".":                 "",
		".1234567890123456": "",
		".p ng":             "",
		".tar-gz":           "",
		".p/ng":             "",
		`.p\ng`:             "",
		".p\x00ng":          "",
		"png":               "",
		"../../evil.png":    "",
	}
	for supplied, want := range cases {
		directory := t.TempDir()
		store := &Local{Directory: directory, PublicURL: testPublicURL}
		if _, err := store.Put(context.Background(), supplied, "application/octet-stream", strings.NewReader("")); err != nil {
			t.Fatal(err)
		}
		entries, _ := os.ReadDir(directory)
		if len(entries) != 1 {
			t.Fatalf("%q: %d files", supplied, len(entries))
		}
		name := entries[0].Name()
		if len(name) != 32+len(want) || !IsGenerated(name) || name[32:] != want {
			t.Errorf("%q: stored as %q, want the extension %q", supplied, name, want)
		}
	}
}

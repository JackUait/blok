package blobstore_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/internal/blobstore"
)

func TestLocalDirStoresAndReturnsAPublicURL(t *testing.T) {
	dir := t.TempDir()
	store := blobstore.NewLocalDir(dir, "https://cdn.example.com/files")

	url, err := store.Put(context.Background(), "photo.png", "image/png", strings.NewReader("bytes"))
	if err != nil {
		t.Fatalf("put: %v", err)
	}
	if !strings.HasPrefix(url, "https://cdn.example.com/files/") {
		t.Fatalf("url = %q", url)
	}

	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("wrote %d files, want 1", len(entries))
	}
	got, _ := os.ReadFile(filepath.Join(dir, entries[0].Name()))
	if string(got) != "bytes" {
		t.Fatalf("contents = %q", got)
	}
}

// A filename is attacker-controlled. It must never steer the write.
func TestLocalDirIgnoresPathsInTheSuppliedName(t *testing.T) {
	dir := t.TempDir()
	store := blobstore.NewLocalDir(dir, "https://cdn.example.com/files")

	if _, err := store.Put(context.Background(), "../../etc/passwd", "text/plain", strings.NewReader("x")); err != nil {
		t.Fatalf("put: %v", err)
	}

	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("wrote %d files into the target dir, want 1", len(entries))
	}
	if strings.Contains(entries[0].Name(), "..") || strings.Contains(entries[0].Name(), "/") {
		t.Fatalf("stored name = %q", entries[0].Name())
	}
}

// The stored name is hex + extension, and that string lands both on disk and
// in a URL. Everything the extension is allowed to be is decided here.
func TestLocalDirKeepsOnlyAnAlphanumericBoundedExtension(t *testing.T) {
	cases := []struct {
		name     string
		supplied string
		want     string
	}{
		{"a plain extension survives", "photo.png", ".png"},
		{"case is folded", "photo.PNG", ".png"},
		{"only the last extension survives", "archive.tar.gz", ".gz"},
		{"no extension at all", "photo", ""},
		{"a trailing dot is not an extension", "photo.", ""},
		{"a path in the name contributes nothing", "../../etc/passwd", ""},
		{"a directory-looking name yields nothing", "evil.png/", ""},
		{"a backslash path still yields the real extension", `..\..\evil.png`, ".png"},
		{"a NUL byte is refused", "photo.p\x00ng", ""},
		{"a space is refused", "photo.p g", ""},
		{"a separator inside the extension is refused", "photo.p/g", ""},
		{"a dash is refused", "photo.tar-gz", ""},
		{"the longest allowed extension survives", "photo." + strings.Repeat("a", 15), "." + strings.Repeat("a", 15)},
		{"one character past the cap is refused", "photo." + strings.Repeat("a", 16), ""},
		{"a 40 kB extension is refused", "photo." + strings.Repeat("a", 40<<10), ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			store := blobstore.NewLocalDir(dir, "https://cdn.example.com/files")

			url, err := store.Put(context.Background(), tc.supplied, "application/octet-stream", strings.NewReader("x"))
			if err != nil {
				t.Fatalf("put: %v", err)
			}

			entries, _ := os.ReadDir(dir)
			if len(entries) != 1 {
				t.Fatalf("wrote %d files, want 1", len(entries))
			}
			stored := entries[0].Name()
			if !strings.HasSuffix(url, "/"+stored) {
				t.Fatalf("url %q does not end in the stored name %q", url, stored)
			}
			// 16 random bytes, hex-encoded.
			if got := stored[32:]; got != tc.want {
				t.Fatalf("stored name = %q, extension = %q, want %q", stored, got, tc.want)
			}
		})
	}
}

type errAfter struct {
	remaining int
}

func (e *errAfter) Read(p []byte) (int, error) {
	if e.remaining <= 0 {
		return 0, errors.New("connection reset")
	}
	n := min(len(p), e.remaining)
	for i := range n {
		p[i] = 'x'
	}
	e.remaining -= n

	return n, nil
}

// A failed copy hands the caller an error and no URL, so nothing will ever
// come back to clean up: a half-written blob would sit in the directory
// forever.
func TestLocalDirLeavesNothingBehindWhenTheBodyFails(t *testing.T) {
	dir := t.TempDir()
	store := blobstore.NewLocalDir(dir, "https://cdn.example.com/files")

	if _, err := store.Put(context.Background(), "photo.png", "image/png", &errAfter{remaining: 4096}); err == nil {
		t.Fatal("err = nil, want the copy failure")
	}

	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatalf("left %d files behind: %v", len(entries), entries)
	}
}

// The directory is meant to be served, often by a web server running as a
// different user than this process.
func TestLocalDirStoresAReadableFile(t *testing.T) {
	dir := t.TempDir()
	store := blobstore.NewLocalDir(dir, "https://cdn.example.com/files")

	if _, err := store.Put(context.Background(), "photo.png", "image/png", strings.NewReader("bytes")); err != nil {
		t.Fatalf("put: %v", err)
	}

	entries, _ := os.ReadDir(dir)
	info, err := entries[0].Info()
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if perm := info.Mode().Perm(); perm&0o044 != 0o044 {
		t.Fatalf("mode = %v, want group- and world-readable", perm)
	}
}

func TestLocalDirDeleteRemovesTheStoredFile(t *testing.T) {
	dir := t.TempDir()
	store := blobstore.NewLocalDir(dir, "https://cdn.example.com/files")

	url, err := store.Put(context.Background(), "photo.png", "image/png", strings.NewReader("bytes"))
	if err != nil {
		t.Fatalf("put: %v", err)
	}
	if err := store.Delete(context.Background(), url); err != nil {
		t.Fatalf("delete: %v", err)
	}

	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatalf("%d files left", len(entries))
	}
}

// A stored URL reaches Delete the way the consumer kept it, which is not
// necessarily byte-for-byte what Put returned.
func TestLocalDirDeleteIgnoresAQueryStringAndFragment(t *testing.T) {
	for _, suffix := range []string{"?v=2", "#anchor", "?v=2#anchor"} {
		t.Run(suffix, func(t *testing.T) {
			dir := t.TempDir()
			store := blobstore.NewLocalDir(dir, "https://cdn.example.com/files")

			url, err := store.Put(context.Background(), "photo.png", "image/png", strings.NewReader("bytes"))
			if err != nil {
				t.Fatalf("put: %v", err)
			}
			if err := store.Delete(context.Background(), url+suffix); err != nil {
				t.Fatalf("delete: %v", err)
			}

			entries, _ := os.ReadDir(dir)
			if len(entries) != 0 {
				t.Fatalf("%d files left", len(entries))
			}
		})
	}
}

func TestLocalDirDeleteRefusesAURLItDidNotProduce(t *testing.T) {
	cases := map[string]string{
		"another host":             "https://evil.example.com/files/abc.png",
		"another prefix":           "https://cdn.example.com/other/abc.png",
		"a traversal":              "https://cdn.example.com/files/../../etc/passwd",
		"an encoded traversal":     "https://cdn.example.com/files/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
		"a nested path":            "https://cdn.example.com/files/sub/abc.png",
		"a name we never generate": "https://cdn.example.com/files/passwd",
	}

	for name, url := range cases {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			store := blobstore.NewLocalDir(dir, "https://cdn.example.com/files")

			bystander := filepath.Join(dir, "passwd")
			if err := os.WriteFile(bystander, []byte("root:x:0:0"), 0o644); err != nil {
				t.Fatalf("seed: %v", err)
			}

			err := store.Delete(context.Background(), url)
			if !errors.Is(err, blobstore.ErrForeignURL) {
				t.Fatalf("err = %v, want ErrForeignURL", err)
			}
			if _, err := os.Stat(bystander); err != nil {
				t.Fatalf("bystander file was touched: %v", err)
			}
		})
	}
}

// Deleting a blob that is already gone is the normal result of a retry, not a
// failure the caller can act on.
func TestLocalDirDeleteIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	store := blobstore.NewLocalDir(dir, "https://cdn.example.com/files")

	url, err := store.Put(context.Background(), "photo.png", "image/png", strings.NewReader("bytes"))
	if err != nil {
		t.Fatalf("put: %v", err)
	}
	if err := store.Delete(context.Background(), url); err != nil {
		t.Fatalf("first delete: %v", err)
	}
	if err := store.Delete(context.Background(), url); err != nil {
		t.Fatalf("second delete: %v", err)
	}
}

func TestLocalDirCreatesTheDirectoryOnFirstUse(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "uploads", "blobs")
	store := blobstore.NewLocalDir(dir, "https://cdn.example.com/files")

	if _, err := store.Put(context.Background(), "photo.png", "image/png", strings.NewReader("bytes")); err != nil {
		t.Fatalf("put: %v", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read dir: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("wrote %d files, want 1", len(entries))
	}
}

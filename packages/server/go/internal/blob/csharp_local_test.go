package blob

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
	"time"
)

// Twins of the LocalBlobStoreTests cases with no Go test.

var generatedTxt = regexp.MustCompile(`^[0-9a-f]{32}\.txt$`)

func localStore(t *testing.T) (*Local, string) {
	t.Helper()
	directory := filepath.Join(t.TempDir(), "not", "yet")
	return &Local{Directory: directory, PublicURL: "https://cdn.example.com/files/"}, directory
}

func entries(t *testing.T, directory string) []os.DirEntry {
	t.Helper()
	list, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	return list
}

func single(t *testing.T, directory string) string {
	t.Helper()
	list := entries(t, directory)
	if len(list) != 1 {
		t.Fatalf("%d entries in %s", len(list), directory)
	}
	return list[0].Name()
}

// pausingReader returns its bytes once, then blocks until resumed.
type pausingReader struct {
	bytes    []byte
	returned bool
	paused   chan struct{}
	resumed  chan struct{}
}

func newPausingReader(bytes string) *pausingReader {
	return &pausingReader{bytes: []byte(bytes), paused: make(chan struct{}), resumed: make(chan struct{})}
}

func (p *pausingReader) Read(buffer []byte) (int, error) {
	if p.returned {
		close(p.paused)
		<-p.resumed
		return 0, io.EOF
	}
	p.returned = true
	return copy(buffer, p.bytes), nil
}

func (p *pausingReader) waitUntilPaused(t *testing.T) {
	t.Helper()
	select {
	case <-p.paused:
	case <-time.After(5 * time.Second):
		t.Fatal("the copy never paused")
	}
}

type putResult struct {
	url string
	err error
}

func putAsync(store *Local, reader *pausingReader) chan putResult {
	done := make(chan putResult, 1)
	go func() {
		url, err := store.Put(context.Background(), ".txt", "text/plain", reader)
		done <- putResult{url, err}
	}()
	return done
}

// failingReader returns "partial" once, then the error.
type failingReader struct {
	returned bool
	err      error
	onFirst  func()
}

func (f *failingReader) Read(buffer []byte) (int, error) {
	if f.returned {
		return 0, f.err
	}
	f.returned = true
	if f.onFirst != nil {
		f.onFirst()
	}
	return copy(buffer, "partial"), nil
}

func TestStoresBytesUnderARandomKeyAndReturnsThePublicUrl(t *testing.T) {
	store, directory := localStore(t)

	url, err := store.Put(context.Background(), ".PNG", "image/png", strings.NewReader("stored bytes"))
	if err != nil {
		t.Fatal(err)
	}

	key := single(t, directory)
	if !regexp.MustCompile(`^[0-9a-f]{32}\.png$`).MatchString(key) {
		t.Fatalf("key %q", key)
	}
	if url != "https://cdn.example.com/files/"+key {
		t.Fatalf("url %q", url)
	}
	if data, _ := os.ReadFile(filepath.Join(directory, key)); string(data) != "stored bytes" {
		t.Fatalf("stored %q", data)
	}
}

func TestCreatesTheDestinationDirectoryOnFirstPut(t *testing.T) {
	store, directory := localStore(t)

	if _, err := store.Put(context.Background(), ".txt", "text/plain", strings.NewReader("bytes")); err != nil {
		t.Fatal(err)
	}

	if info, err := os.Stat(directory); err != nil || !info.IsDir() {
		t.Fatalf("directory: %v", err)
	}
	single(t, directory)
}

func TestDoesNotPublishTheFinalNameBeforeTheCopyCompletes(t *testing.T) {
	store, directory := localStore(t)
	content := newPausingReader("partial bytes")
	done := putAsync(store, content)

	content.waitUntilPaused(t)

	inProgress := single(t, directory)
	if !strings.HasPrefix(inProgress, ".blok-upload-") || generatedTxt.MatchString(inProgress) {
		t.Fatalf("in progress %q", inProgress)
	}

	close(content.resumed)
	result := <-done
	if result.err != nil {
		t.Fatal(result.err)
	}

	key := single(t, directory)
	if !generatedTxt.MatchString(key) || !strings.HasSuffix(result.url, "/"+key) {
		t.Fatalf("key %q url %q", key, result.url)
	}
}

func TestCreatesTheTemporaryFileOwnerOnlyWhileCopying(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("no Unix modes")
	}
	store, directory := localStore(t)
	content := newPausingReader("private bytes")
	done := putAsync(store, content)
	content.waitUntilPaused(t)
	defer func() {
		close(content.resumed)
		<-done
	}()

	info, err := os.Stat(filepath.Join(directory, single(t, directory)))
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Fatalf("mode %v while copying, want 0600", mode)
	}
}

func TestRemovesTheTemporaryFileWhenTheInputFails(t *testing.T) {
	store, directory := localStore(t)

	_, err := store.Put(context.Background(), ".txt", "text/plain", &failingReader{err: errors.New("connection reset")})

	if err == nil || err.Error() != "connection reset" {
		t.Fatalf("err %v", err)
	}
	if list := entries(t, directory); len(list) != 0 {
		t.Fatalf("left %v", list)
	}
}

func TestRemovesTheTemporaryFileWhenTheCopyIsCancelled(t *testing.T) {
	store, directory := localStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	_, err := store.Put(ctx, ".txt", "text/plain", &failingReader{err: context.Canceled, onFirst: cancel})

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err %v", err)
	}
	if list := entries(t, directory); len(list) != 0 {
		t.Fatalf("left %v", list)
	}
}

func TestStoresAWorldReadableFileWhereUnixModesAreSupported(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("no Unix modes")
	}
	store, directory := localStore(t)

	if _, err := store.Put(context.Background(), ".txt", "text/plain", strings.NewReader("bytes")); err != nil {
		t.Fatal(err)
	}

	info, err := os.Stat(filepath.Join(directory, single(t, directory)))
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o644 {
		t.Fatalf("mode %v, want 0644", mode)
	}
}

func TestACancelledDeleteDoesNotRemoveTheFile(t *testing.T) {
	store, directory := localStore(t)
	url, err := store.Put(context.Background(), ".txt", "text/plain", strings.NewReader("bytes"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if err := store.Delete(ctx, url); !errors.Is(err, context.Canceled) {
		t.Fatalf("err %v", err)
	}
	single(t, directory)
}

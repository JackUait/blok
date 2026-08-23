package blobstore

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// LocalDir writes blobs into a directory on this machine — the driver for an
// operator running this container next to their app. It performs no network
// I/O of any kind.
//
// SERVING THE DIRECTORY IS NOT THIS PACKAGE'S JOB, AND IT IS WHERE THE RISK
// IS. Whatever exposes these files decides their Content-Type, and a stock
// http.FileServer sniffs the bytes whenever the extension maps to nothing —
// so an uploaded HTML file comes back as text/html from the operator's own
// origin whatever extension is stored. Dropping "dangerous" extensions here
// would close none of that, so it is deliberately not done. Whatever mounts
// this directory must send Content-Disposition: attachment and
// X-Content-Type-Options: nosniff, and should serve it from a different origin
// than the app.
type LocalDir struct {
	dir       string
	publicURL string
}

var _ BlobStore = (*LocalDir)(nil)

func NewLocalDir(dir, publicURL string) *LocalDir {
	return &LocalDir{dir: dir, publicURL: strings.TrimRight(publicURL, "/")}
}

func (l *LocalDir) Put(_ context.Context, name, _ string, r io.Reader) (string, error) {
	if err := os.MkdirAll(l.dir, 0o755); err != nil {
		return "", err
	}

	stored, err := newStoredName(name)
	if err != nil {
		return "", err
	}

	if err := writeBlob(filepath.Join(l.dir, stored), r); err != nil {
		return "", err
	}

	return l.publicURL + "/" + stored, nil
}

func (l *LocalDir) Delete(_ context.Context, rawURL string) error {
	stored, err := keyFromPublicURL(l.publicURL, rawURL)
	if err != nil {
		return err
	}

	// A blob that is already gone is what a retried delete looks like, not a
	// failure the caller can do anything with.
	if err := os.Remove(filepath.Join(l.dir, stored)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}

	return nil
}

// writeBlob lands the bytes under a temporary name and renames only once they
// are all on disk. A failed copy hands the caller an error and no URL, so
// nothing will ever come back to clean up — writing in place would leave a
// truncated blob in the directory forever.
//
// The temporary file has to be created in the destination directory: rename is
// atomic only within one filesystem, and os.TempDir is frequently another one.
func writeBlob(path string, r io.Reader) (err error) {
	f, err := os.CreateTemp(filepath.Dir(path), ".blok-upload-*")
	if err != nil {
		return err
	}
	tmp := f.Name()

	defer func() {
		if err != nil {
			f.Close()
			os.Remove(tmp)
		}
	}()

	if _, err = io.Copy(f, r); err != nil {
		return err
	}
	// The rename below publishes the name, so the bytes have to be durable
	// before it runs: a crash in between would leave a live URL over an empty
	// file.
	if err = f.Sync(); err != nil {
		return err
	}
	// os.CreateTemp makes the file 0600. This directory exists to be served,
	// often by a web server running as a different user than this process.
	if err = f.Chmod(0o644); err != nil {
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}

	err = os.Rename(tmp, path)

	return err
}

package blob

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// Local is LocalBlobStore: files in one directory, served under PublicURL.
type Local struct {
	Directory string
	PublicURL string
}

// Put writes content to a 0600 temporary file in the directory, syncs it,
// makes it 0644 and renames it into place, never over an existing file.
func (l *Local) Put(ctx context.Context, extension, _ string, content io.Reader) (string, error) {
	if err := os.MkdirAll(l.Directory, 0o777); err != nil {
		return "", err
	}
	key := NewKey(extension)
	finalPath := filepath.Join(l.Directory, key)
	var random [16]byte
	_, _ = rand.Read(random[:])
	temporaryPath := filepath.Join(l.Directory, ".blok-upload-"+hex.EncodeToString(random[:]))
	file, err := os.OpenFile(temporaryPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return "", err
	}
	committed := false
	defer func() {
		if !committed {
			_ = file.Close()
			_ = os.Remove(temporaryPath)
		}
	}()
	if _, err := io.Copy(file, contextReader{ctx, content}); err != nil {
		return "", err
	}
	if err := file.Sync(); err != nil {
		return "", err
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if err := os.Chmod(temporaryPath, 0o644); err != nil {
		return "", err
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	// File.Move refuses to overwrite; a hard link does too.
	if err := os.Link(temporaryPath, finalPath); err != nil {
		return "", err
	}
	committed = true
	_ = os.Remove(temporaryPath)
	return strings.TrimRight(l.PublicURL, "/") + "/" + key, nil
}

// Delete removes the file. A missing file is fine; a missing directory is an
// error, as File.Delete throws DirectoryNotFoundException.
func (l *Local) Delete(ctx context.Context, url string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	key, ok := KeyFromPublicURL(l.PublicURL, url)
	if !ok {
		return ErrForeign
	}
	err := os.Remove(filepath.Join(l.Directory, key))
	if errors.Is(err, fs.ErrNotExist) {
		if _, statErr := os.Stat(l.Directory); statErr != nil {
			return statErr
		}
		return nil
	}
	return err
}

type contextReader struct {
	ctx context.Context
	r   io.Reader
}

func (c contextReader) Read(p []byte) (int, error) {
	if err := c.ctx.Err(); err != nil {
		return 0, err
	}
	return c.r.Read(p)
}

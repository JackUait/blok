// Package blobstore is where uploaded bytes go. The consumer chooses the
// destination; this service only hands the bytes over and never owns the
// consumer's records.
//
// Both drivers generate the stored name themselves — 16 random bytes, hex —
// and carry nothing across from the browser but a narrow extension. That one
// rule is what makes the name safe to put in a filesystem path, in a URL and
// in an S3 key at the same time, and it is what makes Delete able to refuse a
// URL this store never produced.
package blobstore

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
)

// BlobStore is where uploaded bytes go. The consumer chooses the destination;
// this service only hands bytes over. Implementations must treat `name` as
// untrusted — it comes from the browser.
type BlobStore interface {
	Put(ctx context.Context, name string, mimeType string, r io.Reader) (string, error)
	Delete(ctx context.Context, url string) error
}

// ErrForeignURL is returned by Delete for a URL this store did not produce.
// Deleting by URL is the only operation a caller can point at an arbitrary
// string, so anything that is not exactly one of our own generated names is
// refused rather than interpreted.
var ErrForeignURL = errors.New("blobstore: url was not produced by this store")

const (
	// storedNameLen is the hex length of the 16 random bytes every stored name
	// starts with.
	storedNameLen = 32

	// maxExtLen bounds the extension, excluding its dot. An extension is
	// copied from a browser-supplied filename, where "photo." followed by 40 kB
	// of characters is a perfectly sendable name and an unwritable file.
	maxExtLen = 15
)

// newStoredName returns the name to store under: random hex plus whatever the
// supplied filename's extension is allowed to contribute.
func newStoredName(name string) (string, error) {
	buf := make([]byte, storedNameLen/2)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}

	return hex.EncodeToString(buf) + extensionFor(name), nil
}

// extensionFor is the whole rule: an extension survives only if it is a dot
// followed by 1 to maxExtLen ASCII alphanumerics, lowercased. Anything else —
// a path separator, a NUL, a space, a second dot, 40 kB of characters — yields
// no extension at all.
//
// The allowlist, not filepath.Ext, is what makes this safe. Ext alone happily
// returns ".p\x00ng" (which os.Create refuses) or a 40 kB suffix (which the
// filesystem refuses), and it treats a Windows-style "..\..\evil.png" as one
// element.
func extensionFor(name string) string {
	ext := filepath.Ext(name)
	if len(ext) < 2 || len(ext) > maxExtLen+1 {
		return ""
	}

	for i := 1; i < len(ext); i++ {
		switch c := ext[i]; {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		default:
			return ""
		}
	}

	return strings.ToLower(ext)
}

// keyFromPublicURL recovers the stored name from a URL Put handed out. Both
// drivers use it so there is one rule and not two: a URL only names a blob if
// it sits directly under this store's configured public prefix and its last
// segment is a name this package generates. A query string or fragment the
// consumer appended is ignored — the URL comes back the way they kept it, not
// necessarily byte-for-byte as it left.
func keyFromPublicURL(publicURL, rawURL string) (string, error) {
	trimmed := rawURL
	if i := strings.IndexAny(trimmed, "?#"); i >= 0 {
		trimmed = trimmed[:i]
	}

	prefix := strings.TrimRight(publicURL, "/") + "/"
	key, found := strings.CutPrefix(trimmed, prefix)
	if !found || !isStoredName(key) {
		return "", fmt.Errorf("%w: %s", ErrForeignURL, rawURL)
	}

	return key, nil
}

// isStoredName reports whether s is a name newStoredName could have produced.
// Comparing the tail against extensionFor keeps the two definitions from
// drifting: a name that fails here is one Put could never have written.
func isStoredName(s string) bool {
	if len(s) < storedNameLen {
		return false
	}

	for i := range storedNameLen {
		switch c := s[i]; {
		case c >= '0' && c <= '9', c >= 'a' && c <= 'f':
		default:
			return false
		}
	}

	rest := s[storedNameLen:]

	return rest == "" || rest == extensionFor(rest)
}

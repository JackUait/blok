// Package blob stores uploaded files: in a local directory or in S3. Keys
// are 32 random lowercase hex digits plus a normalized extension, as in C#'s
// BlobKey.
package blob

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"strings"
)

// ErrForeign is a delete for a URL this store did not issue.
var ErrForeign = errors.New("blob: the URL was not issued by this store")

// Store is IBlobStore.
type Store interface {
	// Put stores content and returns its public URL.
	Put(ctx context.Context, extension, mimeType string, content io.Reader) (string, error)
	// Delete removes the file behind url; ErrForeign for a URL it never issued.
	Delete(ctx context.Context, url string) error
}

const (
	hexLength          = 32
	maxExtensionLength = 15
)

// NewKey is BlobKey.Create.
func NewKey(extension string) string {
	var random [hexLength / 2]byte
	_, _ = rand.Read(random[:])
	return hex.EncodeToString(random[:]) + NormalizeExtension(extension)
}

// NormalizeExtension keeps "." plus 1 to 15 ASCII letters and digits,
// lowercased, and drops anything else.
func NormalizeExtension(extension string) string {
	if len(extension) < 2 || len(extension) > maxExtensionLength+1 || extension[0] != '.' {
		return ""
	}
	for i := 1; i < len(extension); i++ {
		c := extension[i]
		if !('a' <= c && c <= 'z' || 'A' <= c && c <= 'Z' || '0' <= c && c <= '9') {
			return ""
		}
	}
	return strings.ToLower(extension)
}

// IsGenerated reports whether key has the shape NewKey makes.
func IsGenerated(key string) bool {
	if len(key) < hexLength {
		return false
	}
	for i := 0; i < hexLength; i++ {
		c := key[i]
		if !('0' <= c && c <= '9' || 'a' <= c && c <= 'f') {
			return false
		}
	}
	extension := key[hexLength:]
	return extension == "" || extension == NormalizeExtension(extension)
}

// KeyFromPublicURL is BlobKey.TryParsePublicUrl: an ordinal prefix match
// after the query and fragment are cut off.
func KeyFromPublicURL(publicURL, rawURL string) (string, bool) {
	if cut := strings.IndexAny(rawURL, "?#"); cut >= 0 {
		rawURL = rawURL[:cut]
	}
	prefix := strings.TrimRight(publicURL, "/") + "/"
	if !strings.HasPrefix(rawURL, prefix) {
		return "", false
	}
	key := rawURL[len(prefix):]
	return key, IsGenerated(key)
}

// Extension is Path.GetExtension: the text from the last "." of the last
// path segment, or "" when that "." ends the name.
func Extension(name string) string {
	for i := len(name) - 1; i >= 0; i-- {
		switch name[i] {
		case '.':
			if i == len(name)-1 {
				return ""
			}
			return name[i:]
		case '/', '\\':
			return ""
		}
	}
	return ""
}

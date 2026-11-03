package blob

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// C#'s PreparedPayload hashes a seekable body in place and spools only a
// non-seekable one, creating the temp directory first.

func TestPutsASeekableBodyWithoutATempFile(t *testing.T) {
	bucket := &fakeBucket{}
	s := bucketStore(t, bucket)
	s.TempDir = filepath.Join(t.TempDir(), "file-not-a-directory")
	if err := os.WriteFile(s.TempDir, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	body := strings.Repeat("x", int(s.MaxSpoolBytes)+1)

	if _, err := s.Put(context.Background(), ".bin", "", strings.NewReader(body)); err != nil {
		t.Fatal(err)
	}
	r := bucket.requests[0]
	sum := sha256.Sum256([]byte(body))
	if len(bucket.requests) != 1 || r.Header.Get("X-Amz-Content-Sha256") != hex.EncodeToString(sum[:]) ||
		r.ContentLength != int64(len(body)) {
		t.Fatalf("sent %d requests, %v", len(bucket.requests), r.Header)
	}
	for _, content := range bucket.objects {
		if !bytes.Equal(content, []byte(body)) {
			t.Fatalf("stored %d bytes", len(content))
		}
	}
}

func TestSpoolCreatesTheTempDirectory(t *testing.T) {
	bucket := &fakeBucket{}
	s := bucketStore(t, bucket)
	s.TempDir = filepath.Join(t.TempDir(), "missing", "spool")

	if _, err := s.Put(context.Background(), ".bin", "", onlyReader{strings.NewReader("hello")}); err != nil {
		t.Fatal(err)
	}
	if left, err := os.ReadDir(s.TempDir); err != nil || len(left) != 0 {
		t.Fatalf("%d spool files left, %v", len(left), err)
	}
}

// onlyReader hides Seek, like a request body.
type onlyReader struct{ r *strings.Reader }

func (o onlyReader) Read(p []byte) (int, error) { return o.r.Read(p) }

package blob

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// Hand ports of S3TargetResolverTests, S3RequestSignerTests and
// S3BlobStoreObjectMethodsTests (Blok.Server.Tests); the expected values are
// the C# ones.

func testS3(endpoint, bucket, addressing string) *S3 {
	return &S3{
		Endpoint: endpoint, Region: "eu-central-1", Bucket: bucket,
		AccessKey: "AKIAEXAMPLE", SecretKey: "wJalrXUtnFEMI/K7MDENG",
		PublicURL: "https://cdn.example.com/media", Addressing: addressing,
		MaxSpoolBytes: 1024,
	}
}

func TestResolvesTheFrozenAddressingContract(t *testing.T) {
	for _, c := range []struct{ endpoint, bucket, addressing, url, host string }{
		{"http://127.0.0.1:9000", "media", "", "http://127.0.0.1:9000/media/key.png", "127.0.0.1:9000"},
		{"https://minio.internal:9000", "media", "", "https://minio.internal:9000/media/key.png", "minio.internal:9000"},
		{"https://abc123.r2.cloudflarestorage.com", "media", "", "https://abc123.r2.cloudflarestorage.com/media/key.png", "abc123.r2.cloudflarestorage.com"},
		{"https://s3.eu-central-1.amazonaws.com", "media", "", "https://media.s3.eu-central-1.amazonaws.com/key.png", "media.s3.eu-central-1.amazonaws.com"},
		{"https://s3.eu-central-1.amazonaws.com", "my.media", "", "https://s3.eu-central-1.amazonaws.com/my.media/key.png", "s3.eu-central-1.amazonaws.com"},
		{"https://s3.amazonaws.com", "Media", "", "https://s3.amazonaws.com/Media/key.png", "s3.amazonaws.com"},
		{"https://s3.amazonaws.com", "media", "path", "https://s3.amazonaws.com/media/key.png", "s3.amazonaws.com"},
		{"https://minio.internal:9000", "media", "virtual", "https://media.minio.internal:9000/key.png", "media.minio.internal:9000"},
		{"https://minio.internal:9000", "team.assets", "virtual", "https://team.assets.minio.internal:9000/key.png", "team.assets.minio.internal:9000"},
		{"https://s3.example.com:443", "media", "", "https://s3.example.com/media/key.png", "s3.example.com"},
		{"https://s3.example.com/?debug=1", "media", "", "https://s3.example.com/media/key.png", "s3.example.com"},
	} {
		url, host, err := testS3(c.endpoint, c.bucket, c.addressing).target("key.png")
		if err != nil {
			t.Errorf("%s %s %q: %v", c.endpoint, c.bucket, c.addressing, err)
			continue
		}
		if url.AbsoluteURI != c.url || host != c.host {
			t.Errorf("%s %s %q: got %s %s, want %s %s", c.endpoint, c.bucket, c.addressing, url.AbsoluteURI, host, c.url, c.host)
		}
	}
}

func TestRefusesAnUnusableTarget(t *testing.T) {
	for _, c := range []struct{ endpoint, bucket, addressing string }{
		{"", "media", ""},
		{"/just/a/path", "media", ""},
		{"https://s3.example.com", "", ""},
		{"https://s3.example.com/%zz", "media", ""},
		{"https://s3.example.com", "media/../secrets", ""},
		{"https://ünïcode.example.com", "media", ""},
		{"https://s3.example.com", "media", "dns"},
		{"https://s3.example.com", "my_bucket", "virtual"},
		{"https://gateway.example.com/s3", "media", ""},
		{"https://s3.example.com/s3/..", "media", ""},
		{"https://s3.example.com/s3/%2e%2e", "media", ""},
		{"https://s3.example.com/%2e", "media", ""},
		{"https://s3.example.com/%2E%2E", "media", ""},
		{"https://s3.example.com/./", "media", ""},
	} {
		if _, err := NewS3(testS3(c.endpoint, c.bucket, c.addressing)); err == nil {
			t.Errorf("%q %q %q: accepted", c.endpoint, c.bucket, c.addressing)
		}
	}
}

var frozenTime = time.Date(2025, 1, 2, 3, 4, 5, 0, time.UTC)

func TestMatchesTheFrozenSigV4Vector(t *testing.T) {
	s := testS3("https://s3.example.com", "media", "path")
	url, host, err := s.target("key.png")
	if err != nil {
		t.Fatal(err)
	}
	request, _ := http.NewRequest(http.MethodPut, url.AbsoluteURI, strings.NewReader("bytes"))
	const hash = "277089d91c0bdf4f2e6862ba7e4a07605119431f5d13f726dd352b06f1b206a9"
	sign(request, url.AbsolutePath, host, s.Region, s.AccessKey, s.SecretKey, "image/png", hash, frozenTime)
	if request.Host != "s3.example.com" || request.Header.Get("X-Amz-Content-Sha256") != hash || request.Header.Get("X-Amz-Date") != "20250102T030405Z" {
		t.Fatalf("got Host %q, headers %v", request.Host, request.Header)
	}
	want := "AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20250102/eu-central-1/s3/aws4_request, " +
		"SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, " +
		"Signature=2d50477b639388426c272609afac34d42f0f92aac413acf8afc4deee4278ec0c"
	if got := request.Header.Get("Authorization"); got != want {
		t.Fatalf("Authorization\n got %s\nwant %s", got, want)
	}
}

// fakeBucket is the C# FakeS3Bucket as a RoundTripper.
type fakeBucket struct {
	mu       sync.Mutex
	objects  map[string][]byte
	requests []*http.Request
	bodies   [][]byte
	status   int
}

func (b *fakeBucket) RoundTrip(r *http.Request) (*http.Response, error) {
	body := []byte{}
	if r.Body != nil {
		body, _ = io.ReadAll(r.Body)
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.requests = append(b.requests, r)
	b.bodies = append(b.bodies, body)
	respond := func(status int, content []byte) (*http.Response, error) {
		return &http.Response{StatusCode: status, Body: io.NopCloser(bytes.NewReader(content)), Header: http.Header{}, Request: r}, nil
	}
	if b.status != 0 {
		return respond(b.status, nil)
	}
	switch r.Method {
	case http.MethodGet:
		if content, ok := b.objects[r.URL.Path]; ok {
			return respond(200, content)
		}
		return respond(404, nil)
	case http.MethodPut:
		b.objects[r.URL.Path] = body
	case http.MethodDelete:
		delete(b.objects, r.URL.Path)
	}
	return respond(200, nil)
}

const (
	collabKey  = "collab/working-set-key"
	objectPath = "/media/collab/working-set-key"
)

func bucketStore(t *testing.T, bucket *fakeBucket) *S3 {
	t.Helper()
	if bucket.objects == nil {
		bucket.objects = map[string][]byte{}
	}
	s, err := NewS3(testS3("https://s3.example.com", "media", ""))
	if err != nil {
		t.Fatal(err)
	}
	s.Now = func() time.Time { return frozenTime }
	s.client = &http.Client{Transport: bucket}
	return s
}

func TestGetsAnObjectByItsKey(t *testing.T) {
	bucket := &fakeBucket{objects: map[string][]byte{objectPath: []byte("stored bytes")}}
	got, err := bucketStore(t, bucket).GetObject(context.Background(), collabKey)
	if err != nil || string(got) != "stored bytes" {
		t.Fatalf("got %q, %v", got, err)
	}
	r := bucket.requests[0]
	if len(bucket.requests) != 1 || r.URL.Path != objectPath || r.Host != "s3.example.com" || r.Header.Get("X-Amz-Date") != "20250102T030405Z" ||
		!strings.Contains(r.Header.Get("Authorization"), "SignedHeaders=host;x-amz-content-sha256;x-amz-date") {
		t.Fatalf("request %s %s %v", r.Host, r.URL.Path, r.Header)
	}
}

func TestGetTreatsOnlyNotFoundAsAbsent(t *testing.T) {
	got, err := bucketStore(t, &fakeBucket{}).GetObject(context.Background(), collabKey)
	if err != nil || got != nil {
		t.Fatalf("got %q, %v; want nil, nil", got, err)
	}
}

func TestGetFailsOnForbidden(t *testing.T) {
	_, err := bucketStore(t, &fakeBucket{status: 403}).GetObject(context.Background(), collabKey)
	if err == nil || !strings.Contains(err.Error(), "returned 403") {
		t.Fatalf("got %v, want a 403 error", err)
	}
}

func TestPutsAnObjectWithItsHashAndOctetStreamType(t *testing.T) {
	bucket := &fakeBucket{}
	content := []byte("collab log bytes")
	if err := bucketStore(t, bucket).PutObject(context.Background(), collabKey, content); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(content)
	r := bucket.requests[0]
	if !bytes.Equal(bucket.objects[objectPath], content) || r.Method != http.MethodPut ||
		r.Header.Get("Content-Type") != "application/octet-stream" || r.ContentLength != int64(len(content)) ||
		r.Header.Get("X-Amz-Content-Sha256") != hex.EncodeToString(sum[:]) ||
		!strings.Contains(r.Header.Get("Authorization"), "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date") {
		t.Fatalf("request %s %d %v", r.Method, r.ContentLength, r.Header)
	}
}

func TestPutFailsOnAnErrorStatus(t *testing.T) {
	err := bucketStore(t, &fakeBucket{status: 500}).PutObject(context.Background(), collabKey, []byte{1})
	if err == nil || !strings.Contains(err.Error(), "returned 500") {
		t.Fatalf("got %v, want a 500 error", err)
	}
}

func TestDeletesAnObjectByItsKey(t *testing.T) {
	bucket := &fakeBucket{objects: map[string][]byte{objectPath: {1}}}
	if err := bucketStore(t, bucket).DeleteObject(context.Background(), collabKey); err != nil {
		t.Fatal(err)
	}
	r := bucket.requests[0]
	if _, ok := bucket.objects[objectPath]; ok || r.Method != http.MethodDelete || r.URL.Path != objectPath || r.Header.Get("Authorization") == "" {
		t.Fatalf("request %s %s", r.Method, r.URL.Path)
	}
}

func TestRefusesAnEmptyKey(t *testing.T) {
	bucket := &fakeBucket{}
	s := bucketStore(t, bucket)
	ctx := context.Background()
	if _, err := s.GetObject(ctx, ""); err == nil {
		t.Error("GetObject took an empty key")
	}
	if err := s.PutObject(ctx, "", []byte{1}); err == nil {
		t.Error("PutObject took an empty key")
	}
	if err := s.DeleteObject(ctx, ""); err == nil {
		t.Error("DeleteObject took an empty key")
	}
	if len(bucket.requests) != 0 {
		t.Fatalf("sent %d requests", len(bucket.requests))
	}
}

// S3BlobStore.cs:216-227: Content-Disposition (unsigned), the sanitized type
// and a known length on every upload PUT.
func TestPutsAnUploadAsAnAttachmentWithAKnownLength(t *testing.T) {
	bucket := &fakeBucket{}
	s := bucketStore(t, bucket)
	url, err := s.Put(context.Background(), ".png", "image/png", strings.NewReader("bytes"))
	if err != nil {
		t.Fatal(err)
	}
	r := bucket.requests[0]
	if r.Header.Get("Content-Disposition") != "attachment" || r.Header.Get("Content-Type") != "image/png" || r.ContentLength != 5 ||
		strings.Contains(r.Header.Get("Authorization"), "content-disposition") {
		t.Fatalf("request %d %v", r.ContentLength, r.Header)
	}
	if !strings.HasPrefix(url, "https://cdn.example.com/media/") || !strings.HasSuffix(url, ".png") {
		t.Fatalf("url %s", url)
	}
}

// BoundsANonSeekableSpool: the spool cap is MaxSpoolBytes, and over it nothing is sent.
func TestBoundsTheSpool(t *testing.T) {
	bucket := &fakeBucket{}
	s := bucketStore(t, bucket)
	s.TempDir = t.TempDir()
	_, err := s.Put(context.Background(), ".bin", "", io.LimitReader(neverEnding{}, s.MaxSpoolBytes+1))
	if err == nil || len(bucket.requests) != 0 {
		t.Fatalf("got %v after %d requests", err, len(bucket.requests))
	}
	if left, _ := os.ReadDir(s.TempDir); len(left) != 0 {
		t.Fatalf("%d spool files left", len(left))
	}
}

type neverEnding struct{}

func (neverEnding) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 'x'
	}
	return len(p), nil
}

// DropsAnInvalidMediaTypeBeforeSigning, SanitizesDuplicateMediaParametersLikeGo,
// plus the S3-only ASCII rule (S3BlobStore.cs:332-415).
func TestSanitizesTheMediaTypeBeforeSigning(t *testing.T) {
	for _, c := range []struct {
		mediaType string
		kept      bool
	}{
		{"definitely not a media type", false},
		{"text/plain; charset=utf-8; charset=us-ascii", false},
		{"text/plain; charset=utf-8; charset=utf-8", true},
		{`text/plain; charset="a\z"; charset=az`, false},
		{`text/plain; charset="a\/b"; charset="a/b"`, true},
		{`text/plain; charset="a\z"; charset="a\z"`, true},
		{"text/plain; name=\"café\"", false},
	} {
		bucket := &fakeBucket{}
		if _, err := bucketStore(t, bucket).Put(context.Background(), ".txt", c.mediaType, strings.NewReader("bytes")); err != nil {
			t.Fatal(err)
		}
		r := bucket.requests[0]
		signed := strings.Contains(r.Header.Get("Authorization"), "content-type")
		if c.kept != (r.Header.Get("Content-Type") == c.mediaType) || c.kept != signed || r.Header.Get("Content-Disposition") != "attachment" {
			t.Errorf("%q: Content-Type %q, signed %v", c.mediaType, r.Header.Get("Content-Type"), signed)
		}
	}
}

package blobstore_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/JackUait/blok/packages/server/internal/blobstore"
)

func TestS3PutsWithASignedRequestAndReturnsThePublicURL(t *testing.T) {
	var (
		gotMethod string
		gotPath   string
		gotAuth   string
		gotBody   string
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		gotMethod, gotPath, gotAuth, gotBody = r.Method, r.URL.Path, r.Header.Get("Authorization"), string(body)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	store := blobstore.NewS3(blobstore.S3Config{
		Endpoint: srv.URL, Region: "us-east-1", Bucket: "media",
		AccessKey: "AKIA", SecretKey: "secret", PublicURL: "https://cdn.example.com",
	})

	url, err := store.Put(context.Background(), "photo.png", "image/png", strings.NewReader("bytes"))
	if err != nil {
		t.Fatalf("put: %v", err)
	}

	if gotMethod != http.MethodPut {
		t.Fatalf("method = %s, want PUT", gotMethod)
	}
	if !strings.HasPrefix(gotPath, "/media/") {
		t.Fatalf("path = %q, want it under the bucket", gotPath)
	}
	if !strings.HasPrefix(gotAuth, "AWS4-HMAC-SHA256 Credential=AKIA/") {
		t.Fatalf("authorization = %q", gotAuth)
	}
	if gotBody != "bytes" {
		t.Fatalf("body = %q", gotBody)
	}
	if !strings.HasPrefix(url, "https://cdn.example.com/") {
		t.Fatalf("url = %q", url)
	}
}

func TestS3ReportsAFailedPut(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()

	store := blobstore.NewS3(blobstore.S3Config{
		Endpoint: srv.URL, Region: "us-east-1", Bucket: "media",
		AccessKey: "AKIA", SecretKey: "secret", PublicURL: "https://cdn.example.com",
	})

	if _, err := store.Put(context.Background(), "photo.png", "image/png", strings.NewReader("b")); err == nil {
		t.Fatal("err = nil, want a failure")
	}
}

// capturedRequest is everything the endpoint actually received. The signature
// oracle below rebuilds the canonical request from these fields and nothing
// else, so a value that was signed but not sent — or sent but not signed —
// fails the check.
type capturedRequest struct {
	method           string
	escapedPath      string
	rawQuery         string
	host             string
	header           http.Header
	body             []byte
	contentLength    int64
	transferEncoding []string
}

type recorder struct {
	mu   sync.Mutex
	last capturedRequest
	seen int
}

func (rec *recorder) record(r *http.Request, body []byte) {
	rec.mu.Lock()
	defer rec.mu.Unlock()
	rec.seen++
	rec.last = capturedRequest{
		method:           r.Method,
		escapedPath:      r.URL.EscapedPath(),
		rawQuery:         r.URL.RawQuery,
		host:             r.Host,
		header:           r.Header.Clone(),
		body:             body,
		contentLength:    r.ContentLength,
		transferEncoding: r.TransferEncoding,
	}
}

func (rec *recorder) snapshot() (capturedRequest, int) {
	rec.mu.Lock()
	defer rec.mu.Unlock()

	return rec.last, rec.seen
}

func newRecordingEndpoint(t *testing.T, status int) (string, *recorder) {
	t.Helper()

	rec := &recorder{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		rec.record(r, body)
		w.WriteHeader(status)
	}))
	t.Cleanup(srv.Close)

	return srv.URL, rec
}

// verifySignature recomputes SigV4 the way an endpoint does: from the request
// as received. It is the only check here that can catch a signed value that
// never reached the wire — Request.Header["Host"], for one, is discarded by
// net/http.
func verifySignature(t *testing.T, got capturedRequest, secret string) {
	t.Helper()

	auth := got.header.Get("Authorization")
	scheme, rest, ok := strings.Cut(auth, " ")
	if !ok || scheme != "AWS4-HMAC-SHA256" {
		t.Fatalf("authorization = %q", auth)
	}

	fields := map[string]string{}
	for _, part := range strings.Split(rest, ",") {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			t.Fatalf("authorization part %q", part)
		}
		fields[k] = v
	}

	credential := strings.SplitN(fields["Credential"], "/", 2)
	if len(credential) != 2 {
		t.Fatalf("credential = %q", fields["Credential"])
	}
	scope := credential[1]
	scopeParts := strings.Split(scope, "/")
	if len(scopeParts) != 4 || scopeParts[3] != "aws4_request" || scopeParts[2] != "s3" {
		t.Fatalf("scope = %q", scope)
	}

	sum := sha256.Sum256(got.body)
	payloadHash := hex.EncodeToString(sum[:])
	if declared := got.header.Get("X-Amz-Content-Sha256"); declared != payloadHash {
		t.Fatalf("x-amz-content-sha256 = %q, but the body hashes to %q", declared, payloadHash)
	}

	signedHeaders := fields["SignedHeaders"]
	var canonicalHeaders strings.Builder
	for _, name := range strings.Split(signedHeaders, ";") {
		value := got.header.Get(name)
		if name == "host" {
			value = got.host
		}
		if value == "" {
			t.Fatalf("signed header %q was not sent", name)
		}
		canonicalHeaders.WriteString(name + ":" + strings.Join(strings.Fields(value), " ") + "\n")
	}

	canonicalRequest := strings.Join([]string{
		got.method,
		got.escapedPath,
		got.rawQuery,
		canonicalHeaders.String(),
		signedHeaders,
		payloadHash,
	}, "\n")

	canonicalSum := sha256.Sum256([]byte(canonicalRequest))
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		got.header.Get("X-Amz-Date"),
		scope,
		hex.EncodeToString(canonicalSum[:]),
	}, "\n")

	mac := func(key, data []byte) []byte {
		h := hmac.New(sha256.New, key)
		h.Write(data)

		return h.Sum(nil)
	}
	key := mac(mac(mac(mac([]byte("AWS4"+secret), []byte(scopeParts[0])), []byte(scopeParts[1])), []byte("s3")), []byte("aws4_request"))
	want := hex.EncodeToString(mac(key, []byte(stringToSign)))

	if fields["Signature"] != want {
		t.Fatalf("signature = %q, but the request as received signs to %q\ncanonical request:\n%s", fields["Signature"], want, canonicalRequest)
	}
}

func newTestS3(t *testing.T, endpoint string, style string) *blobstore.S3 {
	t.Helper()

	return blobstore.NewS3(blobstore.S3Config{
		Endpoint:        endpoint,
		Region:          "eu-central-1",
		Bucket:          "media",
		AccessKey:       "AKIAEXAMPLE",
		SecretKey:       "wJalrXUtnFEMI/K7MDENG",
		PublicURL:       "https://cdn.example.com/media",
		AddressingStyle: style,
	})
}

func TestS3SignsTheRequestItActuallySends(t *testing.T) {
	endpoint, rec := newRecordingEndpoint(t, http.StatusOK)
	store := newTestS3(t, endpoint, "")

	if _, err := store.Put(context.Background(), "photo.png", "image/png", strings.NewReader("bytes")); err != nil {
		t.Fatalf("put: %v", err)
	}

	got, _ := rec.snapshot()
	verifySignature(t, got, "wJalrXUtnFEMI/K7MDENG")

	if !strings.Contains(got.header.Get("Authorization"), "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date") {
		t.Fatalf("authorization = %q, want content-type signed and the set in sorted order", got.header.Get("Authorization"))
	}
	if got.header.Get("Content-Type") != "image/png" {
		t.Fatalf("content-type = %q", got.header.Get("Content-Type"))
	}
}

// S3 answers a chunked PUT with 501 unless it also carries streaming-signature
// headers, and Go falls back to chunked for any body whose length it cannot
// infer.
func TestS3SendsAKnownContentLength(t *testing.T) {
	cases := map[string]func() io.Reader{
		"a seekable body":     func() io.Reader { return strings.NewReader("bytes") },
		"a non-seekable body": func() io.Reader { return struct{ io.Reader }{strings.NewReader("bytes")} },
	}

	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			endpoint, rec := newRecordingEndpoint(t, http.StatusOK)
			store := newTestS3(t, endpoint, "")

			if _, err := store.Put(context.Background(), "photo.png", "image/png", body()); err != nil {
				t.Fatalf("put: %v", err)
			}

			got, _ := rec.snapshot()
			if got.contentLength != 5 {
				t.Fatalf("content-length = %d, want 5", got.contentLength)
			}
			if len(got.transferEncoding) != 0 {
				t.Fatalf("transfer-encoding = %v, want none", got.transferEncoding)
			}
			if string(got.body) != "bytes" {
				t.Fatalf("body = %q", got.body)
			}
			verifySignature(t, got, "wJalrXUtnFEMI/K7MDENG")
		})
	}
}

// A seekable body — which is what multipart.File always is — is hashed where
// it lies; only a body that cannot be rewound is spooled to disk. Neither path
// holds the upload in memory, and the spool never outlives the request.
func TestS3SpoolsOnlyABodyItCannotRewind(t *testing.T) {
	cases := map[string]struct {
		body      func(string) io.Reader
		wantSpool int
	}{
		"a seekable body":     {func(s string) io.Reader { return strings.NewReader(s) }, 0},
		"a non-seekable body": {func(s string) io.Reader { return struct{ io.Reader }{strings.NewReader(s)} }, 1},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			tmp := t.TempDir()
			t.Setenv("TMPDIR", tmp)

			// Counted while the request is in flight: the spool is removed as
			// soon as Put returns, so afterwards both paths look identical.
			spooledDuringRequest := -1
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				entries, _ := os.ReadDir(tmp)
				spooledDuringRequest = len(entries)
				_, _ = io.Copy(io.Discard, r.Body)
				w.WriteHeader(http.StatusOK)
			}))
			defer srv.Close()

			store := newTestS3(t, srv.URL, "")

			if _, err := store.Put(context.Background(), "photo.png", "image/png", tc.body(strings.Repeat("x", 1<<20))); err != nil {
				t.Fatalf("put: %v", err)
			}

			if spooledDuringRequest != tc.wantSpool {
				t.Fatalf("%d spool files during the request, want %d", spooledDuringRequest, tc.wantSpool)
			}

			entries, err := os.ReadDir(tmp)
			if err != nil {
				t.Fatalf("read temp dir: %v", err)
			}
			if len(entries) != 0 {
				t.Fatalf("%d spool files left behind: %v", len(entries), entries)
			}
		})
	}
}

// The MIME type arrives from the browser next to the filename and is just as
// untrusted. A value that is not a media type is dropped rather than signed.
func TestS3DropsAMimeTypeThatIsNotAMediaType(t *testing.T) {
	cases := map[string]string{
		"free text":     "definitely not a media type",
		"empty":         "",
		"only spaces":   "   ",
		"non-ascii":     "image/pnég",
		"absurdly long": "image/" + strings.Repeat("a", 4096),
	}

	for name, mimeType := range cases {
		t.Run(name, func(t *testing.T) {
			endpoint, rec := newRecordingEndpoint(t, http.StatusOK)
			store := newTestS3(t, endpoint, "")

			if _, err := store.Put(context.Background(), "photo.png", mimeType, strings.NewReader("bytes")); err != nil {
				t.Fatalf("put: %v", err)
			}

			got, _ := rec.snapshot()
			if got.header.Get("Content-Type") != "" {
				t.Fatalf("content-type = %q, want it dropped", got.header.Get("Content-Type"))
			}
			if strings.Contains(got.header.Get("Authorization"), "content-type") {
				t.Fatalf("authorization = %q, want content-type unsigned when it is not sent", got.header.Get("Authorization"))
			}
			verifySignature(t, got, "wJalrXUtnFEMI/K7MDENG")
		})
	}
}

func TestS3KeepsAMediaTypeWithParameters(t *testing.T) {
	endpoint, rec := newRecordingEndpoint(t, http.StatusOK)
	store := newTestS3(t, endpoint, "")

	if _, err := store.Put(context.Background(), "notes.txt", "text/plain; charset=utf-8", strings.NewReader("bytes")); err != nil {
		t.Fatalf("put: %v", err)
	}

	got, _ := rec.snapshot()
	if got.header.Get("Content-Type") != "text/plain; charset=utf-8" {
		t.Fatalf("content-type = %q", got.header.Get("Content-Type"))
	}
	verifySignature(t, got, "wJalrXUtnFEMI/K7MDENG")
}

func TestS3DeletesTheKeyBehindThePublicURL(t *testing.T) {
	for _, suffix := range []string{"", "?v=2", "#anchor"} {
		t.Run("suffix "+suffix, func(t *testing.T) {
			endpoint, rec := newRecordingEndpoint(t, http.StatusNoContent)
			store := newTestS3(t, endpoint, "")

			url, err := store.Put(context.Background(), "photo.png", "image/png", strings.NewReader("bytes"))
			if err != nil {
				t.Fatalf("put: %v", err)
			}
			put, _ := rec.snapshot()

			if err := store.Delete(context.Background(), url+suffix); err != nil {
				t.Fatalf("delete: %v", err)
			}

			got, _ := rec.snapshot()
			if got.method != http.MethodDelete {
				t.Fatalf("method = %s", got.method)
			}
			if got.escapedPath != put.escapedPath {
				t.Fatalf("deleted %q, but put wrote %q", got.escapedPath, put.escapedPath)
			}
			if len(got.body) != 0 {
				t.Fatalf("delete body = %q, want empty", got.body)
			}
			verifySignature(t, got, "wJalrXUtnFEMI/K7MDENG")
		})
	}
}

func TestS3DeleteRefusesAURLItDidNotProduce(t *testing.T) {
	cases := map[string]string{
		"another host":   "https://evil.example.com/media/0123456789abcdef0123456789abcdef.png",
		"another prefix": "https://cdn.example.com/other/0123456789abcdef0123456789abcdef.png",
		"a traversal":    "https://cdn.example.com/media/../../secrets",
		"a nested key":   "https://cdn.example.com/media/sub/0123456789abcdef0123456789abcdef.png",
		"a foreign key":  "https://cdn.example.com/media/production-backup.sql",
	}

	for name, url := range cases {
		t.Run(name, func(t *testing.T) {
			endpoint, rec := newRecordingEndpoint(t, http.StatusNoContent)
			store := newTestS3(t, endpoint, "")

			err := store.Delete(context.Background(), url)
			if !errors.Is(err, blobstore.ErrForeignURL) {
				t.Fatalf("err = %v, want ErrForeignURL", err)
			}
			if _, seen := rec.snapshot(); seen != 0 {
				t.Fatalf("sent %d requests, want none", seen)
			}
		})
	}
}

func TestS3ReportsAFailedDelete(t *testing.T) {
	endpoint, _ := newRecordingEndpoint(t, http.StatusForbidden)
	store := newTestS3(t, endpoint, "")

	if _, err := store.Put(context.Background(), "photo.png", "image/png", strings.NewReader("bytes")); err == nil {
		t.Fatalf("put: err = nil, want a failure on 403")
	}

	err := store.Delete(context.Background(), "https://cdn.example.com/media/0123456789abcdef0123456789abcdef.png")
	if err == nil {
		t.Fatal("err = nil, want a failure")
	}
}

// A bare status code is not debuggable: S3 explains a refusal in the body.
func TestS3ErrorCarriesTheEndpointsExplanation(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte("<Error><Code>SignatureDoesNotMatch</Code></Error>"))
	}))
	defer srv.Close()

	store := newTestS3(t, srv.URL, "")

	_, err := store.Put(context.Background(), "photo.png", "image/png", strings.NewReader("bytes"))
	if err == nil {
		t.Fatal("err = nil, want a failure")
	}
	if !strings.Contains(err.Error(), "SignatureDoesNotMatch") {
		t.Fatalf("err = %v, want the endpoint's reason in it", err)
	}
}

func TestS3RefusesAContextThatIsAlreadyDone(t *testing.T) {
	endpoint, rec := newRecordingEndpoint(t, http.StatusOK)
	store := newTestS3(t, endpoint, "")

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := store.Put(ctx, "photo.png", "image/png", strings.NewReader("bytes")); err == nil {
		t.Fatal("err = nil, want the cancelled context")
	}
	if _, seen := rec.snapshot(); seen != 0 {
		t.Fatalf("sent %d requests on a cancelled context", seen)
	}
}

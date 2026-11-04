package blokserver

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// Measured on the C# host: a body under Kestrel's minimum data rate on
// /upload gets 400 "malformed upload" (UploadEndpoint catches it as an
// IOException). In Go the host's read deadline has cancelled the context by
// then, and the answer must still go out.
func TestUploadAnswersASlowBodyAfterTheHostCancelled(t *testing.T) {
	o := DefaultOptions()
	o.StorageDirectory = t.TempDir()
	o.PublicURL = "/files"
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	body := io.MultiReader(strings.NewReader("--"+testBoundary+"\r\n"), &failingReader{err: ErrRequestBodyTooSlow, before: cancel})
	request := httptest.NewRequestWithContext(ctx, "POST", "/upload", body)
	request.Header.Set("Content-Type", "multipart/form-data; boundary="+testBoundary)
	recorder := httptest.NewRecorder()
	s.Handler("").ServeHTTP(recorder, request)
	if recorder.Code != 400 || recorder.Body.String() != "malformed upload\n" {
		t.Fatalf("%d %q", recorder.Code, recorder.Body.String())
	}
}

type failingReader struct {
	err    error
	before func()
}

func (f *failingReader) Read([]byte) (int, error) {
	f.before()
	return 0, f.err
}

const testBoundary = "blok-server-conformance-boundary"

func multipartBody(fileName, content string) string {
	return "--" + testBoundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + fileName +
		"\"\r\nContent-Type: application/octet-stream\r\n\r\n" + content + "\r\n--" + testBoundary + "--\r\n"
}

func uploadServer(t *testing.T, maxUpload int64) *httptest.Server {
	t.Helper()
	o := DefaultOptions()
	o.StorageDirectory = t.TempDir()
	o.PublicURL = "/files"
	o.MaxUploadBytes = maxUpload
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(s.Handler(""))
	t.Cleanup(server.Close)
	return server
}

// The cap counts the whole body, framing included, even when it arrives
// chunked with no Content-Length.
func TestUploadCapCountsTheWholeChunkedBody(t *testing.T) {
	body := multipartBody("small.txt", "small file")
	server := uploadServer(t, int64(len(body)-1))
	request, _ := http.NewRequest("POST", server.URL+"/upload", io.MultiReader(strings.NewReader(body)))
	request.ContentLength = -1
	request.Header.Set("Content-Type", "multipart/form-data; boundary="+testBoundary)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	text, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 413 || string(text) != "file too large\n" {
		t.Fatalf("%d %q (body %s bytes)", response.StatusCode, text, strconv.Itoa(len(body)))
	}
}

// UploadEndpoint.cs sets IHttpMaxRequestBodySizeFeature to MaxUploadBytes
// before it reads, so Kestrel's 30,000,000-byte cap does not apply to it.
func TestUploadRaisesTheHostsBodyCapBeforeItReads(t *testing.T) {
	o := DefaultOptions()
	o.StorageDirectory = t.TempDir()
	o.PublicURL = "/files"
	o.MaxUploadBytes = 40_000_000
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	var raised int64
	body := &firstRead{Reader: strings.NewReader(multipartBody("a.txt", "one")), onFirst: func() {
		if raised == 0 {
			t.Error("the body was read before the cap was raised")
		}
	}}
	request := httptest.NewRequest("POST", "/upload", body)
	request.Header.Set("Content-Type", "multipart/form-data; boundary="+testBoundary)
	request = request.WithContext(WithRequestBodyLimit(request.Context(), func(n int64) { raised = n }))
	recorder := httptest.NewRecorder()
	s.Handler("").ServeHTTP(recorder, request)
	if recorder.Code != 200 || raised != 40_000_000 {
		t.Fatalf("%d %q, cap raised to %d", recorder.Code, recorder.Body.String(), raised)
	}
}

type firstRead struct {
	io.Reader
	onFirst func()
	read    bool
}

func (f *firstRead) Read(p []byte) (int, error) {
	if !f.read {
		f.read = true
		f.onFirst()
	}
	return f.Reader.Read(p)
}

// UploadEndpoint.cs hands S3 a CountingReadStream that keeps CanSeek, so
// PreparedPayload hashes the upload's own temp file in place: one spool,
// not two. The size it reports is the furthest position read.
func TestAnUploadToS3HashesItsSpoolInPlaceAndReportsTheFileSize(t *testing.T) {
	t.Setenv("TMPDIR", t.TempDir())
	content := strings.Repeat("blok", 5000)
	var spooled []string
	var put []byte
	bucket := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		spooled, _ = filepath.Glob(filepath.Join(os.TempDir(), "blok-s3-*"))
		put, _ = io.ReadAll(r.Body)
	}))
	defer bucket.Close()
	o := DefaultOptions()
	o.S3Endpoint = bucket.URL
	o.S3Region = "us-east-1"
	o.S3Bucket = "media"
	o.S3AccessKey = "a"
	o.S3SecretKey = "b"
	o.S3BucketURL = "https://cdn.example.com"
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/upload", strings.NewReader(multipartBody("a.txt", content)))
	request.Header.Set("Content-Type", "multipart/form-data; boundary="+testBoundary)
	recorder := httptest.NewRecorder()
	s.Handler("").ServeHTTP(recorder, request)
	if recorder.Code != 200 || !strings.Contains(recorder.Body.String(), `"size":20000,`) {
		t.Fatalf("%d %s", recorder.Code, recorder.Body.String())
	}
	if string(put) != content || len(spooled) != 0 {
		t.Fatalf("put %d bytes, S3 spools %v", len(put), spooled)
	}
}

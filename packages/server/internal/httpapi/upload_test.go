package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/internal/config"
	"github.com/JackUait/blok/packages/server/internal/httpapi"
)

type stubStore struct {
	lastName, lastMime string
	consumed           int64
	puts, deletes      int
	err                error
}

func (s *stubStore) Put(_ context.Context, name, mime string, r io.Reader) (string, error) {
	s.lastName, s.lastMime = name, mime
	s.puts++
	n, _ := io.Copy(io.Discard, r)
	s.consumed = n

	if s.err != nil {
		return "", s.err
	}

	return "https://cdn.example.com/files/abc.png", nil
}

func (s *stubStore) Delete(context.Context, string) error {
	s.deletes++

	return nil
}

// failingWriter answers every Write with an error, which is what a client that
// hung up mid-response looks like to a handler.
type failingWriter struct {
	header http.Header
	code   int
}

func (f *failingWriter) Header() http.Header {
	if f.header == nil {
		f.header = http.Header{}
	}

	return f.header
}

func (f *failingWriter) Write([]byte) (int, error)  { return 0, io.ErrClosedPipe }
func (f *failingWriter) WriteHeader(statusCode int) { f.code = statusCode }

func multipartUpload(t *testing.T, filename string, size int) *http.Request {
	t.Helper()

	body := &bytes.Buffer{}
	mw := multipart.NewWriter(body)
	part, err := mw.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("create part: %v", err)
	}
	if _, err := part.Write(bytes.Repeat([]byte("x"), size)); err != nil {
		t.Fatalf("write part: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/upload", body)
	req.Header.Set("Content-Type", mw.FormDataContentType())

	return req
}

// The response shape is fixed by src/tools/file/uploader.ts parseResponse.
func TestUploadReturnsTheShapeTheClientParses(t *testing.T) {
	store := &stubStore{}
	h := httpapi.New(httpapi.Options{Auth: config.AuthProxy, Store: store, MaxUploadBytes: 1 << 20})

	body := &bytes.Buffer{}
	mw := multipart.NewWriter(body)
	part, _ := mw.CreateFormFile("file", "photo.png")
	_, _ = part.Write([]byte("bytes"))
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/upload", body)
	req.Header.Set("Content-Type", mw.FormDataContentType())

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var got struct {
		URL      string `json:"url"`
		FileName string `json:"fileName"`
		Size     int64  `json:"size"`
		MimeType string `json:"mimeType"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.URL != "https://cdn.example.com/files/abc.png" {
		t.Fatalf("url = %q", got.URL)
	}
	if got.FileName != "photo.png" || got.Size != 5 {
		t.Fatalf("got = %+v", got)
	}
	if store.lastName != "photo.png" {
		t.Fatalf("store received name %q", store.lastName)
	}
	// parseResponse rejects anything that is not JSON with a string `url`.
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("content-type = %q", ct)
	}
}

func TestUploadRejectsABodyOverTheCap(t *testing.T) {
	h := httpapi.New(httpapi.Options{Auth: config.AuthProxy, Store: &stubStore{}, MaxUploadBytes: 8})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, multipartUpload(t, "big.bin", 1024))

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", rec.Code)
	}
}

// A body cut off by MaxBytesReader never reaches the store: the multipart
// reader fails first, so a truncated blob cannot be written and then reported
// as a whole file.
func TestUploadOverTheCapNeverReachesTheStore(t *testing.T) {
	store := &stubStore{}
	h := httpapi.New(httpapi.Options{Auth: config.AuthProxy, Store: store, MaxUploadBytes: 8})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, multipartUpload(t, "big.bin", 1024))

	if store.puts != 0 {
		t.Fatalf("store.puts = %d, want 0 — a truncated body was stored", store.puts)
	}
}

// A cap of zero is a MISSING cap, not an unlimited one. It has to refuse:
// treating it as "no limit" turns a forgotten flag into an unbounded body.
func TestUploadRefusesEveryUploadWhenNoCapIsConfigured(t *testing.T) {
	store := &stubStore{}
	h := httpapi.New(httpapi.Options{Auth: config.AuthProxy, Store: store})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, multipartUpload(t, "photo.png", 5))

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", rec.Code)
	}
	if store.puts != 0 {
		t.Fatalf("store.puts = %d, want 0", store.puts)
	}
	// The refusal has to name its cause: with a bare "file too large" an
	// operator debugs the file, not the flag.
	if !strings.Contains(rec.Body.String(), "limit") {
		t.Fatalf("body = %q, want it to name the missing limit", rec.Body.String())
	}
}

// An unwired route would nil-panic the connection on the first request. 404 is
// what "this deployment does not do uploads" looks like, exactly as an
// unregistered /unfurl answers 404 rather than refusing in the handler.
func TestUploadIsNotRegisteredWithoutAStore(t *testing.T) {
	h := httpapi.New(httpapi.Options{Auth: config.AuthProxy, MaxUploadBytes: 1 << 20})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, multipartUpload(t, "photo.png", 5))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

// Every gated route ships with its CORS preflight. Without it the browser's
// OPTIONS matches the path but not the method, ServeMux answers 405, and the
// upload is never sent at all.
func TestUploadAnswersThePreflight(t *testing.T) {
	h := httpapi.New(httpapi.Options{
		Auth:           config.AuthProxy,
		Store:          &stubStore{},
		MaxUploadBytes: 1 << 20,
		AllowedOrigins: []string{"https://app.example.com"},
	})

	for _, route := range []string{"/upload", "/upload-by-url"} {
		req := httptest.NewRequest(http.MethodOptions, route, nil)
		req.Header.Set("Origin", "https://app.example.com")

		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)

		if route == "/upload-by-url" {
			// No fetcher is configured, so the route is not registered at all.
			if rec.Code != http.StatusNotFound {
				t.Fatalf("%s preflight = %d, want 404 without a fetcher", route, rec.Code)
			}

			continue
		}
		if rec.Code != http.StatusNoContent {
			t.Fatalf("%s preflight = %d, want 204", route, rec.Code)
		}
		if got := rec.Header().Get("Access-Control-Allow-Methods"); got != "POST, OPTIONS" {
			t.Fatalf("%s allow-methods = %q", route, got)
		}
	}
}

// ParseMultipartForm spills everything past its memory threshold into
// os.TempDir. Nothing deletes those files unless RemoveAll runs.
func TestUploadRemovesTheMultipartSpillFromTheTempDir(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("TMPDIR", tmp)

	store := &stubStore{}
	h := httpapi.New(httpapi.Options{Auth: config.AuthProxy, Store: store, MaxUploadBytes: 32 << 20})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, multipartUpload(t, "big.bin", 9<<20))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	entries, err := os.ReadDir(tmp)
	if err != nil {
		t.Fatalf("read temp dir: %v", err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "multipart-") {
			t.Fatalf("%s was left behind in the temp dir", e.Name())
		}
	}
}

// The reported size must describe what the store consumed, not what the
// browser claimed: it is the number the consumer saves next to the URL.
func TestUploadReportsTheSizeTheStoreConsumed(t *testing.T) {
	store := &stubStore{}
	h := httpapi.New(httpapi.Options{Auth: config.AuthProxy, Store: store, MaxUploadBytes: 1 << 20})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, multipartUpload(t, "photo.png", 4096))

	var got struct {
		Size int64 `json:"size"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Size != store.consumed {
		t.Fatalf("reported size %d, store consumed %d", got.Size, store.consumed)
	}
	if got.Size != 4096 {
		t.Fatalf("size = %d, want 4096", got.Size)
	}
}

// A store that refuses is a bad gateway, not a bad request: nothing about the
// caller's upload was wrong.
func TestUploadReportsAStoreFailureAsABadGateway(t *testing.T) {
	h := httpapi.New(httpapi.Options{
		Auth:           config.AuthProxy,
		Store:          &stubStore{err: io.ErrUnexpectedEOF},
		MaxUploadBytes: 1 << 20,
	})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, multipartUpload(t, "photo.png", 5))

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", rec.Code)
	}
}

// Pins the orphan window rather than closing it: the blob is stored before the
// response is written, so a client that hung up leaves bytes nobody holds a URL
// for. Nothing compensates — a delete here would race a client that did receive
// the body, and the consumer's own records are what decide a blob's life.
func TestUploadLeavesTheBlobWhenTheResponseCannotBeWritten(t *testing.T) {
	store := &stubStore{}
	h := httpapi.New(httpapi.Options{Auth: config.AuthProxy, Store: store, MaxUploadBytes: 1 << 20})

	h.ServeHTTP(&failingWriter{}, multipartUpload(t, "photo.png", 5))

	if store.puts != 1 {
		t.Fatalf("store.puts = %d, want 1", store.puts)
	}
	if store.deletes != 0 {
		t.Fatalf("store.deletes = %d, want 0 — the orphan is deliberate", store.deletes)
	}
}

// The filename comes from the browser's machine, not this one, so it may carry
// a path in either separator. What the consumer saves must be a name.
func TestUploadReportsOnlyTheLastSegmentOfTheFilename(t *testing.T) {
	for _, tc := range []struct{ sent, want string }{
		{`C:\Users\me\photo.png`, "photo.png"},
		{"../../etc/passwd", "passwd"},
		{"/tmp/photo.png", "photo.png"},
	} {
		store := &stubStore{}
		h := httpapi.New(httpapi.Options{Auth: config.AuthProxy, Store: store, MaxUploadBytes: 1 << 20})

		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, multipartUpload(t, tc.sent, 5))

		var got struct {
			FileName string `json:"fileName"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if got.FileName != tc.want {
			t.Fatalf("sent %q, reported %q, want %q", tc.sent, got.FileName, tc.want)
		}
		if store.lastName != tc.want {
			t.Fatalf("sent %q, store received %q", tc.sent, store.lastName)
		}
	}
}

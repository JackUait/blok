package blokserver

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type tallyReader struct {
	r    io.Reader
	read int
}

func (c *tallyReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.read += n
	return n, err
}

// The C# routes read at most 8 KiB + 1 into a fixed buffer
// (DeleteEndpoint.cs:36, UploadByUrlEndpoint.cs:38), so an oversized body
// is refused without being read whole.
func TestEnvelopeReadStopsAfterTheBound(t *testing.T) {
	o := DefaultOptions()
	o.StorageDirectory = t.TempDir()
	o.PublicURL = "https://uploads.example.com/files/"
	o.UnfurlEnabled = true
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	h := s.Handler("")
	for _, path := range []string{"/delete", "/upload-by-url"} {
		body := &tallyReader{r: strings.NewReader(`{"url":"` + strings.Repeat("a", 1<<20) + `"}`)}
		request := httptest.NewRequest(http.MethodPost, path, body)
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		h.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", path, recorder.Code)
		}
		if body.read > maxEnvelopeBytes+1 {
			t.Errorf("%s: read %d bytes, want at most %d", path, body.read, maxEnvelopeBytes+1)
		}
	}
}

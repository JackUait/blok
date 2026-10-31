package blokserver

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func serve(t *testing.T, h http.Handler, method, path string, body io.Reader, contentType string) (int, string) {
	t.Helper()
	request := httptest.NewRequest(method, path, body)
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	recorder := httptest.NewRecorder()
	h.ServeHTTP(recorder, request)
	return recorder.Code, recorder.Body.String()
}

// MapBlokServer(pattern) maps the routes in a group under pattern, with a
// "/{**path}" 404 inside it, and maps local files BEFORE the group, at the
// public URL path from the app root
// (BlokServerEndpointRouteBuilderExtensions.cs:72-74, 121).
func TestHandlerMountsUnderAPrefixAndServesFilesFromTheRoot(t *testing.T) {
	o := DefaultOptions()
	o.StorageDirectory = t.TempDir()
	o.PublicURL = "https://uploads.example.com/files/"
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	key := strings.Repeat("a", 32) + ".txt"
	if err := os.WriteFile(filepath.Join(o.StorageDirectory, key), []byte("stored"), 0o600); err != nil {
		t.Fatal(err)
	}
	h := s.Handler("/blok/")
	for _, c := range []struct {
		path   string
		status int
		body   string
	}{
		{"/blok/health", 200, ""},
		{"/health", 404, "404 page not found\n"},
		{"/blok/nothing-here", 404, "404 page not found\n"},
		{"/files/" + key, 200, "stored"},
		{"/blok/files/" + key, 404, "404 page not found\n"},
	} {
		status, body := serve(t, h, http.MethodGet, c.path, nil, "")
		if status != c.status || c.body != "" && body != c.body {
			t.Errorf("GET %s: got %d %q, want %d %q", c.path, status, body, c.status, c.body)
		}
	}
}

type denyAll struct{ asked int }

func (d *denyAll) CanReadDocument(context.Context, User, string) (bool, error) {
	d.asked++
	return false, nil
}

func (d *denyAll) CanWriteDocument(context.Context, User, string) (bool, error) {
	d.asked++
	return false, nil
}

// IBlokAuthorization.cs:20-54 narrows document access only; the upload,
// unfurl and delete routes never consult it.
func TestAuthorizationIsNotConsultedOffTheDocumentRoutes(t *testing.T) {
	deny := &denyAll{}
	o := DefaultOptions()
	o.StorageDirectory = t.TempDir()
	o.PublicURL = "https://uploads.example.com/files/"
	o.UnfurlEnabled = true
	o.Authorization = deny
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	h := s.Handler("")
	body := "--b\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.txt\"\r\n\r\nx\r\n--b--\r\n"
	if status, text := serve(t, h, http.MethodPost, "/upload", strings.NewReader(body), "multipart/form-data; boundary=b"); status != 200 {
		t.Fatalf("upload: %d %s", status, text)
	}
	missing := `{"url":"https://uploads.example.com/files/` + strings.Repeat("b", 32) + `.txt"}`
	if status, text := serve(t, h, http.MethodPost, "/delete", strings.NewReader(missing), "application/json"); status != 200 {
		t.Fatalf("delete: %d %s", status, text)
	}
	if status, _ := serve(t, h, http.MethodGet, "/unfurl", nil, ""); status != 400 {
		t.Fatalf("unfurl without a url: %d", status)
	}
	if deny.asked != 0 {
		t.Fatalf("the authorization was asked %d times", deny.asked)
	}
}

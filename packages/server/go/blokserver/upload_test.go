package blokserver

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

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

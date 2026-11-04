package blob

import (
	"bytes"
	"compress/gzip"
	"context"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
)

// Measured from C#'s S3BlobStore over a raw listener: no User-Agent, no
// Accept-Encoding, and a gzip-encoded GET body comes back as stored.
func TestSendsOnlyTheCSharpHeadersAndReadsRawBytes(t *testing.T) {
	var zipped bytes.Buffer
	writer := gzip.NewWriter(&zipped)
	writer.Write([]byte("hello"))
	writer.Close()
	headers := map[string][]string{}
	lengths := map[string][]string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var names []string
		for name := range r.Header {
			names = append(names, strings.ToLower(name))
		}
		sort.Strings(names)
		headers[r.Method] = names
		lengths[r.Method] = r.Header.Values("Content-Length")
		if r.Method == http.MethodGet {
			w.Header().Set("Content-Encoding", "gzip")
			w.Write(zipped.Bytes())
		}
	}))
	defer server.Close()
	s, err := NewS3(testS3(server.URL, "bucket", "path"))
	if err != nil {
		t.Fatal(err)
	}

	if err := s.PutObject(context.Background(), "p/k", []byte("x")); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetObject(context.Background(), "p/k")
	if err != nil {
		t.Fatal(err)
	}

	if err := s.DeleteObject(context.Background(), "p/k"); err != nil {
		t.Fatal(err)
	}

	if !bytes.Equal(got, zipped.Bytes()) {
		t.Errorf("GET body %q, want the stored gzip bytes", got)
	}
	// Go's server keeps Host apart from the header map. C# sends an
	// unsigned Content-Length on every request, 0 when there is no body.
	want := map[string]string{
		http.MethodPut:    "authorization content-disposition content-length content-type x-amz-content-sha256 x-amz-date",
		http.MethodGet:    "authorization content-length x-amz-content-sha256 x-amz-date",
		http.MethodDelete: "authorization content-length x-amz-content-sha256 x-amz-date",
	}
	for method, names := range want {
		if strings.Join(headers[method], " ") != names {
			t.Errorf("%s sent %v, want %s", method, headers[method], names)
		}
	}
	for method, length := range map[string]string{http.MethodPut: "1", http.MethodGet: "0", http.MethodDelete: "0"} {
		if strings.Join(lengths[method], ",") != length {
			t.Errorf("%s sent Content-Length %v, want %s", method, lengths[method], length)
		}
	}
}

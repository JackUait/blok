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
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var names []string
		for name := range r.Header {
			names = append(names, strings.ToLower(name))
		}
		sort.Strings(names)
		headers[r.Method] = names
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

	if !bytes.Equal(got, zipped.Bytes()) {
		t.Errorf("GET body %q, want the stored gzip bytes", got)
	}
	// Go's server keeps Host apart from the header map. C# also sends
	// an unsigned Content-Length: 0 on GET; net/http never writes one for
	// a bodyless GET.
	want := map[string]string{
		http.MethodPut: "authorization content-disposition content-length content-type x-amz-content-sha256 x-amz-date",
		http.MethodGet: "authorization x-amz-content-sha256 x-amz-date",
	}
	for method, names := range want {
		if strings.Join(headers[method], " ") != names {
			t.Errorf("%s sent %v, want %s", method, headers[method], names)
		}
	}
}

package blob

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// C# sends Content-Length: 0 for an empty PUT; a chunked PUT is refused by
// S3 and some gateways.
func TestAnEmptyPutSendsContentLengthZero(t *testing.T) {
	type seen struct {
		length   int64
		encoding []string
	}
	var got []seen
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = append(got, seen{r.ContentLength, r.TransferEncoding})
		if r.Header.Get("Content-Length") != "0" {
			t.Errorf("Content-Length header %q", r.Header.Get("Content-Length"))
		}
	}))
	defer server.Close()
	s, err := NewS3(testS3(server.URL, "bucket", "path"))
	if err != nil {
		t.Fatal(err)
	}
	s.TempDir = t.TempDir()

	if err := s.PutObject(context.Background(), "p/k", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Put(context.Background(), ".bin", "", strings.NewReader("")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Put(context.Background(), ".bin", "", onlyReader{strings.NewReader("")}); err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("%d requests", len(got))
	}
	for i, request := range got {
		if request.length != 0 || len(request.encoding) != 0 {
			t.Errorf("PUT %d: Content-Length %d, Transfer-Encoding %v", i, request.length, request.encoding)
		}
	}
}

package blob

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// .NET answers a proxy's 407 for an http S3 endpoint and sends the PUT
// body again (C#'s AuthenticatesAForwardedRequestAsSocketsHttpHandlerDoes,
// POST row). A seekable body and a spooled one both go out twice.
func TestAPutThroughAnAuthenticatingProxySendsTheBodyAgain(t *testing.T) {
	var bodies []string
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		bodies = append(bodies, r.Header.Get("Proxy-Authorization")+"|"+string(body))
		if r.Header.Get("Proxy-Authorization") == "" {
			w.Header().Set("Proxy-Authenticate", `Basic realm="r"`)
			w.WriteHeader(http.StatusProxyAuthRequired)
		}
	}))
	defer proxy.Close()
	s, err := NewS3(testS3("http://s3.example.test", "bucket", "path"))
	if err != nil {
		t.Fatal(err)
	}
	s.TempDir = t.TempDir()
	proxyURL, _ := url.Parse(proxy.URL)
	proxyURL.User = url.UserPassword("u", "p")
	s.transport.Transport.Proxy = http.ProxyURL(proxyURL)
	if _, err := s.Put(context.Background(), ".bin", "", strings.NewReader("seek")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Put(context.Background(), ".bin", "", onlyReader{strings.NewReader("spool")}); err != nil {
		t.Fatal(err)
	}
	want := "|seek,Basic dTpw|seek,|spool,Basic dTpw|spool"
	if got := strings.Join(bodies, ","); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

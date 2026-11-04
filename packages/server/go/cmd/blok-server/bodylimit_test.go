package main

import (
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/blokserver"
)

const kestrel413 = "HTTP/1.1 413 Payload Too Large\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"

// readThenAnswer reads up to five body bytes, then answers 200 with what the
// read returned.
var readThenAnswer = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	buffer := make([]byte, 5)
	n, err := io.ReadFull(r.Body, buffer)
	_, _ = io.WriteString(w, string(buffer[:n]))
	if err != nil {
		_, _ = io.WriteString(w, " "+err.Error())
	}
})

func startBodyHost(t *testing.T, handler http.Handler) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := newHTTPServer(handler, time.Minute)
	go func() { _ = server.Serve(headerListener{listener, time.Minute, time.Minute}) }()
	t.Cleanup(func() { _ = server.Close() })
	return listener.Addr().String()
}

func post(headers, body string) string {
	return "POST /p HTTP/1.1\r\nHost: x\r\n" + headers + "Connection: close\r\n\r\n" + body
}

// Kestrel's MaxRequestBodySize: 30,000,000 bytes, checked when the handler
// first reads. The handler's own answer after that is dropped.
func TestABodyOverKestrelsCapGets413(t *testing.T) {
	address := startBodyHost(t, readThenAnswer)
	cases := []struct{ name, request, want string }{
		{"Content-Length over the cap", post("Content-Length: 30000001\r\n", "hello"), kestrel413},
		{"over the cap with Expect", post("Expect: 100-continue\r\nContent-Length: 30000001\r\n", ""), kestrel413},
		{"Content-Length at the cap", post("Content-Length: 30000000\r\n", "hello"), "hello"},
	}
	for _, c := range cases {
		got := rawAnswer(t, address, c.request)
		if c.want != kestrel413 {
			_, got, _ = strings.Cut(got, "\r\n\r\n")
		}
		if got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

// Kestrel counts the bytes read too, for a body with no Content-Length.
func TestAChunkedBodyOverTheCapGets413(t *testing.T) {
	saved := maxRequestBodyBytes
	maxRequestBodyBytes = 4
	t.Cleanup(func() { maxRequestBodyBytes = saved })
	address := startBodyHost(t, readThenAnswer)
	if got := rawAnswer(t, address, post("Transfer-Encoding: chunked\r\n", "5\r\nhello\r\n0\r\n\r\n")); got != kestrel413 {
		t.Fatalf("got %q", got)
	}
	if got := rawAnswer(t, address, post("Transfer-Encoding: chunked\r\n", "4\r\nhell\r\n0\r\n\r\n")); !strings.HasSuffix(got, "hell unexpected EOF") {
		t.Fatalf("at the cap: got %q", got)
	}
}

// POST /upload raises the cap to MaxUploadBytes before it reads, as
// UploadEndpoint sets IHttpMaxRequestBodySizeFeature.
func TestARouteCanRaiseTheCapBeforeItReads(t *testing.T) {
	address := startBodyHost(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		blokserver.SetRequestBodyLimit(r.Context(), 40_000_000)
		readThenAnswer(w, r)
	}))
	got := rawAnswer(t, address, post("Content-Length: 30000001\r\n", "hello"))
	if _, body, _ := strings.Cut(got, "\r\n\r\n"); body != "hello" {
		t.Fatalf("got %q", got)
	}
}

// UploadEndpoint catches Kestrel's 413 and writes its own. So a route that
// set the cap gets the error and answers; the host writes nothing.
func TestARouteThatSetTheCapAnswersAnOverCapRead(t *testing.T) {
	address := startBodyHost(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		blokserver.SetRequestBodyLimit(r.Context(), 4)
		_, err := io.ReadAll(r.Body)
		if !errors.Is(err, blokserver.ErrRequestBodyTooLarge) {
			t.Errorf("read error %v", err)
		}
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		_, _ = io.WriteString(w, "file too large\n")
	}))
	got := rawAnswer(t, address, post("Content-Length: 5\r\n", "hello"))
	if !strings.HasPrefix(got, "HTTP/1.1 413 Request Entity Too Large\r\n") || !strings.HasSuffix(got, "file too large\n") {
		t.Fatalf("got %q", got)
	}
}

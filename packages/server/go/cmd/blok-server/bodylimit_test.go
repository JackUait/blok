package main

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
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
	if !strings.HasPrefix(got, "HTTP/1.1 413 Payload Too Large\r\n") || !strings.HasSuffix(got, "file too large\n") {
		t.Fatalf("got %q", got)
	}
}

// Measured on the C# host: Kestrel answers before it reads a body the route
// left, so the answer never says Connection: close for it. It then reads the
// rest and keeps the connection, or closes when it cannot.
func TestAnUnreadBodyLeavesTheAnswerAlone(t *testing.T) {
	address := startBodyHost(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnsupportedMediaType)
	}))
	unsupported := "HTTP/1.1 415 Unsupported Media Type\r\nContent-Length: 0\r\n\r\n"
	head := func(length int) string {
		return "POST /p HTTP/1.1\r\nHost: x\r\nContent-Length: " + strconv.Itoa(length) + "\r\n\r\n"
	}
	cases := []struct{ name, request, want string }{
		{"a small body, then a refused head", head(10) + "0123456789GET /p HTTP/1.2\r\n", unsupported + kestrel505},
		{"a body over the cap", head(30_000_001), unsupported},
	}
	for _, c := range cases {
		started := time.Now()
		if got := rawAnswer(t, address, c.request); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
		if elapsed := time.Since(started); elapsed > 2*time.Second {
			t.Errorf("%s: closed after %v", c.name, elapsed)
		}
	}
}

// Measured on the C# host: after the answer Kestrel gives what a route left
// of a body about 5 s to arrive, at any rate. 4000 or 5000 bytes sent over 4
// or 5 s kept the connection; 3000 bytes at 100 a second, 6000 at 500 a
// second, or none were cut off at 6 to 7 s.
func TestAnUnreadBodyHasTheDrainTimeToArrive(t *testing.T) {
	saved := bodyDrainTimeout
	bodyDrainTimeout = 300 * time.Millisecond
	t.Cleanup(func() { bodyDrainTimeout = saved })
	address := startBodyHost(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnsupportedMediaType)
	}))
	unsupported := "HTTP/1.1 415 Unsupported Media Type\r\nContent-Length: 0\r\n\r\n"
	head := "POST /p HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\n"
	started := time.Now()
	if got := trickle(t, address, head, "", 1, 0); got != unsupported {
		t.Errorf("a body never sent: got %q", got)
	}
	if elapsed := time.Since(started); elapsed < 300*time.Millisecond || elapsed > 2*time.Second {
		t.Errorf("a body never sent: closed after %v", elapsed)
	}
	// In time, the connection carries the next request.
	if got := trickle(t, address, head, "0123456789"+post("", ""), 5, 50*time.Millisecond); got != unsupported+strings.Replace(unsupported, "\r\n\r\n", "\r\nConnection: close\r\n\r\n", 1) {
		t.Errorf("a body in time: got %q", got)
	}
}

// Measured on the C# host: Kestrel sends 100 Continue when the route first
// reads, only on HTTP/1.1 and only when the first Expect line is
// 100-continue in any case. It ignores any other expectation, and keeps the connection after a
// body the route left, as for any unread body.
func TestExpectFollowsKestrel(t *testing.T) {
	address := startBodyHost(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen := strings.Join(r.Header.Values("Expect"), "|")
		if r.URL.Path == "/unread" {
			w.Header().Set("Content-Length", "0")
			w.WriteHeader(http.StatusUnsupportedMediaType)
			return
		}
		body, _ := io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = io.WriteString(w, seen+" "+string(body))
	}))
	head := func(path, version, expect string) string {
		return "POST " + path + " " + version + "\r\nHost: x\r\n" + expect + "Content-Length: 2\r\nConnection: close\r\n\r\n"
	}
	answer := func(body string) string {
		return fmt.Sprintf("HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s", len(body), body)
	}
	continued := "HTTP/1.1 100 Continue\r\n\r\n"
	cases := []struct{ name, head, want string }{
		{"100-continue", head("/p", "HTTP/1.1", "Expect: 100-continue\r\n"), continued + answer("100-continue ab")},
		{"in upper case", head("/p", "HTTP/1.1", "expect: 100-CONTINUE\r\n"), continued + answer("100-CONTINUE ab")},
		{"in a list", head("/p", "HTTP/1.1", "Expect: 100-continue, foo\r\n"), answer("100-continue, foo ab")},
		{"two lines", head("/p", "HTTP/1.1", "Expect: 100-continue\r\nExpect: foo\r\n"), continued + answer("100-continue|foo ab")},
		{"an empty line first", head("/p", "HTTP/1.1", "Expect:\r\nExpect: 100-continue\r\n"), answer("|100-continue ab")},
		{"spaces and tabs around", head("/p", "HTTP/1.1", "Expect: \t100-continue\t \r\n"), continued + answer("100-continue ab")},
		{"another expectation", head("/p", "HTTP/1.1", "Expect: foo\r\n"), answer("foo ab")},
		{"a control byte", head("/p", "HTTP/1.1", "Expect: f\x01o\r\n"), answer("f\x01o ab")},
		{"on HTTP/1.0", head("/p", "HTTP/1.0", "Expect: 100-continue\r\n"),
			"HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 15\r\n\r\n100-continue ab"},
	}
	for _, c := range cases {
		if got := trickle(t, address, c.head, "ab", 2, 0); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
	unread := "POST /unread HTTP/1.1\r\nHost: x\r\nExpect: 100-continue\r\nContent-Length: 2\r\n\r\n"
	unsupported := "HTTP/1.1 415 Unsupported Media Type\r\nContent-Length: 0\r\n\r\n"
	if got := trickle(t, address, unread, "ab"+head("/p", "HTTP/1.1", "")+"ab", 100, 0); got != unsupported+answer(" ab") {
		t.Errorf("an unread body: got %q", got)
	}
}

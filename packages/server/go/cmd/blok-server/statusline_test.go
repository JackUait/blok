package main

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

// Measured on the C# host: Kestrel words 413 and 416 its own way, and
// answers HTTP/1.0 with an HTTP/1.1 status line, adding Connection: close
// when it will close.
func TestTheStatusLineFollowsKestrel(t *testing.T) {
	address := startHost(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/413":
			_, _ = io.ReadAll(r.Body)
			w.WriteHeader(http.StatusRequestEntityTooLarge)
		case "/416":
			w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
		case "/close":
			w.Header().Set("Connection", "close")
		case "/body":
			w.WriteHeader(http.StatusOK)
			http.NewResponseController(w).Flush()
			_, _ = io.WriteString(w, "HTTP/1.0 413 Request Entity Too Large\r\n")
		}
	}), time.Minute)
	cases := []struct{ name, request, want string }{
		{"413", "GET /413 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n", "HTTP/1.1 413 Payload Too Large\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"},
		{"416", "GET /416 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n", "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"},
		{"HTTP/1.0", "GET /ok HTTP/1.0\r\n\r\n", "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"},
		{"HTTP/1.0 kept alive", "GET /ok HTTP/1.0\r\nConnection: keep-alive\r\n\r\nGET /416 HTTP/1.0\r\n\r\n",
			"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n" +
				"HTTP/1.1 416 Range Not Satisfiable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"},
		{"HTTP/1.0 that says close itself", "GET /close HTTP/1.0\r\n\r\n", "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"},
		{"a body that looks like a status line", "GET /body HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
			"HTTP/1.1 200 OK\r\nConnection: close\r\nTransfer-Encoding: chunked\r\n\r\n27\r\nHTTP/1.0 413 Request Entity Too Large\r\n\r\n0\r\n\r\n"},
	}
	for _, c := range cases {
		if got := rawAnswer(t, address, c.request); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
	// The body comes late, so the read waits and 100 Continue goes first.
	head := "POST /413 HTTP/1.1\r\nHost: x\r\nExpect: 100-continue\r\nContent-Length: 1\r\nConnection: close\r\n\r\n"
	want := "HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 413 Payload Too Large\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
	if got := trickleAfter(t, address, head, "x", 1, 0, 200*time.Millisecond); got != want {
		t.Errorf("413 after 100 Continue: got %q, want %q", got, want)
	}
}

// A connection hijacked before any answer writes its own bytes as they are.
func TestAHijackedConnectionWritesAsSent(t *testing.T) {
	address := startHost(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, _, err := http.NewResponseController(w).Hijack()
		if err != nil {
			return
		}
		_, _ = io.WriteString(conn, "HTTP/1.0 413 Request Entity Too Large\r\n\r\n")
		_ = conn.Close()
	}), time.Minute)
	got := rawAnswer(t, address, "GET /h HTTP/1.0\r\n\r\n")
	if !strings.HasPrefix(got, "HTTP/1.0 413 Request Entity Too Large\r\n\r\n") {
		t.Fatalf("got %q", got)
	}
}

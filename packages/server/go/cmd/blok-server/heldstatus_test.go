package main

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"
)

// sortedHead is a head's status line, then its header lines sorted.
func sortedHead(head string) string {
	lines := strings.Split(strings.TrimSuffix(head, "\r\n\r\n"), "\r\n")
	slices.Sort(lines[1:])
	return strings.Join(lines, "\r\n")
}

// KestrelHeldStatusTests: a status a handler sets is not an answer until
// the head is sent. A panic then is an empty 500, and the deadline is a
// 504. Go's deadline stands for a C# handler that throws when its token is
// cancelled; a C# handler that returns quietly after the cancel keeps its
// status, which Go cannot tell apart.
func TestAStatusSetWithoutAWriteIsHeldUntilTheHeadGoesOut(t *testing.T) {
	routes := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/status-throw":
			w.WriteHeader(http.StatusNotFound)
			panic("boom")
		case "/status-timeout":
			w.WriteHeader(http.StatusAccepted)
			<-r.Context().Done()
		case "/status-returns":
			w.WriteHeader(http.StatusAccepted)
		case "/flushed-timeout":
			w.WriteHeader(http.StatusAccepted)
			_ = http.NewResponseController(w).Flush()
			<-r.Context().Done()
		}
	})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := newHTTPServer(routes, 200*time.Millisecond)
	go func() { _ = server.Serve(headerListener{listener, time.Minute, time.Minute}) }()
	t.Cleanup(func() { _ = server.Close() })

	for _, c := range []struct{ path, head string }{
		{"/status-throw", "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nDate: D\r\nServer: Kestrel\r\n\r\n"},
		{"/status-timeout", "HTTP/1.1 504 Gateway Timeout\r\nContent-Length: 0\r\nDate: D\r\nServer: Kestrel\r\n\r\n"},
		{"/status-returns", "HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\nDate: D\r\nServer: Kestrel\r\n\r\n"},
		{"/flushed-timeout", "HTTP/1.1 202 Accepted\r\nDate: D\r\nServer: Kestrel\r\nTransfer-Encoding: chunked\r\n\r\n"},
	} {
		conn, err := net.Dial("tcp", listener.Addr().String())
		if err != nil {
			t.Fatal(err)
		}
		_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
		_, _ = io.WriteString(conn, "GET "+c.path+" HTTP/1.1\r\nHost: x\r\n\r\n")
		// Header order is net/http's, not Kestrel's; the lines are this
		// case's subject.
		if got := sortedHead(readHead(t, bufio.NewReader(conn))); got != sortedHead(c.head) {
			t.Errorf("%s: %q, want %q", c.path, got, c.head)
		}
		conn.Close()
	}
}

package main

import (
	"io"
	"net"
	"net/http"
	"testing"
	"time"
)

// halfClosed sends request, ends its side at once or after pause, and
// returns all it got back.
func halfClosed(t *testing.T, address, request string, pause time.Duration) string {
	t.Helper()
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, _ = io.WriteString(conn, request)
	time.Sleep(pause)
	_ = conn.(*net.TCPConn).CloseWrite()
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	answer, _ := io.ReadAll(conn)
	return string(answer)
}

// Measured on the C# host: once the client has ended its side, Kestrel
// writes nothing more, even for a complete request. An answer written
// before that still goes out. Go sees the end only when a read meets it,
// so a refused head or a pipelined request still gets its answer.
func TestNothingIsAnsweredOnceTheClientEndsItsSide(t *testing.T) {
	address := startHost(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Long enough for net/http's background read to meet the end.
		time.Sleep(100 * time.Millisecond)
		_, _ = io.WriteString(w, "answer")
	}), time.Minute)
	for _, c := range []struct{ name, request string }{
		{"a complete request", "GET /a HTTP/1.1\r\nHost: x\r\n\r\n"},
		{"a head with no end", "GET /a HTTP/1.1\r\nHost: x\r\n"},
	} {
		if got := halfClosed(t, address, c.request, 0); got != "" {
			t.Errorf("%s: got %q", c.name, got)
		}
	}
	if got := halfClosed(t, address, "GET /a HTTP/1.1\r\nHost: x\r\n\r\n", 300*time.Millisecond); len(got) < len("answer") || got[len(got)-len("answer"):] != "answer" {
		t.Errorf("an end after the answer: got %q", got)
	}
}

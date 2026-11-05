package main

import (
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

func startWithHeaderTimeout(t *testing.T, timeout time.Duration, handler http.Handler) string {
	t.Helper()
	return startWithTimeouts(t, timeout, time.Minute, handler)
}

func startWithTimeouts(t *testing.T, timeout, idle time.Duration, handler http.Handler) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: handler}
	wrap := limitRequestHeaders(server, timeout, idle)
	go func() { _ = server.Serve(wrap(listener)) }()
	t.Cleanup(func() { _ = server.Close() })
	return listener.Addr().String()
}

// Kestrel answers a request whose headers miss RequestHeadersTimeout with
// this 408 and closes (header-timeout.json, captured from the C# host).
func TestStalledHeadersGetKestrels408(t *testing.T) {
	address := startWithHeaderTimeout(t, 200*time.Millisecond, http.NotFoundHandler())
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, _ = io.WriteString(conn, "GET / HTTP/1.1\r\nHost: x\r\n")
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	answer, _ := io.ReadAll(conn)
	text := string(answer)
	if !strings.HasPrefix(text, "HTTP/1.1 408 Request Timeout\r\nContent-Length: 0\r\nConnection: close\r\nDate: ") || !strings.HasSuffix(text, " GMT\r\nServer: Kestrel\r\n\r\n") {
		t.Fatalf("got %q", text)
	}
}

// The clock runs per request: an idle keep-alive connection, and a handler
// that takes longer than the limit, are not cut.
func TestTheHeaderClockStopsOnceTheHandlerRuns(t *testing.T) {
	address := startWithHeaderTimeout(t, 200*time.Millisecond, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(400 * time.Millisecond)
		_, _ = io.WriteString(w, "ok")
	}))
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	for i := 0; i < 2; i++ {
		_, _ = io.WriteString(conn, "GET / HTTP/1.1\r\nHost: x\r\n\r\n")
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		buffer := make([]byte, 4096)
		n, err := conn.Read(buffer)
		if err != nil || !strings.HasPrefix(string(buffer[:n]), "HTTP/1.1 200 OK") {
			t.Fatalf("request %d: %q %v", i+1, buffer[:n], err)
		}
		time.Sleep(300 * time.Millisecond)
	}
}

// Program.cs:123,137: Kestrel keeps an idle connection 2 min. A black-box
// case would wait 2 min, so this pins the field.
func TestKeepAliveIdleTimeoutIsTwoMinutes(t *testing.T) {
	if got := newHTTPServer(http.NotFoundHandler(), time.Minute).IdleTimeout; got != 2*time.Minute {
		t.Fatalf("IdleTimeout %v", got)
	}
}

// Http1Connection.BeginRequestProcessing (Kestrel 10.0.11) starts every
// request, the first too, on KeepAliveTimeout; it ends the connection with
// no bytes. net/http has no deadline before a first request's first byte.
func TestASilentConnectionClosesAtTheKeepAliveTimeout(t *testing.T) {
	address := startWithTimeouts(t, time.Minute, 200*time.Millisecond, http.NotFoundHandler())
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	started := time.Now()
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	answer, _ := io.ReadAll(conn)
	if elapsed := time.Since(started); len(answer) != 0 || elapsed > 3*time.Second {
		t.Fatalf("got %q after %v, want a silent close near 200ms", answer, elapsed)
	}
}

// A hook set before limitRequestHeaders still runs.
func TestEarlierConnHooksStillRun(t *testing.T) {
	server := &http.Server{Handler: http.NotFoundHandler()}
	states := make(chan http.ConnState, 8)
	server.ConnState = func(_ net.Conn, state http.ConnState) { states <- state }
	wrap := limitRequestHeaders(server, time.Minute, time.Minute)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() { _ = server.Serve(wrap(listener)) }()
	defer server.Close()
	conn, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	select {
	case state := <-states:
		if state != http.StateNew {
			t.Fatalf("first state %v", state)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the earlier ConnState hook never ran")
	}
}

// Bytes of the next head can arrive before the connection goes idle: during
// a handler, in the same packet as the last request, or after a chunked body
// (net/http's own buffer then holds them). Its idle Peek is then answered
// without a socket read, so the clock must start anyway.
func TestAHeadReadBeforeIdleStillGets408(t *testing.T) {
	cases := []struct {
		name         string
		first, later string
	}{
		{"split after a handler", "GET /slow HTTP/1.1\r\nHost: x\r\n\r\n", "GET /b HTTP/1.1\r\nHost: x\r\n"},
		{"half a line after a handler", "GET /slow HTTP/1.1\r\nHost: x\r\n\r\n", "GET /b"},
		{"same packet", "GET /slow HTTP/1.1\r\nHost: x\r\n\r\nGET /b HTTP/1.1\r\nHost: x\r\n", ""},
		{"after a chunked body", "POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\nGET /b HTTP/1.1\r\nHost: x\r\n", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			address := startHost(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/slow" {
					time.Sleep(150 * time.Millisecond)
				}
				_, _ = io.WriteString(w, "ok")
			}), 100*time.Millisecond)
			conn, err := net.Dial("tcp", address)
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			_, _ = io.WriteString(conn, c.first)
			if c.later != "" {
				time.Sleep(50 * time.Millisecond)
				_, _ = io.WriteString(conn, c.later)
			}
			_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
			answer, _ := io.ReadAll(conn)
			if !strings.Contains(string(answer), "HTTP/1.1 408 Request Timeout\r\n") {
				t.Fatalf("no 408 within 2s: %q", answer)
			}
		})
	}
}

// The idle checks above must not cut a keep-alive connection that holds
// nothing of a next request, on the host's own stack.
func TestAnIdleKeepAliveIsNotCutByTheHeaderClock(t *testing.T) {
	cases := map[string]string{
		"after a GET":                  "GET /a HTTP/1.1\r\nHost: x\r\n\r\n",
		"after a POST":                 "POST /a HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\n\r\nhi",
		"after a POST and its CRLF":    "POST /a HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\n\r\nhi\r\n",
		"after an unread chunked body": "POST /a HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nhi\r\n0\r\n\r\n",
	}
	for name, first := range cases {
		t.Run(name, func(t *testing.T) {
			address := startHost(t, echoTarget, 100*time.Millisecond)
			conn, err := net.Dial("tcp", address)
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			_, _ = io.WriteString(conn, first)
			time.Sleep(300 * time.Millisecond)
			_, _ = io.WriteString(conn, "GET /b HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
			_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
			answer, _ := io.ReadAll(conn)
			if strings.Count(string(answer), "HTTP/1.1 200 OK\r\n") != 2 {
				t.Fatalf("got %q", answer)
			}
		})
	}
}

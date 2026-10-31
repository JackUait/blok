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
	if !strings.HasPrefix(text, "HTTP/1.1 408 Request Timeout\r\nContent-Length: 0\r\nConnection: close\r\nDate: ") || !strings.HasSuffix(text, " GMT\r\n\r\n") {
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

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
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: handler}
	wrap := limitRequestHeaders(server, timeout)
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

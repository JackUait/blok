package main

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/ws"
)

// Measured on the C# host: Kestrel names itself on every answer, its own
// bare refusals and the 101 too. Order is not part of the contract.
func TestEveryAnswerNamesKestrel(t *testing.T) {
	blok := newHandler()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := newHTTPServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/upgrade":
			conn, err := ws.Upgrade(w, r, ws.Options{})
			if err == nil {
				conn.Abort()
			}
		case "/slow":
			<-r.Context().Done()
		default:
			blok.ServeHTTP(w, r)
		}
	}), 300*time.Millisecond)
	go func() { _ = server.Serve(headerListener{listener, time.Minute, time.Minute}) }()
	t.Cleanup(func() { _ = server.Close() })
	address := listener.Addr().String()
	upgrade := "GET /upgrade HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n"
	cases := []struct{ name, request, status string }{
		{"health", "GET /health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n", "200"},
		{"catch-all", "GET /missing HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n", "404"},
		{"405", "PUT /health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n", "405"},
		{"bad request line", "GARBAGE\r\n\r\n", "400"},
		{"bad version", "GET / HTTP/1.2\r\nHost: x\r\n\r\n", "505"},
		{"deadline", "GET /slow HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n", "504"},
		{"upgrade", upgrade, "101"},
	}
	for _, c := range cases {
		answer := rawHead(t, address, c.request)
		if !strings.HasPrefix(answer, "HTTP/1.1 "+c.status+" ") {
			t.Errorf("%s: %q", c.name, answer)
			continue
		}
		if !strings.Contains(answer+"\r\n", "\r\nServer: Kestrel\r\n") || !strings.Contains(answer, "\r\nDate: ") {
			t.Errorf("%s: %q", c.name, answer)
		}
	}
}

// rawHead is the head of the first answer, Date and Server kept.
func rawHead(t *testing.T, address, request string) string {
	t.Helper()
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, _ = io.WriteString(conn, request)
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	reader := bufio.NewReader(conn)
	var head strings.Builder
	for {
		line, err := reader.ReadString('\n')
		head.WriteString(line)
		if err != nil || line == "\r\n" {
			return strings.TrimSuffix(head.String(), "\r\n\r\n")
		}
	}
}

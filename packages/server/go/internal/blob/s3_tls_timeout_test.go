package blob

import (
	"context"
	"net"
	"strings"
	"testing"
	"time"
)

// SocketsHttpHandler.ConnectTimeout also bounds the TLS handshake: against
// a listener that never answers the ClientHello, C# failed at its 10 s
// connect cap, not at the request timeout.
func TestAStalledTLSHandshakeDiesAtTheConnectTimeout(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		var held []net.Conn
		defer func() {
			for _, conn := range held {
				conn.Close()
			}
		}()
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			held = append(held, conn)
		}
	}()
	s := testS3("https://"+listener.Addr().String(), "media", "path")
	s.requestTimeout = testRequestTimeout
	s.connectTimeout = testHeaderTimeout
	if s, err = NewS3(s); err != nil {
		t.Fatal(err)
	}

	start := time.Now()
	_, err = s.GetObject(context.Background(), "collab/key")
	if elapsed := time.Since(start); err == nil || elapsed > testRequestTimeout/2 {
		t.Fatalf("failed after %v with %v", elapsed, err)
	}
	if !strings.Contains(err.Error(), "handshake") {
		t.Fatalf("got %v, want a handshake timeout", err)
	}
}

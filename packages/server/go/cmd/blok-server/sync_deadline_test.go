package main

import (
	"bufio"
	"bytes"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/blokserver"
	"github.com/JackUait/blok/packages/server/go/v2/internal/ws"
)

// A sync socket opts out of the request deadline, as GET /sync/{doc} does
// with DisableRequestTimeout: it outlives the deadline, the header clock and
// the idle timeout, and no 504 lands on the upgraded stream.
func TestAnUpgradedSocketOutlivesTheRequestDeadline(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	const short = 150 * time.Millisecond
	server := newHTTPServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := ws.Upgrade(w, r, ws.Options{})
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Abort()
		buf := make([]byte, 64)
		for {
			n, kind, _, err := conn.Receive(buf)
			if err != nil || kind == ws.MessageClose {
				return
			}
			if err := conn.SendBinary(buf[:n]); err != nil {
				return
			}
		}
	}), short)
	var serverLog syncBuffer
	server.ErrorLog = log.New(&serverLog, "", 0)
	go func() { _ = server.Serve(headerListener{listener, short, short}) }()
	t.Cleanup(func() { _ = server.Close() })

	client, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_, _ = io.WriteString(client, "GET /sync/doc HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n"+
		"Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n")
	reader := bufio.NewReader(client)
	response, err := http.ReadResponse(reader, nil)
	if err != nil || response.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("upgrade: %v %v", response, err)
	}

	time.Sleep(4 * short)
	frame := []byte{0x82, 0x83, 0, 0, 0, 0, 'a', 'b', 'c'}
	if _, err := client.Write(frame); err != nil {
		t.Fatalf("the socket died at the deadline: %v", err)
	}
	_ = client.SetReadDeadline(time.Now().Add(5 * time.Second))
	got := make([]byte, 5)
	if _, err := io.ReadFull(reader, got); err != nil {
		t.Fatalf("no echo after the deadline: %v", err)
	}
	if !bytes.Equal(got, []byte{0x82, 3, 'a', 'b', 'c'}) {
		if strings.Contains(string(got), "HTTP") {
			t.Fatalf("an HTTP answer landed on the socket: %q", got)
		}
		t.Fatalf("got % x", got)
	}
	// The deadline must know the writer was hijacked, not try a 504 on it.
	time.Sleep(short)
	if text := serverLog.String(); text != "" {
		t.Fatalf("the server logged: %s", text)
	}
}

// A sync request the door refuses never upgrades, so its lifted deadline
// must not leave the body unbounded: net/http drains the unread body after
// the handler, and a trickled one would pin the connection forever.
func TestARefusedSyncRequestStillEndsATrickledBodyAtTheDeadline(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	const short = 150 * time.Millisecond
	// What the sync door does for a request with a body: lift, then refuse.
	server := newHTTPServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		blokserver.LiftRequestTimeout(r.Context())
		w.WriteHeader(http.StatusUpgradeRequired)
	}), short)
	go func() { _ = server.Serve(headerListener{listener, headerTimeout, keepAliveTimeout}) }()
	t.Cleanup(func() { _ = server.Close() })

	client, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_, _ = io.WriteString(client, "GET /sync/doc HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n"+
		"Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nContent-Length: 1000\r\n\r\nx")
	closed := make(chan struct{})
	go func() {
		_, _ = io.Copy(io.Discard, client)
		close(closed)
	}()
	started := time.Now()
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for time.Since(started) < 2*time.Second {
		select {
		case <-closed:
			return
		case <-ticker.C:
			if _, err := client.Write([]byte{'x'}); err != nil {
				return
			}
		}
	}
	t.Fatalf("the connection was still open %v after a %v deadline", time.Since(started), short)
}

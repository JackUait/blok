package main

import (
	"bufio"
	"context"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/blokserver"
)

func serveWithDeadline(t *testing.T, handler http.Handler, timeout time.Duration) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := newHTTPServer(handler, timeout)
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { _ = server.Close() })
	return listener.Addr().String()
}

// HostProcessTests 'CancelsBlockedStorageWorkAtTheHostDeadline': the answer
// is 504 and the work below sees its context cancelled.
func TestDeadlineAnswers504AndCancelsTheWork(t *testing.T) {
	cancelled := make(chan struct{})
	address := serveWithDeadline(t, http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
		close(cancelled)
	}), 200*time.Millisecond)

	response, err := http.Get("http://" + address + "/")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusGatewayTimeout {
		t.Fatalf("status %d", response.StatusCode)
	}
	select {
	case <-cancelled:
	case <-time.After(2 * time.Second):
		t.Fatal("the work was not cancelled")
	}
}

// HostProcessTests 'CancelsAStalledRequestBodyAtTheHostDeadline': a body
// that stops arriving still ends in 504, not a hung request.
func TestDeadlineEndsAStalledBody(t *testing.T) {
	address := serveWithDeadline(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
	}), 300*time.Millisecond)

	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, _ = io.WriteString(conn, "POST /upload HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\npartial")
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	status, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil || !strings.HasPrefix(status, "HTTP/1.1 504") {
		t.Fatalf("%q %v", status, err)
	}
}

// An answer already started is left alone. A status set but not flushed
// has not started: TestAStatusSetWithoutAWriteIsHeldUntilTheHeadGoesOut.
func TestDeadlineKeepsAStartedAnswer(t *testing.T) {
	address := serveWithDeadline(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_ = http.NewResponseController(w).Flush()
		<-r.Context().Done()
	}), 200*time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, "GET", "http://"+address+"/", nil)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status %d", response.StatusCode)
	}
}

// A route that lifts the deadline (GET /sync/{doc}) runs past it: no 504,
// its context is not cancelled, and the read deadline is gone too.
func TestALiftedRequestOutlivesTheDeadline(t *testing.T) {
	address := serveWithDeadline(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		blokserver.LiftRequestTimeout(r.Context())
		time.Sleep(400 * time.Millisecond)
		if err := r.Context().Err(); err != nil {
			t.Errorf("context ended: %v", err)
		}
		w.WriteHeader(http.StatusNoContent)
	}), 150*time.Millisecond)

	response, err := http.Get("http://" + address + "/")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("status %d", response.StatusCode)
	}
}

// Measured on the C# host: a download whose reader stalls from its first
// byte is reset at the request deadline (600 s there).
func TestDeadlineEndsAnAnswerAStalledReaderHolds(t *testing.T) {
	const size = 64 << 20
	address := serveWithDeadline(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(size))
		chunk := make([]byte, 64<<10)
		for written := 0; written < size; written += len(chunk) {
			if _, err := w.Write(chunk); err != nil {
				return
			}
		}
	}), 500*time.Millisecond)

	dialer := net.Dialer{Control: func(_, _ string, raw syscall.RawConn) error {
		return raw.Control(func(fd uintptr) { _ = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_RCVBUF, 1024) })
	}}
	conn, err := dialer.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, _ = io.WriteString(conn, "GET / HTTP/1.1\r\nHost: x\r\n\r\n")
	time.Sleep(2 * time.Second)
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	read, err := io.Copy(io.Discard, conn)
	if ne, ok := err.(net.Error); ok && ne.Timeout() {
		t.Fatalf("the connection was still open: %d bytes read", read)
	}
	if read >= size {
		t.Fatalf("the whole body went out (%d bytes)", read)
	}
}

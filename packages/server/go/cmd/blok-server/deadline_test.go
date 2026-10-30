package main

import (
	"bufio"
	"context"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
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

// An answer already started is left alone.
func TestDeadlineKeepsAStartedAnswer(t *testing.T) {
	address := serveWithDeadline(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
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

package main

import (
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/blokserver"
)

const kestrel408 = "HTTP/1.1 408 Request Timeout\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"

// trickle writes head, then body in pieces of size, one per gap, and returns
// what comes back without the Date header.
func trickle(t *testing.T, address, head, body string, size int, gap time.Duration) string {
	t.Helper()
	return trickleAfter(t, address, head, body, size, gap, 0)
}

// trickleAfter is trickle with a pause between the head and the body.
func trickleAfter(t *testing.T, address, head, body string, size int, gap, pause time.Duration) string {
	t.Helper()
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, _ = io.WriteString(conn, head)
	go func() {
		time.Sleep(pause)
		for len(body) > 0 {
			n := min(size, len(body))
			if _, err := io.WriteString(conn, body[:n]); err != nil {
				return
			}
			body = body[n:]
			time.Sleep(gap)
		}
	}()
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	answer, _ := io.ReadAll(conn)
	lines := strings.Split(string(answer), "\r\n")
	kept := lines[:0]
	for _, line := range lines {
		if !strings.HasPrefix(line, "Date: ") && line != "Server: Kestrel" {
			kept = append(kept, line)
		}
	}
	return strings.Join(kept, "\r\n")
}

func withBodyRate(t *testing.T, grace time.Duration) {
	t.Helper()
	saved := minBodyRate
	minBodyRate = dataRate{bytesPerSecond: 240, grace: grace}
	t.Cleanup(func() { minBodyRate = saved })
}

var readAll = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	_, _ = io.WriteString(w, string(body))
	if err != nil {
		_, _ = io.WriteString(w, " "+err.Error())
	}
})

// Kestrel's MinRequestBodyDataRate: 240 bytes a second after a 5 s grace,
// else a bare 408 and the connection closes. Measured on the C# host: one
// byte a second got the 408 at about 6 s.
func TestASlowBodyGetsKestrels408(t *testing.T) {
	withBodyRate(t, 300*time.Millisecond)
	address := startBodyHost(t, readAll)
	started := time.Now()
	got := trickle(t, address, post("Content-Length: 200\r\n", ""), strings.Repeat("a", 200), 1, 50*time.Millisecond)
	if got != kestrel408 {
		t.Fatalf("got %q", got)
	}
	if elapsed := time.Since(started); elapsed < 300*time.Millisecond || elapsed > 2*time.Second {
		t.Fatalf("answered after %v", elapsed)
	}
}

// Measured on the C# host: /upload, which sets the cap, catches Kestrel's
// rate failure and answers 400 "malformed upload" itself.
func TestARouteThatSetTheCapAnswersASlowBody(t *testing.T) {
	withBodyRate(t, 300*time.Millisecond)
	address := startBodyHost(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		blokserver.SetRequestBodyLimit(r.Context(), 1000)
		if _, err := io.ReadAll(r.Body); err != nil {
			// The read deadline cancelled the context too.
			if !errors.Is(err, blokserver.ErrRequestBodyTooSlow) || r.Context().Err() == nil {
				t.Errorf("read error %v, context %v", err, r.Context().Err())
			}
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, "malformed upload\n")
		}
	}))
	got := trickle(t, address, post("Content-Length: 200\r\n", ""), strings.Repeat("a", 200), 1, 50*time.Millisecond)
	if !strings.HasPrefix(got, "HTTP/1.1 400 Bad Request\r\n") || !strings.HasSuffix(got, "malformed upload\n") {
		t.Fatalf("got %q", got)
	}
}

// A slow body must not take the handler out of the request deadline or a
// client disconnect: its context still ends.
func TestASlowBodyStillEndsTheHandlersContext(t *testing.T) {
	withBodyRate(t, 200*time.Millisecond)
	ended := make(chan error, 1)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := newHTTPServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		blokserver.SetRequestBodyLimit(r.Context(), 1000)
		if _, err := io.ReadAll(r.Body); err == nil {
			ended <- errors.New("the slow body read without an error")
			return
		}
		select {
		case <-r.Context().Done():
			ended <- nil
		case <-time.After(2 * time.Second):
			ended <- errors.New("the context did not end")
		}
	}), time.Second)
	go func() { _ = server.Serve(headerListener{listener, time.Minute, time.Minute}) }()
	t.Cleanup(func() { _ = server.Close() })
	trickle(t, listener.Addr().String(), post("Content-Length: 200\r\n", ""), strings.Repeat("a", 200), 1, 50*time.Millisecond)
	if err := <-ended; err != nil {
		t.Fatal(err)
	}
}

func TestABodyAtTheRateIsRead(t *testing.T) {
	withBodyRate(t, 200*time.Millisecond)
	address := startBodyHost(t, readAll)
	body := strings.Repeat("a", 500)
	got := trickle(t, address, post("Content-Length: 500\r\n", ""), body, 50, 100*time.Millisecond)
	if _, answer, _ := strings.Cut(got, "\r\n\r\n"); answer != body {
		t.Fatalf("got %.80q", got)
	}
}

// Kestrel times only the reads: a handler busy between reads is not a slow
// body.
func TestTimeBetweenReadsDoesNotCount(t *testing.T) {
	withBodyRate(t, 100*time.Millisecond)
	address := startBodyHost(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buffer := make([]byte, 2)
		for {
			n, err := r.Body.Read(buffer)
			_, _ = w.Write(buffer[:n])
			if err != nil {
				return
			}
			time.Sleep(150 * time.Millisecond)
		}
	}))
	got := rawAnswer(t, address, post("Content-Length: 6\r\n", "abcdef"))
	if !strings.HasPrefix(got, "HTTP/1.1 200 OK\r\n") || !strings.Contains(got, "abcdef") {
		t.Fatalf("got %q", got)
	}
}

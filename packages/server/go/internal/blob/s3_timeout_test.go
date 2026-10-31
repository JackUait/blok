package blob

import (
	"bufio"
	"context"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// Hand port of S3BlobStoreTimeoutTests (Blok.Server.Tests): which clock
// stops which S3 request. Timing cannot live in a fixture.

const (
	testHeaderTimeout  = 300 * time.Millisecond
	testRequestTimeout = 3 * time.Second
)

// rawServer reads each request's headers (and its body when readBody), then
// hands the connection to handle.
func rawServer(t *testing.T, readBody bool, handle func(conn net.Conn, reader *bufio.Reader, stop <-chan struct{})) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	stop := make(chan struct{})
	var wait sync.WaitGroup
	t.Cleanup(func() {
		close(stop)
		listener.Close()
		wait.Wait()
	})
	wait.Add(1)
	go func() {
		defer wait.Done()
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			wait.Add(1)
			go func() {
				defer wait.Done()
				defer conn.Close()
				go func() { <-stop; conn.Close() }()
				reader := bufio.NewReader(conn)
				length := 0
				for {
					line, err := reader.ReadString('\n')
					if err != nil {
						return
					}
					if line == "\r\n" {
						break
					}
					if name, value, ok := strings.Cut(line, ":"); ok && strings.EqualFold(name, "Content-Length") {
						length, _ = strconv.Atoi(strings.TrimSpace(value))
					}
				}
				if readBody {
					io.CopyN(io.Discard, reader, int64(length))
				}
				handle(conn, reader, stop)
			}()
		}
	}()
	return "http://" + listener.Addr().String()
}

func timeoutStore(t *testing.T, endpoint string, requestTimeout time.Duration) *S3 {
	t.Helper()
	s := testS3(endpoint, "media", "path")
	s.requestTimeout = requestTimeout
	s.headerTimeout = testHeaderTimeout
	s, err := NewS3(s)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestABodilessGetStillWaitsForHeadersOnlyUntilTheHeaderTimeout(t *testing.T) {
	endpoint := rawServer(t, true, func(_ net.Conn, _ *bufio.Reader, stop <-chan struct{}) { <-stop })
	s := timeoutStore(t, endpoint, testRequestTimeout)
	start := time.Now()
	if _, err := s.GetObject(context.Background(), "collab/key"); err == nil {
		t.Fatal("no error")
	}
	if elapsed := time.Since(start); elapsed < testHeaderTimeout || elapsed > testRequestTimeout/2 {
		t.Fatalf("failed after %v", elapsed)
	}
}

func TestTheHeaderTimeoutCountsFromTheEndOfTheBody(t *testing.T) {
	// Far larger than the socket buffers, so the client is still writing
	// while the server waits; only then is it answered.
	body := make([]byte, 64<<20)
	endpoint := rawServer(t, false, func(conn net.Conn, reader *bufio.Reader, stop <-chan struct{}) {
		select {
		case <-time.After(testHeaderTimeout * 3):
		case <-stop:
			return
		}
		io.CopyN(io.Discard, reader, int64(len(body)))
		io.WriteString(conn, "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
	})
	// A long request timeout: only the header clock is under test here.
	s := timeoutStore(t, endpoint, 30*time.Second)
	if err := s.PutObject(context.Background(), "collab/key", body); err != nil {
		t.Fatal(err)
	}
}

func TestAStalledResponseBodyDiesAtTheRequestTimeout(t *testing.T) {
	endpoint := rawServer(t, true, func(conn net.Conn, _ *bufio.Reader, stop <-chan struct{}) {
		io.WriteString(conn, "HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nab")
		<-stop
	})
	s := timeoutStore(t, endpoint, testRequestTimeout)
	start := time.Now()
	if _, err := s.GetObject(context.Background(), "collab/key"); err == nil {
		t.Fatal("no error")
	}
	if elapsed := time.Since(start); elapsed < testRequestTimeout || elapsed > testRequestTimeout*2 {
		t.Fatalf("failed after %v", elapsed)
	}
}

// S3BlobStore.CreateHandler: a 10 s connect timeout, no redirects.
func TestTheClientConnectsWithinTenSecondsAndFollowsNoRedirect(t *testing.T) {
	s, err := NewS3(testS3("https://s3.example.com", "media", ""))
	if err != nil {
		t.Fatal(err)
	}
	if s.dialer.Timeout != 10*time.Second {
		t.Fatalf("connect timeout %v", s.dialer.Timeout)
	}
	transport := s.client.Transport.(*http.Transport)
	if transport.ResponseHeaderTimeout != 60*time.Second || s.requestTimeout != 5*time.Minute {
		t.Fatalf("header %v request %v", transport.ResponseHeaderTimeout, s.requestTimeout)
	}
	if s.client.CheckRedirect(nil, nil) != http.ErrUseLastResponse {
		t.Fatal("follows redirects")
	}
}

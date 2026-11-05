package main

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"
)

var anyDate = regexp.MustCompile(`Date: [^\r]*`)

// throwingRoutes are KestrelThrowAnswerTests' routes.
var throwingRoutes = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/throw":
		w.Header().Set("X-Before", "1")
		panic("boom")
	case "/throw-late":
		w.Header().Set("Content-Length", "10")
		_, _ = io.WriteString(w, "half")
		_ = http.NewResponseController(w).Flush()
		panic("boom")
	default:
		_, _ = io.WriteString(w, "ok")
	}
})

// readHead reads one answer's head off conn, and the body of a 200 "ok".
func readHead(t *testing.T, reader *bufio.Reader) string {
	t.Helper()
	var head strings.Builder
	for !strings.HasSuffix(head.String(), "\r\n\r\n") {
		b, err := reader.ReadByte()
		if err != nil {
			break
		}
		head.WriteByte(b)
	}
	return anyDate.ReplaceAllString(head.String(), "Date: D")
}

func assertThrowAnswers(t *testing.T, address, server string) {
	t.Helper()
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	reader := bufio.NewReader(conn)
	_, _ = io.WriteString(conn, "GET /throw HTTP/1.1\r\nHost: x\r\n\r\n")
	if got, want := readHead(t, reader), "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nDate: D\r\n"+server+"\r\n"; got != want {
		t.Fatalf("throw before the head: %q, want %q", got, want)
	}
	_, _ = io.WriteString(conn, "GET /ok HTTP/1.1\r\nHost: x\r\n\r\n")
	if got := readHead(t, reader); !strings.HasPrefix(got, "HTTP/1.1 200 OK\r\n") {
		t.Fatalf("the connection did not stay open: %q", got)
	}

	late, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer late.Close()
	_ = late.SetDeadline(time.Now().Add(5 * time.Second))
	_, _ = io.WriteString(late, "GET /throw-late HTTP/1.1\r\nHost: x\r\n\r\n")
	all, _ := io.ReadAll(late)
	// Header order and net/http's sniffed Content-Type are not this
	// case's subject: the cut after the body is.
	if got := string(all); !strings.HasPrefix(got, "HTTP/1.1 200 OK\r\n") ||
		!strings.Contains(got, "\r\nContent-Length: 10\r\n") || !strings.HasSuffix(got, "\r\n\r\nhalf") {
		t.Fatalf("throw after the head: %q, want the head, \"half\", then the cut", got)
	}
}

// KestrelThrowAnswerTests: a throw before the head is an empty 500 on a
// connection that stays open; after it, the connection closes.
func TestAHandlerPanicAnswersAsKestrelDoes(t *testing.T) {
	assertThrowAnswers(t, startHost(t, throwingRoutes, time.Minute), "Server: Kestrel\r\n")
}

package blokserver

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"
)

// KestrelThrowAnswerTests, for an embedder: a panic in front of the routes
// (here the host's auth) before the head is an empty 500 on a connection
// that stays open.
func TestAPanicInsideTheHandlerAnswersAnEmpty500(t *testing.T) {
	o := DefaultOptions()
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	handler := s.HandlerWithAuth("/blok", func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("X-Throw") != "" {
				w.Header().Set("X-Before", "1")
				panic("boom")
			}
			next.ServeHTTP(w, r)
		})
	})
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	conn, err := net.Dial("tcp", server.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	reader := bufio.NewReader(conn)
	_, _ = io.WriteString(conn, "GET /blok/unfurl HTTP/1.1\r\nHost: x\r\nX-Throw: 1\r\n\r\n")
	date := regexp.MustCompile(`Date: [^\r]*`)
	if got, want := date.ReplaceAllString(head(reader), "Date: D"), "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nDate: D\r\n\r\n"; got != want {
		t.Fatalf("%q, want %q", got, want)
	}
	_, _ = io.WriteString(conn, "GET /blok/health HTTP/1.1\r\nHost: x\r\n\r\n")
	if got := head(reader); !strings.HasPrefix(got, "HTTP/1.1 200 OK\r\n") {
		t.Fatalf("the connection did not stay open: %q", got)
	}
}

func head(reader *bufio.Reader) string {
	var text strings.Builder
	for !strings.HasSuffix(text.String(), "\r\n\r\n") {
		b, err := reader.ReadByte()
		if err != nil {
			break
		}
		text.WriteByte(b)
	}
	return text.String()
}

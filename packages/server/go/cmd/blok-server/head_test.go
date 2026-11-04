package main

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

// rawAnswer sends request on a fresh connection and returns what comes back
// before the server closes it, with the Date header dropped.
func rawAnswer(t *testing.T, address, request string) string {
	t.Helper()
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, _ = io.WriteString(conn, request)
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	answer, _ := io.ReadAll(conn)
	lines := strings.Split(string(answer), "\r\n")
	kept := lines[:0]
	for _, line := range lines {
		if !strings.HasPrefix(line, "Date: ") {
			kept = append(kept, line)
		}
	}
	return strings.Join(kept, "\r\n")
}

const (
	kestrel400 = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
	kestrel414 = "HTTP/1.1 414 URI Too Long\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
	kestrel431 = "HTTP/1.1 431 Request Header Fields Too Large\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
	kestrel505 = "HTTP/1.1 505 HTTP Version Not Supported\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
)

// Measured on the C# host: the version is the rest of the request line. It
// must be 8 bytes, or 9 ending in CR, else 400; any 8 bytes but HTTP/1.0 and
// HTTP/1.1 get 505. Kestrel answers from the line alone.
func TestTheVersionFollowsKestrel(t *testing.T) {
	address := startHost(t, echoTarget, time.Minute)
	line := func(version string) string { return "GET /h " + version + "\r\nHost: x\r\nConnection: close\r\n\r\n" }
	cases := []struct{ name, request, want string }{
		{"HTTP/1.2", line("HTTP/1.2"), kestrel505},
		{"HTTP/2.0", line("HTTP/2.0"), kestrel505},
		{"HTTP/0.9", line("HTTP/0.9"), kestrel505},
		{"lower case", line("http/1.1"), kestrel505},
		{"seven bytes and CR", line("HTTP/1."), kestrel505},
		{"eight bytes and no CR", "GET /h HTTP/1.2\nHost: x\n\n", kestrel505},
		{"nine bytes and CR", line("HTTP/1.10"), kestrel400},
		{"nine bytes and no CR", "GET /h HTTP/1.10\nHost: x\n\n", kestrel400},
		{"a space after", line("HTTP/1.1 "), kestrel400},
		{"none", line(""), kestrel400},
		{"the line alone", "GET /h HTTP/1.2\r\n", kestrel505},
		{"before 101 headers", "GET /h HTTP/1.2\r\n" + numberedHeaders(101) + "\r\n", kestrel505},
		{"a bad method first", "G@T /h HTTP/1.2\r\nHost: x\r\n\r\n", kestrel400},
		{"HTTP/1.1", line("HTTP/1.1"), "HTTP/1.1 200 OK"},
	}
	for _, c := range cases {
		got := rawAnswer(t, address, c.request)
		if strings.HasSuffix(c.want, " 200 OK") {
			got = answerStatus(got)
		}
		if got != c.want {
			t.Errorf("%s: got %.120q, want %q", c.name, got, c.want)
		}
	}
}

// echoHeader answers with the X-A values and every header name the handler sees.
var echoHeader = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	_, _ = fmt.Fprintf(w, "%q", r.Header.Values("X-A"))
	for name := range r.Header {
		if strings.HasPrefix(name, "X") && name != "X-A" {
			_, _ = fmt.Fprintf(w, " %q=%q", name, r.Header[name])
		}
	}
})

func headWith(headers string) string {
	return "GET /h HTTP/1.1\r\nHost: x\r\n" + headers + "Connection: close\r\n\r\n"
}

func numberedHeaders(count int) string {
	var b strings.Builder
	for i := 0; i < count; i++ {
		fmt.Fprintf(&b, "X%d: v\r\n", i)
	}
	return b.String()
}

func answerStatus(answer string) string {
	status, _, _ := strings.Cut(answer, "\r\n")
	return status
}

// Measured on the C# host (Kestrel defaults): the request line may be 8192
// bytes with its line end, the header block 32770 bytes with the blank
// line, and a head may carry 100 header lines, Host included.
func TestRequestHeadsStopAtKestrelsLimits(t *testing.T) {
	address := startHost(t, echoTarget, time.Minute)
	// "GET /h?" + n + " HTTP/1.1\r\n" is n + 18 bytes.
	line := func(target string, n int) string {
		return "GET " + target + "?" + strings.Repeat("a", n) + " HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"
	}
	// Host: x, X: <n>, Connection: close and the blank line are n + 35 bytes.
	block := func(n int) string { return headWith("X: " + strings.Repeat("a", n) + "\r\n") }
	cases := []struct {
		name, request, want string
	}{
		{"line at the limit", line("/h", 8192-18), "HTTP/1.1 200 OK"},
		{"line over the limit", line("/h", 8193-18), kestrel414},
		{"swapped target at the limit", line("/%zz", 8192-20), "HTTP/1.1 200 OK"},
		{"swapped target over the limit", line("/%zz", 8193-20), kestrel414},
		{"line with no end yet", "GET /h?" + strings.Repeat("a", 8192), kestrel414},
		{"block at the limit", block(32770 - 35), "HTTP/1.1 200 OK"},
		{"block over the limit", block(32771 - 35), kestrel431},
		{"block with no end yet", "GET /h HTTP/1.1\r\nHost: x\r\nX: " + strings.Repeat("a", 32770), kestrel431},
		{"100 headers", headWith(numberedHeaders(98)), "HTTP/1.1 200 OK"},
		{"101 headers", headWith(numberedHeaders(99)), kestrel431},
	}
	for _, c := range cases {
		got := rawAnswer(t, address, c.request)
		if strings.HasPrefix(c.want, "HTTP/1.1 200") {
			got = answerStatus(got)
		}
		if got != c.want {
			t.Errorf("%s: got %.120q, want %q", c.name, got, c.want)
		}
	}
}

// Kestrel answers a kept-alive request before it refuses the next head.
func TestAHeadOverTheLimitAfterAKeptAliveRequest(t *testing.T) {
	address := startHost(t, echoTarget, time.Minute)
	got := rawAnswer(t, address, "GET /a HTTP/1.1\r\nHost: x\r\n\r\n"+headWith(numberedHeaders(99)))
	if !strings.HasPrefix(got, "HTTP/1.1 200 OK\r\n") || !strings.HasSuffix(got, kestrel431) {
		t.Fatalf("got %q", got)
	}
}

// Measured on the C# host with a byte sweep over a header name and value.
func TestRequestHeadsFollowKestrelsGrammar(t *testing.T) {
	address := startHost(t, echoHeader, time.Minute)
	cases := []struct {
		name, request, want string
	}{
		{"invalid UTF-8 in a value", headWith("X-A: \xe9\r\n"), kestrel400},
		{"valid UTF-8 in a value", headWith("X-A: \xc3\xa9\r\n"), `["é"]`},
		{"DEL in a value", headWith("X-A: a\x7fb\r\n"), `["a\x7fb"]`},
		{"control byte in a value", headWith("X-A: \x01\r\n"), `["\x01"]`},
		{"swapped and plain values keep their order", headWith("X-A: a_b\r\nX-A: a\x01b\r\nX-A: a_b\r\n"), `["a_b" "a\x01b" "a_b"]`},
		{"NUL in a value", headWith("X-A: a\x00b\r\n"), kestrel400},
		{"CR in a value", headWith("X-A: a\rb\r\n"), kestrel400},
		{"folded line", headWith("X-A: a\r\n b\r\n"), kestrel400},
		{"first line folded", "GET /h HTTP/1.1\r\n Host: x\r\nConnection: close\r\n\r\n", kestrel400},
		{"quote in a name", headWith("X\"b: v\r\n"), `[] "X\"b"=["v"]`},
		{"control byte in a name", headWith("X\x01b: v\r\n"), `[] "X\x01b"=["v"]`},
		{"space before the colon", headWith("X-A : a\r\n"), kestrel400},
		{"no colon", headWith("NoColon\r\n"), kestrel400},
		{"no Host", "GET /h HTTP/1.1\r\nConnection: close\r\n\r\n", kestrel400},
		{"two Host headers", "GET /h HTTP/1.1\r\nHost: a\r\nHost: b\r\nConnection: close\r\n\r\n", kestrel400},
		{"malformed Host", "GET /h HTTP/1.1\r\nHost: a b\r\nConnection: close\r\n\r\n", kestrel400},
		{"HTTP/0.9", "GET /h\r\n\r\n", kestrel400},
		{"two Content-Length values", "POST /h HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\nxx", kestrel400},
		{"blank lines before the request line", "\r\n\n\r" + headWith("X-A: v\r\n"), `["v"]`},
	}
	for _, c := range cases {
		got := rawAnswer(t, address, c.request)
		if !strings.HasPrefix(c.want, "HTTP/") {
			if status := answerStatus(got); status != "HTTP/1.1 200 OK" {
				t.Errorf("%s: got %.120q", c.name, got)
				continue
			}
			head, body, _ := strings.Cut(got, "\r\n\r\n")
			got = body
			if strings.Contains(head, "Transfer-Encoding: chunked") {
				got = chunkBody(body)
			}
		}
		if got != c.want {
			t.Errorf("%s: got %.160q, want %q", c.name, got, c.want)
		}
	}
}

// chunkBody joins the chunks of a chunked body.
func chunkBody(chunked string) string {
	var out strings.Builder
	for {
		size, rest, ok := strings.Cut(chunked, "\r\n")
		var n int
		if !ok || size == "0" {
			return out.String()
		}
		_, _ = fmt.Sscanf(size, "%x", &n)
		if n > len(rest) {
			return out.String() + rest
		}
		out.WriteString(rest[:n])
		chunked = strings.TrimPrefix(rest[n:], "\r\n")
	}
}

// Kestrel's HTTP/1 endpoint answers the HTTP/2 preface with a GOAWAY frame,
// HTTP_1_1_REQUIRED (0x0d), and closes.
func TestTheHTTP2PrefaceGetsKestrelsGoAway(t *testing.T) {
	address := startHost(t, echoTarget, time.Minute)
	got := rawAnswer(t, address, "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n")
	if got != "\x00\x00\x08\x07\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x0d" {
		t.Fatalf("got %q", got)
	}
}

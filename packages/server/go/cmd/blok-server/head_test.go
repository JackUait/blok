package main

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/route"
)

// Measured on the C# host: Kestrel takes any codings whose last non-empty
// one, split on commas and trimmed of spaces only, is chunked, and reads the
// body as chunked. Anything else gets an empty 400, on HTTP/1.0 too.
func TestTransferCodingsFollowKestrel(t *testing.T) {
	echoBody := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		names := slices.Sorted(func(yield func(string) bool) {
			for name := range r.Header {
				if !yield(name) {
					return
				}
			}
		})
		_, _ = fmt.Fprintf(w, "%q %q %q", body, r.TransferEncoding, names)
	})
	address := startHost(t, echoBody, time.Minute)
	post := func(te string) string {
		return "POST /h HTTP/1.1\r\nHost: x\r\n" + te + "Connection: close\r\n\r\n2\r\nab\r\n0\r\n\r\n"
	}
	read := `"ab" ["chunked"] ["Connection"]`
	cases := []struct{ name, request, want string }{
		{"identity", post("Transfer-Encoding: identity\r\n"), kestrel400},
		{"gzip", post("Transfer-Encoding: gzip\r\n"), kestrel400},
		{"gzip, chunked", post("Transfer-Encoding: gzip, chunked\r\n"), read},
		{"chunked, gzip", post("Transfer-Encoding: chunked, gzip\r\n"), kestrel400},
		{"upper case", post("Transfer-Encoding: CHUNKED\r\n"), read},
		{"spaces and commas", post("Transfer-Encoding:  , chunked , \r\n"), read},
		{"two lines, chunked last", post("Transfer-Encoding: gzip\r\ntransfer-encoding: chunked\r\n"), read},
		{"two lines, chunked first", post("Transfer-Encoding: chunked\r\nTransfer-Encoding: gzip\r\n"), kestrel400},
		{"an empty line after", post("Transfer-Encoding: chunked\r\nTransfer-Encoding:\r\n"), read},
		{"a comma line after", post("Transfer-Encoding: chunked\r\nTransfer-Encoding: ,\r\n"), read},
		{"tabs at the ends", post("Transfer-Encoding:\tchunked\t\r\n"), read},
		{"a tab inside", post("Transfer-Encoding: gzip,\tchunked\r\n"), kestrel400},
		{"a parameter", post("Transfer-Encoding: chunked;x\r\n"), kestrel400},
		{"quoted", post("Transfer-Encoding: \"chunked\"\r\n"), kestrel400},
		{"empty", post("Transfer-Encoding:\r\n"), kestrel400},
		{"only commas", post("Transfer-Encoding: ,\r\n"), kestrel400},
		{"a control byte in an earlier coding", post("Transfer-Encoding: g\x01zip, chunked\r\n"), read},
		{"a control byte in a dropped line", post("Transfer-Encoding: g\x01zip\r\nTransfer-Encoding: chunked\r\n"), read},
		// The rewrite must not clean bytes Kestrel refuses in any value.
		{"NUL in an earlier coding", post("Transfer-Encoding: g\x00zip, chunked\r\n"), kestrel400},
		{"NUL in a dropped line", post("Transfer-Encoding: \x00\r\nTransfer-Encoding: chunked\r\n"), kestrel400},
		{"CR in an earlier coding", post("Transfer-Encoding: g\rzip, chunked\r\n"), kestrel400},
		{"CR in a dropped line", post("Transfer-Encoding: a\rb\r\nTransfer-Encoding: chunked\r\n"), kestrel400},
		{"invalid UTF-8 in an earlier coding", post("Transfer-Encoding: g\xe9zip, chunked\r\n"), kestrel400},
		{"gzip on HTTP/1.0", "POST /h HTTP/1.0\r\nTransfer-Encoding: gzip\r\n\r\n", kestrel400},
	}
	for _, c := range cases {
		got := rawAnswer(t, address, c.request)
		if !strings.HasPrefix(c.want, "HTTP/") {
			_, got, _ = strings.Cut(got, "\r\n\r\n")
		}
		if got != c.want {
			t.Errorf("%s: got %.160q, want %q", c.name, got, c.want)
		}
	}
}

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
		if !strings.HasPrefix(line, "Date: ") && line != "Server: Kestrel" {
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

// Measured on the C# host. An absolute target's authority, as System.Uri
// prints it, must be the Host; Kestrel checks that after the headers. The
// rest it answers from the request line alone: a target that is not
// origin-form, http(s)://, or "*" is authority-form, 405 unless CONNECT
// and 400 for any byte but letters, digits and "-.:@[]".
func TestTargetFormsFollowKestrel(t *testing.T) {
	address := startHost(t, echoTarget, time.Minute)
	get := func(target, host string) string {
		return "GET " + target + " HTTP/1.1\r\nHost: " + host + "\r\nConnection: close\r\n\r\n"
	}
	const (
		ok          = "HTTP/1.1 200 OK"
		needConnect = "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\nAllow: CONNECT\r\n\r\n"
		needOptions = "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\nAllow: OPTIONS\r\n\r\n"
	)
	cases := []struct{ name, request, want string }{
		{"for another host", get("http://y/h", "x"), kestrel400},
		{"for the Host", get("http://x/h", "x"), ok},
		{"in upper case", get("http://X/h", "x"), ok},
		{"with the default port", get("http://x:80/h", "x"), ok},
		{"a Host with the default port", get("http://x/h", "x:80"), ok},
		{"both with the default port", get("http://x:80/h", "x:80"), ok},
		{"with another port", get("http://x:81/h", "x"), kestrel400},
		{"the same other port", get("http://x:81/h", "x:81"), ok},
		{"a leading-zero port", get("http://x:080/h", "x:080"), kestrel400},
		{"a leading-zero port and no port", get("http://x:080/h", "x"), ok},
		{"an empty port", get("http://x:/h", "x"), ok},
		{"port 0", get("http://x:0/h", "x:0"), ok},
		{"https on 443", get("https://x/h", "x:443"), ok},
		{"https with 443", get("https://x:443/h", "x"), ok},
		{"https on 80", get("https://x/h", "x:80"), kestrel400},
		{"a Host in upper case", get("http://x/h", "X"), kestrel400},
		{"userinfo", get("http://u:p@x/h", "x"), ok},
		{"a Host with userinfo", get("http://u@x/h", "u@x"), kestrel400},
		{"IPv6", get("http://[::1]/h", "[::1]"), ok},
		{"IPv6 in upper case", get("http://[::A]/h", "[::A]"), kestrel400},
		{"IPv6 and a port", get("http://[::1]:8080/h", "[::1]:8080"), ok},
		{"an underscore host", get("http://X_Y/h", "x_y"), ok},
		{"a trailing dot", get("http://x./h", "x."), ok},
		{"a Host with spaces around", get("http://x/h", "  x  "), ok},
		{"an upper-case scheme", get("Http://x/h", "x"), kestrel400},
		{"on HTTP/1.0 with no Host", "GET http://y/h HTTP/1.0\r\n\r\n", "HTTP/1.1 200 OK"},
		{"on HTTP/1.0 for another host", "GET http://y/h HTTP/1.0\r\nHost: x\r\n\r\n", kestrel400},
		{"a port over 65535", "GET http://x:65536/h HTTP/1.1\r\n", kestrel400},
		{"a port with a letter", "GET http://x:8a/h HTTP/1.1\r\n", kestrel400},
		{"no host", "GET http:///h HTTP/1.1\r\n", kestrel400},
		{"only the scheme", "GET http:// HTTP/1.1\r\n", kestrel400},
		{"a percent in the host", "GET http://%78/h HTTP/1.1\r\n", kestrel400},
		{"authority", "GET x:80 HTTP/1.1\r\n", needConnect},
		{"authority with every byte it takes", "POST aZ09-.:@[] HTTP/1.1\r\n", needConnect},
		{"authority with a slash", "GET a/b HTTP/1.1\r\n", kestrel400},
		{"authority with an underscore", "GET a_b HTTP/1.1\r\n", kestrel400},
		{"authority with a high byte", "GET a\xe9b HTTP/1.1\r\n", kestrel400},
		{"asterisk with GET", "GET * HTTP/1.1\r\n", needOptions},
		{"asterisk and more", "GET *x HTTP/1.1\r\n", kestrel400},
		{"asterisk with OPTIONS", "OPTIONS * HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n", ok},
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

// Measured on the C# host: the version is the rest of the request line. It
// must be 9 bytes ending in CR (the host turns on Kestrel's
// DisableHttp1LineFeedTerminators), else 400; any 8 bytes but HTTP/1.0 and
// HTTP/1.1 before the CR get 505. Kestrel answers from the line alone.
func TestTheVersionFollowsKestrel(t *testing.T) {
	address := startHost(t, echoTarget, time.Minute)
	line := func(version string) string { return "GET /h " + version + "\r\nHost: x\r\nConnection: close\r\n\r\n" }
	cases := []struct{ name, request, want string }{
		{"HTTP/1.2", line("HTTP/1.2"), kestrel505},
		{"HTTP/2.0", line("HTTP/2.0"), kestrel505},
		{"HTTP/0.9", line("HTTP/0.9"), kestrel505},
		{"lower case", line("http/1.1"), kestrel505},
		{"seven bytes and CR", line("HTTP/1."), kestrel400},
		{"eight bytes and no CR", "GET /h HTTP/1.2\nHost: x\n\n", kestrel400},
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
		{"two equal Content-Length values", "POST /h HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\ncontent-length: 2\r\n\r\nxx", kestrel400},
		{"two Content-Length values beside chunked", "POST /h HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nContent-Length: 1\r\nContent-Length: 1\r\n\r\n0\r\n\r\n", kestrel400},
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

// Measured on the C# host: Kestrel reads a chunked body on HTTP/1.0 too,
// before Content-Length. net/http ignores the codings there and would read
// the chunks as the next request.
func TestAChunkedBodyOnHTTP10IsReadAsChunked(t *testing.T) {
	var seen []string
	address := startHost(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		seen = append(seen, r.RequestURI)
		_, _ = fmt.Fprintf(w, "%s %v %q %q %q", r.Proto, r.Close, body, r.Host, r.Header.Values("Host"))
	}), time.Minute)
	inner := "GET /smuggled HTTP/1.1\r\nHost: x\r\n\r\n"
	chunks := fmt.Sprintf("%x\r\n%s\r\n0\r\n\r\n", len(inner), inner)
	cases := []struct{ name, head, close, host string }{
		{"keep-alive", "Connection: keep-alive\r\n", "false", `"" []`},
		{"no keep-alive", "", "true", `"" []`},
		{"and Content-Length", "Content-Length: 2\r\nConnection: keep-alive\r\n", "false", `"" []`},
		{"and a Host", "Host: h\r\nConnection: keep-alive\r\n", "false", `"h" []`},
		{"gzip, chunked", "Connection: keep-alive\r\nTransfer-Encoding: gzip\r\n", "false", `"" []`},
	}
	bareLF := "POST /h HTTP/1.0\r\nConnection: keep-alive\nTransfer-Encoding: chunked\r\n\r\n" + chunks
	if got := rawAnswer(t, address, bareLF); got != kestrel400 {
		t.Errorf("bare LF: got %q, want the bare 400", got)
	}
	for _, c := range cases {
		seen = nil
		request := "POST /h HTTP/1.0\r\n" + c.head + "Transfer-Encoding: chunked\r\n\r\n" + chunks + "GET /next HTTP/1.0\r\n\r\n"
		got := rawAnswer(t, address, request)
		body := fmt.Sprintf("HTTP/1.0 %s %q %s", c.close, inner, c.host)
		want := fmt.Sprintf("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: %d\r\n", len(body)) +
			"Content-Type: text/plain; charset=utf-8\r\n\r\n" + body
		if got != want || fmt.Sprint(seen) != "[/h]" {
			t.Errorf("%s: got %q after %q, want %q", c.name, got, seen, want)
		}
	}
}

// Measured on the C# host: Kestrel reads a Content-Length with one sign in
// front, "+" before any digits and "-" only before zeros. Anything else
// that is not digits gets its empty 400.
func TestContentLengthSignsFollowKestrel(t *testing.T) {
	address := startHost(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		_, _ = fmt.Fprintf(w, "%d %q %q", r.ContentLength, body, r.Header.Values("Content-Length"))
	}), time.Minute)
	cases := map[string]string{
		"+2":                    `2 "ab" ["+2"]`,
		"+02":                   `2 "ab" ["+02"]`,
		"+0":                    `0 "" ["+0"]`,
		"-0":                    `0 "" ["-0"]`,
		"-00":                   `0 "" ["-00"]`,
		" +2\t":                 `2 "ab" ["+2"]`,
		"+00000000000000000002": `2 "ab" ["+00000000000000000002"]`,
		"-0000000000000000000":  `0 "" ["-0000000000000000000"]`,
		"02":                    `2 "ab" ["02"]`,
		"-2":                    kestrel400,
		"-1":                    kestrel400,
		"+":                     kestrel400,
		"-":                     kestrel400,
		"++2":                   kestrel400,
		"+-2":                   kestrel400,
		"+ 2":                   kestrel400,
		"+\t2":                  kestrel400,
		"2+":                    kestrel400,
		"1-0":                   kestrel400,
		"9223372036854775808":   kestrel400,
		"+9223372036854775808":  kestrel400,
		"+99999999999999999999": kestrel400,
		"-99999999999999999999": kestrel400,
		"+0x2":                  kestrel400,
		"+2,2":                  kestrel400,
	}
	for value, want := range cases {
		got := rawAnswer(t, address, "POST /h HTTP/1.1\r\nHost: x\r\nContent-Length: "+value+"\r\nConnection: close\r\n\r\nab")
		if want != kestrel400 {
			_, got, _ = strings.Cut(got, "\r\n\r\n")
		}
		if got != want {
			t.Errorf("%q: got %q, want %q", value, got, want)
		}
	}
}

// Measured on the C# host: Kestrel routes a control byte or a bad escape in
// an absolute target's path (to a 404), and a control byte in its query.
// Since .NET 10.0.15 it refuses a "#" anywhere in the target.
func TestAnAbsoluteTargetRoutesItsPathAndQuery(t *testing.T) {
	router := &route.Router{}
	router.Handle("/health", nil, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = fmt.Fprintf(w, "%q %q %q", r.URL.Path, r.URL.RawQuery, r.RequestURI)
	}))
	address := startHost(t, router, time.Minute)
	cases := map[string]string{
		"http://x/health?a=1":   `"/health" "a=1" "http://x/health?a=1"`,
		"http://x/health?a\x01": `"/health" "a\x01" "http://x/health?a\x01"`,
		"http://x/health?\x7f":  `"/health" "\x7f" "http://x/health?\x7f"`,
		"http://x/health?%zz":   `"/health" "%zz" "http://x/health?%zz"`,
		"http://x/health?%23":   `"/health" "%23" "http://x/health?%23"`,
		"http://x/health#f":     kestrel400,
		"http://x/health#":      kestrel400,
		"http://x/health?a=1#f": kestrel400,
		"http://x/health#\x01":  kestrel400,
		"http://x#f":            kestrel400,
		"http://x:80#f":         kestrel400,
		"http://x":              "404",
		"http://x/hea\x01lth":   "404",
		"http://x/hea\tlth":     "404",
		"http://x/hea\rlth":     "404",
		"http://x/health\x7f":   "404",
		"http://x/health%zz":    "404",
		"http://x/hea\x00lth":   kestrel400,
		"http://x/health?a\x00": kestrel400,
		"http://x/health#a\x00": kestrel400,
		"http://x/health#\xe9":  kestrel400,
		"http://x\x01/health":   kestrel400,
		"http://u#@x/health":    kestrel400,
	}
	for target, want := range cases {
		got := rawAnswer(t, address, "GET "+target+" HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
		switch want {
		case kestrel400:
			got, want = answerStatus(got), answerStatus(want)
		case "404":
			got = strings.TrimPrefix(answerStatus(got), "HTTP/1.1 ")
		default:
			_, got, _ = strings.Cut(got, "\r\n\r\n")
		}
		if got != want && !(want == "404" && strings.HasPrefix(got, "404 ")) {
			t.Errorf("%q: got %q, want %q", target, got, want)
		}
	}
}

// Measured on the C# host with .NET 10.0.15: a "#" in any target is a 400
// from the request line alone, after the line's length and version.
func TestATargetWithAFragmentIsRefused(t *testing.T) {
	address := startHost(t, echoTarget, time.Minute)
	for request, want := range map[string]string{
		"GET /health#f HTTP/1.1\r\n":                           kestrel400,
		"GET /health?a#f HTTP/1.1\r\n":                         kestrel400,
		"GET /# HTTP/1.0\r\n":                                  kestrel400,
		"CONNECT /health#f HTTP/1.1\r\n":                       kestrel400,
		"GET /health#f HTTP/1.2\r\n":                           kestrel505,
		"GET /#" + strings.Repeat("a", 8192) + " HTTP/1.1\r\n": kestrel414,
	} {
		if got := rawAnswer(t, address, request); got != want {
			t.Errorf("%.40q: got %q, want %q", request, got, want)
		}
	}
	got := rawAnswer(t, address, "GET /health?a=%23 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
	if status := answerStatus(got); status != "HTTP/1.1 200 OK" {
		t.Errorf("an escaped mark: got %q", status)
	}
}

// Measured on the C# host: Kestrel reads a chunked body's trailer lines
// under the head's limits (lines and bytes count with the head's) and its
// grammar, except that NUL or invalid UTF-8 in a value gets a bare 500
// with no Connection line. A refusal answers the read that met it. After
// the trailer, the next head is read as any other.
func TestTrailersFollowKestrel(t *testing.T) {
	address := startHost(t, echoTarget, time.Minute)
	// The head's header block is 39 bytes and 2 lines.
	post := "POST /h HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nab\r\n0\r\n"
	const (
		read       = "read"
		kestrel500 = "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n"
	)
	cases := []struct{ name, trailer, want string }{
		{"one line", "X-T: 1\r\n\r\n", read},
		// Kestrel took these until the host turned on
		// DisableHttp1LineFeedTerminators: a proxy that reads a trailer
		// otherwise could be desynced from the host.
		{"a bare LF blank line", "X-T: 1\r\n\n", kestrel400},
		{"bare LF lines", "X-T: 1\nY: 2\n\n", kestrel400},
		{"none, ended by a bare LF", "\n", kestrel400},
		{"a quote in a name", "X\"T: 1\r\n\r\n", read},
		{"control bytes in a value", "X: a\x01\x7f\tb\r\n\r\n", read},
		{"valid UTF-8 in a value", "X: \xc3\xa9\r\n\r\n", read},
		{"an empty value", "X:\r\n\r\n", read},
		{"head fields", "Content-Length: 5\r\nTransfer-Encoding: gzip\r\nHost: a b\r\n\r\n", read},
		{"100 lines with the head's", numberedHeaders(98) + "\r\n", read},
		{"101 lines with the head's", numberedHeaders(99) + "\r\n", kestrel431},
		{"bytes at the limit with the head's", "X: " + strings.Repeat("a", 32_724) + "\r\n\r\n", read},
		{"bytes one over", "X: " + strings.Repeat("a", 32_725) + "\r\n\r\n", kestrel431},
		{"over before its line end", "X: " + strings.Repeat("a", 33_000), kestrel431},
		{"no colon", "XT\r\n\r\n", kestrel400},
		{"folded", "X: a\r\n b\r\n\r\n", kestrel400},
		{"a space first", " X: 1\r\n\r\n", kestrel400},
		{"an empty name", ": 1\r\n\r\n", kestrel400},
		{"a space before the colon", "X : 1\r\n\r\n", kestrel400},
		{"a tab in a name", "X\tY: 1\r\n\r\n", kestrel400},
		{"a high byte in a name", "X\xe9: 1\r\n\r\n", kestrel400},
		{"NUL in a name", "X\x00: 1\r\n\r\n", kestrel400},
		{"CR in a name", "X\rY: 1\r\n\r\n", kestrel400},
		{"CR in a value", "X: a\rb\r\n\r\n", kestrel400},
		{"NUL in a value", "X: a\x00b\r\n\r\n", kestrel500},
		{"invalid UTF-8 in a value", "X: a\xe9b\r\n\r\n", kestrel500},
		{"NUL before CR", "X: \x00\r\nY: a\rb\r\n\r\n", kestrel500},
		{"CR before NUL", "Y: a\rb\r\nX: \x00\r\n\r\n", kestrel400},
	}
	for _, c := range cases {
		got := rawAnswer(t, address, post+c.trailer+"GET /h HTTP/1.2\r\n")
		if c.want == read {
			if !strings.HasPrefix(got, "HTTP/1.1 200 OK\r\n") || !strings.HasSuffix(got, `"/h" "" "ab"`+kestrel505) {
				t.Errorf("%s: got %.200q", c.name, got)
			}
			continue
		}
		if got != c.want {
			t.Errorf("%s: got %.200q, want %q", c.name, got, c.want)
		}
	}
	// A body the route left is read after the answer; a refused trailer
	// then closes the connection.
	unread := startHost(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "0")
		w.WriteHeader(http.StatusUnsupportedMediaType)
	}), time.Minute)
	got := rawAnswer(t, unread, post+"XT\r\n\r\nGET /h HTTP/1.2\r\n")
	if got != "HTTP/1.1 415 Unsupported Media Type\r\nContent-Length: 0\r\n\r\n" {
		t.Errorf("an unread body: got %q", got)
	}
}

// Measured on the C# host: after an upgrade the route did not take, the
// next head is read with Kestrel's limits and grammar. A route that takes
// it gets every byte after the head as sent.
func TestHeadsAfterAnUpgradeFollowKestrel(t *testing.T) {
	address := startHost(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/take" {
			echoTarget(w, r)
			return
		}
		conn, buffered, err := http.NewResponseController(w).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		_, _ = io.WriteString(conn, "HTTP/1.1 101 Switching Protocols\r\n\r\n")
		_ = conn.SetReadDeadline(time.Now().Add(time.Second))
		got, _ := io.ReadAll(buffered)
		_, _ = fmt.Fprintf(conn, "%q", got)
	}), time.Minute)
	upgrade := func(path, headers string) string {
		return "GET " + path + " HTTP/1.1\r\nHost: x\r\n" + headers + "\r\n"
	}
	refused := "GET /h HTTP/1.2\r\n"
	cases := []struct{ name, request string }{
		{"Upgrade and Connection: upgrade", upgrade("/h", "Upgrade: foo\r\nConnection: upgrade\r\n")},
		{"Upgrade alone", upgrade("/h", "Upgrade: foo\r\n")},
		{"Connection: upgrade alone", upgrade("/h", "Connection: upgrade\r\n")},
		{"with a body", "POST /h HTTP/1.1\r\nHost: x\r\nUpgrade: foo\r\nConnection: upgrade\r\nContent-Length: 2\r\n\r\nab"},
		{"with a chunked body", "POST /h HTTP/1.1\r\nHost: x\r\nUpgrade: foo\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nab\r\n0\r\n\r\n"},
	}
	for _, c := range cases {
		got := rawAnswer(t, address, c.request+refused)
		if !strings.HasPrefix(got, "HTTP/1.1 200 OK\r\n") || !strings.HasSuffix(got, kestrel505) {
			t.Errorf("%s: got %.200q", c.name, got)
		}
	}
	// Bytes that would be a refused head, and some that are no HTTP at all.
	frames := refused + "\x00\x81\xff\r\n\r\n" + numberedHeaders(120) + "\r\n"
	got := rawAnswer(t, address, upgrade("/take", "Upgrade: websocket\r\nConnection: Upgrade\r\n")+frames)
	if want := "HTTP/1.1 101 Switching Protocols\r\n\r\n" + fmt.Sprintf("%q", frames); got != want {
		t.Errorf("a taken upgrade: got %.200q, want %.200q", got, want)
	}
}

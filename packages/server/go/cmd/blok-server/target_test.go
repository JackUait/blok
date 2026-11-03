package main

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

// Measured on the C# host: Kestrel routes every one of these targets, and
// net/http refuses each with its own 400 before any handler runs.
var unparsedTargets = []string{
	"/a%zzb", "/health%", "/health%4", "/health%%41", "/health%C3%", "/sync/d%C3%/state",
	"/health\x01", "/health\t", "/health\r", "/health\x1f", "/health\x7f", "/health\x00",
	"/health?x=\x01y", "/health?x=\x7f", "/health?x=\x00", "/a%zzb?x=\x7f", "/%zz/../health",
}

func TestRewriteSwapsOnlyWhatGoRefuses(t *testing.T) {
	cases := map[string]string{
		"/a%zzb":            "/a_zzb",
		"/a%%41":            "/a_%41",
		"/a%4":              "/a_4",
		"/a%":               "/a_",
		"/a%C3%":            "/a%C3_",
		"/a%\x01":           "/a__",
		"/a\tb\rc\x00d\x7f": "/a_b_c_d_",
		// Go does not check escapes in the query, only control bytes.
		"/a?%zz\x01%": "/a?%zz_%",
		"/a%zz?b%zz":  "/a_zz?b%zz",
		"/a%41%2F|":   "/a%41%2F|",
	}
	for original, want := range cases {
		target := []byte(original)
		swapUnparsedTargetBytes(target)
		if string(target) != want {
			t.Errorf("%q: got %q, want %q", original, target, want)
		}
	}
	// Only origin-form targets change: an authority or "*" keeps its bytes.
	for _, original := range []string{"*", "http://h/a%zz", "h:443", "a%zz"} {
		target := []byte(original)
		swapUnparsedTargetBytes(target)
		if string(target) != original {
			t.Errorf("%q changed to %q", original, target)
		}
	}
}

func FuzzRewrite(f *testing.F) {
	for _, target := range unparsedTargets {
		f.Add(target)
	}
	f.Add("/health")
	f.Add("/a%41?b=%zz")
	f.Fuzz(func(t *testing.T, original string) {
		if !strings.HasPrefix(original, "/") || strings.ContainsAny(original, " \n") {
			return
		}
		target := []byte(original)
		swapUnparsedTargetBytes(target)
		if len(target) != len(original) {
			t.Fatalf("%q: length changed to %q", original, target)
		}
		if _, err := url.ParseRequestURI(string(target)); err != nil {
			t.Fatalf("%q: the rewrite %q still fails: %v", original, target, err)
		}
		if _, err := url.ParseRequestURI(original); err == nil && string(target) != original {
			t.Fatalf("%q: Go accepts it, but it became %q", original, target)
		}
	})
}

// readAllIn reads r size bytes at a time, the way net/http's background read
// takes one byte.
func readAllIn(r io.Reader, size int) ([]byte, error) {
	var out []byte
	buffer := make([]byte, size)
	for {
		n, err := r.Read(buffer)
		out = append(out, buffer[:n]...)
		if errors.Is(err, io.EOF) {
			return out, nil
		}
		if err != nil {
			return out, err
		}
	}
}

func TestTheStreamChangesOnlyRequestLines(t *testing.T) {
	body := "GET /in-body\x01 HTTP/1.1\r\nHost: x\r\n\r\n"
	cases := []struct {
		name, in, out string
		queued        []queuedTarget
	}{{
		name: "a Content-Length body that looks like a request stays as sent",
		in: fmt.Sprintf("POST /a%%zz HTTP/1.1\r\nHost: x\r\nContent-Length: %d\r\n\r\n%s", len(body), body) +
			"GET /b\x01 HTTP/1.1\r\nHost: x\r\n\r\n",
		out: fmt.Sprintf("POST /a_zz HTTP/1.1\r\nHost: x\r\nContent-Length: %d\r\n\r\n%s", len(body), body) +
			"GET /b_ HTTP/1.1\r\nHost: x\r\n\r\n",
		queued: []queuedTarget{{"/a_zz", "/a%zz"}, {"/b_", "/b\x01"}},
	}, {
		name:   "net/http drops up to four CR or LF after a POST",
		in:     "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\n\r\nz\r\n\r\nGET /c%zz HTTP/1.1\r\nHost: x\r\n\r\n",
		out:    "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\n\r\nz\r\n\r\nGET /c_zz HTTP/1.1\r\nHost: x\r\n\r\n",
		queued: []queuedTarget{{"/", "/"}, {"/c_zz", "/c%zz"}},
	}, {
		name:   "only after a POST",
		in:     "GET / HTTP/1.1\r\nHost: x\r\n\r\n\r\nGET /c%zz HTTP/1.1\r\n\r\n",
		out:    "GET / HTTP/1.1\r\nHost: x\r\n\r\n\r\nGET /c%zz HTTP/1.1\r\n\r\n",
		queued: []queuedTarget{{"/", "/"}, {"", ""}},
	}, {
		name:   "a chunked body ends the rewriting",
		in:     "POST /a\x01 HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n3\r\n\x01\x01\x01\r\n0\r\n\r\nGET /b\x01 HTTP/1.1\r\n\r\n",
		out:    "POST /a_ HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n3\r\n\x01\x01\x01\r\n0\r\n\r\nGET /b\x01 HTTP/1.1\r\n\r\n",
		queued: []queuedTarget{{"/a_", "/a\x01"}},
	}, {
		name:   "an upgrade ends the rewriting",
		in:     "GET /s\x01 HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nGET /b\x01 HTTP/1.1\r\n\r\n",
		out:    "GET /s_ HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nGET /b\x01 HTTP/1.1\r\n\r\n",
		queued: []queuedTarget{{"/s_", "/s\x01"}},
	}, {
		name:   "HTTP/2 prior knowledge passes through",
		in:     "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n\x00\x00\x12\x04\x00\x01\x01",
		out:    "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n\x00\x00\x12\x04\x00\x01\x01",
		queued: []queuedTarget{{"*", "*"}},
	}, {
		name:   "a head net/http cannot read ends the rewriting",
		in:     "GET /a\x01 HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\nGET /b\x01 HTTP/1.1\r\n\r\n",
		out:    "GET /a_ HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\nGET /b\x01 HTTP/1.1\r\n\r\n",
		queued: []queuedTarget{{"/a_", "/a\x01"}},
	}, {
		name:   "bare LF line ends, and a CR inside the target",
		in:     "GET /a\rb HTTP/1.1\nHost: x\n\nGET /c%zz HTTP/1.1\r\n\r\n",
		out:    "GET /a_b HTTP/1.1\nHost: x\n\nGET /c_zz HTTP/1.1\r\n\r\n",
		queued: []queuedTarget{{"/a_b", "/a\rb"}, {"/c_zz", "/c%zz"}},
	}}
	for _, c := range cases {
		for _, size := range []int{1, 3, 4096} {
			stream := &targetStream{src: strings.NewReader(c.in)}
			got, err := readAllIn(stream, size)
			if err != nil || string(got) != c.out {
				t.Errorf("%s (reads of %d): got %q %v, want %q", c.name, size, got, err, c.out)
			}
			var queued []queuedTarget
			for {
				entry, ok := stream.pop()
				if !ok {
					break
				}
				queued = append(queued, entry)
			}
			if fmt.Sprint(queued) != fmt.Sprint(c.queued) {
				t.Errorf("%s (reads of %d): queued %q, want %q", c.name, size, queued, c.queued)
			}
		}
	}
}

// A head larger than net/http reads passes as sent, so net/http still
// answers 431 for it.
func TestAnOversizedHeadPassesThrough(t *testing.T) {
	in := "GET /a\x01 HTTP/1.1\r\nX: " + strings.Repeat("v", maxRequestHead) + "\r\n\r\nGET /b\x01 HTTP/1.1\r\n\r\n"
	got, err := readAllIn(&targetStream{src: strings.NewReader(in)}, 4096)
	if err != nil || string(got) != strings.Replace(in, "/a\x01", "/a_", 1) {
		t.Fatalf("got %d bytes %v", len(got), err)
	}
	long := "GET /a\x01" + strings.Repeat("v", maxRequestHead) + " HTTP/1.1\r\n\r\n"
	if got, _ := readAllIn(&targetStream{src: strings.NewReader(long)}, 4096); string(got) != long {
		t.Fatal("an oversized request line changed")
	}
}

type timeoutError struct{}

func (timeoutError) Error() string   { return "i/o timeout" }
func (timeoutError) Timeout() bool   { return true }
func (timeoutError) Temporary() bool { return true }

// stutter returns its parts one Read at a time, with a timeout between them.
type stutter struct{ parts []string }

func (s *stutter) Read(p []byte) (int, error) {
	if len(s.parts) == 0 {
		return 0, io.EOF
	}
	part := s.parts[0]
	s.parts = s.parts[1:]
	if part == "" {
		return 0, timeoutError{}
	}
	return copy(p, part), nil
}

// net/http aborts its background read with a past deadline. The error must
// reach it as a timeout, and the half line must survive it.
func TestATimeoutKeepsAHalfReadLine(t *testing.T) {
	stream := &targetStream{src: &stutter{parts: []string{"GET /a", "", "%zz HTTP/1.1\r\n\r\n"}}}
	buffer := make([]byte, 64)
	n, err := stream.Read(buffer)
	var netErr net.Error
	if n != 0 || !errors.As(err, &netErr) || !netErr.Timeout() {
		t.Fatalf("first read: %d %v", n, err)
	}
	got, err := readAllIn(stream, 64)
	if err != nil || string(got) != "GET /a_zz HTTP/1.1\r\n\r\n" {
		t.Fatalf("got %q %v", got, err)
	}
}

func TestAStreamEndingMidLineHandsOverWhatItHas(t *testing.T) {
	got, err := readAllIn(&targetStream{src: strings.NewReader("GET /a\x01 HTTP/1.1")}, 64)
	if err != nil || string(got) != "GET /a\x01 HTTP/1.1" {
		t.Fatalf("got %q %v", got, err)
	}
}

// echoTarget answers with what the router reads: the target and the query.
var echoTarget = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	_, _ = fmt.Fprintf(w, "%q %q %q", r.RequestURI, r.URL.RawQuery, body)
})

func startHost(t *testing.T, handler http.Handler, headerLimit time.Duration) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := newHTTPServer(handler, time.Minute)
	go func() { _ = server.Serve(headerListener{listener, headerLimit, time.Minute}) }()
	t.Cleanup(func() { _ = server.Close() })
	return listener.Addr().String()
}

func pipeline(t *testing.T, address, request string) []string {
	t.Helper()
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, _ = io.WriteString(conn, request)
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	reader := bufio.NewReader(conn)
	var bodies []string
	for {
		response, err := http.ReadResponse(reader, nil)
		if err != nil {
			return bodies
		}
		body, _ := io.ReadAll(response.Body)
		bodies = append(bodies, fmt.Sprintf("%d %s", response.StatusCode, body))
	}
}

func TestTheHandlerSeesTheTargetAsSentOnAKeptAliveConnection(t *testing.T) {
	address := startHost(t, echoTarget, time.Minute)
	got := pipeline(t, address, "POST /a%zz?q=%zz\x01 HTTP/1.1\r\nHost: x\r\nContent-Length: 4\r\n\r\n\x01%zz"+
		"GET /b\x01/../c HTTP/1.1\r\nHost: x\r\n\r\n"+
		"GET /plain?x=1 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
	want := []string{
		`200 "/a%zz?q=%zz\x01" "q=%zz\x01" "\x01%zz"`,
		`200 "/b\x01/../c" "" ""`,
		`200 "/plain?x=1" "x=1" ""`,
	}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("got %q\nwant %q", got, want)
	}
}

// A request the rewriter never saw must not take another one's target.
func TestATargetThatDoesNotMatchTheQueueIsRefused(t *testing.T) {
	stream := &targetStream{}
	stream.push(queuedTarget{sent: "/other", original: "/other\x01"})
	request, _ := http.NewRequest("GET", "http://x/mine", nil)
	request.RequestURI = "/mine"
	recorder := &headerRecorder{header: http.Header{}}
	if restoreTarget(recorder, request, stream) {
		t.Fatal("a mismatched request was routed")
	}
	if recorder.status != 400 || recorder.header.Get("Content-Length") != "0" || recorder.header.Get("Connection") != "close" {
		t.Fatalf("got %d %v", recorder.status, recorder.header)
	}
}

type headerRecorder struct {
	header http.Header
	status int
}

func (r *headerRecorder) Header() http.Header         { return r.header }
func (r *headerRecorder) Write(p []byte) (int, error) { return len(p), nil }
func (r *headerRecorder) WriteHeader(status int)      { r.status = status }

// The header clock arms on raw bytes, so a request line held back for its
// end still gets the 408.
func TestAHeldBackRequestLineStillGets408(t *testing.T) {
	address := startHost(t, echoTarget, 200*time.Millisecond)
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, _ = io.WriteString(conn, "GET /a\x01")
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	answer, _ := io.ReadAll(conn)
	if !strings.HasPrefix(string(answer), "HTTP/1.1 408 Request Timeout\r\n") {
		t.Fatalf("got %q", answer)
	}
}

// Swapping keeps the length, so the head limit is the same for every target.
func TestTheHeadLimitIsTheSameForAnUnparsedTarget(t *testing.T) {
	address := startHost(t, echoTarget, time.Minute)
	for _, size := range []struct {
		padding int
		status  string
	}{{http.DefaultMaxHeaderBytes, "200 "}, {maxRequestHead, "431 "}} {
		padding := strings.Repeat("v", size.padding)
		for _, target := range []string{"/plain", "/a%zzz"} {
			got := pipeline(t, address, "GET "+target+" HTTP/1.1\r\nHost: x\r\nConnection: close\r\nX: "+padding+"\r\n\r\n")
			if len(got) != 1 || !strings.HasPrefix(got[0], size.status) {
				t.Errorf("%s with %d bytes: got %.40q, want %s", target, size.padding, got, size.status)
			}
		}
	}
}

// FuzzTheStreamFollowsNetHTTP reads the rewritten stream the way net/http's
// conn loop does. Every request it parses must match the queue in order, and
// every changed byte must sit on one of those request lines.
func FuzzTheStreamFollowsNetHTTP(f *testing.F) {
	f.Add("POST /a%zz HTTP/1.1\r\nContent-Length: 5\r\n\r\nG\x01T \r\n\r\nGET /b\x01 HTTP/1.1\r\n\r\n")
	f.Add("GET /a HTTP/1.1\r\nUpgrade: x\r\n\r\nGET /b\x01 HTTP/1.1\r\n\r\n")
	f.Add("POST /c HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n1\r\n\x01\r\n0\r\n\r\nGET /d%zz HTTP/1.1\r\n\r\n")
	f.Add("GET /e%4 HTTP/1.0\nContent-Length: 2\n\n%zGET /f\t HTTP/1.1\n\n")
	f.Add(" /% \n")
	f.Fuzz(func(t *testing.T, in string) {
		stream := &targetStream{src: strings.NewReader(in)}
		out, err := readAllIn(stream, 7)
		if err != nil || len(out) != len(in) {
			t.Fatalf("%q: %d bytes, %v", in, len(out), err)
		}
		source := bytes.NewReader(out)
		reader := bufio.NewReader(source)
		consumed := func() int { return len(out) - source.Len() - reader.Buffered() }
		onLine := make([]bool, len(out))
		// net/http closes the connection on the first head it refuses, so
		// nothing from there on is read as HTTP.
		stop := len(out)
		lastPost := false
		for {
			if lastPost {
				peek, _ := reader.Peek(4)
				for _, b := range peek {
					if b != '\r' && b != '\n' {
						break
					}
					_, _ = reader.ReadByte()
				}
			}
			start := consumed()
			request, err := http.ReadRequest(reader)
			if err != nil {
				stop = start
				break
			}
			end := start + bytes.IndexByte(out[start:], '\n')
			for i := start; i <= end; i++ {
				onLine[i] = true
			}
			entry, ok := stream.pop()
			if !ok || entry.sent != request.RequestURI {
				t.Fatalf("%q: net/http read %q, the queue had %q", in, request.RequestURI, entry.sent)
			}
			if request.Method == "CONNECT" || request.Method == "PRI" || len(request.TransferEncoding) > 0 ||
				request.Header.Get("Upgrade") != "" || strings.Contains(strings.ToLower(request.Header.Get("Connection")), "upgrade") {
				break
			}
			if _, err := io.Copy(io.Discard, request.Body); err != nil {
				break
			}
			lastPost = request.Method == "POST"
		}
		for i := range out {
			if out[i] != in[i] && !onLine[i] && i < stop {
				t.Fatalf("%q: byte %d changed off a request line: %q", in, i, out)
			}
		}
	})
}

// net/http's one-byte background read takes the next request's first byte
// while a handler runs. The rest of its line comes later.
func TestARequestLineThatTricklesInDuringAHandler(t *testing.T) {
	address := startHost(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.RequestURI == "/slow" {
			time.Sleep(300 * time.Millisecond)
		}
		echoTarget(w, r)
	}), time.Minute)
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, _ = io.WriteString(conn, "GET /slow HTTP/1.1\r\nHost: x\r\n\r\nG")
	time.Sleep(100 * time.Millisecond)
	_, _ = io.WriteString(conn, "ET /b%")
	time.Sleep(100 * time.Millisecond)
	_, _ = io.WriteString(conn, "zz\x01 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	answer, _ := io.ReadAll(conn)
	if !strings.Contains(string(answer), `"/slow"`) || !strings.Contains(string(answer), `"/b%zz\x01"`) {
		t.Fatalf("got %q", answer)
	}
}

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
	"runtime"
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
// readAllIn reads r to its end. A stream waiting after an upgrade is
// handed over as a hijack would.
func readAllIn(r io.Reader, size int) ([]byte, error) {
	var out []byte
	buffer := make([]byte, size)
	for {
		n, err := r.Read(buffer)
		out = append(out, buffer[:n]...)
		if stream, ok := r.(*targetStream); ok && errors.Is(err, io.EOF) && stream.state == streamWait {
			stream.pass()
			continue
		}
		if errors.Is(err, io.EOF) {
			return out, nil
		}
		if err != nil {
			return out, err
		}
	}
}

func TestTheStreamChangesOnlyHeads(t *testing.T) {
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
		name:   "CR and LF before a request line are dropped, as Kestrel skips them",
		in:     "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\n\r\nz\r\n\r\n\r\nGET /c%zz HTTP/1.1\r\nHost: x\r\n\r\n",
		out:    "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\n\r\nzGET /c_zz HTTP/1.1\r\nHost: x\r\n\r\n",
		queued: []queuedTarget{{"/", "/"}, {"/c_zz", "/c%zz"}},
	}, {
		name:   "after any request",
		in:     "GET / HTTP/1.1\r\nHost: x\r\n\r\n\r\n\nGET /c%zz HTTP/1.1\r\nHost: x\r\n\r\n",
		out:    "GET / HTTP/1.1\r\nHost: x\r\n\r\nGET /c_zz HTTP/1.1\r\nHost: x\r\n\r\n",
		queued: []queuedTarget{{"/", "/"}, {"/c_zz", "/c%zz"}},
	}, {
		name:   "header bytes Kestrel takes and net/http refuses",
		in:     "GET / HTTP/1.1\r\nHost: x\r\nX\"y: a\x01b\x7f\r\n\r\n",
		out:    "GET / HTTP/1.1\r\nHost: x\r\nX_y: a_b_\r\n\r\n",
		queued: []queuedTarget{{"/", "/"}},
	}, {
		name: "heads after a chunked body are still read",
		in: "POST /a\x01 HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n3\r\n\x01\x01\x01\r\n" +
			"2;e=GET /c\x01 \t\r\n\r\n\r\n0\r\n\r\nGET /b\x01 HTTP/1.1\r\nHost: x\r\n\r\n",
		// The extension is dropped: Kestrel reads it as it comes.
		out: "POST /a_ HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n3\r\n\x01\x01\x01\r\n" +
			"2\r\n\r\n\r\n0\r\n\r\nGET /b_ HTTP/1.1\r\nHost: x\r\n\r\n",
		queued: []queuedTarget{{"/a_", "/a\x01"}, {"/b_", "/b\x01"}},
	}, {
		name:   "a trailer is checked and dropped, and the next head checked",
		in:     "POST /a HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n0\r\nX: y\r\n\r\nGET /b\x01 HTTP/1.1\r\nHost: x\r\n\r\n",
		out:    "POST /a HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\nGET /b_ HTTP/1.1\r\nHost: x\r\n\r\n",
		queued: []queuedTarget{{"/a", "/a"}, {"/b_", "/b\x01"}},
	}, {
		name:   "a chunk line Kestrel refuses ends the body",
		in:     "POST /a HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n1\nx\r\n0\r\n\r\nGET /b\x01 HTTP/1.1\r\n\r\n",
		out:    "POST /a HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n",
		queued: []queuedTarget{{"/a", "/a"}},
	}, {
		name:   "a taken upgrade hands on what follows",
		in:     "GET /s\x01 HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nGET /b\x01 HTTP/1.1\r\n\r\n",
		out:    "GET /s_ HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nGET /b\x01 HTTP/1.1\r\n\r\n",
		queued: []queuedTarget{{"/s_", "/s\x01"}},
	}, {
		name:   "a transfer coding Kestrel refuses gets the stand-in",
		in:     "POST /a\x01 HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: gzip\r\n\r\nGET /b\x01 HTTP/1.1\r\n\r\n",
		out:    standIn,
		queued: []queuedTarget{{"/", "/"}},
	}, {
		name:   "codings Kestrel takes become one chunked line",
		in:     "POST /a HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: g\x01zip\r\ntransfer-encoding: x, chunked ,\r\n\r\n0\r\n\r\n",
		out:    "POST /a HTTP/1.1\r\nHost: x\r\nX-Blok-Dropped-Te:      \r\ntransfer-encoding:chunked      \r\n\r\n0\r\n\r\n",
		queued: []queuedTarget{{"/a", "/a"}},
	}, {
		name:   "HTTP/2 prior knowledge gets the stand-in",
		in:     "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n\x00\x00\x12\x04\x00\x01\x01",
		out:    standIn,
		queued: []queuedTarget{{"/", "/"}},
	}, {
		name:   "a head net/http cannot read gets the stand-in",
		in:     "GET /a\x01 HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\nGET /b\x01 HTTP/1.1\r\n\r\n",
		out:    standIn,
		queued: []queuedTarget{{"/", "/"}},
	}, {
		name:   "bare LF line ends, and a CR inside the target",
		in:     "GET /a\rb HTTP/1.1\nHost: x\n\nGET /c%zz HTTP/1.1\r\nHost: x\r\n\r\n",
		out:    "GET /a_b HTTP/1.1\nHost: x\n\nGET /c_zz HTTP/1.1\r\nHost: x\r\n\r\n",
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
				queued = append(queued, entry.queuedTarget)
			}
			if fmt.Sprint(queued) != fmt.Sprint(c.queued) {
				t.Errorf("%s (reads of %d): queued %q, want %q", c.name, size, queued, c.queued)
			}
		}
	}
}

// After an upgrade the route did not take, what follows is read as a head.
func TestAnUpgradeNotTakenReadsTheNextHead(t *testing.T) {
	in := "GET /s HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\n\r\nGET /b\x01 HTTP/1.1\r\nHost: x\r\n\r\n"
	stream := &targetStream{src: &stutter{parts: []string{in, ""}}}
	got := readMarkingTimeouts(t, stream, 4096)
	stream.resume()
	rest, err := readAllIn(stream, 4096)
	if err != nil {
		t.Fatal(err)
	}
	want := "GET /s HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\n\r\n<T>"
	if got != want || string(rest) != "GET /b_ HTTP/1.1\r\nHost: x\r\n\r\n" {
		t.Fatalf("got %q then %q", got, rest)
	}
	if queued := queuedSent(stream); fmt.Sprint(queued) != "[/s /b_]" {
		t.Fatalf("queued %q", queued)
	}
}

// A head over Kestrel's limits is never handed on: net/http reads the
// stand-in, and its entry carries the refusal.
func TestAHeadOverTheLimitsBecomesTheStandIn(t *testing.T) {
	cases := map[string]int{
		"GET /a HTTP/1.1\r\nHost: x\r\nX: " + strings.Repeat("v", maxHeaderBlock) + "\r\n\r\nGET /b HTTP/1.1\r\n\r\n": 431,
		"GET /a\x01" + strings.Repeat("v", maxRequestLine) + " HTTP/1.1\r\n\r\n":                                      414,
		"GET /a HTTP/1.1\r\nHost: x\r\nX-A: \xff\r\n\r\n":                                                             400,
	}
	for in, status := range cases {
		stream := &targetStream{src: strings.NewReader(in)}
		got, err := readAllIn(stream, 4096)
		if err != nil || string(got) != standIn {
			t.Errorf("%.30q: got %.60q %v", in, got, err)
		}
		if entry, ok := stream.pop(); !ok || entry.reject != status {
			t.Errorf("%.30q: queued %+v, want a %d refusal", in, entry, status)
		}
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
	n := copy(p, part)
	if n < len(part) {
		s.parts = append([]string{part[n:]}, s.parts...)
	}
	return n, nil
}

// net/http aborts its background read with a past deadline. The error must
// reach it as a timeout, and the half line must survive it.
func TestATimeoutKeepsAHalfReadLine(t *testing.T) {
	stream := &targetStream{src: &stutter{parts: []string{"GET /a", "", "%zz HTTP/1.1\r\nHost: x\r\n\r\n"}}}
	buffer := make([]byte, 64)
	n, err := stream.Read(buffer)
	var netErr net.Error
	if n != 0 || !errors.As(err, &netErr) || !netErr.Timeout() {
		t.Fatalf("first read: %d %v", n, err)
	}
	got, err := readAllIn(stream, 64)
	if err != nil || string(got) != "GET /a_zz HTTP/1.1\r\nHost: x\r\n\r\n" {
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
	stream.push(queuedRequest{queuedTarget: queuedTarget{sent: "/other", original: "/other\x01"}})
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

// FuzzTheStreamFollowsNetHTTP checks the stream on input it reads whole.
func FuzzTheStreamFollowsNetHTTP(f *testing.F) {
	f.Add("POST /a%zz HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nG\x01T \r\n\r\nGET /b\x01 HTTP/1.1\r\nHost: x\r\n\r\n")
	f.Add("GET /a HTTP/1.1\r\nHost: x\r\nUpgrade: x\r\n\r\nGET /b\x01 HTTP/1.1\r\n\r\n")
	f.Add("POST /c HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n1\r\n\x01\r\n0\r\n\r\nGET /d%zz HTTP/1.1\r\n\r\n")
	f.Add("POST /c HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: g\x01\r\ntransfer-encoding: x, chunked\r\n\r\n1\r\n\x01\r\n0\r\n\r\nGET /d%zz HTTP/1.1\r\n\r\n")
	f.Add("POST /c HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n2;a=b \t\r\n\r\n\r\nA\r\nGET /x HTTP\r\n0\r\n\r\nGET /d%zz HTTP/1.1\r\nHost: x\r\n\r\n")
	f.Add("POST /c HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n0\r\nT: 1\r\n\r\nGET /d%zz HTTP/1.1\r\nHost: x\r\n\r\n")
	f.Add("POST /c HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n0\r\nT\"\x01: 1\nU: \xc3\xa9\n\nGET /d%zz HTTP/1.1\r\nHost: x\r\n\r\n")
	f.Add("POST /c HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n0\r\nT: \x00\r\n\r\nGET /d HTTP/1.1\r\nHost: x\r\n\r\n")
	f.Add("GET /e%4 HTTP/1.0\nContent-Length: 2\nX\"\x01: \x7f\n\n%zGET /f\t HTTP/1.1\nHost: x\n\n")
	f.Add("\r\nGET / HTTP/1.1\r\nHost: x\r\nX: \xe9\r\n\r\n")
	f.Add(" /% \n")
	f.Add("POST /a HTTP/1.0\r\nConnection: keep-alive\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nGET /\r\n0\r\n\r\nGET /b%zz HTTP/1.0\r\n\r\n")
	f.Add("POST /a HTTP/1.0\nHost: h\nContent-Length: 3\nTransfer-Encoding: chunked\n\n1\r\nG\r\n0\r\n\r\nGET /b%zz HTTP/1.0\n\n")
	f.Add("POST /a HTTP/1.1\r\nHost: x\r\nexpect: 100-continue\r\nExpect: f\x01\r\nContent-Length: 1\r\n\r\naGET /b%zz HTTP/1.1\r\nHost: x\r\n\r\n")
	f.Add("GET http://x/a%zz\x01#b%\x00 HTTP/1.1\r\nHost: x\r\n\r\nGET http://x#f HTTP/1.1\r\nHost: x\r\n\r\n")
	f.Add("POST /a HTTP/1.1\r\nHost: x\r\nContent-Length: +2\r\n\r\nabGET /b%zz HTTP/1.1\r\nHost: x\r\nContent-Length: -00\r\n\r\n")
	f.Fuzz(func(t *testing.T, in string) {
		stream := &targetStream{src: strings.NewReader(in)}
		out, err := readAllIn(stream, 7)
		if err != nil {
			t.Fatalf("%q: %v", in, err)
		}
		checkTheStreamFollowsNetHTTP(t, in, out, stream)
	})
}

// FuzzTheStreamFollowsNetHTTPThroughTimeouts cuts the input into pieces with
// a timeout after each, the way net/http aborts its background read.
func FuzzTheStreamFollowsNetHTTPThroughTimeouts(f *testing.F) {
	f.Add("POST /a%zz HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nG\x01T \r\n\r\nGET /b\x01 HTTP/1.1\r\nHost: x\r\n\r\n", []byte{30, 5, 2}, uint8(7))
	f.Add("GET /a HTTP/1.1\r\nHost: x\r\n\r\nGET /b%zz HTTP/1.1\r\nHost: x\r\nX: y\r\n\r\n", []byte{3, 17, 1}, uint8(1))
	f.Add("POST /c HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\n\r\nz\r\nGET /d%zz HTTP/1.1\r\nHost: x\r\n\r\n", []byte{40, 1}, uint8(3))
	f.Add("POST /c HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n3;e\r\nabc\r\n0\r\n\r\nGET /d%zz HTTP/1.1\r\nHost: x\r\n\r\n", []byte{52, 2, 3, 1}, uint8(2))
	f.Add("POST /000 HTTP/0.0\r\nContent-Length:07 \n\r\n0000000\n0 * HTTP/0.0\n\n", []byte("00"), uint8(7))
	f.Add("0 * HTTP/0.0\n\n0 * HTTP/0.0\n\n", []byte("0"), uint8(1))
	f.Fuzz(func(t *testing.T, in string, cuts []byte, size uint8) {
		var pieces []string
		rest := in
		for _, c := range cuts {
			if n := int(c); n > 0 && n < len(rest) {
				pieces, rest = append(pieces, rest[:n], ""), rest[n:]
			}
		}
		if rest != "" {
			pieces = append(pieces, rest)
		}
		stream := &targetStream{src: &stutter{parts: pieces}}
		var out []byte
		buffer := make([]byte, max(int(size), 1))
		for {
			n, err := stream.Read(buffer)
			out = append(out, buffer[:n]...)
			if errors.Is(err, io.EOF) && stream.state == streamWait {
				stream.pass()
				continue
			}
			if errors.Is(err, io.EOF) {
				break
			}
			if err != nil && !isTimeout(err) {
				t.Fatalf("%q: %v", in, err)
			}
		}
		checkTheStreamFollowsNetHTTP(t, in, out, stream)
	})
}

// checkTheStreamFollowsNetHTTP reads out the way net/http's conn loop does.
// Every request it parses must match the queue in order. A refusal must be
// the stand-in, and the last thing out. Otherwise, with nothing dropped,
// every changed byte must sit on one of those request lines or be a header
// byte only Kestrel takes, swapped for '_'.
func checkTheStreamFollowsNetHTTP(t *testing.T, in string, out []byte, stream *targetStream) {
	t.Helper()
	refused := stream.state == streamDone
	// A refused trailer ends the body read instead of a stand-in.
	if refused && stream.bodyRefusal == 0 && !bytes.HasSuffix(out, []byte(standIn)) {
		t.Fatalf("%q: refused, but out is %q", in, out)
	}
	whole := !refused && stream.dropped == 0 && stream.added == 0
	if whole && len(out) != len(in) {
		t.Fatalf("%q: %d bytes out", in, len(out))
	}
	source := bytes.NewReader(out)
	reader := bufio.NewReader(source)
	consumed := func() int { return len(out) - source.Len() - reader.Buffered() }
	onLine := make([]bool, len(out))
	// net/http closes the connection on the first head it refuses, so
	// nothing from there on is read as HTTP.
	stop := len(out)
	for {
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
		if entry.reject != 0 {
			if consumed() != len(out) {
				t.Fatalf("%q: bytes after the stand-in: %q", in, out)
			}
			break
		}
		if request.Method == "CONNECT" || request.Method == "PRI" || request.ProtoMajor != 1 ||
			request.Header.Get("Upgrade") != "" || strings.Contains(strings.ToLower(request.Header.Get("Connection")), "upgrade") {
			break
		}
		if _, err := io.Copy(io.Discard, request.Body); err != nil {
			break
		}
		// The stream may give up on a chunked body (a trailer, a long
		// line); then nothing after it is queued. If it followed the body,
		// the next request must match the queue.
		if len(request.TransferEncoding) > 0 && stream.state == streamPass && len(stream.queued) == 0 {
			stop = consumed()
			break
		}
	}
	if !whole {
		return
	}
	for i := range out {
		if out[i] == in[i] || onLine[i] || i >= stop {
			continue
		}
		// takeCodings rewrites whole Transfer-Encoding lines.
		lineStart := strings.LastIndexByte(in[:i], '\n') + 1
		if len(in)-lineStart > 17 && strings.EqualFold(in[lineStart:lineStart+18], "Transfer-Encoding:") {
			continue
		}
		// An Expect line is renamed to hiddenExpect.
		if i-lineStart < len(hiddenExpect) && len(in)-lineStart > 6 && strings.EqualFold(in[lineStart:lineStart+7], "Expect:") {
			continue
		}
		// signedLength turns a Content-Length's sign into a zero.
		if out[i] == '0' && (in[i] == '+' || in[i] == '-') && len(in)-lineStart > 14 &&
			strings.EqualFold(in[lineStart:lineStart+15], "Content-Length:") {
			continue
		}
		if out[i] != '_' || !kestrelOnlyNameByte(in[i]) && !kestrelOnlyValueByte(in[i]) {
			t.Fatalf("%q: byte %d changed off a request line: %q", in, i, out)
		}
	}
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

// readMarkingTimeouts reads r size bytes at a time and writes "<T>" where a
// read returned a timeout.
func readMarkingTimeouts(t *testing.T, r io.Reader, size int) string {
	t.Helper()
	var out strings.Builder
	buffer := make([]byte, size)
	for {
		n, err := r.Read(buffer)
		out.Write(buffer[:n])
		var netErr net.Error
		switch {
		case errors.Is(err, io.EOF):
			return out.String()
		case errors.As(err, &netErr) && netErr.Timeout():
			out.WriteString("<T>")
		case err != nil:
			t.Fatalf("after %q: %v", out.String(), err)
		}
	}
}

func queuedSent(stream *targetStream) []string {
	var sent []string
	for {
		entry, ok := stream.pop()
		if !ok {
			return sent
		}
		sent = append(sent, entry.sent)
	}
}

// net/http aborts its background read after a POST with a timeout. That is
// not the end of input: the CR/LF after the POST may still come, and must be
// dropped, not queued as a request line of its own.
func TestATimeoutAfterAPostStillDropsTheCRLF(t *testing.T) {
	post := "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\n\r\nz"
	cases := []struct {
		name  string
		parts []string
	}{
		{"timeout before the CRLF", []string{post, "", "\r\nGET /c%zz HTTP/1.1\r\nHost: x\r\n\r\n"}},
		{"timeout inside the CRLF", []string{post, "\r", "", "\nGET /c%zz HTTP/1.1\r\nHost: x\r\n\r\n"}},
	}
	want := post + "<T>GET /c_zz HTTP/1.1\r\nHost: x\r\n\r\n"
	for _, c := range cases {
		for _, size := range []int{1, 3, 64} {
			stream := &targetStream{src: &stutter{parts: append([]string(nil), c.parts...)}}
			got := readMarkingTimeouts(t, stream, size)
			if queued := queuedSent(stream); fmt.Sprint(queued) != "[/ /c_zz]" {
				t.Errorf("%s, reads of %d: queued %q", c.name, size, queued)
			}
			if got != want {
				t.Errorf("%s, reads of %d: got %q", c.name, size, got)
			}
		}
	}
}

// dribble is a request line that never ends, one byte per Read.
type dribble struct{ left int }

func (d *dribble) Read(p []byte) (int, error) {
	if d.left == 0 {
		return 0, io.EOF
	}
	d.left--
	p[0] = 'a'
	return 1, nil
}

func readDribbledLine(size int) {
	stream := &targetStream{src: io.MultiReader(strings.NewReader("GET /"), &dribble{left: size})}
	_, _ = io.Copy(io.Discard, stream)
}

// A line that comes a byte at a time costs no buffer per read.
func TestASlowLineDoesNotAllocatePerRead(t *testing.T) {
	if allocs := testing.AllocsPerRun(3, func() { readDribbledLine(4096) }); allocs > 100 {
		t.Fatalf("%v allocations for a 4096-byte line in 1-byte reads", allocs)
	}
}

// A line that comes a byte at a time is scanned once, not on every read.
func TestASlowLineCostsLinearTime(t *testing.T) {
	fastest := func(size int) time.Duration {
		best := time.Duration(1 << 62)
		for i := 0; i < 3; i++ {
			start := time.Now()
			readDribbledLine(size)
			best = min(best, time.Since(start))
		}
		return best
	}
	// Linear is 16x, quadratic 256x.
	small, big := fastest(32<<10), fastest(512<<10)
	if ratio := float64(big) / float64(small); ratio > 64 {
		t.Fatalf("16x the line took %.0fx the time (%v vs %v)", ratio, big, small)
	}
}

// An idle keep-alive connection must not hold on to the buffers of a big
// head it already handed on.
func TestAnIdleStreamDropsABigHeadsBuffers(t *testing.T) {
	heapInUse := func() uint64 {
		runtime.GC()
		var stats runtime.MemStats
		runtime.ReadMemStats(&stats)
		return stats.HeapAlloc
	}
	cases := map[string]string{
		"a head at the limit":   "GET /a HTTP/1.1\r\nHost: x\r\nX: " + strings.Repeat("v", maxHeaderBlock-16) + "\r\n\r\n",
		"a head over the limit": "GET /a HTTP/1.1\r\nHost: x\r\nX: " + strings.Repeat("v", maxHeaderBlock) + "\r\n\r\n",
	}
	for name, input := range cases {
		const streams = 16
		before := heapInUse()
		held := make([]*targetStream, streams)
		for i := range held {
			held[i] = &targetStream{src: &stutter{parts: []string{input, ""}}}
			want := len(input) + len("<T>")
			if strings.Contains(name, "over") {
				// Refused: the stand-in, then the end.
				want = len(standIn)
			}
			if got := readMarkingTimeouts(t, held[i], 4096); len(got) != want {
				t.Fatalf("%s: read %d bytes", name, len(got))
			}
		}
		after := heapInUse()
		runtime.KeepAlive(held)
		if retained := int64(after) - int64(before); retained > streams*64<<10 {
			t.Errorf("%s: %d idle streams retain %d KiB", name, streams, retained>>10)
		}
	}
}

// End to end: net/http's abort lands between the POST and its CRLF.
func TestACRLFAfterAPostOnAKeptAliveConnection(t *testing.T) {
	address := startHost(t, echoTarget, time.Minute)
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	reader := bufio.NewReader(conn)
	_, _ = io.WriteString(conn, "POST /p HTTP/1.1\r\nHost: x\r\nContent-Length: 4\r\n\r\nabcd")
	response, err := http.ReadResponse(reader, nil)
	if err != nil || response.StatusCode != 200 {
		t.Fatalf("POST: %v %v", response, err)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	// net/http writes the answer before it aborts its background read.
	time.Sleep(50 * time.Millisecond)
	_, _ = io.WriteString(conn, "\r\nGET /ok HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
	response, err = http.ReadResponse(reader, nil)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != 200 || !strings.Contains(string(body), `"/ok"`) {
		t.Fatalf("GET after the CRLF: %d %q", response.StatusCode, body)
	}
}

// peakSource hands out n bytes of 'a' after a prefix, and notes the most
// the stream ever held unread while it read them.
type peakSource struct {
	prefix string
	n      int
	stream *targetStream
	peak   int
}

func (p *peakSource) Read(b []byte) (int, error) {
	if p.stream != nil && len(p.stream.in) > p.peak {
		p.peak = len(p.stream.in)
	}
	if p.prefix != "" {
		n := copy(b, p.prefix)
		p.prefix = p.prefix[n:]
		return n, nil
	}
	if p.n == 0 {
		return 0, io.EOF
	}
	n := min(len(b), p.n)
	for i := range n {
		b[i] = 'a'
	}
	p.n -= n
	return n, nil
}

// Kestrel reads a chunk extension as it comes and counts it against the
// body cap: 1.1 MB of extension is taken, 31 MB gets 413 (measured on the
// C# host). The stream must not hold the extension while it waits.
func TestALongChunkExtensionIsNeverHeld(t *testing.T) {
	for _, c := range []struct {
		n      int
		refuse int
	}{{1_100_000, 0}, {31_000_000, http.StatusRequestEntityTooLarge}} {
		source := &peakSource{prefix: "POST /a HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n2;", n: c.n}
		stream := &targetStream{src: source}
		source.stream = stream
		for {
			if _, err := stream.Read(make([]byte, 4096)); err != nil {
				break
			}
		}
		if source.peak > maxChunkLine {
			t.Errorf("%d bytes of extension: held %d", c.n, source.peak)
		}
		if stream.bodyRefusal != c.refuse {
			t.Errorf("%d bytes of extension: refusal %d, want %d", c.n, stream.bodyRefusal, c.refuse)
		}
	}
}

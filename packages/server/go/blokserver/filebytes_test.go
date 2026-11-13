package blokserver

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/outbound"
)

// The shared fixture (file-bytes-responses.json) runs the server as a
// process; these cover what a process run cannot: the clock, the cache size,
// a body with no length and a client that stops reading.

func testPDF(size int) string {
	return ("%PDF-1.7" + strings.Repeat("x", size))[:size]
}

type pdfOrigin struct {
	*httptest.Server
	mu     sync.Mutex
	ranges []string
}

func (o *pdfOrigin) seen() []string {
	o.mu.Lock()
	defer o.mu.Unlock()
	return append([]string(nil), o.ranges...)
}

// startPDFOrigin serves body for every path, with one-range support unless
// chunked, which sends it with no length.
func startPDFOrigin(t *testing.T, body string, chunked bool) *pdfOrigin {
	t.Helper()
	o := &pdfOrigin{}
	o.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o.mu.Lock()
		o.ranges = append(o.ranges, r.Header.Get("Range"))
		o.mu.Unlock()
		if chunked {
			for i := 0; i < len(body); i += 512 {
				_, _ = io.WriteString(w, body[i:min(i+512, len(body))])
				w.(http.Flusher).Flush()
			}
			return
		}
		var start, end int
		if _, err := fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &start, &end); err == nil {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(body)))
			w.Header().Set("Content-Length", strconv.Itoa(end-start+1))
			w.WriteHeader(http.StatusPartialContent)
			_, _ = io.WriteString(w, body[start:end+1])
			return
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(body)))
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(o.Close)
	return o
}

func fileBytesServer(t *testing.T, origin *pdfOrigin, options Options) (*Server, *httptest.Server) {
	t.Helper()
	options.FileBytesEnabled = true
	s, err := New(options)
	if err != nil {
		t.Fatal(err)
	}
	port, _ := strconv.Atoi(strings.TrimPrefix(origin.URL, "http://127.0.0.1:"))
	s.fetcher = outbound.NewFetcher(outbound.ExactOriginPolicy{Origin: origin.URL, Port: port})
	front := httptest.NewServer(s.Handler(""))
	t.Cleanup(front.Close)
	return s, front
}

func getFileBytes(t *testing.T, front *httptest.Server, target, byteRange string) (int, string, error) {
	t.Helper()
	request, _ := http.NewRequest(http.MethodGet, front.URL+"/file-bytes?url="+url.QueryEscape(target), nil)
	if byteRange != "" {
		request.Header.Set("Range", byteRange)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	return response.StatusCode, string(body), err
}

func TestFileBytesAndFilesCORSAreOffByDefault(t *testing.T) {
	for _, o := range []Options{{}, DefaultOptions()} {
		if o.FileBytesEnabled || o.FilesCORS {
			t.Fatalf("on by default: %+v", o)
		}
		if got := o.resolve().FileBytesMaxBytes; got != 100<<20 {
			t.Fatalf("FileBytesMaxBytes %d, want 100 MiB", got)
		}
	}
}

func TestFileBytesRefusesACapBelowOneByte(t *testing.T) {
	o := Options{FileBytesEnabled: true, FileBytesMaxBytes: new(int64(0))}
	err := o.Validate()
	if err == nil || err.Error() != "FileBytesMaxBytes must be a positive number of bytes (got 0)" {
		t.Fatalf("got %v", err)
	}
}

func TestFileBytesChecksAUrlAgainAfterTenMinutes(t *testing.T) {
	origin := startPDFOrigin(t, testPDF(1500), false)
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	var clock sync.Mutex
	s, front := fileBytesServer(t, origin, Options{Clock: func() time.Time {
		clock.Lock()
		defer clock.Unlock()
		return now
	}})
	_ = s
	target := origin.URL + "/doc.pdf"
	middle := func() {
		if status, _, err := getFileBytes(t, front, target, "bytes=1000-1099"); status != 206 || err != nil {
			t.Fatalf("status %d, %v", status, err)
		}
	}

	middle()
	middle()
	clock.Lock()
	now = now.Add(10*time.Minute - time.Second)
	clock.Unlock()
	middle()
	clock.Lock()
	now = now.Add(time.Second)
	clock.Unlock()
	middle()

	want := []string{
		"bytes=1000-1099", "bytes=0-1023",
		"bytes=1000-1099",
		"bytes=1000-1099",
		"bytes=1000-1099", "bytes=0-1023",
	}
	if got := origin.seen(); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("origin saw %q, want %q", got, want)
	}
}

func TestPDFCheckCacheForgetsTheLeastRecentlyUsed(t *testing.T) {
	now := time.Now()
	cache := newPDFCheckCache(func() time.Time { return now })
	for i := 0; i < 256; i++ {
		cache.add(strconv.Itoa(i))
	}
	if !cache.has("0") {
		t.Fatal("0 is gone before the cache is full")
	}
	cache.add("256")
	if cache.has("1") {
		t.Fatal("1, the least recently used, is still there")
	}
	if !cache.has("0") || !cache.has("2") || !cache.has("256") {
		t.Fatal("dropped a recent entry")
	}
}

// A body sent with no length is measured after it is read.
func TestFileBytesRefusesABodyOfUnknownLengthOverTheCap(t *testing.T) {
	origin := startPDFOrigin(t, testPDF(3000), true)
	_, front := fileBytesServer(t, origin, Options{FileBytesMaxBytes: new(int64(2048))})

	status, body, err := getFileBytes(t, front, origin.URL+"/doc.pdf", "")
	if status != 413 || err != nil || body != "file too large\n" {
		t.Fatalf("status %d, %q, %v", status, body, err)
	}
}

func TestFileBytesAnswersAtMostOneMebibyte(t *testing.T) {
	origin := startPDFOrigin(t, testPDF(1<<20+1), false)
	_, front := fileBytesServer(t, origin, Options{})

	if status, body, _ := getFileBytes(t, front, origin.URL+"/doc.pdf", "bytes=0-1048575"); status != 206 || len(body) != 1<<20 {
		t.Fatalf("a 1 MiB range: status %d, %d bytes", status, len(body))
	}
	if status, body, _ := getFileBytes(t, front, origin.URL+"/doc.pdf", ""); status != 413 || body != "range too large\n" {
		t.Fatalf("the whole file: status %d, %q", status, body)
	}
}

func TestFileBytesServesABodyOfUnknownLengthUnderTheCap(t *testing.T) {
	origin := startPDFOrigin(t, testPDF(1500), true)
	_, front := fileBytesServer(t, origin, Options{FileBytesMaxBytes: new(int64(2048))})

	status, body, err := getFileBytes(t, front, origin.URL+"/doc.pdf", "")
	if status != 200 || err != nil || body != testPDF(1500) {
		t.Fatalf("status %d, %d bytes, %v", status, len(body), err)
	}
}

// A client that stops reading must not keep an outbound slot: the answer
// is read whole from the origin, the slot freed, and only then written.
func TestFileBytesFreesItsFetchSlotBeforeWritingToTheClient(t *testing.T) {
	origin := startPDFOrigin(t, testPDF(1_000_000), false)
	s, front := fileBytesServer(t, origin, Options{})

	client, err := (&net.Dialer{Control: func(_, _ string, raw syscall.RawConn) error {
		return raw.Control(func(fd uintptr) {
			_ = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_RCVBUF, 1024)
		})
	}}).Dial("tcp", strings.TrimPrefix(front.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	target := url.QueryEscape(origin.URL + "/doc.pdf")
	_, _ = io.WriteString(client, "GET /file-bytes?url="+target+" HTTP/1.1\r\nHost: x\r\nRange: bytes=0-999999\r\n\r\n")
	for deadline := time.Now().Add(5 * time.Second); len(origin.seen()) == 0; time.Sleep(10 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("the origin never saw the request")
		}
	}
	time.Sleep(200 * time.Millisecond)

	limits := outbound.Limits{Timeout: 200 * time.Millisecond, MaxBytes: 1 << 20, Upload: true}
	for i := 0; i < 4; i++ {
		response, err := s.fetcher.Get(context.Background(), origin.URL+"/doc.pdf", limits)
		if err != nil {
			t.Fatalf("upload slot %d of 4 is taken while the client stalls: %v", i+1, err)
		}
		defer response.Release()
	}
}

package blob

import (
	"bufio"
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Twins of the S3BlobStoreTests cases with no Go test. C# swaps the HTTP
// handler; Go swaps the client's RoundTripper, or talks to a raw loopback
// server for the on-wire cases.

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// delegateStore is CreateStore: the fixed target, a spool directory, and a
// transport the test answers.
func delegateStore(t *testing.T, send roundTrip) (*S3, string) {
	t.Helper()
	s, err := NewS3(testS3("https://s3.example.com", "media", "path"))
	if err != nil {
		t.Fatal(err)
	}
	s.Now = func() time.Time { return frozenTime }
	s.TempDir = t.TempDir()
	s.client = &http.Client{Transport: send}
	return s, s.TempDir
}

func answer(r *http.Request, status int, body io.Reader) *http.Response {
	if body == nil {
		body = http.NoBody
	}
	return &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(body), Request: r}
}

func ok(r *http.Request) (*http.Response, error) { return answer(r, http.StatusOK, nil), nil }

func noEntries(t *testing.T, directory string) {
	t.Helper()
	if list, err := os.ReadDir(directory); err != nil || len(list) != 0 {
		t.Fatalf("%v left in %s (%v)", list, directory, err)
	}
}

// nonSeekable hides Seek, like a request body stream.
type nonSeekable struct{ r io.Reader }

func (n nonSeekable) Read(p []byte) (int, error) { return n.r.Read(p) }

// closeRecorder is a seekable caller stream that notes a Close.
type closeRecorder struct {
	*bytes.Reader
	closed bool
}

func (c *closeRecorder) Close() error {
	c.closed = true
	return nil
}

func TestPutsASeekableBodyWithKnownLengthAndReturnsThePublicUrl(t *testing.T) {
	var captured *http.Request
	var body []byte
	s, _ := delegateStore(t, func(r *http.Request) (*http.Response, error) {
		captured = r
		body, _ = io.ReadAll(r.Body)
		return ok(r)
	})
	content := &closeRecorder{Reader: bytes.NewReader([]byte("bytes"))}

	url, err := s.Put(context.Background(), ".PNG", "image/png", content)
	if err != nil {
		t.Fatal(err)
	}

	if !regexp.MustCompile(`^https://cdn\.example\.com/media/[0-9a-f]{32}\.png$`).MatchString(url) {
		t.Fatalf("url %q", url)
	}
	key := url[strings.LastIndexByte(url, '/')+1:]
	if captured.Method != http.MethodPut || captured.URL.String() != "https://s3.example.com/media/"+key || captured.Host != "s3.example.com" {
		t.Fatalf("request %s %s host %q", captured.Method, captured.URL, captured.Host)
	}
	if captured.ContentLength != 5 || captured.Header.Get("Content-Type") != "image/png" || captured.Header.Get("Content-Disposition") != "attachment" {
		t.Fatalf("length %d headers %v", captured.ContentLength, captured.Header)
	}
	if got := captured.Header.Get("X-Amz-Content-Sha256"); got != "277089d91c0bdf4f2e6862ba7e4a07605119431f5d13f726dd352b06f1b206a9" {
		t.Fatalf("hash %q", got)
	}
	if string(body) != "bytes" {
		t.Fatalf("body %q", body)
	}
	if !strings.Contains(captured.Header.Get("Authorization"), "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date") {
		t.Fatalf("Authorization %q", captured.Header.Get("Authorization"))
	}
	if content.closed {
		t.Fatal("the store closed the caller's stream")
	}
}

type wireRequest struct {
	method, target, host string
	header               http.Header
	body                 []byte
}

type wireServer struct {
	url   string
	count atomic.Int32
	mu    sync.Mutex
	last  *wireRequest
}

func (w *wireServer) lastRequest() *wireRequest {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.last
}

// startWireServer is LoopbackServer: it records each request, body
// included, then writes the raw answer.
func startWireServer(t *testing.T, respond func() string) *wireServer {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	w := &wireServer{url: "http://" + listener.Addr().String()}
	var running sync.WaitGroup
	t.Cleanup(func() {
		_ = listener.Close()
		running.Wait()
	})
	running.Go(func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			running.Go(func() {
				defer conn.Close()
				request, err := http.ReadRequest(bufio.NewReader(conn))
				if err != nil {
					return
				}
				body, _ := io.ReadAll(request.Body)
				w.count.Add(1)
				w.mu.Lock()
				w.last = &wireRequest{method: request.Method, target: request.RequestURI, host: request.Host, header: request.Header, body: body}
				w.mu.Unlock()
				_, _ = io.WriteString(conn, respond())
			})
		}
	})
	return w
}

const okWire = "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"

// realStore is CreateRealStore: the endpoint under path addressing, on the
// frozen clock.
func realStore(t *testing.T, endpoint string) *S3 {
	t.Helper()
	s, err := NewS3(testS3(endpoint, "media", "path"))
	if err != nil {
		t.Fatal(err)
	}
	s.Now = func() time.Time { return frozenTime }
	s.TempDir = t.TempDir()
	return s
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func hmacBytes(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(data))
	return mac.Sum(nil)
}

// expectedAuthorization is the C# test's own SigV4, kept apart from sign so
// the two can disagree.
func expectedAuthorization(method, target, host, contentType, payloadHash string) string {
	const amzDate, dateStamp, region = "20250102T030405Z", "20250102", "eu-central-1"
	canonicalHeaders := "host:" + host + "\nx-amz-content-sha256:" + payloadHash + "\nx-amz-date:" + amzDate + "\n"
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"
	if contentType != "" {
		canonicalHeaders = "content-type:" + contentType + "\n" + canonicalHeaders
		signedHeaders = "content-type;" + signedHeaders
	}
	canonicalRequest := strings.Join([]string{method, target, "", canonicalHeaders, signedHeaders, payloadHash}, "\n")
	scope := dateStamp + "/" + region + "/s3/aws4_request"
	stringToSign := strings.Join([]string{"AWS4-HMAC-SHA256", amzDate, scope, sha256Hex([]byte(canonicalRequest))}, "\n")
	key := hmacBytes(hmacBytes(hmacBytes(hmacBytes([]byte("AWS4wJalrXUtnFEMI/K7MDENG"), dateStamp), region), "s3"), "aws4_request")
	return "AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/" + scope + ", SignedHeaders=" + signedHeaders +
		", Signature=" + hex.EncodeToString(hmacBytes(key, stringToSign))
}

func TestDoesNotFollowARedirectAwayFromTheConfiguredEndpoint(t *testing.T) {
	target := startWireServer(t, func() string { return okWire })
	source := startWireServer(t, func() string {
		return "HTTP/1.1 302 Found\r\nLocation: " + target.url + "/forwarded\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
	})
	s := realStore(t, source.url)

	_, err := s.Put(context.Background(), ".bin", "application/octet-stream", bytes.NewReader([]byte("private bytes")))

	if err == nil || !strings.Contains(err.Error(), "returned 302") {
		t.Fatalf("err %v", err)
	}
	if source.count.Load() != 1 || target.count.Load() != 0 {
		t.Fatalf("source saw %d, target saw %d", source.count.Load(), target.count.Load())
	}
}

func TestPutsWithTheExactOnWireSignatureForItsGeneratedTarget(t *testing.T) {
	endpoint := startWireServer(t, func() string { return okWire })
	s := realStore(t, endpoint.url)
	body := []byte("signed dynamic bytes")

	url, err := s.Put(context.Background(), ".png", "image/png", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}

	request := endpoint.lastRequest()
	target := "/media/" + url[strings.LastIndexByte(url, '/')+1:]
	host := strings.TrimPrefix(endpoint.url, "http://")
	hash := sha256Hex(body)
	if request.method != http.MethodPut || request.target != target || request.host != host {
		t.Fatalf("request %s %s host %q", request.method, request.target, request.host)
	}
	if request.header.Get("Content-Type") != "image/png" || request.header.Get("Content-Length") != "20" ||
		request.header.Get("X-Amz-Content-Sha256") != hash || !bytes.Equal(request.body, body) {
		t.Fatalf("headers %v body %q", request.header, request.body)
	}
	if got, want := request.header.Get("Authorization"), expectedAuthorization("PUT", target, host, "image/png", hash); got != want {
		t.Fatalf("Authorization\n got %s\nwant %s", got, want)
	}
}

func TestDeletesWithTheExactOnWireSignatureForItsDynamicTarget(t *testing.T) {
	endpoint := startWireServer(t, func() string {
		return "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
	})
	s := realStore(t, endpoint.url)
	key := strings.Repeat("a", 32) + ".png"

	if err := s.Delete(context.Background(), "https://cdn.example.com/media/"+key); err != nil {
		t.Fatal(err)
	}

	request := endpoint.lastRequest()
	target := "/media/" + key
	host := strings.TrimPrefix(endpoint.url, "http://")
	hash := sha256Hex(nil)
	if request.method != http.MethodDelete || request.target != target || request.host != host {
		t.Fatalf("request %s %s host %q", request.method, request.target, request.host)
	}
	if _, has := request.header["Content-Type"]; has || request.header.Get("Content-Length") != "0" ||
		request.header.Get("X-Amz-Content-Sha256") != hash || len(request.body) != 0 {
		t.Fatalf("headers %v body %q", request.header, request.body)
	}
	if got, want := request.header.Get("Authorization"), expectedAuthorization("DELETE", target, host, "", hash); got != want {
		t.Fatalf("Authorization\n got %s\nwant %s", got, want)
	}
}

func TestDeletesAnOwnedUrlWithASignedEmptyPayload(t *testing.T) {
	var captured *http.Request
	var body []byte
	s, _ := delegateStore(t, func(r *http.Request) (*http.Response, error) {
		captured = r
		body, _ = io.ReadAll(r.Body)
		return answer(r, http.StatusNoContent, nil), nil
	})
	key := strings.Repeat("a", 32) + ".png"

	if err := s.Delete(context.Background(), "https://cdn.example.com/media/"+key+"?download=1#file"); err != nil {
		t.Fatal(err)
	}

	if captured.Method != http.MethodDelete || captured.URL.String() != "https://s3.example.com/media/"+key {
		t.Fatalf("request %s %s", captured.Method, captured.URL)
	}
	if captured.ContentLength != 0 || len(body) != 0 {
		t.Fatalf("length %d body %q", captured.ContentLength, body)
	}
	if got := captured.Header.Get("X-Amz-Content-Sha256"); got != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" {
		t.Fatalf("hash %q", got)
	}
	if !strings.Contains(captured.Header.Get("Authorization"), "SignedHeaders=host;x-amz-content-sha256;x-amz-date") {
		t.Fatalf("Authorization %q", captured.Header.Get("Authorization"))
	}
}

func TestRefusesAForeignDeleteWithoutSendingARequest(t *testing.T) {
	requests := 0
	s, _ := delegateStore(t, func(r *http.Request) (*http.Response, error) {
		requests++
		return answer(r, http.StatusNoContent, nil), nil
	})

	err := s.Delete(context.Background(), "https://evil.example.com/media/"+strings.Repeat("a", 32)+".png")

	if !errors.Is(err, ErrForeign) || requests != 0 {
		t.Fatalf("err %v after %d requests", err, requests)
	}
}

func TestSpoolsANonSeekableBodyOnlyForTheRequestLifetime(t *testing.T) {
	spoolsDuringRequest := -1
	var modeDuringRequest os.FileMode
	var dir string
	s, dir := delegateStore(t, func(r *http.Request) (*http.Response, error) {
		list, _ := os.ReadDir(dir)
		spoolsDuringRequest = len(list)
		if len(list) == 1 {
			if info, err := os.Stat(filepath.Join(dir, list[0].Name())); err == nil {
				modeDuringRequest = info.Mode().Perm()
			}
		}
		_, _ = io.ReadAll(r.Body)
		return ok(r)
	})

	if _, err := s.Put(context.Background(), ".bin", "application/octet-stream", nonSeekable{strings.NewReader("non-seekable bytes")}); err != nil {
		t.Fatal(err)
	}

	if spoolsDuringRequest != 1 {
		t.Fatalf("%d spool files during the request", spoolsDuringRequest)
	}
	if runtime.GOOS != "windows" && modeDuringRequest != 0o600 {
		t.Fatalf("spool mode %v, want 0600", modeDuringRequest)
	}
	noEntries(t, dir)
}

// failingSeekable fails one read at the end, while the store hashes it.
type failingSeekable struct {
	*bytes.Reader
	failed bool
}

func (f *failingSeekable) Read(p []byte) (int, error) {
	if !f.failed && f.Len() == 0 {
		f.failed = true
		return 0, errors.New("hashing failed")
	}
	return f.Reader.Read(p)
}

func TestDoesNotRetryASeekableBodyAfterHashingFails(t *testing.T) {
	requests := 0
	s, dir := delegateStore(t, func(r *http.Request) (*http.Response, error) {
		requests++
		return ok(r)
	})

	_, err := s.Put(context.Background(), ".bin", "application/octet-stream", &failingSeekable{Reader: bytes.NewReader([]byte("bytes"))})

	if err == nil || err.Error() != "hashing failed" || requests != 0 {
		t.Fatalf("err %v after %d requests", err, requests)
	}
	noEntries(t, dir)
}

// failingInput returns "part" once, then fails; onFirst runs before the
// first answer.
type failingInput struct {
	returned bool
	err      error
	onFirst  func()
}

func (f *failingInput) Read(p []byte) (int, error) {
	if f.returned {
		return 0, f.err
	}
	f.returned = true
	if f.onFirst != nil {
		f.onFirst()
	}
	return copy(p, "part"), nil
}

func TestRemovesTheSpoolWhenTheInputFails(t *testing.T) {
	s, dir := delegateStore(t, ok)

	_, err := s.Put(context.Background(), ".bin", "application/octet-stream", &failingInput{err: errors.New("input failed")})

	if err == nil || err.Error() != "input failed" {
		t.Fatalf("err %v", err)
	}
	noEntries(t, dir)
}

func TestRemovesTheSpoolWhenInputCopyIsCancelled(t *testing.T) {
	s, dir := delegateStore(t, ok)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	_, err := s.Put(ctx, ".bin", "application/octet-stream", &failingInput{err: context.Canceled, onFirst: cancel})

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err %v", err)
	}
	noEntries(t, dir)
}

func waitForever(r *http.Request) (*http.Response, error) {
	<-r.Context().Done()
	return nil, r.Context().Err()
}

func TestBoundsTheConfiguredS3RequestAndRemovesTheSpool(t *testing.T) {
	s, dir := delegateStore(t, waitForever)
	s.requestTimeout = 20 * time.Millisecond
	done := make(chan error, 1)

	go func() {
		_, err := s.Put(context.Background(), ".bin", "application/octet-stream", nonSeekable{strings.NewReader("bytes")})
		done <- err
	}()

	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("err %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the request timeout never fired")
	}
	noEntries(t, dir)
}

func TestRemovesTheSpoolWhenTheS3RequestIsCancelled(t *testing.T) {
	started := make(chan int, 1)
	var dir string
	s, dir := delegateStore(t, func(r *http.Request) (*http.Response, error) {
		list, _ := os.ReadDir(dir)
		started <- len(list)
		return waitForever(r)
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := s.Put(ctx, ".bin", "application/octet-stream", nonSeekable{strings.NewReader("bytes")})
		done <- err
	}()

	select {
	case spools := <-started:
		if spools != 1 {
			t.Fatalf("%d spool files during the request", spools)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the request never started")
	}
	cancel()

	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("err %v", err)
	}
	noEntries(t, dir)
}

func TestRemovesTheSpoolWhenS3RejectsTheRequest(t *testing.T) {
	s, dir := delegateStore(t, func(r *http.Request) (*http.Response, error) {
		return answer(r, http.StatusForbidden, strings.NewReader("<Error><Code>FixtureFailure</Code></Error>")), nil
	})

	_, err := s.Put(context.Background(), ".bin", "application/octet-stream", nonSeekable{strings.NewReader("bytes")})

	if err == nil || !strings.Contains(err.Error(), "returned 403") {
		t.Fatalf("err %v", err)
	}
	noEntries(t, dir)
}

// throwingBody returns its prefix once, then fails.
type throwingBody struct {
	prefix   []byte
	returned bool
}

func (b *throwingBody) Read(p []byte) (int, error) {
	if b.returned {
		return 0, errors.New("response stream failed")
	}
	b.returned = true
	return copy(p, b.prefix), nil
}

func TestIgnoresAResponsePrefixReadFailureAfterSuccess(t *testing.T) {
	s, _ := delegateStore(t, func(r *http.Request) (*http.Response, error) {
		return answer(r, http.StatusOK, &throwingBody{prefix: []byte("accepted")}), nil
	})

	url, err := s.Put(context.Background(), ".bin", "application/octet-stream", bytes.NewReader([]byte("bytes")))

	if err != nil || !strings.HasPrefix(url, "https://cdn.example.com/media/") {
		t.Fatalf("url %q err %v", url, err)
	}
}

// probeBody counts what was read: the prefix, then 'x' up to total.
type probeBody struct {
	prefix []byte
	total  int
	read   int
}

func (b *probeBody) Read(p []byte) (int, error) {
	count := min(len(p), b.total-b.read)
	if count == 0 {
		return 0, io.EOF
	}
	for i := range count {
		if b.read+i < len(b.prefix) {
			p[i] = b.prefix[b.read+i]
		} else {
			p[i] = 'x'
		}
	}
	b.read += count
	return count, nil
}

func TestDoesNotReadASuccessfulResponseBody(t *testing.T) {
	probe := &probeBody{prefix: []byte("accepted"), total: 8}
	s, _ := delegateStore(t, func(r *http.Request) (*http.Response, error) {
		return answer(r, http.StatusOK, probe), nil
	})

	if _, err := s.Put(context.Background(), ".bin", "application/octet-stream", bytes.NewReader([]byte("bytes"))); err != nil {
		t.Fatal(err)
	}

	if probe.read != 0 {
		t.Fatalf("read %d bytes of a success body", probe.read)
	}
}

func TestRetainsAnErrorPrefixWhenItsResponseReadFails(t *testing.T) {
	s, _ := delegateStore(t, func(r *http.Request) (*http.Response, error) {
		return answer(r, http.StatusForbidden, &throwingBody{prefix: []byte("<Error><Code>FixtureFailure</Code>")}), nil
	})

	_, err := s.Put(context.Background(), ".bin", "application/octet-stream", bytes.NewReader([]byte("bytes")))

	if err == nil || !strings.Contains(err.Error(), "returned 403") || !strings.Contains(err.Error(), "FixtureFailure") {
		t.Fatalf("err %v", err)
	}
}

// cancellingFailingBody cancels the caller, then reports an I/O failure.
type cancellingFailingBody struct{ cancel func() }

func (b cancellingFailingBody) Read([]byte) (int, error) {
	b.cancel()
	return 0, errors.New("cancelled read failed")
}

func TestPreservesCancellationWhenAResponseReadReportsIoFailure(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s, _ := delegateStore(t, func(r *http.Request) (*http.Response, error) {
		return answer(r, http.StatusForbidden, cancellingFailingBody{cancel}), nil
	})

	_, err := s.Put(ctx, ".bin", "application/octet-stream", bytes.NewReader([]byte("bytes")))

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err %v", err)
	}
}

func TestTruncatesTheUpstreamErrorBody(t *testing.T) {
	probe := &probeBody{prefix: []byte("<Error><Code>FixtureFailure</Code></Error>"), total: 2048}
	s, _ := delegateStore(t, func(r *http.Request) (*http.Response, error) {
		return answer(r, http.StatusForbidden, probe), nil
	})

	_, err := s.Put(context.Background(), ".bin", "application/octet-stream", bytes.NewReader([]byte("bytes")))

	if probe.read != 512 {
		t.Fatalf("read %d bytes of the error body", probe.read)
	}
	if err == nil || !strings.Contains(err.Error(), "FixtureFailure") || len(err.Error()) >= 600 {
		t.Fatalf("err %v", err)
	}
}

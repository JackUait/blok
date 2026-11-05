package outbound

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
)

// Twins of the GuardedOutboundFetcherTests cases that had no Go test. The
// origin is a raw socket, like C#'s LoopbackOrigin, so a case controls every
// byte and sees the connection close.

type rawRequest struct {
	method, target, host string
	header               http.Header
}

type rawOrigin struct {
	port     int
	count    atomic.Int32
	mu       sync.Mutex
	requests []rawRequest
}

func (o *rawOrigin) seen() []rawRequest {
	o.mu.Lock()
	defer o.mu.Unlock()
	return append([]rawRequest(nil), o.requests...)
}

// startRawOrigin serves one request per connection. With a certificate it
// speaks TLS first. The handler writes the whole answer; the connection
// closes when it returns.
func startRawOrigin(t *testing.T, certificate *tls.Certificate, handle func(rawRequest, net.Conn, int)) *rawOrigin {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	o := &rawOrigin{port: listener.Addr().(*net.TCPAddr).Port}
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
				if certificate != nil {
					conn = tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{*certificate}})
				}
				request, err := http.ReadRequest(bufio.NewReader(conn))
				if err != nil {
					return
				}
				seen := rawRequest{method: request.Method, target: request.RequestURI, host: request.Host, header: request.Header}
				o.mu.Lock()
				o.requests = append(o.requests, seen)
				o.mu.Unlock()
				count := int(o.count.Add(1))
				if handle != nil {
					handle(seen, conn, count)
				}
			})
		}
	})
	return o
}

func write(conn net.Conn, parts ...string) {
	for _, part := range parts {
		if _, err := io.WriteString(conn, part); err != nil {
			return
		}
	}
}

func okHandler(_ rawRequest, conn net.Conn, _ int) {
	write(conn, "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
}

// fixtureFetcher is CreateFixtureFetcher: one host on the origin's port,
// answered and allowed only as 127.0.0.1.
func fixtureFetcher(o *rawOrigin, host string) (*Fetcher, *countingResolver) {
	resolver := &countingResolver{answers: [][]netip.Addr{addrs("127.0.0.1")}}
	return newTestFetcher(&fixturePolicy{host: host, port: o.port, allowed: addrs("127.0.0.1")}, resolver), resolver
}

func originURL(scheme, host string, o *rawOrigin, path string) string {
	return scheme + "://" + host + ":" + strconv.Itoa(o.port) + path
}

func wantFailure(t *testing.T, err error, want Failure) {
	t.Helper()
	var failure *Error
	if !errors.As(err, &failure) || failure.Failure != want {
		t.Fatalf("got %v, want failure %d", err, want)
	}
}

func gzipBytes(t *testing.T, data []byte) []byte {
	t.Helper()
	var out bytes.Buffer
	w, _ := gzip.NewWriterLevel(&out, gzip.BestCompression)
	if _, err := w.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func gzipAnswer(compressed []byte) func(rawRequest, net.Conn, int) {
	return func(_ rawRequest, conn net.Conn, _ int) {
		write(conn, "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: "+strconv.Itoa(len(compressed))+
			"\r\nConnection: close\r\n\r\n", string(compressed))
	}
}

type failingResolver struct{ err error }

func (r failingResolver) resolve(ctx context.Context, _ string) ([]netip.Addr, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return nil, r.err
}

func TestBoundsAndRedactsDnsAndTransportErrors(t *testing.T) {
	f := NewFetcher(DefaultPolicy{})
	f.Resolve = failingResolver{errors.New(strings.Repeat("x", 10_000))}.resolve

	_, err := f.Get(context.Background(), "http://failure.example/private-path?secret=value", testLimits)

	wantFailure(t, err, Blocked)
	if errors.Unwrap(err) != nil {
		t.Fatalf("the error wraps %v", errors.Unwrap(err))
	}
	message := err.Error()
	if len(message) > 128 || strings.Contains(message, "failure.example") || strings.Contains(message, "x") {
		t.Fatalf("message %q", message)
	}
}

type chainPKI struct {
	root, middle *x509.Certificate
	pool         *x509.CertPool
	leaf         *x509.Certificate
	leafKey      *ecdsa.PrivateKey
}

// newChainPKI is TestCertificates.CreateWithIntermediateAia: root, an
// intermediate, and a leaf for name whose caIssuers URL is issuerURL.
func newChainPKI(t *testing.T, name, issuerURL string) chainPKI {
	t.Helper()
	now := time.Now()
	rootKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	middleKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	leafKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	rootTemplate := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "root"},
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	root := makeCert(t, rootTemplate, rootTemplate, &rootKey.PublicKey, rootKey)
	middle := makeCert(t, &x509.Certificate{SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "middle"},
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign},
		root, &middleKey.PublicKey, rootKey)
	leaf := makeCert(t, &x509.Certificate{SerialNumber: big.NewInt(3), Subject: pkix.Name{CommonName: name},
		DNSNames: []string{name}, NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour),
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IssuingCertificateURL: []string{issuerURL}},
		middle, &leafKey.PublicKey, middleKey)
	pool := x509.NewCertPool()
	pool.AddCert(root)
	return chainPKI{root: root, middle: middle, pool: pool, leaf: leaf, leafKey: leafKey}
}

func issuerOrigin(t *testing.T, issuer *[]byte) *rawOrigin {
	return startRawOrigin(t, nil, func(_ rawRequest, conn net.Conn, _ int) {
		write(conn, "HTTP/1.1 200 OK\r\nContent-Type: application/pkix-cert\r\nContent-Length: "+
			strconv.Itoa(len(*issuer))+"\r\nConnection: close\r\n\r\n", string(*issuer))
	})
}

func TestDefaultTlsValidationDoesNotDownloadAMissingIssuer(t *testing.T) {
	var issuerBytes []byte
	issuer := issuerOrigin(t, &issuerBytes)
	pki := newChainPKI(t, "aia.example", "http://127.0.0.1:"+strconv.Itoa(issuer.port)+"/issuer.cer")
	issuerBytes = pki.middle.Raw
	// The server sends the leaf alone, so only the AIA URL could complete it.
	origin := startRawOrigin(t, &tls.Certificate{Certificate: [][]byte{pki.leaf.Raw}, PrivateKey: pki.leafKey}, okHandler)
	f, _ := fixtureFetcher(origin, "aia.example")

	_, err := f.Get(context.Background(), originURL("https", "aia.example", origin, "/"), testLimits)

	if got := issuer.count.Load(); got != 0 {
		t.Fatalf("the issuer was fetched %d time(s)", got)
	}
	wantFailure(t, err, Blocked)
}

func TestAcceptsACompleteServerChainWithACustomRoot(t *testing.T) {
	var issuerBytes []byte
	issuer := issuerOrigin(t, &issuerBytes)
	pki := newChainPKI(t, "chain.example", "http://127.0.0.1:"+strconv.Itoa(issuer.port)+"/issuer.cer")
	issuerBytes = pki.middle.Raw
	origin := startRawOrigin(t, &tls.Certificate{Certificate: [][]byte{pki.leaf.Raw, pki.middle.Raw}, PrivateKey: pki.leafKey}, okHandler)
	f, _ := fixtureFetcher(origin, "chain.example")
	f.RootCAs = pki.pool

	response, err := f.Get(context.Background(), originURL("https", "chain.example", origin, "/"), testLimits)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Release()

	if string(response.Body) != "ok" {
		t.Fatalf("body %q", response.Body)
	}
	if got := issuer.count.Load(); got != 0 {
		t.Fatalf("the issuer was fetched %d time(s)", got)
	}
}

func TestReturnsTheFinalNonSuccessStatusForTheConsumerToRefuse(t *testing.T) {
	origin := startRawOrigin(t, nil, func(_ rawRequest, conn net.Conn, _ int) {
		write(conn, "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 5\r\nConnection: close\r\n\r\nerror")
	})
	f, _ := fixtureFetcher(origin, "status.example")

	response, err := f.Get(context.Background(), originURL("http", "status.example", origin, "/error"), testLimits)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Release()

	if response.StatusCode != 503 || string(response.Body) != "error" {
		t.Fatalf("got %d %q", response.StatusCode, response.Body)
	}
}

func redirectThenOK(status int, body string) func(rawRequest, net.Conn, int) {
	return func(request rawRequest, conn net.Conn, _ int) {
		if request.target == "/start" {
			write(conn, "HTTP/1.1 "+strconv.Itoa(status)+" Redirect\r\nLocation: /final\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
			return
		}
		write(conn, "HTTP/1.1 200 OK\r\nContent-Length: "+strconv.Itoa(len(body))+"\r\nConnection: close\r\n\r\n"+body)
	}
}

func TestFollowsARelativeRedirectByGetAndRevalidatesTheHop(t *testing.T) {
	origin := startRawOrigin(t, nil, redirectThenOK(302, "arrived"))
	resolver := &countingResolver{answers: [][]netip.Addr{addrs("127.0.0.1"), addrs("127.0.0.1")}}
	f := newTestFetcher(&fixturePolicy{host: "redirect.example", port: origin.port, allowed: addrs("127.0.0.1")}, resolver)

	response, err := f.Get(context.Background(), originURL("http", "redirect.example", origin, "/start"),
		Limits{Timeout: 2 * time.Second, MaxBytes: 1024, MaxRedirects: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer response.Release()

	if string(response.Body) != "arrived" || response.FinalURL != originURL("http", "redirect.example", origin, "/final") {
		t.Fatalf("body %q final %q", response.Body, response.FinalURL)
	}
	if resolver.calls.Load() != 2 || origin.count.Load() != 2 {
		t.Fatalf("%d lookups and %d requests, want 2 and 2", resolver.calls.Load(), origin.count.Load())
	}
	for _, request := range origin.seen() {
		if request.method != http.MethodGet || request.header.Get("Authorization") != "" {
			t.Fatalf("request %s with Authorization %q", request.method, request.header.Get("Authorization"))
		}
	}
}

func TestKeepsGetSemanticsForEveryRedirectStatus(t *testing.T) {
	for _, status := range []int{301, 302, 303, 307, 308} {
		origin := startRawOrigin(t, nil, redirectThenOK(status, "ok"))
		f, _ := fixtureFetcher(origin, "method.example")

		response, err := f.Get(context.Background(), originURL("http", "method.example", origin, "/start"),
			Limits{Timeout: 2 * time.Second, MaxBytes: 1024, MaxRedirects: 1})
		if err != nil {
			t.Fatalf("%d: %v", status, err)
		}
		response.Release()

		if string(response.Body) != "ok" || origin.count.Load() != 2 {
			t.Fatalf("%d: body %q after %d requests", status, response.Body, origin.count.Load())
		}
		for _, request := range origin.seen() {
			if request.method != http.MethodGet {
				t.Fatalf("%d: sent %s", status, request.method)
			}
		}
	}
}

func TestFollowsExactlyTheConfiguredRedirectCap(t *testing.T) {
	origin := startRawOrigin(t, nil, func(request rawRequest, conn net.Conn, _ int) {
		hop, _ := strconv.Atoi(strings.TrimPrefix(request.target, "/"))
		if hop == 2 {
			okHandler(request, conn, 0)
			return
		}
		write(conn, "HTTP/1.1 302 Found\r\nLocation: /"+strconv.Itoa(hop+1)+"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
	})
	f, resolver := fixtureFetcher(origin, "cap.example")

	response, err := f.Get(context.Background(), originURL("http", "cap.example", origin, "/0"),
		Limits{Timeout: 2 * time.Second, MaxBytes: 1024, MaxRedirects: 2})
	if err != nil {
		t.Fatal(err)
	}
	defer response.Release()

	if string(response.Body) != "ok" || origin.count.Load() != 3 || resolver.calls.Load() != 3 {
		t.Fatalf("body %q, %d requests, %d lookups", response.Body, origin.count.Load(), resolver.calls.Load())
	}
}

func TestRejectsCredentialsIntroducedByARedirect(t *testing.T) {
	origin := startRawOrigin(t, nil, func(request rawRequest, conn net.Conn, _ int) {
		write(conn, "HTTP/1.1 302 Found\r\nLocation: http://user:secret@"+request.host+"/private\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
	})
	f, resolver := fixtureFetcher(origin, "redirect.example")

	_, err := f.Get(context.Background(), originURL("http", "redirect.example", origin, "/start"), testLimits)

	wantFailure(t, err, Blocked)
	if origin.count.Load() != 1 || resolver.calls.Load() != 1 {
		t.Fatalf("%d requests and %d lookups, want 1 and 1", origin.count.Load(), resolver.calls.Load())
	}
}

// multiHostPolicy is MultiHostFixturePolicy.
type multiHostPolicy struct {
	hosts   []string
	port    int
	allowed []netip.Addr
}

func (p multiHostPolicy) Validate(raw string, base *dotnet.URI) (Target, error) {
	url, ok := resolve(raw, base)
	if !ok || url.Port != p.port || url.UserInfo != "" || !url.IsHTTP() {
		return Target{}, fail(Blocked)
	}
	for _, host := range p.hosts {
		if strings.EqualFold(host, url.Host) {
			return Target{URL: url, Host: url.IdnHost, Port: url.Port}, nil
		}
	}
	return Target{}, fail(Blocked)
}

func (p multiHostPolicy) AddressAllowed(address netip.Addr) bool {
	for _, allowed := range p.allowed {
		if address == allowed {
			return true
		}
	}
	return false
}

func TestRejectsABlockedAddressIntroducedByARedirect(t *testing.T) {
	origin := startRawOrigin(t, nil, func(request rawRequest, conn net.Conn, _ int) {
		_, port, _ := net.SplitHostPort(request.host)
		write(conn, "HTTP/1.1 302 Found\r\nLocation: http://private.example:"+port+"/private\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
	})
	resolver := &countingResolver{answers: [][]netip.Addr{addrs("127.0.0.1"), addrs("127.0.0.2")}}
	f := newTestFetcher(multiHostPolicy{hosts: []string{"source.example", "private.example"}, port: origin.port, allowed: addrs("127.0.0.1")}, resolver)

	_, err := f.Get(context.Background(), originURL("http", "source.example", origin, "/start"), testLimits)

	wantFailure(t, err, Blocked)
	if origin.count.Load() != 1 || resolver.calls.Load() != 2 {
		t.Fatalf("%d requests and %d lookups, want 1 and 2", origin.count.Load(), resolver.calls.Load())
	}
}

func TestKeepsABodyExactlyAtTheConfiguredCap(t *testing.T) {
	origin := startRawOrigin(t, nil, func(_ rawRequest, conn net.Conn, _ int) {
		write(conn, "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n1234")
	})
	f, _ := fixtureFetcher(origin, "size.example")

	response, err := f.Get(context.Background(), originURL("http", "size.example", origin, "/exact"),
		Limits{Timeout: 2 * time.Second, MaxBytes: 4})
	if err != nil {
		t.Fatal(err)
	}
	defer response.Release()

	if string(response.Body) != "1234" {
		t.Fatalf("body %q", response.Body)
	}
}

func TestStopsAfterOneByteBeyondTheConfiguredBodyCap(t *testing.T) {
	origin := startRawOrigin(t, nil, func(_ rawRequest, conn net.Conn, _ int) {
		write(conn, "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n12345")
	})
	f, _ := fixtureFetcher(origin, "size.example")

	_, err := f.Get(context.Background(), originURL("http", "size.example", origin, "/oversized"),
		Limits{Timeout: 2 * time.Second, MaxBytes: 4})

	wantFailure(t, err, TooLarge)
}

// trickle writes a chunked body one byte at a time, count times.
func trickle(every time.Duration, count int) func(rawRequest, net.Conn, int) {
	return func(_ rawRequest, conn net.Conn, _ int) {
		write(conn, "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n")
		for range count {
			if _, err := io.WriteString(conn, "1\r\nx\r\n"); err != nil {
				return
			}
			time.Sleep(every)
		}
		write(conn, "0\r\n\r\n")
	}
}

func TestTotalDeadlineStopsAResponseThatKeepsMakingProgress(t *testing.T) {
	origin := startRawOrigin(t, nil, trickle(10*time.Millisecond, 20))
	f, _ := fixtureFetcher(origin, "deadline.example")

	_, err := f.Get(context.Background(), originURL("http", "deadline.example", origin, "/progress"),
		Limits{Timeout: 50 * time.Millisecond, MaxBytes: 1024})

	wantFailure(t, err, TimedOut)
}

// closeProbe writes a chunked head, then writes chunks every 5 ms while it
// waits for the client to close, and reports whether it saw a close (EOF or
// a reset) rather than a timeout.
func closeProbe(chunk string, repeat bool, disconnected chan<- struct{}) func(rawRequest, net.Conn, int) {
	return func(_ rawRequest, conn net.Conn, _ int) {
		write(conn, "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n")
		closed := make(chan error, 1)
		go func() {
			_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
			_, err := conn.Read(make([]byte, 1))
			closed <- err
		}()
		write(conn, chunk)
		for repeat {
			select {
			case err := <-closed:
				report(err, disconnected)
				return
			case <-time.After(5 * time.Millisecond):
			}
			if _, err := io.WriteString(conn, chunk); err != nil {
				close(disconnected)
				return
			}
		}
		report(<-closed, disconnected)
	}
}

func report(err error, disconnected chan<- struct{}) {
	var timeout net.Error
	if err != nil && !(errors.As(err, &timeout) && timeout.Timeout()) {
		close(disconnected)
	}
}

func waitClosed(t *testing.T, disconnected <-chan struct{}) {
	t.Helper()
	select {
	case <-disconnected:
	case <-time.After(2 * time.Second):
		t.Fatal("the fetcher kept the connection open")
	}
}

func tlsFixtureFetcher(t *testing.T, host string, handle func(rawRequest, net.Conn, int)) (*Fetcher, *rawOrigin) {
	t.Helper()
	pki := newPKI(t, host, nil)
	origin := startRawOrigin(t, &pki.leaf, handle)
	f, _ := fixtureFetcher(origin, host)
	f.RootCAs = pki.pool
	return f, origin
}

func TestTlsDeadlineStopsAResponseAndDisposesTheConnection(t *testing.T) {
	disconnected := make(chan struct{})
	f, origin := tlsFixtureFetcher(t, "deadline-tls.example", closeProbe("1\r\nx\r\n", true, disconnected))

	_, err := f.Get(context.Background(), originURL("https", "deadline-tls.example", origin, "/"),
		Limits{Timeout: 2 * time.Second, MaxBytes: 1024})

	wantFailure(t, err, TimedOut)
	waitClosed(t, disconnected)
}

func TestTotalDeadlineSpansTheWholeRedirectChain(t *testing.T) {
	// The budget sits between the second hop's delay and the sum of both,
	// with margins in seconds for a loaded runner.
	origin := startRawOrigin(t, nil, func(request rawRequest, conn net.Conn, _ int) {
		if request.target == "/start" {
			time.Sleep(1500 * time.Millisecond)
		} else {
			time.Sleep(3000 * time.Millisecond)
		}
		redirectThenOK(302, "ok")(request, conn, 0)
	})
	f, _ := fixtureFetcher(origin, "deadline.example")

	_, err := f.Get(context.Background(), originURL("http", "deadline.example", origin, "/start"),
		Limits{Timeout: 4 * time.Second, MaxBytes: 1024, MaxRedirects: 1})

	wantFailure(t, err, TimedOut)
	if got := origin.count.Load(); got != 2 {
		t.Fatalf("%d requests, want 2", got)
	}
}

func TestNonPositiveDeadlineFailsClosedBeforeDns(t *testing.T) {
	for _, timeout := range []time.Duration{0, -time.Millisecond} {
		origin := startRawOrigin(t, nil, okHandler)
		f, resolver := fixtureFetcher(origin, "deadline.example")

		_, err := f.Get(context.Background(), originURL("http", "deadline.example", origin, "/"),
			Limits{Timeout: timeout, MaxBytes: 1024})

		wantFailure(t, err, TimedOut)
		if resolver.calls.Load() != 0 || origin.count.Load() != 0 {
			t.Fatalf("%v: %d lookups and %d requests", timeout, resolver.calls.Load(), origin.count.Load())
		}
	}
}

func TestTotalDeadlineIncludesDnsResolution(t *testing.T) {
	origin := startRawOrigin(t, nil, okHandler)
	f := NewFetcher(&fixturePolicy{host: "slow-dns.example", port: origin.port, allowed: addrs("127.0.0.1")})
	f.Resolve = func(ctx context.Context, _ string) ([]netip.Addr, error) {
		select {
		case <-time.After(150 * time.Millisecond):
			return addrs("127.0.0.1"), nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	_, err := f.Get(context.Background(), originURL("http", "slow-dns.example", origin, "/"),
		Limits{Timeout: 30 * time.Millisecond, MaxBytes: 1024})

	wantFailure(t, err, TimedOut)
	if got := origin.count.Load(); got != 0 {
		t.Fatalf("%d requests, want 0", got)
	}
}

func TestHonorsCallerCancellationBeforeStarting(t *testing.T) {
	origin := startRawOrigin(t, nil, okHandler)
	f, _ := fixtureFetcher(origin, "cancel.example")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := f.Get(ctx, originURL("http", "cancel.example", origin, "/"), testLimits)

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v, want the caller's cancellation", err)
	}
	if got := origin.count.Load(); got != 0 {
		t.Fatalf("%d requests, want 0", got)
	}
}

func cancelAfter(t *testing.T, d time.Duration) context.Context {
	ctx, cancel := context.WithCancel(context.Background())
	timer := time.AfterFunc(d, cancel)
	t.Cleanup(func() {
		timer.Stop()
		cancel()
	})
	return ctx
}

func TestHonorsCallerCancellationWhileStreamingTheBody(t *testing.T) {
	origin := startRawOrigin(t, nil, trickle(10*time.Millisecond, 20))
	f, _ := fixtureFetcher(origin, "cancel.example")

	_, err := f.Get(cancelAfter(t, 40*time.Millisecond), originURL("http", "cancel.example", origin, "/progress"), testLimits)

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v, want the caller's cancellation", err)
	}
}

func TestTlsStreamingPreservesCallerCancellation(t *testing.T) {
	f, origin := tlsFixtureFetcher(t, "cancel-tls.example", trickle(5*time.Millisecond, 100))

	_, err := f.Get(cancelAfter(t, 75*time.Millisecond), originURL("https", "cancel-tls.example", origin, "/"), testLimits)

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v, want the caller's cancellation", err)
	}
}

func TestAppliesTheBodyCapAfterGzipDecompression(t *testing.T) {
	compressed := gzipBytes(t, bytes.Repeat([]byte("x"), 1024))
	if len(compressed) >= 64 {
		t.Fatalf("compressed to %d bytes", len(compressed))
	}
	origin := startRawOrigin(t, nil, gzipAnswer(compressed))
	f, _ := fixtureFetcher(origin, "gzip.example")

	_, err := f.Get(context.Background(), originURL("http", "gzip.example", origin, "/large.gz"),
		Limits{Timeout: 2 * time.Second, MaxBytes: 64})

	wantFailure(t, err, TooLarge)
}

func TestAcceptsGzipWhoseRawBodyExactlyMatchesTheCap(t *testing.T) {
	compressed := gzipBytes(t, []byte("x"))
	origin := startRawOrigin(t, nil, gzipAnswer(compressed))
	f, _ := fixtureFetcher(origin, "raw-exact.example")

	response, err := f.Get(context.Background(), originURL("http", "raw-exact.example", origin, "/exact.gz"),
		Limits{Timeout: 2 * time.Second, MaxBytes: int64(len(compressed))})
	if err != nil {
		t.Fatal(err)
	}
	defer response.Release()

	if string(response.Body) != "x" {
		t.Fatalf("body %q", response.Body)
	}
}

func TestAcceptsGzipWhoseDecodedBodyExactlyMatchesTheCap(t *testing.T) {
	body := bytes.Repeat([]byte("x"), 64)
	compressed := gzipBytes(t, body)
	if len(compressed) >= len(body) {
		t.Fatalf("compressed to %d bytes", len(compressed))
	}
	origin := startRawOrigin(t, nil, gzipAnswer(compressed))
	f, _ := fixtureFetcher(origin, "decoded-exact.example")

	response, err := f.Get(context.Background(), originURL("http", "decoded-exact.example", origin, "/exact.gz"),
		Limits{Timeout: 2 * time.Second, MaxBytes: int64(len(body))})
	if err != nil {
		t.Fatal(err)
	}
	defer response.Release()

	if !bytes.Equal(response.Body, body) {
		t.Fatalf("body %q", response.Body)
	}
}

func concatenatedGzip(t *testing.T) []byte {
	t.Helper()
	var members []byte
	for range 100 {
		members = append(members, gzipBytes(t, []byte("x"))...)
	}
	if len(members) <= 128 {
		t.Fatalf("members are %d bytes", len(members))
	}
	return members
}

func TestRejectsConcatenatedGzipWhenRawBytesExceedTheCap(t *testing.T) {
	origin := startRawOrigin(t, nil, gzipAnswer(concatenatedGzip(t)))
	f, _ := fixtureFetcher(origin, "raw-gzip.example")

	_, err := f.Get(context.Background(), originURL("http", "raw-gzip.example", origin, "/members.gz"),
		Limits{Timeout: 2 * time.Second, MaxBytes: 128})

	wantFailure(t, err, TooLarge)
}

func TestRejectsChunkedGzipWhenRawBytesExceedTheCap(t *testing.T) {
	compressed := concatenatedGzip(t)
	origin := startRawOrigin(t, nil, func(_ rawRequest, conn net.Conn, _ int) {
		write(conn, "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
			fmt.Sprintf("%X\r\n", len(compressed)), string(compressed), "\r\n0\r\n\r\n")
	})
	f, _ := fixtureFetcher(origin, "chunked-gzip.example")

	_, err := f.Get(context.Background(), originURL("http", "chunked-gzip.example", origin, "/members.gz"),
		Limits{Timeout: 2 * time.Second, MaxBytes: 128})

	wantFailure(t, err, TooLarge)
}

func getWithin(t *testing.T, f *Fetcher, url string, limits Limits) error {
	t.Helper()
	done := make(chan error, 1)
	go func() {
		response, err := f.Get(context.Background(), url, limits)
		if response != nil {
			response.Release()
		}
		done <- err
	}()
	select {
	case err := <-done:
		return err
	case <-time.After(2 * time.Second):
		t.Fatal("the fetch did not stop at the size limit")
		return nil
	}
}

func TestDisposesTheResponseConnectionAfterTheSizeLimitTrips(t *testing.T) {
	disconnected := make(chan struct{})
	origin := startRawOrigin(t, nil, closeProbe("5\r\nxxxxx\r\n", false, disconnected))
	f, _ := fixtureFetcher(origin, "dispose.example")

	err := getWithin(t, f, originURL("http", "dispose.example", origin, "/oversized"), Limits{Timeout: 5 * time.Second, MaxBytes: 4})

	wantFailure(t, err, TooLarge)
	waitClosed(t, disconnected)
}

func TestTlsSizeLimitDisposesTheConnection(t *testing.T) {
	disconnected := make(chan struct{})
	f, origin := tlsFixtureFetcher(t, "dispose-tls.example", closeProbe("5\r\nxxxxx\r\n", false, disconnected))

	err := getWithin(t, f, originURL("https", "dispose-tls.example", origin, "/"), Limits{Timeout: 5 * time.Second, MaxBytes: 4})

	wantFailure(t, err, TooLarge)
	waitClosed(t, disconnected)
}

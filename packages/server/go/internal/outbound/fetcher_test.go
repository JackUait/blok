package outbound

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
)

// Hand ports of GuardedOutboundFetcherTests that need a resolver or a dial
// seam, which no black-box fixture can reach.

var testLimits = Limits{Timeout: 5 * time.Second, MaxBytes: 1 << 20, MaxRedirects: 5}

// fixturePolicy is the C# FixtureOutboundPolicy: one host and port, and only
// the listed addresses.
type fixturePolicy struct {
	host    string
	port    int
	allowed []netip.Addr
}

func (p *fixturePolicy) Validate(raw string, base *dotnet.URI) (Target, error) {
	url, ok := resolve(raw, base)
	if !ok || url.Host != p.host || url.Port != p.port {
		return Target{}, fail(Blocked)
	}
	return Target{URL: url, Host: url.Host, Port: url.Port}, nil
}

func (p *fixturePolicy) AddressAllowed(address netip.Addr) bool {
	for _, allowed := range p.allowed {
		if address == allowed {
			return true
		}
	}
	return false
}

// recordingPolicy is the C# RecordingOutboundPolicy over DefaultPolicy.
type recordingPolicy struct {
	DefaultPolicy
	decisions []bool
}

func (p *recordingPolicy) AddressAllowed(address netip.Addr) bool {
	allowed := p.DefaultPolicy.AddressAllowed(address)
	p.decisions = append(p.decisions, allowed)
	return allowed
}

type countingResolver struct {
	calls   atomic.Int32
	answers [][]netip.Addr
}

func (c *countingResolver) resolve(_ context.Context, _ string) ([]netip.Addr, error) {
	call := int(c.calls.Add(1)) - 1
	if call >= len(c.answers) {
		call = len(c.answers) - 1
	}
	return c.answers[call], nil
}

func addrs(texts ...string) []netip.Addr {
	var out []netip.Addr
	for _, text := range texts {
		out = append(out, netip.MustParseAddr(text))
	}
	return out
}

func newTestFetcher(policy Policy, resolver *countingResolver) *Fetcher {
	f := NewFetcher(policy)
	f.Resolve = resolver.resolve
	return f
}

type origin struct {
	*httptest.Server
	port     int
	mu       sync.Mutex
	lastHost string
	lastPath string
}

func startOrigin(t *testing.T, network, address string) *origin {
	t.Helper()
	listener, err := net.Listen(network, address)
	if err != nil {
		t.Skipf("cannot listen on %s: %v", address, err)
	}
	o := &origin{}
	o.Server = httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o.mu.Lock()
		o.lastHost, o.lastPath = r.Host, r.URL.RequestURI()
		o.mu.Unlock()
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok"))
	}))
	o.Listener = listener
	o.Start()
	t.Cleanup(o.Close)
	o.port = listener.Addr().(*net.TCPAddr).Port
	return o
}

func TestRejectsTheWholeDNSAnswerWhenAnyCandidateIsBlocked(t *testing.T) {
	resolver := &countingResolver{answers: [][]netip.Addr{addrs("93.184.216.34", "127.0.0.1")}}
	f := newTestFetcher(DefaultPolicy{}, resolver)
	f.dialHook = func(string, string) { t.Error("dialed a blocked answer") }

	_, err := f.Get(context.Background(), "http://mixed.example/", testLimits)
	if !IsFailure(err, Blocked) {
		t.Fatalf("got %v, want Blocked", err)
	}
	if resolver.calls.Load() != 1 {
		t.Fatalf("resolved %d times", resolver.calls.Load())
	}
}

func TestRejectsSiteLocalDNSAnswersBeforeOpeningASocket(t *testing.T) {
	for _, mixed := range []bool{false, true} {
		answer := addrs("fec0::1")
		want := []bool{false}
		if mixed {
			answer, want = addrs("93.184.216.34", "fec0::1"), []bool{true, false}
		}
		resolver := &countingResolver{answers: [][]netip.Addr{answer}}
		policy := &recordingPolicy{}
		f := newTestFetcher(policy, resolver)
		f.dialHook = func(string, string) { t.Error("opened a socket") }

		_, err := f.Get(context.Background(), "http://site-local.example/", testLimits)
		if !IsFailure(err, Blocked) {
			t.Fatalf("mixed=%v: got %v, want Blocked", mixed, err)
		}
		if len(policy.decisions) != len(want) || policy.decisions[0] != want[0] || policy.decisions[len(want)-1] != want[len(want)-1] {
			t.Fatalf("mixed=%v: decisions %v, want %v", mixed, policy.decisions, want)
		}
	}
}

// GuardedOutboundFetcher.cs:174-184: an empty answer blocks, as a forbidden one does.
func TestAnEmptyDNSAnswerIsBlocked(t *testing.T) {
	resolver := &countingResolver{answers: [][]netip.Addr{nil}}
	f := newTestFetcher(DefaultPolicy{}, resolver)
	f.dialHook = func(string, string) { t.Error("dialed with no answer") }

	if _, err := f.Get(context.Background(), "http://empty.example/", testLimits); !IsFailure(err, Blocked) {
		t.Fatalf("got %v, want Blocked", err)
	}
}

func TestResolvesOnceAndConnectsToTheExactFirstValidatedAddress(t *testing.T) {
	o := startOrigin(t, "tcp4", "127.0.0.1:0")
	resolver := &countingResolver{answers: [][]netip.Addr{addrs("127.0.0.1", "127.0.0.2"), addrs("127.0.0.2")}}
	policy := &fixturePolicy{host: "pinned.example", port: o.port, allowed: addrs("127.0.0.1", "127.0.0.2")}
	f := newTestFetcher(policy, resolver)
	var dialed []string
	f.dialHook = func(_, address string) { dialed = append(dialed, address) }

	response, err := f.Get(context.Background(), "http://pinned.example:"+strconv.Itoa(o.port)+"/exact", testLimits)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Release()
	if resolver.calls.Load() != 1 {
		t.Fatalf("resolved %d times", resolver.calls.Load())
	}
	if string(response.Body) != "ok" || response.ContentType != "text/plain; charset=utf-8" || response.StatusCode != 200 {
		t.Fatalf("got %d %q %q", response.StatusCode, response.ContentType, response.Body)
	}
	if want := "http://pinned.example:" + strconv.Itoa(o.port) + "/exact"; response.FinalURL != want {
		t.Fatalf("final URL %q, want %q", response.FinalURL, want)
	}
	if o.lastHost != "pinned.example:"+strconv.Itoa(o.port) || o.lastPath != "/exact" {
		t.Fatalf("origin saw Host %q and %q", o.lastHost, o.lastPath)
	}
	// pinned.example has no real DNS, so reaching the origin at all proves
	// the dial used the vetted address; one dial means no second attempt.
	if len(dialed) != 1 {
		t.Fatalf("dialed %v", dialed)
	}
}

func TestConnectsToTheNextValidatedAddressWhenTheFirstIsUnavailable(t *testing.T) {
	o := startOrigin(t, "tcp4", "127.0.0.1:0")
	resolver := &countingResolver{answers: [][]netip.Addr{addrs("127.0.0.2", "127.0.0.1")}}
	policy := &fixturePolicy{host: "fallback.example", port: o.port, allowed: addrs("127.0.0.2", "127.0.0.1")}
	f := newTestFetcher(policy, resolver)

	response, err := f.Get(context.Background(), "http://fallback.example:"+strconv.Itoa(o.port)+"/fallback", testLimits)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Release()
	if resolver.calls.Load() != 1 || string(response.Body) != "ok" || o.lastPath != "/fallback" {
		t.Fatalf("calls %d, body %q, path %q", resolver.calls.Load(), response.Body, o.lastPath)
	}
}

func TestPinsAnIPv6LiteralWithoutResolvingItAgain(t *testing.T) {
	o := startOrigin(t, "tcp6", "[::1]:0")
	resolver := &countingResolver{answers: [][]netip.Addr{addrs("::1")}}
	f := newTestFetcher(literalPolicy{port: o.port}, resolver)

	response, err := f.Get(context.Background(), "http://[::1]:"+strconv.Itoa(o.port)+"/literal", testLimits)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Release()
	if string(response.Body) != "ok" || resolver.calls.Load() != 0 || o.lastPath != "/literal" {
		t.Fatalf("body %q, calls %d, path %q", response.Body, resolver.calls.Load(), o.lastPath)
	}
}

func TestConnectsToTheExactValidatedIPv6Candidate(t *testing.T) {
	o := startOrigin(t, "tcp6", "[::1]:0")
	resolver := &countingResolver{answers: [][]netip.Addr{addrs("::1", "::2")}}
	policy := &fixturePolicy{host: "ipv6-pinned.example", port: o.port, allowed: addrs("::1", "::2")}
	f := newTestFetcher(policy, resolver)

	response, err := f.Get(context.Background(), "http://ipv6-pinned.example:"+strconv.Itoa(o.port)+"/ipv6", testLimits)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Release()
	if string(response.Body) != "ok" || resolver.calls.Load() != 1 || o.lastPath != "/ipv6" {
		t.Fatalf("body %q, calls %d, path %q", response.Body, resolver.calls.Load(), o.lastPath)
	}
}

// literalPolicy is the C# LiteralFixturePolicy: only [::1] at one port.
type literalPolicy struct{ port int }

func (p literalPolicy) Validate(raw string, base *dotnet.URI) (Target, error) {
	url, ok := resolve(raw, base)
	if !ok || url.Port != p.port {
		return Target{}, fail(Blocked)
	}
	return Target{URL: url, Host: "::1", Port: p.port, Literal: netip.MustParseAddr("::1")}, nil
}

func (literalPolicy) AddressAllowed(address netip.Addr) bool {
	return address == netip.MustParseAddr("::1")
}

// HoldsFourConcurrentResponsesUntilOneIsDisposed: a slot stays taken until
// the caller releases the response, not just until the body is read.
func TestHoldsFourResponsesUntilOneIsReleased(t *testing.T) {
	o := startOrigin(t, "tcp4", "127.0.0.1:0")
	policy := &fixturePolicy{host: "bounded.example", port: o.port, allowed: addrs("127.0.0.1")}
	f := newTestFetcher(policy, &countingResolver{answers: [][]netip.Addr{addrs("127.0.0.1")}})
	url := "http://bounded.example:" + strconv.Itoa(o.port) + "/"
	var held []*Response
	for i := 0; i < 4; i++ {
		response, err := f.Get(context.Background(), url, testLimits)
		if err != nil {
			t.Fatal(err)
		}
		held = append(held, response)
	}
	fifth := make(chan error, 1)
	go func() {
		response, err := f.Get(context.Background(), url, testLimits)
		if err == nil {
			response.Release()
		}
		fifth <- err
	}()
	select {
	case err := <-fifth:
		t.Fatalf("a fifth fetch ran while four were held: %v", err)
	case <-time.After(300 * time.Millisecond):
	}
	held[0].Release()
	select {
	case err := <-fifth:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the fifth fetch never ran after a release")
	}
	for _, response := range held[1:] {
		response.Release()
	}
}

// GuardedOutboundFetcherTests.RejectsTheRedirectAfterTheConfiguredCap.
func TestRejectsTheRedirectAfterTheConfiguredCap(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Location", "/"+strconv.Itoa(int(requests.Add(1))))
		w.WriteHeader(http.StatusFound)
	}))
	t.Cleanup(server.Close)
	port := server.Listener.Addr().(*net.TCPAddr).Port
	resolver := &countingResolver{answers: [][]netip.Addr{addrs("127.0.0.1")}}
	policy := &fixturePolicy{host: "cap.example", port: port, allowed: addrs("127.0.0.1")}
	f := newTestFetcher(policy, resolver)
	limits := Limits{Timeout: 2 * time.Second, MaxBytes: 1024, MaxRedirects: 2}

	_, err := f.Get(context.Background(), "http://cap.example:"+strconv.Itoa(port)+"/0", limits)
	if !IsFailure(err, TooManyRedirects) {
		t.Fatalf("got %v, want TooManyRedirects", err)
	}
	if requests.Load() != 3 || resolver.calls.Load() != 3 {
		t.Fatalf("%d requests and %d lookups, want 3 and 3", requests.Load(), resolver.calls.Load())
	}
}

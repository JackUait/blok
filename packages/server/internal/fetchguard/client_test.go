package fetchguard_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/doyensec/safeurl"

	"github.com/JackUait/blok/packages/server/internal/fetchguard"
)

// newStrictClient builds the client exactly as production does: no escape
// hatch, so safeurl's own address filter is what decides every case.
func newStrictClient() *fetchguard.Client {
	return fetchguard.New(fetchguard.Config{
		Timeout:      2 * time.Second,
		MaxBytes:     1 << 20, // 1 MiB
		MaxRedirects: 3,
	})
}

// newClient reaches httptest servers, which bind 127.0.0.1 on a random high
// port — both refused in production. See Config.TestOnlyAllowedAddrs: the
// allowlist it opens is EXCLUSIVE, so nothing this client accepts or refuses
// says anything about the production address filter.
func newClient(servers ...*httptest.Server) *fetchguard.Client {
	addrs := make([]string, 0, len(servers))
	for _, srv := range servers {
		addrs = append(addrs, addrOf(srv))
	}

	return fetchguard.New(fetchguard.Config{
		Timeout:              2 * time.Second,
		MaxBytes:             1 << 20, // 1 MiB
		MaxRedirects:         3,
		TestOnlyAllowedAddrs: addrs,
	})
}

func addrOf(srv *httptest.Server) string {
	return strings.TrimPrefix(srv.URL, "http://")
}

// Which safeurl gate refused a request. The distinction matters: a case caught
// by the port allowlist proves nothing about the address filter.
type gate struct {
	name  string
	match func(error) bool
}

var (
	addressGate = gate{"safeurl.AllowedIPError", func(err error) bool {
		var e *safeurl.AllowedIPError

		return errors.As(err, &e)
	}}
	portGate = gate{"safeurl.AllowedPortError", func(err error) bool {
		var e *safeurl.AllowedPortError

		return errors.As(err, &e)
	}}
	ipv6Gate = gate{"safeurl.IPv6BlockedError", func(err error) bool {
		var e *safeurl.IPv6BlockedError

		return errors.As(err, &e)
	}}
	credentialsGate = gate{"safeurl.SendingCredentialsBlockedError", func(err error) bool {
		var e *safeurl.SendingCredentialsBlockedError

		return errors.As(err, &e)
	}}
)

func assertBlocked(t *testing.T, err error, want *gate) {
	t.Helper()

	if !errors.Is(err, fetchguard.ErrBlockedAddress) {
		t.Fatalf("err = %v, want ErrBlockedAddress", err)
	}
	if want != nil && !want.match(err) {
		t.Fatalf("err = %v, want it to unwrap to %s", err, want.name)
	}
}

// The cloud metadata address, written three ways. Decimal and IPv6-mapped
// forms are the classic filter bypasses and every one must be refused.
func TestRejectsMetadataAddressInEveryNotation(t *testing.T) {
	cases := []struct {
		raw string
		// nil means "refusal is the only portable claim" — see the decimal case.
		gate *gate
	}{
		// A literal: no resolver involved, so the address filter is what fires.
		{"http://169.254.169.254/latest/meta-data/", &addressGate},

		// Also a literal. Go unmaps ::ffff:a.b.c.d and dials tcp4 169.254.169.254,
		// so this is caught by the address filter and NOT by the IPv6 switch —
		// disabling IPv6 would not save us here.
		{"http://[::ffff:169.254.169.254]/latest/meta-data/", &addressGate},

		// Decimal (inet_aton) form. Which gate catches it depends on the
		// resolver: getaddrinfo normalizes it to 169.254.169.254 and the address
		// filter fires, while Go's pure resolver sends it as a DNS name and gets
		// NXDOMAIN. Both refuse, so only the refusal is portable to assert.
		{"http://2852039166/latest/meta-data/", nil},
	}

	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			_, err := newStrictClient().Get(context.Background(), tc.raw)
			assertBlocked(t, err, tc.gate)
		})
	}
}

// The loopback and private ranges, and which gate actually stops each one.
// Under the strict client no IP allowlist is configured, so an AllowedIPError
// can only have come from safeurl's private-range blocklist — these cases are
// the only proof in this file that the address filter itself fires.
func TestRejectsLoopbackAndPrivateAddresses(t *testing.T) {
	cases := []struct {
		raw  string
		gate *gate
	}{
		// Port 22 is outside the default {80, 443} allowlist, and the port check
		// runs BEFORE the address check — so this never reaches the filter.
		{"http://127.0.0.1:22/", &portGate},

		// Port 80: the address filter is what refuses these.
		{"http://127.0.0.1/", &addressGate},
		{"http://10.0.0.1/internal", &addressGate},

		// IPv6 is off by default, so a v6 literal is dropped before the address
		// check. Written as a literal on purpose: what "localhost" resolves to
		// first is an /etc/hosts detail, and would make the gate non-deterministic.
		{"http://[::1]/", &ipv6Gate},
	}

	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			_, err := newStrictClient().Get(context.Background(), tc.raw)
			assertBlocked(t, err, tc.gate)
		})
	}
}

func TestRejectsNonHTTPScheme(t *testing.T) {
	for _, raw := range []string{
		"file:///etc/passwd",
		"gopher://example.com/",
		"ftp://example.com/",
		"javascript:alert(1)",
		"data:text/html,<script>alert(1)</script>",
		"example.com/no-scheme",
	} {
		t.Run(raw, func(t *testing.T) {
			if _, err := newStrictClient().Get(context.Background(), raw); !errors.Is(err, fetchguard.ErrBadScheme) {
				t.Fatalf("err = %v, want ErrBadScheme", err)
			}
		})
	}
}

// Credentials in the URL are refused. This pins that we never called
// AllowSendingCredentials(true) — with it on, a consumer-supplied URL could
// replay the operator's basic-auth to any host it reached.
func TestRejectsCredentialsInURL(t *testing.T) {
	_, err := newStrictClient().Get(context.Background(), "http://admin:secret@example.com/")
	assertBlocked(t, err, &credentialsGate)
}

// A host that redirects into a private range must be refused at the hop, not
// merely validated once at the start. Under the test allowlist 10.0.0.1 is
// refused for being outside that exclusive list rather than for being private
// — the property under test here is that the hop is re-dialed and re-guarded
// at all. TestRejectsLoopbackAndPrivateAddresses proves the private-range
// filter itself.
func TestRejectsRedirectIntoPrivateRange(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://10.0.0.1/internal", http.StatusFound)
	}))
	defer srv.Close()

	_, err := newClient(srv).Get(context.Background(), srv.URL)
	assertBlocked(t, err, &addressGate)
}

func TestRejectsRedirectLoop(t *testing.T) {
	var srv *httptest.Server

	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, srv.URL+"/next", http.StatusFound)
	}))
	defer srv.Close()

	_, err := newClient(srv).Get(context.Background(), srv.URL)
	if !errors.Is(err, fetchguard.ErrTooManyRedirects) {
		t.Fatalf("err = %v, want ErrTooManyRedirects", err)
	}
}

// redirectChain serves /0 → /1 → … → /hops, where /hops answers 200. Starting
// at /0 therefore costs exactly `hops` redirects.
func redirectChain(t *testing.T, hops int) *httptest.Server {
	t.Helper()

	var srv *httptest.Server

	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n, err := strconv.Atoi(strings.TrimPrefix(r.URL.Path, "/"))
		if err != nil {
			http.Error(w, "bad hop", http.StatusBadRequest)

			return
		}
		if n >= hops {
			_, _ = w.Write([]byte("arrived"))

			return
		}
		http.Redirect(w, r, fmt.Sprintf("%s/%d", srv.URL, n+1), http.StatusFound)
	}))
	t.Cleanup(srv.Close)

	return srv
}

// MaxRedirects is a hop count, not a request count: exactly MaxRedirects hops
// are followed and the next one is refused.
func TestFollowsExactlyMaxRedirectsHops(t *testing.T) {
	srv := redirectChain(t, 3)

	resp, err := newClient(srv).Get(context.Background(), srv.URL+"/0")
	if err != nil {
		t.Fatalf("3 hops with MaxRedirects=3: err = %v, want nil", err)
	}
	if string(resp.Body) != "arrived" {
		t.Fatalf("body = %q, want %q", resp.Body, "arrived")
	}
	if want := srv.URL + "/3"; resp.FinalURL != want {
		t.Fatalf("FinalURL = %q, want %q", resp.FinalURL, want)
	}
}

func TestRefusesOneHopPastMaxRedirects(t *testing.T) {
	srv := redirectChain(t, 4)

	if _, err := newClient(srv).Get(context.Background(), srv.URL+"/0"); !errors.Is(err, fetchguard.ErrTooManyRedirects) {
		t.Fatalf("4 hops with MaxRedirects=3: err = %v, want ErrTooManyRedirects", err)
	}
}

func TestStopsReadingOversizedBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		chunk := strings.Repeat("x", 64*1024)
		for i := 0; i < 64; i++ { // 4 MiB, well past the 1 MiB cap
			if _, err := w.Write([]byte(chunk)); err != nil {
				return
			}
		}
	}))
	defer srv.Close()

	_, err := newClient(srv).Get(context.Background(), srv.URL)
	if !errors.Is(err, fetchguard.ErrTooLarge) {
		t.Fatalf("err = %v, want ErrTooLarge", err)
	}
}

func TestKeepsABodyExactlyAtTheCap(t *testing.T) {
	const size = 4096

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(strings.Repeat("x", size)))
	}))
	defer srv.Close()

	c := fetchguard.New(fetchguard.Config{
		Timeout:              2 * time.Second,
		MaxBytes:             size,
		MaxRedirects:         3,
		TestOnlyAllowedAddrs: []string{addrOf(srv)},
	})

	resp, err := c.Get(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("err = %v, want nil", err)
	}
	if len(resp.Body) != size {
		t.Fatalf("len(body) = %d, want %d", len(resp.Body), size)
	}
}

func TestTimesOut(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer srv.Close()

	c := fetchguard.New(fetchguard.Config{
		Timeout:              200 * time.Millisecond,
		MaxBytes:             1 << 20,
		MaxRedirects:         3,
		TestOnlyAllowedAddrs: []string{addrOf(srv)},
	})

	if _, err := c.Get(context.Background(), srv.URL); err == nil {
		t.Fatal("err = nil, want a timeout error")
	}
}

func TestHonoursACancelledCallerContext(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()
	defer cancel()

	if _, err := newClient(srv).Get(ctx, srv.URL); err == nil {
		t.Fatal("err = nil, want a cancellation error")
	}
}

func TestAllowsAnOrdinaryPublicResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<html><head><title>hi</title></head></html>"))
	}))
	defer srv.Close()

	resp, err := newClient(srv).Get(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("err = %v, want nil", err)
	}
	if !strings.Contains(string(resp.Body), "<title>hi</title>") {
		t.Fatalf("body = %q", resp.Body)
	}
	if resp.ContentType != "text/html; charset=utf-8" {
		t.Fatalf("ContentType = %q", resp.ContentType)
	}
	if resp.FinalURL != srv.URL {
		t.Fatalf("FinalURL = %q, want %q", resp.FinalURL, srv.URL)
	}
}

// Task 4 and Task 9 both depend on this seam existing so their handlers can be
// tested without a network.
func TestClientSatisfiesGetter(t *testing.T) {
	var _ fetchguard.Getter = newStrictClient()
}

// A 404 or a 502 is a perfectly successful fetch of an error page: no transport
// failed, so Get returns a Response and the caller cannot tell it apart from
// the real thing without the status. Without this field /unfurl builds a link
// card titled "Page not found" out of the error page's own <title> and og: tags.
func TestReportsTheStatusOfANonSuccessResponse(t *testing.T) {
	for _, status := range []int{http.StatusNotFound, http.StatusBadGateway, http.StatusForbidden} {
		t.Run(strconv.Itoa(status), func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(status)
				_, _ = w.Write([]byte("<html><head><title>Page not found</title></head></html>"))
			}))
			defer srv.Close()

			resp, err := newClient(srv).Get(context.Background(), srv.URL)
			if err != nil {
				t.Fatalf("err = %v, want nil: an error page is a successful fetch", err)
			}
			if resp.StatusCode != status {
				t.Fatalf("StatusCode = %d, want %d", resp.StatusCode, status)
			}
		})
	}
}

func TestReportsTheStatusOfASuccessfulResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	}))
	defer srv.Close()

	resp, err := newClient(srv).Get(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("err = %v, want nil", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("StatusCode = %d, want 200", resp.StatusCode)
	}
}

// The status is the one at the END of the redirect chain, not the 302 that
// started it — a redirect to a dead page must read as dead.
func TestReportsTheStatusAtTheEndOfARedirectChain(t *testing.T) {
	var srv *httptest.Server

	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/gone" {
			w.WriteHeader(http.StatusNotFound)

			return
		}
		http.Redirect(w, r, srv.URL+"/gone", http.StatusFound)
	}))
	defer srv.Close()

	resp, err := newClient(srv).Get(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("err = %v, want nil", err)
	}
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("StatusCode = %d, want 404", resp.StatusCode)
	}
}

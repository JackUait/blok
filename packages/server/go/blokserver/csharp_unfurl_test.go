package blokserver

import (
	"context"
	"crypto/x509"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/internal/outbound"
)

// Twins of the C# UnfurlEndpointTests cases with no Go test. C# stubs the
// fetcher; Go's is concrete, so a real loopback origin stands in.

func unfurlServer(t *testing.T, handler http.HandlerFunc) (*Server, string) {
	t.Helper()
	origin := httptest.NewServer(handler)
	t.Cleanup(origin.Close)
	port, _ := strconv.Atoi(strings.TrimPrefix(origin.URL, "http://127.0.0.1:"))
	o := DefaultOptions()
	o.StorageDirectory = t.TempDir()
	o.PublicURL = "https://uploads.example.com/files/"
	o.UnfurlEnabled = true
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	s.fetcher = outbound.NewFetcher(outbound.ExactOriginPolicy{Origin: origin.URL, Port: port})
	return s, origin.URL
}

// examplePolicy admits only https://example.com:PORT and pins it to
// 127.0.0.1, so the page's final URL is https as in C#'s stub.
type examplePolicy struct{ port int }

func (p examplePolicy) Validate(raw string, base *dotnet.URI) (outbound.Target, error) {
	u, ok := dotnet.ParseAbsoluteURI(raw)
	if base != nil {
		u, ok = dotnet.ResolveURI(base, raw)
	}
	if !ok || u.Scheme != "https" || u.Host != "example.com" || u.Port != p.port || u.UserInfo != "" {
		return outbound.Target{}, &outbound.Error{Failure: outbound.Blocked}
	}
	return outbound.Target{URL: u, Host: "example.com", Port: p.port}, nil
}

func (examplePolicy) AddressAllowed(address netip.Addr) bool {
	return address == netip.AddrFrom4([4]byte{127, 0, 0, 1})
}

// httpsUnfurlServer serves handler over TLS as https://example.com:PORT.
func httpsUnfurlServer(t *testing.T, handler http.HandlerFunc) (*Server, string) {
	t.Helper()
	origin := httptest.NewTLSServer(handler)
	t.Cleanup(origin.Close)
	if !slices.Contains(origin.Certificate().DNSNames, "example.com") {
		t.Fatalf("the test certificate names %v", origin.Certificate().DNSNames)
	}
	port := origin.Listener.Addr().(*net.TCPAddr).Port
	o := DefaultOptions()
	o.StorageDirectory = t.TempDir()
	o.PublicURL = "https://uploads.example.com/files/"
	o.UnfurlEnabled = true
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	s.fetcher = outbound.NewFetcher(examplePolicy{port})
	s.fetcher.Resolve = func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.AddrFrom4([4]byte{127, 0, 0, 1})}, nil
	}
	s.fetcher.Roots = []*x509.Certificate{origin.Certificate()}
	return s, "https://example.com:" + strconv.Itoa(port)
}

func unfurlOf(t *testing.T, s *Server, target string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	s.Handler("").ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/unfurl?url="+url.QueryEscape(target), nil))
	return recorder
}

func TestFetchesThroughTheRegisteredGuardWithFrozenLimits(t *testing.T) {
	var asked []string
	s, origin := httpsUnfurlServer(t, func(w http.ResponseWriter, r *http.Request) {
		asked = append(asked, r.URL.RequestURI())
		if r.URL.Path == "/redirect" {
			http.Redirect(w, r, "/final/page.html?from=redirect", http.StatusFound)
			return
		}
		_, _ = io.WriteString(w, `<title>Plain title</title>
<meta name="description" content="Plain description">
<meta name="twitter:title" content="Twitter title">
<meta name="twitter:description" content="Twitter description">
<meta name="twitter:image" content="/twitter.png">
<meta property="og:title" content="OpenGraph title">
<meta property="og:description" content="OpenGraph description">
<meta property="og:image" content="../images/cover.png?size=2">
<link rel="icon" href="./favicon.svg">`)
	})

	response := unfurlOf(t, s, origin+"/redirect")

	want := `{"success":1,"link":"` + origin + `/final/page.html?from=redirect","meta":{"title":"OpenGraph title",` +
		`"description":"OpenGraph description","image":{"url":"` + origin + `/images/cover.png?size=2"},` +
		`"favicon":"` + origin + `/final/favicon.svg","domain":"example.com"}}` + "\n"
	if response.Code != http.StatusOK || response.Body.String() != want {
		t.Fatalf("%d %s\nwant %s", response.Code, response.Body, want)
	}
	if got := response.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type %q", got)
	}
	if len(asked) != 2 || asked[0] != "/redirect" {
		t.Fatalf("origin saw %v", asked)
	}
	if unfurlLimits.Timeout != 10*time.Second || unfurlLimits.MaxBytes != 2<<20 || unfurlLimits.MaxRedirects != 5 ||
		unfurlLimits.Truncate || unfurlLimits.Upload {
		t.Fatalf("limits %+v", unfurlLimits)
	}
}

func TestNonTwoHundredStatusIsNotParsed(t *testing.T) {
	for _, status := range []int{301, 401, 404, 429, 502} {
		s, origin := unfurlServer(t, func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(status)
			_, _ = io.WriteString(w, "<title>Error page</title>")
		})

		response := unfurlOf(t, s, origin+"/error")

		if response.Code != http.StatusOK || response.Body.String() != "{\"success\":0}\n" {
			t.Fatalf("%d: got %d %s", status, response.Code, response.Body)
		}
	}
}

func TestEveryTwoHundredStatusIsParsed(t *testing.T) {
	for _, status := range []int{200, 203, 226} {
		s, origin := httpsUnfurlServer(t, func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(status)
			_, _ = io.WriteString(w, "<title>T</title>")
		})

		response := unfurlOf(t, s, origin+"/a")

		want := `{"success":1,"link":"` + origin + `/a","meta":{"title":"T","image":{},"favicon":"` + origin +
			`/favicon.ico","domain":"example.com"}}` + "\n"
		if response.Code != http.StatusOK || response.Body.String() != want {
			t.Fatalf("%d: got %d %s\nwant %s", status, response.Code, response.Body, want)
		}
	}
}

// C# holds the response's one permit and checks it is free again. Go's
// fetcher has four slots, so five answers in a row prove each was freed.
func TestDisposesFetchedResponseAfterParsing(t *testing.T) {
	s, origin := unfurlServer(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "<title>T</title>")
	})

	for i := range 5 {
		done := make(chan *httptest.ResponseRecorder, 1)
		go func() { done <- unfurlOf(t, s, origin+"/a") }()
		select {
		case response := <-done:
			if !strings.HasPrefix(response.Body.String(), `{"success":1`) {
				t.Fatalf("call %d: %s", i+1, response.Body)
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("call %d waited for a slot", i+1)
		}
	}
}

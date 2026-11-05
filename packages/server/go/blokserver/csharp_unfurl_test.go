package blokserver

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

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

func unfurlOf(t *testing.T, s *Server, target string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	s.Handler("").ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/unfurl?url="+url.QueryEscape(target), nil))
	return recorder
}

func TestFetchesThroughTheRegisteredGuardWithFrozenLimits(t *testing.T) {
	var asked []string
	s, origin := unfurlServer(t, func(w http.ResponseWriter, r *http.Request) {
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

	// The origin is plain http, so BrowserURL drops the image and the
	// favicon; C#'s stub answers from https. unfurl-html.json pins those.
	want := `{"success":1,"link":"` + origin + `/final/page.html?from=redirect","meta":{"title":"OpenGraph title",` +
		`"description":"OpenGraph description","image":{},"domain":"127.0.0.1"}}` + "\n"
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
		s, origin := unfurlServer(t, func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(status)
			_, _ = io.WriteString(w, "<title>T</title>")
		})

		response := unfurlOf(t, s, origin+"/a")

		want := `{"success":1,"link":"` + origin + `/a","meta":{"title":"T","image":{},"domain":"127.0.0.1"}}` + "\n"
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

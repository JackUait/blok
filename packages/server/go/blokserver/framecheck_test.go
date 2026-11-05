package blokserver

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/outbound"
)

const frameEditor = "http://editor.example"

// A few pages of fixture-origin.ts, answered as frame-check-responses.json
// records them.
func frameOrigin(t *testing.T) *httptest.Server {
	t.Helper()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		page := func(header ...string) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			for i := 0; i < len(header); i += 2 {
				w.Header().Add(header[i], header[i+1])
			}
			_, _ = w.Write([]byte("<html><head><title>t</title></head></html>"))
		}
		oEmbedPage := func(href string) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("X-Frame-Options", "DENY")
			_, _ = w.Write([]byte(`<html><head><title>t</title><link rel="alternate" type="application/json+oembed" href="` + href + `"></head></html>`))
		}
		switch r.URL.Path {
		case "/frame/plain":
			page()
		case "/frame/xfo-deny":
			page("X-Frame-Options", "DENY")
		case "/frame/csp-self":
			page("Content-Security-Policy", "frame-ancestors 'self'")
		case "/frame/csp-overrides-xfo":
			page("Content-Security-Policy", "frame-ancestors *", "X-Frame-Options", "DENY")
		case "/frame/redirect":
			// Only the final response counts, not a refusal on a hop.
			w.Header().Set("X-Frame-Options", "DENY")
			http.Redirect(w, r, "/frame/plain", http.StatusFound)
		case "/frame/oembed-full":
			oEmbedPage("/oembed/full")
		case "/frame/oembed-missing":
			oEmbedPage("/oembed/missing")
		case "/oembed/full":
			_, _ = w.Write([]byte(`{"type":"video","version":"1.0","title":"A talk","author_name":"Someone",` +
				`"provider_name":"VideoSite","thumbnail_url":"https://img.example/t.jpg","thumbnail_width":480,` +
				`"thumbnail_height":360,"width":9000,"height":360,` +
				`"html":"<iframe src=\"https://evil.example\"></iframe><script>alert(1)</script>"}`))
		case "/oembed/missing":
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"title":"gone"}`))
		default:
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	}))
	t.Cleanup(origin.Close)
	return origin
}

func frameCheckServer(t *testing.T, origin *httptest.Server) http.Handler {
	t.Helper()
	o := DefaultOptions()
	o.UnfurlEnabled = true
	o.AllowedOrigins = []string{frameEditor}
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	port, _ := strconv.Atoi(strings.TrimPrefix(origin.URL, "http://127.0.0.1:"))
	s.fetcher = outbound.NewFetcher(outbound.ExactOriginPolicy{Origin: origin.URL, Port: port})
	return s.Handler("")
}

func TestFrameCheckRatesThePageForTheCallingEditor(t *testing.T) {
	origin := frameOrigin(t)
	h := frameCheckServer(t, origin)
	link := func(path string) string { return `"link":"` + origin.URL + path + `"` }
	for _, c := range []struct {
		name, query string
		headers     []string
		status      int
		body        string
	}{
		// The conformance pages are http, so an allowed page reads "insecure".
		{"plain", "url=" + origin.URL + "/frame/plain", []string{"Origin", frameEditor}, 200,
			`{"verdict":"insecure",` + link("/frame/plain") + `}`},
		{"xfo-deny", "url=" + origin.URL + "/frame/xfo-deny", []string{"Origin", frameEditor}, 200,
			`{"verdict":"blocked",` + link("/frame/xfo-deny") + `}`},
		{"csp overrides xfo", "url=" + origin.URL + "/frame/csp-overrides-xfo", []string{"Origin", frameEditor}, 200,
			`{"verdict":"insecure",` + link("/frame/csp-overrides-xfo") + `}`},
		{"redirect", "url=" + origin.URL + "/frame/redirect", []string{"Origin", frameEditor}, 200,
			`{"verdict":"insecure",` + link("/frame/plain") + `}`},
		{"xfo-deny with no Origin", "url=" + origin.URL + "/frame/xfo-deny", nil, 200,
			`{"verdict":"insecure",` + link("/frame/xfo-deny") + `}`},
		{"same-origin with its own embedder", "url=" + origin.URL + "/frame/csp-self&embedder=http://example.com",
			[]string{"Sec-Fetch-Site", "same-origin"}, 200, `{"verdict":"blocked",` + link("/frame/csp-self") + `}`},
		{"same-origin with another embedder", "url=" + origin.URL + "/frame/csp-self&embedder=http://other.example",
			[]string{"Sec-Fetch-Site", "same-origin"}, 200, `{"verdict":"insecure",` + link("/frame/csp-self") + `}`},
		{"same-site with its own embedder", "url=" + origin.URL + "/frame/csp-self&embedder=http://example.com",
			[]string{"Sec-Fetch-Site", "same-site"}, 200, `{"verdict":"insecure",` + link("/frame/csp-self") + `}`},
		{"an allowed embedder with no Origin", "url=" + origin.URL + "/frame/csp-self&embedder=" + frameEditor,
			nil, 200, `{"verdict":"blocked",` + link("/frame/csp-self") + `}`},
		// The oEmbed answer is sanitized: no html, width capped.
		{"oembed-full", "url=" + origin.URL + "/frame/oembed-full", []string{"Origin", frameEditor}, 200,
			`{"verdict":"blocked",` + link("/frame/oembed-full") + `,"oembed":{"title":"A talk","provider_name":"VideoSite",` +
				`"thumbnail_url":"https://img.example/t.jpg","width":4096,"height":360}}`},
		{"oembed-missing", "url=" + origin.URL + "/frame/oembed-missing", []string{"Origin", frameEditor}, 200,
			`{"verdict":"blocked",` + link("/frame/oembed-missing") + `}`},
		{"a 503 page", "url=" + origin.URL + "/error", []string{"Origin", frameEditor}, 200, `{"verdict":"unknown"}`},
		{"a blocked destination", "url=http://127.0.0.2/", []string{"Origin", frameEditor}, 200, `{"verdict":"unknown"}`},
		{"no url", "", []string{"Origin", frameEditor}, 400, `{"verdict":"unknown"}`},
	} {
		query := url.Values{}
		parsed, _ := url.ParseQuery(c.query)
		for name, values := range parsed {
			query[name] = values
		}
		request := httptest.NewRequest(http.MethodGet, "/frame-check?"+query.Encode(), nil)
		for i := 0; i < len(c.headers); i += 2 {
			request.Header.Set(c.headers[i], c.headers[i+1])
		}
		recorder := httptest.NewRecorder()
		h.ServeHTTP(recorder, request)
		if body := strings.TrimSuffix(recorder.Body.String(), "\n"); recorder.Code != c.status || body != c.body {
			t.Errorf("%s:\n got %d %s\nwant %d %s", c.name, recorder.Code, body, c.status, c.body)
		}
		// The guard has already varied on Origin when one was sent.
		if vary := recorder.Header().Values("Vary"); !reflect.DeepEqual(vary, []string{"Origin"}) {
			t.Errorf("%s: Vary %q, want one Origin", c.name, vary)
		}
		if got := recorder.Header().Get("Content-Type"); got != "application/json" {
			t.Errorf("%s: Content-Type %q", c.name, got)
		}
	}
}

// Self follows the connection's scheme: over TLS, an https claim is the
// server's own embedder.
func TestFrameCheckSeesItsOwnHTTPSEmbedder(t *testing.T) {
	origin := frameOrigin(t)
	h := frameCheckServer(t, origin)
	query := url.Values{"url": {origin.URL + "/frame/csp-self"}, "embedder": {"https://example.com"}}
	request := httptest.NewRequest(http.MethodGet, "https://example.com/frame-check?"+query.Encode(), nil)
	request.Header.Set("Sec-Fetch-Site", "same-origin")
	recorder := httptest.NewRecorder()
	h.ServeHTTP(recorder, request)
	if body := recorder.Body.String(); !strings.HasPrefix(body, `{"verdict":"blocked"`) {
		t.Fatalf("got %d %s", recorder.Code, body)
	}
}

// A page with no oEmbed link takes no second hop from the rate limit.
func TestFrameCheckWithoutAnOEmbedLinkChargesOneRequest(t *testing.T) {
	origin := frameOrigin(t)
	o := DefaultOptions()
	o.UnfurlEnabled = true
	o.RateLimitPerMinute = 2
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	port, _ := strconv.Atoi(strings.TrimPrefix(origin.URL, "http://127.0.0.1:"))
	s.fetcher = outbound.NewFetcher(outbound.ExactOriginPolicy{Origin: origin.URL, Port: port})
	h := s.Handler("")
	for i := 1; i <= 2; i++ {
		request := httptest.NewRequest(http.MethodGet, "/frame-check?url="+url.QueryEscape(origin.URL+"/frame/plain"), nil)
		recorder := httptest.NewRecorder()
		h.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusOK {
			t.Fatalf("request %d of a limit of 2: %d %s", i, recorder.Code, recorder.Body.String())
		}
	}
}

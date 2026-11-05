package blokserver

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/outbound"
)

// /unfurl echoes the asked URL and the page's metadata. The JSON encoder
// must keep < > & ' as \uXXXX so the body never holds markup, even if a
// browser opens it as a page. C# gets this from the default JsonSerializer.
func TestUnfurlNeverEchoesMarkup(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, `<html><head><title>&lt;/title&gt;&lt;script&gt;alert('t')&lt;/script&gt;</title>`+
			`<meta property="og:description" content="&lt;img src=x onerror=alert(&quot;d&quot;)&gt;"></head></html>`)
	}))
	defer origin.Close()
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
	target := origin.URL + "/?q=<script>alert('q')</script>&r=\"'&amp;"
	request := httptest.NewRequest(http.MethodGet, "/unfurl?url="+url.QueryEscape(target), nil)
	recorder := httptest.NewRecorder()
	s.Handler("").ServeHTTP(recorder, request)

	body := recorder.Body.String()
	t.Logf("body: %s", body)
	t.Logf("headers: %v", recorder.Header())
	if strings.ContainsAny(body, "<>&'") {
		t.Fatalf("the body holds raw markup: %s", body)
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type %q", got)
	}
}

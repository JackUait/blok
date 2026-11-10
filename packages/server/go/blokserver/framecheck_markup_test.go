package blokserver

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// /frame-check echoes the final URL and the oEmbed title and provider. The
// JSON encoder must keep < > & ' as \uXXXX so the body never holds markup,
// even if a browser opens it as a page. C# gets this from the default
// JsonSerializer; Rust shares jsjson's rule.
func TestFrameCheckNeverEchoesMarkup(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oembed" {
			_, _ = w.Write([]byte(`{"type":"video","version":"1.0","title":"</title><script>alert('t')</script>",` +
				`"provider_name":"<img src=x onerror=alert(\"p\")>&amp;"}`))
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(`<html><head><link rel="alternate" type="application/json+oembed" href="/oembed"></head></html>`))
	}))
	t.Cleanup(origin.Close)
	target := origin.URL + "/?q=<script>alert('q')</script>&r=\"'&amp;"
	request := httptest.NewRequest(http.MethodGet, "/frame-check?url="+url.QueryEscape(target), nil)
	request.Header.Set("Origin", frameEditor)
	recorder := httptest.NewRecorder()
	frameCheckServer(t, origin).ServeHTTP(recorder, request)

	body := recorder.Body.String()
	if strings.ContainsAny(body, "<>&'") {
		t.Fatalf("the body holds raw markup: %s", body)
	}
	// Without these the check above would pass on an empty answer.
	for _, part := range []string{`"link":"`, "\"title\":\"\\u003C/title\\u003E", "\"provider_name\":\"\\u003Cimg"} {
		if !strings.Contains(body, part) {
			t.Fatalf("body lacks %s: %s", part, body)
		}
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type %q", got)
	}
}

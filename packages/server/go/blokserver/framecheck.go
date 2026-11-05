package blokserver

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/v2/internal/framecheck"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/outbound"
	"github.com/JackUait/blok/packages/server/go/v2/internal/unfurl"
)

const maxOEmbedBytes = 64 << 10

// 256 KiB of page is enough for the head. Truncated, never failed.
var frameCheckLimits = outbound.Limits{Timeout: 10 * time.Second, MaxBytes: 256 << 10, MaxRedirects: 5, Truncate: true}

var framingHeaders = []string{"Content-Security-Policy", "X-Frame-Options"}

// frameCheck is FrameCheckEndpoint: GET /frame-check?url=, a UI hint for
// whether the page would let the calling editor frame it. Never a security
// decision: it cannot see cookies, the full ancestor chain or script
// frame-busting.
func (s *Server) frameCheck(w http.ResponseWriter, r *http.Request) {
	// The verdict depends on the caller's Origin, even when none was sent.
	if !headerHas(w.Header(), "Vary", "Origin") {
		w.Header().Add("Vary", "Origin")
	}
	target := dotnet.QueryFirst(r.URL.RawQuery, "url")
	if target == "" {
		writeJSON(w, http.StatusBadRequest, []byte("{\"verdict\":\"unknown\"}\n"))
		return
	}
	started := time.Now()
	limits := frameCheckLimits
	limits.Hop = s.hopBudget(r)
	limits.Caller = s.fetchCaller(r)
	response, err := s.fetcher.Get(r.Context(), target, limits)
	if err != nil {
		if r.Context().Err() == nil {
			writeJSON(w, http.StatusOK, []byte("{\"verdict\":\"unknown\"}\n"))
		}
		return
	}
	defer response.Release()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		writeJSON(w, http.StatusOK, []byte("{\"verdict\":\"unknown\"}\n"))
		return
	}
	embedder := framecheck.Embedder(frameCheckRequest(r), s.originAllowed)
	var headers []framecheck.Header
	for _, name := range framingHeaders {
		for _, value := range response.Header.Values(name) {
			headers = append(headers, framecheck.Header{Name: name, Value: value})
		}
	}
	body := []byte(`{"verdict":"` + framecheck.Verdict(response.FinalURL, embedder, headers) + `","link":`)
	body = jsjson.AppendQuoted(body, jsjson.FromString(response.FinalURL))
	oEmbedURL := unfurl.Parse(response.Body, response.FinalURL).OEmbed
	redirects := response.Redirects
	// The page's slot is free again before the oEmbed fetch takes one.
	response.Release()
	oEmbed, ok := s.fetchOEmbed(r.Context(), oEmbedURL, limits.Timeout-time.Since(started),
		limits.MaxRedirects-redirects, limits.Hop, limits.Caller)
	if ok {
		body = append(body, `,"oembed":`...)
		body = oEmbed.AppendJSON(body)
	}
	if r.Context().Err() != nil {
		return
	}
	writeJSON(w, http.StatusOK, append(body, "}\n"...))
}

// frameCheckRequest reads what framecheck.Embedder needs. Self is the
// connection's own view, like C#'s Request.Scheme and Request.Host without
// forwarded-header middleware.
func frameCheckRequest(r *http.Request) framecheck.Request {
	_, hasOrigin := r.Header["Origin"]
	self := ""
	if r.Host != "" {
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		self = scheme + "://" + r.Host
	}
	return framecheck.Request{
		Origin: requestOrigin(r), HasOrigin: hasOrigin,
		SecFetchSite: firstValue(r.Header, "Sec-Fetch-Site"),
		Embedder:     dotnet.QueryFirst(r.URL.RawQuery, "embedder"),
		Self:         self,
	}
}

// fetchOEmbed sends the discovered URL through the same guarded fetcher, on
// what is left of the page's deadline and redirect budget, for one more hop.
func (s *Server) fetchOEmbed(ctx context.Context, url string, remaining time.Duration, redirects int,
	hop func() bool, caller string) (framecheck.OEmbed, bool) {
	if url == "" || remaining <= 0 || redirects < 0 || hop != nil && !hop() {
		return framecheck.OEmbed{}, false
	}
	response, err := s.fetcher.Get(ctx, url, outbound.Limits{
		Timeout: remaining, MaxBytes: maxOEmbedBytes, MaxRedirects: redirects, Hop: hop, Caller: caller,
	})
	if err != nil {
		return framecheck.OEmbed{}, false
	}
	defer response.Release()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return framecheck.OEmbed{}, false
	}
	answer := framecheck.ParseOEmbed(response.Body)
	return answer, !answer.Empty()
}

func headerHas(h http.Header, name, value string) bool {
	for _, line := range h.Values(name) {
		for _, item := range strings.Split(line, ",") {
			if strings.EqualFold(strings.TrimSpace(item), value) {
				return true
			}
		}
	}
	return false
}

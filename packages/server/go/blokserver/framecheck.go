package blokserver

import (
	"net/http"
	"strings"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/internal/framecheck"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/outbound"
)

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
	limits := frameCheckLimits
	limits.Hop = s.hopBudget(r)
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
	embedder := requestOrigin(r)
	if !s.originAllowed(embedder) {
		embedder = ""
	}
	var headers []framecheck.Header
	for _, name := range framingHeaders {
		for _, value := range response.Header.Values(name) {
			headers = append(headers, framecheck.Header{Name: name, Value: value})
		}
	}
	body := []byte(`{"verdict":"` + framecheck.Verdict(response.FinalURL, embedder, headers) + `","link":`)
	body = jsjson.AppendQuoted(body, jsjson.FromString(response.FinalURL))
	writeJSON(w, http.StatusOK, append(body, "}\n"...))
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

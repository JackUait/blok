package blokserver

import "net/http"

// fetchCaller is the key outbound fetches share per caller lane: the one the
// guard charged. With the rate limit off there are no per-caller limits.
func (s *Server) fetchCaller(r *http.Request) string {
	if s.options.RateLimitPerMinute <= 0 {
		return ""
	}
	key, _ := r.Context().Value(rateKey{}).(string)
	return key
}

package httpapi

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/JackUait/blok/packages/server/internal/config"
	"github.com/JackUait/blok/packages/server/internal/ticket"
)

// preflightMaxAge is how long a browser may reuse one preflight answer. Chrome
// silently caps this at 600 seconds, so asking for more buys nothing.
const preflightMaxAge = "600"

// rateLimiter is a fixed-window counter keyed by client. A window is coarse but
// sufficient: the goal is to stop this service being used as a scanner, not to
// shape traffic.
type rateLimiter struct {
	mu        sync.Mutex
	perMin    int
	windows   map[string]*window
	now       func() time.Time
	lastSweep time.Time
}

type window struct {
	start time.Time
	count int
}

func newRateLimiter(perMin int, now func() time.Time) *rateLimiter {
	return &rateLimiter{perMin: perMin, windows: map[string]*window{}, now: now, lastSweep: now()}
}

func (l *rateLimiter) allow(key string) bool {
	if l.perMin <= 0 {
		return true
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	l.sweep(now)

	w, ok := l.windows[key]
	if !ok || now.Sub(w.start) >= time.Minute {
		l.windows[key] = &window{start: now, count: 1}

		return true
	}
	if w.count >= l.perMin {
		return false
	}
	w.count++

	return true
}

// sweep discards windows nobody came back for. Without it the map holds one
// entry per distinct client for the life of the process — an unbounded
// allocation driven by anyone who can reach the port. An expired window is
// reset on access anyway, so this changes no decision; it only reclaims the
// keys that never return. Running it at most once a minute keeps the O(n) walk
// off the hot path. There is deliberately no hard entry cap: a fail-closed cap
// lets an attacker lock out real users, and a fail-open one turns the limiter
// off exactly when it is needed.
//
// The caller must hold l.mu.
func (l *rateLimiter) sweep(now time.Time) {
	if now.Sub(l.lastSweep) < time.Minute {
		return
	}
	l.lastSweep = now

	for key, w := range l.windows {
		if now.Sub(w.start) >= time.Minute {
			delete(l.windows, key)
		}
	}
}

func (s *server) guard(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.settleOrigin(w, r) {
			return
		}

		key, ok := s.authorize(w, r)
		if !ok {
			return
		}

		if !s.limiter.allow(key) {
			http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)

			return
		}

		next(w, r)
	}
}

// settleOrigin refuses a caller the allowlist does not name and otherwise marks
// the response readable by that origin. It runs first, and it writes the header
// BEFORE auth and before the rate limit on purpose: without
// Access-Control-Allow-Origin on a 401 or a 429, the browser hands fetch() an
// opaque TypeError, so the app cannot tell "the pass expired, mint another"
// from "the service is down".
func (s *server) settleOrigin(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	permitted := originAllowed(origin, s.opts.AllowedOrigins)

	// A request carrying NO Origin is refused here too. Browsers omit the header
	// on same-origin requests and non-browser callers omit it entirely, so this
	// costs a ticket-mode deployment served from the app's own origin, and any
	// server-to-server caller holding a pass — both have to send Origin
	// explicitly. That is deliberate: the design makes the allowlist a
	// contractual interlock for public mode, and config.Validate refuses to
	// start ticket mode without one. Loosening it to "no Origin means not a
	// browser, let it through" is a change to the contract, not to this code.
	if s.opts.Auth == config.AuthTicket && !permitted {
		http.Error(w, "origin not allowed", http.StatusForbidden)

		return false
	}

	if permitted {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		// The value above is the REQUEST's origin, so a shared cache that does
		// not key on it will hand one origin's response to another.
		w.Header().Add("Vary", "Origin")
	}

	return true
}

// authorize verifies the pass and returns the key the rate limit buckets by.
//
// It runs BEFORE the limiter because the verified pass names the USER, and that
// is the only key that works behind a reverse proxy: there every request
// arrives from the proxy's address, so an address key puts every user of the
// deployment in one bucket. Reversing the order would force the address key,
// which is the worse bug. Verifying first costs one HMAC over a ~100-byte
// token — nothing beside the guarded outbound fetch the limit exists to ration.
func (s *server) authorize(w http.ResponseWriter, r *http.Request) (string, bool) {
	if s.opts.Auth != config.AuthTicket {
		return "addr:" + clientAddr(r), true
	}

	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if token == "" {
		http.Error(w, "missing pass", http.StatusUnauthorized)

		return "", false
	}

	claims, err := ticket.Verify(s.opts.Secret, token, s.opts.Now())
	if err != nil {
		http.Error(w, "invalid pass", http.StatusUnauthorized)

		return "", false
	}
	// A pass with no user names nobody, and "user:" would be ONE bucket shared
	// by every such caller everywhere. The address is a worse key but a
	// narrower one.
	if claims.User == "" {
		return "addr:" + clientAddr(r), true
	}

	return "user:" + claims.User, true
}

// handlePreflight answers the CORS preflight a browser sends before the real
// request.
//
// It is not wrapped in guard, and that is load-bearing twice over. A preflight
// never carries Authorization — the browser strips it — so verifying a pass
// here would fail every ticket-mode request before the real one is ever sent.
// And it is exempt from the rate limit because it performs no outbound fetch,
// while a 429 on a preflight reaches the page as an opaque CORS failure rather
// than a status it can act on.
func (s *server) handlePreflight(method string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if !originAllowed(origin, s.opts.AllowedOrigins) {
			http.Error(w, "origin not allowed", http.StatusForbidden)

			return
		}

		h := w.Header()
		h.Set("Access-Control-Allow-Origin", origin)
		h.Set("Access-Control-Allow-Methods", method+", OPTIONS")
		// Echoed rather than a fixed list: BookmarkConfig.headers in
		// src/tools/link/metadata-fetcher.ts lets a consumer send ARBITRARY
		// headers, and a hard-coded allowlist silently blocks whichever one they
		// picked. Echoing grants nothing — the pass is still what authorizes the
		// real request.
		if requested := r.Header.Get("Access-Control-Request-Headers"); requested != "" {
			h.Set("Access-Control-Allow-Headers", requested)
			h.Add("Vary", "Access-Control-Request-Headers")
		}
		h.Set("Access-Control-Max-Age", preflightMaxAge)
		h.Add("Vary", "Origin")

		w.WriteHeader(http.StatusNoContent)
	}
}

// originAllowed refuses an empty origin outright rather than leaving that to the
// allowlist's contents: a blank entry in the list would otherwise match a
// request that sent no Origin at all.
func originAllowed(origin string, allowlist []string) bool {
	if origin == "" {
		return false
	}

	for _, candidate := range allowlist {
		if strings.EqualFold(strings.TrimSpace(candidate), origin) {
			return true
		}
	}

	return false
}

// clientAddr is the source address with its port removed. net.SplitHostPort is
// what makes this work for IPv6: strings.Cut on ":" returns "[" for
// "[::1]:54321", which puts every IPv6 client on the planet in one bucket.
func clientAddr(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		// RemoteAddr is not always host:port — a Unix-socket listener leaves it
		// a path, and a test sets whatever it likes.
		return strings.Trim(r.RemoteAddr, "[]")
	}

	return host
}

package httpapi

import (
	"net/http"
	"time"

	"github.com/JackUait/blok/packages/server/internal/config"
	"github.com/JackUait/blok/packages/server/internal/fetchguard"
)

// Options carries everything the HTTP layer needs. Later tasks add fields;
// they are all optional so tests can construct a server with only what they use.
type Options struct {
	Version string
	Fetcher fetchguard.Getter

	Auth               config.AuthMode
	Secret             string
	AllowedOrigins     []string
	RateLimitPerMinute int

	// Now is the clock both the pass expiry and the rate-limit window read. It
	// defaults to time.Now; a test injects a frozen one so it need not sleep.
	Now func() time.Time

	// UnfurlDisabled leaves the route unregistered rather than making the
	// handler refuse, so a disabled service answers 404 and no part of the
	// fetch path is reachable at all.
	UnfurlDisabled bool
}

type server struct {
	opts    Options
	mux     *http.ServeMux
	limiter *rateLimiter
}

func New(opts Options) http.Handler {
	if opts.Now == nil {
		opts.Now = time.Now
	}

	s := &server{opts: opts, mux: http.NewServeMux(), limiter: newRateLimiter(opts.RateLimitPerMinute, opts.Now)}

	// Never gated: a readiness probe carries neither a pass nor an Origin.
	s.mux.HandleFunc("GET /health", s.handleHealth)

	if !opts.UnfurlDisabled {
		s.register(http.MethodGet, "/unfurl", s.handleUnfurl)
	}

	return s
}

// register wires a gated route together with the CORS preflight a browser sends
// before it. The pair is not optional: with only "GET /unfurl" in the mux an
// OPTIONS request matches the path but not the method, so ServeMux answers 405
// — and in ticket mode, where the Authorization header makes every request
// non-simple and therefore preflighted, the real request is then never sent at
// all.
//
// One method per path: a second call for the same path panics on the duplicate
// OPTIONS pattern.
func (s *server) register(method, path string, h http.HandlerFunc) {
	s.mux.HandleFunc(method+" "+path, s.guard(h))
	s.mux.HandleFunc("OPTIONS "+path, s.handlePreflight(method))
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

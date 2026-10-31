package blokserver

import (
	"context"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/auth"
	"github.com/JackUait/blok/packages/server/go/internal/blob"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/outbound"
	"github.com/JackUait/blok/packages/server/go/internal/route"
	"github.com/JackUait/blok/packages/server/go/internal/ticket"
)

// Server is a configured Blok server. Build it with New.
type Server struct {
	options    Options
	publicPath string
	limiter    *rateLimiter
	clock      func() time.Time
	fetcher    *outbound.Fetcher

	storeOnce sync.Once
	store     blob.Store
	storeErr  error
}

// New validates o and returns a server. Like AddBlokServer, nothing heavy is
// built until a request needs it.
func New(o Options) (*Server, error) {
	publicPath, err := o.validate()
	if err != nil {
		return nil, err
	}
	o.AllowedOrigins = append([]string(nil), o.AllowedOrigins...)
	if o.RichTextFields != nil {
		fields := make(map[string][]string, len(o.RichTextFields))
		for block, names := range o.RichTextFields {
			fields[block] = append([]string(nil), names...)
		}
		o.RichTextFields = fields
	}
	clock := o.Clock
	if clock == nil {
		clock = time.Now
	}
	s := &Server{
		options:    o,
		publicPath: publicPath,
		clock:      clock,
		fetcher:    outbound.NewFetcher(outbound.DefaultPolicy{}),
	}
	s.limiter = newRateLimiter(o.RateLimitPerMinute, func() time.Time { return s.clock() })
	return s, nil
}

// Drain stops the server's long-lived work before the HTTP server shuts
// down. Without collaboration there is none.
func (s *Server) Drain(context.Context) error { return nil }

// Handler is MapBlokServer: the routes the options switch on under prefix
// ("" for the root), every other path in the group answered 404, and local
// files served at the public URL path, outside the prefix.
func (s *Server) Handler(prefix string) http.Handler {
	prefix = strings.TrimRight(prefix, "/")
	router := &route.Router{}
	o := &s.options

	if s.options.StorageDirectory != "" && s.options.S3Bucket == "" && s.publicPath != "" {
		pattern := s.publicPath + "/{fileName}"
		if s.publicPath == "/" {
			pattern = "/{fileName}"
		}
		router.Handle(pattern, []string{"GET", "HEAD"}, http.HandlerFunc(s.serveLocalFile))
	}

	router.Handle(prefix+"/health", []string{"GET", "HEAD"}, http.HandlerFunc(s.health))
	router.Handle(prefix+"/health", nil, route.MethodNotAllowed("GET, HEAD"))
	if o.UnfurlEnabled {
		s.shell(router, prefix+"/unfurl", "GET", s.unfurl)
	}
	if o.hasStorage() {
		s.shell(router, prefix+"/upload", "POST", s.upload)
		s.shell(router, prefix+"/delete", "POST", s.delete)
		if o.UnfurlEnabled {
			s.shell(router, prefix+"/upload-by-url", "POST", s.uploadByURL)
		}
	}
	return router
}

// shell maps one guarded route with its preflight and its 405 answer.
func (s *Server) shell(router *route.Router, pattern, method string, handler http.HandlerFunc) {
	requireWrite := method != "GET"
	router.Handle(pattern, []string{method}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r, ok := s.guard(w, r, requireWrite); ok {
			handler(w, r)
		}
	}))
	router.Handle(pattern, []string{"OPTIONS"}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.preflight(w, r, method)
	}))
	allow := method + ", OPTIONS"
	switch {
	case method == "POST":
		allow = "OPTIONS, POST"
	case method == "GET" && strings.Contains(pattern, "/sync/"):
		allow = "GET, OPTIONS"
	case method == "GET":
		allow = "GET, HEAD, OPTIONS"
	}
	router.Handle(pattern, nil, route.MethodNotAllowed(allow))
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if strings.EqualFold(r.Method, http.MethodHead) {
		return
	}
	body := []byte(`{"status":"ok","version":`)
	body = jsjson.AppendQuoted(body, jsjson.FromString(s.options.Version))
	writeBody(w, http.StatusOK, append(body, "}\n"...))
}

// requestOrigin is the first Origin header, "" when there is none.
func requestOrigin(r *http.Request) string {
	if values := r.Header.Values("Origin"); len(values) > 0 {
		return values[0]
	}
	return ""
}

// originAllowed is BlokServerCors.IsAllowed: an exact, case-insensitive
// match against a trimmed candidate. An empty origin never matches.
func (s *Server) originAllowed(origin string) bool {
	if origin == "" {
		return false
	}
	for _, candidate := range s.options.AllowedOrigins {
		if strings.EqualFold(strings.TrimSpace(candidate), origin) {
			return true
		}
	}
	return false
}

func (s *Server) preflight(w http.ResponseWriter, r *http.Request, method string) {
	origin := requestOrigin(r)
	if !s.originAllowed(origin) {
		writeText(w, http.StatusForbidden, "origin not allowed\n")
		return
	}
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", origin)
	h.Set("Access-Control-Allow-Methods", method+", OPTIONS")
	if requested := firstValue(r.Header, "Access-Control-Request-Headers"); requested != "" {
		h.Set("Access-Control-Allow-Headers", requested)
		h.Add("Vary", "Access-Control-Request-Headers")
	}
	h.Set("Access-Control-Max-Age", "600")
	h.Add("Vary", "Origin")
	w.WriteHeader(http.StatusNoContent)
}

func firstValue(h http.Header, name string) string {
	if values := h.Values(name); len(values) > 0 {
		return values[0]
	}
	return ""
}

// guard is BlokServerRequestGuard: origin, then ticket, then rate limit.
// CORS headers go on before the ticket and limiter checks so their refusals
// stay readable to the page.
func (s *Server) guard(w http.ResponseWriter, r *http.Request, requireWrite bool) (*http.Request, bool) {
	origin := requestOrigin(r)
	allowed := s.originAllowed(origin)
	_, hasOrigin := r.Header["Origin"]
	required := s.options.Auth == "ticket" || hasOrigin ||
		strings.EqualFold(firstValue(r.Header, "Sec-Fetch-Site"), "cross-site")
	if required && !allowed {
		writeText(w, http.StatusForbidden, "origin not allowed\n")
		return r, false
	}
	if allowed {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Add("Vary", "Origin")
	}
	key := "addr:" + remoteAddress(r)
	if s.options.Auth == "ticket" {
		authorization := firstValue(r.Header, "Authorization")
		pass := strings.TrimPrefix(authorization, "Bearer ")
		if pass == "" {
			writeText(w, http.StatusUnauthorized, "missing pass\n")
			return r, false
		}
		claims, valid := ticket.Verify(s.options.Secret, pass, s.clock())
		if !valid {
			writeText(w, http.StatusUnauthorized, "invalid pass\n")
			return r, false
		}
		if requireWrite && !claims.Write {
			writeText(w, http.StatusForbidden, "write access required\n")
			return r, false
		}
		if claims.User != "" {
			key = "user:" + claims.User
		}
		r = r.WithContext(auth.WithUser(r.Context(), auth.User{
			ID: claims.User, Name: claims.User, Doc: claims.Doc, Write: claims.Write, Authenticated: true,
		}))
	}
	if !s.limiter.allow(key) {
		writeText(w, http.StatusTooManyRequests, "rate limit exceeded\n")
		return r, false
	}
	return r, true
}

// remoteAddress is Connection.RemoteIpAddress: the peer IP without the port.
func remoteAddress(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// writeText is the C# error wire: text/plain, streamed, no nosniff header.
func writeText(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	writeBody(w, status, []byte(body))
}

func writeJSON(w http.ResponseWriter, status int, body []byte) {
	w.Header().Set("Content-Type", "application/json")
	writeBody(w, status, body)
}

// writeBody streams like Kestrel's WriteAsync: no Content-Length.
func writeBody(w http.ResponseWriter, status int, body []byte) {
	route.StartStream(w, status)
	_, _ = w.Write(body)
}

// rateLimiter is FixedWindowRateLimiter: a one-minute window from the first
// hit per key, swept at most once a minute. A limit of 0 or less is off.
type rateLimiter struct {
	mu        sync.Mutex
	limit     int64
	now       func() time.Time
	windows   map[string]*window
	lastSweep time.Time
}

type window struct {
	start time.Time
	count int64
}

func newRateLimiter(limit int64, now func() time.Time) *rateLimiter {
	return &rateLimiter{limit: limit, now: now, windows: map[string]*window{}, lastSweep: now()}
}

func (l *rateLimiter) allow(key string) bool {
	if l.limit <= 0 {
		return true
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if now.Sub(l.lastSweep) >= time.Minute {
		l.lastSweep = now
		for k, w := range l.windows {
			if now.Sub(w.start) >= time.Minute {
				delete(l.windows, k)
			}
		}
	}
	w, ok := l.windows[key]
	if !ok || now.Sub(w.start) >= time.Minute {
		l.windows[key] = &window{start: now, count: 1}
		return true
	}
	if w.count >= l.limit {
		return false
	}
	w.count++
	return true
}

// blobStore is the lazily built store: S3 when a bucket is set, else local.
func (s *Server) blobStore() (blob.Store, error) {
	s.storeOnce.Do(func() {
		if s.options.S3Bucket != "" {
			s.store, s.storeErr = newS3Store(&s.options, s.clock)
			return
		}
		s.store = &blob.Local{Directory: s.options.StorageDirectory, PublicURL: s.options.PublicURL}
	})
	return s.store, s.storeErr
}

// uploadResponse writes UploadWire's {"url","fileName"?,"size"?,"mimeType"?}.
func uploadResponse(w http.ResponseWriter, url, fileName string, size int64, mimeType string) {
	body := []byte(`{"url":`)
	body = jsjson.AppendQuoted(body, jsjson.FromString(url))
	if fileName != "" {
		body = append(body, `,"fileName":`...)
		body = jsjson.AppendQuoted(body, jsjson.FromString(fileName))
	}
	if size != 0 {
		body = append(body, `,"size":`...)
		body = strconv.AppendInt(body, size, 10)
	}
	if mimeType != "" {
		body = append(body, `,"mimeType":`...)
		body = jsjson.AppendQuoted(body, jsjson.FromString(mimeType))
	}
	writeJSON(w, http.StatusOK, append(body, "}\n"...))
}

func newS3Store(o *Options, clock func() time.Time) (blob.Store, error) {
	return blob.NewS3(&blob.S3{
		Endpoint: o.S3Endpoint, Region: o.S3Region, Bucket: o.S3Bucket, AccessKey: o.S3AccessKey,
		SecretKey: o.S3SecretKey, PublicURL: o.S3BucketURL, Addressing: o.S3Addressing,
		MaxSpoolBytes: o.MaxUploadBytes, Now: clock,
	})
}

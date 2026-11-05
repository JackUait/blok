// Package route is a request router that matches paths the way the C# host's
// Kestrel routing does, which net/http's ServeMux does not.
package route

import (
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
)

// Router picks a route like ASP.NET endpoint routing does with the C# host's
// orders. Routes that name methods are order 0 and routes that take any method
// (the 405 fallbacks, WithOrder(1) in C#) are order 1, so they are tried in two
// passes and a match in the first pass always wins. Within a pass the route
// with a literal at the first segment where the matches differ wins, so
// "/health" beats "/{fileName}" whichever was registered first. Among routes
// with the same shape the first registered wins. A request no route matches
// gets the 404 catch-all.
//
// Paths match like Kestrel: literal segments compare case-insensitively
// (ASCII only), one trailing slash is ignored, dot segments are removed
// without a redirect, empty segments match nothing, and %2F stays encoded in
// a parameter value. Method names compare case-insensitively too.
type Router struct {
	routes []entry
	// Fallback answers a request no route matches; nil is NotFound.
	Fallback http.Handler
}

type entry struct {
	segments []segment
	// methods is nil for a route that takes any method.
	methods []string
	handler http.Handler
}

type segment struct {
	literal string
	param   string
}

// Handle maps pattern, such as "/sync/{doc}/state", to h for the given
// methods. Nil methods means any method, which is how a pattern's 405 answer
// is mapped. It panics on a malformed pattern.
func (r *Router) Handle(pattern string, methods []string, h http.Handler) {
	if !strings.HasPrefix(pattern, "/") || pattern == "/" || strings.HasSuffix(pattern, "/") {
		panic("route: bad pattern " + pattern)
	}
	var segments []segment
	for _, part := range strings.Split(pattern[1:], "/") {
		switch {
		case part == "":
			panic("route: empty segment in " + pattern)
		case strings.HasPrefix(part, "{") || strings.HasSuffix(part, "}"):
			name := strings.TrimSuffix(strings.TrimPrefix(part, "{"), "}")
			if len(name) != len(part)-2 || name == "" {
				panic("route: bad parameter in " + pattern)
			}
			segments = append(segments, segment{param: name})
		default:
			segments = append(segments, segment{literal: part})
		}
	}
	r.routes = append(r.routes, entry{segments: segments, methods: methods, handler: h})
}

func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	decoded := decodeKeepingSlash(rawPath(req))
	// Kestrel refuses a decoded NUL in the path, and a raw NUL or any raw
	// byte of 0x80 or above in the target (path or query), before routing.
	if strings.IndexByte(decoded, 0) >= 0 || strings.IndexByte(req.RequestURI, 0) >= 0 || !isASCII(req.RequestURI) {
		badRequest(w)
		return
	}
	parts, ok := pathSegments(decoded)
	if ok {
		for _, anyMethod := range []bool{false, true} {
			var best *entry
			var bestValues map[string]string
			for i := range r.routes {
				e := &r.routes[i]
				if (e.methods == nil) != anyMethod || !e.allows(req.Method) {
					continue
				}
				if values, matched := e.match(parts); matched && (best == nil || e.moreLiteralThan(best)) {
					best, bestValues = e, values
				}
			}
			if best != nil {
				for name, value := range bestValues {
					req.SetPathValue(name, value)
				}
				best.handler.ServeHTTP(w, req)
				return
			}
		}
	}
	if r.Fallback != nil {
		r.Fallback.ServeHTTP(w, req)
		return
	}
	NotFound.ServeHTTP(w, req)
}

// InGroup is whether the request path is prefix itself or below it, as
// MapGroup(prefix)'s "/{**path}" catch-all matches: by segment, ASCII case
// folded. "" is the root group, which takes every path.
func InGroup(req *http.Request, prefix string) bool {
	parts, ok := pathSegments(decodeKeepingSlash(rawPath(req)))
	if !ok {
		return false
	}
	group, _ := pathSegments(prefix)
	if len(parts) < len(group) {
		return false
	}
	for i, literal := range group {
		if !asciiEqualFold(parts[i], literal) {
			return false
		}
	}
	return true
}

func (e entry) allows(method string) bool {
	if e.methods == nil {
		return true
	}
	for _, m := range e.methods {
		if asciiEqualFold(m, method) {
			return true
		}
	}
	return false
}

// moreLiteralThan reports whether e has a literal at the first segment where
// e and other differ in kind. Both matched the same path, so they have the
// same number of segments.
func (e *entry) moreLiteralThan(other *entry) bool {
	for i, s := range e.segments {
		if isParam, otherIsParam := s.param != "", other.segments[i].param != ""; isParam != otherIsParam {
			return otherIsParam
		}
	}
	return false
}

func (e entry) match(parts []string) (map[string]string, bool) {
	if len(parts) != len(e.segments) {
		return nil, false
	}
	var values map[string]string
	for i, s := range e.segments {
		part := parts[i]
		if part == "" {
			return nil, false
		}
		if s.param == "" {
			if !asciiEqualFold(s.literal, part) {
				return nil, false
			}
			continue
		}
		if values == nil {
			values = map[string]string{}
		}
		values[s.param] = part
	}
	return values, true
}

// pathSegments removes dot segments and one trailing slash from the decoded
// path, and splits it. Decoding comes first: Kestrel removes "/%2e/" too. ok
// is false for a path that does not start with "/", such as the "*" of
// "OPTIONS *".
func pathSegments(decoded string) ([]string, bool) {
	if !strings.HasPrefix(decoded, "/") {
		return nil, false
	}
	path := removeDotSegments(decoded)
	path = strings.TrimSuffix(path, "/")
	if path == "" {
		return []string{}, true
	}
	return strings.Split(path[1:], "/"), true
}

// decodeKeepingSlash decodes the path like Kestrel: %2F stays as sent, so a
// decoded slash can never split a segment, and an escape that is not part of
// valid UTF-8 (or is malformed) stays as written. The doc id names the
// journal directory, so decoding "%FF" to a raw byte would split one
// document into two across the C# and Go servers.
func decodeKeepingSlash(s string) string {
	if !strings.Contains(s, "%") {
		return s
	}
	var b strings.Builder
	for {
		i := indexEncodedSlash(s)
		if i < 0 {
			b.WriteString(dotnet.UnescapeDataString(s))
			return b.String()
		}
		b.WriteString(dotnet.UnescapeDataString(s[:i]))
		b.WriteString(s[i : i+3])
		s = s[i+3:]
	}
}

// rawPath is the path as sent. net/url keeps it in RawPath whenever
// re-escaping Path would change it; EscapedPath then re-escapes the whole
// path for a byte like "|", which turns "%Ff" into "%FF", another doc id.
// RawPath, not RequestURI, so a mount under http.StripPrefix still routes.
// A RawPath that does not decode is one SetRawTarget wrote.
func rawPath(req *http.Request) string {
	if raw := req.URL.RawPath; raw != "" {
		if decoded, err := url.PathUnescape(raw); err != nil || decoded == req.URL.Path {
			return raw
		}
	}
	return req.URL.EscapedPath()
}

// SetRawTarget gives req the target as sent, for one Go's url parser
// refused: a bad escape in the path, or a raw control byte. Path gets a bad
// escape as a literal '%', so http.StripPrefix still finds the prefix in it.
// Path keeps dot segments and turns %2F into '/', as net/http's own parse
// does, so it is not the path the router matches: never authorize on it.
func SetRawTarget(req *http.Request, target string) {
	path, query, hasQuery := strings.Cut(target, "?")
	req.RequestURI = target
	req.URL.RawPath = path
	var kept strings.Builder
	for i := 0; i < len(path); i++ {
		kept.WriteByte(path[i])
		if path[i] == '%' && (i+2 >= len(path) || !isHex(path[i+1]) || !isHex(path[i+2])) {
			kept.WriteString("25")
		}
	}
	req.URL.Path, _ = url.PathUnescape(kept.String())
	if hasQuery {
		req.URL.RawQuery = query
	}
}

func isHex(c byte) bool {
	return '0' <= c && c <= '9' || 'a' <= c && c <= 'f' || 'A' <= c && c <= 'F'
}

func isASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= 0x80 {
			return false
		}
	}
	return true
}

func indexEncodedSlash(s string) int {
	for i := 0; i+2 < len(s); i++ {
		if s[i] == '%' && s[i+1] == '2' && (s[i+2] == 'F' || s[i+2] == 'f') {
			return i
		}
	}
	return -1
}

// removeDotSegments is RFC 3986 section 5.2.4 for a path that starts with
// "/". ".." never climbs above the root.
func removeDotSegments(path string) string {
	parts := strings.Split(path[1:], "/")
	out := make([]string, 0, len(parts))
	for i, part := range parts {
		last := i == len(parts)-1
		switch part {
		case ".":
			if last {
				out = append(out, "")
			}
		case "..":
			if len(out) > 0 {
				out = out[:len(out)-1]
			}
			if last {
				out = append(out, "")
			}
		default:
			out = append(out, part)
		}
	}
	return "/" + strings.Join(out, "/")
}

// asciiEqualFold folds A-Z only. strings.EqualFold would also match "ſ" to
// "s", which Kestrel does not.
func asciiEqualFold(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		if lower(a[i]) != lower(b[i]) {
			return false
		}
	}
	return true
}

func lower(c byte) byte {
	if 'A' <= c && c <= 'Z' {
		return c + 'a' - 'A'
	}
	return c
}

// MethodNotAllowed answers 405 with the given Allow value. Written by hand:
// http.Error adds X-Content-Type-Options, which the C# host never sends.
func MethodNotAllowed(allow string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Allow", allow)
		writePlain(w, http.StatusMethodNotAllowed, "Method Not Allowed\n")
	})
}

// badRequest is Kestrel's answer to a NUL in the path: no body, a zero
// length even on HEAD, and the connection closed.
func badRequest(w http.ResponseWriter) {
	w.Header().Set("Connection", "close")
	w.Header().Set("Content-Length", "0")
	w.WriteHeader(http.StatusBadRequest)
}

// NotFound is the catch-all for a path no route matches, whatever the method.
var NotFound http.Handler = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
	writePlain(w, http.StatusNotFound, "404 page not found\n")
})

func writePlain(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	StartStream(w, status)
	_, _ = io.WriteString(w, body)
}

// StartStream sends the status line and headers before any body, so net/http
// adds no Content-Length: chunked on HTTP/1.1, close-delimited on HTTP/1.0,
// and no length header on HEAD. That is how Kestrel frames these answers.
func StartStream(w http.ResponseWriter, status int) {
	w.WriteHeader(status)
	_ = http.NewResponseController(w).Flush()
}

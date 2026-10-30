// Package route is a request router that matches paths the way the C# host's
// Kestrel routing does, which net/http's ServeMux does not.
package route

import (
	"io"
	"net/http"
	"strings"
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
	parts, ok := pathSegments(req.URL.EscapedPath())
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
	NotFound.ServeHTTP(w, req)
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

// pathSegments decodes the escaped path, removes dot segments and one
// trailing slash, and splits it. Decoding comes first: Kestrel removes
// "/%2e/" too. ok is false for a path that does not start with "/", such as
// the "*" of "OPTIONS *".
func pathSegments(escaped string) ([]string, bool) {
	if !strings.HasPrefix(escaped, "/") {
		return nil, false
	}
	path := removeDotSegments(decodeKeepingSlash(escaped))
	path = strings.TrimSuffix(path, "/")
	if path == "" {
		return []string{}, true
	}
	return strings.Split(path[1:], "/"), true
}

// decodeKeepingSlash decodes every %XX except %2F, which stays as sent so a
// decoded slash can never split a segment. A malformed escape stays literal.
func decodeKeepingSlash(s string) string {
	if !strings.Contains(s, "%") {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '%' && i+2 < len(s) {
			hi, okHi := unhex(s[i+1])
			lo, okLo := unhex(s[i+2])
			if okHi && okLo && hi<<4|lo != '/' {
				b.WriteByte(hi<<4 | lo)
				i += 2
				continue
			}
		}
		b.WriteByte(s[i])
	}
	return b.String()
}

func unhex(c byte) (byte, bool) {
	switch {
	case '0' <= c && c <= '9':
		return c - '0', true
	case 'a' <= c && c <= 'f':
		return c - 'a' + 10, true
	case 'A' <= c && c <= 'F':
		return c - 'A' + 10, true
	}
	return 0, false
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

// NotFound is the catch-all for a path no route matches, whatever the method.
var NotFound http.Handler = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
	writePlain(w, http.StatusNotFound, "404 page not found\n")
})

func writePlain(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, body)
}

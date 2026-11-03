// Package framecheck decides whether a page would let an editor frame it,
// from the page's final response headers. It follows CSP3 frame-ancestors
// and the HTML X-Frame-Options processing model, with the editor as the only
// ancestor. C#'s FrameCheckVerdict is the twin; the shared fixture
// frame-check-verdicts.json pins both.
package framecheck

import (
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
)

// The verdicts.
const (
	Allowed  = "allowed"
	Blocked  = "blocked"
	Insecure = "insecure"
	Unknown  = "unknown"
)

// Header is one response header line.
type Header struct{ Name, Value string }

type origin struct {
	scheme string
	host   string
	domain bool
	// port is 0 when it is the scheme's default, like a URL's null port.
	port int
}

func parseOrigin(raw string) (origin, bool) {
	u, ok := dotnet.ParseAbsoluteURI(raw)
	if !ok || !u.IsHTTP() || u.IdnHost == "" || u.UserInfo != "" {
		return origin{}, false
	}
	o := origin{scheme: u.Scheme, host: asciiLower(u.IdnHost), domain: u.HostType == "Dns", port: u.Port}
	if o.port == defaultPort(o.scheme) {
		o.port = 0
	}
	return o, true
}

func defaultPort(scheme string) int {
	switch scheme {
	case "http", "ws":
		return 80
	case "https", "wss":
		return 443
	}
	return -1
}

// Verdict rates finalURL for an embedder origin ("" when unknown).
// Precedence: blocked, then insecure (finalURL is not https), then unknown
// (no embedder), then allowed. Blocked comes first so a refusal shows even
// on an http page.
func Verdict(finalURL, embedder string, headers []Header) string {
	self, ok := parseOrigin(finalURL)
	if !ok {
		return Unknown
	}
	ancestor, known := parseOrigin(embedder)
	if known && blocked(self, ancestor, headers) {
		return Blocked
	}
	if self.scheme != "https" {
		return Insecure
	}
	if !known {
		return Unknown
	}
	return Allowed
}

func blocked(self, ancestor origin, headers []Header) bool {
	sawFrameAncestors := false
	for _, h := range headers {
		if !strings.EqualFold(h.Name, "Content-Security-Policy") {
			continue
		}
		// Report-only policies never block, so only enforced ones are read.
		for _, serialized := range strings.Split(h.Value, ",") {
			sources, ok := frameAncestors(serialized)
			if !ok {
				continue
			}
			sawFrameAncestors = true
			if !matchesSourceList(ancestor, sources, self) {
				return true
			}
		}
	}
	if sawFrameAncestors {
		return false
	}
	return xFrameOptionsBlocks(self, ancestor, headers)
}

func isASCIIWhitespace(c byte) bool {
	return c == '\t' || c == '\n' || c == '\f' || c == '\r' || c == ' '
}

// frameAncestors is CSP3 "parse a serialized CSP", keeping only the first
// frame-ancestors directive.
func frameAncestors(serialized string) ([]string, bool) {
	seen := map[string]bool{}
	for _, token := range strings.Split(serialized, ";") {
		token = strings.TrimFunc(token, func(r rune) bool { return r < 0x80 && isASCIIWhitespace(byte(r)) })
		if token == "" || !isASCII(token) {
			continue
		}
		fields := strings.FieldsFunc(token, func(r rune) bool { return isASCIIWhitespace(byte(r)) })
		name := asciiLower(fields[0])
		if seen[name] {
			continue
		}
		seen[name] = true
		if name == "frame-ancestors" {
			return fields[1:], true
		}
	}
	return nil, false
}

func isASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= 0x80 {
			return false
		}
	}
	return true
}

func asciiLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if 'A' <= c && c <= 'Z' {
			b[i] = c + 'a' - 'A'
		}
	}
	return string(b)
}

// matchesSourceList is CSP3 §6.7.2.7 with a redirect count of 0.
func matchesSourceList(u origin, sources []string, self origin) bool {
	if len(sources) == 0 || len(sources) == 1 && strings.EqualFold(sources[0], "'none'") {
		return false
	}
	for _, expression := range sources {
		if matchesExpression(u, expression, self) {
			return true
		}
	}
	return false
}

var (
	schemeSource = regexp.MustCompile(`^([A-Za-z][A-Za-z0-9+.\-]*):$`)
	hostSource   = regexp.MustCompile(`^(?:([A-Za-z][A-Za-z0-9+.\-]*)://)?(\*|(?:\*\.)?[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.?)(?::([0-9]+|\*))?(/(?:(?:[A-Za-z0-9\-._~!$&'()*+=:@]|%[0-9A-Fa-f]{2})+(?:/(?:[A-Za-z0-9\-._~!$&'()*+=:@]|%[0-9A-Fa-f]{2})*)*)?)?$`)
)

// matchesExpression is CSP3 §6.7.2.8 for an ancestor origin u.
func matchesExpression(u origin, expression string, self origin) bool {
	if expression == "*" {
		return u.scheme == "http" || u.scheme == "https" || u.scheme == self.scheme
	}
	if m := schemeSource.FindStringSubmatch(expression); m != nil {
		return schemePartMatches(m[1], u.scheme)
	}
	if m := hostSource.FindStringSubmatch(expression); m != nil {
		scheme, host, port, path := m[1], m[2], m[3], m[4]
		if scheme != "" && !schemePartMatches(scheme, u.scheme) {
			return false
		}
		if scheme == "" && !schemePartMatches(self.scheme, u.scheme) {
			return false
		}
		if !hostPartMatches(host, u) || !portPartMatches(port, u) {
			return false
		}
		// An origin's URL path serializes as "/".
		return path == "" || pathPartMatches(path, "/")
	}
	if strings.EqualFold(expression, "'self'") {
		if self == u {
			return true
		}
		return self.host == u.host && self.port == u.port &&
			(u.scheme == "https" || self.scheme == "http" && u.scheme == "http")
	}
	return false
}

func schemePartMatches(a, b string) bool {
	a, b = asciiLower(a), asciiLower(b)
	switch {
	case a == b:
		return true
	case a == "http":
		return b == "https"
	case a == "ws":
		return b == "wss" || b == "http" || b == "https"
	case a == "wss":
		return b == "https"
	}
	return false
}

func hostPartMatches(pattern string, u origin) bool {
	if !u.domain {
		return false
	}
	if pattern == "*" {
		return true
	}
	if strings.HasPrefix(pattern, "*.") {
		return strings.HasSuffix(u.host, asciiLower(pattern[1:]))
	}
	return asciiLower(pattern) == u.host
}

func portPartMatches(input string, u origin) bool {
	if input == "*" {
		return true
	}
	want := 0
	if input != "" {
		trimmed := strings.TrimLeft(input, "0")
		if len(trimmed) > 5 {
			return false
		}
		want, _ = strconv.Atoi("0" + trimmed)
	}
	if input == "" {
		return u.port == 0
	}
	if want == u.port {
		return true
	}
	return u.port == 0 && want == defaultPort(u.scheme)
}

func pathPartMatches(a, b string) bool {
	if a == "" || a == "/" && b == "" {
		return true
	}
	exact := !strings.HasSuffix(a, "/")
	listA, listB := strings.Split(a, "/"), strings.Split(b, "/")
	if len(listA) > len(listB) || exact && len(listA) != len(listB) {
		return false
	}
	if !exact {
		listA = listA[:len(listA)-1]
	}
	for i, pieceA := range listA {
		if percentDecode(pieceA) != percentDecode(listB[i]) {
			return false
		}
	}
	return true
}

func percentDecode(s string) string {
	decoded, err := url.PathUnescape(s)
	if err != nil {
		return s
	}
	return decoded
}

// xFrameOptionsBlocks is HTML's X-Frame-Options check with one ancestor.
func xFrameOptionsBlocks(self, ancestor origin, headers []Header) bool {
	var lines []string
	for _, h := range headers {
		if strings.EqualFold(h.Name, "X-Frame-Options") {
			lines = append(lines, h.Value)
		}
	}
	if lines == nil {
		return false
	}
	set := map[string]bool{}
	var first string
	for _, value := range getDecodeSplit(strings.Join(lines, ", ")) {
		value = asciiLower(value)
		if len(set) == 0 {
			first = value
		}
		set[value] = true
	}
	if len(set) > 1 {
		return set["deny"] || set["allowall"] || set["sameorigin"]
	}
	switch first {
	case "deny":
		return true
	case "sameorigin":
		return self != ancestor
	}
	return false
}

// getDecodeSplit is Fetch's "get, decode, and split" over a combined value.
func getDecodeSplit(input string) []string {
	var values []string
	position := 0
	var temporary strings.Builder
	for {
		for position < len(input) && input[position] != '"' && input[position] != ',' {
			temporary.WriteByte(input[position])
			position++
		}
		if position < len(input) && input[position] == '"' {
			start := position
			position++
			for position < len(input) {
				c := input[position]
				position++
				if c == '\\' {
					if position < len(input) {
						position++
					}
					continue
				}
				if c == '"' {
					break
				}
			}
			temporary.WriteString(input[start:position])
			if position < len(input) {
				continue
			}
		}
		values = append(values, strings.Trim(temporary.String(), "\t "))
		temporary.Reset()
		if position >= len(input) {
			return values
		}
		position++
	}
}

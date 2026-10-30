package dotnet

import (
	"net/netip"
	"strconv"
	"strings"
	"unicode/utf8"

	"golang.org/x/net/idna"
)

// URI is the part of System.Uri the server reads. Only http and https are
// parsed field by field; any other scheme sets Scheme alone, which is all
// the callers need to refuse it.
type URI struct {
	Scheme string
	// Host is Uri.Host: lowercase ASCII, Unicode kept, IPv6 in brackets.
	Host string
	// IdnHost is Uri.IdnHost: punycode, IPv6 without brackets.
	IdnHost  string
	HostType string
	UserInfo string
	Port     int
	// AbsolutePath, Query and Fragment are escaped, as .NET returns them.
	AbsolutePath string
	Query        string
	Fragment     string
	AbsoluteURI  string
	Loopback     bool

	authority string
}

// IsHTTP reports whether the scheme is http or https.
func (u *URI) IsHTTP() bool { return u.Scheme == "http" || u.Scheme == "https" }

// ParseAbsoluteURI is Uri.TryCreate(s, UriKind.Absolute).
func ParseAbsoluteURI(s string) (*URI, bool) {
	s = trimURIWhitespace(s)
	if strings.HasPrefix(s, "/") || strings.HasPrefix(s, `\`) {
		// .NET reads these as implicit file paths.
		return &URI{Scheme: "file"}, true
	}
	scheme, rest, ok := splitScheme(s)
	if !ok {
		return nil, false
	}
	if scheme != "http" && scheme != "https" {
		return &URI{Scheme: scheme}, true
	}
	if !strings.HasPrefix(rest, "//") {
		return nil, false
	}
	return parseHierarchical(scheme, rest[2:])
}

// ResolveURI is Uri.TryCreate(base, reference) for an http(s) base.
func ResolveURI(base *URI, reference string) (*URI, bool) {
	reference = trimURIWhitespace(reference)
	if strings.HasPrefix(reference, `\\`) {
		return &URI{Scheme: "file"}, true
	}
	if scheme, rest, ok := splitScheme(reference); ok {
		if scheme != base.Scheme || strings.HasPrefix(rest, "//") {
			return ParseAbsoluteURI(reference)
		}
		// "http:x" against an http base is relative, as in .NET.
		reference = rest
	}
	prefix := base.Scheme + "://" + base.authority
	switch {
	case strings.HasPrefix(reference, "//") || strings.HasPrefix(reference, `\\`):
		return ParseAbsoluteURI(base.Scheme + ":" + reference)
	case reference == "":
		return ParseAbsoluteURI(prefix + base.AbsolutePath + base.Query)
	case reference[0] == '#':
		return ParseAbsoluteURI(prefix + base.AbsolutePath + base.Query + reference)
	case reference[0] == '?':
		return ParseAbsoluteURI(prefix + base.AbsolutePath + reference)
	case reference[0] == '/' || reference[0] == '\\':
		return ParseAbsoluteURI(prefix + reference)
	}
	directory := base.AbsolutePath[:strings.LastIndexByte(base.AbsolutePath, '/')+1]
	return ParseAbsoluteURI(prefix + directory + reference)
}

func trimURIWhitespace(s string) string {
	return strings.TrimFunc(s, func(r rune) bool { return r <= ' ' })
}

func splitScheme(s string) (scheme, rest string, ok bool) {
	colon := strings.IndexByte(s, ':')
	if colon < 1 {
		return "", "", false
	}
	for i := 0; i < colon; i++ {
		c := s[i]
		letter := 'a' <= c && c <= 'z' || 'A' <= c && c <= 'Z'
		if !letter && (i == 0 || !('0' <= c && c <= '9' || c == '+' || c == '-' || c == '.')) {
			return "", "", false
		}
	}
	return strings.ToLower(s[:colon]), s[colon+1:], true
}

func parseHierarchical(scheme, s string) (*URI, bool) {
	end := strings.IndexAny(s, "/?#\\")
	if end < 0 {
		end = len(s)
	}
	authority, rest := s[:end], s[end:]
	// A backslash ends the authority only when no '@' follows it there: .NET
	// refuses "host\@other" rather than reading "other" as the host.
	if strings.HasPrefix(rest, `\`) {
		tail := rest
		if stop := strings.IndexAny(tail, "/?#"); stop >= 0 {
			tail = tail[:stop]
		}
		if strings.Contains(tail, "@") {
			return nil, false
		}
	}
	u := &URI{Scheme: scheme}
	if at := strings.LastIndexByte(authority, '@'); at >= 0 {
		u.UserInfo = authority[:at]
		if strings.Contains(u.UserInfo, "@") {
			return nil, false
		}
		authority = authority[at+1:]
	}
	hostText, portText, ok := splitHostPort(authority)
	if strings.HasPrefix(hostText, "[") && len(hostText) < len(authority) && authority[len(hostText)] != ':' {
		// .NET reads text right after "]" as the start of the path.
		rest = "/" + authority[len(hostText):] + rest
		portText, ok = "", true
	}
	if !ok || !u.readHost(hostText) {
		return nil, false
	}
	defaultPort := 80
	if scheme == "https" {
		defaultPort = 443
	}
	u.Port = defaultPort
	if portText != "" {
		if !allDigits(portText) {
			return nil, false
		}
		port, err := strconv.Atoi(portText)
		if err != nil || port > 65535 {
			return nil, false
		}
		u.Port = port
	}

	pathEnd := strings.IndexAny(rest, "?#")
	if pathEnd < 0 {
		pathEnd = len(rest)
	}
	path := strings.ReplaceAll(rest[:pathEnd], `\`, "/")
	rest = rest[pathEnd:]
	if strings.HasPrefix(rest, "?") {
		end := strings.IndexByte(rest, '#')
		if end < 0 {
			end = len(rest)
		}
		u.Query = escapeComponent(rest[:end])
		rest = rest[end:]
	}
	if strings.HasPrefix(rest, "#") {
		u.Fragment = escapeComponent(rest)
	}
	if path == "" {
		path = "/"
	}
	u.AbsolutePath = removeDotSegments(escapeComponent(path))

	u.authority = u.Host
	if u.Port != defaultPort {
		u.authority += ":" + strconv.Itoa(u.Port)
	}
	userInfo := ""
	if u.UserInfo != "" {
		userInfo = u.UserInfo + "@"
	}
	u.AbsoluteURI = scheme + "://" + userInfo + u.authority + u.AbsolutePath + u.Query + u.Fragment
	u.authority = userInfo + u.authority
	return u, true
}

func splitHostPort(authority string) (host, port string, ok bool) {
	if strings.HasPrefix(authority, "[") {
		end := strings.IndexByte(authority, ']')
		if end < 0 {
			return "", "", false
		}
		host, rest := authority[:end+1], authority[end+1:]
		if rest == "" || rest[0] != ':' {
			return host, "", rest == ""
		}
		return host, rest[1:], true
	}
	colon := strings.IndexByte(authority, ':')
	if colon < 0 {
		return authority, "", true
	}
	if strings.IndexByte(authority[colon+1:], ':') >= 0 {
		return "", "", false
	}
	return authority[:colon], authority[colon+1:], true
}

func (u *URI) readHost(host string) bool {
	if host == "" {
		return false
	}
	if strings.HasPrefix(host, "[") {
		inner := host[1 : len(host)-1]
		zone := ""
		if i := strings.IndexByte(inner, '%'); i >= 0 {
			inner, zone = inner[:i], inner[i:]
		}
		address, err := netip.ParseAddr(inner)
		if err != nil || !address.Is6() {
			return false
		}
		text := formatIPv6(address)
		u.Host, u.IdnHost, u.HostType = "["+text+"]", text+zone, "IPv6"
		u.Loopback = IsLoopback(address)
		return true
	}
	if address, ok := ParseIPv4(host); ok {
		u.Host, u.IdnHost, u.HostType = address.String(), address.String(), "IPv4"
		u.Loopback = IsLoopback(address)
		return true
	}
	if strings.Contains(host, "..") {
		return false
	}
	for _, r := range host {
		if r < 0x80 && !(r == '-' || r == '.' || r == '_' || '0' <= r && r <= '9' || 'a' <= r && r <= 'z' || 'A' <= r && r <= 'Z') {
			return false
		}
	}
	u.Host = asciiLower(host)
	u.HostType = "Dns"
	u.IdnHost = u.Host
	if !isASCII(host) {
		idn, err := idnaProfile.ToASCII(host)
		if err != nil {
			return false
		}
		u.IdnHost = idn
	}
	u.Loopback = u.Host == "localhost"
	return true
}

var idnaProfile = idna.New(idna.MapForLookup(), idna.StrictDomainName(false), idna.VerifyDNSLength(false))

// formatIPv6 writes an IPv4-mapped or IPv4-compatible address with a dotted
// tail, as .NET does.
func formatIPv6(address netip.Addr) string {
	b := address.As16()
	zero := true
	for _, v := range b[:10] {
		if v != 0 {
			zero = false
		}
	}
	if zero && (b[10] == 0xff && b[11] == 0xff || b[10] == 0 && b[11] == 0 && (b[12] != 0 || b[13] != 0)) {
		prefix := "::"
		if b[10] == 0xff {
			prefix = "::ffff:"
		}
		return prefix + netip.AddrFrom4([4]byte{b[12], b[13], b[14], b[15]}).String()
	}
	return address.String()
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

const upperHex = "0123456789ABCDEF"

// escapeComponent escapes what .NET escapes in a path, query or fragment,
// decodes escaped unreserved characters, and keeps other escapes as sent.
func escapeComponent(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); {
		c := s[i]
		if c == '%' {
			if i+2 < len(s) && isHex(s[i+1]) && isHex(s[i+2]) {
				decoded := unhex(s[i+1])<<4 | unhex(s[i+2])
				if isUnreserved(decoded) {
					b.WriteByte(decoded)
				} else {
					b.WriteString(s[i : i+3])
				}
				i += 3
				continue
			}
			b.WriteString("%25")
			i++
			continue
		}
		if c >= 0x80 {
			r, size := utf8.DecodeRuneInString(s[i:])
			if r == utf8.RuneError && size == 1 {
				r = utf8.RuneError
			}
			var buf [utf8.UTFMax]byte
			for _, e := range buf[:utf8.EncodeRune(buf[:], r)] {
				b.WriteByte('%')
				b.WriteByte(upperHex[e>>4])
				b.WriteByte(upperHex[e&15])
			}
			i += size
			continue
		}
		if c <= 0x20 || c == 0x7f || strings.IndexByte("\"<>^`{|}\\", c) >= 0 {
			b.WriteByte('%')
			b.WriteByte(upperHex[c>>4])
			b.WriteByte(upperHex[c&15])
		} else {
			b.WriteByte(c)
		}
		i++
	}
	return b.String()
}

func isUnreserved(c byte) bool {
	return c == '-' || c == '.' || c == '_' || c == '~' ||
		'0' <= c && c <= '9' || 'a' <= c && c <= 'z' || 'A' <= c && c <= 'Z'
}

func isHex(c byte) bool {
	_, ok := digitValue(c)
	return ok
}

func unhex(c byte) byte {
	value, _ := digitValue(c)
	return byte(value)
}

// removeDotSegments is RFC 3986 section 5.2.4; ".." stops at the root.
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

// UnescapeDataString is Uri.UnescapeDataString: escapes that form valid
// UTF-8 are decoded, and any other escape is kept as written.
func UnescapeDataString(s string) string {
	if !strings.Contains(s, "%") {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); {
		if s[i] != '%' || i+2 >= len(s) || !isHex(s[i+1]) || !isHex(s[i+2]) {
			b.WriteByte(s[i])
			i++
			continue
		}
		// Gather the run of escapes, then decode it as UTF-8.
		start := i
		var raw []byte
		for i+2 < len(s) && s[i] == '%' && isHex(s[i+1]) && isHex(s[i+2]) {
			raw = append(raw, unhex(s[i+1])<<4|unhex(s[i+2]))
			i += 3
		}
		for j := 0; j < len(raw); {
			r, size := utf8.DecodeRune(raw[j:])
			if r == utf8.RuneError && size <= 1 {
				b.WriteString(s[start+3*j : start+3*j+3])
				j++
				continue
			}
			b.Write(raw[j : j+size])
			j += size
		}
	}
	return b.String()
}

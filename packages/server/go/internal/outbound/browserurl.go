package outbound

import (
	"strings"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// In UTF-16 units, like every other cap in the server.
const maxBrowserURLLength = 2048

// BrowserURL is C#'s BrowserUrl.Secure: the filter for a URL Blok hands to a
// reader's browser to load, such as an oEmbed thumbnail. It returns the https
// URL with a punycode host, or "" when the URL should not load. A nil base
// reads reference as an absolute URL.
func BrowserURL(base *dotnet.URI, reference string) string {
	if HasControl(reference) {
		return ""
	}
	u, ok := resolve(reference, base)
	if !ok || u.Scheme != "https" || u.Host == "" || u.UserInfo != "" {
		return ""
	}
	host, ok := publicHost(u)
	prefix := "https://" + u.Host
	if !ok || !strings.HasPrefix(u.AbsoluteURI, prefix) {
		return ""
	}
	url := "https://" + host + u.AbsoluteURI[len(prefix):]
	if hasEncodedControl(url) || len(jsjson.FromString(url)) > maxBrowserURLLength {
		return ""
	}
	return url
}

// HasControl finds a C0, DEL or C1 character. Go's parser trims them at the
// ends and .NET's escapes them, so a URL with one is dropped before parsing.
func HasControl(s string) bool {
	for _, c := range s {
		if c < 0x20 || 0x7f <= c && c <= 0x9f {
			return true
		}
	}
	return false
}

// publicHost is the host to write, punycode for a name, or false when the
// host is an address the outbound policy refuses, a zoned IPv6 literal,
// localhost, a single label, a trailing-dot name or a name ending in a
// number (a browser reads "１２７.0.0.1" as 127.0.0.1). No DNS lookup.
func publicHost(u *dotnet.URI) (string, bool) {
	if u.IdnHostThrows {
		return "", false
	}
	switch u.HostType {
	case "IPv4", "IPv6":
		address, ok := dotnet.ParseIP(u.IdnHost)
		if strings.Contains(u.IdnHost, "%") || !ok || !(DefaultPolicy{}).AddressAllowed(address) {
			return "", false
		}
		return u.Host, true
	case "Dns":
		name := u.IdnHost
		dot := strings.LastIndexByte(name, '.')
		if !plainName(name) || dot < 0 || dot == len(name)-1 || strings.HasSuffix(name, ".localhost") ||
			'0' <= name[dot+1] && name[dot+1] <= '9' {
			return "", false
		}
		return name, true
	}
	return "", false
}

// plainName allows only letters, digits, '-', '_' and '.', with no label
// starting with '-' or '_'. A fullwidth character can map to a URL
// delimiter ("a／b" to "a/b", where .NET's IdnHost throws) or to '%', and a
// browser percent-decodes a host: "127.0.0.％31" loads 127.0.0.1. .NET
// reads a label starting with '-' or '_' as a Basic host and drops it.
// C#'s IsPlainName is the same rule.
func plainName(name string) bool {
	for i := 0; i < len(name); i++ {
		c := name[i]
		start := i == 0 || name[i-1] == '.'
		if !('a' <= c && c <= 'z' || 'A' <= c && c <= 'Z' || '0' <= c && c <= '9' || c == '.' ||
			(c == '-' || c == '_') && !start) {
			return false
		}
	}
	return true
}

// hasEncodedControl finds %00-%1F, %7F or a C1 control in UTF-8
// (%C2%80-%C2%9F), in any hex case.
func hasEncodedControl(url string) bool {
	for i := 0; i+2 < len(url); i++ {
		if url[i] != '%' {
			continue
		}
		hi, lo := url[i+1]|0x20, url[i+2]|0x20
		if hi == '0' || hi == '1' || hi == '7' && lo == 'f' {
			return true
		}
		if hi == 'c' && lo == '2' && i+5 < len(url) && url[i+3] == '%' &&
			(url[i+4] == '8' || url[i+4] == '9') {
			return true
		}
	}
	return false
}

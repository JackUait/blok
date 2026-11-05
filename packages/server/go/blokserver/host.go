package blokserver

import (
	"net/netip"
	"strings"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
)

// hostNames is the names a loopback server answers on besides its own: the
// host of every allowed origin and of the public URL. Ports are dropped.
func hostNames(allowedOrigins []string, publicURL string) []string {
	var names []string
	for _, raw := range append(append([]string(nil), allowedOrigins...), publicURL) {
		raw = strings.TrimSpace(raw)
		scheme := strings.Index(raw, "://")
		if scheme < 0 {
			continue
		}
		authority := raw[scheme+3:]
		if end := strings.IndexAny(authority, "/?#"); end >= 0 {
			authority = authority[:end]
		}
		if name, ok := hostName(authority); ok && name != "" {
			names = append(names, name)
		}
	}
	return names
}

// hostAllowed decides a Host header for --auth none and proxy, which only
// bind loopback. A DNS-rebinding page sends its own name, so only loopback
// names and the configured names pass. The port is not checked: a page can
// never make its Host a loopback name. No Host passes, since browsers
// always send one.
func hostAllowed(host string, names []string) bool {
	if host == "" {
		return true
	}
	name, ok := hostName(host)
	if !ok {
		return false
	}
	if dotnet.EqualsOrdinalIgnoreCase(name, "localhost") || isLoopbackIPv4(name) {
		return true
	}
	if strings.HasPrefix(name, "[") {
		if address, err := netip.ParseAddr(name[1 : len(name)-1]); err == nil && address == netip.IPv6Loopback() {
			return true
		}
	}
	for _, allowed := range names {
		if dotnet.EqualsOrdinalIgnoreCase(allowed, name) {
			return true
		}
	}
	return false
}

// hostName splits "name[:digits]" or "[v6][:digits]" and returns the name,
// brackets kept.
func hostName(host string) (string, bool) {
	name, port := host, ""
	if strings.HasPrefix(host, "[") {
		end := strings.IndexByte(host, ']')
		if end < 0 {
			return "", false
		}
		name, port = host[:end+1], host[end+1:]
		if port != "" && port[0] != ':' {
			return "", false
		}
		port = strings.TrimPrefix(port, ":")
	} else if colon := strings.IndexByte(host, ':'); colon >= 0 {
		name, port = host[:colon], host[colon+1:]
	}
	for i := 0; i < len(port); i++ {
		if port[i] < '0' || port[i] > '9' {
			return "", false
		}
	}
	return name, true
}

// isLoopbackIPv4 accepts only four dotted decimal parts in 127.0.0.0/8, not
// the short or numeric forms some parsers take.
func isLoopbackIPv4(name string) bool {
	parts := strings.Split(name, ".")
	if len(parts) != 4 {
		return false
	}
	for _, part := range parts {
		if len(part) == 0 || len(part) > 3 {
			return false
		}
		value := 0
		for i := 0; i < len(part); i++ {
			if part[i] < '0' || part[i] > '9' {
				return false
			}
			value = value*10 + int(part[i]-'0')
		}
		if value > 255 {
			return false
		}
	}
	return parts[0] == "127"
}

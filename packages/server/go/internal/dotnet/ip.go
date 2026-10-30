// Package dotnet reproduces the .NET parsers the C# server decides with:
// IPAddress.TryParse, System.Uri and Uri.UnescapeDataString. Go's net and
// net/url read the same text differently, and a security check that reads a
// host differently from C# is a different check.
package dotnet

import (
	"net/netip"
	"strings"
)

// ParseIP is IPAddress.TryParse. IPv4 takes the inet_aton forms .NET takes
// ("127.1", "0x7f.0.0.1", "2130706433", octal parts). IPv6 may be bracketed,
// with a port after the bracket, and its scope id is dropped.
func ParseIP(s string) (netip.Addr, bool) {
	if strings.IndexByte(s, ':') >= 0 {
		return parseIPv6(s)
	}
	return ParseIPv4(s)
}

// ParseIPv4 is the IPv4 half of IPAddress.TryParse: one to four parts,
// each decimal, octal (leading 0) or hex (0x), the last part filling the
// bytes that remain.
func ParseIPv4(s string) (netip.Addr, bool) {
	if s == "" {
		return netip.Addr{}, false
	}
	parts := strings.Split(s, ".")
	if len(parts) > 4 {
		return netip.Addr{}, false
	}
	values := make([]uint64, len(parts))
	for i, part := range parts {
		value, ok := parseIPv4Part(part)
		if !ok {
			return netip.Addr{}, false
		}
		values[i] = value
	}
	last := len(values) - 1
	for _, value := range values[:last] {
		if value > 0xff {
			return netip.Addr{}, false
		}
	}
	if values[last] > 0xffffffff>>(8*uint(last)) {
		return netip.Addr{}, false
	}
	var address uint32
	for i, value := range values[:last] {
		address |= uint32(value) << (24 - 8*uint(i))
	}
	address |= uint32(values[last])
	return netip.AddrFrom4([4]byte{byte(address >> 24), byte(address >> 16), byte(address >> 8), byte(address)}), true
}

func parseIPv4Part(part string) (uint64, bool) {
	if part == "" {
		return 0, false
	}
	base := uint64(10)
	digits := part
	switch {
	case len(part) >= 2 && part[0] == '0' && (part[1] == 'x' || part[1] == 'X'):
		base, digits = 16, part[2:]
	case len(part) >= 2 && part[0] == '0':
		base, digits = 8, part[1:]
	}
	if digits == "" {
		return 0, false
	}
	var value uint64
	for i := 0; i < len(digits); i++ {
		digit, ok := digitValue(digits[i])
		if !ok || digit >= base {
			return 0, false
		}
		value = value*base + digit
		if value > 0xffffffff {
			return 0, false
		}
	}
	return value, true
}

func digitValue(c byte) (uint64, bool) {
	switch {
	case '0' <= c && c <= '9':
		return uint64(c - '0'), true
	case 'a' <= c && c <= 'f':
		return uint64(c-'a') + 10, true
	case 'A' <= c && c <= 'F':
		return uint64(c-'A') + 10, true
	}
	return 0, false
}

func parseIPv6(s string) (netip.Addr, bool) {
	if strings.HasPrefix(s, "[") {
		end := strings.IndexByte(s, ']')
		if end < 0 {
			return netip.Addr{}, false
		}
		rest := s[end+1:]
		if rest != "" {
			if rest[0] != ':' || !allDigits(rest[1:]) {
				return netip.Addr{}, false
			}
		}
		s = s[1:end]
	}
	if zone := strings.IndexByte(s, '%'); zone >= 0 {
		if zone == len(s)-1 {
			return netip.Addr{}, false
		}
		s = s[:zone]
	}
	if strings.ContainsAny(s, "[]") {
		return netip.Addr{}, false
	}
	address, err := netip.ParseAddr(s)
	if err != nil || !address.Is6() {
		return netip.Addr{}, false
	}
	return address, true
}

func allDigits(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// IsLoopback is IPAddress.IsLoopback: 127/8, ::1, and only 127.0.0.1
// mapped into IPv6 (::ffff:127.0.0.2 is not loopback in .NET).
func IsLoopback(address netip.Addr) bool {
	if address.Is4In6() {
		return address.Unmap() == netip.AddrFrom4([4]byte{127, 0, 0, 1})
	}
	return address.IsLoopback()
}

// IsAny is equality with IPAddress.Any or IPAddress.IPv6Any.
func IsAny(address netip.Addr) bool {
	return address == netip.IPv4Unspecified() || address == netip.IPv6Unspecified()
}

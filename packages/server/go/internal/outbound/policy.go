// Package outbound is the only way the server fetches a URL a caller chose.
// It ports C#'s GuardedOutboundPolicy and GuardedOutboundFetcher: the URL
// rules, the forbidden address ranges, a dial pinned to the vetted
// addresses, and the redirect, size and encoding limits.
package outbound

import (
	"errors"
	"net/netip"
	"strings"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
)

// Failure is GuardedFetchFailure.
type Failure int

// The ways a guarded fetch fails.
const (
	Blocked Failure = iota
	TooLarge
	TimedOut
	TooManyRedirects
	UnsupportedContentEncoding
)

// Error is GuardedFetchException.
type Error struct{ Failure Failure }

func (e *Error) Error() string { return "Outbound destination is not permitted." }

func fail(f Failure) error { return &Error{Failure: f} }

// Target is GuardedTarget: a URL that passed the policy.
type Target struct {
	URL     *dotnet.URI
	Host    string
	Port    int
	Literal netip.Addr
}

// Policy is IGuardedOutboundPolicy.
type Policy interface {
	// Validate parses raw, against base when base is not nil.
	Validate(raw string, base *dotnet.URI) (Target, error)
	AddressAllowed(address netip.Addr) bool
}

// forbidden is the C# ForbiddenNetworks list, in the same order.
var forbidden = func() []netip.Prefix {
	var prefixes []netip.Prefix
	for _, text := range []string{
		"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "0.0.0.0/8",
		"169.254.0.0/16", "192.0.0.0/24", "192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24",
		"192.88.99.0/24", "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4", "255.255.255.255/32",
		"100.64.0.0/10", "::/96", "100::/64", "2001::/23", "2001:2::/48", "2001:db8::/32",
		"2001::/32", "fc00::/7", "fec0::/10", "fe80::/10", "ff00::/8", "2002::/16",
		"64:ff9b::/96", "64:ff9b:1::/48", "5f00::/16", "2001:10::/28", "2001:20::/28",
		"3fff::/20", "100:0:0:1::/64",
	} {
		prefixes = append(prefixes, netip.MustParsePrefix(text))
	}
	return prefixes
}()

// DefaultPolicy is GuardedOutboundPolicy.
type DefaultPolicy struct{}

func resolve(raw string, base *dotnet.URI) (*dotnet.URI, bool) {
	if base == nil {
		return dotnet.ParseAbsoluteURI(raw)
	}
	return dotnet.ResolveURI(base, raw)
}

// Validate allows http and https on port 80 or 443 with a host and no
// userinfo. An IP literal must parse.
func (DefaultPolicy) Validate(raw string, base *dotnet.URI) (Target, error) {
	url, ok := resolve(raw, base)
	if strings.TrimSpace(raw) == "" || !ok || !url.IsHTTP() || url.Host == "" || url.UserInfo != "" ||
		authorityHasAt(url) {
		return Target{}, fail(Blocked)
	}
	if url.Port != 80 && url.Port != 443 {
		return Target{}, fail(Blocked)
	}
	target := Target{URL: url, Host: url.IdnHost, Port: url.Port}
	if url.HostType == "IPv4" || url.HostType == "IPv6" {
		literal, ok := dotnet.ParseIP(url.IdnHost)
		if !ok {
			return Target{}, fail(Blocked)
		}
		target.Literal = literal
	}
	return target, nil
}

func authorityHasAt(url *dotnet.URI) bool {
	rest := url.AbsoluteURI[len(url.Scheme)+3:]
	if end := strings.IndexAny(rest, "/?#"); end >= 0 {
		rest = rest[:end]
	}
	return strings.Contains(rest, "@")
}

// AddressAllowed refuses every forbidden range; a mapped IPv4 address is
// checked as IPv4.
func (DefaultPolicy) AddressAllowed(address netip.Addr) bool {
	address = address.Unmap().WithZone("")
	for _, prefix := range forbidden {
		if prefix.Contains(address) {
			return false
		}
	}
	return true
}

// ExactOriginPolicy is the conformance build's ExactOriginOutboundPolicy:
// only http://127.0.0.1:PORT, written exactly so, and only 127.0.0.1.
type ExactOriginPolicy struct {
	Origin string
	Port   int
}

// Validate allows one origin and nothing else.
func (p ExactOriginPolicy) Validate(raw string, base *dotnet.URI) (Target, error) {
	url, ok := resolve(raw, base)
	original := raw
	if base != nil && ok {
		original = url.AbsoluteURI
	}
	if !ok || url.Scheme != "http" || url.Host != "127.0.0.1" || url.Port != p.Port || url.UserInfo != "" ||
		!strings.HasPrefix(original, p.Origin) ||
		len(original) > len(p.Origin) && strings.IndexByte("/?#", original[len(p.Origin)]) < 0 {
		return Target{}, fail(Blocked)
	}
	return Target{URL: url, Host: "127.0.0.1", Port: p.Port, Literal: netip.AddrFrom4([4]byte{127, 0, 0, 1})}, nil
}

// AddressAllowed allows 127.0.0.1 only.
func (ExactOriginPolicy) AddressAllowed(address netip.Addr) bool {
	return address == netip.AddrFrom4([4]byte{127, 0, 0, 1})
}

// IsFailure reports whether err is a guarded fetch failure of kind f.
func IsFailure(err error, f Failure) bool {
	var e *Error
	return errors.As(err, &e) && e.Failure == f
}

package config

import (
	"errors"
	"fmt"
	"net"
	"strings"
)

type AuthMode string

const (
	AuthNone   AuthMode = "none"
	AuthProxy  AuthMode = "proxy"
	AuthTicket AuthMode = "ticket"
)

// minSecretLen is a floor, not a policy: a 32-byte secret makes an HMAC forgery
// attempt hopeless, and a shorter one usually means someone typed a password.
const minSecretLen = 32

type Config struct {
	Listen         string
	Auth           AuthMode
	Secret         string
	AllowedOrigins []string
	StorageDir     string

	// UnfurlDisabled turns off link previews without a release. This is the
	// emergency lever for a reported filter bypass: flip it, restart, ship the
	// fix on a normal schedule.
	UnfurlDisabled bool
}

// Validate refuses to let the process start in a configuration that would be
// unsafe. These are interlocks, not warnings: every one of them describes a
// mistake that silently exposes the consumer rather than failing loudly, so
// each message names the flag to change.
func Validate(c Config) error {
	switch c.Auth {
	case AuthNone:
		if !isLoopback(c.Listen) {
			return fmt.Errorf("--auth none serves anyone who can reach %q%s; it may only bind loopback — use --listen 127.0.0.1:PORT, or --auth ticket to expose this service", c.Listen, bindScope(c.Listen))
		}
	case AuthProxy:
		if !isLoopback(c.Listen) {
			return fmt.Errorf("--auth proxy trusts every caller, so it may only bind loopback, not %q%s — use --listen 127.0.0.1:PORT, or --auth ticket to expose this service", c.Listen, bindScope(c.Listen))
		}
	case AuthTicket:
		if len(c.Secret) < minSecretLen {
			return fmt.Errorf("--secret must be at least %d characters (got %d)", minSecretLen, len(c.Secret))
		}
		if len(c.AllowedOrigins) == 0 {
			return errors.New("a public service needs --allow-origin: without it anyone who finds this address can drive requests at third-party sites from your IP")
		}
	default:
		return fmt.Errorf("--auth must be none, proxy, or ticket (got %q)", c.Auth)
	}

	return nil
}

// isLoopback reports whether listen can only be reached from this machine.
func isLoopback(listen string) bool {
	host := listenHost(listen)

	// An empty host is Go's widest bind, not its narrowest: http.ListenAndServe
	// (":4000") and ("") both serve every network interface. net.ParseIP("") is
	// nil, so this must never fall through to the address check below.
	if host == "" {
		return false
	}
	// DNS names are case-insensitive, and listenHost has already folded the case.
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)

	return ip != nil && ip.IsLoopback()
}

// bindScope names what an address actually opens, so the refusal is actionable:
// ":4000" and "0.0.0.0:4000" both look narrower than they are.
func bindScope(listen string) string {
	host := listenHost(listen)
	if host == "" {
		return " (an address with no host binds every network interface)"
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsUnspecified() {
		return " (which binds every network interface)"
	}

	return ""
}

// listenHost extracts the host half of a listen address. A SplitHostPort error
// is not a rejection: it is also how a portless address ("127.0.0.1") and a
// bare IPv6 literal ("::") arrive, and http.ListenAndServe accepts both.
func listenHost(listen string) string {
	host, _, err := net.SplitHostPort(listen)
	if err != nil {
		host = listen
	}

	return strings.ToLower(strings.Trim(host, "[]"))
}

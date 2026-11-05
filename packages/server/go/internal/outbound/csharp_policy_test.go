package outbound

import (
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
)

// Twins of the GuardedOutboundPolicyTests cases the shared fixture does not
// carry.

func TestAcceptsOnlyHttpDestinationsOnTheRestrictedPorts(t *testing.T) {
	for _, tc := range []struct {
		raw, url string
		port     int
	}{
		{"http://example.com/path", "http://example.com/path", 80},
		{"https://example.com/", "https://example.com/", 443},
		{"http://example.com:443/", "http://example.com:443/", 443},
		{"https://example.com:80/", "https://example.com:80/", 80},
	} {
		target, err := DefaultPolicy{}.Validate(tc.raw, nil)
		if err != nil {
			t.Fatalf("%s: %v", tc.raw, err)
		}
		if target.URL.AbsoluteURI != tc.url || target.Host != "example.com" || target.Port != tc.port {
			t.Errorf("%s: got %q %q %d", tc.raw, target.URL.AbsoluteURI, target.Host, target.Port)
		}
	}
}

func TestRejectsInvalidSchemesHostsAndPorts(t *testing.T) {
	for _, raw := range []string{
		"",
		"example.com/no-scheme",
		"file:///etc/passwd",
		"gopher://example.com/",
		"ftp://example.com/",
		"javascript:alert(1)",
		"data:text/plain,hello",
		"http:///missing-host",
		"http://example.com:0/",
		"http://example.com:22/",
		"https://example.com:444/",
		"http://example.com:65536/",
	} {
		_, err := DefaultPolicy{}.Validate(raw, nil)
		if !IsFailure(err, Blocked) {
			t.Errorf("%q: got %v, want Blocked", raw, err)
			continue
		}
		if len(err.Error()) > 128 {
			t.Errorf("%q: message is %d bytes", raw, len(err.Error()))
		}
	}
}

func TestRejectsEveryFormOfAuthorityCredentials(t *testing.T) {
	for _, raw := range []string{
		"http://admin:secret@example.com/",
		"http://admin@example.com/",
		"http://:secret@example.com/",
		"http://@example.com/",
		`http:/\@example.com/`,
		`http:\\@example.com/`,
		"https://user%40domain@example.com/",
	} {
		if _, err := (DefaultPolicy{}).Validate(raw, nil); !IsFailure(err, Blocked) {
			t.Errorf("%q: got %v, want Blocked", raw, err)
		}
	}
}

func TestRejectsEveryForbiddenIpv4AndIpv6Class(t *testing.T) {
	for _, raw := range []string{
		"0.0.0.0", "0.1.2.3", "10.0.0.1", "100.64.0.1", "100.100.100.200", "127.0.0.1",
		"169.254.169.254", "172.16.0.1", "192.0.0.1", "192.0.2.1", "192.88.99.1", "192.168.0.1",
		"198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.0.0.1", "255.255.255.255",
		"::", "::1", "::2", "::127.0.0.1", "::ffff:127.0.0.1", "::ffff:169.254.169.254",
		"::ffff:192.168.0.1", "64:ff9b::1", "64:ff9b:1::1", "100::1", "100:0:0:1::1", "2001::1",
		"2001:2::1", "2001:10::1", "2001:20::1", "2001:db8::1", "2002::1", "3fff::1", "5f00::1",
		"fc00::1", "fec0::1", "fe80::1", "ff00::1",
	} {
		address, ok := dotnet.ParseIP(raw)
		if !ok {
			t.Fatalf("%s does not parse", raw)
		}
		if (DefaultPolicy{}).AddressAllowed(address) {
			t.Errorf("%s is allowed", raw)
		}
	}
}

func TestAllowsOrdinaryGlobalAddresses(t *testing.T) {
	for _, raw := range []string{"1.1.1.1", "8.8.8.8", "2001:4860:4860::8888", "2606:4700:4700::1111"} {
		address, _ := dotnet.ParseIP(raw)
		if !(DefaultPolicy{}).AddressAllowed(address) {
			t.Errorf("%s is refused", raw)
		}
	}
}

func relativeTo(t *testing.T, base, location string) (Target, error) {
	t.Helper()
	uri, ok := dotnet.ParseAbsoluteURI(base)
	if !ok {
		t.Fatalf("%s does not parse", base)
	}
	return DefaultPolicy{}.Validate(location, uri)
}

func TestResolvesAndValidatesARelativeRedirect(t *testing.T) {
	target, err := relativeTo(t, "https://example.com/path/start", "../next?from=redirect")
	if err != nil || target.URL.AbsoluteURI != "https://example.com/next?from=redirect" {
		t.Fatalf("got %+v %v", target.URL, err)
	}
}

func TestAcceptsARelativeRedirectWithAUrlInItsQuery(t *testing.T) {
	target, err := relativeTo(t, "https://example.com/path/start", "next?return=http://user@elsewhere")
	if err != nil || target.URL.AbsoluteURI != "https://example.com/path/next?return=http://user@elsewhere" {
		t.Fatalf("got %+v %v", target.URL, err)
	}
}

func TestRejectsCredentialsInANetworkPathRedirect(t *testing.T) {
	for _, location := range []string{
		"//@example.com/private",
		"//user@example.com/private",
		"//:secret@example.com/private",
		"//user:secret@example.com/private",
	} {
		if _, err := relativeTo(t, "https://example.com/start", location); !IsFailure(err, Blocked) {
			t.Errorf("%q: got %v, want Blocked", location, err)
		}
	}
}

func TestCanonicalizesAlternateAddressNotationBeforeClassification(t *testing.T) {
	for _, raw := range []string{
		"http://127.1/",
		"http://0177.0.0.1/",
		"http://0x7f000001/",
		"http://2130706433/",
		"http://2852039166/latest/meta-data/",
		"http://[::ffff:127.0.0.1]/",
		"http://[::ffff:169.254.169.254]/latest/meta-data/",
	} {
		target, err := DefaultPolicy{}.Validate(raw, nil)
		if err != nil {
			t.Errorf("%s: %v", raw, err)
			continue
		}
		if !target.Literal.IsValid() {
			t.Errorf("%s: no literal address", raw)
			continue
		}
		if (DefaultPolicy{}).AddressAllowed(target.Literal) {
			t.Errorf("%s: %s is allowed", raw, target.Literal)
		}
	}
}

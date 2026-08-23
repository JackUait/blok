package config_test

import (
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/internal/config"
)

const validSecret = "s3cret-value-at-least-32-chars-long!"

// The interlock that makes "forgot to turn dev mode off" impossible.
func TestAuthNoneRefusesANonLoopbackBind(t *testing.T) {
	err := config.Validate(config.Config{Listen: "0.0.0.0:4000", Auth: config.AuthNone})
	if err == nil {
		t.Fatal("err = nil, want a refusal")
	}
	if !strings.Contains(err.Error(), "--auth none") {
		t.Fatalf("err = %q, want it to name the flag", err)
	}
}

func TestAuthNoneAllowsLoopback(t *testing.T) {
	for _, listen := range []string{"127.0.0.1:4000", "localhost:4000", "[::1]:4000"} {
		if err := config.Validate(config.Config{Listen: listen, Auth: config.AuthNone}); err != nil {
			t.Fatalf("%s: err = %v, want nil", listen, err)
		}
	}
}

func TestProxyModeRefusesANonLoopbackBind(t *testing.T) {
	if err := config.Validate(config.Config{Listen: "0.0.0.0:4000", Auth: config.AuthProxy}); err == nil {
		t.Fatal("err = nil, want a refusal")
	}
}

// A public service with no origin allowlist is a free scanning proxy.
func TestTicketModeRefusesAnEmptyOriginAllowlist(t *testing.T) {
	err := config.Validate(config.Config{Listen: "0.0.0.0:4000", Auth: config.AuthTicket, Secret: "s3cret-value-at-least-32-chars-long!"})
	if err == nil {
		t.Fatal("err = nil, want a refusal")
	}
	if !strings.Contains(err.Error(), "--allow-origin") {
		t.Fatalf("err = %q, want it to name the flag", err)
	}
}

func TestTicketModeRefusesAShortSecret(t *testing.T) {
	if err := config.Validate(config.Config{
		Listen: "0.0.0.0:4000", Auth: config.AuthTicket, Secret: "short",
		AllowedOrigins: []string{"https://app.example.com"},
	}); err == nil {
		t.Fatal("err = nil, want a refusal")
	}
}

// The emergency lever the spec promises: previews can be switched off by
// configuration, with no release, if a bypass is reported.
func TestUnfurlCanBeDisabled(t *testing.T) {
	c := config.Config{Listen: "127.0.0.1:4000", Auth: config.AuthNone, UnfurlDisabled: true}
	if err := config.Validate(c); err != nil {
		t.Fatalf("err = %v, want nil", err)
	}
	if !c.UnfurlDisabled {
		t.Fatal("UnfurlDisabled did not survive validation")
	}
}

func TestTicketModeAcceptsAFullConfiguration(t *testing.T) {
	if err := config.Validate(config.Config{
		Listen: "0.0.0.0:4000", Auth: config.AuthTicket,
		Secret:         "s3cret-value-at-least-32-chars-long!",
		AllowedOrigins: []string{"https://app.example.com"},
	}); err != nil {
		t.Fatalf("err = %v, want nil", err)
	}
}

// ---------------------------------------------------------------------------
// isLoopback is the whole basis of two of the three interlocks. Everything
// below pins its edges through the public Validate surface.
// ---------------------------------------------------------------------------

// http.ListenAndServe(":4000") binds EVERY interface, so an address with no
// host is the widest bind there is — and the likeliest way to defeat the
// interlock, because net.SplitHostPort succeeds and hands back an empty host.
func TestAuthNoneRefusesAnAddressWithNoHost(t *testing.T) {
	for _, listen := range []string{":4000", ""} {
		err := config.Validate(config.Config{Listen: listen, Auth: config.AuthNone})
		if err == nil {
			t.Fatalf("%q: err = nil, want a refusal — an empty host binds every interface", listen)
		}
		if !strings.Contains(err.Error(), "--auth none") {
			t.Fatalf("%q: err = %q, want it to name the flag", listen, err)
		}
		if !strings.Contains(err.Error(), "every network interface") {
			t.Fatalf("%q: err = %q, want it to explain that an empty host binds everything", listen, err)
		}
	}
}

func TestProxyModeRefusesAnAddressWithNoHost(t *testing.T) {
	if err := config.Validate(config.Config{Listen: ":4000", Auth: config.AuthProxy}); err == nil {
		t.Fatal("err = nil, want a refusal")
	}
}

// The unspecified addresses, with and without a port. net.IP.IsLoopback is
// false for all of them, but the no-port spellings take the SplitHostPort
// error path, so they need their own coverage.
func TestAuthNoneRefusesTheUnspecifiedAddresses(t *testing.T) {
	for _, listen := range []string{"0.0.0.0:4000", "0.0.0.0", "[::]:4000", "[::]", "::"} {
		err := config.Validate(config.Config{Listen: listen, Auth: config.AuthNone})
		if err == nil {
			t.Fatalf("%q: err = nil, want a refusal", listen)
		}
		if !strings.Contains(err.Error(), "every network interface") {
			t.Fatalf("%q: err = %q, want it to explain the wide bind", listen, err)
		}
	}
}

func TestProxyModeRefusesTheUnspecifiedAddresses(t *testing.T) {
	for _, listen := range []string{"0.0.0.0:4000", "0.0.0.0", "[::]:4000", "[::]", "::"} {
		if err := config.Validate(config.Config{Listen: listen, Auth: config.AuthProxy}); err == nil {
			t.Fatalf("%q: err = nil, want a refusal", listen)
		}
	}
}

// A loopback address with no port is still loopback: net.SplitHostPort fails,
// and the whole string has to be retried as a bare host.
func TestAuthNoneAllowsLoopbackWithNoPort(t *testing.T) {
	for _, listen := range []string{"127.0.0.1", "localhost", "[::1]", "::1"} {
		if err := config.Validate(config.Config{Listen: listen, Auth: config.AuthNone}); err != nil {
			t.Fatalf("%q: err = %v, want nil", listen, err)
		}
	}
}

func TestProxyModeAllowsLoopback(t *testing.T) {
	for _, listen := range []string{"127.0.0.1:4000", "localhost:4000", "[::1]:4000"} {
		if err := config.Validate(config.Config{Listen: listen, Auth: config.AuthProxy}); err != nil {
			t.Fatalf("%q: err = %v, want nil", listen, err)
		}
	}
}

// All of 127.0.0.0/8 is loopback, and so is an IPv4-mapped loopback address.
func TestAuthNoneAllowsTheRestOfTheLoopbackRange(t *testing.T) {
	for _, listen := range []string{"127.0.0.2:4000", "127.255.255.254:4000", "[::ffff:127.0.0.1]:4000"} {
		if err := config.Validate(config.Config{Listen: listen, Auth: config.AuthNone}); err != nil {
			t.Fatalf("%q: err = %v, want nil", listen, err)
		}
	}
}

// "localhost" is a DNS name and DNS names are case-insensitive, so the
// interlock must not refuse a bind that the OS will resolve to loopback.
func TestAuthNoneAllowsLocalhostInAnyCase(t *testing.T) {
	for _, listen := range []string{"LOCALHOST:4000", "LocalHost:4000", "LOCALHOST"} {
		if err := config.Validate(config.Config{Listen: listen, Auth: config.AuthNone}); err != nil {
			t.Fatalf("%q: err = %v, want nil", listen, err)
		}
	}
}

// net.ParseIP rejects the abbreviated "127.1" that ping and curl accept, so it
// is not recognised as loopback. Refusing is the correct landing: fail closed
// and let the operator write the address out in full.
func TestAuthNoneRefusesAbbreviatedLoopback(t *testing.T) {
	for _, listen := range []string{"127.1", "127.1:4000"} {
		if err := config.Validate(config.Config{Listen: listen, Auth: config.AuthNone}); err == nil {
			t.Fatalf("%q: err = nil, want a refusal — net.ParseIP does not accept this spelling", listen)
		}
	}
}

func TestAuthNoneRefusesARoutableHostname(t *testing.T) {
	for _, listen := range []string{"example.com:4000", "example.com", "localhost.evil.com:4000"} {
		err := config.Validate(config.Config{Listen: listen, Auth: config.AuthNone})
		if err == nil {
			t.Fatalf("%q: err = nil, want a refusal", listen)
		}
		if strings.Contains(err.Error(), "every network interface") {
			t.Fatalf("%q: err = %q, a named host is not the wide-bind case", listen, err)
		}
	}
}

// ---------------------------------------------------------------------------
// The --auth flag itself.
// ---------------------------------------------------------------------------

func TestUnknownAuthModeIsRefusedAndNamesTheValidModes(t *testing.T) {
	for _, mode := range []config.AuthMode{"", "ticket ", "Ticket", "jwt", "None"} {
		err := config.Validate(config.Config{Listen: "127.0.0.1:4000", Auth: mode})
		if err == nil {
			t.Fatalf("--auth %q: err = nil, want a refusal", mode)
		}
		for _, valid := range []string{"none", "proxy", "ticket"} {
			if !strings.Contains(err.Error(), valid) {
				t.Fatalf("--auth %q: err = %q, want it to name %q", mode, err, valid)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// --secret boundary. The check is `< minSecretLen`, so exactly the floor passes
// and one character short does not.
// ---------------------------------------------------------------------------

func TestTicketModeAcceptsASecretExactlyAtTheFloor(t *testing.T) {
	err := config.Validate(config.Config{
		Listen: "0.0.0.0:4000", Auth: config.AuthTicket,
		Secret:         strings.Repeat("a", 32),
		AllowedOrigins: []string{"https://app.example.com"},
	})
	if err != nil {
		t.Fatalf("err = %v, want nil — 32 characters is the floor, not one past it", err)
	}
}

func TestTicketModeRefusesASecretOneCharacterShort(t *testing.T) {
	err := config.Validate(config.Config{
		Listen: "0.0.0.0:4000", Auth: config.AuthTicket,
		Secret:         strings.Repeat("a", 31),
		AllowedOrigins: []string{"https://app.example.com"},
	})
	if err == nil {
		t.Fatal("err = nil, want a refusal")
	}
	if !strings.Contains(err.Error(), "--secret") {
		t.Fatalf("err = %q, want it to name the flag", err)
	}
}

func TestTicketModeRefusesAnAbsentSecret(t *testing.T) {
	err := config.Validate(config.Config{
		Listen: "0.0.0.0:4000", Auth: config.AuthTicket,
		AllowedOrigins: []string{"https://app.example.com"},
	})
	if err == nil {
		t.Fatal("err = nil, want a refusal")
	}
	if !strings.Contains(err.Error(), "--secret") {
		t.Fatalf("err = %q, want it to name the flag", err)
	}
}

// Ticket mode is the "expose this service" mode, so the allowlist is required
// unconditionally — binding loopback today does not stop a reverse proxy from
// publishing it tomorrow.
func TestTicketModeRequiresOriginsEvenOnLoopback(t *testing.T) {
	err := config.Validate(config.Config{
		Listen: "127.0.0.1:4000", Auth: config.AuthTicket, Secret: validSecret,
	})
	if err == nil {
		t.Fatal("err = nil, want a refusal")
	}
	if !strings.Contains(err.Error(), "--allow-origin") {
		t.Fatalf("err = %q, want it to name the flag", err)
	}
}

// Ticket mode says nothing about where it binds: loopback is a legitimate
// deployment behind a reverse proxy.
func TestTicketModeAcceptsALoopbackBind(t *testing.T) {
	if err := config.Validate(config.Config{
		Listen: "127.0.0.1:4000", Auth: config.AuthTicket, Secret: validSecret,
		AllowedOrigins: []string{"https://app.example.com"},
	}); err != nil {
		t.Fatalf("err = %v, want nil", err)
	}
}

// ---------------------------------------------------------------------------
// Fields that belong to another mode. Decision: accepted, not refused. An
// operator keeps one env file and flips --auth between dev and prod; a secret
// that no code path reads exposes nothing, and refusing it would turn a
// harmless leftover into a failed boot.
// ---------------------------------------------------------------------------

func TestLoopbackModesIgnoreSettingsThatBelongToTicketMode(t *testing.T) {
	for _, mode := range []config.AuthMode{config.AuthNone, config.AuthProxy} {
		if err := config.Validate(config.Config{
			Listen: "127.0.0.1:4000", Auth: mode,
			Secret:         validSecret,
			AllowedOrigins: []string{"https://app.example.com"},
		}); err != nil {
			t.Fatalf("--auth %s: err = %v, want nil", mode, err)
		}
	}
}

// A short secret is only a problem for the mode that signs with it.
func TestLoopbackModesIgnoreAShortSecret(t *testing.T) {
	for _, mode := range []config.AuthMode{config.AuthNone, config.AuthProxy} {
		if err := config.Validate(config.Config{
			Listen: "127.0.0.1:4000", Auth: mode, Secret: "short",
		}); err != nil {
			t.Fatalf("--auth %s: err = %v, want nil", mode, err)
		}
	}
}

// StorageDir is carried, not validated: the directory is created on first write.
func TestStorageDirIsNotValidatedAtStartup(t *testing.T) {
	c := config.Config{Listen: "127.0.0.1:4000", Auth: config.AuthNone, StorageDir: "/nonexistent/blok-uploads"}
	if err := config.Validate(c); err != nil {
		t.Fatalf("err = %v, want nil", err)
	}
	if c.StorageDir != "/nonexistent/blok-uploads" {
		t.Fatalf("StorageDir = %q, want it carried through", c.StorageDir)
	}
}

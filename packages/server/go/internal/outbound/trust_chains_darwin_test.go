//go:build darwin

package outbound

import (
	"crypto/tls"
	"crypto/x509"
	"net"
	"net/netip"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/sectrust/trustfixture"
)

// The guarded fetcher's TLS check accepts and refuses the fixture's chains
// as C#'s MacOsCertificateTrust does, the root as the only anchor.
func TestTheFetcherTrustsTheChainsCSharpTrusts(t *testing.T) {
	cases, err := trustfixture.Load(trustfixture.Path)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		chain, err := trustfixture.Build(c)
		if err != nil {
			t.Fatalf("%s: %v", c.Name, err)
		}
		if got := handshake(t, c.Host, chain); got != c.Guarded {
			t.Errorf("%s: got %s, C# %s", c.Name, got, c.Guarded)
		}
	}
}

func handshake(t *testing.T, host string, chain trustfixture.Chain) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		server := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{{Certificate: chain.Sent, PrivateKey: chain.Key}}})
		_ = server.Handshake()
		_ = server.Close()
	}()
	target := Target{Host: host, Port: 443}
	if address, err := netip.ParseAddr(strings.Trim(host, "[]")); err == nil {
		target.Literal = address
	}
	f := &Fetcher{Roots: []*x509.Certificate{chain.Root}}
	config := f.tlsConfig(target)
	if config.ServerName == "" {
		config.ServerName = target.Host
	}
	conn, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	client := tls.Client(conn, config)
	defer client.Close()
	if client.Handshake() != nil {
		return "refuse"
	}
	return "accept"
}

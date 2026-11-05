//go:build darwin

package outbound

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"net"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
)

// anyLoopback lets the test reach its own TLS listener; the leak under test
// is below the policy.
type anyLoopback struct{ port int }

func (p anyLoopback) Validate(raw string, base *dotnet.URI) (Target, error) {
	url, _ := dotnet.ParseAbsoluteURI(raw)
	return Target{URL: url, Host: "aia.example", Port: p.port, Literal: netip.AddrFrom4([4]byte{127, 0, 0, 1})}, nil
}

func (anyLoopback) AddressAllowed(netip.Addr) bool { return true }

// The Go analogue of SslStreamStillLeaksAnIssuerFetchOnMacOs. On macOS the
// platform verifier lets trustd fetch a certificate's caIssuers URL, which
// would reach an address the guard never vetted. Measured on Go 1.27.1: with
// RootCAs nil or x509.SystemCertPool() the issuer is fetched once; with a
// pool built from PEM it never is. So the fetcher verifies with the macOS
// PEM bundle.
func TestTheFetcherNeverLetsTheVerifierFetchAnIssuer(t *testing.T) {
	var hits atomic.Int32
	issuer, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	rootKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	middleKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	leafKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	rootTemplate := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "root"},
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	root := makeCert(t, rootTemplate, rootTemplate, &rootKey.PublicKey, rootKey)
	middle := makeCert(t, &x509.Certificate{SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "middle"},
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign},
		root, &middleKey.PublicKey, rootKey)
	leaf := makeCert(t, &x509.Certificate{SerialNumber: big.NewInt(3), Subject: pkix.Name{CommonName: "aia.example"},
		DNSNames: []string{"aia.example"}, NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour),
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IssuingCertificateURL: []string{"http://" + issuer.Addr().String() + "/issuer.cer"}},
		middle, &leafKey.PublicKey, middleKey)
	issuerServer := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		_, _ = w.Write(middle.Raw)
	})}
	go func() { _ = issuerServer.Serve(issuer) }()
	t.Cleanup(func() { _ = issuerServer.Close() })

	origin, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{leaf.Raw}, PrivateKey: leafKey}}})
	if err != nil {
		t.Fatal(err)
	}
	originServer := &http.Server{Handler: http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})}
	go func() { _ = originServer.Serve(origin) }()
	t.Cleanup(func() { _ = originServer.Close() })

	port := origin.Addr().(*net.TCPAddr).Port
	fetcher := NewFetcher(anyLoopback{port})
	_, err = fetcher.Get(context.Background(), "https://aia.example:"+strconv.Itoa(port)+"/", Limits{Timeout: 5 * time.Second, MaxBytes: 1 << 10})
	if err == nil {
		t.Fatal("an untrusted chain verified")
	}
	time.Sleep(time.Second)
	if got := hits.Load(); got != 0 {
		t.Fatalf("the verifier fetched the issuer %d time(s)", got)
	}
}

// The roots are read from the trust settings, so a root added only to the
// Keychain is trusted as in C# and Rust.
func TestTheMacOSRootsComeFromTheTrustSettings(t *testing.T) {
	pool, err := loadTrustSettingsRoots(securityTool)
	if err != nil {
		t.Fatal(err)
	}
	if pool.Equal(x509.NewCertPool()) {
		t.Fatal("no roots")
	}
}

// failingTool is /usr/bin/security, except that a call naming fail runs
// instead (exit 1 by default).
func failingTool(t *testing.T, fail string, instead ...string) string {
	t.Helper()
	action := "exit 1"
	if len(instead) > 0 {
		action = instead[0]
	}
	path := filepath.Join(t.TempDir(), "security")
	script := "#!/bin/sh\ncase \"$*\" in *'" + fail + "'*) " + action + ";; esac\nexec " + securityTool + " \"$@\"\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

// A root set read in part would trust too little or too much: any failed
// read falls back to the macOS bundle. The tool exits 0 for a keychain it
// cannot read, so an empty system keychain, an empty system domain, or a
// system hash with no certificate counts as failed too.
func TestAnyFailedTrustReadFallsBackToTheBundle(t *testing.T) {
	want := bundlePool()
	if want.Equal(x509.NewCertPool()) {
		t.Fatal("no bundle")
	}
	for _, fail := range []string{"SystemRootCertificates.keychain", "System.keychain", "login.keychain", "domain0", "export -d ", "export -s ", ""} {
		if got := loadRoots(failingTool(t, fail)); !got.Equal(want) {
			t.Errorf("%q failed: the roots are not the bundle", fail)
		}
	}
	emptyList := `printf '<plist><dict><key>trustList</key><dict/></dict></plist>' > "$3"; exit 0`
	oneUnknown := `printf '<plist><dict><key>trustList</key><dict><key>0000000000000000000000000000000000000000</key><dict/></dict></dict></plist>' > "$3"; exit 0`
	silent := map[string]string{
		"an empty system keychain":          failingTool(t, "SystemRootCertificates.keychain", "exit 0"),
		"an empty system domain":            failingTool(t, "export -s ", emptyList),
		"a system hash with no certificate": failingTool(t, "export -s ", oneUnknown),
	}
	for name, tool := range silent {
		if got := loadRoots(tool); !got.Equal(want) {
			t.Errorf("%s: the roots are not the bundle", name)
		}
	}
}

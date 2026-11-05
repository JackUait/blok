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
	pool, _, err := loadTrustSettingsRoots(securityTool)
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

// A root set read in part would trust too little or too much, and without
// the trust settings a cert the user marked "Never Trust" would pass, where
// C#'s SecTrust refuses it. Go cannot ask trustd without letting it fetch
// a caIssuers URL past the guard, so any failed read leaves no roots: the
// guarded fetcher fails closed. The tool exits 0 for a keychain it cannot
// read, so an empty system root keychain counts as failed too.
func TestAnyFailedTrustReadFailsClosed(t *testing.T) {
	empty := x509.NewCertPool()
	for _, fail := range []string{"SystemRootCertificates.keychain", "System.keychain", "login.keychain", "domain0", "export -d ", ""} {
		trust := loadTrust(failingTool(t, fail))
		if !trust.pool.Equal(empty) || len(trust.denied) != 0 {
			t.Errorf("%q failed: the guarded fetcher still trusts some roots", fail)
		}
	}
	if trust := loadTrust(failingTool(t, "SystemRootCertificates.keychain", "exit 0")); !trust.pool.Equal(empty) {
		t.Error("an empty system keychain: the guarded fetcher still trusts some roots")
	}
	if loadRoots(securityTool).Equal(empty) {
		t.Fatal("a good read gave no roots")
	}
}

// trustd's system anchors are the PKI trust store asset when its
// VersionNumber is above the system bundle's, else the bundle
// (OTATrustUtilities.m:1101-1114). Each holds a SystemRootCertificates
// keychain with the same certs as its certsTable.data.
func TestTheSystemRootsComeFromTheNewerTrustStore(t *testing.T) {
	systemKeychain := "/System/Library/Keychains/SystemRootCertificates.keychain"
	directory := t.TempDir()
	assetData := filepath.Join(directory, "asset")
	if err := os.Mkdir(assetData, 0o755); err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile(systemKeychain)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assetData, "SystemRootCertificates.keychain"), source, 0o644); err != nil {
		t.Fatal(err)
	}
	autoAsset := filepath.Join(directory, "AutoAsset.plist")
	writePlist := func(path, body string) {
		t.Helper()
		plist := `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>` + body + `</dict></plist>`
		if err := os.WriteFile(path, []byte(plist), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	writePlist(autoAsset, `<key>AssetPath</key><string>`+assetData+`</string>`)
	savedAuto, savedVersion := autoAssetPlist, systemTrustStoreVersion
	defer func() { autoAssetPlist, systemTrustStoreVersion = savedAuto, savedVersion }()
	autoAssetPlist = autoAsset
	systemVersion := filepath.Join(directory, "SystemAssetVersion.plist")
	systemTrustStoreVersion = systemVersion
	writePlist(systemVersion, `<key>VersionNumber</key><integer>2025082000</integer>`)

	cases := []struct {
		version int
		want    string
	}{
		{2026091601, filepath.Join(assetData, "SystemRootCertificates.keychain")},
		{2025082000, systemKeychain},
		{2024010100, systemKeychain},
	}
	for _, c := range cases {
		writePlist(filepath.Join(assetData, "AssetVersion.plist"), `<key>VersionNumber</key><integer>`+strconv.Itoa(c.version)+`</integer>`)
		if got := systemRootsKeychain(context.Background()); got != c.want {
			t.Errorf("asset %d: read %s, want %s", c.version, got, c.want)
		}
	}
	// No asset: the bundle.
	autoAssetPlist = filepath.Join(directory, "none.plist")
	if got := systemRootsKeychain(context.Background()); got != systemKeychain {
		t.Errorf("no asset: read %s", got)
	}
}

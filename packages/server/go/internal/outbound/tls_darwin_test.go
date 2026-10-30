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

func makeCert(t *testing.T, template, parent *x509.Certificate, public, private any) *x509.Certificate {
	t.Helper()
	der, err := x509.CreateCertificate(rand.Reader, template, parent, public, private)
	if err != nil {
		t.Fatal(err)
	}
	certificate, _ := x509.ParseCertificate(der)
	return certificate
}

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

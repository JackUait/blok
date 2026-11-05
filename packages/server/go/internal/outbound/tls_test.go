package outbound

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"errors"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
)

// Hand ports of the TLS cases in GuardedOutboundFetcherTests, plus the
// no-revocation rule of CreateTlsOptions (GuardedOutboundFetcher.cs:455-476),
// which C# pins by code only.

func makeCert(t *testing.T, template, parent *x509.Certificate, public, private any) *x509.Certificate {
	t.Helper()
	der, err := x509.CreateCertificate(rand.Reader, template, parent, public, private)
	if err != nil {
		t.Fatal(err)
	}
	certificate, _ := x509.ParseCertificate(der)
	return certificate
}

type testPKI struct {
	root *x509.Certificate
	pool *x509.CertPool
	leaf tls.Certificate
}

// newPKI is TestCertificates.Create: a root and a leaf for name, with extra
// fields set on the leaf.
func newPKI(t *testing.T, name string, leafFields func(*x509.Certificate)) testPKI {
	t.Helper()
	now := time.Now()
	rootKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	leafKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	rootTemplate := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "root"},
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	root := makeCert(t, rootTemplate, rootTemplate, &rootKey.PublicKey, rootKey)
	leafTemplate := &x509.Certificate{SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: name},
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour),
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	if address, err := netip.ParseAddr(name); err == nil {
		leafTemplate.IPAddresses = []net.IP{address.AsSlice()}
	} else {
		leafTemplate.DNSNames = []string{name}
	}
	if leafFields != nil {
		leafFields(leafTemplate)
	}
	leaf := makeCert(t, leafTemplate, root, &leafKey.PublicKey, rootKey)
	pool := x509.NewCertPool()
	pool.AddCert(root)
	return testPKI{root: root, pool: pool, leaf: tls.Certificate{Certificate: [][]byte{leaf.Raw}, PrivateKey: leafKey}}
}

// tlsOrigin is LoopbackOrigin with a server certificate: it records the SNI
// name, the negotiated protocol and the Host header.
type tlsOrigin struct {
	port       int
	mu         sync.Mutex
	serverName string
	sawHello   bool
	protocol   string
	host       string
}

func startTLSOrigin(t *testing.T, certificate tls.Certificate, protocols []string) *tlsOrigin {
	t.Helper()
	o := &tlsOrigin{}
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o.mu.Lock()
		o.host = r.Host
		if r.TLS != nil {
			o.protocol = r.TLS.NegotiatedProtocol
		}
		o.mu.Unlock()
		_, _ = w.Write([]byte("ok"))
	}))
	server.TLS = &tls.Config{
		Certificates: []tls.Certificate{certificate},
		NextProtos:   protocols,
		GetConfigForClient: func(hello *tls.ClientHelloInfo) (*tls.Config, error) {
			o.mu.Lock()
			o.serverName, o.sawHello = hello.ServerName, true
			o.mu.Unlock()
			return nil, nil
		},
	}
	server.StartTLS()
	t.Cleanup(server.Close)
	o.port = server.Listener.Addr().(*net.TCPAddr).Port
	return o
}

func loopbackFetcher(host string, port int, roots *x509.CertPool) *Fetcher {
	resolver := &countingResolver{answers: [][]netip.Addr{addrs("127.0.0.1")}}
	f := newTestFetcher(&fixturePolicy{host: host, port: port, allowed: addrs("127.0.0.1")}, resolver)
	f.RootCAs = roots
	return f
}

func wantBlocked(t *testing.T, err error) {
	t.Helper()
	var failure *Error
	if !errors.As(err, &failure) || failure.Failure != Blocked {
		t.Fatalf("want a blocked destination, got %v", err)
	}
}

func TestPreservesTheHostnameForTLSSNIAndCertificateValidation(t *testing.T) {
	pki := newPKI(t, "secure.example", nil)
	o := startTLSOrigin(t, pki.leaf, nil)
	f := loopbackFetcher("secure.example", o.port, pki.pool)
	response, err := f.Get(context.Background(), "https://secure.example:"+strconv.Itoa(o.port)+"/tls", testLimits)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Release()
	if string(response.Body) != "ok" || o.serverName != "secure.example" || o.host != "secure.example:"+strconv.Itoa(o.port) {
		t.Fatalf("%q sni %q host %q", response.Body, o.serverName, o.host)
	}
}

func TestRejectsATrustedCertificateForTheWrongHostname(t *testing.T) {
	pki := newPKI(t, "other.example", nil)
	o := startTLSOrigin(t, pki.leaf, nil)
	f := loopbackFetcher("secure.example", o.port, pki.pool)
	_, err := f.Get(context.Background(), "https://secure.example:"+strconv.Itoa(o.port)+"/", testLimits)
	wantBlocked(t, err)
}

func TestRetainsNormalTLSCertificateValidation(t *testing.T) {
	pki := newPKI(t, "untrusted.example", nil)
	o := startTLSOrigin(t, pki.leaf, nil)
	f := loopbackFetcher("untrusted.example", o.port, nil)
	_, err := f.Get(context.Background(), "https://untrusted.example:"+strconv.Itoa(o.port)+"/", testLimits)
	wantBlocked(t, err)
}

// C# skips this off macOS; Go has one TLS stack, so it runs everywhere.
func TestOffersOnlyHTTP11DuringTLSNegotiation(t *testing.T) {
	pki := newPKI(t, "alpn.example", nil)
	o := startTLSOrigin(t, pki.leaf, []string{"h2", "http/1.1"})
	f := loopbackFetcher("alpn.example", o.port, pki.pool)
	response, err := f.Get(context.Background(), "https://alpn.example:"+strconv.Itoa(o.port)+"/", testLimits)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Release()
	if o.protocol != "http/1.1" {
		t.Fatalf("negotiated %q", o.protocol)
	}
}

// RevocationMode = NoCheck: a leaf that names a CRL and an OCSP responder
// verifies without either being asked.
func TestNeverChecksRevocation(t *testing.T) {
	var hits atomic.Int32
	responder := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(responder.Close)
	pki := newPKI(t, "revoked.example", func(leaf *x509.Certificate) {
		leaf.CRLDistributionPoints = []string{responder.URL + "/crl"}
		leaf.OCSPServer = []string{responder.URL + "/ocsp"}
	})
	o := startTLSOrigin(t, pki.leaf, nil)
	f := loopbackFetcher("revoked.example", o.port, pki.pool)
	response, err := f.Get(context.Background(), "https://revoked.example:"+strconv.Itoa(o.port)+"/", testLimits)
	if err != nil {
		t.Fatal(err)
	}
	response.Release()
	if got := hits.Load(); got != 0 {
		t.Fatalf("revocation endpoints asked %d time(s)", got)
	}
}

// An IP literal sends no SNI (RFC 6066 3) and is checked against the
// certificate's IP addresses. What SslStream sends here is UNVERIFIED.
func TestAnIPLiteralSendsNoServerName(t *testing.T) {
	pki := newPKI(t, "127.0.0.1", nil)
	o := startTLSOrigin(t, pki.leaf, nil)
	f := NewFetcher(anyAddress{})
	f.RootCAs = pki.pool
	response, err := f.Get(context.Background(), "https://127.0.0.1:"+strconv.Itoa(o.port)+"/", testLimits)
	if err != nil {
		t.Fatal(err)
	}
	response.Release()
	if !o.sawHello || o.serverName != "" {
		t.Fatalf("hello %v sni %q", o.sawHello, o.serverName)
	}
}

// anyAddress is DefaultPolicy without the address ranges.
type anyAddress struct{}

func (anyAddress) Validate(raw string, base *dotnet.URI) (Target, error) {
	url, ok := resolve(raw, base)
	if !ok {
		return Target{}, fail(Blocked)
	}
	target := Target{URL: url, Host: url.Host, Port: url.Port}
	if literal, err := netip.ParseAddr(url.Host); err == nil {
		target.Literal = literal
	}
	return target, nil
}

func (anyAddress) AddressAllowed(netip.Addr) bool { return true }

// portsPolicy allows one host on any of the listed ports, at 127.0.0.1.
type portsPolicy struct {
	host  string
	ports []int
}

func (p portsPolicy) Validate(raw string, base *dotnet.URI) (Target, error) {
	url, ok := resolve(raw, base)
	if !ok || url.Host != p.host {
		return Target{}, fail(Blocked)
	}
	for _, port := range p.ports {
		if url.Port == port {
			return Target{URL: url, Host: url.IdnHost, Port: url.Port}, nil
		}
	}
	return Target{}, fail(Blocked)
}

func (portsPolicy) AddressAllowed(address netip.Addr) bool {
	return address == netip.MustParseAddr("127.0.0.1")
}

func TestRefusesARedirectFromHTTPSDownToHTTP(t *testing.T) {
	var plainHits atomic.Int32
	plain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		plainHits.Add(1)
		_, _ = w.Write([]byte("plain"))
	}))
	t.Cleanup(plain.Close)
	plainPort := plain.Listener.Addr().(*net.TCPAddr).Port
	pki := newPKI(t, "secure.example", nil)
	secure := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Location", "http://secure.example:"+strconv.Itoa(plainPort)+"/plain")
		w.WriteHeader(http.StatusFound)
	}))
	secure.TLS = &tls.Config{Certificates: []tls.Certificate{pki.leaf}}
	secure.StartTLS()
	t.Cleanup(secure.Close)
	securePort := secure.Listener.Addr().(*net.TCPAddr).Port
	f := newTestFetcher(portsPolicy{host: "secure.example", ports: []int{securePort, plainPort}},
		&countingResolver{answers: [][]netip.Addr{addrs("127.0.0.1")}})
	f.RootCAs = pki.pool

	_, err := f.Get(context.Background(), "https://secure.example:"+strconv.Itoa(securePort)+"/", testLimits)
	wantBlocked(t, err)
	if plainHits.Load() != 0 {
		t.Fatalf("the http hop was fetched %d times", plainHits.Load())
	}
}

func TestFollowsARedirectFromHTTPUpToHTTPS(t *testing.T) {
	pki := newPKI(t, "secure.example", nil)
	o := startTLSOrigin(t, pki.leaf, nil)
	plain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Location", "https://secure.example:"+strconv.Itoa(o.port)+"/up")
		w.WriteHeader(http.StatusFound)
	}))
	t.Cleanup(plain.Close)
	plainPort := plain.Listener.Addr().(*net.TCPAddr).Port
	f := newTestFetcher(portsPolicy{host: "secure.example", ports: []int{o.port, plainPort}},
		&countingResolver{answers: [][]netip.Addr{addrs("127.0.0.1")}})
	f.RootCAs = pki.pool

	response, err := f.Get(context.Background(), "http://secure.example:"+strconv.Itoa(plainPort)+"/", testLimits)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Release()
	if string(response.Body) != "ok" {
		t.Fatalf("body %q", response.Body)
	}
}

// trustd checks every cert of a path against the trust settings, the leaf
// and each parent alike (SecTrustServer.c:855-875, 910-925): a Deny makes
// it a denied anchor, and SecPVCCheckUsageConstraints fails the path
// (SecPolicyServer.c:3425-3440). So a chain through a "Never Trust" cert
// is refused, unless another chain avoids it.
func TestRefusesAChainThroughADeniedCert(t *testing.T) {
	now := time.Now()
	newKey := func() *ecdsa.PrivateKey { key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader); return key }
	rootKey, middleKey, leafKey := newKey(), newKey(), newKey()
	ca := func(serial int64, name string) *x509.Certificate {
		return &x509.Certificate{SerialNumber: big.NewInt(serial), Subject: pkix.Name{CommonName: name},
			NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	}
	root := makeCert(t, ca(1, "root"), ca(1, "root"), &rootKey.PublicKey, rootKey)
	middle := makeCert(t, ca(2, "middle"), root, &middleKey.PublicKey, rootKey)
	leaf := makeCert(t, &x509.Certificate{SerialNumber: big.NewInt(3), Subject: pkix.Name{CommonName: "denied.example"},
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour), DNSNames: []string{"denied.example"},
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}, middle, &leafKey.PublicKey, middleKey)
	pool := x509.NewCertPool()
	pool.AddCert(root)
	o := startTLSOrigin(t, tls.Certificate{Certificate: [][]byte{leaf.Raw, middle.Raw}, PrivateKey: leafKey}, nil)
	url := "https://denied.example:" + strconv.Itoa(o.port) + "/"

	get := func(denied ...*x509.Certificate) error {
		f := loopbackFetcher("denied.example", o.port, pool)
		f.denied = map[string]bool{}
		for _, certificate := range denied {
			f.denied[certHash(certificate.Raw)] = true
		}
		response, err := f.Get(context.Background(), url, testLimits)
		if err == nil {
			response.Release()
		}
		return err
	}
	if err := get(); err != nil {
		t.Fatalf("no deny: %v", err)
	}
	wantBlocked(t, get(middle))
	wantBlocked(t, get(leaf))
	if err := get(newPKI(t, "other.example", nil).root); err != nil {
		t.Fatalf("a deny off the chain: %v", err)
	}
}

//go:build darwin

package outbound

import (
	"crypto/x509"
	"os"
	"sync"
)

// macOSBundle is the PEM bundle macOS ships. Verifying against a pool built
// from PEM keeps Go's own verifier; the platform verifier would let trustd
// fetch a certificate's caIssuers URL past the guard (see
// tls_darwin_test.go). The cost: roots added only to the Keychain are not
// trusted for guarded fetches.
const macOSBundle = "/etc/ssl/cert.pem"

var bundle = sync.OnceValue(func() *x509.CertPool {
	pool := x509.NewCertPool()
	if data, err := os.ReadFile(macOSBundle); err == nil {
		pool.AppendCertsFromPEM(data)
	}
	// Empty when the bundle is missing: every https fetch then fails closed.
	return pool
})

func defaultRoots() *x509.CertPool { return bundle() }

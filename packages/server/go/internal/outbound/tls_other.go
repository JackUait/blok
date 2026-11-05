//go:build !darwin

package outbound

import "crypto/x509"

// systemTrust off macOS is a nil pool: Go's own verifier reads the system
// roots and never fetches a missing issuer. Windows uses the platform
// verifier, whose issuer fetching is UNVERIFIED.
type systemTrust struct {
	pool     *x509.CertPool
	denied   map[string]bool
	platform bool
}

func defaultTrust() systemTrust { return systemTrust{} }

// platformTrusts is never called off macOS: platform is never set there.
func platformTrusts([][]byte, string) bool { return false }

//go:build !darwin

package outbound

import "crypto/x509"

// defaultRoots is nil: off macOS Go's own verifier reads the system roots and
// never fetches a missing issuer. Windows uses the platform verifier, whose
// issuer fetching is UNVERIFIED.
func defaultRoots() *x509.CertPool { return nil }

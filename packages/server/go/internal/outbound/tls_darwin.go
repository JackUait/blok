//go:build darwin

package outbound

import (
	"context"
	"crypto/sha1"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// The roots are the trust settings' anchors for an SSL server check, as
// trustd decides them for C#'s SecTrust (trustsettings.go); Rust reads the
// same exports. Verification stays Go's own over a pool: the platform
// verifier would let trustd fetch a certificate's caIssuers URL past the
// guard (see tls_darwin_test.go). Intermediates kept only in the Keychain
// are not used, as in Rust.
const (
	securityTool = "/usr/bin/security"
	// macOSBundle is the fallback when any trust read fails.
	macOSBundle = "/etc/ssl/cert.pem"
)

// trustDomains are the export flags for the user, admin and system domains,
// in the order they override each other.
var trustDomains = []string{"", "-d", "-s"}

var keychains = []string{
	"~/Library/Keychains/login.keychain-db",
	"/Library/Keychains/System.keychain",
	"/System/Library/Keychains/SystemRootCertificates.keychain",
}

var bundle = sync.OnceValue(func() *x509.CertPool { return loadRoots(securityTool) })

func loadRoots(tool string) *x509.CertPool {
	if pool, err := loadTrustSettingsRoots(tool); err == nil {
		return pool
	}
	return bundlePool()
}

// bundlePool is empty when nothing loads: every https fetch then fails closed.
func bundlePool() *x509.CertPool {
	pool := x509.NewCertPool()
	if data, err := os.ReadFile(macOSBundle); err == nil {
		pool.AppendCertsFromPEM(data)
	}
	return pool
}

func defaultRoots() *x509.CertPool { return bundle() }

// loadTrustSettingsRoots fails when any keychain or domain cannot be read:
// without a keychain's certificates its trusted hashes would be dropped, and
// without a domain its denials would be. An empty domain exports fine.
func loadTrustSettingsRoots(tool string) (*x509.CertPool, error) {
	anchors, err := loadTrustSettingsAnchors(tool)
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	for _, der := range anchors {
		if certificate, err := x509.ParseCertificate(der); err == nil {
			pool.AddCert(certificate)
		}
	}
	return pool, nil
}

func loadTrustSettingsAnchors(tool string) ([][]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	certs := map[string][]byte{}
	home, _ := os.UserHomeDir()
	for _, keychain := range keychains {
		keychain = strings.Replace(keychain, "~", home, 1)
		out, err := exec.CommandContext(ctx, tool, "find-certificate", "-a", "-p", keychain).Output()
		if err != nil {
			return nil, err
		}
		for rest := out; ; {
			var block *pem.Block
			if block, rest = pem.Decode(rest); block == nil {
				break
			}
			sum := sha1.Sum(block.Bytes)
			certs[strings.ToUpper(hex.EncodeToString(sum[:]))] = block.Bytes
		}
	}
	directory, err := os.MkdirTemp("", "blok-trust-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(directory)
	domains := make([]map[string][]trustSetting, 0, len(trustDomains))
	for index, flag := range trustDomains {
		path := filepath.Join(directory, "domain"+strconv.Itoa(index)+".plist")
		args := []string{"trust-settings-export"}
		if flag != "" {
			args = append(args, flag)
		}
		list, err := exportTrustList(ctx, tool, append(args, path), path)
		if err != nil {
			return nil, err
		}
		domains = append(domains, list)
	}
	return trustedAnchors(domains, certs), nil
}

func exportTrustList(ctx context.Context, tool string, args []string, path string) (map[string][]trustSetting, error) {
	if err := exec.CommandContext(ctx, tool, args...).Run(); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return parseTrustList(data)
}

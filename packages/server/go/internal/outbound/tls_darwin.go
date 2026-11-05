//go:build darwin

package outbound

import (
	"context"
	"crypto/sha1"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// The roots are the anchors trustd would use for C#'s SecTrust
// (trustsettings.go): Apple's roots, the user and admin trust settings,
// and the self-signed certs of the system root keychain, which holds the
// same certs as trustd's own store (certsTable.data, measured). Rust reads
// the same. Verification stays Go's own over a pool: the platform
// verifier would let trustd fetch a certificate's caIssuers URL past the
// guard (see tls_darwin_test.go). Intermediates kept only in the Keychain
// are not used, as in Rust.
//
// When any trust read fails there are no roots, and every https fetch
// fails. A bundle would accept a cert the user marked "Never Trust", which
// C# refuses, and Go cannot ask trustd with its issuer fetching off: the
// standard library never calls SecTrustSetNetworkFetchAllowed, and the
// published builds have no cgo (scripts/publish-server-go.mjs).
const securityTool = "/usr/bin/security"

// trustDomains are the export flags for the user and admin domains. trustd
// reads no system-domain trust settings: its system anchors are its own
// store.
var trustDomains = []string{"", "-d"}

// keychains hold the certs the trust settings name. The system roots come
// from systemRootsKeychain.
var keychains = []string{
	"~/Library/Keychains/login.keychain-db",
	"/Library/Keychains/System.keychain",
}

const (
	systemRoots = "/System/Library/Keychains/SystemRootCertificates.keychain"
	plutilTool  = "/usr/bin/plutil"
)

// trustd's trust store: the PKI asset named by AutoAsset.plist when its
// VersionNumber is above the system bundle's (OTATrustUtilities.m
// :1101-1114, kOTATrustStoreContentVersionKey at :194).
var (
	autoAssetPlist          = "/private/var/protected/trustd/AutoAsset.plist"
	systemTrustStoreVersion = "/System/Library/Security/Certificates.bundle/Contents/Resources/AssetVersion.plist"
)

// systemRootsKeychain is the SystemRootCertificates keychain of the trust
// store trustd uses; it holds the certs of that store's certsTable.data.
// Any asset read that fails leaves the bundle, as trustd reads a missing
// version as 0.
func systemRootsKeychain(ctx context.Context) string {
	data, err := os.ReadFile(autoAssetPlist)
	if err != nil {
		return systemRoots
	}
	dict, err := readPlistDict(data)
	if err != nil {
		return systemRoots
	}
	asset, _ := dict["AssetPath"].(string)
	if asset == "" {
		return systemRoots
	}
	assetVersion := plistVersion(ctx, filepath.Join(asset, "AssetVersion.plist"))
	if assetVersion > plistVersion(ctx, systemTrustStoreVersion) {
		return filepath.Join(asset, "SystemRootCertificates.keychain")
	}
	return systemRoots
}

// plistVersion is a plist's VersionNumber, or 0. plutil reads the binary
// form the asset ships.
func plistVersion(ctx context.Context, path string) int64 {
	out, err := exec.CommandContext(ctx, plutilTool, "-convert", "xml1", "-o", "-", path).Output()
	if err != nil {
		return 0
	}
	dict, err := readPlistDict(out)
	if err != nil {
		return 0
	}
	version, _ := dict["VersionNumber"].(int64)
	return version
}

// systemTrust is the anchor pool and the certs the trust settings deny.
type systemTrust struct {
	pool   *x509.CertPool
	denied map[string]bool
}

var bundle = sync.OnceValue(func() systemTrust { return loadTrust(securityTool) })

func loadTrust(tool string) systemTrust {
	if pool, denied, err := loadTrustSettingsRoots(tool); err == nil {
		return systemTrust{pool, denied}
	}
	return systemTrust{pool: x509.NewCertPool()}
}

func loadRoots(tool string) *x509.CertPool { return loadTrust(tool).pool }

func defaultRoots() *x509.CertPool { return bundle().pool }

func defaultDenied() map[string]bool { return bundle().denied }

// loadTrustSettingsRoots fails when any keychain or domain cannot be read:
// without a keychain's certificates its trusted hashes would be dropped, and
// without a domain its denials would be. An empty domain exports fine.
func loadTrustSettingsRoots(tool string) (*x509.CertPool, map[string]bool, error) {
	anchors, denied, err := loadTrustSettingsAnchors(tool)
	if err != nil {
		return nil, nil, err
	}
	pool := x509.NewCertPool()
	for _, der := range anchors {
		if certificate, err := x509.ParseCertificate(der); err == nil {
			pool.AddCert(certificate)
		}
	}
	return pool, denied, nil
}

func loadTrustSettingsAnchors(tool string) ([][]byte, map[string]bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	certs := map[string][]byte{}
	system := map[string]bool{}
	home, _ := os.UserHomeDir()
	all := append(slices.Clone(keychains), systemRootsKeychain(ctx))
	for index, keychain := range all {
		keychain = strings.Replace(keychain, "~", home, 1)
		out, err := exec.CommandContext(ctx, tool, "find-certificate", "-a", "-p", keychain).Output()
		if err != nil {
			return nil, nil, err
		}
		for rest := out; ; {
			var block *pem.Block
			if block, rest = pem.Decode(rest); block == nil {
				break
			}
			sum := sha1.Sum(block.Bytes)
			hash := strings.ToUpper(hex.EncodeToString(sum[:]))
			certs[hash] = block.Bytes
			if index == len(all)-1 {
				system[hash] = true
			}
		}
	}
	// The tool exits 0 even for a keychain it cannot open.
	if len(system) == 0 {
		return nil, nil, errors.New("no system root certificates")
	}
	directory, err := os.MkdirTemp("", "blok-trust-")
	if err != nil {
		return nil, nil, err
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
			return nil, nil, err
		}
		domains = append(domains, list)
	}
	anchors := trustedAnchors(domains[0], domains[1], system, certs, selfSigned, appleRoot)
	return anchors, deniedCerts(domains[0], domains[1], certs, appleRoot), nil
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

// Package trustfixture builds the chains of
// test/unit/server-conformance/fixtures/macos-trust-chains.json. Only tests
// import it.
package trustfixture

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha1"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/json"
	"math/big"
	"net"
	"os"
	"time"
)

// Path is the fixture, from a package two levels under internal.
const Path = "../../../../../test/unit/server-conformance/fixtures/macos-trust-chains.json"

// Case is one row.
type Case struct {
	Name         string        `json:"name"`
	Host         string        `json:"host"`
	Leaf         Spec          `json:"leaf"`
	Intermediate *Intermediate `json:"intermediate"`
	Guarded      string        `json:"guarded"`
	Operator     string        `json:"operator"`
}

// Spec is the leaf. Eku is nil for no extension.
type Spec struct {
	CN    string   `json:"cn"`
	DNS   []string `json:"dns"`
	IPs   []string `json:"ips"`
	Eku   *[]string
	Days  int    `json:"days"`
	Start *int   `json:"start"`
	Key   string `json:"key"`
	CA    bool   `json:"ca"`
}

// UnmarshalJSON tells a missing eku (serverAuth) from a null one (none).
func (s *Spec) UnmarshalJSON(data []byte) error {
	type plain Spec
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	if err := json.Unmarshal(data, (*plain)(s)); err != nil {
		return err
	}
	usages := []string{"serverAuth"}
	s.Eku = &usages
	if value, ok := raw["eku"]; ok {
		s.Eku = nil
		if string(value) != "null" {
			var list []string
			if err := json.Unmarshal(value, &list); err != nil {
				return err
			}
			s.Eku = &list
		}
	}
	return nil
}

// Intermediate is the optional middle cert.
type Intermediate struct {
	Sent *bool    `json:"sent"`
	CA   *bool    `json:"ca"`
	Eku  []string `json:"eku"`
}

// Load reads the rows.
func Load(path string) ([]Case, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var fixture struct {
		Cases []Case `json:"cases"`
	}
	err = json.Unmarshal(data, &fixture)
	return fixture.Cases, err
}

// Chain is a built row: the certs as sent, the root, and the leaf key.
type Chain struct {
	Sent [][]byte
	Root *x509.Certificate
	Key  crypto.Signer
}

var usageOIDs = map[string]x509.ExtKeyUsage{
	"serverAuth": x509.ExtKeyUsageServerAuth,
	"clientAuth": x509.ExtKeyUsageClientAuth,
	"any":        x509.ExtKeyUsageAny,
}

func usages(names []string) []x509.ExtKeyUsage {
	out := make([]x509.ExtKeyUsage, len(names))
	for i, name := range names {
		out[i] = usageOIDs[name]
	}
	return out
}

func p256() *ecdsa.PrivateKey {
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	return key
}

// Build makes the chain as C#'s MacOsTrustChainFixtureTests does.
func Build(c Case) (Chain, error) {
	now := time.Now()
	day := 24 * time.Hour
	rootKey := p256()
	rootTemplate := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Blok Trust Test Root"},
		NotBefore: now.Add(-30 * day), NotAfter: now.Add(3650 * day), IsCA: true, BasicConstraintsValid: true,
		KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign}
	rootDER, err := x509.CreateCertificate(rand.Reader, rootTemplate, rootTemplate, &rootKey.PublicKey, rootKey)
	if err != nil {
		return Chain{}, err
	}
	root, _ := x509.ParseCertificate(rootDER)
	issuer, issuerKey := root, crypto.Signer(rootKey)
	var middle []byte
	sendMiddle := false
	if spec := c.Intermediate; spec != nil {
		middleKey := p256()
		template := &x509.Certificate{SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "Blok Trust Test Intermediate"},
			NotBefore: now.Add(-2 * day), NotAfter: now.Add(1000 * day), ExtKeyUsage: usages(spec.Eku)}
		if spec.CA == nil || *spec.CA {
			template.IsCA, template.BasicConstraintsValid = true, true
			template.KeyUsage = x509.KeyUsageCertSign | x509.KeyUsageCRLSign
		} else {
			// Go adds no key id to a non-CA cert; C# and Rust do.
			template.SubjectKeyId = keyID(&middleKey.PublicKey)
		}
		middle, err = x509.CreateCertificate(rand.Reader, template, root, &middleKey.PublicKey, rootKey)
		if err != nil {
			return Chain{}, err
		}
		issuer, _ = x509.ParseCertificate(middle)
		issuerKey = middleKey
		sendMiddle = spec.Sent == nil || *spec.Sent
	}
	var leafKey crypto.Signer = p256()
	if c.Leaf.Key == "rsa1024" {
		if leafKey, err = rsa.GenerateKey(rand.Reader, 1024); err != nil {
			return Chain{}, err
		}
	}
	cn := c.Leaf.CN
	if cn == "" {
		cn = "x"
	}
	start := -1
	if c.Leaf.Start != nil {
		start = *c.Leaf.Start
	}
	days := c.Leaf.Days
	if days == 0 {
		days = 365
	}
	begin := now.Add(time.Duration(start) * day)
	template := &x509.Certificate{SerialNumber: big.NewInt(3), Subject: pkix.Name{CommonName: cn},
		NotBefore: begin, NotAfter: begin.Add(time.Duration(days) * day), BasicConstraintsValid: true, IsCA: c.Leaf.CA,
		DNSNames: c.Leaf.DNS, SubjectKeyId: keyID(leafKey.Public())}
	if !c.Leaf.CA {
		template.KeyUsage = x509.KeyUsageDigitalSignature
	}
	if c.Leaf.Eku != nil {
		template.ExtKeyUsage = usages(*c.Leaf.Eku)
	}
	for _, ip := range c.Leaf.IPs {
		template.IPAddresses = append(template.IPAddresses, net.ParseIP(ip))
	}
	leaf, err := x509.CreateCertificate(rand.Reader, template, issuer, leafKey.Public(), issuerKey)
	if err != nil {
		return Chain{}, err
	}
	sent := [][]byte{leaf}
	if sendMiddle {
		sent = append(sent, middle)
	}
	return Chain{Sent: sent, Root: root, Key: leafKey}, nil
}

func keyID(public crypto.PublicKey) []byte {
	der, _ := x509.MarshalPKIXPublicKey(public)
	var info struct {
		Algorithm asn1.RawValue
		Key       asn1.BitString
	}
	_, _ = asn1.Unmarshal(der, &info)
	sum := sha1.Sum(info.Key.Bytes)
	return sum[:]
}

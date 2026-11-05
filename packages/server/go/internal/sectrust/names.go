package sectrust

import (
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"net/netip"
	"strings"
)

// passingDetail holds the TrustResultDetails keys a .NET chain with
// revocation off does not fail on: MergeStatusCodes (pal_x509chain.c)
// reports none of these, and SecTrustChainPal.FixupStatus clears the two
// revocation ones under X509RevocationMode.NoCheck.
var passingDetail = map[string]bool{
	"UnparseableExtension":       true,
	"WeakLeaf":                   true,
	"WeakIntermediates":          true,
	"WeakRoot":                   true,
	"WeakKeySize":                true,
	"WeakSignature":              true,
	"StatusCodes":                true,
	"NonEmptySubject":            true,
	"GrayListedKey":              true,
	"CTRequired":                 true,
	"GrayListedLeaf":             true,
	"IdLinkage":                  true,
	"DuplicateExtension":         true,
	"Revocation":                 true,
	"RevocationResponseRequired": true,
}

const (
	serverAuth = "1.3.6.1.5.5.7.3.1"
	anyPolicy  = "2.5.29.32.0"
)

var (
	oidApplicationCertPolicies = asn1.ObjectIdentifier{1, 3, 6, 1, 4, 1, 311, 21, 10}
	oidPolicyConstraints       = asn1.ObjectIdentifier{2, 5, 29, 36}
	oidExtendedKeyUsage        = asn1.ObjectIdentifier{2, 5, 29, 37}
	oidCommonName              = asn1.ObjectIdentifier{2, 5, 4, 3}
)

type applicationPolicy struct {
	declared        map[string]bool
	implicitAny     bool
	specifiedAny    bool
	requireExplicit *int
}

// serverAuthAllowed is CertificatePolicyChain.MatchesApplicationPolicies
// for serverAuth over the built chain, leaf first. A decode error throws in
// .NET, which fails the handshake.
func serverAuthAllowed(chain [][]byte) bool {
	policies := make([]applicationPolicy, len(chain))
	for i, der := range chain {
		certificate, err := x509.ParseCertificate(der)
		if err != nil {
			return false
		}
		policy, ok := readApplicationPolicy(certificate)
		if !ok {
			return false
		}
		policies[i] = policy
	}
	// ReadPolicies: from the root down, requireExplicitPolicy ends the
	// implicit "any" of the certs below it.
	restriction := len(chain)
	for j := 1; j <= len(chain); j++ {
		policy := &policies[len(chain)-j]
		if restriction <= 0 {
			policy.implicitAny = false
		} else {
			restriction--
		}
		if policy.requireExplicit != nil && *policy.requireExplicit < restriction {
			restriction = *policy.requireExplicit
		}
	}
	for _, policy := range policies {
		if policy.implicitAny || policy.specifiedAny {
			continue
		}
		if !policy.declared[serverAuth] {
			return false
		}
	}
	return true
}

func readApplicationPolicy(certificate *x509.Certificate) (applicationPolicy, bool) {
	var policy applicationPolicy
	var application, usage []byte
	for _, extension := range certificate.Extensions {
		switch {
		case extension.Id.Equal(oidApplicationCertPolicies):
			application = extension.Value
		case extension.Id.Equal(oidExtendedKeyUsage):
			usage = extension.Value
		case extension.Id.Equal(oidPolicyConstraints):
			var constraints struct {
				RequireExplicit int `asn1:"optional,tag:0,default:-1"`
				InhibitMapping  int `asn1:"optional,tag:1,default:-1"`
			}
			if rest, err := asn1.Unmarshal(extension.Value, &constraints); err != nil || len(rest) != 0 {
				return policy, false
			}
			if constraints.RequireExplicit >= 0 {
				depth := constraints.RequireExplicit
				policy.requireExplicit = &depth
			}
		}
	}
	switch {
	case application != nil:
		var information []asn1.RawValue
		if rest, err := asn1.Unmarshal(application, &information); err != nil || len(rest) != 0 {
			return policy, false
		}
		policy.declared = map[string]bool{}
		for _, entry := range information {
			var identifier asn1.ObjectIdentifier
			if _, err := asn1.Unmarshal(entry.Bytes, &identifier); err != nil {
				return policy, false
			}
			policy.declared[identifier.String()] = true
		}
	case usage != nil:
		var identifiers []asn1.ObjectIdentifier
		if rest, err := asn1.Unmarshal(usage, &identifiers); err != nil || len(rest) != 0 {
			return policy, false
		}
		policy.declared = map[string]bool{}
		for _, identifier := range identifiers {
			policy.declared[identifier.String()] = true
		}
	}
	policy.implicitAny = policy.declared == nil
	if policy.declared[anyPolicy] {
		delete(policy.declared, anyPolicy)
		policy.specifiedAny = true
	}
	return policy, true
}

// matchesHost is CertificateValidation.BuildChainAndVerifyProperties after
// TargetHostNameHelper.NormalizeHostName: trailing dots go, then
// X509Certificate2.MatchesHostname with wildcards and the common name.
func matchesHost(leafDER []byte, host string) bool {
	host = strings.TrimRight(host, ".")
	if host == "" {
		return false
	}
	leaf, err := x509.ParseCertificate(leafDER)
	if err != nil {
		return false
	}
	address, addressErr := netip.ParseAddr(strings.TrimSuffix(strings.TrimPrefix(host, "["), "]"))
	isAddress := addressErr == nil
	if hasSAN(leaf) {
		named := false
		if isAddress {
			for _, ip := range leaf.IPAddresses {
				// IPAddress.Equals tells an IPv4-mapped address from IPv4.
				if other, ok := netip.AddrFromSlice(ip); ok && other == address {
					return true
				}
				named = true
			}
		} else {
			name := host
			parent := ""
			if dot := strings.IndexByte(name, '.'); dot > 0 {
				parent = name[dot+1:]
			}
			for _, san := range leaf.DNSNames {
				named = true
				if san == "" {
					continue
				}
				san = strings.TrimSuffix(san, ".")
				if strings.HasPrefix(san, "*.") && len(san) > 2 {
					if strings.EqualFold(san[2:], parent) {
						return true
					}
				} else if strings.EqualFold(san, name) {
					return true
				}
			}
		}
		if named {
			return false
		}
	}
	var subject pkix.RDNSequence
	if rest, err := asn1.Unmarshal(leaf.RawSubject, &subject); err != nil || len(rest) != 0 {
		return false
	}
	common := ""
	found := false
	for _, rdn := range subject {
		if len(rdn) > 1 {
			for _, attribute := range rdn {
				if attribute.Type.Equal(oidCommonName) {
					return false
				}
			}
			continue
		}
		if len(rdn) == 1 && rdn[0].Type.Equal(oidCommonName) {
			if found {
				return false
			}
			found = true
			common, _ = rdn[0].Value.(string)
		}
	}
	return found && strings.EqualFold(host, common)
}

func hasSAN(certificate *x509.Certificate) bool {
	for _, extension := range certificate.Extensions {
		if extension.Id.Equal(asn1.ObjectIdentifier{2, 5, 29, 17}) {
			return true
		}
	}
	return false
}

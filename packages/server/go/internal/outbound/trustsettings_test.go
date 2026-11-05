package outbound

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"reflect"
	"testing"
	"time"
)

func setting(policy string, result int64) trustSetting {
	s := trustSetting{}
	if policy != "" {
		s.policyName, s.hasPolicyName = policy, true
	}
	if result != 0 {
		s.result, s.hasResult = result, true
	}
	return s
}

// sslOID is the Apple SSL policy OID, as an export's kSecTrustSettingsPolicy
// carries it (1.2.840.113635.100.1.3); basicOID is basicX509's.
var (
	sslOID   = []byte{0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x01, 0x03}
	basicOID = []byte{0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x01, 0x02}
)

// trustd, which C#'s SecTrust runs (apple-oss-distributions/Security
// db15acbe6a7f, cited in trustsettings.go):
//   - Apple's roots anchor before any setting (SecTrustServer.c:260-285).
//   - Admin's list replaces the user's when admin lists the cert
//     (SecCertificateSource.c:998-1021).
//   - In a list the first entry that meets decides, Unspecified included
//     (SecPolicyServer.c:3359-3375): {Unspecified, Deny} does not deny, it
//     leaves the cert to the system roots, as C# does.
//   - TrustRoot anchors only a self-signed cert, TrustAsRoot only one that
//     is not; an empty list anchors a self-signed cert (:3378-3423).
//   - Deny ends the search; anything else leaves it to the system roots,
//     which anchor a self-signed cert (SecCertificateSource.c:330-366).
//   - A constrained entry is an anchor only if it is one whether it meets
//     or not.
func TestTrustSettingsDecideAsTrustdDoes(t *testing.T) {
	certs := map[string][]byte{}
	for _, hash := range "ABCDEFGHIJKLMNOPQRSTUV" {
		certs[string(hash)] = []byte(string(hash))
	}
	notSelfSigned := map[string]bool{"D": true, "E": true, "H": true, "L": true}
	selfSigned := func(der []byte) bool { return !notSelfSigned[string(der)] }
	apple := func(der []byte) bool { return string(der) == "M" }
	constrainedSSL := func(result int64) trustSetting {
		s := setting("sslServer", result)
		s.constrained = true
		return s
	}
	user := map[string][]trustSetting{
		"A":       {setting("sslServer", 3)},
		"D":       {setting("sslServer", 1)},
		"E":       {setting("sslServer", 2)},
		"F":       {setting("sslServer", 2)},
		"G":       {},
		"H":       {},
		"I":       {setting("sslServer", 3)},
		"J":       {setting("sslServer", 3)},
		"M":       {setting("sslServer", 3)},
		"N":       {constrainedSSL(1)},
		"O":       {constrainedSSL(3)},
		"Q":       {constrainedSSL(1), setting("", 1)},
		"R":       {setting("sslServer", 9), setting("", 1)},
		"S":       {{policyOID: sslOID, result: 1, hasResult: true}},
		"T":       {{policyName: "sslServer", hasPolicyName: true, policyOID: basicOID, result: 1, hasResult: true}},
		"U":       {setting("smime", 1)},
		"missing": {setting("sslServer", 1)},
	}
	admin := map[string][]trustSetting{
		"B": {setting("sslServer", 4), setting("", 3)},
		"C": {setting("sslServer", 4), setting("", 1)},
		"I": {setting("smime", 1)},
		"V": {setting("sslServer", 3)},
	}
	system := map[string]bool{"A": true, "B": true, "I": true, "J": true, "K": true, "L": true, "M": true, "O": true, "U": true, "V": true}
	got := trustedAnchors(user, admin, system, certs, selfSigned, apple)
	// A, J: the user denies a system root. B: Unspecified decides, the
	// system anchors. C: Unspecified decides, nothing else anchors. D:
	// TrustRoot on a cert that is not self-signed. E: TrustAsRoot on one
	// that is not. F: TrustAsRoot on a self-signed one. G: an empty list,
	// self-signed. H: an empty list, not. I: admin's S/MIME list replaces
	// the user's deny. K: a system root. L: a system cert that is not
	// self-signed. M: Apple's root beats the user's deny. N: a hostname rule
	// that trusts. O: a hostname rule that denies a system root. Q: trusted
	// whether the hostname rule meets or not. R: an unknown result decides.
	// S: the SSL OID alone. T: the name with another OID. U: only S/MIME,
	// the system anchors. V: admin denies a system root.
	want := []string{"B", "E", "G", "I", "K", "M", "Q", "S", "U"}
	var gotHashes []string
	for _, der := range got {
		gotHashes = append(gotHashes, string(der))
	}
	if !reflect.DeepEqual(gotHashes, want) {
		t.Fatalf("got %q, want %q", gotHashes, want)
	}
}

// _SecCertificateIsSelfSigned (SecCertificate.c:6192-6222): issuer equals
// subject, the authority key ID (when present) equals the subject key ID,
// and the cert's own key verifies it.
func TestSelfSignedIsApplesRule(t *testing.T) {
	key, other := newKey(t), newKey(t)
	root := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "root"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		IsCA: true, BasicConstraintsValid: true, SubjectKeyId: []byte{1},
	}
	cases := []struct {
		name     string
		template *x509.Certificate
		parent   *x509.Certificate
		signer   *ecdsa.PrivateKey
		want     bool
	}{
		{"self-signed", root, root, key, true},
		{"signed by another key", root, root, other, false},
		{"issued by another name", &x509.Certificate{SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "leaf"},
			NotBefore: root.NotBefore, NotAfter: root.NotAfter}, root, key, false},
		{"another authority key ID", &x509.Certificate{SerialNumber: big.NewInt(3), Subject: root.Subject,
			NotBefore: root.NotBefore, NotAfter: root.NotAfter, SubjectKeyId: []byte{1}, AuthorityKeyId: []byte{2}}, nil, key, false},
	}
	for _, c := range cases {
		parent := c.parent
		if parent == nil {
			parent = c.template
		}
		der, err := x509.CreateCertificate(rand.Reader, c.template, parent, &key.PublicKey, c.signer)
		if err != nil {
			t.Fatal(err)
		}
		if got := selfSigned(der); got != c.want {
			t.Errorf("%s: self-signed %v, want %v", c.name, got, c.want)
		}
	}
}

func newKey(t *testing.T) *ecdsa.PrivateKey {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func TestReadsTheTrustListOfAnExport(t *testing.T) {
	export := []byte(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>trustList</key>
	<dict>
		<key>308763FAEDCBFA752EE972550B6B457277650C86</key>
		<dict>
			<key>issuerName</key>
			<data>
			MIGnMR4wHAYDVQQK
			</data>
			<key>modDate</key>
			<date>2024-04-16T11:17:23Z</date>
			<key>serialNumber</key>
			<data>
			ULlN12F9dzhvaGrUOEGFZA==
			</data>
			<key>trustSettings</key>
			<array>
				<dict>
					<key>kSecTrustSettingsPolicy</key>
					<data>
					KoZIhvdjZAED
					</data>
					<key>kSecTrustSettingsPolicyName</key>
					<string>sslServer</string>
					<key>kSecTrustSettingsResult</key>
					<integer>1</integer>
				</dict>
				<dict>
					<key>kSecTrustSettingsAllowedError</key>
					<integer>-2147409654</integer>
				</dict>
				<dict>
					<key>kSecTrustSettingsPolicyString</key>
					<string>docs.example</string>
				</dict>
				<dict>
					<key>kSecTrustSettingsKeyUsage</key>
					<integer>4294967295</integer>
				</dict>
				<dict>
					<key>kSecTrustSettingsKeyUsage</key>
					<integer>8</integer>
				</dict>
				<dict>
					<key>kSecTrustSettingsKeyUsage</key>
					<integer>-1</integer>
				</dict>
				<dict>
					<key>kSecTrustSettingsPolicyName</key>
					<string>sslServer</string>
				</dict>
				<dict>
					<key>kSecTrustSettingsPolicyOptions</key>
					<dict/>
					<key>kSecTrustSettingsResult</key>
					<integer>3</integer>
				</dict>
			</array>
		</dict>
		<key>B8A0E8A6285B3B86B476C5796054EBFC6DA6EB80</key>
		<dict>
			<key>trustSettings</key>
			<array>
				<string>not a dict</string>
				<dict>
					<key>kSecTrustSettingsPolicy</key>
					<string>KoZIhvdjZAED</string>
				</dict>
				<dict>
					<key>kSecTrustSettingsResult</key>
					<string>1</string>
				</dict>
				<dict>
					<key>kSecTrustSettingsPolicyName</key>
					<integer>1</integer>
				</dict>
			</array>
		</dict>
		<key>925A8F8D2C6D04E0665F596AFF22D863E8256F3F</key>
		<dict>
			<key>serialNumber</key>
			<data>
			AA==
			</data>
		</dict>
	</dict>
	<key>trustVersion</key>
	<integer>1</integer>
</dict>
</plist>
`)
	got, err := parseTrustList(export)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string][]trustSetting{
		"308763FAEDCBFA752EE972550B6B457277650C86": {
			{policyName: "sslServer", hasPolicyName: true, policyOID: sslOID, result: 1, hasResult: true},
			{},
			{constrained: true},
			{},
			{constrained: true},
			// -1 is not kSecTrustSettingsKeyUseAny read as 64 bits.
			{constrained: true},
			// A name alone does not reach trustd; policy options are dropped.
			{result: 3, hasResult: true},
		},
		// Entries it cannot read stay, as constrained. A bad name alone is
		// dropped like any name alone.
		"B8A0E8A6285B3B86B476C5796054EBFC6DA6EB80": {{constrained: true}, {constrained: true}, {constrained: true}},
		"925A8F8D2C6D04E0665F596AFF22D863E8256F3F": nil,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

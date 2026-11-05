package outbound

import (
	"reflect"
	"testing"
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

// trustd's SecPVCGetTrustSettingsResult and SecPVCMeetsConstraint
// (apple-oss-distributions/Security, trust/trustd/SecPolicyServer.c), which
// SecTrust runs for C#: an empty list trusts; otherwise the first entry
// whose every constraint matches an SSL server check decides, with no
// result meaning TrustRoot. An entry for another policy, or with a
// constraint a fixed root set cannot check, does not match. Unspecified or
// an unknown result decides nothing, nor does no match; then the next
// domain decides.
func TestTrustSettingsDecideAsTrustdDoes(t *testing.T) {
	certs := map[string][]byte{}
	for _, hash := range "ABCDEFGHIJKLMNOP" {
		certs[string(hash)] = []byte(string(hash))
	}
	user := map[string][]trustSetting{
		"A": {setting("sslServer", 3)},
		"G": {setting("smime", 1)},
		"H": {{policyOID: sslOID, result: 1, hasResult: true}},
		"I": {{policyName: "sslServer", hasPolicyName: true, constrained: true}},
		"J": {{policyName: "sslServer", hasPolicyName: true, policyOID: basicOID}},
		"K": {{policyName: "sslServer", hasPolicyName: true, policyOID: sslOID, result: 2, hasResult: true}},
		"L": {{policyOID: basicOID}},
	}
	admin := map[string][]trustSetting{
		"A":       {},
		"B":       {setting("basicX509", 3), setting("sslServer", 2)},
		"C":       {setting("sslServer", 4), setting("", 1)},
		"M":       {setting("sslServer", 4), setting("", 1)},
		"D":       {setting("sslServer", 4)},
		"E":       {setting("", 9), setting("sslServer", 0)},
		"N":       {setting("smime", 3)},
		"missing": {},
	}
	system := map[string][]trustSetting{
		"F": nil,
		"B": {setting("", 3)},
		"M": nil,
		"N": nil,
		"P": {setting("smime", 1)},
	}
	got := trustedAnchors([]map[string][]trustSetting{user, admin, system}, certs)
	// A: the user denies. B: admin's TrustAsRoot beats the system's deny.
	// C: Unspecified decides nothing. M: as C, then the system trusts it.
	// G, L, P: only other policies. H: the SSL OID alone. I: a hostname-only
	// rule. J: the name with another policy's OID. K: name and OID.
	// N: admin's S/MIME rule leaves it to the system.
	want := [][]byte{[]byte("B"), []byte("F"), []byte("H"), []byte("K"), []byte("M"), []byte("N")}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
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
		},
		"925A8F8D2C6D04E0665F596AFF22D863E8256F3F": nil,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

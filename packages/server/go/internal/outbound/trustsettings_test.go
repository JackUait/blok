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

// rustls-native-certs (load_native_certs, tls_trust_settings_for_certificate)
// on macOS: user over admin over system, only sslServer or unnamed entries
// count, Unspecified and unknown results fall through, none means trusted,
// and only TrustRoot and TrustAsRoot are kept.
func TestTrustSettingsDecideAsRustlsNativeCertsDoes(t *testing.T) {
	certs := map[string][]byte{"A": {1}, "B": {2}, "C": {3}, "D": {4}, "E": {5}, "F": {6}, "G": {7}}
	user := map[string][]trustSetting{
		"A": {setting("sslServer", 3)},
	}
	admin := map[string][]trustSetting{
		"A":       {},
		"B":       {setting("basicX509", 3), setting("sslServer", 2)},
		"C":       {setting("sslServer", 4), setting("", 3)},
		"D":       {setting("sslServer", 4)},
		"E":       {setting("", 9), setting("sslServer", 0)},
		"missing": {},
	}
	system := map[string][]trustSetting{
		"F": nil,
		"G": {setting("smime", 3)},
		"B": {setting("", 3)},
	}
	got := trustedAnchors([]map[string][]trustSetting{user, admin, system}, certs)
	// A: denied by the user. C: denied after an Unspecified. B: TrustAsRoot
	// from admin wins over the system's deny.
	want := [][]byte{{2}, {4}, {5}, {6}, {7}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
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
		"308763FAEDCBFA752EE972550B6B457277650C86": {setting("sslServer", 1), {}},
		"925A8F8D2C6D04E0665F596AFF22D863E8256F3F": nil,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

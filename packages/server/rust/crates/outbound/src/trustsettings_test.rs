use std::collections::HashMap;

use super::trustsettings::{TrustSetting, parse_trust_list, trusted_anchors};

fn setting(policy: &str, result: i64) -> TrustSetting {
    TrustSetting {
        policy_name: (!policy.is_empty()).then(|| policy.to_string()),
        result: (result != 0).then_some(result),
        ..TrustSetting::default()
    }
}

fn constrained_ssl(result: i64) -> TrustSetting {
    TrustSetting {
        constrained: true,
        ..setting("sslServer", result)
    }
}

// The Apple SSL policy OID, as an export's kSecTrustSettingsPolicy carries
// it (1.2.840.113635.100.1.3); BASIC_OID is basicX509's.
const SSL_OID: [u8; 9] = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x01, 0x03];
const BASIC_OID: [u8; 9] = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x01, 0x02];

fn domain(entries: Vec<(&str, Vec<TrustSetting>)>) -> HashMap<String, Vec<TrustSetting>> {
    entries
        .into_iter()
        .map(|(hash, settings)| (hash.to_string(), settings))
        .collect()
}

// TrustSettings::evaluateCert and SecTrustSettingsEvaluateCert
// (apple-oss-distributions/Security, OSX/libsecurity_keychain/lib/
// TrustSettings.cpp and SecTrustSettings.cpp): domains user, admin, system;
// an empty list trusts; within a list the first entry for an SSL server
// check (SecPVCMeetsConstraint's name and OID rule, trust/trustd/
// SecPolicyServer.c) with a definite result decides, no result meaning
// TrustRoot, and Unspecified or an unknown result goes on to the next
// entry. A rule a fixed root set cannot check (a hostname, say) still
// denies, but never trusts. Nothing definite leaves it to the next domain.
#[test]
fn trust_settings_decide_as_sec_trust_settings_does() {
    let certs: HashMap<String, Vec<u8>> = "ABCDEFGHIJKLMNOPQRS"
        .chars()
        .map(|hash| (hash.to_string(), vec![hash as u8]))
        .collect();
    let user = domain(vec![
        ("A", vec![setting("sslServer", 3)]),
        ("G", vec![setting("smime", 1)]),
        (
            "H",
            vec![TrustSetting {
                policy_oid: Some(SSL_OID.to_vec()),
                result: Some(1),
                ..TrustSetting::default()
            }],
        ),
        ("I", vec![constrained_ssl(0)]),
        (
            "J",
            vec![TrustSetting {
                policy_oid: Some(BASIC_OID.to_vec()),
                ..setting("sslServer", 0)
            }],
        ),
        (
            "K",
            vec![TrustSetting {
                policy_oid: Some(SSL_OID.to_vec()),
                ..setting("sslServer", 2)
            }],
        ),
        (
            "L",
            vec![TrustSetting {
                policy_oid: Some(BASIC_OID.to_vec()),
                ..TrustSetting::default()
            }],
        ),
        ("R", vec![constrained_ssl(3)]),
        ("S", vec![constrained_ssl(1)]),
    ]);
    let admin = domain(vec![
        ("A", vec![]),
        ("B", vec![setting("basicX509", 3), setting("sslServer", 2)]),
        ("C", vec![setting("sslServer", 4), setting("", 1)]),
        ("M", vec![setting("sslServer", 4), setting("", 1)]),
        ("D", vec![setting("sslServer", 4)]),
        ("E", vec![setting("", 9), setting("sslServer", 0)]),
        ("N", vec![setting("smime", 3)]),
        ("Q", vec![setting("sslServer", 4), setting("", 3)]),
        ("missing", vec![]),
    ]);
    let system = domain(vec![
        ("F", vec![]),
        ("B", vec![setting("", 3)]),
        ("M", vec![]),
        ("N", vec![]),
        ("P", vec![setting("smime", 1)]),
        ("Q", vec![]),
        ("R", vec![]),
        ("S", vec![]),
    ]);
    let got = trusted_anchors(&[user, admin, system], &certs);
    // A: the user denies. B: admin's TrustAsRoot beats the system's deny.
    // C, M: past Unspecified to TrustRoot. D: only Unspecified. E: past an
    // unknown result. G, L, P: only other policies. H: the SSL OID alone.
    // I: a hostname-only trust is skipped. J: the name with another policy's
    // OID. K: name and OID. N: admin's S/MIME rule leaves it to the system.
    // Q: past Unspecified to Deny, over the system's trust. R: a hostname
    // rule's Deny still denies. S: a hostname rule's trust leaves it to the
    // system.
    let want: Vec<Vec<u8>> = "BCEFHKMNS".bytes().map(|hash| vec![hash]).collect();
    assert_eq!(got, want);
}

#[test]
fn reads_the_trust_list_of_an_export() {
    let export = br#"<?xml version="1.0" encoding="UTF-8"?>
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
"#;
    let got = parse_trust_list(export).unwrap();
    let want = domain(vec![
        (
            "308763FAEDCBFA752EE972550B6B457277650C86",
            vec![
                TrustSetting {
                    policy_oid: Some(SSL_OID.to_vec()),
                    ..setting("sslServer", 1)
                },
                TrustSetting::default(),
                TrustSetting {
                    constrained: true,
                    ..TrustSetting::default()
                },
                TrustSetting::default(),
                TrustSetting {
                    constrained: true,
                    ..TrustSetting::default()
                },
            ],
        ),
        ("925A8F8D2C6D04E0665F596AFF22D863E8256F3F", vec![]),
    ]);
    assert_eq!(got, want);
}

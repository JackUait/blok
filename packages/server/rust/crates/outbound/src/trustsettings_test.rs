use std::collections::{HashMap, HashSet};

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

// trustd, which C#'s SecTrust runs (apple-oss-distributions/Security
// db15acbe6a7f, cited in trustsettings.rs):
// - Apple's roots anchor before any setting (SecTrustServer.c:260-285).
// - Admin's list replaces the user's when admin lists the cert
//   (SecCertificateSource.c:998-1021).
// - In a list the first entry that meets decides, Unspecified included
//   (SecPolicyServer.c:3359-3375): {Unspecified, Deny} does not deny, it
//   leaves the cert to the system roots, as C# does.
// - TrustRoot anchors only a self-signed cert, TrustAsRoot only one that is
//   not; an empty list anchors a self-signed cert (:3378-3423).
// - Deny ends the search; anything else leaves it to the system roots,
//   which anchor a self-signed cert (SecCertificateSource.c:330-366).
// - A constrained entry is an anchor only if it is one whether it meets or
//   not.
#[test]
fn trust_settings_decide_as_trustd_does() {
    let certs: HashMap<String, Vec<u8>> = "ABCDEFGHIJKLMNOPQRSTUV"
        .chars()
        .map(|hash| (hash.to_string(), vec![hash as u8]))
        .collect();
    let self_signed = |der: &[u8]| !b"DEHL".contains(&der[0]);
    let apple = |der: &[u8]| der == b"M";
    let user = domain(vec![
        ("A", vec![setting("sslServer", 3)]),
        ("D", vec![setting("sslServer", 1)]),
        ("E", vec![setting("sslServer", 2)]),
        ("F", vec![setting("sslServer", 2)]),
        ("G", vec![]),
        ("H", vec![]),
        ("I", vec![setting("sslServer", 3)]),
        ("J", vec![setting("sslServer", 3)]),
        ("M", vec![setting("sslServer", 3)]),
        ("N", vec![constrained_ssl(1)]),
        ("O", vec![constrained_ssl(3)]),
        ("Q", vec![constrained_ssl(1), setting("", 1)]),
        ("R", vec![setting("sslServer", 9), setting("", 1)]),
        (
            "S",
            vec![TrustSetting {
                policy_oid: Some(SSL_OID.to_vec()),
                result: Some(1),
                ..TrustSetting::default()
            }],
        ),
        (
            "T",
            vec![TrustSetting {
                policy_oid: Some(BASIC_OID.to_vec()),
                ..setting("sslServer", 1)
            }],
        ),
        ("U", vec![setting("smime", 1)]),
        ("missing", vec![setting("sslServer", 1)]),
    ]);
    let admin = domain(vec![
        ("B", vec![setting("sslServer", 4), setting("", 3)]),
        ("C", vec![setting("sslServer", 4), setting("", 1)]),
        ("I", vec![setting("smime", 1)]),
        ("V", vec![setting("sslServer", 3)]),
    ]);
    let system: HashSet<String> = ["A", "B", "I", "J", "K", "L", "M", "O", "U", "V"]
        .iter()
        .map(|h| h.to_string())
        .collect();
    let got = trusted_anchors(&user, &admin, &system, &certs, self_signed, apple);
    // A, J: the user denies a system root. B: Unspecified decides, the
    // system anchors. C: Unspecified decides, nothing else anchors. D:
    // TrustRoot on a cert that is not self-signed. E: TrustAsRoot on one
    // that is not. F: TrustAsRoot on a self-signed one. G: an empty list,
    // self-signed. H: an empty list, not. I: admin's S/MIME list replaces the
    // user's deny. K: a system root. L: a system cert that is not
    // self-signed. M: Apple's root beats the user's deny. N: a hostname rule
    // that trusts. O: a hostname rule that denies a system root. Q: trusted
    // whether the hostname rule meets or not. R: an unknown result decides.
    // S: the SSL OID alone. T: the name with another OID. U: only S/MIME, the
    // system anchors. V: admin denies a system root.
    let want: Vec<Vec<u8>> = "BEGIKMQSU".bytes().map(|hash| vec![hash]).collect();
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
                // -1 is not kSecTrustSettingsKeyUseAny read as 64 bits.
                TrustSetting {
                    constrained: true,
                    ..TrustSetting::default()
                },
                // A name alone does not reach trustd; policy options are dropped.
                TrustSetting {
                    result: Some(3),
                    ..TrustSetting::default()
                },
            ],
        ),
        // Entries it cannot read stay, as constrained. A bad name alone is
        // dropped like any name alone.
        (
            "B8A0E8A6285B3B86B476C5796054EBFC6DA6EB80",
            vec![
                TrustSetting {
                    constrained: true,
                    ..TrustSetting::default()
                };
                3
            ],
        ),
        ("925A8F8D2C6D04E0665F596AFF22D863E8256F3F", vec![]),
    ]);
    assert_eq!(got, want);
}
